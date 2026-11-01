/**
 * The hub's alerts and Capture presence (docs/plans/capture-link.md): what
 * `LiveHub` (services/live.ts) keeps in its storage beside its sockets, one
 * hub per user.
 *
 * Storage keys:
 * - `user`: the user's id (an alarm doesn't say whose hub it is).
 * - `facts:<accountId>`: `AccountFacts`, merged from every write that told it.
 * - `devices`: the user's devices that get alerts by push, as last read from
 *   D1 (only for scheduling; a send reads D1 again).
 * - `sent`: alerts sent (`<sid>|<key>` → when), kept 8 days.
 * - `presence:<sid>`: a Capture's last heartbeat; `commands:<sid>` what the
 *   website asked it to do.
 *
 * One alarm: the earliest alert any device has coming. Sends run in the
 * alarm and only there, so an alert is never sent twice.
 */

import {
  anyAlert,
  readDeviceAlerts,
  type CaptureCommandKind,
  type CapturePresence,
  type DeviceAlerts,
  type PresenceResponseForAccount,
  type PresenceState,
} from '@gdt/shared'
import {
  sendPush,
  vapidKeys,
  type PushResult,
  type PushTarget,
  type VapidVars,
} from '../lib/web-push'
import {
  alertMessage,
  mergeFacts,
  STALE_MS,
  upcomingAlerts,
  type AccountFacts,
  type FactsUpdate,
} from './alerts'

/** A heartbeat older than this: Capture (or the game) is gone (more than two idle beats). */
export const PRESENCE_TTL_MS = 5 * 60_000
/** Sent keys are forgotten after this. */
const SENT_TTL_MS = 8 * 24 * 3_600_000

export interface DeviceRow {
  sid: number
  alerts: DeviceAlerts
}

interface PushRow extends DeviceRow, PushTarget {
  pid: number
}

/** A Capture's presence as the hub keeps it. */
export interface PresenceEntry extends CapturePresence {
  accountId: number | null
  uid: string | null
}

export interface Command {
  id: string
  kind: CaptureCommandKind
  accountId: number
}

/** What the hub needs from its object (its storage, D1, the secrets, the clock). */
export interface HubContext {
  storage: DurableObjectStorage
  db: D1Database
  vars: VapidVars
  now: () => number
  fetcher?: typeof fetch
}

// ------------------------------------------------------------------ facts and devices

export async function rememberUser(hub: HubContext, userId: number): Promise<void> {
  if ((await hub.storage.get<number>('user')) !== userId) await hub.storage.put('user', userId)
}

export async function addFacts(
  hub: HubContext,
  accountId: number,
  update: FactsUpdate,
): Promise<void> {
  const key = `facts:${accountId}`
  const facts = mergeFacts(await hub.storage.get<AccountFacts>(key), update)
  await hub.storage.put(key, facts)
}

/** The user's devices with alerts and a push subscription, one row per subscription. */
async function pushRows(hub: HubContext, userId: number): Promise<PushRow[]> {
  const { results } = await hub.db
    .prepare(
      `SELECT s.id AS sid, s.alerts, p.id AS pid, p.endpoint, p.p256dh, p.auth
       FROM user_sessions AS s JOIN push_subscriptions AS p ON p.session_id = s.id
       WHERE s.user_id = ?1 AND s.revoked_at IS NULL AND s.expires_at > ?2
         AND s.alerts IS NOT NULL`,
    )
    .bind(userId, hub.now())
    .all<{
      sid: number
      alerts: string
      pid: number
      endpoint: string
      p256dh: string
      auth: string
    }>()
  return results
    .map((row) => ({ ...row, alerts: readDeviceAlerts(parseJson(row.alerts)) }))
    .filter((row) => anyAlert(row.alerts))
}

/**
 * Reads the devices again (their settings or subscriptions changed) and keeps
 * them for scheduling; with none left, clears `users.alerts_on` so writes
 * stop telling the hub.
 */
export async function reloadDevices(hub: HubContext, userId: number): Promise<DeviceRow[]> {
  const rows = await pushRows(hub, userId)
  const devices = [...new Map(rows.map((r) => [r.sid, { sid: r.sid, alerts: r.alerts }])).values()]
  await hub.storage.put('devices', devices)
  // D1 refuses a value bound to no placeholder: each query binds what it uses.
  await (
    devices.length
      ? hub.db
          .prepare('UPDATE users SET alerts_on = ?2 WHERE id = ?1 AND alerts_on IS NULL')
          .bind(userId, hub.now())
      : hub.db
          .prepare('UPDATE users SET alerts_on = NULL WHERE id = ?1 AND alerts_on IS NOT NULL')
          .bind(userId)
  ).run()
  return devices
}

async function allFacts(hub: HubContext): Promise<Map<number, AccountFacts>> {
  const out = new Map<number, AccountFacts>()
  for (const [key, facts] of await hub.storage.list<AccountFacts>({ prefix: 'facts:' })) {
    out.set(Number(key.slice('facts:'.length)), facts)
  }
  return out
}

// ------------------------------------------------------------------ the alarm

/**
 * The facts of the accounts the user can still see (their own, or shared and
 * accepted); those of a deleted account or a sharing that ended are dropped,
 * whichever way that happened.
 */
async function visibleFacts(hub: HubContext, userId: number): Promise<Map<number, AccountFacts>> {
  const facts = await allFacts(hub)
  if (facts.size === 0) return facts
  const { results } = await hub.db
    .prepare(
      `SELECT id FROM genshin_accounts WHERE id IN (SELECT value FROM json_each(?2))
         AND (user_id = ?1 OR id IN (SELECT account_id FROM account_members
                                     WHERE user_id = ?1 AND accepted_at IS NOT NULL))`,
    )
    .bind(userId, JSON.stringify([...facts.keys()]))
    .all<{ id: number }>()
  const seen = new Set(results.map((r) => r.id))
  for (const id of facts.keys()) {
    if (seen.has(id)) continue
    facts.delete(id)
    await hub.storage.delete(`facts:${id}`)
  }
  return facts
}

/** Sets the alarm at the earliest alert any device has coming (none: no alarm). */
export async function schedule(hub: HubContext): Promise<number | null> {
  const devices = (await hub.storage.get<DeviceRow[]>('devices')) ?? []
  const sent = (await hub.storage.get<Record<string, number>>('sent')) ?? {}
  const now = hub.now()
  let earliest: number | null = null
  if (devices.length) {
    for (const facts of (await allFacts(hub)).values()) {
      for (const device of devices) {
        for (const alert of upcomingAlerts(facts, device.alerts, now)) {
          if (sent[`${device.sid}|${alert.key}`] !== undefined) continue
          if (earliest === null || alert.at < earliest) earliest = alert.at
        }
      }
    }
  }
  if (earliest === null) await hub.storage.deleteAlarm()
  else await hub.storage.setAlarm(Math.max(earliest, now + 1_000))
  return earliest
}

/** What one alarm did (tests and the log). */
export interface FireReport {
  sent: number
  quiet: number
  gone: number
  failed: number
}

/** Sends every alert due now, then sets the next alarm. */
export async function fire(hub: HubContext): Promise<FireReport> {
  const report: FireReport = { sent: 0, quiet: 0, gone: 0, failed: 0 }
  const userId = await hub.storage.get<number>('user')
  const keys = vapidKeys(hub.vars)
  if (!userId || !keys) {
    await hub.storage.deleteAlarm()
    return report
  }
  const now = hub.now()
  const rows = await pushRows(hub, userId)
  const facts = await visibleFacts(hub, userId)
  const presence = await presences(hub)
  const sent = (await hub.storage.get<Record<string, number>>('sent')) ?? {}
  const gone: number[] = []
  const ok: number[] = []
  const failed: number[] = []
  const bySession = new Map<number, PushRow[]>()
  for (const row of rows) bySession.set(row.sid, [...(bySession.get(row.sid) ?? []), row])
  for (const [sid, subs] of bySession) {
    const alerts = subs[0]!.alerts
    for (const [accountId, account] of facts) {
      for (const alert of upcomingAlerts(account, alerts, now, now - STALE_MS)) {
        const key = `${sid}|${alert.key}`
        if (alert.at > now || sent[key] !== undefined) continue
        sent[key] = now
        if (alerts.quiet && playing(presence, accountId, now)) {
          report.quiet++
          continue
        }
        const message = alertMessage(alert, account, {
          lang: alerts.lang,
          tz: alerts.tz,
          accountId,
          now,
        })
        for (const sub of subs) {
          const result = await sendPush(sub, JSON.stringify(message), keys, {
            topic: message.tag,
            fetcher: hub.fetcher,
          })
          ;(result === 'ok' ? ok : result === 'gone' ? gone : failed).push(sub.pid)
          if (result === 'ok') report.sent++
          else if (result === 'gone') report.gone++
          else report.failed++
        }
      }
    }
  }
  for (const [key, at] of Object.entries(sent)) if (at < now - SENT_TTL_MS) delete sent[key]
  await hub.storage.put('sent', sent)
  await recordResults(hub, { ok, gone, failed })
  await hub.storage.put('devices', [
    ...new Map(rows.map((r) => [r.sid, { sid: r.sid, alerts: r.alerts }])).values(),
  ])
  await schedule(hub)
  return report
}

/** Subscriptions a push service said are gone are deleted; others count their failures. */
async function recordResults(
  hub: HubContext,
  results: { ok: number[]; gone: number[]; failed: number[] },
): Promise<void> {
  const db = hub.db
  const statements: D1PreparedStatement[] = []
  const ids = (list: number[]) => JSON.stringify([...new Set(list)])
  if (results.gone.length) {
    statements.push(
      db
        .prepare('DELETE FROM push_subscriptions WHERE id IN (SELECT value FROM json_each(?1))')
        .bind(ids(results.gone)),
    )
  }
  if (results.ok.length) {
    statements.push(
      db
        .prepare(
          `UPDATE push_subscriptions SET last_ok_at = ?2, failures = 0
           WHERE id IN (SELECT value FROM json_each(?1))`,
        )
        .bind(ids(results.ok), hub.now()),
    )
  }
  if (results.failed.length) {
    // A subscription failing a week of alerts in a row is dead too.
    statements.push(
      db
        .prepare(
          `UPDATE push_subscriptions SET failures = failures + 1
           WHERE id IN (SELECT value FROM json_each(?1))`,
        )
        .bind(ids(results.failed)),
      db.prepare('DELETE FROM push_subscriptions WHERE failures >= 50'),
    )
  }
  if (statements.length) await db.batch(statements)
}

/** A test notification to one device's subscriptions, now. */
export async function sendTest(
  hub: HubContext,
  userId: number,
  sid: number,
  message: { title: string; body: string },
): Promise<PushResult[]> {
  const keys = vapidKeys(hub.vars)
  if (!keys) return []
  const { results } = await hub.db
    .prepare(
      `SELECT p.id AS pid, p.endpoint, p.p256dh, p.auth FROM push_subscriptions AS p
       WHERE p.user_id = ?1 AND p.session_id = ?2`,
    )
    .bind(userId, sid)
    .all<{ pid: number } & PushTarget>()
  const out: PushResult[] = []
  const gone: number[] = []
  for (const sub of results) {
    const result = await sendPush(
      sub,
      JSON.stringify({ ...message, tag: 'test', url: '/app/settings/devices' }),
      keys,
      { fetcher: hub.fetcher },
    )
    if (result === 'gone') gone.push(sub.pid)
    out.push(result)
  }
  await recordResults(hub, { ok: [], gone, failed: [] })
  return out
}

// ------------------------------------------------------------------ presence

async function presences(hub: HubContext): Promise<PresenceEntry[]> {
  const now = hub.now()
  return [...(await hub.storage.list<PresenceEntry>({ prefix: 'presence:' })).values()].filter(
    (p) => p.at > now - PRESENCE_TTL_MS,
  )
}

function playing(list: PresenceEntry[], accountId: number, now: number): boolean {
  return list.some((p) => p.accountId === accountId && p.at > now - PRESENCE_TTL_MS)
}

export interface Heartbeat {
  sid: number | null
  device: string
  state: PresenceState
  accountId: number | null
  uid: string | null
  platform: string | null
  app: string | null
}

/**
 * Keeps a heartbeat and hands over the commands waiting for that Capture.
 * Answers which accounts' presence changed (their pages are told).
 */
export async function heartbeat(
  hub: HubContext,
  beat: Heartbeat,
): Promise<{ commands: Command[]; changed: number[] }> {
  const slot = beat.sid ?? 'key'
  const key = `presence:${slot}`
  const now = hub.now()
  const before = await hub.storage.get<PresenceEntry>(key)
  const was = before && before.at > now - PRESENCE_TTL_MS ? before : undefined
  const changed = new Set<number>()
  if (beat.state === 'stopped') {
    if (before) await hub.storage.delete(key)
    if (was?.accountId != null) changed.add(was.accountId)
  } else {
    const entry: PresenceEntry = {
      sid: beat.sid,
      device: beat.device,
      state: beat.state,
      at: now,
      platform: beat.platform,
      app: beat.app,
      accountId: beat.accountId,
      uid: beat.uid,
    }
    await hub.storage.put(key, entry)
    if (!was || was.state !== entry.state || was.accountId !== entry.accountId) {
      if (was?.accountId != null) changed.add(was.accountId)
      if (entry.accountId != null) changed.add(entry.accountId)
    }
  }
  const commandKey = `commands:${slot}`
  const waiting = (await hub.storage.get<Command[]>(commandKey)) ?? []
  if (waiting.length) {
    await hub.storage.delete(commandKey)
    for (const c of waiting) changed.add(c.accountId)
  }
  // A Capture that stopped takes no commands; they are dropped above.
  return { commands: beat.state === 'stopped' ? [] : waiting, changed: [...changed] }
}

/** The Capture playing `accountId` now (the newest heartbeat) and what waits for it. */
export async function presenceFor(
  hub: HubContext,
  accountId: number,
): Promise<PresenceResponseForAccount> {
  const list = (await presences(hub))
    .filter((p) => p.accountId === accountId)
    .sort((a, b) => b.at - a.at)
  const current = list[0]
  if (!current) return { presence: null, pending: [] }
  const waiting =
    (await hub.storage.get<Command[]>(`commands:${current.sid ?? 'key'}`))?.filter(
      (c) => c.accountId === accountId,
    ) ?? []
  const { accountId: _account, uid: _uid, ...presence } = current
  return { presence, pending: waiting.map((c) => c.kind) }
}

/** Queues a command for the Capture playing `accountId`; null when none is. */
export async function queueCommand(
  hub: HubContext,
  accountId: number,
  kind: CaptureCommandKind,
): Promise<PresenceResponseForAccount | null> {
  const current = (await presences(hub))
    .filter((p) => p.accountId === accountId)
    .sort((a, b) => b.at - a.at)[0]
  if (!current) return null
  const key = `commands:${current.sid ?? 'key'}`
  const waiting = (await hub.storage.get<Command[]>(key)) ?? []
  if (!waiting.some((c) => c.kind === kind && c.accountId === accountId)) {
    waiting.push({ id: crypto.randomUUID().slice(0, 8), kind, accountId })
    await hub.storage.put(key, waiting)
  }
  return presenceFor(hub, accountId)
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
