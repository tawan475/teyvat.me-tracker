/**
 * Upload quotas per user (migration 0018), on top of the per-file caps
 * (GOOD_LIMITS in @gdt/shared, checked while parsing) and the per-minute rate
 * limits (wrangler.jsonc):
 * - a daily quota (UTC day) of new snapshots and newly stored bytes, counted
 *   in `user_upload_days` by the import's own write batch: 429
 *   `daily_upload_limit`, with Retry-After at the next UTC midnight;
 * - a storage quota: the stored sections of all the user's accounts plus
 *   their artifact catalog chunks and wish history chunks (snapshot rows'
 *   small `meta` is left out:
 *   summing it would read every snapshot row on every import): 413
 *   `storage_quota`.
 * The defaults are UPLOAD_LIMIT_DEFAULTS; a `site_settings` row overrides one
 * for everybody, and `users.storage_quota` one user's storage quota.
 *
 * Only an upload that is about to store something is checked: a re-upload of
 * a stored capture, or the same inventory seen again, stores nothing and is
 * never refused. The usage is read in the import's first batch, so checking
 * and counting add no D1 round trip. A limit refuses uploads once it is
 * reached: the upload that crosses it is stored whole (one file, at most
 * 10 MB before compression), so a concurrent pair can pass it by a file.
 */

import { ApiError } from '../lib/http'

const MB = 1024 * 1024

export const UPLOAD_LIMIT_DEFAULTS = {
  /** New snapshots a user may store per UTC day (all accounts together). */
  dailySnapshots: 1_000,
  /** Bytes (sections + catalog chunks) a user may newly store per UTC day. */
  dailyBytes: 20 * MB,
  /** Bytes a user may store in total. */
  storageQuota: 200 * MB,
}

export type UploadLimits = typeof UPLOAD_LIMIT_DEFAULTS

/**
 * The `site_settings` key of each default; the value is a non-negative
 * integer as text. Anything else is ignored (the default applies).
 */
export const UPLOAD_SETTING_KEYS: Readonly<Record<keyof UploadLimits, string>> = {
  dailySnapshots: 'upload.daily_snapshots',
  dailyBytes: 'upload.daily_bytes',
  storageQuota: 'upload.storage_quota',
}

/**
 * The `site_settings` key of the switch that lets imports store exact
 * artifact rolls (README "Exact artifact rolls"): the text `1` (spaces
 * around it ignored) turns it on, anything else or no row leaves it off
 * (the default). Read in the import's
 * lookup batch with the limits. While off, nothing writes rolls, so no
 * catalog chunk of format 3 or 4 comes to exist; reading them works either
 * way. Once on, the Worker must never go back to a build that cannot read
 * those formats.
 */
export const ROLLS_STORE_KEY = 'rolls.store'

/**
 * SQL that is true while the `rolls.store` switch is on: the one reading of
 * it, used by `usageStatement` and by the held-list mark's query, so the two
 * can never disagree about a value.
 */
export const ROLLS_STORE_ON_SQL = `EXISTS (SELECT 1 FROM site_settings
  WHERE key = '${ROLLS_STORE_KEY}' AND trim(value) = '1')`

/** Days of `user_upload_days` maintenance keeps. */
export const UPLOAD_DAYS_KEPT = 90

/** What a user has stored, today and in all, and the limits that apply to them. */
export interface UploadUsage {
  daySnapshots: number
  dayBytes: number
  storedBytes: number
  limits: UploadLimits
  /** The `rolls.store` switch (ROLLS_STORE_KEY) is on. */
  storeRolls: boolean
}

/** The UTC day of `now`, as `user_upload_days.day` names it. */
export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
}

/** Whole seconds from `now` until the next UTC midnight (at least 1). */
export function secondsToNextUtcDay(now: number): number {
  const next = Date.UTC(
    new Date(now).getUTCFullYear(),
    new Date(now).getUTCMonth(),
    new Date(now).getUTCDate() + 1,
  )
  return Math.max(1, Math.ceil((next - now) / 1000))
}

const SETTING_KEYS_SQL = Object.values(UPLOAD_SETTING_KEYS)
  .map((key) => `'${key}'`)
  .join(', ')

/**
 * The usage of the user who owns account ?1 on day ?2, and the overrides of
 * the limits, as one row: the user and account by key, the user's accounts
 * by the user index, their chunks (catalog and wishes) by the account
 * index, the day by key.
 */
export function usageStatement(
  d1: D1Database,
  accountId: number,
  day: string,
): D1PreparedStatement {
  return d1
    .prepare(
      `SELECT u.storage_quota,
         (SELECT coalesce(sum(g.stored_bytes), 0) FROM genshin_accounts AS g
          WHERE g.user_id = u.id)
         + (SELECT coalesce(sum(length(c.data)), 0) FROM genshin_accounts AS g
            JOIN artifact_chunks AS c ON c.account_id = g.id WHERE g.user_id = u.id)
         + (SELECT coalesce(sum(length(w.data)), 0) FROM genshin_accounts AS g
            JOIN wish_chunks AS w ON w.account_id = g.id WHERE g.user_id = u.id)
           AS stored_bytes,
         coalesce(d.snapshots, 0) AS day_snapshots, coalesce(d.stored_bytes, 0) AS day_bytes,
         (SELECT json_group_object(s.key, s.value) FROM site_settings AS s
          WHERE s.key IN (${SETTING_KEYS_SQL})) AS settings,
         ${ROLLS_STORE_ON_SQL} AS rolls_store
       FROM genshin_accounts AS a JOIN users AS u ON u.id = a.user_id
       LEFT JOIN user_upload_days AS d ON d.user_id = u.id AND d.day = ?2
       WHERE a.id = ?1`,
    )
    .bind(accountId, day)
}

/** A `usageStatement` row; null when the account is gone. */
export function readUsage(row: Record<string, unknown> | undefined): UploadUsage | null {
  if (!row) return null
  const settings = parseSettings(row.settings)
  const limits = { ...UPLOAD_LIMIT_DEFAULTS }
  for (const name of Object.keys(limits) as (keyof UploadLimits)[]) {
    const value = limitValue(settings[UPLOAD_SETTING_KEYS[name]])
    if (value !== null) limits[name] = value
  }
  const own = limitValue(row.storage_quota)
  if (own !== null) limits.storageQuota = own
  return {
    daySnapshots: Number(row.day_snapshots),
    dayBytes: Number(row.day_bytes),
    storedBytes: Number(row.stored_bytes),
    limits,
    storeRolls: Number(row.rolls_store) === 1,
  }
}

function parseSettings(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return {}
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** A limit as stored (text in site_settings, an integer in users): a non-negative integer, else null. */
function limitValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(String(value).trim())
  return Number.isSafeInteger(n) && n >= 0 ? n : null
}

/** Refuses an upload that would store something once a limit is reached. */
export function assertCanStore(usage: UploadUsage | null, now: number): void {
  if (!usage) return
  const { limits } = usage
  if (usage.storedBytes >= limits.storageQuota) {
    throw new ApiError(
      413,
      'storage_quota',
      `Storage full: your accounts store ${formatBytes(usage.storedBytes)} of the ` +
        `${formatBytes(limits.storageQuota)} allowed, so new snapshots are not stored.`,
    )
  }
  if (usage.daySnapshots >= limits.dailySnapshots || usage.dayBytes >= limits.dailyBytes) {
    const wait = secondsToNextUtcDay(now)
    const hours = Math.floor(wait / 3600)
    const minutes = Math.ceil((wait % 3600) / 60)
    throw new ApiError(
      429,
      'daily_upload_limit',
      `Daily upload limit reached (${limits.dailySnapshots.toLocaleString('en-US')} new ` +
        `snapshots or ${formatBytes(limits.dailyBytes)} a day). It resets at 00:00 UTC, in ` +
        `${hours > 0 ? `${hours} h ` : ''}${minutes} min.`,
      undefined,
      { 'Retry-After': String(wait) },
    )
  }
}

function formatBytes(bytes: number): string {
  if (bytes < MB) return `${Math.ceil(bytes / 1024).toLocaleString('en-US')} KB`
  return `${Number((bytes / MB).toFixed(1)).toLocaleString('en-US')} MB`
}

/**
 * Counts a stored upload in the user's day, in the batch that stores it:
 * only once the snapshot row is there (a batch that lost its sections to a
 * concurrent collection inserts none, and is retried).
 */
export function countUploadStatement(
  d1: D1Database,
  accountId: number,
  day: string,
  bytes: number,
  snapshot: { takenAt: number; contentKey: number },
): D1PreparedStatement {
  return d1
    .prepare(
      `INSERT INTO user_upload_days (user_id, day, snapshots, stored_bytes)
       SELECT a.user_id, ?2, 1, ?3 FROM genshin_accounts AS a
       WHERE a.id = ?1 AND EXISTS (SELECT 1 FROM snapshots
         WHERE account_id = ?1 AND taken_at = ?4 AND deleted_at IS NULL AND content_key = ?5)
       ON CONFLICT (user_id, day) DO UPDATE SET
         snapshots = snapshots + 1, stored_bytes = stored_bytes + excluded.stored_bytes`,
    )
    .bind(accountId, day, bytes, snapshot.takenAt, snapshot.contentKey)
}

/**
 * Counts a wish import's newly stored bytes in the user's day (no snapshot),
 * in the batch that stores them: only when that batch's version bump went
 * through (`wish_histories.version` is now ?4).
 */
export function countWishBytesStatement(
  d1: D1Database,
  accountId: number,
  day: string,
  bytes: number,
  version: number,
): D1PreparedStatement {
  return d1
    .prepare(
      `INSERT INTO user_upload_days (user_id, day, snapshots, stored_bytes)
       SELECT a.user_id, ?2, 0, ?3 FROM genshin_accounts AS a
       WHERE a.id = ?1 AND (SELECT version FROM wish_histories WHERE account_id = ?1) = ?4
       ON CONFLICT (user_id, day) DO UPDATE SET stored_bytes = stored_bytes + excluded.stored_bytes`,
    )
    .bind(accountId, day, bytes, version)
}
