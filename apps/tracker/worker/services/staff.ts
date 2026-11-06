/**
 * Reads for the staff dashboard (worker/routes/staff.ts): users, one user,
 * the overview and the storage page. Each is one D1 batch. Fields only
 * `users.view_private` may see (email, IPs, identities, sessions) are left
 * out unless `private` is set, and even then only for users the caller
 * outranks or themselves: no one reads the private details of a staff
 * member as high as they are.
 */

import {
  STAFF_PAGE_SIZE,
  type DayCount,
  type IdentityResponse,
  type SignInMethod,
  type StaffAccountRow,
  type StaffOverviewResponse,
  type StaffRecentSignup,
  type StaffStorageResponse,
  type StaffStorageRow,
  type StaffUserCounts,
  type StaffUserFilter,
  type StaffUserRow,
  type StaffUserSort,
  type StaffUsersResponse,
  type StorageSort,
  type StorageWindow,
} from '@gdt/shared'
import { AUTO_ACCOUNT_LIMIT } from './accounts'
import { listIdentities } from './identities'
import { NO_ROLE, roleFromRow, roleRef, type RoleRow, type Standing } from './roles'
import {
  dailyCapCte,
  ipSearchSql,
  lastActiveSql,
  quotaSql,
  signupCountrySql,
  signupIpSql,
  type Limits,
} from './staff-deps'

const DAY = 86_400_000

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/** Builds `?n` placeholders in order. */
class Args {
  readonly values: unknown[] = []
  add(value: unknown): string {
    this.values.push(value)
    return `?${this.values.length}`
  }
}

/**
 * Per user: accounts, snapshots, stored sections and raw bytes (`totals`),
 * their artifact catalog chunks (`catalog`) and their wish history chunks
 * with the pulls in them (`wishes`).
 */
const USER_TOTALS = `
  totals AS (SELECT user_id, count(*) AS accounts, sum(snapshot_count) AS snapshots,
               sum(stored_bytes) AS stored, sum(raw_bytes) AS raw
             FROM genshin_accounts GROUP BY user_id),
  catalog AS (SELECT g.user_id, sum(length(c.data)) AS bytes, sum(c.count) AS pieces
              FROM artifact_chunks AS c JOIN genshin_accounts AS g ON g.id = c.account_id
              GROUP BY g.user_id),
  wishes AS (SELECT g.user_id, sum(length(w.data)) AS bytes, sum(w.count) AS pulls
             FROM wish_chunks AS w JOIN genshin_accounts AS g ON g.id = w.account_id
             GROUP BY g.user_id)`

/** The storage columns of `USER_TOTALS` joined as `t` / `ca` / `wi`: the split and its sum. */
const STORAGE_COLUMNS = `coalesce(t.stored, 0) AS sections, coalesce(ca.bytes, 0) AS catalog,
  coalesce(wi.bytes, 0) AS wish, coalesce(wi.pulls, 0) AS pulls,
  coalesce(t.stored, 0) + coalesce(ca.bytes, 0) + coalesce(wi.bytes, 0) AS stored,
  coalesce(t.raw, 0) AS raw`

/** The columns a StaffUserRow is built from (`u` the user, `t` / `ca` / `wi` the totals). */
const USER_COLUMNS = `u.id, u.username, u.created_at, ${lastActiveSql('u')} AS last_active_at,
  u.suspended_at, u.suspended_reason, u.uploads_blocked_at, u.password_hash <> '' AS has_password,
  u.import_key_hash IS NOT NULL AS has_import_key, u.email, u.email_verified,
  ${signupIpSql('u')} AS signup_ip, ${signupCountrySql('u')} AS signup_country,
  coalesce(t.accounts, 0) AS accounts, coalesce(t.snapshots, 0) AS snapshots, ${STORAGE_COLUMNS},
  (SELECT group_concat(provider) FROM user_identities AS i WHERE i.user_id = u.id) AS providers,
  (SELECT json_group_array(role_id) FROM user_roles AS ur WHERE ur.user_id = u.id) AS role_ids`

const TOTALS_JOINS = `LEFT JOIN totals AS t ON t.user_id = u.id
  LEFT JOIN catalog AS ca ON ca.user_id = u.id LEFT JOIN wishes AS wi ON wi.user_id = u.id`
const FROM_USERS = `FROM users AS u ${TOTALS_JOINS}`

/** Where a user stands given their role ids (NO_ROLE without one). */
export function positionOf(
  roleIds: readonly number[],
  roles: ReadonlyMap<number, RoleRow>,
): number {
  let position = NO_ROLE
  for (const id of roleIds) position = Math.max(position, roles.get(id)?.position ?? NO_ROLE)
  return position
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

function methodsOf(row: Record<string, unknown>): SignInMethod[] {
  const methods: SignInMethod[] = []
  if (row.has_password === 1) methods.push('password')
  const providers = typeof row.providers === 'string' ? row.providers.split(',') : []
  if (providers.includes('discord')) methods.push('discord')
  if (providers.includes('google')) methods.push('google')
  return methods
}

const num = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value)

export interface UserRowContext {
  roles: ReadonlyMap<number, RoleRow>
  actor: Standing
  /** The caller holds `users.view_private`. */
  private: boolean
}

/** Whether the caller may see this user's private details. */
export function seesPrivate(context: UserRowContext, userId: number, position: number): boolean {
  if (!context.private) return false
  return userId === context.actor.userId || context.actor.position > position
}

export function userRowOf(row: Record<string, unknown>, context: UserRowContext): StaffUserRow {
  const ids = roleIdsOf(row.role_ids)
  const roles = ids
    .map((id) => context.roles.get(id))
    .filter((role): role is RoleRow => role !== undefined)
    .sort((a, b) => b.position - a.position)
    .map(roleRef)
  const id = Number(row.id)
  const out: StaffUserRow = {
    id,
    username: String(row.username),
    createdAt: Number(row.created_at),
    lastActiveAt: num(row.last_active_at),
    methods: methodsOf(row),
    roles,
    accounts: Number(row.accounts),
    snapshots: Number(row.snapshots),
    storedBytes: Number(row.stored),
    sectionBytes: Number(row.sections),
    catalogBytes: Number(row.catalog),
    wishBytes: Number(row.wish),
    wishPulls: Number(row.pulls),
    rawBytes: Number(row.raw),
    suspendedAt: num(row.suspended_at),
    uploadsBlockedAt: num(row.uploads_blocked_at),
    signupCountry: (row.signup_country as string | null) ?? null,
  }
  if (seesPrivate(context, id, positionOf(ids, context.roles))) {
    out.signupIp = (row.signup_ip as string | null) ?? null
    out.email = (row.email as string | null) ?? null
  }
  return out
}

export function rolesStatement(d1: D1Database): D1PreparedStatement {
  return d1.prepare(
    'SELECT id, name, color, position, permissions, built_in FROM roles ORDER BY position DESC, id',
  )
}

export function roleMap(result: D1Result | undefined): Map<number, RoleRow> {
  return new Map(
    (result?.results ?? []).map((row) => {
      const role = roleFromRow(row as Record<string, unknown>)
      return [role.id, role]
    }),
  )
}

// --------------------------------------------------------------------- users

export interface UserQuery {
  q: string
  filter: StaffUserFilter
  sort: StaffUserSort
  dir: 'asc' | 'desc'
  page: number
}

const SORT_SQL: Record<StaffUserSort, string> = {
  joined: 'u.created_at',
  active: 'last_active_at',
  name: 'u.username_key',
  accounts: 'accounts',
  snapshots: 'snapshots',
  storage: 'stored',
  wishes: 'wish',
  raw: 'raw',
}

/**
 * Active in the last week: signed in or refreshed (stamped at most hourly),
 * or an upload seen (Irminsul uploads without a browser session).
 */
function activeSql(args: Args, since: number): string {
  const at = args.add(since)
  return `(${lastActiveSql('u')} >= ${at} OR EXISTS (SELECT 1 FROM genshin_accounts AS ga
    JOIN snapshots AS ls ON ls.id = ga.latest_snapshot_id
    WHERE ga.user_id = u.id AND ls.last_seen_at >= ${at}))`
}

function filterSql(filter: StaffUserFilter, args: Args, now: number): string | null {
  switch (filter) {
    case 'all':
      return null
    case 'new':
      return `u.created_at >= ${args.add(now - 7 * DAY)}`
    case 'active':
      return activeSql(args, now - 7 * DAY)
    case 'none':
      return 'coalesce(t.snapshots, 0) = 0'
    case 'wishes':
      return 'coalesce(wi.pulls, 0) > 0'
    case 'wishesOnly':
      return '(coalesce(wi.pulls, 0) > 0 AND coalesce(t.snapshots, 0) = 0)'
    case 'suspended':
      return 'u.suspended_at IS NOT NULL'
    case 'staff':
      return 'EXISTS (SELECT 1 FROM user_roles AS sr WHERE sr.user_id = u.id)'
  }
}

/**
 * The search: name, UID or #id for everyone; email, IP and the Discord /
 * Google name or email only with `users.view_private`.
 */
function searchSql(q: string, args: Args, withPrivate: boolean): string | null {
  const text = q.trim().toLowerCase().slice(0, 100)
  if (!text) return null
  const like = args.add(`%${escapeLike(text)}%`)
  const parts = [
    `u.username_key LIKE ${like} ESCAPE '\\'`,
    `EXISTS (SELECT 1 FROM genshin_accounts AS sg WHERE sg.user_id = u.id AND sg.uid LIKE ${like} ESCAPE '\\')`,
  ]
  const id = /^#?(\d{1,15})$/.exec(text)
  if (id) parts.push(`u.id = ${args.add(Number(id[1]))}`)
  if (withPrivate) {
    parts.push(`u.email LIKE ${like} ESCAPE '\\'`)
    parts.push(`EXISTS (SELECT 1 FROM user_identities AS si WHERE si.user_id = u.id
      AND (lower(si.display_name) LIKE ${like} ESCAPE '\\' OR si.email LIKE ${like} ESCAPE '\\'))`)
    parts.push(ipSearchSql('u', args.add(text)))
  }
  return `(${parts.join(' OR ')})`
}

export async function listUsers(
  d1: D1Database,
  query: UserQuery,
  context: Omit<UserRowContext, 'roles'>,
  now = Date.now(),
): Promise<StaffUsersResponse> {
  const args = new Args()
  const search = searchSql(query.q, args, context.private)
  // The chips count with the search applied, each with its own condition.
  const countArgs = new Args()
  const countSearch = searchSql(query.q, countArgs, context.private)
  const chips = (
    ['new', 'active', 'none', 'wishes', 'wishesOnly', 'suspended', 'staff'] as const
  ).map(
    (filter) =>
      `sum(CASE WHEN ${filterSql(filter, countArgs, now)} THEN 1 ELSE 0 END) AS ${filter}`,
  )
  const filter = filterSql(query.filter, args, now)
  const where = [search, filter].filter(Boolean)
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const direction = query.dir === 'asc' ? 'ASC' : 'DESC'
  const order = `${SORT_SQL[query.sort]} ${direction} NULLS LAST, u.id ${direction}`
  const page = Math.max(1, query.page)
  const limit = args.add(STAFF_PAGE_SIZE)
  const offset = args.add((page - 1) * STAFF_PAGE_SIZE)

  const [rows, counts, roles] = await d1.batch<Record<string, unknown>>([
    d1
      .prepare(
        `WITH ${USER_TOTALS} SELECT ${USER_COLUMNS}, count(*) OVER () AS total ${FROM_USERS}
         ${whereSql} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`,
      )
      .bind(...args.values),
    d1
      .prepare(
        `WITH ${USER_TOTALS} SELECT count(*) AS all_users, ${chips.join(', ')} ${FROM_USERS}
         ${countSearch ? `WHERE ${countSearch}` : ''}`,
      )
      .bind(...countArgs.values),
    rolesStatement(d1),
  ])
  const map = roleMap(roles)
  const c = counts!.results[0] ?? {}
  const result = rows!.results
  // Past the last page there are no rows to carry the total: count it from the chips.
  const total = result.length
    ? Number(result[0]!.total)
    : query.filter === 'all'
      ? Number(c.all_users ?? 0)
      : Number(c[query.filter] ?? 0)
  return {
    users: result.map((row) => userRowOf(row, { ...context, roles: map })),
    total,
    page,
    pageSize: STAFF_PAGE_SIZE,
    counts: {
      all: Number(c.all_users ?? 0),
      new: Number(c.new ?? 0),
      active: Number(c.active ?? 0),
      none: Number(c.none ?? 0),
      wishes: Number(c.wishes ?? 0),
      wishesOnly: Number(c.wishesOnly ?? 0),
      suspended: Number(c.suspended ?? 0),
      staff: Number(c.staff ?? 0),
    } satisfies StaffUserCounts,
  }
}

/** The account rows of a user's detail page. */
export function accountsStatement(d1: D1Database, userId: number): D1PreparedStatement {
  return d1
    .prepare(
      `SELECT g.id, g.name, g.uid, g.server, g.created_at, g.snapshot_count, g.stored_bytes,
         g.raw_bytes, s.last_seen_at,
         (SELECT count(*) FROM snapshots AS d WHERE d.account_id = g.id AND d.deleted_at IS NOT NULL)
           AS trash,
         (SELECT coalesce(sum(length(c.data)), 0) FROM artifact_chunks AS c WHERE c.account_id = g.id)
           AS catalog_bytes,
         (SELECT coalesce(sum(c.count), 0) FROM artifact_chunks AS c WHERE c.account_id = g.id)
           AS catalog_count,
         (SELECT coalesce(sum(length(w.data)), 0) FROM wish_chunks AS w WHERE w.account_id = g.id)
           AS wish_bytes,
         (SELECT coalesce(sum(w.count), 0) FROM wish_chunks AS w WHERE w.account_id = g.id)
           AS wish_pulls,
         (SELECT h.updated_at FROM wish_histories AS h WHERE h.account_id = g.id) AS wish_updated_at
       FROM genshin_accounts AS g LEFT JOIN snapshots AS s ON s.id = g.latest_snapshot_id
       WHERE g.user_id = ?1 ORDER BY g.id`,
    )
    .bind(userId)
}

export function accountRowOf(row: Record<string, unknown>): StaffAccountRow {
  return {
    id: Number(row.id),
    name: (row.name as string | null) ?? null,
    uid: (row.uid as string | null) ?? null,
    server: (row.server as StaffAccountRow['server']) ?? null,
    createdAt: Number(row.created_at),
    snapshotCount: Number(row.snapshot_count),
    storedBytes: Number(row.stored_bytes),
    rawBytes: Number(row.raw_bytes),
    catalogBytes: Number(row.catalog_bytes ?? 0),
    catalogCount: Number(row.catalog_count ?? 0),
    wishBytes: Number(row.wish_bytes ?? 0),
    wishPulls: Number(row.wish_pulls ?? 0),
    wishUpdatedAt: num(row.wish_updated_at),
    trash: Number(row.trash ?? 0),
    lastUploadAt: num(row.last_seen_at),
  }
}

/** One user's row (as the list has it), their accounts, and every role. */
export async function loadUser(
  d1: D1Database,
  userId: number,
): Promise<{
  row: Record<string, unknown>
  accounts: StaffAccountRow[]
  roles: Map<number, RoleRow>
  roleIds: number[]
  position: number
} | null> {
  const [user, accounts, roles] = await d1.batch<Record<string, unknown>>([
    d1
      .prepare(`WITH ${USER_TOTALS} SELECT ${USER_COLUMNS} ${FROM_USERS} WHERE u.id = ?1`)
      .bind(userId),
    accountsStatement(d1, userId),
    rolesStatement(d1),
  ])
  const row = user!.results[0]
  if (!row) return null
  const map = roleMap(roles)
  const roleIds = roleIdsOf(row.role_ids)
  return {
    row,
    accounts: accounts!.results.map(accountRowOf),
    roles: map,
    roleIds,
    position: positionOf(roleIds, map),
  }
}

/** A user an action is about, with where they stand (the hierarchy check). */
export interface Target {
  /** As `outranks` names it. */
  userId: number
  username: string
  position: number
  liveSince: number | null
  suspendedAt: number | null
}

const TARGET_COLUMNS = `u.id, u.username, u.live_since, u.suspended_at,
  (SELECT json_group_array(role_id) FROM user_roles AS ur WHERE ur.user_id = u.id) AS role_ids`

function targetOf(row: Record<string, unknown>, roles: ReadonlyMap<number, RoleRow>): Target {
  return {
    userId: Number(row.id),
    username: String(row.username),
    position: positionOf(roleIdsOf(row.role_ids), roles),
    liveSince: num(row.live_since),
    suspendedAt: num(row.suspended_at),
  }
}

/** Users by id with where they stand: for bulk actions and the hierarchy check. */
export async function loadTargets(d1: D1Database, ids: readonly number[]): Promise<Target[]> {
  const [users, roles] = await d1.batch<Record<string, unknown>>([
    d1
      .prepare(
        `SELECT ${TARGET_COLUMNS} FROM users AS u WHERE u.id IN (SELECT value FROM json_each(?1))`,
      )
      .bind(JSON.stringify(ids)),
    rolesStatement(d1),
  ])
  const map = roleMap(roles)
  return users!.results.map((row) => targetOf(row, map))
}

/** A Genshin account and its owner (as a Target), or null. */
export async function loadAccountTarget(
  d1: D1Database,
  accountId: number,
): Promise<{
  account: { id: number; name: string | null; uid: string | null }
  owner: Target
} | null> {
  const [rows, roles] = await d1.batch<Record<string, unknown>>([
    d1
      .prepare(
        `SELECT g.name AS account_name, g.uid AS account_uid, ${TARGET_COLUMNS}
         FROM genshin_accounts AS g JOIN users AS u ON u.id = g.user_id WHERE g.id = ?1`,
      )
      .bind(accountId),
    rolesStatement(d1),
  ])
  const row = rows!.results[0]
  if (!row) return null
  return {
    account: {
      id: accountId,
      name: (row.account_name as string | null) ?? null,
      uid: (row.account_uid as string | null) ?? null,
    },
    owner: targetOf(row, roleMap(roles)),
  }
}

/** How an account is named in the audit log: its name, else its UID, else its id. */
export function accountLabel(account: { id: number; name: string | null; uid: string | null }) {
  return account.name?.trim() || (account.uid ? `UID ${account.uid}` : `#${account.id}`)
}

export async function identitiesOf(d1: D1Database, userId: number): Promise<IdentityResponse[]> {
  return listIdentities(d1, userId)
}

// ------------------------------------------------------------------ overview

const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** The last `count` UTC days, oldest first, each with `series` at 0. */
function emptyDays(now: number, count: number, series: string[]): DayCount[] {
  const today = Date.UTC(
    new Date(now).getUTCFullYear(),
    new Date(now).getUTCMonth(),
    new Date(now).getUTCDate(),
  )
  return Array.from({ length: count }, (_, i) => {
    const day: DayCount = { day: dayKey(today - (count - 1 - i) * DAY) }
    for (const name of series) day[name] = 0
    return day
  })
}

export async function overview(
  d1: D1Database,
  options: { users: boolean; private: boolean; actor: Standing },
  now = Date.now(),
): Promise<Omit<StaffOverviewResponse, 'site'>> {
  const startOfToday = Date.UTC(
    new Date(now).getUTCFullYear(),
    new Date(now).getUTCMonth(),
    new Date(now).getUTCDate(),
  )
  const since = startOfToday - 29 * DAY
  const week = now - 7 * DAY
  const activeArgs = new Args()
  const active = activeSql(activeArgs, week)
  // The provider a user signed up with: the identity made with the user (one batch, one `now`).
  const method = `CASE WHEN EXISTS (SELECT 1 FROM user_identities AS i WHERE i.user_id = u.id
      AND i.provider = 'discord' AND i.created_at = u.created_at) THEN 'discord'
    WHEN EXISTS (SELECT 1 FROM user_identities AS i WHERE i.user_id = u.id
      AND i.provider = 'google' AND i.created_at = u.created_at) THEN 'google'
    ELSE 'password' END`
  const statements = [
    d1
      .prepare(
        `SELECT (SELECT count(*) FROM users) AS users,
           (SELECT count(*) FROM users WHERE created_at >= ?1) AS users_today,
           (SELECT count(*) FROM users WHERE suspended_at IS NOT NULL) AS suspended,
           (SELECT count(*) FROM genshin_accounts) AS accounts,
           (SELECT coalesce(sum(snapshot_count), 0) FROM genshin_accounts) AS snapshots,
           (SELECT count(*) FROM snapshots WHERE created_at >= ?1) AS snapshots_today,
           (SELECT coalesce(sum(stored_bytes), 0) FROM genshin_accounts) AS sections,
           (SELECT coalesce(sum(raw_bytes), 0) FROM genshin_accounts) AS raw,
           (SELECT coalesce(sum(length(data)), 0) FROM artifact_chunks) AS catalog,
           (SELECT coalesce(sum(length(data)), 0) FROM wish_chunks) AS wish,
           (SELECT coalesce(sum(count), 0) FROM wish_chunks) AS pulls`,
      )
      .bind(startOfToday),
    d1.prepare(`SELECT count(*) AS n FROM users AS u WHERE ${active}`).bind(...activeArgs.values),
    d1
      .prepare(
        `SELECT strftime('%Y-%m-%d', u.created_at / 1000, 'unixepoch') AS day, ${method} AS method,
           count(*) AS n
         FROM users AS u WHERE u.created_at >= ?1 GROUP BY day, method`,
      )
      .bind(since),
    d1
      .prepare(
        `SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS day, count(*) AS n,
           coalesce(sum(stored_size), 0) AS bytes
         FROM snapshots WHERE created_at >= ?1 GROUP BY day`,
      )
      .bind(since),
    ...(options.users
      ? [
          d1
            .prepare(
              `SELECT u.id, u.username, u.created_at, ${method} AS method,
                 ${signupIpSql('u')} AS signup_ip, ${signupCountrySql('u')} AS signup_country,
                 (SELECT count(*) FROM genshin_accounts AS g WHERE g.user_id = u.id) AS accounts,
                 (SELECT json_group_array(role_id) FROM user_roles AS ur WHERE ur.user_id = u.id) AS role_ids,
                 CASE WHEN ${signupIpSql('u')} IS NULL THEN 0 ELSE
                   (SELECT count(*) FROM users AS o WHERE ${signupIpSql('o')} = ${signupIpSql('u')}
                      AND o.created_at BETWEEN u.created_at - 3600000 AND u.created_at + 3600000)
                 END AS same_ip
               FROM users AS u ORDER BY u.created_at DESC, u.id DESC LIMIT 8`,
            )
            .bind(),
          rolesStatement(d1),
        ]
      : []),
  ]
  const [totals, activeCount, signups, uploads, recent, roles] =
    await d1.batch<Record<string, unknown>>(statements)
  const t = totals!.results[0] ?? {}

  const signupDays = emptyDays(now, 30, ['password', 'discord', 'google'])
  const signupIndex = new Map(signupDays.map((d) => [d.day, d]))
  for (const row of signups!.results) {
    const day = signupIndex.get(String(row.day))
    if (day) day[String(row.method)] = Number(row.n)
  }
  const uploadDays = emptyDays(now, 30, ['stored', 'bytes'])
  const uploadIndex = new Map(uploadDays.map((d) => [d.day, d]))
  for (const row of uploads!.results) {
    const day = uploadIndex.get(String(row.day))
    if (!day) continue
    day.stored = Number(row.n)
    day.bytes = Number(row.bytes)
  }

  let recentRows: StaffRecentSignup[] | undefined
  if (recent) {
    const map = roleMap(roles)
    recentRows = recent.results.map((row) => {
      const id = Number(row.id)
      const out: StaffRecentSignup = {
        id,
        username: String(row.username),
        createdAt: Number(row.created_at),
        method: row.method as SignInMethod,
        accounts: Number(row.accounts),
        signupCountry: (row.signup_country as string | null) ?? null,
        // Others from the address: itself excluded.
        sameIp: Math.max(0, Number(row.same_ip) - 1),
      }
      const context = { roles: map, actor: options.actor, private: options.private }
      if (seesPrivate(context, id, positionOf(roleIdsOf(row.role_ids), map))) {
        out.signupIp = (row.signup_ip as string | null) ?? null
      }
      return out
    })
  }
  return {
    users: { total: Number(t.users ?? 0), today: Number(t.users_today ?? 0) },
    active7d: Number(activeCount!.results[0]?.n ?? 0),
    accounts: Number(t.accounts ?? 0),
    snapshots: { total: Number(t.snapshots ?? 0), today: Number(t.snapshots_today ?? 0) },
    storedBytes: Number(t.sections ?? 0) + Number(t.catalog ?? 0) + Number(t.wish ?? 0),
    storage: {
      sectionBytes: Number(t.sections ?? 0),
      catalogBytes: Number(t.catalog ?? 0),
      wishBytes: Number(t.wish ?? 0),
      wishPulls: Number(t.pulls ?? 0),
      rawBytes: Number(t.raw ?? 0),
    },
    suspended: Number(t.suspended ?? 0),
    signups: signupDays,
    uploads: uploadDays,
    ...(recentRows ? { recent: recentRows } : {}),
  }
}

// ------------------------------------------------------------------- storage

const WINDOW_MS: Record<StorageWindow, number> = { '24h': DAY, '7d': 7 * DAY, '30d': 30 * DAY }

const STORAGE_SORT_SQL: Record<StorageSort, string> = {
  growth: 'new_snapshots DESC, new_bytes DESC',
  stored: 'stored DESC',
  quota: 'stored * 1.0 / max(quota, 1) DESC',
  snapshots: 'snapshots DESC',
  wishes: 'wish DESC, pulls DESC',
  raw: 'raw DESC',
}

/** A user is near their quota from this share of it. */
export const NEAR_QUOTA = 0.8

export interface StorageQuery {
  window: StorageWindow
  sort: StorageSort
  flagged: boolean
  q: string
  page: number
}

/**
 * Users by how much they store and how fast it grows. Flags: near the quota
 * (≥ 80 %), the daily cap reached on any of the last 7 days (PR1), at the
 * number of accounts a user key stops making.
 */
export async function storage(
  d1: D1Database,
  query: StorageQuery,
  limits: Limits,
  now = Date.now(),
): Promise<StaffStorageResponse> {
  const args = new Args()
  const since = args.add(now - WINDOW_MS[query.window])
  const quota = quotaSql('u', limits.storageQuota)
  const near = args.add(NEAR_QUOTA)
  const accountLimit = args.add(AUTO_ACCOUNT_LIMIT)
  const where: string[] = []
  const text = query.q.trim().toLowerCase().slice(0, 100)
  if (text) {
    const like = args.add(`%${escapeLike(text)}%`)
    where.push(`(u.username_key LIKE ${like} ESCAPE '\\' OR EXISTS (SELECT 1 FROM genshin_accounts AS sg
      WHERE sg.user_id = u.id AND sg.uid LIKE ${like} ESCAPE '\\'))`)
  }
  const caps = dailyCapCte((value) => args.add(value), limits, now)
  const flaggedSql = `(stored >= quota * ${near} OR accounts >= ${accountLimit} OR cap_days > 0)`
  const page = Math.max(1, query.page)
  const base = `WITH ${USER_TOTALS},
    fresh AS (SELECT g.user_id, count(*) AS n, coalesce(sum(s.stored_size), 0) AS bytes
              FROM snapshots AS s JOIN genshin_accounts AS g ON g.id = s.account_id
              WHERE s.created_at >= ${since} GROUP BY g.user_id),
    trash AS (SELECT g.user_id, count(*) AS n FROM snapshots AS s
              JOIN genshin_accounts AS g ON g.id = s.account_id
              WHERE s.deleted_at IS NOT NULL GROUP BY g.user_id),
    ${caps ? `${caps},` : ''}
    per_user AS (SELECT u.id, u.username, u.uploads_blocked_at, u.suspended_at,
               u.storage_quota AS own_quota,
               coalesce(t.accounts, 0) AS accounts, coalesce(t.snapshots, 0) AS snapshots,
               ${STORAGE_COLUMNS},
               coalesce(f.n, 0) AS new_snapshots, coalesce(f.bytes, 0) AS new_bytes,
               coalesce(tr.n, 0) AS trash, ${quota} AS quota,
               ${caps ? 'coalesce(cp.days, 0)' : '0'} AS cap_days
             FROM users AS u ${TOTALS_JOINS}
             LEFT JOIN fresh AS f ON f.user_id = u.id
             LEFT JOIN trash AS tr ON tr.user_id = u.id
             ${caps ? 'LEFT JOIN caps AS cp ON cp.user_id = u.id' : ''}
             ${where.length ? `WHERE ${where.join(' AND ')}` : ''})`
  const limit = args.add(STAFF_PAGE_SIZE)
  const offset = args.add((page - 1) * STAFF_PAGE_SIZE)
  const [rows, totals, site] = await d1.batch<Record<string, unknown>>([
    d1
      .prepare(
        `${base} SELECT *, count(*) OVER () AS total FROM per_user
         ${query.flagged ? `WHERE ${flaggedSql}` : ''}
         ORDER BY ${STORAGE_SORT_SQL[query.sort]}, id LIMIT ${limit} OFFSET ${offset}`,
      )
      .bind(...args.values),
    d1
      .prepare(
        `${base} SELECT coalesce(sum(stored), 0) AS stored, coalesce(sum(new_bytes), 0) AS new_bytes,
           coalesce(sum(new_snapshots), 0) AS new_snapshots,
           coalesce(sum(stored >= quota * ${near}), 0) AS near_quota,
           coalesce(sum(${flaggedSql}), 0) AS flagged, count(*) AS users
         FROM per_user`,
      )
      .bind(...args.values.slice(0, -2)),
    // The site's split, whatever the search: the tiles above the table.
    d1.prepare(
      `SELECT (SELECT coalesce(sum(stored_bytes), 0) FROM genshin_accounts) AS sections,
         (SELECT coalesce(sum(raw_bytes), 0) FROM genshin_accounts) AS raw,
         (SELECT coalesce(sum(snapshot_count), 0) FROM genshin_accounts) AS snapshots,
         (SELECT coalesce(sum(length(data)), 0) FROM artifact_chunks) AS catalog,
         (SELECT coalesce(sum(count), 0) FROM artifact_chunks) AS pieces,
         (SELECT coalesce(sum(length(data)), 0) FROM wish_chunks) AS wish,
         (SELECT coalesce(sum(count), 0) FROM wish_chunks) AS pulls,
         (SELECT count(*) FROM wish_histories) AS histories`,
    ),
  ])
  const t = totals!.results[0] ?? {}
  const s = site!.results[0] ?? {}
  const result = rows!.results
  return {
    rows: result.map((row): StaffStorageRow => {
      const stored = Number(row.stored)
      const quotaBytes = Number(row.quota)
      const accounts = Number(row.accounts)
      const days = caps ? Number(row.cap_days) : null
      const flags: StaffStorageRow['flags'] = []
      if (stored >= quotaBytes * NEAR_QUOTA) flags.push('near_quota')
      if (days) flags.push('daily_cap')
      if (accounts >= AUTO_ACCOUNT_LIMIT) flags.push('account_limit')
      return {
        id: Number(row.id),
        username: String(row.username),
        accounts,
        snapshots: Number(row.snapshots),
        newSnapshots: Number(row.new_snapshots),
        newBytes: Number(row.new_bytes),
        storedBytes: stored,
        sectionBytes: Number(row.sections),
        catalogBytes: Number(row.catalog),
        wishBytes: Number(row.wish),
        wishPulls: Number(row.pulls),
        rawBytes: Number(row.raw),
        trash: Number(row.trash),
        quota: quotaBytes,
        ownQuota: row.own_quota === null ? null : Number(row.own_quota),
        uploadsBlocked: row.uploads_blocked_at !== null,
        suspended: row.suspended_at !== null,
        dailyCapDays: days,
        flags,
      }
    }),
    total: result.length ? Number(result[0]!.total) : 0,
    page,
    pageSize: STAFF_PAGE_SIZE,
    totals: {
      storedBytes: Number(t.stored ?? 0),
      newBytes: Number(t.new_bytes ?? 0),
      newSnapshots: Number(t.new_snapshots ?? 0),
      nearQuota: Number(t.near_quota ?? 0),
      sectionBytes: Number(s.sections ?? 0),
      catalogBytes: Number(s.catalog ?? 0),
      wishBytes: Number(s.wish ?? 0),
      snapshots: Number(s.snapshots ?? 0),
      rawBytes: Number(s.raw ?? 0),
      catalogCount: Number(s.pieces ?? 0),
      wishPulls: Number(s.pulls ?? 0),
      histories: Number(s.histories ?? 0),
    },
    flagged: Number(t.flagged ?? 0),
    defaultQuota: limits.storageQuota,
  }
}
