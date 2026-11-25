/**
 * Capture and the tracker, closer (docs/plans/capture-link.md):
 *
 * - `/api/push/*` (signed-in browser): the VAPID key, this browser's push
 *   subscription, a test notification.
 * - `/api/irminsul/presence` (Capture: Bearer or `x-import-key`, like
 *   `/irminsul/changes`): the heartbeat that says the game runs (what alerts'
 *   "Not while playing", the Planner's resin lock and staff Metrics read),
 *   answering whoami and this device's alerts.
 * - `/api/accounts/:id/presence|alert-facts` (website): who plays the account
 *   now, and the facts alerts are worked out from as the Planner sees them
 *   (the resin set by hand, tasks ticked, and what was known before alerts
 *   were turned on).
 * - `/api/accounts/:id/capture-command`: website commands were removed on
 *   2026-11-26 (the owner's decision); old cached pages get 409 `not_playing`.
 *
 * A device's alerts are set with `PATCH /api/auth/sessions/:id` (routes/auth).
 */

import {
  presenceRequest,
  pushSubscriptionRequest,
  readDeviceAlerts,
  type PresenceResponse,
  type PresenceResponseForAccount,
  type PushConfigResponse,
} from '@gdt/shared'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { getDb } from '../db/client'
import type { AppEnv } from '../env'
import { ApiError, idParam, parseJson, rateLimit } from '../lib/http'
import { bearerToken, readAccessToken } from '../lib/irminsul-auth'
import { requireActiveSession, requireUser } from '../lib/session'
import { pageOrigin } from '../lib/email'
import { keyOwner, sessionOwnerWith, uploaderUserId } from '../lib/uploader'
import { vapidKeys, type VapidVars } from '../lib/web-push'
import { loadAccount, pickByUid, type UploadOwner } from '../services/accounts'
import { whoamiOf } from '../services/irminsul'
import type { FactsUpdate } from '../services/alerts'
import {
  devicesChanged,
  IDLE_NEXT_S,
  liveHub,
  listenerOf,
  listenerStatement,
  tellAlertFacts,
} from '../services/live'

const vars = (c: Context<AppEnv>) => c.env as unknown as VapidVars

/** 404 `alerts_off` while the server has no VAPID keys. */
function requirePush(c: Context<AppEnv>) {
  const keys = vapidKeys(vars(c))
  if (!keys) throw new ApiError(404, 'alerts_off', 'Alerts are not set up on this server')
  return keys
}

// ------------------------------------------------------------------ /api/push

export const push = new Hono<AppEnv>()
  .get('/config', (c) => {
    const keys = vapidKeys(vars(c))
    return c.json<PushConfigResponse>({ enabled: !!keys, publicKey: keys?.publicKey ?? null })
  })

  /** This browser's subscription, tied to its session (one row per endpoint). */
  .put('/subscription', requireActiveSession, async (c) => {
    requirePush(c)
    const userId = c.get('userId')
    const sid = c.get('sessionId')!
    await rateLimit(c.env.AUTH_LIMITER, `push:${userId}`)
    const body = await parseJson(c, pushSubscriptionRequest)
    const d1 = c.env.DB
    const now = Date.now()
    await d1.batch([
      d1
        .prepare(
          `INSERT INTO push_subscriptions (user_id, session_id, endpoint, p256dh, auth, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)
           ON CONFLICT (endpoint) DO UPDATE SET user_id = ?1, session_id = ?2, p256dh = ?4,
             auth = ?5, failures = 0`,
        )
        .bind(userId, sid, body.endpoint, body.keys.p256dh, body.keys.auth, now),
      // A browser that subscribes without settings gets the default ones.
      d1
        .prepare(
          `UPDATE user_sessions SET alerts = ?3 WHERE id = ?1 AND user_id = ?2 AND alerts IS NULL`,
        )
        .bind(sid, userId, JSON.stringify({ ...readDeviceAlerts(null), tz: body.tz ?? null })),
    ])
    await devicesChanged(c, userId)
    return c.body(null, 204)
  })

  .delete('/subscription', requireActiveSession, async (c) => {
    const userId = c.get('userId')
    const { endpoint } = await parseJson(c, z.object({ endpoint: z.string().max(2048) }))
    await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE user_id = ?1 AND endpoint = ?2')
      .bind(userId, endpoint)
      .run()
    await devicesChanged(c, userId)
    return c.body(null, 204)
  })

  /** A test notification to this browser (its text comes from the page, in its language). */
  .post('/test', requireActiveSession, async (c) => {
    requirePush(c)
    const userId = c.get('userId')
    await rateLimit(c.env.AUTH_LIMITER, `push-test:${userId}`)
    const message = await parseJson(
      c,
      z.object({ title: z.string().min(1).max(80), body: z.string().max(200) }),
    )
    const results = await liveHub(c.env, userId).testPush(userId, c.get('sessionId')!, message)
    return c.json({ sent: results.filter((r) => r === 'ok').length, results })
  })

// ------------------------------------------------------------------ Capture

/** A Capture's owner, its session row (null with a key) and what that row says. */
async function captureOf(c: Context<AppEnv>, limiter: RateLimit | undefined, bucket: string) {
  const token = bearerToken(c)
  if (!token) {
    return {
      owner: (await keyOwner(c, limiter)) as UploadOwner,
      sid: null,
      device: 'Capture',
      alerts: null,
      whoami: undefined,
      known: null,
    }
  }
  const claims = await readAccessToken(c, token)
  if (claims === 'expired') throw new ApiError(401, 'token_expired', 'Access token expired')
  if (claims === 'invalid') throw new ApiError(401, 'invalid_token', 'Not an irminsul token')
  await rateLimit(limiter, `irminsul-${bucket}:${claims.sid}`)
  // The session's own columns come with the owner's lookup: one round trip.
  const { owner, session } = await sessionOwnerWith(c, claims)
  return {
    owner,
    sid: claims.sid,
    device: session.device_name || 'Capture',
    alerts: session.alerts ? readDeviceAlerts(JSON.parse(session.alerts)) : null,
    // What the row says of the program, to tell when a heartbeat says otherwise.
    known: { version: session.client_version, platform: session.client_platform },
    // What GET /whoami answers, from the row read anyway: Capture needs no whoami poll.
    whoami: whoamiOf(pageOrigin(c.env, c.req.url), claims.sid, session),
  }
}

/** The account a Capture's UID is (its one account, else the user's account with that UID). */
function accountOf(owner: UploadOwner, uid: string | null) {
  if (owner.scope === 'account') return owner.account
  return uid ? pickByUid(owner.accounts, uid) : null
}

export const captureLink = new Hono<AppEnv>().post('/presence', async (c) => {
  const { owner, sid, device, alerts, whoami, known } = await captureOf(
    c,
    c.env.LIVE_LIMITER,
    'presence',
  )
  const body = await parseJson(c, presenceRequest)
  // The program's version and platform are kept on its sign-in's row, for the
  // staff Insights page (Client programs). Written only when a heartbeat says
  // something new: about once per device per update, never per heartbeat.
  const version = body.app ?? null
  const platform = body.platform ?? null
  if (
    sid !== null &&
    known &&
    (version !== null || platform !== null) &&
    ((version ?? known.version) !== known.version ||
      (platform ?? known.platform) !== known.platform)
  ) {
    const write = c.env.DB.prepare(
      `UPDATE user_sessions SET
         client_version_at = CASE WHEN ?2 IS NOT NULL AND client_version IS NOT ?2 THEN ?4
           ELSE client_version_at END,
         client_version = coalesce(?2, client_version),
         client_platform = coalesce(?3, client_platform)
       WHERE id = ?1`,
    )
      .bind(sid, version, platform, Date.now())
      .run()
      .catch((error: unknown) => console.warn('client_version_failed', String(error)))
    try {
      c.executionCtx.waitUntil(write)
    } catch {
      // No execution context (a direct app.fetch): the write still runs.
    }
  }
  const uid = body.uid ? String(body.uid) : null
  const account = accountOf(owner, uid)
  const userId = uploaderUserId(owner)
  await liveHub(c.env, userId).presence(userId, {
    sid,
    device,
    state: body.state,
    accountId: account?.id ?? null,
    uid,
    platform: body.platform ?? null,
    app: body.app ?? null,
  })
  c.header('Cache-Control', 'no-store')
  // `commands` is always empty (website commands were removed on 2026-11-26);
  // released Capture builds still read the field.
  return c.json<PresenceResponse>({
    next: IDLE_NEXT_S,
    commands: [],
    alerts,
    ...(whoami ? { whoami } : {}),
  })
})

// ------------------------------------------------------------------ the website, per account

const reading = z.object({
  value: z.number().int().min(0).max(2_000),
  at: z.number().int().positive(),
})
const ms = z.number().int().positive()

/** The facts the Planner knows (services/alerts.ts `AccountFacts`, the parts a page can tell). */
const alertFactsRequest = z
  .object({
    resin: reading,
    clock: z.object({
      value: z.number().int().min(0).max(2_000),
      nextAt: z.number().int().positive(),
    }),
    manual: reading.nullable(),
    expeditions: z.object({ doneAt: z.array(ms).max(20), at: ms }),
    welkin: z.object({ days: z.number().int().min(0).max(1_000), at: ms }),
    commissions: z.object({
      finished: z.number().int().min(0).max(10),
      total: z.number().int().min(0).max(10),
      at: ms,
    }),
    bargains: z.object({ bought: z.boolean(), at: ms }),
    ticks: z.object({ commissions: ms, bargains: ms }).partial(),
  })
  .partial()
  .strict()

export const accountLink = new Hono<AppEnv>()
  .use(requireUser)

  .get('/:id/presence', async (c) => {
    const account = await loadAccount(getDb(c.env.DB), c.get('userId'), idParam(c, 'id'), 'view')
    // Presence lives in the owner's hub: their Capture.
    const owner = account.userId
    c.header('Cache-Control', 'no-store')
    return c.json<PresenceResponseForAccount>(await liveHub(c.env, owner).presenceOf(account.id))
  })

  /**
   * Website commands were removed on 2026-11-26 (the owner's decision). An old
   * cached page's "Sync wishes" / "Take snapshot" gets the refusal it already
   * knew (its "not sent" toast); nothing is queued.
   */
  .post('/:id/capture-command', () => {
    throw new ApiError(409, 'not_playing', 'Capture is not playing this account')
  })

  /** What the Planner knows about the account, for alerts (only hubs that want it hear). */
  .post('/:id/alert-facts', async (c) => {
    const id = idParam(c, 'id')
    const account = await loadAccount(getDb(c.env.DB), c.get('userId'), id, 'edit')
    await rateLimit(c.env.IMPORT_LIMITER, `alert-facts:${id}`)
    const update = (await parseJson(c, alertFactsRequest)) as FactsUpdate
    const listeners = listenerOf(await listenerStatement(c.env.DB, id).all())
    if (!listeners?.some((l) => l.alerts)) return c.json({ ok: true, alerts: false })
    tellAlertFacts(c, listeners, id, {
      ...update,
      name: account.name,
      uid: account.uid,
      server: account.server,
    })
    return c.json({ ok: true, alerts: true })
  })
