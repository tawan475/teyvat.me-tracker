/**
 * What the account data routes answer, shared by the owner's routes
 * (routes/accounts.ts) and staff's read-only look at an account
 * (routes/staff.ts, `data.inspect`).
 */

import type { SnapshotResponse } from '@gdt/shared'
import { ApiError } from '../lib/http'
import { MAX_BUNDLE_SNAPSHOTS, SECTION_NAMES, type SectionName } from './export'
import { metaOf, withLegacySchema } from './storage'

/** Live snapshots, newest first, with their summaries. */
export async function listSnapshots(
  d1: D1Database,
  accountId: number,
): Promise<SnapshotResponse[]> {
  const { results } = await withLegacySchema((legacy) =>
    d1
      .prepare(
        `SELECT id, taken_at, last_seen_at, created_at, raw_size, stored_size,
           ${legacy ? 'format, version, source, summary, ' : ''}meta
         FROM snapshots WHERE account_id = ?1 AND deleted_at IS NULL ORDER BY taken_at DESC, id DESC`,
      )
      .bind(accountId)
      .all<Record<string, unknown>>(),
  )
  return results.map((r) => {
    const meta = metaOf(r)
    return {
      id: r.id as number,
      takenAt: r.taken_at as number,
      lastSeenAt: r.last_seen_at as number,
      createdAt: r.created_at as number,
      source: meta.source,
      rawSize: r.raw_size as number,
      storedSize: r.stored_size as number,
      summary: meta.summary,
      ...(meta.capture ? { capture: meta.capture } : {}),
      ...(meta.off ? { off: meta.off } : {}),
    }
  })
}

/** `?ids=1,2,3` of a bundle request: null for all, else sorted and unique. */
export function parseIds(raw: string | undefined): number[] | null {
  if (!raw) return null
  const ids = raw.split(',').map(Number)
  if (ids.length > MAX_BUNDLE_SNAPSHOTS || ids.some((n) => !Number.isSafeInteger(n) || n <= 0)) {
    throw new ApiError(
      400,
      'invalid_request',
      '`ids` must be a comma-separated list of snapshot ids',
    )
  }
  return [...new Set(ids)].sort((a, b) => a - b)
}

/** `?sections=materials,artifacts` of a bundle request (default: all). */
export function parseSections(raw: string | undefined): Set<SectionName> {
  if (!raw) return new Set(SECTION_NAMES)
  const names = raw.split(',')
  const invalid = names.filter((name) => !(SECTION_NAMES as readonly string[]).includes(name))
  if (invalid.length > 0) {
    throw new ApiError(400, 'invalid_request', `Unknown sections: ${invalid.join(', ')}`)
  }
  return new Set(names as SectionName[])
}
