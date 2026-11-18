/**
 * "Remove this part from my history" (issue 12, item 3): an owner deletes one
 * removable part (achievements, the profile, Planner tasks …) from every
 * stored snapshot of an account, the trash included. The plan is pure
 * (@gdt/shared parts.ts planPartRemoval); this reads the rows it needs and
 * writes it in ONE batch, every statement guarded by the account's
 * snapshots being the ones read: a capture that lands meanwhile makes the
 * whole run refuse (409 `capture_changed`), all or nothing. Blobs nothing
 * points at any more are collected in the same batch, so the space is free
 * at once. The open live journal then loses that part's changes only (its
 * own guard: the journal's last seq); when gdt-live fails or stays busy, the
 * history is already clean and the journal is retried after the response.
 * Content keys stay as they were, so a live journal's base still names its
 * snapshot; the import stores an equal upload anew once a part was removed
 * after its newest snapshot (import.ts `sameInventory`). Ids and byte
 * counts only in logs, never inventory data.
 */

import {
  ACCOUNT_SETTINGS_DEFAULTS,
  REMOVABLE_PARTS,
  SLOTS,
  countParts,
  decodeChanges,
  deepMerge,
  encodeChangesNative,
  isPartChange,
  kindCode,
  partSlots,
  planPartRemoval,
  withoutPartChanges,
  type AccountSettings,
  type PartBlobRow,
  type PartCountResponse,
  type PartSnapshotRow,
  type PartsResponse,
  type RemovablePart,
  type RemovePartResponse,
  type Slot,
} from '@gdt/shared'
import { ApiError } from '../lib/http'
import { recomputeAccount } from './accounts'
import { listenerStatement } from './live'
import { collectAccountBlobs } from './maintenance'
import { REF_COLUMNS, REFS_SQL, toBytes } from './storage'

/** JSON characters per bound parameter of a write (D1 takes up to 2 MB). */
const CHUNK_CHARS = 900_000

/** Every statement's guard: the account's snapshots are the ones read (?1 account, ?2 count, ?3 max id). */
const GUARD = `(SELECT count(*) FROM snapshots WHERE account_id = ?1) = ?2
  AND coalesce((SELECT max(id) FROM snapshots WHERE account_id = ?1), 0) = ?3`

const hexOf = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

/** The slots whose blobs are decoded (shared sections); the rest are counted by size. */
const SHARED_SLOTS = new Set<Slot>(['player', 'progress', 'extras'])

interface Loaded {
  rows: PartSnapshotRow[]
  blobs: Map<number, PartBlobRow>
  count: number
  maxId: number
  guard: string
}

/**
 * The account's snapshot rows (live and trash) and the blobs of `slots`:
 * whole for the shared sections (they are decoded), their size alone for the
 * rest. Bases outside those kinds are read too.
 */
async function loadRows(d1: D1Database, accountId: number, slots: Slot[]): Promise<Loaded> {
  const decoded = slots.filter((slot) => SHARED_SLOTS.has(slot))
  const sized = slots.filter((slot) => !SHARED_SLOTS.has(slot))
  const codes = (list: Slot[]) =>
    JSON.stringify(list.flatMap((slot) => [kindCode(slot, false), kindCode(slot, true)]))
  const [snapshotsResult, wholeResult, sizedResult] = await d1.batch([
    d1
      .prepare(`SELECT id, taken_at, deleted_at, ${REFS_SQL} FROM snapshots WHERE account_id = ?1`)
      .bind(accountId),
    d1
      .prepare(
        `SELECT id, kind, hex(hash) AS hash, base_id, data FROM section_blobs
         WHERE account_id = ?1 AND kind IN (SELECT value FROM json_each(?2))`,
      )
      .bind(accountId, codes(decoded)),
    d1
      .prepare(
        `SELECT id, kind, hex(hash) AS hash, base_id, length(data) AS size FROM section_blobs
         WHERE account_id = ?1 AND kind IN (SELECT value FROM json_each(?2))`,
      )
      .bind(accountId, codes(sized)),
  ])
  const blobs = new Map<number, PartBlobRow>()
  for (const row of wholeResult!.results as Record<string, unknown>[]) {
    blobs.set(row.id as number, {
      id: row.id as number,
      code: row.kind as number,
      hash: String(row.hash).toLowerCase(),
      baseId: (row.base_id as number | null) ?? null,
      data: toBytes(row.data),
    })
  }
  for (const row of sizedResult!.results as Record<string, unknown>[]) {
    blobs.set(row.id as number, {
      id: row.id as number,
      code: row.kind as number,
      hash: String(row.hash).toLowerCase(),
      baseId: (row.base_id as number | null) ?? null,
      data: new Uint8Array(0),
      size: row.size as number,
    })
  }
  // A shared section's base of another kind (none today): read it whole.
  for (let round = 0; round < 3; round++) {
    const missing = [...blobs.values()]
      .map((b) => b.baseId)
      .filter((id): id is number => id !== null && !blobs.has(id))
    if (missing.length === 0) break
    const { results } = await d1
      .prepare(
        `SELECT id, kind, hex(hash) AS hash, base_id, data FROM section_blobs
         WHERE account_id = ?1 AND id IN (SELECT value FROM json_each(?2))`,
      )
      .bind(accountId, JSON.stringify([...new Set(missing)]))
      .all<Record<string, unknown>>()
    for (const row of results) {
      blobs.set(row.id as number, {
        id: row.id as number,
        code: row.kind as number,
        hash: String(row.hash).toLowerCase(),
        baseId: (row.base_id as number | null) ?? null,
        data: toBytes(row.data),
      })
    }
  }
  const snapshots = snapshotsResult!.results as Record<string, unknown>[]
  const rows: PartSnapshotRow[] = snapshots.map((s) => ({
    id: s.id as number,
    takenAt: s.taken_at as number,
    deleted: s.deleted_at !== null && s.deleted_at !== undefined,
    refs: Object.fromEntries(
      SLOTS.map((slot) => [slot, (s[REF_COLUMNS[slot]] as number | null) ?? null]),
    ),
  }))
  const count = rows.length
  const maxId = rows.reduce((max, row) => Math.max(max, row.id), 0)
  return { rows, blobs, count, maxId, guard: `${count}:${maxId}` }
}

/** Every slot any removable part touches. */
const ALL_PART_SLOTS = [...new Set(REMOVABLE_PARTS.flatMap((part) => partSlots(part)))]

/** GET /api/accounts/:id/parts: what each removable part holds. */
export async function countAccountParts(
  d1: D1Database,
  live: D1Database | null,
  accountId: number,
): Promise<PartsResponse> {
  const [loaded, journal] = await Promise.all([
    loadRows(d1, accountId, ALL_PART_SLOTS),
    live ? readJournalRows(live, accountId) : Promise.resolve(null),
  ])
  const changes = journal
    ? [...journal.rows.flatMap((row) => row.changes), ...(journal.tail?.changes ?? [])]
    : []
  const parts: PartCountResponse[] = countParts(loaded.rows, loaded.blobs).map((count) => ({
    ...count,
    liveChanges: changes.filter((change) => isPartChange(count.part, change)).length,
  }))
  return {
    total: loaded.rows.filter((row) => !row.deleted).length,
    guard: loaded.guard,
    live: journal !== null,
    parts,
  }
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

export interface RemovePartResult {
  response: RemovePartResponse
  /** The batch's recomputeAccount and listener results (for the live notice). */
  recomputed: D1Result | undefined
  listening: D1Result | undefined
  /**
   * The live journal step, when it failed or stayed busy: run again after
   * the response (the history is removed already, so the route answers 200).
   */
  later?: () => Promise<void>
}

/**
 * POST /api/accounts/:id/parts/remove. `guard` is what the counts the user
 * saw were of (PartsResponse.guard): a different history is refused.
 */
export async function removeAccountPart(
  d1: D1Database,
  live: D1Database | null,
  account: { id: number; settings: unknown },
  part: RemovablePart,
  guard: string,
  now = Date.now(),
): Promise<RemovePartResult> {
  const accountId = account.id
  const loaded = await loadRows(d1, accountId, partSlots(part))
  if (loaded.guard !== guard) throw historyChanged()
  const plan = await planPartRemoval(part, loaded.rows, loaded.blobs)

  const { count, maxId } = loaded
  const statements: D1PreparedStatement[] = []
  // Blobs that keep their id, standalone now (they leaned on a base holding the part).
  for (const json of chunks(
    plan.rewrites.map((b) => ({ id: b.id, k: b.code, d: hexOf(b.data) })),
  )) {
    statements.push(
      d1
        .prepare(
          `UPDATE section_blobs SET kind = json_extract(j.value, '$.k'), base_id = NULL,
             data = unhex(json_extract(j.value, '$.d'))
           FROM json_each(?4) AS j
           WHERE section_blobs.account_id = ?1 AND section_blobs.id = json_extract(j.value, '$.id')
             AND ${GUARD}`,
        )
        .bind(accountId, count, maxId, json),
    )
  }
  // The byte counter's triggers see inserts and deletes only (migration 0002).
  const rewritten = plan.rewrites.reduce(
    (sum, b) => sum + b.data.length - (loaded.blobs.get(b.id)?.data.length ?? 0),
    0,
  )
  if (rewritten !== 0) {
    statements.push(
      d1
        .prepare(
          `UPDATE genshin_accounts SET stored_bytes = stored_bytes + ?4 WHERE id = ?1 AND ${GUARD}`,
        )
        .bind(accountId, count, maxId, rewritten),
    )
  }
  for (const json of chunks(plan.blobs.map((b) => ({ h: b.hash, k: b.code, d: hexOf(b.data) })))) {
    statements.push(
      d1
        .prepare(
          `INSERT INTO section_blobs (account_id, hash, kind, base_id, data)
           SELECT ?1, unhex(json_extract(j.value, '$.h')), json_extract(j.value, '$.k'), NULL,
             unhex(json_extract(j.value, '$.d'))
           FROM json_each(?4) AS j WHERE ${GUARD}
           ON CONFLICT (account_id, hash) DO NOTHING`,
        )
        .bind(accountId, count, maxId, json),
    )
  }
  const rows = plan.updates.map((u) => {
    const row: Record<string, unknown> = { id: u.id, s: u.storedDelta }
    for (const [slot, ref] of Object.entries(u.refs)) {
      row[slot] = ref === null ? null : 'id' in ref! ? { i: ref.id } : { h: ref!.hash }
    }
    return row
  })
  for (const slot of partSlots(part)) {
    const column = REF_COLUMNS[slot]
    const touched = rows.filter((row) => slot in row)
    for (const json of chunks(touched.map((row) => ({ id: row.id, r: row[slot] })))) {
      statements.push(
        d1
          .prepare(
            `UPDATE snapshots SET ${column} = CASE
               WHEN json_type(j.value, '$.r') = 'null' THEN NULL
               WHEN json_extract(j.value, '$.r.i') IS NOT NULL THEN json_extract(j.value, '$.r.i')
               ELSE (SELECT b.id FROM section_blobs AS b WHERE b.account_id = ?1
                 AND b.hash = unhex(json_extract(j.value, '$.r.h'))) END
             FROM json_each(?4) AS j
             WHERE snapshots.account_id = ?1 AND snapshots.id = json_extract(j.value, '$.id')
               AND ${GUARD}`,
          )
          .bind(accountId, count, maxId, json),
      )
    }
  }
  const sized = rows.filter((row) => row.s !== 0).map((row) => ({ id: row.id, s: row.s }))
  for (const json of chunks(sized)) {
    statements.push(
      d1
        .prepare(
          `UPDATE snapshots SET stored_size = max(0, stored_size + json_extract(j.value, '$.s'))
           FROM json_each(?4) AS j
           WHERE snapshots.account_id = ?1 AND snapshots.id = json_extract(j.value, '$.id')
             AND ${GUARD}`,
        )
        .bind(accountId, count, maxId, json),
    )
  }
  // The mark the pages read ("Removed from history"), written with the rest.
  const settings = deepMerge(
    ACCOUNT_SETTINGS_DEFAULTS,
    (account.settings ?? {}) as object,
  ) as AccountSettings
  const stored = deepMerge((account.settings ?? {}) as object, {
    parts: { removed: { ...settings.parts.removed, [part]: now } },
  })
  const marked = statements.length
  statements.push(
    d1
      .prepare(`UPDATE genshin_accounts SET settings = ?4 WHERE id = ?1 AND ${GUARD} RETURNING id`)
      .bind(accountId, count, maxId, JSON.stringify(stored)),
  )
  const recomputedAt = statements.length
  statements.push(recomputeAccount(d1, accountId), collectAccountBlobs(d1, accountId))
  const listeningAt = statements.length
  statements.push(listenerStatement(d1, accountId))
  const results = await d1.batch(statements)
  if ((results[marked]!.results ?? []).length === 0) throw historyChanged()

  // The history is clean and written: a failing or busy journal never turns
  // that into an error; it is tried again after the response.
  let liveChanges = 0
  let later: (() => Promise<void>) | undefined
  if (live) {
    const dropped = await tryLiveChanges(live, accountId, part)
    if (dropped === null) {
      later = async () => {
        if ((await tryLiveChanges(live, accountId, part)) === null) {
          console.warn('remove_part_live_pending', accountId)
        }
      }
    } else liveChanges = dropped
  }
  return {
    response: { part, snapshots: plan.snapshots, freed: plan.freed, liveChanges, removedAt: now },
    recomputed: results[recomputedAt],
    listening: results[listeningAt],
    ...(later ? { later } : {}),
  }
}

/** removeLiveChanges, its errors logged: null when it failed or stayed busy. */
async function tryLiveChanges(
  live: D1Database,
  accountId: number,
  part: RemovablePart,
): Promise<number | null> {
  try {
    return await removeLiveChanges(live, accountId, part)
  } catch (error) {
    console.warn(
      'remove_part_live_failed',
      accountId,
      error instanceof Error ? error.name : 'error',
    )
    return null
  }
}

const historyChanged = () =>
  new ApiError(
    409,
    'capture_changed',
    'A capture arrived while removing, so nothing was removed. Read the counts again.',
  )

// ------------------------------------------------------------------ live sync

interface JournalRows {
  lastSeq: number
  bytes: number
  changesCount: number
  tail: { data: Uint8Array; changes: ReturnType<typeof decodeChanges> } | null
  rows: { seqFrom: number; data: Uint8Array; changes: ReturnType<typeof decodeChanges> }[]
}

async function readJournalRows(live: D1Database, accountId: number): Promise<JournalRows | null> {
  const [journalResult, batchesResult] = await live.batch<Record<string, unknown>>([
    live
      .prepare(
        'SELECT last_seq, bytes, changes, tail_from, tail FROM live_journals WHERE account_id = ?1',
      )
      .bind(accountId),
    live
      .prepare('SELECT seq_from, data FROM live_batches WHERE account_id = ?1 ORDER BY seq_from')
      .bind(accountId),
  ])
  const journal = journalResult!.results[0]
  if (!journal) return null
  const tailBytes = (journal.tail_from as number) > 0 && journal.tail ? toBytes(journal.tail) : null
  const rows = batchesResult!.results.map((row) => {
    const data = toBytes(row.data)
    return { seqFrom: row.seq_from as number, data, changes: decodeChanges(data) }
  })
  return {
    lastSeq: journal.last_seq as number,
    bytes: journal.bytes as number,
    changesCount: journal.changes as number,
    tail: tailBytes ? { data: tailBytes, changes: decodeChanges(tailBytes) } : null,
    rows,
  }
}

/**
 * Drops the part's changes from the account's open live journal (its rows
 * and its tail), the rest kept; the journal stays open. Guarded by the
 * journal's last seq: a batch that lands meanwhile makes it read again.
 * Returns how many changes went; null when batches kept landing (busy).
 */
export async function removeLiveChanges(
  live: D1Database,
  accountId: number,
  part: RemovablePart,
): Promise<number | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const journal = await readJournalRows(live, accountId)
    if (!journal) return 0
    const all = [
      ...journal.rows.map((row) => row.changes),
      ...(journal.tail ? [journal.tail.changes] : []),
    ]
    const dropped = all.reduce((sum, changes) => sum + withoutPartChanges(part, changes).dropped, 0)
    if (dropped === 0) return 0
    const guard = `EXISTS (SELECT 1 FROM live_journals WHERE account_id = ?1 AND last_seq = ?2)`
    const statements: D1PreparedStatement[] = []
    let bytesDelta = 0
    for (const row of journal.rows) {
      const { changes, dropped: gone } = withoutPartChanges(part, row.changes)
      if (gone === 0) continue
      if (changes.length === 0) {
        bytesDelta -= row.data.length
        statements.push(
          live
            .prepare(
              `DELETE FROM live_batches WHERE account_id = ?1 AND seq_from = ?3 AND ${guard}`,
            )
            .bind(accountId, journal.lastSeq, row.seqFrom),
        )
        continue
      }
      const data = await encodeChangesNative(changes)
      bytesDelta += data.length - row.data.length
      statements.push(
        live
          .prepare(
            `UPDATE live_batches SET data = ?4, changes = ?5
             WHERE account_id = ?1 AND seq_from = ?3 AND ${guard}`,
          )
          .bind(accountId, journal.lastSeq, row.seqFrom, data, changes.length),
      )
    }
    let tail: Uint8Array | null = null
    let tailChanges = 0
    if (journal.tail) {
      const { changes } = withoutPartChanges(part, journal.tail.changes)
      tail = await encodeChangesNative(changes)
      tailChanges = changes.length
      bytesDelta += tail.length - journal.tail.data.length
    }
    statements.push(
      live
        .prepare(
          `UPDATE live_journals SET changes = max(0, changes - ?3), bytes = max(0, bytes + ?4),
             tail = coalesce(?5, tail), tail_changes = CASE WHEN ?5 IS NULL THEN tail_changes ELSE ?6 END
           WHERE account_id = ?1 AND last_seq = ?2`,
        )
        .bind(accountId, journal.lastSeq, dropped, bytesDelta, tail, tailChanges),
    )
    const results = await live.batch(statements)
    if ((results.at(-1)!.meta.changes ?? 0) > 0) return dropped
  }
  console.warn('remove_part_live_busy', accountId)
  return null
}
