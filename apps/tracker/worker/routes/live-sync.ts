/**
 * Live sync routes (docs/plans/live-sync.md; contract §13).
 *
 * - `POST /api/irminsul/changes` (`liveChanges`, mounted before the
 *   Bearer-only irminsul router): one GOOD-X delta from irminsul, by its
 *   Bearer token or its import key (lib/uploader), routed by the batch's
 *   `uid` like an import. Answers per §13: stored (`collapse`, `watching`),
 *   a duplicate, `live: false` (the account's live sync is off), 409
 *   `resync`, 429 `daily_live_limit`.
 * - `POST /api/irminsul/attach` (Capture 1.17.21, @gdt/shared live/attach):
 *   the endgame parts the game sends only when a screen is opened, written
 *   into the session's newest snapshot (services/attach).
 * - `GET/DELETE /api/accounts/:id/live` and `/points` (`liveAccounts`): the
 *   owner's journal and chart points, and deleting them.
 */

import {
  ATTACH_MAX_BYTES,
  MAX_DELTA_BYTES,
  attachRequestSchema,
  goodDeltaSchema,
  normalizeEndgame,
  type AttachResponse,
  type LiveChangesResponse,
  type LiveJournalResponse,
  type LivePointsResponse,
} from '@gdt/shared'
import { Hono, type Context } from 'hono'
import { getDb } from '../db/client'
import type { AppEnv } from '../env'
import { bodyEtag } from '../lib/etag'
import { ApiError, idParam } from '../lib/http'
import { requireUser } from '../lib/session'
import { uploaderAccount, uploaderOf, uploaderUserId } from '../lib/uploader'
import { loadAccount } from '../services/accounts'
import {
  anyListening,
  listenerOf,
  listenerStatement,
  notifyAccount,
  notifyAccountLater,
  tellAlertFacts,
} from '../services/live'
import { deltaFacts } from '../services/alerts'
import { attachEndgame } from '../services/attach'
import {
  deleteJournalStatements,
  deletePointsStatements,
  liveDb,
  readJournal,
  readPoints,
  storeBatch,
} from '../services/live-sync'
import { utcDay } from '../services/upload-limits'

/** The request body as text, refused past `max` bytes (gzip allowed). */
async function readBodyText(
  c: Context<AppEnv>,
  max: number,
  tooLarge: () => ApiError,
): Promise<string> {
  const declared = Number(c.req.header('content-length') ?? 0)
  if (declared > max) throw tooLarge()
  const body = c.req.raw.body
  if (!body) throw new ApiError(400, 'invalid_json', 'Expected a JSON body')
  const gzip = c.req.header('content-encoding') === 'gzip'
  const reader = (gzip ? body.pipeThrough(new DecompressionStream('gzip')) : body).getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > max) {
      await reader.cancel()
      throw tooLarge()
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    bytes.set(chunk, at)
    at += chunk.length
  }
  return new TextDecoder().decode(bytes)
}

/** The request body as text, refused past MAX_DELTA_BYTES (gzip allowed). */
function readDeltaText(c: Context<AppEnv>): Promise<string> {
  return readBodyText(
    c,
    MAX_DELTA_BYTES,
    () =>
      new ApiError(413, 'batch_too_large', 'A batch is at most 512 KB: send a snapshot instead'),
  )
}

export const liveChanges = new Hono<AppEnv>().post('/changes', async (c) => {
  const owner = await uploaderOf(c, c.env.LIVE_LIMITER, 'live')
  let input: unknown
  try {
    input = JSON.parse(await readDeltaText(c))
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(400, 'invalid_json', 'The batch is not valid JSON')
  }
  const parsed = goodDeltaSchema.safeParse(input)
  if (!parsed.success) {
    throw new ApiError(400, 'invalid_batch', parsed.error.issues[0]?.message ?? 'Invalid batch')
  }
  const delta = parsed.data
  const live = liveDb(c.env)
  // A UID the user has no account for yet: its first snapshot makes one.
  const account = uploaderAccount(owner, String(delta.uid))
  if (!account) throw new ApiError(409, 'resync', 'No account for this UID yet: send a snapshot')
  if (!live) {
    return c.json<LiveChangesResponse>({ ok: false, live: false })
  }
  const userId = uploaderUserId(owner)
  const [stored, listening] = await Promise.all([
    storeBatch(live, { id: account.id, userId: account.user_id ?? userId }, delta),
    listenerStatement(c.env.DB, account.id).all(),
  ])
  if (stored.duplicate) {
    return c.json<LiveChangesResponse>({ ok: true, duplicate: true, seq: stored.seq })
  }
  const listeners = listenerOf(listening)
  const watching = anyListening(listeners)
  tellAlertFacts(c, listeners, account.id, {
    ...deltaFacts(delta.changes, delta.at, undefined),
    name: account.name,
    uid: account.uid,
    server: account.server,
  })
  if (watching)
    notifyAccount(c, listeners, {
      type: 'live',
      accountId: account.id,
      seq: stored.seq,
      ...(stored.batch ? { batch: stored.batch } : {}),
    })
  return c.json<LiveChangesResponse>({
    ok: true,
    seq: stored.seq,
    collapse: stored.collapse,
    watching,
  })
})

liveChanges.post('/attach', async (c) => {
  const owner = await uploaderOf(c, c.env.LIVE_LIMITER, 'attach')
  let input: unknown
  try {
    input = JSON.parse(
      await readBodyText(
        c,
        ATTACH_MAX_BYTES,
        () => new ApiError(413, 'attach_too_large', 'An attach is at most 128 KB'),
      ),
    )
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(400, 'invalid_json', 'The attach is not valid JSON')
  }
  const parsed = attachRequestSchema.safeParse(input)
  if (!parsed.success) {
    throw new ApiError(400, 'invalid_attach', parsed.error.issues[0]?.message ?? 'Invalid attach')
  }
  const endgame = normalizeEndgame(parsed.data.gi_endgame)
  if (!endgame) throw new ApiError(400, 'invalid_endgame', 'gi_endgame has nothing valid in it')
  const account = uploaderAccount(owner, String(parsed.data.uid))
  if (!account) throw new ApiError(404, 'no_snapshot', 'No account for this UID yet')
  const attached = await attachEndgame(c.env.DB, account.id, parsed.data.session, endgame)
  if (attached.dataVersion !== null) {
    notifyAccount(
      c,
      attached.listeners,
      {
        type: 'data',
        accountId: account.id,
        dataVersion: attached.dataVersion,
        takenAt: attached.takenAt,
      },
      uploaderUserId(owner),
    )
  }
  return c.json<AttachResponse>({
    ok: true,
    snapshotId: attached.snapshotId,
    takenAt: attached.takenAt,
    dataVersion: attached.dataVersion ?? 0,
    stored: attached.stored,
  })
})

const DAY = /^\d{4}-\d{2}-\d{2}$/

export const liveAccounts = new Hono<AppEnv>()
  .use(requireUser)

  /** The open journal, merged; ETag = base + seq. Live sync off: `open: false`. */
  .get('/:id/live', async (c) => {
    const account = await loadAccount(getDb(c.env.DB), c.get('userId'), idParam(c, 'id'), 'view')
    const live = liveDb(c.env)
    c.header('Cache-Control', 'private, no-cache')
    if (!live) {
      return c.json<LiveJournalResponse>({ open: false })
    }
    const { response, etag } = await readJournal(live, account.id)
    c.header('ETag', etag)
    const match = c.req.header('if-none-match')
    if (match && match.split(/\s*,\s*/).includes(etag)) return c.body(null, 304)
    return c.json<LiveJournalResponse>(response)
  })

  /** Ends the open journal: the pages show the newest snapshot again. */
  .delete('/:id/live', async (c) => {
    const account = await loadAccount(getDb(c.env.DB), c.get('userId'), idParam(c, 'id'), 'own')
    const live = liveDb(c.env)
    if (live) await live.batch(deleteJournalStatements(live, account.id))
    notifyAccountLater(c, account.id, { type: 'live', accountId: account.id, seq: 0 })
    return c.body(null, 204)
  })

  /** Chart points, `?from=YYYY-MM-DD&to=YYYY-MM-DD` (UTC days; default: the last 400 days). */
  .get('/:id/points', async (c) => {
    const account = await loadAccount(getDb(c.env.DB), c.get('userId'), idParam(c, 'id'), 'view')
    const live = liveDb(c.env)
    const today = utcDay(Date.now())
    const from = DAY.test(c.req.query('from') ?? '')
      ? c.req.query('from')!
      : utcDay(Date.now() - 400 * 86_400_000)
    const to = DAY.test(c.req.query('to') ?? '') ? c.req.query('to')! : today
    const points = live ? await readPoints(live, account.id, from, to) : []
    const body = JSON.stringify({ points } satisfies LivePointsResponse)
    const etag = await bodyEtag('points', body)
    c.header('ETag', etag)
    c.header('Cache-Control', 'private, no-cache')
    const match = c.req.header('if-none-match')
    if (match && match.split(/\s*,\s*/).includes(etag)) return c.body(null, 304)
    c.header('Content-Type', 'application/json; charset=utf-8')
    return c.body(body)
  })

  /** Deletes chart points: `?day=YYYY-MM-DD` one day, without it every day. */
  .delete('/:id/points', async (c) => {
    const account = await loadAccount(getDb(c.env.DB), c.get('userId'), idParam(c, 'id'), 'own')
    const day = c.req.query('day')
    if (day !== undefined && !DAY.test(day)) {
      throw new ApiError(400, 'invalid_day', 'day is YYYY-MM-DD')
    }
    const live = liveDb(c.env)
    if (live) await live.batch(deletePointsStatements(live, account.id, day))
    notifyAccountLater(c, account.id, { type: 'live', accountId: account.id, seq: 0 })
    return c.body(null, 204)
  })
