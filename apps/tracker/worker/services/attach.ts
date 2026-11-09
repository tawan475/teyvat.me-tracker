/**
 * Attach (`POST /api/irminsul/attach`, @gdt/shared live/attach): data the
 * game sends only when a screen is opened, after the login's snapshot, is
 * written into that session's newest snapshot: its extras section is read,
 * the posted endgame parts replace what it held of them, and a new extras
 * blob takes the section's place on the row (deduped by hash like any
 * section; the old blob stays for the daily collection when nothing else
 * names it). The snapshot's content key is kept, so a re-upload of the
 * login's own file is still a no-op. Two round trips: the read (the
 * snapshot, its extras chain, who listens), the write (blob, row, version).
 */

import {
  BlobDecoder,
  decodeExtras,
  decodeSnapshotMeta,
  encodeExtras,
  encodeSectionBlob,
  kindCode,
  sectionHashOf,
  shortHashHex,
  type ExtrasSection,
  type GiEndgame,
  type RawBlob,
} from '@gdt/shared'
import { ApiError } from '../lib/http'
import { insertBlobStatement } from './import'
import { listenerOf, listenerStatement, type Listener } from './live'
import { toBytes } from './storage'

export interface Attached {
  snapshotId: number
  takenAt: number
  /** The account's data version after the write; null when nothing changed. */
  dataVersion: number | null
  /** Bytes the new extras blob took (0: it existed, or nothing changed). */
  stored: number
  listeners: Listener[] | undefined
}

/** The newest snapshot's extras chain: the row and every blob it needs (bases, three levels). */
const NEWEST_EXTRAS_SQL = `WITH RECURSIVE newest AS (
    SELECT s.id, s.extras_ref FROM snapshots AS s
    WHERE s.id = (SELECT latest_snapshot_id FROM genshin_accounts WHERE id = ?1)
      AND s.deleted_at IS NULL),
  need(id, depth) AS (
    SELECT extras_ref, 0 FROM newest WHERE extras_ref IS NOT NULL
    UNION SELECT b.base_id, n.depth + 1 FROM section_blobs AS b JOIN need AS n ON b.id = n.id
      WHERE b.base_id IS NOT NULL AND n.depth < 3)
  SELECT b.id, b.kind, b.base_id, b.data FROM section_blobs AS b
  WHERE +b.account_id = ?1 AND b.id IN (SELECT id FROM need)`

export async function attachEndgame(
  d1: D1Database,
  accountId: number,
  session: string,
  endgame: GiEndgame,
): Promise<Attached> {
  const [rowResult, blobResult, listening] = await d1.batch<Record<string, unknown>>([
    d1
      .prepare(
        `SELECT s.id, s.taken_at, s.meta, s.extras_ref FROM snapshots AS s
         WHERE s.id = (SELECT latest_snapshot_id FROM genshin_accounts WHERE id = ?1)
           AND s.deleted_at IS NULL`,
      )
      .bind(accountId),
    d1.prepare(NEWEST_EXTRAS_SQL).bind(accountId),
    listenerStatement(d1, accountId),
  ])
  const row = rowResult!.results[0] as
    | { id: number; taken_at: number; meta: unknown; extras_ref: number | null }
    | undefined
  if (!row) throw new ApiError(404, 'no_snapshot', 'The account has no snapshot to attach to')
  const capture = row.meta ? decodeSnapshotMeta(toBytes(row.meta)).capture : undefined
  if (!capture || capture.session !== session) {
    throw new ApiError(
      409,
      'session_mismatch',
      "The newest snapshot is another login's; the next login's snapshot carries the data",
    )
  }
  const listeners = listenerOf(listening)

  // What the snapshot holds now.
  const raw = new Map<number, RawBlob>()
  for (const b of blobResult!.results) {
    raw.set(b.id as number, {
      id: b.id as number,
      code: b.kind as number,
      baseId: (b.base_id as number | null) ?? null,
      data: toBytes(b.data),
    })
  }
  const parts =
    row.extras_ref === null
      ? {}
      : decodeExtras(
          new BlobDecoder((id) => raw.get(id)).decode(row.extras_ref).value as ExtrasSection,
        )
  const merged: GiEndgame = { ...parts.endgame, ...endgame }
  const value = encodeExtras({ ...parts, endgame: merged })
  if (!value) throw new ApiError(400, 'invalid_endgame', 'Nothing to attach')
  const before = JSON.stringify(encodeExtras(parts) ?? {})
  if (JSON.stringify(value) === before) {
    return { snapshotId: row.id, takenAt: row.taken_at, dataVersion: null, stored: 0, listeners }
  }

  const hash = shortHashHex(await sectionHashOf('extras', value))
  const blob = encodeSectionBlob('extras', value, false, null)
  // `changes()` right after the insert says whether the blob is new (an
  // existing one conflicts and inserts nothing): only then its bytes count.
  const results = await d1.batch<{ data_version: number }>([
    insertBlobStatement(d1, accountId, {
      hash,
      code: kindCode('extras', false),
      base: null,
      data: blob.data,
    }),
    d1
      .prepare(
        `UPDATE genshin_accounts
         SET stored_bytes = stored_bytes + (CASE WHEN changes() > 0 THEN ?2 ELSE 0 END),
             data_version = data_version + 1
         WHERE id = ?1 RETURNING data_version, stored_bytes`,
      )
      .bind(accountId, blob.data.length),
    d1
      .prepare(
        `UPDATE snapshots SET extras_ref =
           (SELECT id FROM section_blobs WHERE account_id = ?1 AND hash = unhex(?2))
         WHERE id = ?3 AND account_id = ?1`,
      )
      .bind(accountId, hash, row.id),
  ])
  const inserted = (results[0]!.meta.changes ?? 0) > 0
  const dataVersion = results[1]!.results[0]?.data_version ?? null
  return {
    snapshotId: row.id,
    takenAt: row.taken_at,
    dataVersion,
    stored: inserted ? blob.data.length : 0,
    listeners,
  }
}
