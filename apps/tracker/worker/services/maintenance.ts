/**
 * Daily housekeeping, run by the cron trigger in wrangler.jsonc.
 *
 * - Deleted snapshots are kept for TRASH_DAYS (deleting is a soft delete, so a
 *   mistaken bulk delete can still be restored by hand), then purged.
 * - Sections no snapshot references any more (live or in the trash), as a
 *   section or as the base of one, are garbage-collected: v1 blobs by hash,
 *   v2 section blobs by id (one pass over the snapshot rows, no index needed).
 *   Sections are shared between snapshots, which is why a delete cannot free
 *   them on the spot.
 * - One-time links (auth_tokens) and irminsul's sign-in codes (oauth_codes)
 *   are purged a day after they expired; used ones go then too. Answered
 *   passkey challenges go once they expired (an expired one is refused anyway).
 * - Upload days (the daily upload quota's counts) older than UPLOAD_DAYS_KEPT
 *   are purged.
 * - Session rows (user_sessions, with their IPs) are deleted SESSION_KEEP_DAYS
 *   after they ended (revoked or expired); sign-up IPs are cleared
 *   SIGNUP_IP_DAYS after the sign-up (the country stays).
 * - When REPACK_CRON_LIMIT is set (a number), up to that many v1 rows are
 *   converted to storage format v2 (services/repack.ts). Off by default: the
 *   first conversion is started by hand, after a backup.
 *
 * Account counters stay exact through all of this: the triggers from
 * migrations 0002 and 0016 adjust them for every row actually deleted.
 */

import { KEEP_EXPIRED_MS } from './auth-tokens'
import { CODE_KEEP_MS } from './irminsul'
import { COLLECT_LEGACY_BLOBS, repack, type RepackResult } from './repack'
import { REFS_SQL, withLegacySchema } from './storage'
import { expiredInvitesStatement } from './sharing'
import { UPLOAD_DAYS_KEPT, utcDay } from './upload-limits'

export const TRASH_DAYS = 30
export const SESSION_KEEP_DAYS = 7
export const SIGNUP_IP_DAYS = 90

export interface MaintenanceResult {
  snapshots: number
  /** v1 and v2 sections collected. */
  blobs: number
  tokens: number
  uploadDays: number
  sessions: number
  signupIps: number
  /** Account-sharing invites nobody accepted in time. */
  invites: number
  repack?: RepackResult
}

/**
 * v2 sections no snapshot row names, directly or as the base (or the base's
 * dictionary) of one it names; a row per blob deleted.
 */
export const COLLECT_SECTION_BLOBS = `WITH RECURSIVE live(id) AS (
    SELECT j.value FROM snapshots AS s, json_each(json_array(${REFS_SQL})) AS j
    WHERE j.value IS NOT NULL
    UNION SELECT b.base_id FROM section_blobs AS b JOIN live ON b.id = live.id
      WHERE b.base_id IS NOT NULL)
  DELETE FROM section_blobs WHERE id NOT IN (SELECT id FROM live) RETURNING 1`

/**
 * COLLECT_SECTION_BLOBS for one account (?1), after staff purged some of its
 * snapshots: sections are only ever shared within an account. Reads the
 * account's live rows and its trash by their indexes.
 */
export function collectAccountBlobs(d1: D1Database, accountId: number): D1PreparedStatement {
  return d1
    .prepare(
      `WITH RECURSIVE refs AS (
         SELECT ${REFS_SQL} FROM snapshots WHERE account_id = ?1 AND deleted_at IS NULL
         UNION ALL
         SELECT ${REFS_SQL} FROM snapshots WHERE account_id = ?1 AND deleted_at IS NOT NULL),
       live(id) AS (
         SELECT j.value FROM refs AS s, json_each(json_array(${REFS_SQL})) AS j
         WHERE j.value IS NOT NULL
         UNION SELECT b.base_id FROM section_blobs AS b JOIN live ON b.id = live.id
           WHERE b.base_id IS NOT NULL)
       DELETE FROM section_blobs WHERE account_id = ?1 AND id NOT IN (SELECT id FROM live)
       RETURNING 1`,
    )
    .bind(accountId)
}

export async function runMaintenance(
  d1: D1Database,
  now = Date.now(),
  options: { repackLimit?: number } = {},
): Promise<MaintenanceResult> {
  // One batch: a failure (the v1 tables gone, say) leaves nothing half done.
  const sessionsEnded = now - SESSION_KEEP_DAYS * 86_400_000
  const [
    snapshots,
    sections,
    tokens,
    codes,
    uploadDays,
    sessions,
    signupIps,
    invites,
    challenges,
    legacy,
  ] = await withLegacySchema((withV1) =>
    d1.batch([
      d1
        .prepare('DELETE FROM snapshots WHERE deleted_at IS NOT NULL AND deleted_at < ?1')
        .bind(now - TRASH_DAYS * 86_400_000),
      d1.prepare(COLLECT_SECTION_BLOBS),
      d1.prepare('DELETE FROM auth_tokens WHERE expires_at < ?1').bind(now - KEEP_EXPIRED_MS),
      d1.prepare('DELETE FROM oauth_codes WHERE expires_at < ?1').bind(now - CODE_KEEP_MS),
      d1
        .prepare('DELETE FROM user_upload_days WHERE day < ?1')
        .bind(utcDay(now - UPLOAD_DAYS_KEPT * 86_400_000)),
      d1
        .prepare('DELETE FROM user_sessions WHERE revoked_at < ?1 OR expires_at < ?1')
        .bind(sessionsEnded),
      d1
        .prepare(
          'UPDATE users SET signup_ip = NULL WHERE signup_ip IS NOT NULL AND created_at < ?1',
        )
        .bind(now - SIGNUP_IP_DAYS * 86_400_000),
      expiredInvitesStatement(d1, now),
      d1.prepare('DELETE FROM passkey_challenges WHERE expires_at < ?1').bind(now),
      ...(withV1 ? [d1.prepare(COLLECT_LEGACY_BLOBS)] : []),
    ]),
  )
  const result: MaintenanceResult = {
    snapshots: snapshots!.meta.changes,
    // Rows returned: meta.changes would also count the counter trigger's updates.
    blobs: sections!.results.length + (legacy?.results.length ?? 0),
    tokens: tokens!.meta.changes + codes!.meta.changes + challenges!.meta.changes,
    uploadDays: uploadDays!.meta.changes,
    sessions: sessions!.meta.changes,
    signupIps: signupIps!.meta.changes,
    invites: invites!.meta.changes,
  }
  if (options.repackLimit && options.repackLimit > 0) {
    result.repack = await repack(d1, { limit: options.repackLimit })
  }
  return result
}
