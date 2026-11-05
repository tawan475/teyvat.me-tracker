/**
 * Live updates: one Durable Object per user holds the sockets of that user's
 * browsers (one per browser: its tabs elect one to hold it) and fans every
 * change out to them.
 *
 * Built to cost as little as possible:
 * - Sockets use the WebSocket Hibernation API: while nothing happens the
 *   object is evicted from memory and an open socket costs nothing. The rare
 *   keep-alive `ping` is answered by an auto-response, which does not wake it.
 * - `users.live_since` says whether anyone is listening: the hub sets it when
 *   its first socket opens and clears it when the last one closes (or when an
 *   event finds none left). Writes read it in the batch they already send and
 *   skip the hub when it is NULL, so an upload while no page is open costs
 *   no Durable Object request at all.
 * - On connect the hub reads, in that same one D1 round trip, the session's
 *   current token version and each account's version and names, and sends
 *   them as `hello`: a tab re-reads the account list only if something moved
 *   while it had no socket.
 * - Writes notify after their own D1 batch, in `waitUntil` (the response never
 *   waits; a failure is only logged).
 *
 * Sessions: a socket is authorised once, by the access cookie at the upgrade,
 * and keeps the session's token version and row (the access token's `ver`
 * and `sid`). Ending sessions (sign out everywhere, a password change) bumps
 * the version in D1 and tells the hub, awaited, which closes every socket of
 * an older version (4003); a connect with an older version is refused, and
 * every import's event carries the current version too, so a socket never
 * outlives a revoked session. Ending one session (signing a device out)
 * revokes its row and tells the hub, which closes that session's sockets; a
 * connect for a revoked row is refused. On a 4003 the page refreshes its
 * session and signs out if that fails.
 */

import {
  LIVE_SESSION_ENDED_CLOSE,
  type CaptureCommandKind,
  type LiveAccount,
  type LiveEvent,
  type PresenceResponseForAccount,
} from '@gdt/shared'
import { DurableObject } from 'cloudflare:workers'
import type { Context } from 'hono'
import type { AppEnv } from '../env'
import { readBookmark, requestBookmarks } from '../lib/d1-session'
import type { PushResult, VapidVars } from '../lib/web-push'
import {
  addFacts,
  fire,
  heartbeat,
  presenceFor,
  queueCommand,
  reloadDevices,
  rememberUser,
  schedule,
  sendTest,
  type Command,
  type FireReport,
  type Heartbeat,
  type HubContext,
} from './alert-hub'
import type { FactsUpdate } from './alerts'

/** Close code for a socket whose session was ended: reconnect only with a fresh one. */
export const SESSION_ENDED_CLOSE = LIVE_SESSION_ENDED_CLOSE

/** How long a revoked session is remembered against a connect already past its D1 read. */
const REVOKED_MEMORY_MS = 60_000

interface Attachment {
  userId: number
  /** The session's token version when the socket opened. */
  ver: number
  /** Its session row (`user_sessions.id`); null for a token from before rows. */
  sid?: number | null
  /** When it connected (ms); sockets from before this field count as connected long ago. */
  at?: number
}

/**
 * Capture's heartbeat interval (s): short while a page is in view, so a
 * command from the site is picked up soon; long otherwise (most of the day a
 * tab sits in the background: every 15 s was 6,000 requests a day per PC;
 * 120 s idle was still ~40% of the Worker's requests, 2026-11-02).
 */
export const WATCHED_NEXT_S = 30
export const IDLE_NEXT_S = 300
/**
 * A socket counts as in view while it connected or pinged this recently: a
 * visible tab pings every 5 minutes (src/live/policy.ts PING_MS), a hidden
 * one never.
 */
const IN_VIEW_MS = 6 * 60_000

/** One user who can see an account (its owner or a member), as a write's batch read them. */
export interface Listener {
  userId: number
  live: boolean
  tokenVersion: number
  /** A device of theirs has alerts on (`users.alerts_on`): the hub wants the facts. */
  alerts?: boolean
}

export class LiveHub extends DurableObject<Env> {
  /** Upgrades being checked: they count as listening, so the flag stays set under them. */
  private connecting = 0
  /** Events sent while an upgrade was being checked, for the socket it opens. */
  private backlog: string[] = []
  /** `live_since` as this instance last wrote it (null: not known since it woke). */
  private flag: boolean | null = null
  /** Flag writes run one after another, each deciding on the sockets as they are then. */
  private chain: Promise<unknown> = Promise.resolve()
  /**
   * Sessions revoked lately (sid → when): a connect whose D1 read still saw
   * one active, before the revoke arrived, is refused when it gets to
   * accepting its socket.
   */
  private revoked = new Map<number, number>()
  /** Events this instance was asked to send since it woke (diagnostics and tests). */
  notified = 0

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  /** The upgrade, forwarded by `GET /api/live` once it has checked the access cookie. */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 })
    }
    const userId = Number(request.headers.get('x-gdt-user'))
    const ver = numberHeader(request, 'x-gdt-token-version')
    const sid = numberHeader(request, 'x-gdt-session')
    this.connecting++
    let accepted = false
    try {
      // One round trip: mark the user as listening, read the session (its
      // version and row) and what the tab needs to tell whether it missed
      // anything.
      const now = Date.now()
      // On the primary (it writes); its bookmark goes in `hello`, so a page
      // that re-reads what hello says changed reads a replica that has it.
      const db = this.env.DB.withSession('first-primary')
      const [, user, accounts] = await this.serial(async () => {
        const results = await db.batch<Record<string, unknown>>([
          db
            .prepare('UPDATE users SET live_since = ?2 WHERE id = ?1 AND live_since IS NULL')
            .bind(userId, now),
          db
            .prepare(
              `SELECT u.token_version, s.id AS sid FROM users AS u
             LEFT JOIN user_sessions AS s ON s.id = ?2 AND s.user_id = u.id
               AND s.revoked_at IS NULL AND s.expires_at > ?3
             WHERE u.id = ?1`,
            )
            .bind(userId, sid, now),
          db
            .prepare(
              `SELECT id, data_version, name, uid, server FROM genshin_accounts
             WHERE user_id = ?1 ORDER BY id`,
            )
            .bind(userId),
        ])
        this.flag = true
        return results
      })
      const row = user!.results[0]
      const current = row?.token_version
      // A token from before its session was ended. (A token from before
      // access tokens carried a version is taken at the current one; one
      // from before session rows goes by its version alone.)
      if (typeof current !== 'number' || (ver !== null && !(ver >= current))) {
        return new Response('Session ended', { status: 401 })
      }
      // Its row revoked, or revoked while this connect was reading it.
      if (sid !== null && (row!.sid !== sid || this.revoked.has(sid))) {
        return new Response('Session ended', { status: 401 })
      }

      const pair = new WebSocketPair()
      const [client, server] = [pair[0], pair[1]]
      this.ctx.acceptWebSocket(server)
      server.serializeAttachment({
        userId,
        ver: ver ?? current,
        sid,
        at: Date.now(),
      } satisfies Attachment)
      const bookmark = readBookmark(db.getBookmark())
      const hello: LiveEvent = {
        type: 'hello',
        ...(bookmark ? { d1: bookmark } : {}),
        accounts: accounts!.results.map(
          (row): LiveAccount => ({
            id: row.id as number,
            dataVersion: row.data_version as number,
            name: row.name as string | null,
            uid: row.uid as string | null,
            server: row.server as LiveAccount['server'],
          }),
        ),
      }
      server.send(JSON.stringify(hello))
      for (const text of this.backlog) server.send(text)
      accepted = true
      return new Response(null, { status: 101, webSocket: client })
    } finally {
      this.connecting--
      if (this.connecting === 0) this.backlog = []
      if (!accepted) await this.release(userId)
    }
  }

  /**
   * Sends `event` to every open socket; one of a session older than
   * `tokenVersion` is closed instead. Answers how many got it.
   */
  async notify(userId: number, event: LiveEvent, tokenVersion?: number): Promise<number> {
    this.notified++
    const text = JSON.stringify(event)
    let sent = 0
    for (const socket of this.ctx.getWebSockets()) {
      const { ver } = attachment(socket)
      try {
        if (tokenVersion !== undefined && ver < tokenVersion) {
          socket.close(SESSION_ENDED_CLOSE, 'session ended')
          continue
        }
        socket.send(text)
        sent++
      } catch {
        // Already closing; its tab reconnects on its own.
      }
    }
    if (this.connecting > 0) this.backlog.push(text)
    // Nobody left (a stale flag after a crash): stop the writes calling.
    if (sent === 0) await this.release(userId)
    return sent
  }

  /**
   * Closes every socket of a session older than `tokenVersion` (the user's
   * sessions were ended), but `keep`'s: the device that ended the others
   * stays connected, at the new version.
   */
  async revoke(userId: number, tokenVersion: number, keep?: number | null): Promise<void> {
    for (const socket of this.ctx.getWebSockets()) {
      const current = attachment(socket)
      if (current.ver >= tokenVersion) continue
      try {
        if (keep != null && current.sid === keep) {
          socket.serializeAttachment({ ...current, ver: tokenVersion } satisfies Attachment)
        } else {
          socket.close(SESSION_ENDED_CLOSE, 'session ended')
        }
      } catch {
        // Already closing.
      }
    }
    await this.release(userId)
  }

  /** Closes the sockets of one session (that device was signed out). */
  async revokeSession(userId: number, sid: number): Promise<void> {
    const now = Date.now()
    for (const [id, at] of this.revoked) if (at < now - REVOKED_MEMORY_MS) this.revoked.delete(id)
    this.revoked.set(sid, now)
    for (const socket of this.ctx.getWebSockets()) {
      if (attachment(socket).sid !== sid) continue
      try {
        socket.close(SESSION_ENDED_CLOSE, 'session ended')
      } catch {
        // Already closing.
      }
    }
    await this.release(userId)
  }

  /** How many sockets are open (tests and diagnostics). */
  async sockets(): Promise<number> {
    return this.open().length
  }

  // ---------------------------------------------------------------- alerts and presence
  // (services/alert-hub.ts, docs/plans/capture-link.md)

  /** Clock and fetch, swapped by tests. */
  clock: () => number = () => Date.now()
  fetcher: typeof fetch | undefined

  private get hub(): HubContext {
    return {
      storage: this.ctx.storage,
      db: this.env.DB,
      vars: this.env as unknown as VapidVars,
      now: this.clock,
      fetcher: this.fetcher,
    }
  }

  /** A write told the facts alerts are worked out from: keep them, move the alarm. */
  async alertFacts(userId: number, accountId: number, update: FactsUpdate): Promise<void> {
    await rememberUser(this.hub, userId)
    await addFacts(this.hub, accountId, update)
    await schedule(this.hub)
  }

  /** A device's alerts or push subscription changed: read them again, move the alarm. */
  async devicesChanged(userId: number): Promise<void> {
    await rememberUser(this.hub, userId)
    await reloadDevices(this.hub, userId)
    await schedule(this.hub)
  }

  /** The alarm: send what is due. */
  override async alarm(): Promise<void> {
    const report: FireReport = await fire(this.hub)
    if (report.sent || report.gone || report.failed) console.log('alerts', JSON.stringify(report))
  }

  /** Runs the alarm now (tests). */
  async fireNow(): Promise<FireReport> {
    return fire(this.hub)
  }

  /** When the alarm is set (tests). */
  async alarmAt(): Promise<number | null> {
    return this.ctx.storage.getAlarm()
  }

  async testPush(
    userId: number,
    sid: number,
    message: { title: string; body: string },
  ): Promise<PushResult[]> {
    return sendTest(this.hub, userId, sid, message)
  }

  /**
   * A Capture's heartbeat: kept, and the commands waiting for it handed
   * over. Pages showing an account whose presence changed are told.
   * `next`: seconds to its next heartbeat (sooner while a page is in view).
   */
  async presence(
    userId: number,
    beat: Heartbeat,
  ): Promise<{ commands: Pick<Command, 'id' | 'kind'>[]; next: number }> {
    const { commands, changed } = await heartbeat(this.hub, beat)
    for (const accountId of changed) await this.tellPresence(userId, accountId)
    return {
      commands: commands.map(({ id, kind }) => ({ id, kind })),
      next: this.inView() ? WATCHED_NEXT_S : IDLE_NEXT_S,
    }
  }

  async presenceOf(accountId: number): Promise<PresenceResponseForAccount> {
    return presenceFor(this.hub, accountId)
  }

  /** The website asks the Capture playing `accountId` to do something; null when none plays it. */
  async command(
    userId: number,
    accountId: number,
    kind: CaptureCommandKind,
  ): Promise<PresenceResponseForAccount | null> {
    const answer = await queueCommand(this.hub, accountId, kind)
    if (answer) await this.tellPresence(userId, accountId, answer)
    return answer
  }

  private async tellPresence(
    userId: number,
    accountId: number,
    state?: PresenceResponseForAccount,
  ): Promise<void> {
    if (this.open().length === 0) return
    await this.notify(userId, {
      type: 'presence',
      accountId,
      ...(state ?? (await presenceFor(this.hub, accountId))),
    })
  }

  override async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    // Only the keep-alive is expected, and the auto-response normally answers it.
    if (message !== 'ping') return
    try {
      socket.send('pong')
    } catch {
      // Closing already: an uncaught throw here counts as the hub's exception.
    }
  }

  override async webSocketClose(socket: WebSocket, code: number, reason: string) {
    try {
      // 1005 / 1006 mean "no code" and may not be sent back.
      socket.close(code === 1005 || code === 1006 ? 1000 : code, reason)
    } catch {
      // Already closed (the runtime answers the close itself).
    }
    await this.release(attachment(socket).userId, socket)
  }

  override async webSocketError(socket: WebSocket) {
    try {
      socket.close(1011, 'error')
    } catch {
      // Already closed.
    }
    await this.release(attachment(socket).userId, socket)
  }

  /** Whether some page of the user's is in view (connected or pinged lately). */
  private inView(): boolean {
    const since = Date.now() - IN_VIEW_MS
    return this.open().some((ws) => {
      const pinged = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0
      return Math.max(attachment(ws).at ?? 0, pinged) > since
    })
  }

  private open(except?: WebSocket): WebSocket[] {
    return this.ctx
      .getWebSockets()
      .filter((ws) => ws !== except && ws.readyState === WebSocket.OPEN)
  }

  /** Clears `live_since` when nobody is listening any more (`closing` is on its way out). */
  private release(userId: number, closing?: WebSocket): Promise<void> {
    return this.serial(async () => {
      if (this.connecting > 0 || this.open(closing).length > 0 || this.flag === false) return
      if (!Number.isSafeInteger(userId) || userId <= 0) return
      await this.env.DB.prepare('UPDATE users SET live_since = NULL WHERE id = ?1')
        .bind(userId)
        .run()
      this.flag = false
    }).catch((error: unknown) => console.warn('live_flag_failed', String(error)))
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.chain.then(work, work)
    this.chain = run.catch(() => undefined)
    return run
  }
}

function attachment(socket: WebSocket): Attachment {
  try {
    return (socket.deserializeAttachment() ?? { userId: 0, ver: 0 }) as Attachment
  } catch {
    // Unreadable: treated like none (user 0 is never released or notified).
    return { userId: 0, ver: 0 }
  }
}

/** A whole-number header the Worker set, or null when empty or absent. */
function numberHeader(request: Request, name: string): number | null {
  const value = request.headers.get(name)
  if (value === null || value === '') return null
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : null
}

/** The user's hub: one Durable Object per user, by id. */
export function liveHub(env: Env, userId: number): DurableObjectStub<LiveHub> {
  return env.LIVE.get(env.LIVE.idFromName(String(userId)))
}

/**
 * Reads, in a write's own batch, everyone who can see the account (its owner
 * and accepted members: account sharing), whether each has anyone listening
 * and their session version (see `listenerOf`).
 */
export function listenerStatement(d1: D1Database, accountId: number): D1PreparedStatement {
  return d1
    .prepare(
      `SELECT u.id AS user_id, u.live_since, u.token_version, u.alerts_on FROM users AS u
       WHERE u.id IN (SELECT user_id FROM genshin_accounts WHERE id = ?1
                      UNION ALL
                      SELECT user_id FROM account_members WHERE account_id = ?1
                        AND accepted_at IS NOT NULL)`,
    )
    .bind(accountId)
}

/** The rows of `listenerStatement` (undefined when the account is gone). */
export function listenerOf(result: D1Result | undefined): Listener[] | undefined {
  const rows = (result?.results ?? []) as {
    user_id?: unknown
    live_since?: unknown
    token_version?: unknown
    alerts_on?: unknown
  }[]
  const listeners = rows
    .filter((row) => typeof row.user_id === 'number' && typeof row.token_version === 'number')
    .map((row) => ({
      userId: row.user_id as number,
      live: row.live_since !== null && row.live_since !== undefined,
      tokenVersion: row.token_version as number,
      alerts: row.alerts_on !== null && row.alerts_on !== undefined,
    }))
  return listeners.length ? listeners : undefined
}

/** Whether anyone who can see the account has a page open. */
export const anyListening = (listeners: Listener[] | undefined): boolean =>
  listeners?.some((l) => l.live) ?? false

/** The tab that sent a write (`x-gdt-tab`), echoed in its live event so that tab skips it. */
export function senderTab(c: Context<AppEnv>): { tab?: string } {
  const tab = c.req.header('x-gdt-tab')
  return tab && /^[A-Za-z0-9_-]{1,40}$/.test(tab) ? { tab } : {}
}

/**
 * Tells the user's open pages that something changed, after the response:
 * never awaited by the request, never failing it. With a `listener` read in
 * the write's batch, nothing is sent when nobody listens, and sockets of an
 * ended session are closed on the way.
 */
export function notifyUser(
  c: Context<AppEnv>,
  userId: number,
  event: LiveEvent,
  listener?: Listener,
): void {
  if (!c.env.LIVE || (listener && !listener.live)) return
  // The write's bookmarks: the page reads from a replica that has it.
  const marked: LiveEvent = { ...event, ...requestBookmarks(c) }
  afterResponse(
    c,
    liveHub(c.env, userId)
      .notify(userId, marked, listener?.tokenVersion)
      .catch((error: unknown) => console.warn('live_notify_failed', String(error))),
  )
}

/**
 * An account's event for everyone who can see it (`listeners`, read in the
 * write's batch: only those listening get it). Without them (none read),
 * `fallback`'s pages get it unchecked, as `notifyUser` sends.
 */
export function notifyAccount(
  c: Context<AppEnv>,
  listeners: Listener[] | undefined,
  event: LiveEvent,
  fallback?: number,
): void {
  if (!listeners) {
    if (fallback !== undefined) notifyUser(c, fallback, event)
    return
  }
  for (const listener of listeners) notifyUser(c, listener.userId, event, listener)
}

/**
 * A device's alerts or push subscription changed: the user's hub reads them
 * again. Awaited, but never failing the request: the change is already in
 * D1, and the hub reads it again at its next fact or alarm.
 */
export async function devicesChanged(c: Context<AppEnv>, userId: number): Promise<void> {
  if (!c.env.LIVE) return
  try {
    await liveHub(c.env, userId).devicesChanged(userId)
  } catch (error) {
    console.error('alerts_hub_failed', String(error), (error as Error)?.stack ?? '')
  }
}

/**
 * Tells the hubs of everyone who can see the account and has alerts on what
 * a write learnt about it (docs/plans/capture-link.md), after the response.
 * Nothing at all when nobody has alerts, or the update says nothing.
 */
export function tellAlertFacts(
  c: Context<AppEnv>,
  listeners: Listener[] | undefined,
  accountId: number,
  update: FactsUpdate,
): void {
  if (!c.env.LIVE || !listeners || Object.keys(update).length === 0) return
  for (const listener of listeners) {
    if (!listener.alerts) continue
    afterResponse(
      c,
      liveHub(c.env, listener.userId)
        .alertFacts(listener.userId, accountId, update)
        .catch((error: unknown) => console.warn('alert_facts_failed', String(error))),
    )
  }
}

/**
 * An account's event when the write read no listeners: reads them after the
 * response (one query, never holding or failing the request).
 */
export function notifyAccountLater(c: Context<AppEnv>, accountId: number, event: LiveEvent): void {
  if (!c.env.LIVE) return
  afterResponse(
    c,
    listenerStatement(c.env.DB, accountId)
      .all()
      .then((result) => notifyAccount(c, listenerOf(result), event))
      .catch((error: unknown) => console.warn('live_notify_failed', String(error))),
  )
}

function afterResponse(c: Context<AppEnv>, work: Promise<unknown>): void {
  try {
    c.executionCtx.waitUntil(work)
  } catch {
    // No execution context (a direct app.fetch in a test): the promise still runs.
  }
}

/**
 * Closes the sockets of the user's ended sessions (older than
 * `tokenVersion`, but `keep`'s). Awaited by the caller and tried twice: this
 * is what keeps a socket from outliving its session. Should both fail, the
 * next import's event, and every connect, still check the version.
 */
export async function revokeLive(
  env: Env,
  userId: number,
  tokenVersion: number,
  keep: number | null = null,
): Promise<void> {
  if (!env.LIVE) return
  await twice('live_revoke_failed', () => liveHub(env, userId).revoke(userId, tokenVersion, keep))
}

/**
 * Closes the sockets of one ended session, like revokeLive. Should both
 * tries fail, every connect still checks the row, and the page learns at its
 * next refresh.
 */
export async function revokeLiveSession(env: Env, userId: number, sid: number): Promise<void> {
  if (!env.LIVE) return
  await twice('live_revoke_session_failed', () => liveHub(env, userId).revokeSession(userId, sid))
}

async function twice(label: string, work: () => Promise<unknown>): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await work()
      return
    } catch (error) {
      if (attempt >= 2) {
        console.error(label, String(error))
        return
      }
    }
  }
}
