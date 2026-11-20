/**
 * The staff Insights page's reads, and what the Overview and Audit pages
 * gained with it (routes/staff-insights.ts; README "Staff insights"). As
 * with the Metrics page, nothing here runs per user or per request of
 * theirs: each answer is an aggregate over state the site keeps anyway, read
 * when a staff member opens the page and kept ten minutes in this Worker
 * instance (lib/keep.ts). Totals and shares only: no user is named.
 */

import {
  ALERT_KINDS,
  AUDIT_SUMMARY_SERIES,
  FEATURE_KEYS,
  METRICS_SLOW_TTL_MS,
  clientProgram,
  compareVersions,
  decodeSnapshotMeta,
  weekStart,
  type AlertKind,
  type ClientRow,
  type CountryBasis,
  type CountryRow,
  type DayCount,
  type FeatureKey,
  type GenshinServer,
  type StaffAuditSummary,
  type StaffFeatureInsights,
  type StaffHealthResponse,
  type StaffPeopleInsights,
  type StaffRetentionInsights,
  type StaffUploadInsights,
} from '@gdt/shared'
import { emailEnabled, emailFeatures } from '../lib/email'
import { keep } from '../lib/keep'
import { enabledProviders } from '../lib/oauth'
import { vapidKeys } from '../lib/web-push'
import { usageConfig } from './cf-usage'
import { listJobRuns } from './job-runs'
import { liveDb } from './live-sync'
import { quotaSql, readSiteSettings } from './staff-deps'
import { utcDay } from './upload-limits'

const DAY = 86_400_000
const WEEK = 7 * DAY
const n = (value: unknown): number => Number(value ?? 0) || 0

/** An active client sign-in: not ended, not expired (`?1` = now). */
const CLIENT_SQL = "method = 'irminsul' AND revoked_at IS NULL AND expires_at > ?1"

// ------------------------------------------------------------------ people

async function readPeople(env: Env, basis: CountryBasis, now: number) {
  const d1 = env.DB
  // The place a user is counted under: where they signed up, or their newest session's.
  const place =
    basis === 'signup'
      ? 'u.signup_country'
      : `(SELECT s.country FROM user_sessions AS s WHERE s.user_id = u.id
           ORDER BY s.last_seen_at DESC LIMIT 1)`
  const [countries, ways, identities, passkeys, oneWay, languages, themes, servers, clients] =
    await d1.batch<Record<string, unknown>>([
      d1
        .prepare(
          `SELECT ${place} AS code, count(*) AS users, sum(u.last_active_at >= ?2) AS active,
             sum(u.created_at >= ?3) AS fresh,
             sum(EXISTS (SELECT 1 FROM user_sessions AS c WHERE c.user_id = u.id
               AND c.method = 'irminsul' AND c.revoked_at IS NULL AND c.expires_at > ?1)) AS client,
             sum(EXISTS (SELECT 1 FROM user_upload_days AS d WHERE d.user_id = u.id
               AND d.day >= ?4)) AS uploading
           FROM users AS u GROUP BY code ORDER BY users DESC, code`,
        )
        .bind(now, now - WEEK, now - 30 * DAY, utcDay(now - 29 * DAY)),
      d1.prepare(
        `SELECT count(*) AS users, sum(password_hash <> '') AS password,
           sum(password_hash = '') AS no_password, sum(suspended_at IS NOT NULL) AS suspended,
           sum(uploads_blocked_at IS NOT NULL) AS blocked
         FROM users`,
      ),
      d1.prepare(
        'SELECT provider, count(DISTINCT user_id) AS users FROM user_identities GROUP BY provider',
      ),
      d1.prepare('SELECT count(*) AS passkeys, count(DISTINCT user_id) AS users FROM passkeys'),
      d1.prepare(
        `SELECT count(*) AS users FROM users AS u
         WHERE (u.password_hash <> '')
           + (SELECT count(*) FROM user_identities AS i WHERE i.user_id = u.id)
           + EXISTS (SELECT 1 FROM passkeys AS p WHERE p.user_id = u.id) = 1`,
      ),
      d1.prepare(
        `SELECT coalesce(json_extract(settings, '$.language'), 'system') AS key, count(*) AS users
         FROM users GROUP BY key ORDER BY users DESC, key`,
      ),
      d1.prepare(
        `SELECT coalesce(json_extract(settings, '$.theme'), 'system') AS key, count(*) AS users
         FROM users GROUP BY key ORDER BY users DESC, key`,
      ),
      d1.prepare(
        `SELECT server AS key, count(*) AS accounts FROM genshin_accounts
         GROUP BY server ORDER BY accounts DESC`,
      ),
      d1
        .prepare(
          `SELECT client, (user_agent LIKE 'Teyvat.me%') AS ours, client_platform AS platform,
             client_version AS version, count(*) AS devices,
             sum(last_seen_at >= ?2) AS seen, min(client_version_at) AS first_seen
           FROM user_sessions WHERE ${CLIENT_SQL}
           GROUP BY client, ours, platform, version`,
        )
        .bind(now, now - DAY),
    ])
  const w = ways!.results[0] ?? {}
  const provider = (name: string) =>
    n(identities!.results.find((row) => row.provider === name)?.users)

  // Several sign-in rows can be one program (a name kept or not): add them up.
  const programs = new Map<string, ClientRow>()
  for (const row of clients!.results) {
    const program = clientProgram(
      row.client as string | null,
      n(row.ours) === 1 ? 'Teyvat.me' : null,
      row.platform as string | null,
    )
    const version = (row.version as string | null) ?? null
    const key = `${program} ${version ?? ''}`
    const sum = programs.get(key) ?? {
      program,
      version,
      devices: 0,
      seen24h: 0,
      firstSeenAt: null,
      old: false,
    }
    sum.devices += n(row.devices)
    sum.seen24h += n(row.seen)
    if (row.first_seen != null) {
      sum.firstSeenAt = Math.min(sum.firstSeenAt ?? Infinity, Number(row.first_seen))
    }
    programs.set(key, sum)
  }
  const list = [...programs.values()]
  // The newest version each program has in use: anything behind it is old.
  const newest = new Map<string, string>()
  for (const row of list) {
    if (!row.version) continue
    const top = newest.get(row.program)
    if (!top || compareVersions(row.version, top) > 0) newest.set(row.program, row.version)
  }
  for (const row of list) {
    row.old = Boolean(row.version && row.version !== newest.get(row.program))
  }
  list.sort(
    (a, b) =>
      b.devices - a.devices ||
      a.program.localeCompare(b.program) ||
      compareVersions(b.version ?? '', a.version ?? ''),
  )

  return {
    users: n(w.users),
    countries: countries!.results.map(
      (row): CountryRow => ({
        code: (row.code as string | null) || null,
        users: n(row.users),
        active7d: n(row.active),
        new30d: n(row.fresh),
        withClient: n(row.client),
        uploading: n(row.uploading),
      }),
    ),
    ways: {
      password: n(w.password),
      discord: provider('discord'),
      google: provider('google'),
      passkey: n(passkeys!.results[0]?.users),
      passkeys: n(passkeys!.results[0]?.passkeys),
      noPassword: n(w.no_password),
      oneWay: n(oneWay!.results[0]?.users),
      suspended: n(w.suspended),
      uploadsBlocked: n(w.blocked),
    },
    languages: languages!.results.map((row) => ({ key: String(row.key), users: n(row.users) })),
    themes: themes!.results.map((row) => ({ key: String(row.key), users: n(row.users) })),
    servers: servers!.results.map((row) => ({
      key: (row.key as GenshinServer | null) ?? null,
      accounts: n(row.accounts),
    })),
    clients: list,
  }
}

export async function peopleInsights(
  env: Env,
  basis: CountryBasis,
  now = Date.now(),
): Promise<StaffPeopleInsights> {
  const data = await keep(`people:${basis}`, METRICS_SLOW_TTL_MS, now, async () => ({
    at: now,
    ...(await readPeople(env, basis, now)),
  }))
  return {
    ...data,
    accounts: data.servers.reduce((sum, row) => sum + row.accounts, 0),
    basis,
  }
}

// --------------------------------------------------------------- retention

/** How many sign-up weeks the grid has, and how many weeks it follows each. */
const COHORT_WEEKS = 12
const FOLLOW_WEEKS = 9

/** The week number of a Monday-based week (epoch day 0 was a Thursday). */
const weekNumber = (ms: number) => Math.floor((ms + 3 * DAY) / WEEK)
const weekMs = (number: number) => number * WEEK - 3 * DAY
const WEEK_OF_CREATED = `((u.created_at + ${3 * DAY}) / ${WEEK})`
const WEEK_OF_DAY = `((unixepoch(d.day) * 1000 + ${3 * DAY}) / ${WEEK})`

async function readRetention(env: Env, now: number): Promise<Omit<StaffRetentionInsights, 'at'>> {
  const d1 = env.DB
  const thisWeek = weekNumber(now)
  const first = thisWeek - (COHORT_WEEKS - 1)
  const since = weekMs(first)
  const months = new Date(now)
  const monthsSince = Date.UTC(months.getUTCFullYear(), months.getUTCMonth() - 5, 1)
  const [sizes, active, byMonth, guests] = await d1.batch<Record<string, unknown>>([
    d1
      .prepare(
        `SELECT ${WEEK_OF_CREATED} AS week, count(*) AS users FROM users AS u
         WHERE u.created_at >= ?1 GROUP BY week`,
      )
      .bind(since),
    // Who of each sign-up week stored something k weeks later: one pass over
    // the upload days of the users who signed up in the window.
    d1
      .prepare(
        `SELECT week, k, count(*) AS users FROM (
           SELECT DISTINCT u.id, ${WEEK_OF_CREATED} AS week,
             ${WEEK_OF_DAY} - ${WEEK_OF_CREATED} AS k
           FROM users AS u JOIN user_upload_days AS d ON d.user_id = u.id
           WHERE u.created_at >= ?1 AND d.day >= ?2)
         WHERE k >= 0 AND k < ?3 GROUP BY week, k`,
      )
      .bind(since, utcDay(since), FOLLOW_WEEKS),
    d1
      .prepare(
        `SELECT strftime('%Y-%m', created_at / 1000, 'unixepoch') AS month, count(*) AS users,
           sum(last_active_at >= ?2) AS seen7, sum(last_active_at >= ?3) AS seen30
         FROM users WHERE created_at >= ?1 GROUP BY month ORDER BY month`,
      )
      .bind(monthsSince, now - WEEK, now - 30 * DAY),
    d1
      .prepare(
        `SELECT count(*) AS signups, sum(from_guest) AS guests,
           sum(from_guest AND last_active_at >= ?2) AS active
         FROM users WHERE created_at >= ?1`,
      )
      .bind(now - 30 * DAY, now - WEEK),
  ])
  const size = new Map(sizes!.results.map((row) => [n(row.week), n(row.users)]))
  const cell = new Map(active!.results.map((row) => [`${n(row.week)}:${n(row.k)}`, n(row.users)]))
  const cohorts = Array.from({ length: COHORT_WEEKS }, (_, i) => {
    const week = first + i
    return {
      week: weekStart(weekMs(week)),
      users: size.get(week) ?? 0,
      // A week that has not begun yet has no answer.
      active: Array.from({ length: FOLLOW_WEEKS }, (_, k) =>
        week + k > thisWeek ? null : (cell.get(`${week}:${k}`) ?? 0),
      ),
    }
  })
  const g = guests!.results[0] ?? {}
  return {
    cohorts,
    months: byMonth!.results.map((row) => ({
      month: String(row.month),
      users: n(row.users),
      seen7d: n(row.seen7),
      seen30d: n(row.seen30),
    })),
    guests: { signups: n(g.signups), fromGuest: n(g.guests), stillActive: n(g.active) },
  }
}

export function retentionInsights(env: Env, now = Date.now()): Promise<StaffRetentionInsights> {
  return keep('retention', METRICS_SLOW_TTL_MS, now, async () => ({
    at: now,
    ...(await readRetention(env, now)),
  }))
}

// ---------------------------------------------------------------- features

/** Each feature's table and the column that says when an account last changed it. */
const FEATURE_TABLES: Record<FeatureKey, { table: string; changed: string; where?: string }> = {
  plannerGoals: { table: 'planner_targets', changed: 'updated_at' },
  wishes: { table: 'wish_histories', changed: 'updated_at' },
  achievements: { table: 'achievement_marks', changed: 'updated_at' },
  tasks: { table: 'planner_tasks', changed: 'updated_at' },
  weaponGoals: { table: 'planner_weapon_goals', changed: 'updated_at' },
  anecdotes: { table: 'anecdote_marks', changed: 'updated_at' },
  quests: { table: 'quest_marks', changed: 'updated_at' },
  sharing: { table: 'account_members', changed: 'accepted_at', where: 'x.accepted_at IS NOT NULL' },
}

async function readFeatures(env: Env, now: number): Promise<Omit<StaffFeatureInsights, 'at'>> {
  const d1 = env.DB
  // One existence check per account and feature (each table leads with the account).
  const uses = FEATURE_KEYS.flatMap((key) => {
    const { table, changed, where } = FEATURE_TABLES[key]
    const has = `SELECT 1 FROM ${table} AS x WHERE x.account_id = g.id${where ? ` AND ${where}` : ''}`
    return [
      `sum(EXISTS (${has})) AS ${key}`,
      `sum(EXISTS (${has} AND x.${changed} >= ?1)) AS ${key}_week`,
    ]
  })
  const alertSums = ALERT_KINDS.map((kind) =>
    kind === 'resin'
      ? `sum(json_extract(alerts, '$.resin') IS NOT NULL) AS resin`
      : `sum(json_extract(alerts, '$.${kind}') = 1) AS ${kind}`,
  )
  const anyAlert = ALERT_KINDS.map((kind) =>
    kind === 'resin'
      ? `json_extract(alerts, '$.resin') IS NOT NULL`
      : `json_extract(alerts, '$.${kind}') = 1`,
  ).join(' OR ')
  const [use, sharing, alerts, push, tokens, tiers, passkeys] = await d1.batch<
    Record<string, unknown>
  >([
    d1
      .prepare(`SELECT count(*) AS accounts, ${uses.join(', ')} FROM genshin_accounts AS g`)
      .bind(now - WEEK),
    d1.prepare(
      `SELECT count(DISTINCT CASE WHEN accepted_at IS NOT NULL THEN account_id END) AS accounts,
         sum(accepted_at IS NOT NULL AND role = 'viewer') AS viewers,
         sum(accepted_at IS NOT NULL AND role = 'editor') AS editors,
         sum(accepted_at IS NULL) AS pending,
         (SELECT max(members) FROM (SELECT count(*) AS members FROM account_members
            WHERE accepted_at IS NOT NULL GROUP BY account_id)) AS largest
       FROM account_members`,
    ),
    d1
      .prepare(
        `SELECT sum(${anyAlert}) AS devices, ${alertSums.join(', ')} FROM user_sessions
         WHERE alerts IS NOT NULL AND revoked_at IS NULL AND expires_at > ?1`,
      )
      .bind(now),
    d1.prepare(
      `SELECT count(*) AS subscriptions, sum(failures > 0) AS failing, max(last_ok_at) AS last_ok
       FROM push_subscriptions`,
    ),
    d1
      .prepare(
        `SELECT sum(live) AS tokens, count(DISTINCT CASE WHEN live THEN user_id END) AS users,
           sum(live AND last_used_at >= ?2) AS day, sum(live AND last_used_at >= ?3) AS week,
           sum(live AND (scopes & ?5) <> 0) AS write_tokens,
           sum(live AND expires_at IS NOT NULL AND expires_at < ?4) AS expiring,
           sum(revoked_at IS NOT NULL) AS revoked
         FROM (SELECT *, (revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?1)) AS live
               FROM api_tokens)`,
      )
      // 0xAAAAAAAA: the write bit of every area (two bits per area, write the higher).
      .bind(now, now - DAY, now - WEEK, now + 14 * DAY, 0xaaaaaaaa),
    d1.prepare(
      `SELECT sum(api_tier = 'supporter') AS supporters, sum(api_limits IS NOT NULL) AS custom
       FROM users`,
    ),
    d1
      .prepare(
        `SELECT count(DISTINCT user_id) AS users,
           count(DISTINCT CASE WHEN last_used_at >= ?1 THEN user_id END) AS week
         FROM passkeys`,
      )
      .bind(now - WEEK),
  ])
  const u = use!.results[0] ?? {}
  const s = sharing!.results[0] ?? {}
  const a = alerts!.results[0] ?? {}
  const p = push!.results[0] ?? {}
  const t = tokens!.results[0] ?? {}
  return {
    accounts: n(u.accounts),
    features: FEATURE_KEYS.map((key) => ({
      key,
      accounts: n(u[key]),
      changed7d: n(u[`${key}_week`]),
    })).sort((x, y) => y.accounts - x.accounts),
    sharing: {
      accounts: n(s.accounts),
      viewers: n(s.viewers),
      editors: n(s.editors),
      pending: n(s.pending),
      largest: n(s.largest),
    },
    alerts: {
      devices: n(a.devices),
      kinds: Object.fromEntries(ALERT_KINDS.map((kind) => [kind, n(a[kind])])) as Record<
        AlertKind,
        number
      >,
      subscriptions: n(p.subscriptions),
      failing: n(p.failing),
      lastOkAt: p.last_ok == null ? null : Number(p.last_ok),
    },
    api: {
      tokens: n(t.tokens),
      users: n(t.users),
      used24h: n(t.day),
      used7d: n(t.week),
      write: n(t.write_tokens),
      expiring: n(t.expiring),
      revoked: n(t.revoked),
      supporters: n(tiers!.results[0]?.supporters),
      customLimits: n(tiers!.results[0]?.custom),
    },
    passkeys: { users: n(passkeys!.results[0]?.users), used7d: n(passkeys!.results[0]?.week) },
  }
}

export function featureInsights(env: Env, now = Date.now()): Promise<StaffFeatureInsights> {
  return keep('features', METRICS_SLOW_TTL_MS, now, async () => ({
    at: now,
    ...(await readFeatures(env, now)),
  }))
}

// ----------------------------------------------------------------- uploads

/** How many of the last day's snapshot headers are read for the source and reason lists. */
const HEADERS_MAX = 2_000

async function readUploads(env: Env, now: number): Promise<Omit<StaffUploadInsights, 'at'>> {
  const d1 = env.DB
  const { limits } = await readSiteSettings(d1)
  const today = utcDay(now)
  const quota = quotaSql('u', limits.storageQuota)
  const [caps, quotas, day, headers] = await d1.batch<Record<string, unknown>>([
    d1
      .prepare(
        `SELECT count(DISTINCT CASE WHEN day = ?1 THEN user_id END) AS today,
           count(DISTINCT user_id) AS week
         FROM user_upload_days
         WHERE day >= ?2 AND (snapshots >= ?3 OR stored_bytes >= ?4)`,
      )
      .bind(today, utcDay(now - 6 * DAY), limits.dailySnapshots, limits.dailyBytes),
    // Sections only (the catalog and wishes are on the Storage page's exact count).
    d1.prepare(
      `SELECT sum(stored >= 0.8 * quota) AS near, sum(blocked) AS blocked FROM (
         SELECT ${quota} AS quota, u.uploads_blocked_at IS NOT NULL AS blocked,
           (SELECT coalesce(sum(g.stored_bytes), 0) FROM genshin_accounts AS g
            WHERE g.user_id = u.id) AS stored
         FROM users AS u)`,
    ),
    d1
      .prepare(
        `SELECT count(*) AS snapshots, coalesce(sum(stored_size), 0) AS bytes FROM snapshots
         WHERE created_at >= ?1`,
      )
      .bind(now - DAY),
    d1
      .prepare(
        `SELECT meta FROM snapshots WHERE created_at >= ?1 AND deleted_at IS NULL
         ORDER BY id DESC LIMIT ${HEADERS_MAX}`,
      )
      .bind(now - DAY),
  ])
  const sources = new Map<string, number>()
  const reasons = new Map<string, number>()
  let sampled = 0
  for (const row of headers!.results) {
    const raw = row.meta
    if (!raw) continue
    try {
      const bytes =
        raw instanceof Uint8Array
          ? raw
          : Array.isArray(raw)
            ? Uint8Array.from(raw as number[])
            : new Uint8Array(raw as ArrayBuffer)
      const meta = decodeSnapshotMeta(bytes)
      sampled++
      const source = meta.source.trim().slice(0, 40) || 'Unknown'
      sources.set(source, (sources.get(source) ?? 0) + 1)
      const reason = meta.capture?.reason ?? 'none'
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
    } catch {
      // A header this build cannot read is left out of the two lists.
    }
  }
  const ranked = (map: Map<string, number>) =>
    [...map]
      .map(([key, snapshots]) => ({ key, snapshots }))
      .sort((a, b) => b.snapshots - a.snapshots)
  const c = caps!.results[0] ?? {}
  const q = quotas!.results[0] ?? {}
  const d = day!.results[0] ?? {}
  return {
    limits: { dailySnapshots: limits.dailySnapshots, dailyBytes: limits.dailyBytes },
    atCapToday: n(c.today),
    atCapWeek: n(c.week),
    nearQuota: n(q.near),
    blocked: n(q.blocked),
    snapshots24h: n(d.snapshots),
    bytes24h: n(d.bytes),
    sources: ranked(sources).slice(0, 8),
    reasons: ranked(reasons),
    sampled,
  }
}

export function uploadInsights(env: Env, now = Date.now()): Promise<StaffUploadInsights> {
  return keep('uploads', METRICS_SLOW_TTL_MS, now, async () => ({
    at: now,
    ...(await readUploads(env, now)),
  }))
}

// ------------------------------------------------------------------ health

/** What is switched on, and whether the scheduled jobs run (the staff Overview). */
export async function siteHealth(
  env: Env,
  url: string,
  now = Date.now(),
): Promise<StaffHealthResponse> {
  const vars = env as unknown as Record<string, unknown>
  const live = liveDb(env)
  const providers = enabledProviders(env, url)
  const usage = usageConfig(env)
  const [sample, jobs, liveMigrations] = await Promise.all([
    env.DB.prepare('SELECT max(at) AS at FROM site_samples').first<{ at: number | null }>(),
    listJobRuns(env.DB),
    live
      ? live
          .prepare('SELECT count(*) AS applied FROM d1_migrations')
          .first<{ applied: number }>()
          .then((row) => n(row?.applied))
          .catch(() => null)
      : Promise.resolve(null),
  ])
  return {
    at: now,
    features: {
      push: vapidKeys(vars) !== null,
      humanCheck: Boolean(vars.TURNSTILE_SITE_KEY && vars.TURNSTILE_SECRET_KEY),
      discord: providers.includes('discord'),
      google: providers.includes('google'),
      email: emailFeatures(env) ? (emailEnabled(env) ? 'on' : 'off') : 'paused',
      usage: usage !== null,
      usageZone: Boolean(usage?.zone),
      liveDb: live !== null,
    },
    liveMigrations,
    lastSampleAt: sample?.at ?? null,
    jobs,
  }
}

// ------------------------------------------------------------------- audit

// Which series of the summary an action belongs to (the audit page's kinds, folded).
const SERIES_SQL = `CASE WHEN action = 'data.inspect' THEN 'views'
  WHEN action IN ('user.delete', 'user.delete_self', 'data.delete', 'data.delete_account') THEN 'deletes'
  WHEN action LIKE 'user.%' THEN 'users'
  WHEN action LIKE 'data.%' THEN 'data'
  ELSE 'other' END`

/** The last 30 days of staff actions: per day by kind, and per staff member. */
export async function auditSummary(d1: D1Database, now = Date.now()): Promise<StaffAuditSummary> {
  const today = Date.parse(`${utcDay(now)}T00:00:00Z`)
  const since = today - 29 * DAY
  const days: DayCount[] = Array.from({ length: 30 }, (_, i) => {
    const day: DayCount = { day: utcDay(since + i * DAY) }
    for (const name of AUDIT_SUMMARY_SERIES) day[name] = 0
    return day
  })
  const [perDay, perActor] = await d1.batch<Record<string, unknown>>([
    d1
      .prepare(
        `SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS day, ${SERIES_SQL} AS series,
           count(*) AS actions
         FROM admin_audit WHERE created_at >= ?1 GROUP BY day, series`,
      )
      .bind(since),
    d1
      .prepare(
        `SELECT actor_user_id AS id, max(actor_label) AS label, count(*) AS actions,
           sum(action = 'data.inspect') AS views,
           sum(action IN ('user.delete', 'user.delete_self', 'data.delete', 'data.delete_account')) AS deletes
         FROM admin_audit WHERE created_at >= ?1
         GROUP BY actor_user_id ORDER BY actions DESC LIMIT 20`,
      )
      .bind(since),
  ])
  const index = new Map(days.map((d) => [d.day, d]))
  for (const row of perDay!.results) {
    const day = index.get(String(row.day))
    if (day) day[String(row.series)] = n(row.actions)
  }
  return {
    days,
    actors: perActor!.results.map((row) => ({
      id: row.id == null ? null : Number(row.id),
      label: String(row.label ?? ''),
      actions: n(row.actions),
      views: n(row.views),
      deletes: n(row.deletes),
    })),
  }
}
