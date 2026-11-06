/**
 * Time-order repack (2026-11-06): re-encodes one account's stored sections
 * as if its snapshots had arrived oldest first. Until then every upload was
 * stored against the account's newest capture, so history imported after
 * newer captures (a backfill) shared little with what it was compared to
 * and was stored nearly whole: one account kept 4x what its history needs.
 * Uploads are now stored against their neighbour in time (import.ts
 * NEAREST_SQL); this brings what was stored before in line.
 *
 * For one account it reads every snapshot (the trash too) and every section
 * blob, works out each snapshot's full sections, replays them through the
 * import's own planner (planSections) oldest first, and checks that every
 * snapshot's every section decodes back to exactly what it was. Only then
 * does it write, in one batch, every statement guarded by the account's
 * snapshots being the ones it read: blobs are inserted, or rewritten in
 * place under the same hash (same content, a new encoding); snapshots point
 * at the new blobs. Blobs nothing points at any more are left to the daily
 * maintenance's collection. Nothing here logs inventory data: ids and byte
 * counts only.
 *
 * Run by the hourly maintenance (reorderStorage), one account at a time
 * from a cursor in `site_settings`, skipping an account while it uploads.
 */

import {
  BlobDecoder,
  SLOTS,
  artifactRows,
  decodeAchievementTimes,
  decodeMaterials,
  decodeSectionBlob,
  fullSection,
  kindOfCode,
  planSections,
  sectionHashOf,
  shortHashHex,
  type AchievementTimesSection,
  type ArtifactsSection,
  type KnownBlob,
  type MaterialsSection,
  type RawBlob,
  type SectionValues,
  type Slot,
} from '@gdt/shared'
import { MATERIALS } from '@gdt/shared/dictionary/materials'
import { REF_COLUMNS, REFS_SQL, toBytes } from './storage'

export interface ReorderResult {
  accountId: number
  snapshots: number
  /** Bytes of the blobs the account's snapshots used before, and after. */
  before: number
  after: number
  /** Written (false: nothing to gain, a v1 row, or the account changed meanwhile). */
  applied: boolean
  reason?: 'smaller already' | 'v1 rows' | 'changed meanwhile' | 'mismatch'
}

/** Below this share of what it saves, an account is left as it is. */
const MIN_SAVING = 0.05
/** JSON characters per bound parameter of a write (D1 takes up to 2 MB). */
const CHUNK_CHARS = 900_000

interface SnapshotRow extends Record<string, unknown> {
  id: number
  taken_at: number
}

interface BlobRow {
  id: number
  kind: number
  hash: string
  base_id: number | null
  data: unknown
}

const hexOf = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

/** A full section in a form two encodings of it agree on (materials by key, rows sorted). */
function canonical(slot: Slot, full: unknown): string {
  if (slot === 'materials') {
    return JSON.stringify(
      [...decodeMaterials(full as MaterialsSection, MATERIALS, null)].sort((a, b) =>
        a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
      ),
    )
  }
  if (slot === 'artifacts') return JSON.stringify(artifactRows(full as ArtifactsSection))
  if (slot === 'achievementTimes') {
    return JSON.stringify(decodeAchievementTimes(full as AchievementTimesSection))
  }
  return JSON.stringify(full)
}

/** Each blob's section in full, from rows (`code`, `baseId`, bytes). */
function fullReader(rows: ReadonlyMap<number, RawBlob>) {
  const decoder = new BlobDecoder((id) => rows.get(id))
  const cache = new Map<number, unknown>()
  return (id: number): unknown => {
    const hit = cache.get(id)
    if (hit !== undefined) return hit
    const row = rows.get(id)!
    const { kind, delta } = kindOfCode(row.code)
    const value = decoder.decode(id).value
    const full = fullSection(
      kind,
      value,
      delta ? decoder.decode(row.baseId!).value : null,
      MATERIALS,
    )
    cache.set(id, full)
    return full
  }
}

interface NewBlob {
  hash: string
  code: number
  baseHash: string | null
  data: Uint8Array
}

/**
 * The account's sections replayed oldest first (pure: rows in, plan out).
 * Exported for tests.
 */
export async function planReorder(
  snapshots: readonly SnapshotRow[],
  blobs: readonly BlobRow[],
): Promise<{
  blobs: NewBlob[]
  refs: { id: number; hashes: Partial<Record<Slot, string>>; size: number }[]
  before: number
  after: number
}> {
  const oldRows = new Map<number, RawBlob>(
    blobs.map((b) => [b.id, { id: b.id, code: b.kind, baseId: b.base_id, data: toBytes(b.data) }]),
  )
  const oldHash = new Map(blobs.map((b) => [b.id, b.hash.toLowerCase()]))
  const fullOf = fullReader(oldRows)

  // Bytes the snapshots use now: every blob they point at, and its bases.
  const used = new Set<number>()
  const use = (id: number | null) => {
    while (id !== null && !used.has(id)) {
      used.add(id)
      id = oldRows.get(id)?.baseId ?? null
    }
  }
  for (const s of snapshots) for (const slot of SLOTS) use((s[REF_COLUMNS[slot]] as number) ?? null)
  let before = 0
  for (const id of used) before += oldRows.get(id)!.data.length

  // Replay, oldest first.
  const ordered = [...snapshots].sort((a, b) => a.taken_at - b.taken_at || a.id - b.id)
  const made = new Map<string, NewBlob>()
  const known = new Map<string, KnownBlob>()
  const pseudo = new Map<number, string>()
  let nextId = -1
  const existing = new Map<string, { id: number; code: number }>()
  let previous: Partial<Record<Slot, KnownBlob | null>> = {}
  const refs: { id: number; hashes: Partial<Record<Slot, string>>; size: number }[] = []

  for (const s of ordered) {
    const values: SectionValues = {}
    for (const slot of SLOTS) {
      const id = (s[REF_COLUMNS[slot]] as number | null) ?? null
      if (id === null) continue
      const row = oldRows.get(id)!
      const full = fullOf(id)
      const hash = kindOfCode(row.code).delta
        ? shortHashHex(await sectionHashOf(slot, full))
        : oldHash.get(id)!
      values[slot] = { value: full, hash }
    }
    const plan = await planSections({
      values,
      latest: previous,
      existing,
      materialsDictionary: MATERIALS,
    })
    let size = 0
    for (const blob of plan.blobs) {
      const base = blob.base
        ? 'id' in blob.base
          ? known.get(pseudo.get(blob.base.id)!)!
          : known.get(blob.base.hash)!
        : null
      const id = nextId--
      const decoded = decodeSectionBlob(
        blob.code,
        blob.data,
        base?.decoded ?? null,
        base ? `#${base.id}` : null,
      )
      const entry: KnownBlob = {
        id,
        code: blob.code,
        hash: blob.hash,
        size: blob.data.length,
        decoded,
        base,
      }
      known.set(blob.hash, entry)
      pseudo.set(id, blob.hash)
      existing.set(blob.hash, { id, code: blob.code })
      made.set(blob.hash, {
        hash: blob.hash,
        code: blob.code,
        baseHash: base?.hash ?? null,
        data: blob.data,
      })
      size += blob.data.length
    }
    const hashes: Partial<Record<Slot, string>> = {}
    const latest: Partial<Record<Slot, KnownBlob | null>> = {}
    for (const slot of SLOTS) {
      const ref = plan.refs[slot]
      if (!ref) continue
      const hash = 'id' in ref ? pseudo.get(ref.id)! : ref.hash
      hashes[slot] = hash
      latest[slot] = known.get(hash)!
    }
    previous = latest
    refs.push({ id: s.id, hashes, size })
  }

  // Every snapshot's every section must decode back to what it was.
  const newRows = new Map<number, RawBlob>()
  const idOf = new Map<string, number>()
  let n = 1
  for (const blob of made.values()) idOf.set(blob.hash, n++)
  for (const blob of made.values()) {
    const id = idOf.get(blob.hash)!
    newRows.set(id, {
      id,
      code: blob.code,
      baseId: blob.baseHash ? idOf.get(blob.baseHash)! : null,
      data: blob.data,
    })
  }
  const newFull = fullReader(newRows)
  const bySnapshot = new Map(snapshots.map((s) => [s.id, s]))
  for (const r of refs) {
    const s = bySnapshot.get(r.id)!
    for (const slot of SLOTS) {
      const oldId = (s[REF_COLUMNS[slot]] as number | null) ?? null
      const hash = r.hashes[slot]
      if (oldId === null && hash === undefined) continue
      if (oldId === null || hash === undefined) throw new Error(`mismatch ${r.id} ${slot}`)
      if (canonical(slot, fullOf(oldId)) !== canonical(slot, newFull(idOf.get(hash)!))) {
        throw new Error(`mismatch ${r.id} ${slot}`)
      }
    }
  }

  const after = [...made.values()].reduce((sum, b) => sum + b.data.length, 0)
  return { blobs: [...made.values()], refs, before, after }
}

/** Splits rows into JSON arrays of at most CHUNK_CHARS characters. */
function chunks(rows: readonly object[]): string[] {
  const out: string[] = []
  let part: string[] = []
  let chars = 2
  for (const row of rows) {
    const text = JSON.stringify(row)
    if (part.length && chars + text.length + 1 > CHUNK_CHARS) {
      out.push(`[${part.join(',')}]`)
      part = []
      chars = 2
    }
    part.push(text)
    chars += text.length + 1
  }
  if (part.length) out.push(`[${part.join(',')}]`)
  return out
}

/** Every statement's guard: the account's snapshots are the ones read (?1 account, ?2 count, ?3 max id). */
const GUARD = `(SELECT count(*) FROM snapshots WHERE account_id = ?1) = ?2
  AND (SELECT max(id) FROM snapshots WHERE account_id = ?1) = ?3`

export async function reorderAccount(d1: D1Database, accountId: number): Promise<ReorderResult> {
  const [snapshotsResult, blobsResult] = await d1.batch([
    d1
      .prepare(`SELECT id, taken_at, ${REFS_SQL} FROM snapshots WHERE account_id = ?1`)
      .bind(accountId),
    d1
      .prepare(
        'SELECT id, kind, hex(hash) AS hash, base_id, data FROM section_blobs WHERE account_id = ?1',
      )
      .bind(accountId),
  ])
  const snapshots = snapshotsResult!.results as SnapshotRow[]
  const blobs = blobsResult!.results as unknown as BlobRow[]
  const result = (fields: Partial<ReorderResult>): ReorderResult => ({
    accountId,
    snapshots: snapshots.length,
    before: 0,
    after: 0,
    applied: false,
    ...fields,
  })
  if (snapshots.length === 0) return result({ reason: 'smaller already' })
  if (
    snapshots.some(
      (s) => s.characters_ref === null && SLOTS.every((slot) => s[REF_COLUMNS[slot]] === null),
    )
  ) {
    return result({ reason: 'v1 rows' })
  }

  let plan: Awaited<ReturnType<typeof planReorder>>
  try {
    plan = await planReorder(snapshots, blobs)
  } catch (error) {
    console.error('reorder_mismatch', accountId, String(error))
    return result({ reason: 'mismatch' })
  }
  const { before, after } = plan
  if (after > before * (1 - MIN_SAVING)) return result({ before, after, reason: 'smaller already' })

  // Rows already stored exactly so are not written again; rows rewritten in
  // place change the account's byte count (the insert trigger counts only
  // new rows).
  const hashById = new Map(blobs.map((b) => [b.id, b.hash.toLowerCase()]))
  const oldByHash = new Map(
    blobs.map((b) => [
      b.hash.toLowerCase(),
      {
        data: hexOf(toBytes(b.data)),
        base: b.base_id === null ? null : (hashById.get(b.base_id) ?? null),
      },
    ]),
  )
  const writes = plan.blobs.filter((blob) => {
    const old = oldByHash.get(blob.hash)
    return !old || old.data !== hexOf(blob.data) || old.base !== blob.baseHash
  })
  let rewritten = 0
  for (const blob of writes) {
    const old = oldByHash.get(blob.hash)
    if (old) rewritten += blob.data.length - old.data.length / 2
  }

  const count = snapshots.length
  const maxId = Math.max(...snapshots.map((s) => s.id))
  const statements: D1PreparedStatement[] = []
  for (const json of chunks(writes.map((b) => ({ h: b.hash, k: b.code, d: hexOf(b.data) })))) {
    statements.push(
      d1
        .prepare(
          `INSERT INTO section_blobs (account_id, hash, kind, base_id, data)
           SELECT ?1, unhex(json_extract(j.value, '$.h')), json_extract(j.value, '$.k'), NULL,
             unhex(json_extract(j.value, '$.d'))
           FROM json_each(?4) AS j WHERE ${GUARD}
           ON CONFLICT (account_id, hash) DO UPDATE SET kind = excluded.kind, base_id = NULL,
             data = excluded.data`,
        )
        .bind(accountId, count, maxId, json),
    )
  }
  const based = writes.filter((b) => b.baseHash !== null).map((b) => ({ h: b.hash, b: b.baseHash }))
  for (const json of chunks(based)) {
    statements.push(
      d1
        .prepare(
          `UPDATE section_blobs SET base_id = (SELECT b.id FROM section_blobs AS b
             WHERE b.account_id = ?1 AND b.hash = unhex(json_extract(j.value, '$.b')))
           FROM json_each(?4) AS j
           WHERE section_blobs.account_id = ?1
             AND section_blobs.hash = unhex(json_extract(j.value, '$.h')) AND ${GUARD}`,
        )
        .bind(accountId, count, maxId, json),
    )
  }
  const refRows = plan.refs.map((r) => ({ id: r.id, size: r.size, ...r.hashes }))
  const setRefs = SLOTS.map(
    (slot) =>
      `${REF_COLUMNS[slot]} = (SELECT b.id FROM section_blobs AS b WHERE b.account_id = ?1
         AND b.hash = unhex(json_extract(j.value, '$.${slot}')))`,
  ).join(',\n')
  for (const json of chunks(refRows)) {
    statements.push(
      d1
        .prepare(
          `UPDATE snapshots SET ${setRefs}, stored_size = json_extract(j.value, '$.size')
           FROM json_each(?4) AS j
           WHERE snapshots.id = json_extract(j.value, '$.id') AND snapshots.account_id = ?1
             AND ${GUARD}`,
        )
        .bind(accountId, count, maxId, json),
    )
  }
  statements.push(
    d1
      .prepare(
        `UPDATE genshin_accounts SET stored_bytes = stored_bytes + ?4 WHERE id = ?1 AND ${GUARD}`,
      )
      .bind(accountId, count, maxId, rewritten),
  )
  const results = await d1.batch(statements)
  const applied = (results.at(-1)!.meta.changes ?? 0) > 0
  return result({ before, after, applied, ...(applied ? {} : { reason: 'changed meanwhile' }) })
}

/** The `site_settings` key of the repack's cursor: the last account id it finished. */
export const REORDER_CURSOR = 'storage.reorder_after'
/** The accounts the cursor passed while they were busy (a JSON id list), retried once quiet. */
export const REORDER_SKIPPED = 'storage.reorder_skipped'
/** An account that uploaded this recently is left for a later run. */
const QUIET_MS = 30 * 60_000

async function setting(d1: D1Database, key: string): Promise<string | null> {
  const row = await d1
    .prepare('SELECT value FROM site_settings WHERE key = ?1')
    .bind(key)
    .first<{ value: string }>()
  return row?.value ?? null
}

function saveSetting(d1: D1Database, key: string, value: string, now: number) {
  return d1
    .prepare(
      `INSERT INTO site_settings (key, value, updated_at) VALUES (?1, ?2, ?3)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(key, value, now)
}

/**
 * Repacks accounts in id order from the cursor until `budgetMs` has passed
 * (the hourly maintenance). An account that uploaded in the last half hour
 * is passed over and remembered (`REORDER_SKIPPED`); each run first takes a
 * remembered one that has gone quiet. Before, a busy account stopped the
 * run, and one that uploads all day (Capture's live sync) held the whole
 * queue behind it.
 */
export async function reorderStorage(
  d1: D1Database,
  now = Date.now(),
  budgetMs = 20_000,
): Promise<ReorderResult[]> {
  const started = Date.now()
  const done: ReorderResult[] = []
  const lastSeen = async (ids: readonly number[]) => {
    if (!ids.length) return new Map<number, number | null>()
    const { results } = await d1
      .prepare(
        `SELECT a.id, (SELECT max(last_seen_at) FROM snapshots WHERE account_id = a.id) AS seen
         FROM genshin_accounts AS a WHERE a.id IN (SELECT value FROM json_each(?1))`,
      )
      .bind(JSON.stringify(ids))
      .all<{ id: number; seen: number | null }>()
    return new Map(results.map((r) => [r.id, r.seen]))
  }
  const quiet = (seen: number | null | undefined) =>
    seen === null || seen === undefined || now - seen >= QUIET_MS
  for (;;) {
    const after = Number((await setting(d1, REORDER_CURSOR)) ?? 0) || 0
    let skipped: number[] = []
    try {
      const parsed: unknown = JSON.parse((await setting(d1, REORDER_SKIPPED)) ?? '[]')
      if (Array.isArray(parsed)) skipped = parsed.filter((id): id is number => Number.isInteger(id))
    } catch {
      skipped = []
    }
    // A remembered account that has gone quiet (or is gone) first.
    const seenSkipped = await lastSeen(skipped)
    const gone = skipped.filter((id) => !seenSkipped.has(id))
    const retry = skipped.find((id) => seenSkipped.has(id) && quiet(seenSkipped.get(id)))
    if (gone.length) {
      skipped = skipped.filter((id) => !gone.includes(id))
      await saveSetting(d1, REORDER_SKIPPED, JSON.stringify(skipped), now).run()
    }
    let id: number
    if (retry !== undefined) id = retry
    else {
      const next = await d1
        .prepare(
          `SELECT a.id, (SELECT max(last_seen_at) FROM snapshots WHERE account_id = a.id) AS seen
           FROM genshin_accounts AS a WHERE a.id > ?1 ORDER BY a.id LIMIT 1`,
        )
        .bind(after)
        .first<{ id: number; seen: number | null }>()
      if (!next) return done
      if (!quiet(next.seen)) {
        // Busy: passed over, remembered, and the walk goes on.
        await d1.batch([
          saveSetting(d1, REORDER_CURSOR, String(next.id), now),
          saveSetting(d1, REORDER_SKIPPED, JSON.stringify([...skipped, next.id]), now),
        ])
        if (Date.now() - started > budgetMs) return done
        continue
      }
      id = next.id
    }
    const result = await reorderAccount(d1, id)
    done.push(result)
    console.log('reorder', JSON.stringify(result))
    // A guard that stopped the write leaves it for the next run.
    if (result.reason === 'changed meanwhile') {
      if (retry === undefined)
        await saveSetting(d1, REORDER_SKIPPED, JSON.stringify([...skipped, id]), now).run()
      await saveSetting(d1, REORDER_CURSOR, String(Math.max(after, id)), now).run()
      return done
    }
    if (retry !== undefined)
      await saveSetting(
        d1,
        REORDER_SKIPPED,
        JSON.stringify(skipped.filter((s) => s !== id)),
        now,
      ).run()
    else await saveSetting(d1, REORDER_CURSOR, String(id), now).run()
    if (Date.now() - started > budgetMs) return done
  }
}
