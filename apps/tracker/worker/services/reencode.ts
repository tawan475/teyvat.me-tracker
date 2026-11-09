/**
 * Re-encodes, in place, an account's section blobs stored as JSON that a
 * binary layout now holds (docs/plans/storage-efficiency.md §10): the tasks
 * and player sections from before their second forms (2026-11-09), and
 * extras from before their layout learned `r/x/s`. The time-order repack
 * leaves an account alone unless replaying its whole history saves 5%, and
 * these blobs are spread thinly over many accounts.
 *
 * Every blob keeps its id and hash (same content, a new encoding). A blob
 * compressed against one that changes is re-encoded too (against the new
 * payload, or standalone when that is smaller), so no chain is left pointing
 * at bytes that moved. Everything is checked to decode back to exactly the
 * value it held before anything is written; the write is one batch,
 * guarded by the account's snapshots being the ones read (as the repack's
 * is) and by each blob's bytes being the ones read. Ids and byte counts
 * only, never inventory data.
 */

import {
  BlobDecoder,
  KIND_DELTA,
  decodeSectionBlob,
  encodeSectionBlob,
  encodeSectionBlobVariants,
  kindOfCode,
  type DecodedBlob,
  type RawBlob,
} from '@gdt/shared'
import { toBytes } from './storage'

export interface ReencodeResult {
  accountId: number
  /** Blobs rewritten (the JSON ones and those compressed against them). */
  blobs: number
  before: number
  after: number
  applied: boolean
  reason?: 'nothing to do' | 'not smaller' | 'changed meanwhile' | 'mismatch' | 'dry run'
}

interface Row {
  id: number
  kind: number
  base_id: number | null
  data: unknown
}

const GUARD = `(SELECT count(*) FROM snapshots WHERE account_id = ?1) = ?2
  AND coalesce((SELECT max(id) FROM snapshots WHERE account_id = ?1), 0) = ?3`

const hexOf = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

/** True when a blob's payload is the JSON layout (format byte high nibble 0). */
const isJson = (data: Uint8Array) => data.length > 0 && (data[0]! & 0xf0) === 0x00

export async function reencodeAccount(
  d1: D1Database,
  accountId: number,
  options: { dryRun?: boolean } = {},
): Promise<ReencodeResult> {
  const [snapshotsResult, blobsResult] = await d1.batch([
    d1
      .prepare(
        `SELECT count(*) AS n, coalesce(max(id), 0) AS max FROM snapshots WHERE account_id = ?1`,
      )
      .bind(accountId),
    d1
      .prepare('SELECT id, kind, base_id, data FROM section_blobs WHERE account_id = ?1')
      .bind(accountId),
  ])
  const { n: count, max: maxId } = snapshotsResult!.results[0] as { n: number; max: number }
  const rows = (blobsResult!.results as unknown as Row[]).map(
    (row): RawBlob => ({
      id: row.id,
      code: row.kind,
      baseId: row.base_id,
      data: toBytes(row.data),
    }),
  )
  const byId = new Map(rows.map((blob) => [blob.id, blob]))
  const result = (fields: Partial<ReencodeResult>): ReencodeResult => ({
    accountId,
    blobs: 0,
    before: 0,
    after: 0,
    applied: false,
    ...fields,
  })

  // JSON-layout full sections (deltas keep the layout their keyframe chose).
  const json = rows.filter((blob) => isJson(blob.data) && (blob.code & KIND_DELTA) === 0)
  if (json.length === 0) return result({ reason: 'nothing to do' })

  // What changes: those, and every blob compressed against (or a delta of)
  // one that changes, however deep (chains are at most two steps).
  const children = new Map<number, RawBlob[]>()
  for (const blob of rows) {
    if (blob.baseId === null) continue
    const list = children.get(blob.baseId)
    if (list) list.push(blob)
    else children.set(blob.baseId, [blob])
  }
  const changing = new Set<number>()
  const visit = (blob: RawBlob) => {
    if (changing.has(blob.id)) return
    changing.add(blob.id)
    for (const child of children.get(blob.id) ?? []) visit(child)
  }
  for (const blob of json) visit(blob)
  // A delta's form depends on its keyframe's value, not its bytes: it only
  // changes when its own dictionary does. Deltas are re-encoded like the rest.

  const oldDecoder = new BlobDecoder((id) => byId.get(id))
  const fresh = new Map<number, RawBlob>()
  const newDecoder = new BlobDecoder((id) => fresh.get(id) ?? byId.get(id))
  const freshDecoded = new Map<number, DecodedBlob>()
  const decodedNew = (id: number): DecodedBlob => {
    const known = freshDecoded.get(id)
    if (known) return known
    const value = newDecoder.decode(id)
    freshDecoded.set(id, value)
    return value
  }

  // Roots first, then their children, so a child sees its base's new payload.
  const order = [...changing].map((id) => byId.get(id)!)
  const depth = (blob: RawBlob): number =>
    blob.baseId === null ? 0 : 1 + depth(byId.get(blob.baseId)!)
  order.sort((a, b) => depth(a) - depth(b) || a.id - b.id)

  let before = 0
  let after = 0
  for (const blob of order) {
    const { kind, delta } = kindOfCode(blob.code)
    const value = oldDecoder.decode(blob.id).value
    before += blob.data.length
    let encoded: { data: Uint8Array; baseId: number | null }
    if (delta) {
      // A delta stays a delta of the same keyframe (its value names it).
      const base = decodedNew(blob.baseId!)
      encoded = { data: encodeSectionBlob(kind, value, true, base).data, baseId: blob.baseId }
    } else {
      const base = blob.baseId === null ? null : decodedNew(blob.baseId)
      const { standalone, withBase } = encodeSectionBlobVariants(kind, value, base)
      const useBase = withBase !== null && withBase.data.length < standalone.data.length
      encoded = useBase
        ? { data: withBase!.data, baseId: blob.baseId }
        : { data: standalone.data, baseId: null }
    }
    fresh.set(blob.id, { id: blob.id, code: blob.code, baseId: encoded.baseId, data: encoded.data })
    after += encoded.data.length
  }

  // Exactly the same values, through the new bytes.
  for (const blob of order) {
    const was = JSON.stringify(oldDecoder.decode(blob.id).value)
    const now = fresh.get(blob.id)!
    const base = now.baseId === null ? null : decodedNew(now.baseId)
    const back = decodeSectionBlob(now.code, now.data, base, oldBaseKey(blob, now))
    if (JSON.stringify(back.value) !== was)
      return result({ blobs: order.length, before, after, reason: 'mismatch' })
  }
  if (after >= before) return result({ blobs: order.length, before, after, reason: 'not smaller' })
  if (options.dryRun) return result({ blobs: order.length, before, after, reason: 'dry run' })

  // First, a check that fails the whole batch (D1 rolls a batch back when a
  // statement errors; json() of a non-JSON string is such an error) unless
  // the snapshots and every blob's bytes are the ones read: a skipped update
  // could leave a blob compressed against bytes that did not change.
  const expected = JSON.stringify(order.map((blob) => ({ i: blob.id, d: hexOf(blob.data) })))
  const statements: D1PreparedStatement[] = [
    d1
      .prepare(
        `SELECT CASE WHEN (SELECT count(*) FROM json_each(?4) AS j
           JOIN section_blobs AS b ON b.id = json_extract(j.value, '$.i') AND b.account_id = ?1
             AND b.data = unhex(json_extract(j.value, '$.d'))) = ?5 AND ${GUARD}
         THEN 1 ELSE json('changed meanwhile') END AS ok`,
      )
      .bind(accountId, count, maxId, expected, order.length),
  ]
  for (const blob of order) {
    const now = fresh.get(blob.id)!
    statements.push(
      d1
        .prepare(
          `UPDATE section_blobs SET data = unhex(?4), base_id = ?5
           WHERE id = ?6 AND account_id = ?1 AND data = unhex(?7) AND ${GUARD}`,
        )
        .bind(accountId, count, maxId, hexOf(now.data), now.baseId, blob.id, hexOf(blob.data)),
    )
  }
  statements.push(
    d1
      .prepare(
        `UPDATE genshin_accounts SET stored_bytes = stored_bytes + ?4 WHERE id = ?1 AND ${GUARD}`,
      )
      .bind(accountId, count, maxId, after - before),
  )
  let results: D1Result[]
  try {
    results = await d1.batch(statements)
  } catch (error) {
    if (/changed meanwhile|malformed JSON/i.test(String(error))) {
      return result({ blobs: order.length, before, after, reason: 'changed meanwhile' })
    }
    throw error
  }
  const written = results.slice(1, -1).reduce((n, r) => n + (r.meta.changes ?? 0), 0)
  const applied = written === order.length
  return result({
    blobs: order.length,
    before,
    after,
    applied,
    ...(applied ? {} : { reason: 'changed meanwhile' }),
  })
}

/** The key a decoded delta names its base by (the old decoder's form), for comparing values. */
function oldBaseKey(old: RawBlob, now: RawBlob): string | null {
  void old
  return now.baseId === null ? null : `#${now.baseId}`
}
