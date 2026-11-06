/**
 * What a user stores against their storage quota, for them to see
 * (`GET /api/me/usage`): their own accounts (shared ones count on their
 * owner), split into snapshot sections, the artifact catalog and wish
 * history, plus what live sync keeps in gdt-live. One D1 batch plus the
 * gdt-live read; the figures are the staff pages' (services/staff.ts).
 */

import type { UsageAccount, UsageResponse } from '@gdt/shared'
import { liveBytesByUser } from './live-sync'
import { readSiteSettingRows, siteSettingsStatement } from './staff-deps'

const ACCOUNTS_SQL = `SELECT g.id, g.snapshot_count, g.stored_bytes, g.raw_bytes,
    (SELECT count(*) FROM snapshots AS d WHERE d.account_id = g.id AND d.deleted_at IS NOT NULL)
      AS trash,
    (SELECT coalesce(sum(length(c.data)), 0) FROM artifact_chunks AS c WHERE c.account_id = g.id)
      AS catalog_bytes,
    (SELECT coalesce(sum(length(w.data)), 0) FROM wish_chunks AS w WHERE w.account_id = g.id)
      AS wish_bytes,
    (SELECT coalesce(sum(w.count), 0) FROM wish_chunks AS w WHERE w.account_id = g.id) AS wish_pulls
  FROM genshin_accounts AS g WHERE g.user_id = ?1 ORDER BY g.id`

export async function userUsage(
  d1: D1Database,
  live: D1Database | null,
  userId: number,
): Promise<UsageResponse> {
  const [[user, accounts, settings], liveBytes] = await Promise.all([
    d1.batch<Record<string, unknown>>([
      d1.prepare('SELECT storage_quota FROM users WHERE id = ?1').bind(userId),
      d1.prepare(ACCOUNTS_SQL).bind(userId),
      siteSettingsStatement(d1),
    ]),
    liveBytesByUser(live, [userId]),
  ])
  const { limits } = readSiteSettingRows(settings!.results)
  const own = user!.results[0]?.storage_quota
  const quota =
    typeof own === 'number' && Number.isSafeInteger(own) && own >= 0 ? own : limits.storageQuota
  const rows: UsageAccount[] = accounts!.results.map((row) => ({
    id: Number(row.id),
    snapshots: Number(row.snapshot_count),
    trash: Number(row.trash),
    sectionBytes: Number(row.stored_bytes),
    catalogBytes: Number(row.catalog_bytes),
    wishBytes: Number(row.wish_bytes),
    wishPulls: Number(row.wish_pulls),
    rawBytes: Number(row.raw_bytes),
  }))
  const sum = (key: 'sectionBytes' | 'catalogBytes' | 'wishBytes') =>
    rows.reduce((total, row) => total + row[key], 0)
  const sectionBytes = sum('sectionBytes')
  const catalogBytes = sum('catalogBytes')
  const wishBytes = sum('wishBytes')
  return {
    sectionBytes,
    catalogBytes,
    wishBytes,
    storedBytes: sectionBytes + catalogBytes + wishBytes,
    storageQuota: quota,
    liveBytes: liveBytes.get(userId) ?? 0,
    accounts: rows,
  }
}
