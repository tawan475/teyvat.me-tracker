import {
  serverFromUid,
  type AccountAccess,
  type AccountResponse,
  type GenshinServer,
} from '@gdt/shared'
import { and, eq, isNotNull, or } from 'drizzle-orm'
import type { Db } from '../db/client'
import { accountMembers, genshinAccounts } from '../db/schema'
import { randomToken, sha256Hex } from '../lib/crypto'
import { ApiError, notFound } from '../lib/http'
import { D1Meter } from '../lib/meter'
import { metaOf, withLegacySchema } from './storage'

export type AccountRow = typeof genshinAccounts.$inferSelect

/**
 * What a route needs of the user on an account (account sharing,
 * docs/plans/account-sharing.md): `view` any access, `edit` the owner or an
 * editor, `own` the owner.
 */
export type AccountNeed = 'view' | 'edit' | 'own'

export const ownerOnly = () =>
  new ApiError(403, 'owner_only', "Only the account's owner can do this")
export const sharedReadOnly = () =>
  new ApiError(403, 'account_read_only', 'This account is shared with you to view only')

/** 403 when `access` falls short of `need`. */
export function requireAccess(access: AccountAccess, need: AccountNeed): void {
  if (need === 'own' && access !== 'owner') throw ownerOnly()
  if (need === 'edit' && access === 'viewer') throw sharedReadOnly()
}

/** The member row that gives `userId` access to the account (accepted invites only). */
const memberOf = (userId: number) =>
  and(
    eq(accountMembers.accountId, genshinAccounts.id),
    eq(accountMembers.userId, userId),
    isNotNull(accountMembers.acceptedAt),
  )

/**
 * Loads an account `userId` owns or was shared, with their `access`, in one
 * query; 404 when they have none (a stranger can't tell it exists), 403 when
 * it falls short of `need`.
 */
export async function loadAccount(
  db: Db,
  userId: number,
  accountId: number,
  need: AccountNeed,
): Promise<AccountRow & { access: AccountAccess }> {
  const [row] = await db
    .select({ account: genshinAccounts, role: accountMembers.role })
    .from(genshinAccounts)
    .leftJoin(accountMembers, memberOf(userId))
    .where(
      and(
        eq(genshinAccounts.id, accountId),
        or(eq(genshinAccounts.userId, userId), isNotNull(accountMembers.userId)),
      ),
    )
    .limit(1)
  if (!row) throw notFound('Account')
  const access: AccountAccess = row.account.userId === userId ? 'owner' : (row.role ?? 'viewer')
  requireAccess(access, need)
  return { ...row.account, access }
}

/**
 * The access check alone, reading two columns, for routes that don't need
 * the row (`loadAccount` selects all of it, settings JSON included).
 */
export async function assertAccount(
  db: Db,
  userId: number,
  accountId: number,
  need: AccountNeed,
): Promise<AccountAccess> {
  const [row] = await db
    .select({ owner: genshinAccounts.userId, role: accountMembers.role })
    .from(genshinAccounts)
    .leftJoin(accountMembers, memberOf(userId))
    .where(
      and(
        eq(genshinAccounts.id, accountId),
        or(eq(genshinAccounts.userId, userId), isNotNull(accountMembers.userId)),
      ),
    )
    .limit(1)
  if (!row) throw notFound('Account')
  const access: AccountAccess = row.owner === userId ? 'owner' : (row.role ?? 'viewer')
  requireAccess(access, need)
  return access
}

/**
 * SQL for the accounts `user` (a bound parameter, `?1` by default) may use:
 * owned ones (by the user index) and ones shared with them (by
 * account_members' user index), each row `columns` (over `a`, the account,
 * and whatever `join` adds) plus `role` ('owner' | 'editor' | 'viewer') and
 * `owner_name` (NULL on owned ones), filtered by `where`, ordered by `a.id`
 * (`columns` must start with it).
 */
export function accessibleAccountsSql(
  columns: string,
  { user = '?1', where = '1', join = '' }: { user?: string; where?: string; join?: string } = {},
): string {
  return `SELECT ${columns}, 'owner' AS role, NULL AS owner_name
    FROM genshin_accounts AS a ${join}
    WHERE a.user_id = ${user} AND (${where})
  UNION ALL
  SELECT ${columns}, m.role AS role, o.username AS owner_name
    FROM account_members AS m JOIN genshin_accounts AS a ON a.id = m.account_id
    JOIN users AS o ON o.id = a.user_id ${join}
    WHERE m.user_id = ${user} AND m.accepted_at IS NOT NULL AND (${where})
  ORDER BY 1`
}

export interface AccountListRow {
  id: number
  name: string | null
  uid: string | null
  server: GenshinServer | null
  created_at: number
  data_version: number
  snapshot_count: number
  raw_bytes: number
  stored_bytes: number
  latest_id: number | null
  taken_at: number | null
  last_seen_at: number | null
  summary?: string | null
  meta: unknown
  /** The newest time a part was removed from the account's history (settings `parts.removed`). */
  parts_removed?: number | null
  role: AccountAccess
  owner_name: string | null
}

/**
 * The newest "removed from history" time in the account's settings: the
 * device caches of history packs key on it (src/data/account-data.ts), as a
 * removal rewrites stored snapshots without changing their ids or times.
 */
const PARTS_REMOVED_SQL = `(SELECT max(value) FROM json_each(
  CASE WHEN json_valid(a.settings) THEN a.settings ELSE '{}' END, '$.parts.removed'))`

/**
 * `genshin_accounts.settings` with a JSON merge patch (the bound parameter
 * `param`) laid over it, for `UPDATE genshin_accounts SET settings = …`. The
 * merge happens in the statement, on the row as stored at that moment, so
 * writers of different keys (a settings save, a hidden note, a removed part)
 * never write back a copy read before another's write. It merges as
 * deepMerge does: objects key by key, lists and scalars replaced. A null in
 * the patch removes the key, which then reads as its default: null for
 * every setting that can be null (ar, wl, resin).
 */
export const patchedSettingsSql = (param: string): string =>
  `json_patch(CASE WHEN json_valid(settings) THEN settings ELSE '{}' END, ${param})`

/** Lays `patch` over an account's settings (patchedSettingsSql) and answers them as written. */
export function patchSettingsStatement(
  d1: D1Database,
  accountId: number,
  patch: object,
): D1PreparedStatement {
  return d1
    .prepare(
      `UPDATE genshin_accounts SET settings = ${patchedSettingsSql('?2')}
       WHERE id = ?1 RETURNING settings`,
    )
    .bind(accountId, JSON.stringify(patch))
}

/** What patchSettingsStatement wrote: the settings as stored (no defaults). */
export function writtenSettings(result: D1Result | undefined): object {
  const row = (result?.results ?? [])[0] as { settings?: unknown } | undefined
  // Deleted between the access check and the write.
  if (typeof row?.settings !== 'string') throw notFound('Account')
  return JSON.parse(row.settings) as object
}

/** The account list's query (see listAccounts); `accountId` narrows it to one. */
export function accountListStatement(
  d1: D1Database,
  userId: number,
  accountId: number | null,
  legacy: boolean,
): D1PreparedStatement {
  return d1
    .prepare(
      accessibleAccountsSql(
        `a.id, a.name, a.uid, a.server, a.created_at, a.data_version, a.snapshot_count,
         a.raw_bytes, a.stored_bytes, s.id AS latest_id, s.taken_at, s.last_seen_at,
         ${legacy ? 's.summary, ' : ''}s.meta, ${PARTS_REMOVED_SQL} AS parts_removed`,
        {
          join: 'LEFT JOIN snapshots AS s ON s.id = a.latest_snapshot_id',
          where: '?2 IS NULL OR a.id = ?2',
        },
      ),
    )
    .bind(userId, accountId)
}

/** The rows of `accountListStatement` as the API answers them. */
export function accountsFromRows(rows: readonly AccountListRow[]): AccountResponse[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    uid: row.uid,
    server: row.server,
    createdAt: row.created_at,
    dataVersion: row.data_version,
    snapshotCount: row.snapshot_count,
    rawBytes: row.raw_bytes,
    storedBytes: row.stored_bytes,
    latest:
      row.latest_id === null
        ? null
        : (() => {
            const meta = metaOf(row)
            return {
              id: row.latest_id,
              takenAt: row.taken_at!,
              lastSeenAt: row.last_seen_at!,
              summary: meta.summary,
              source: meta.source,
            }
          })(),
    liveSync: true,
    ...(typeof row.parts_removed === 'number' && row.parts_removed > 0
      ? { partsRemovedAt: row.parts_removed }
      : {}),
    access: row.role,
    ...(row.owner_name !== null ? { owner: row.owner_name } : {}),
  }))
}

/**
 * Accounts with their latest snapshot: one round trip, reading each account
 * (by the user index) and its latest snapshot (by primary key). The app also
 * re-reads this list to catch up after missing live events, so it stays this
 * cheap.
 */
export async function listAccounts(
  d1: D1Database,
  userId: number,
  accountId?: number,
  meter = new D1Meter(),
): Promise<AccountResponse[]> {
  const result = await withLegacySchema(async (legacy) => {
    const [rows] = await meter.batch<AccountListRow>(d1, 'accounts', [
      accountListStatement(d1, userId, accountId ?? null, legacy),
    ])
    return rows
  })
  return accountsFromRows(result!.results)
}

/**
 * Bumps the account's data version and re-points its latest snapshot. Run in
 * the same batch as any snapshot write; it answers with the new version (for
 * the live event). The counters (snapshot_count, raw_bytes, stored_bytes) are
 * kept by triggers (migration 0002), and the latest-snapshot lookup reads one
 * index row.
 */
export function recomputeAccount(d1: D1Database, accountId: number): D1PreparedStatement {
  return d1
    .prepare(
      `UPDATE genshin_accounts SET
         data_version = data_version + 1,
         latest_snapshot_id = (SELECT id FROM snapshots WHERE account_id = ?1 AND deleted_at IS NULL
                               ORDER BY taken_at DESC, id DESC LIMIT 1)
       WHERE id = ?1 RETURNING data_version`,
    )
    .bind(accountId)
}

/** The data version a batch's `recomputeAccount` statement answered with. */
export function dataVersionOf(result: D1Result | undefined): number | undefined {
  const value = (result?.results[0] as { data_version?: unknown } | undefined)?.data_version
  return typeof value === 'number' ? value : undefined
}

/** An account's own key: uploads always go to that account. */
const ACCOUNT_KEY_PREFIX = 'gdt_ik_'
/** A user's key: uploads go to their account with the capture's UID. */
const USER_KEY_PREFIX = 'gdt_uk_'

/**
 * A fresh import key and the hash that is stored for it. The prefix only
 * tells people (and logs) the two kinds apart; lookups go by hash.
 */
export async function newImportKey(
  scope: 'account' | 'user' = 'account',
): Promise<{ key: string; hash: string }> {
  const key = (scope === 'user' ? USER_KEY_PREFIX : ACCOUNT_KEY_PREFIX) + randomToken(32)
  return { key, hash: await sha256Hex(key) }
}

export function hashImportKey(key: string): Promise<string> {
  return sha256Hex(key.trim())
}

/** What an import key upload needs to know about an account. */
export interface KeyAccount {
  id: number
  name: string | null
  uid: string | null
  server: GenshinServer | null
  /** The owner's user id: storage, quotas and the live journal count for them. */
  user_id?: number
  /** The uploader's access, on lists that include accounts shared with them. */
  role?: AccountAccess
}

/**
 * SQL: whether `user` may upload to (edit) `account`: its owner or an editor.
 * Both are SQL expressions (bound parameters or columns).
 */
export const editableBy = (account: string, user: string) =>
  `(EXISTS (SELECT 1 FROM genshin_accounts WHERE id = ${account} AND user_id = ${user})
    OR EXISTS (SELECT 1 FROM account_members WHERE account_id = ${account} AND user_id = ${user}
      AND role = 'editor' AND accepted_at IS NOT NULL))`

/**
 * Where a capture of `uid` goes among the uploader's accounts: their own with
 * that UID, else the one shared with them as editor; null when neither (a
 * user key then makes one). 403 when only a view-only shared one matches
 * (no silent second account), 409 when two of one kind do.
 */
export function pickByUid(accounts: readonly KeyAccount[], uid: string): KeyAccount | null {
  const matches = accounts.filter((a) => a.uid?.trim() === uid)
  const own = matches.filter((a) => (a.role ?? 'owner') === 'owner')
  if (own.length > 1) throw ambiguousUid(uid)
  if (own.length === 1) return own[0]!
  const editable = matches.filter((a) => a.role === 'editor')
  if (editable.length > 1) throw ambiguousUid(uid)
  if (editable.length === 1) return editable[0]!
  if (matches.length) throw sharedReadOnly()
  return null
}

/**
 * Why staff stopped the owner's uploads: a suspended user's key is refused
 * outright, a blocked one only for uploads (routes/public).
 */
export type KeyBlock = 'suspended' | 'uploads_blocked' | null

/**
 * Who an upload is for (an import key's owner, or a signed-in irminsul's
 * session): one account, or the user's account by the file's UID.
 */
export type UploadOwner =
  | { scope: 'account'; account: KeyAccount; userId: number }
  | {
      scope: 'user'
      user: { id: number; username: string }
      /** All of the user's accounts: few rows, and read in the same round trip. */
      accounts: KeyAccount[]
    }

export type ImportKeyOwner = { blocked: KeyBlock } & UploadOwner

/** 403 for a stopped user's upload (irminsul shows the message). */
export function uploadsRefused(block: 'suspended' | 'uploads_blocked'): ApiError {
  return block === 'suspended'
    ? new ApiError(403, 'account_suspended', 'This account is suspended')
    : new ApiError(
        403,
        'uploads_blocked',
        'Uploads to this account are blocked. Ask on Discord if you think it is a mistake.',
      )
}

function blockOf(row: { suspended_at?: unknown; uploads_blocked_at?: unknown }): KeyBlock {
  if (row.suspended_at !== null && row.suspended_at !== undefined) return 'suspended'
  if (row.uploads_blocked_at !== null && row.uploads_blocked_at !== undefined) {
    return 'uploads_blocked'
  }
  return null
}

/**
 * Who an import key (by hash) belongs to: an account first, then a user. One
 * D1 round trip either way.
 */
export async function findImportKeyOwner(
  d1: D1Database,
  hash: string,
): Promise<ImportKeyOwner | null> {
  const [account, user, accounts] = await d1.batch<Record<string, unknown>>([
    d1
      .prepare(
        `SELECT a.id, a.name, a.uid, a.server, a.user_id, u.suspended_at,
           u.uploads_blocked_at
         FROM genshin_accounts AS a JOIN users AS u ON u.id = a.user_id
         WHERE a.import_key_hash = ?1`,
      )
      .bind(hash),
    d1
      .prepare(
        'SELECT id, username, suspended_at, uploads_blocked_at FROM users WHERE import_key_hash = ?1',
      )
      .bind(hash),
    d1
      .prepare(
        accessibleAccountsSql(`a.id, a.name, a.uid, a.server, a.user_id`, {
          user: '(SELECT id FROM users WHERE import_key_hash = ?1)',
        }),
      )
      .bind(hash),
  ])
  const ownAccount = account!.results[0] as
    | (KeyAccount & { user_id: number; suspended_at: unknown; uploads_blocked_at: unknown })
    | undefined
  if (ownAccount) {
    const { suspended_at, uploads_blocked_at, ...rest } = ownAccount
    const userId = rest.user_id
    return {
      scope: 'account',
      account: rest,
      userId,
      blocked: blockOf({ suspended_at, uploads_blocked_at }),
    }
  }
  const owner = user!.results[0] as
    | { id: number; username: string; suspended_at: unknown; uploads_blocked_at: unknown }
    | undefined
  if (!owner) return null
  return {
    blocked: blockOf(owner),
    scope: 'user',
    user: { id: owner.id, username: owner.username },
    accounts: accounts!.results as unknown as KeyAccount[],
  }
}

/**
 * The user's account with this UID, made when there is none (no name, so the
 * app shows the UID; the server read off the UID). Two first uploads at once
 * cannot make two: the (user_id, uid) unique index lets one INSERT through and
 * both read the row back in the same batch.
 */
/**
 * An upload to a picked account (an account key, or a device set to one
 * account) gives it the capture's UID: a mistyped or old UID is replaced and
 * the server follows (the user's rule: picking an account means "this data is
 * that account"). Only over a UID that is set (an empty one the import fills).
 * Not on an account shared with the uploader (its identity is
 * the owner's), nor when another of the owner's accounts has that UID (they
 * stay apart; the upload warns as before). True when the UID changed;
 * `account` then carries the new one.
 */
export async function takeAccountUid(
  d1: D1Database,
  meter: D1Meter,
  account: KeyAccount,
  uid: string,
): Promise<boolean> {
  const linked = account.uid?.trim()
  // No UID yet: the import fills it as for any account (with the name and server).
  if (!linked || linked === uid || (account.role ?? 'owner') !== 'owner') return false
  const server = serverFromUid(uid)
  const [updated] = await meter.batch(d1, 'uid', [
    d1
      .prepare(
        `UPDATE genshin_accounts SET uid = ?2, server = coalesce(?3, server)
         WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM genshin_accounts AS o
           WHERE o.user_id = genshin_accounts.user_id AND o.uid = ?2 AND o.id <> ?1)
         RETURNING id`,
      )
      .bind(account.id, uid, server),
  ])
  if (!updated?.results.length) return false
  account.uid = uid
  if (server) account.server = server
  return true
}

export async function accountForUid(
  d1: D1Database,
  meter: D1Meter,
  userId: number,
  uid: string,
  accounts: readonly KeyAccount[],
): Promise<{ account: KeyAccount; created: boolean }> {
  const picked = pickByUid(accounts, uid)
  if (picked) return { account: picked, created: false }
  // A leaked user key must not mint accounts without end (the import rate
  // limit alone allows 60 a minute). Accounts made by hand are not capped.
  const owned = accounts.filter((a) => (a.role ?? 'owner') === 'owner').length
  if (owned >= AUTO_ACCOUNT_LIMIT) {
    throw new ApiError(
      409,
      'account_limit',
      `You already have ${owned} accounts, so a new one for UID ${uid} was not made. Create it yourself, or use its account key.`,
    )
  }

  // The account still gets a key of its own (the column is required); nobody
  // sees this one, and rotating it in account settings shows a new one.
  const { hash } = await newImportKey()
  const [inserted, found] = await meter.batch(d1, 'account', [
    d1
      .prepare(
        `INSERT INTO genshin_accounts (user_id, name, uid, server, import_key_hash, settings, created_at)
         VALUES (?1, NULL, ?2, ?3, ?4, '{}', ?5)
         ON CONFLICT DO NOTHING RETURNING id`,
      )
      .bind(userId, uid, serverFromUid(uid), hash, Date.now()),
    d1
      .prepare(
        `SELECT a.id, a.name, a.uid, a.server, a.user_id FROM genshin_accounts AS a
         WHERE a.user_id = ?1 AND a.uid = ?2`,
      )
      .bind(userId, uid),
  ])
  const rows = found!.results as unknown as KeyAccount[]
  if (rows.length > 1) throw ambiguousUid(uid)
  // Only a clash of the random key hash could ignore the INSERT and leave none.
  if (rows.length === 0) throw new Error(`No account for UID ${uid} after inserting one`)
  return { account: rows[0]!, created: inserted!.results.length > 0 }
}

/** Accounts a user may have before a user-key upload stops making new ones. */
export const AUTO_ACCOUNT_LIMIT = 20

const ambiguousUid = (uid: string) =>
  new ApiError(
    409,
    'ambiguous_uid',
    `More than one of your accounts has UID ${uid}. Give each a different UID, or use the account's own key.`,
  )

/** Account create/update that would give two of a user's accounts one UID. */
export const uidTaken = () =>
  new ApiError(409, 'uid_taken', 'Another of your accounts already has this UID', [
    { path: 'uid', message: 'Another account has this UID' },
  ])
