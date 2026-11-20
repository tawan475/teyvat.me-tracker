/**
 * The staff Metrics page's reads (routes/staff-metrics.ts; README "Staff
 * metrics"). Nothing here runs per user or per request of theirs: every
 * figure is read from state the site keeps anyway, when a staff member opens
 * the page, and kept for a minute in this Worker instance (the day charts
 * for ten), so ten staff refreshing cost one read.
 *
 * - `nowPass`: one pass over `users`, one over the Capture sign-ins and one
 *   over `gdt-live`'s journals. `takeSample` stores it once an hour (the
 *   hourly cron), the only write: one `site_samples` row for the whole site.
 * - `onlineList`: who has the site open or a Capture running, a page at a
 *   time. Each listed user's hub is asked what its Capture last said (at
 *   most METRICS_PAGE_SIZE hub calls a page): never a call per user.
 * - `liveMetrics`, `activityMetrics`, `capacityMetrics`: aggregates.
 */

import {
  CAPTURE_RECENT_MS,
  D1_LIMIT_BYTES,
  LIVE_RECENT_MS,
  METRICS_PAGE_SIZE,
  METRICS_SLOW_TTL_MS,
  METRICS_TTL_MS,
  clientProgram,
  type ActivityRange,
  type CapturePresence,
  type DayCount,
  type GenshinServer,
  type JournalSort,
  type OnlineCapture,
  type OnlineFilter,
  type SiteSample,
  type StaffActivityMetrics,
  type StaffCapacityMetrics,
  type StaffJournalRow,
  type StaffLiveMetrics,
  type StaffNowMetrics,
  type StaffOnlineResponse,
  type StaffOnlineRow,
  type TrendRange,
} from '@gdt/shared'
import { cloudflareUsage, hourFigures, liveRouteCounts, routeRefusals } from './cf-usage'
import { liveHub } from './live'
import { DAILY_BATCHES, liveDb } from './live-sync'
import type { RoleRow, Standing } from './roles'
import { positionOf, roleMap, rolesStatement, seesPrivate } from './staff'
import { utcDay } from './upload-limits'

const HOUR = 3_600_000
const DAY = 86_400_000

// ------------------------------------------------------------------- memo

const kept = new Map<string, { until: number; value: Promise<unknown> }>()

/** One read per `ttl` and key in this Worker instance; a failed read is not kept. */
function memo<T>(key: string, ttl: number, now: number, read: () => Promise<T>): Promise<T> {
  const hit = kept.get(key)
  if (hit && hit.until > now) return hit.value as Promise<T>
  const value = read()
  kept.set(key, { until: now + ttl, value })
  value.catch(() => kept.delete(key))
  if (kept.size > 200) {
    for (const [k, entry] of kept) if (entry.until <= now) kept.delete(k)
  }
  return value
}

/** Forgets every kept read (tests). */
export function forgetMetrics(): void {
  kept.clear()
}

const n = (value: unknown): number => Number(value ?? 0) || 0
const idList = (ids: readonly number[]) => JSON.stringify([...new Set(ids)])

/** The size D1 says the database has after a read (0 when it does not say). */
function sizeOf(results: readonly D1Result<unknown>[] | undefined): number {
  for (const result of [...(results ?? [])].reverse()) {
    const size = (result.meta as { size_after?: number } | undefined)?.size_after
    if (typeof size === 'number' && size > 0) return size
  }
  return 0
}

/** The last `count` UTC days, oldest first, each with `series` at 0. */
function emptyDays(now: number, count: number, series: readonly string[]): DayCount[] {
  const today = Date.parse(`${utcDay(now)}T00:00:00Z`)
  return Array.from({ length: count }, (_, i) => {
    const day: DayCount = { day: utcDay(today - (count - 1 - i) * DAY) }
    for (const name of series) day[name] = 0
    return day
  })
}

// --------------------------------------------------------------- the pass

// A journal row's bytes, as services/live-sync.ts counts them for the quota.
const JOURNAL_BYTES_SQL = 'bytes + coalesce(length(items), 0) + coalesce(length(points), 0)'

interface Pass {
  at: number
  users: number
  online: number
  dau: number
  wau: number
  mau: number
  captureDevices: number
  captureUsers: number
  captureRunning: number
  captureSeen24h: number
  captureSeen7d: number
  captureNew7d: number
  journals: number
  inGame: number
  batchesToday: number
  accountsToday: number
  atCap: number
  tailChanges: number
  oldestOpenedAt: number | null
  journalBytes: number
  dbBytes: number
  liveBytes: number
}

/** Everything the tiles and the hourly reading need: two statements on `gdt`, one on `gdt-live`. */
async function nowPass(env: Env, now: number): Promise<Pass> {
  const live = liveDb(env)
  const [main, journals] = await Promise.all([
    env.DB.batch<Record<string, unknown>>([
      env.DB.prepare(
        `SELECT count(*) AS users, sum(live_since IS NOT NULL) AS online,
           sum(last_active_at >= ?1) AS dau, sum(last_active_at >= ?2) AS wau,
           sum(last_active_at >= ?3) AS mau
         FROM users`,
      ).bind(now - DAY, now - 7 * DAY, now - 30 * DAY),
      env.DB.prepare(
        `SELECT count(*) AS devices, count(DISTINCT user_id) AS users,
           sum(last_seen_at >= ?2) AS running, sum(last_seen_at >= ?3) AS seen24,
           sum(last_seen_at >= ?4) AS seen7, sum(created_at >= ?4) AS new7
         FROM user_sessions
         WHERE method = 'irminsul' AND revoked_at IS NULL AND expires_at > ?1`,
      ).bind(now, now - CAPTURE_RECENT_MS, now - DAY, now - 7 * DAY),
    ]),
    live
      ? live
          .prepare(
            `SELECT count(*) AS journals, sum(updated_at >= ?1) AS active,
               sum(CASE WHEN day = ?2 THEN day_batches ELSE 0 END) AS batches,
               sum(day = ?2 AND day_batches > 0) AS accounts_today,
               sum(day = ?2 AND day_batches >= ?3) AS at_cap,
               sum(tail_changes) AS tail_changes, min(opened_at) AS oldest,
               sum(${JOURNAL_BYTES_SQL}) AS bytes
             FROM live_journals`,
          )
          .bind(now - LIVE_RECENT_MS, utcDay(now), DAILY_BATCHES)
          .all<Record<string, unknown>>()
          .catch((error: unknown) => {
            console.warn('metrics_live_failed', String(error))
            return null
          })
      : Promise.resolve(null),
  ])
  const u = main[0]?.results[0] ?? {}
  const s = main[1]?.results[0] ?? {}
  const j = journals?.results[0] ?? {}
  return {
    at: now,
    users: n(u.users),
    online: n(u.online),
    dau: n(u.dau),
    wau: n(u.wau),
    mau: n(u.mau),
    captureDevices: n(s.devices),
    captureUsers: n(s.users),
    captureRunning: n(s.running),
    captureSeen24h: n(s.seen24),
    captureSeen7d: n(s.seen7),
    captureNew7d: n(s.new7),
    journals: n(j.journals),
    inGame: n(j.active),
    batchesToday: n(j.batches),
    accountsToday: n(j.accounts_today),
    atCap: n(j.at_cap),
    tailChanges: n(j.tail_changes),
    oldestOpenedAt: j.oldest == null ? null : Number(j.oldest),
    journalBytes: n(j.bytes),
    dbBytes: sizeOf(main),
    liveBytes: journals ? sizeOf([journals]) : 0,
  }
}

const passOf = (env: Env, now: number) => memo('pass', METRICS_TTL_MS, now, () => nowPass(env, now))

// ------------------------------------------------------- the hourly reading

function sampleOf(row: Record<string, unknown>): SiteSample {
  return {
    at: n(row.at),
    users: n(row.users),
    online: n(row.online),
    capture: n(row.capture),
    inGame: n(row.in_game),
    journals: n(row.journals),
    batches: n(row.batches),
    dau: n(row.dau),
    wau: n(row.wau),
    mau: n(row.mau),
    dbBytes: n(row.db_bytes),
    liveBytes: n(row.live_bytes),
    cf:
      row.cf_requests == null && row.cf_4xx == null && row.cf_5xx == null
        ? null
        : {
            requests: nullable(row.cf_requests),
            errors: nullable(row.cf_errors),
            cpuMs: nullable(row.cf_cpu_ms),
            http4xx: nullable(row.cf_4xx),
            http429: nullable(row.cf_429),
            http5xx: nullable(row.cf_5xx),
          },
  }
}

const nullable = (value: unknown): number | null => (value == null ? null : Number(value))

/**
 * Stores this hour's reading of the whole site: one row, whatever the number
 * of users (a rerun in the same hour replaces it). The hourly cron calls it.
 */
export async function takeSample(env: Env, now = Date.now()): Promise<SiteSample> {
  const at = Math.floor(now / HOUR) * HOUR
  // Cloudflare's figures for the hour that just ended ride in the same row.
  const [pass, cf] = await Promise.all([nowPass(env, now), hourFigures(env, at).catch(() => null)])
  await env.DB.prepare(
    `INSERT INTO site_samples (at, users, online, capture, in_game, journals, batches, dau, wau,
       mau, db_bytes, live_bytes, cf_requests, cf_errors, cf_cpu_ms, cf_4xx, cf_429, cf_5xx)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
     ON CONFLICT (at) DO UPDATE SET users = excluded.users, online = excluded.online,
       capture = excluded.capture, in_game = excluded.in_game, journals = excluded.journals,
       batches = excluded.batches, dau = excluded.dau, wau = excluded.wau, mau = excluded.mau,
       db_bytes = excluded.db_bytes, live_bytes = excluded.live_bytes,
       cf_requests = excluded.cf_requests, cf_errors = excluded.cf_errors,
       cf_cpu_ms = excluded.cf_cpu_ms, cf_4xx = excluded.cf_4xx, cf_429 = excluded.cf_429,
       cf_5xx = excluded.cf_5xx`,
  )
    .bind(
      at,
      pass.users,
      pass.online,
      pass.captureRunning,
      pass.inGame,
      pass.journals,
      pass.batchesToday,
      pass.dau,
      pass.wau,
      pass.mau,
      pass.dbBytes,
      pass.liveBytes,
      cf?.requests ?? null,
      cf?.errors ?? null,
      cf?.cpuMs ?? null,
      cf?.http4xx ?? null,
      cf?.http429 ?? null,
      cf?.http5xx ?? null,
    )
    .run()
  return {
    at,
    users: pass.users,
    online: pass.online,
    capture: pass.captureRunning,
    inGame: pass.inGame,
    journals: pass.journals,
    batches: pass.batchesToday,
    dau: pass.dau,
    wau: pass.wau,
    mau: pass.mau,
    dbBytes: pass.dbBytes,
    liveBytes: pass.liveBytes,
    cf,
  }
}

const RANGE_MS: Record<TrendRange, number> = { '24h': DAY, '7d': 7 * DAY, '30d': 30 * DAY }

async function readSamples(d1: D1Database, since: number): Promise<SiteSample[]> {
  const { results } = await d1
    .prepare('SELECT * FROM site_samples WHERE at >= ?1 ORDER BY at')
    .bind(since)
    .all<Record<string, unknown>>()
  return results.map(sampleOf)
}

// ------------------------------------------------------------------- now

export async function nowMetrics(
  env: Env,
  range: TrendRange,
  now = Date.now(),
): Promise<StaffNowMetrics> {
  const [pass, trend] = await Promise.all([
    passOf(env, now),
    memo(`trend:${range}`, METRICS_TTL_MS, now, () => readSamples(env.DB, now - RANGE_MS[range])),
  ])
  return {
    at: pass.at,
    users: pass.users,
    online: pass.online,
    captureDevices: pass.captureDevices,
    captureRunning: pass.captureRunning,
    inGame: pass.inGame,
    journals: pass.journals,
    batchesToday: pass.batchesToday,
    atCap: pass.atCap,
    dau: pass.dau,
    range,
    trend,
  }
}

// ---------------------------------------------------------------- online

/** How many accounts sending live changes the list looks at (newest first). */
const ACTIVE_JOURNALS_MAX = 2_000
/** A hub that does not answer in this long is left out (the row falls back to D1). */
const HUB_TIMEOUT_MS = 2_500

interface JournalRef {
  accountId: number
  userId: number
  updatedAt: number
  seq: number
  today: number
}

interface RawOnlineRow {
  id: number
  username: string
  roleIds: number[]
  siteSince: number | null
  /** As the list keeps it before a caller's view of it: the device is still in. */
  capture: (OnlineCapture & { device: string | null }) | null
  account: StaffOnlineRow['account']
  batchesToday: number
  lastBatchAt: number | null
}

interface RawOnline {
  at: number
  rows: RawOnlineRow[]
  total: number
  counts: Record<OnlineFilter, number>
  roles: Map<number, RoleRow>
}

function roleIdsOf(value: unknown): number[] {
  if (typeof value !== 'string') return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(Number).filter(Number.isSafeInteger) : []
  } catch {
    return []
  }
}

const FILTER_SQL: Record<OnlineFilter, string> = {
  all: '1',
  game: 'p.sending = 1',
  site: 'p.live_since IS NOT NULL',
}

/** What a user's hub says its Capture last reported for `accountId` (null: nothing, or no answer). */
async function askHub(
  env: Env,
  userId: number,
  accountId: number,
): Promise<CapturePresence | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const answer = await Promise.race([
      liveHub(env, userId).presenceOf(accountId),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), HUB_TIMEOUT_MS)
      }),
    ])
    return answer?.presence ?? null
  } catch (error) {
    console.warn('metrics_hub_failed', String(error))
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function readOnline(
  env: Env,
  filter: OnlineFilter,
  page: number,
  now: number,
): Promise<RawOnline> {
  const live = liveDb(env)
  const today = utcDay(now)
  const journalOf = (row: Record<string, unknown>): JournalRef => ({
    accountId: n(row.account_id),
    userId: n(row.user_id),
    updatedAt: n(row.updated_at),
    seq: n(row.last_seq),
    today: row.day === today ? n(row.day_batches) : 0,
  })
  const readJournals = async (sql: string, ...args: unknown[]): Promise<JournalRef[]> => {
    if (!live) return []
    try {
      const { results } = await live
        .prepare(
          `SELECT account_id, user_id, updated_at, last_seq, day, day_batches FROM live_journals ${sql}`,
        )
        .bind(...args)
        .all<Record<string, unknown>>()
      return results.map(journalOf)
    } catch (error) {
      console.warn('metrics_live_failed', String(error))
      return []
    }
  }

  // Who is sending live changes now (their accounts' journals), newest first.
  const sending = await readJournals(
    `WHERE updated_at >= ?1 ORDER BY updated_at DESC LIMIT ${ACTIVE_JOURNALS_MAX}`,
    now - LIVE_RECENT_MS,
  )
  const pool = `WITH cap AS (
      SELECT user_id, max(last_seen_at) AS seen FROM user_sessions
      WHERE method = 'irminsul' AND revoked_at IS NULL AND expires_at > ?1 AND last_seen_at >= ?2
      GROUP BY user_id),
    act AS (SELECT DISTINCT value AS user_id FROM json_each(?3)),
    p AS (
      SELECT u.id, u.username, u.live_since, cap.seen AS capture_seen,
        (act.user_id IS NOT NULL) AS sending
      FROM users AS u LEFT JOIN cap ON cap.user_id = u.id LEFT JOIN act ON act.user_id = u.id
      WHERE u.live_since IS NOT NULL OR cap.seen IS NOT NULL OR act.user_id IS NOT NULL)`
  const poolArgs = [now, now - CAPTURE_RECENT_MS, idList(sending.map((j) => j.userId))]
  const [counts, listed, roles] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare(
      `${pool} SELECT count(*) AS everyone, sum(p.sending) AS game,
         sum(p.live_since IS NOT NULL) AS site FROM p`,
    ).bind(...poolArgs),
    env.DB.prepare(
      `${pool} SELECT p.*,
         (SELECT json_group_array(role_id) FROM user_roles AS ur WHERE ur.user_id = p.id) AS role_ids
       FROM p WHERE ${FILTER_SQL[filter]}
       ORDER BY p.sending DESC, (p.capture_seen IS NOT NULL) DESC, (p.live_since IS NULL),
         p.live_since, p.id
       LIMIT ?4 OFFSET ?5`,
    ).bind(...poolArgs, METRICS_PAGE_SIZE, (page - 1) * METRICS_PAGE_SIZE),
    rolesStatement(env.DB),
  ])
  const c = counts!.results[0] ?? {}
  const totals: Record<OnlineFilter, number> = {
    all: n(c.everyone),
    game: n(c.game),
    site: n(c.site),
  }
  const users = listed!.results
  const ids = idList(users.map((row) => n(row.id)))

  // The listed users' Capture sign-ins, accounts and journals: three reads for the page.
  const [detail, journals] = await Promise.all([
    users.length
      ? env.DB.batch<Record<string, unknown>>([
          env.DB.prepare(
            `SELECT id, user_id, device_name, client, user_agent, last_seen_at, upload_account_id
             FROM user_sessions
             WHERE method = 'irminsul' AND revoked_at IS NULL AND expires_at > ?1
               AND user_id IN (SELECT value FROM json_each(?2))
             ORDER BY last_seen_at DESC`,
          ).bind(now, ids),
          env.DB.prepare(
            `SELECT id, user_id, name, uid, server FROM genshin_accounts
             WHERE user_id IN (SELECT value FROM json_each(?1)) ORDER BY id`,
          ).bind(ids),
        ])
      : Promise.resolve([]),
    users.length
      ? readJournals('WHERE user_id IN (SELECT value FROM json_each(?1))', ids)
      : Promise.resolve([]),
  ])
  const sessions = detail[0]?.results ?? []
  const accounts = detail[1]?.results ?? []

  const rows = await Promise.all(
    users.map(async (row): Promise<RawOnlineRow> => {
      const id = n(row.id)
      const own = journals.filter((j) => j.userId === id).sort((a, b) => b.updatedAt - a.updatedAt)
      const devices = sessions.filter((s) => n(s.user_id) === id)
      const newest = devices[0]
      const theirs = accounts.filter((a) => n(a.user_id) === id)
      // The account its Capture is most likely on: the journal that moved last,
      // else the one its sign-in uploads to, else their first.
      const account =
        theirs.find((a) => n(a.id) === own[0]?.accountId) ??
        theirs.find((a) => n(a.id) === n(newest?.upload_account_id)) ??
        theirs[0]
      const seenLately = newest && n(newest.last_seen_at) >= now - CAPTURE_RECENT_MS
      const presence =
        account && (seenLately || row.sending === 1) ? await askHub(env, id, n(account.id)) : null
      let capture: RawOnlineRow['capture'] = null
      if (presence) {
        const session = devices.find((s) => n(s.id) === presence.sid) ?? null
        capture = {
          state: presence.state,
          device: presence.device,
          // An import key says nothing of the program behind it.
          program: session
            ? clientProgram(
                session.client as string | null,
                session.user_agent as string | null,
                presence.platform,
              )
            : '',
          version: presence.app,
          at: presence.at,
        }
      } else if (seenLately) {
        capture = {
          state: 'seen',
          device: (newest.device_name as string | null) ?? null,
          program: clientProgram(
            newest.client as string | null,
            newest.user_agent as string | null,
            null,
          ),
          version: null,
          at: n(newest.last_seen_at),
        }
      }
      const moved = own.filter((j) => j.seq > 0)
      return {
        id,
        username: String(row.username),
        roleIds: roleIdsOf(row.role_ids),
        siteSince: row.live_since == null ? null : Number(row.live_since),
        capture,
        account: account
          ? {
              id: n(account.id),
              name: (account.name as string | null) ?? null,
              uid: (account.uid as string | null) ?? null,
              server: (account.server as GenshinServer | null) ?? null,
            }
          : null,
        batchesToday: own.reduce((sum, j) => sum + j.today, 0),
        lastBatchAt: moved.length ? moved[0]!.updatedAt : null,
      }
    }),
  )
  return { at: now, rows, total: totals[filter], counts: totals, roles: roleMap(roles) }
}

/**
 * Who has the site open or a Capture running. The device's name is private
 * (`users.view_private`, and only of users below the caller).
 */
export async function onlineList(
  env: Env,
  options: { filter: OnlineFilter; page: number; actor: Standing; private: boolean },
  now = Date.now(),
): Promise<StaffOnlineResponse> {
  const { filter, page } = options
  const raw = await memo(`online:${filter}:${page}`, METRICS_TTL_MS, now, () =>
    readOnline(env, filter, page, now),
  )
  const context = { roles: raw.roles, actor: options.actor, private: options.private }
  return {
    at: raw.at,
    rows: raw.rows.map(({ roleIds, capture, ...row }) => ({
      ...row,
      capture:
        capture && !seesPrivate(context, row.id, positionOf(roleIds, raw.roles))
          ? { ...capture, device: null }
          : capture,
    })),
    total: raw.total,
    counts: raw.counts,
    page,
    pageSize: METRICS_PAGE_SIZE,
    dailyCap: DAILY_BATCHES,
  }
}

// ------------------------------------------------------------------- live

const JOURNAL_ORDER: Record<JournalSort, string> = {
  last: 'updated_at DESC',
  today: '(day = ?1) DESC, day_batches DESC, updated_at DESC',
  size: 'size DESC',
}

async function readJournalRows(
  env: Env,
  sort: JournalSort,
  page: number,
  now: number,
): Promise<StaffJournalRow[]> {
  const live = liveDb(env)
  if (!live) return []
  const today = utcDay(now)
  const { results } = await live
    .prepare(
      `SELECT account_id, user_id, opened_at, updated_at, last_seq, day, day_batches, changes,
         ${JOURNAL_BYTES_SQL} AS size
       FROM live_journals WHERE ?1 = ?1 ORDER BY ${JOURNAL_ORDER[sort]} LIMIT ?2 OFFSET ?3`,
    )
    .bind(today, METRICS_PAGE_SIZE, (page - 1) * METRICS_PAGE_SIZE)
    .all<Record<string, unknown>>()
  if (results.length === 0) return []
  const owners = await env.DB.prepare(
    `SELECT g.id, g.name, g.uid, g.server, u.id AS user_id, u.username
     FROM genshin_accounts AS g JOIN users AS u ON u.id = g.user_id
     WHERE g.id IN (SELECT value FROM json_each(?1))`,
  )
    .bind(idList(results.map((row) => n(row.account_id))))
    .all<Record<string, unknown>>()
  const byId = new Map(owners.results.map((row) => [n(row.id), row]))
  return results.map((row) => {
    const account = byId.get(n(row.account_id))
    return {
      accountId: n(row.account_id),
      name: (account?.name as string | null) ?? null,
      uid: (account?.uid as string | null) ?? null,
      server: (account?.server as GenshinServer | null) ?? null,
      owner: { id: n(account?.user_id ?? row.user_id), username: String(account?.username ?? '') },
      openedAt: n(row.opened_at),
      updatedAt: n(row.updated_at),
      seq: n(row.last_seq),
      today: row.day === today ? n(row.day_batches) : 0,
      changes: n(row.changes),
      bytes: n(row.size),
    }
  })
}

/** Accounts with live data per UTC day: stored chart rows, plus today's still in the journals. */
async function readLiveDays(env: Env, now: number): Promise<DayCount[]> {
  const days = emptyDays(now, 30, ['accounts'])
  const live = liveDb(env)
  if (!live) return days
  const since = days[0]!.day
  const { results } = await live
    .prepare(
      `SELECT day, count(*) AS accounts FROM (
         SELECT p.day AS day, p.account_id FROM live_points AS p
           WHERE p.day >= ?1 AND NOT EXISTS (SELECT 1 FROM live_journals AS j
             WHERE j.account_id = p.account_id AND j.points_day = p.day AND j.points IS NOT NULL)
         UNION ALL
         SELECT points_day AS day, account_id FROM live_journals
           WHERE points_day >= ?1 AND points IS NOT NULL)
       GROUP BY day`,
    )
    .bind(since)
    .all<{ day: string; accounts: number }>()
  const index = new Map(days.map((d) => [d.day, d]))
  for (const row of results) {
    const day = index.get(row.day)
    if (day) day.accounts = n(row.accounts)
  }
  return days
}

export async function liveMetrics(
  env: Env,
  options: { sort: JournalSort; page: number; rows: boolean },
  now = Date.now(),
): Promise<StaffLiveMetrics> {
  const live = liveDb(env)
  const [pass, days, extra, routes, rows] = await Promise.all([
    passOf(env, now),
    memo('live:days', METRICS_SLOW_TTL_MS, now, () => readLiveDays(env, now)),
    memo('live:extra', METRICS_TTL_MS, now, async () => {
      const [accounts, spilled] = await Promise.all([
        env.DB.prepare('SELECT count(*) AS accounts FROM genshin_accounts').first<{
          accounts: number
        }>(),
        live
          ? live
              .prepare('SELECT count(*) AS spilled FROM live_batches')
              .first<{ spilled: number }>()
              .catch(() => null)
          : Promise.resolve(null),
      ])
      return { accounts: n(accounts?.accounts), spilled: n(spilled?.spilled) }
    }),
    liveRouteCounts(env, now),
    options.rows
      ? memo(`live:rows:${options.sort}:${options.page}`, METRICS_TTL_MS, now, () =>
          readJournalRows(env, options.sort, options.page, now),
        )
      : Promise.resolve(undefined),
  ])
  return {
    at: pass.at,
    journals: pass.journals,
    accounts: extra.accounts,
    active: pass.inGame,
    batchesToday: pass.batchesToday,
    accountsToday: pass.accountsToday,
    bytes: pass.liveBytes || pass.journalBytes,
    dailyCap: DAILY_BATCHES,
    health: {
      tailChanges: pass.tailChanges,
      spilledRows: extra.spilled,
      atCap: pass.atCap,
      oldestOpenedAt: pass.oldestOpenedAt,
      resyncs24h: routes?.resyncs ?? null,
      capRefusals24h: routes?.capRefusals ?? null,
    },
    days,
    ...(rows ? { rows } : {}),
    total: pass.journals,
    page: options.page,
    pageSize: METRICS_PAGE_SIZE,
  }
}

// --------------------------------------------------------------- activity

const ACTIVITY_DAYS: Record<ActivityRange, number> = { '30d': 30, '90d': 90, '1y': 365 }

// The provider a user signed up with: the identity made with the user (as the overview).
const SIGNUP_METHOD_SQL = `CASE WHEN EXISTS (SELECT 1 FROM user_identities AS i WHERE i.user_id = u.id
    AND i.provider = 'discord' AND i.created_at = u.created_at) THEN 'discord'
  WHEN EXISTS (SELECT 1 FROM user_identities AS i WHERE i.user_id = u.id
    AND i.provider = 'google' AND i.created_at = u.created_at) THEN 'google'
  ELSE 'password' END`

async function readActivity(env: Env, range: ActivityRange, now: number) {
  const count = ACTIVITY_DAYS[range]
  const signups = emptyDays(now, count, ['password', 'discord', 'google'])
  const uploads = emptyDays(now, 30, ['uploaders', 'snapshots', 'bytes'])
  const since = Date.parse(`${signups[0]!.day}T00:00:00Z`)
  const [signed, uploaded, readings, wishes, chunks, accounts] = await env.DB.batch<
    Record<string, unknown>
  >([
    env.DB.prepare(
      `SELECT strftime('%Y-%m-%d', u.created_at / 1000, 'unixepoch') AS day,
         ${SIGNUP_METHOD_SQL} AS method, count(*) AS n
       FROM users AS u WHERE u.created_at >= ?1 GROUP BY day, method`,
    ).bind(since),
    env.DB.prepare(
      `SELECT day, count(*) AS uploaders, sum(snapshots) AS snapshots, sum(stored_bytes) AS bytes
       FROM user_upload_days WHERE day >= ?1 GROUP BY day`,
    ).bind(uploads[0]!.day),
    env.DB.prepare(
      `SELECT strftime('%Y-%m-%d', at / 1000, 'unixepoch') AS day, max(dau) AS dau, max(wau) AS wau
       FROM site_samples WHERE at >= ?1 GROUP BY day ORDER BY day`,
    ).bind(since),
    env.DB.prepare(
      `SELECT count(*) AS histories, sum(updated_at >= ?1) AS day, sum(updated_at >= ?2) AS week
       FROM wish_histories`,
    ).bind(now - DAY, now - 7 * DAY),
    env.DB.prepare(
      `SELECT coalesce(sum(count), 0) AS pulls, coalesce(sum(length(data)), 0) AS bytes
       FROM wish_chunks`,
    ),
    env.DB.prepare('SELECT count(*) AS accounts FROM genshin_accounts'),
  ])
  const signupIndex = new Map(signups.map((d) => [d.day, d]))
  for (const row of signed!.results) {
    const day = signupIndex.get(String(row.day))
    if (day) day[String(row.method)] = n(row.n)
  }
  const uploadIndex = new Map(uploads.map((d) => [d.day, d]))
  for (const row of uploaded!.results) {
    const day = uploadIndex.get(String(row.day))
    if (!day) continue
    day.uploaders = n(row.uploaders)
    day.snapshots = n(row.snapshots)
    day.bytes = n(row.bytes)
  }
  const w = wishes!.results[0] ?? {}
  const k = chunks!.results[0] ?? {}
  return {
    signups,
    uploads,
    active: readings!.results.map(
      (row): DayCount => ({ day: String(row.day), dau: n(row.dau), wau: n(row.wau) }),
    ),
    wishes: {
      accounts: n(accounts!.results[0]?.accounts),
      histories: n(w.histories),
      synced24h: n(w.day),
      synced7d: n(w.week),
      pulls: n(k.pulls),
      bytes: n(k.bytes),
    },
  }
}

export async function activityMetrics(
  env: Env,
  range: ActivityRange,
  now = Date.now(),
): Promise<StaffActivityMetrics> {
  const [pass, slow] = await Promise.all([
    passOf(env, now),
    memo(`activity:${range}`, METRICS_SLOW_TTL_MS, now, () => readActivity(env, range, now)),
  ])
  return {
    at: pass.at,
    users: pass.users,
    dau: pass.dau,
    wau: pass.wau,
    mau: pass.mau,
    lastSeen: {
      today: pass.dau,
      week: Math.max(0, pass.wau - pass.dau),
      month: Math.max(0, pass.mau - pass.wau),
      older: Math.max(0, pass.users - pass.mau),
    },
    range,
    signups: slow.signups,
    uploads: slow.uploads,
    active: slow.active,
    capture: {
      devices: pass.captureDevices,
      users: pass.captureUsers,
      seen24h: pass.captureSeen24h,
      seen7d: pass.captureSeen7d,
      new7d: pass.captureNew7d,
    },
    wishes: slow.wishes,
  }
}

// --------------------------------------------------------------- capacity

export async function capacityMetrics(
  env: Env,
  range: TrendRange = '7d',
  now = Date.now(),
): Promise<StaffCapacityMetrics> {
  const [pass, storage, usage, routes, trend] = await Promise.all([
    passOf(env, now),
    memo('capacity:storage', METRICS_SLOW_TTL_MS, now, async () => {
      const [totals, growth] = await env.DB.batch<Record<string, unknown>>([
        env.DB.prepare(
          `SELECT (SELECT coalesce(sum(stored_bytes), 0) FROM genshin_accounts) AS sections,
             (SELECT coalesce(sum(raw_bytes), 0) FROM genshin_accounts) AS raw,
             (SELECT coalesce(sum(length(data)), 0) FROM artifact_chunks) AS catalog,
             (SELECT coalesce(sum(length(data)), 0) FROM wish_chunks) AS wish,
             (SELECT coalesce(sum(count), 0) FROM wish_chunks) AS pulls`,
        ),
        env.DB.prepare(
          'SELECT coalesce(sum(stored_bytes), 0) AS bytes FROM user_upload_days WHERE day >= ?1',
        ).bind(utcDay(now - 6 * DAY)),
      ])
      const t = totals!.results[0] ?? {}
      return {
        split: {
          sectionBytes: n(t.sections),
          catalogBytes: n(t.catalog),
          wishBytes: n(t.wish),
          wishPulls: n(t.pulls),
          rawBytes: n(t.raw),
        },
        growthPerDay: Math.round(n(growth!.results[0]?.bytes) / 7),
      }
    }),
    cloudflareUsage(env, now),
    routeRefusals(env, now),
    memo(`trend:${range}`, METRICS_TTL_MS, now, () => readSamples(env.DB, now - RANGE_MS[range])),
  ])
  return {
    at: pass.at,
    databases: [
      { name: 'gdt', bytes: pass.dbBytes || null, limit: D1_LIMIT_BYTES },
      { name: 'gdt-live', bytes: pass.liveBytes || null, limit: D1_LIMIT_BYTES },
    ],
    storage: storage.split,
    growthPerDay: storage.growthPerDay,
    usage,
    routes,
    range,
    history: trend.filter((sample) => sample.cf),
  }
}
