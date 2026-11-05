/**
 * Live sync (docs/plans/live-sync.md; the contract as built in its §13): the
 * journal of changes irminsul saw since an account's newest snapshot, kept in
 * the `gdt-live` database (binding LIVE_DB, schema db/live-schema.ts).
 *
 * - A snapshot from irminsul (services/upload-as) opens the account's journal
 *   on it (`openJournal`): its batch rows are deleted, the running figures
 *   start from the snapshot's summary, and the file's item guids are indexed.
 *   The import's answer then carries `live.base`.
 * - Each batch (`storeBatch`, POST /api/irminsul/changes) is checked against
 *   the journal (base, session, seq), merged into the newest batch row when
 *   that is under 10 minutes old, and updates the figures and the day's chart
 *   points. Two LIVE_DB round trips (one read batch, one write batch) and one
 *   read of `gdt` in parallel with the first.
 * - Pages read the journal merged (`readJournal`), the points per day, and may
 *   delete either.
 *
 * Live sync is on for every account wherever the LIVE_DB binding exists: the
 * capture app decides whether to send changes, the tracker takes them. Nothing here ever fails an import: opening a journal
 * that fails leaves the import's answer without `live` (irminsul stays on
 * snapshots).
 */

import {
  addPoint,
  applyFigures,
  decodeChanges,
  decodeFigures,
  decodeItemIndex,
  decodePoints,
  distinctPaths,
  encodeChanges,
  encodeFigures,
  encodeItemIndex,
  encodePoints,
  mergeChanges,
  pointDay,
  touchedBaseItems,
  type DeltaChange,
  type Figures,
  type GoodDelta,
  type ItemIndex,
  type LiveBatchPush,
  type LiveJournalResponse,
  type LivePoint,
  type SnapshotSummary,
} from '@gdt/shared'
import { ApiError } from '../lib/http'
import { toBytes } from './storage'
import { secondsToNextUtcDay, utcDay } from './upload-limits'

/** A journal older than this with more than COLLAPSE_CHANGES paths asks for a snapshot. */
export const COLLAPSE_AFTER_MS = 3 * 3_600_000
export const COLLAPSE_CHANGES = 500
/** A journal keeping more than this asks for a snapshot whatever its age. */
export const COLLAPSE_BYTES = 1024 * 1024
/** A batch this soon after the newest row's first one is merged into it. */
export const MERGE_WINDOW_MS = 10 * 60_000
/** Batches an account may send per UTC day; past it irminsul keeps to snapshots. */
export const DAILY_BATCHES = 2_000

/** The `gdt-live` database, or null where it is not bound (live sync off). */
export function liveDb(env: Env): D1Database | null {
  return (env as { LIVE_DB?: D1Database }).LIVE_DB ?? null
}

/** A journal's base as irminsul names it: the snapshot's content key in base 36. */
export function baseKeyOf(contentKey: number): string {
  return contentKey.toString(36)
}

export interface JournalStart {
  accountId: number
  userId: number
  contentKey: number
  snapshotId: number
  takenAt: number
  /** The snapshot's `gi_capture.session` ('' without one). */
  session: string
  summary: SnapshotSummary
  items: ItemIndex | null
}

/**
 * §7.6: the snapshot ends the account's journal and starts the next one.
 * Returns the base irminsul sends its batches for.
 */
export async function openJournal(live: D1Database, start: JournalStart): Promise<string> {
  const base = baseKeyOf(start.contentKey)
  const now = Date.now()
  await live.batch([
    live.prepare('DELETE FROM live_batches WHERE account_id = ?1').bind(start.accountId),
    live
      .prepare(
        `INSERT INTO live_journals (account_id, user_id, base_key, base_snapshot_id, session,
           last_seq, opened_at, updated_at, changes, bytes, figures, items)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7, 0, 0, ?8, ?9)
         ON CONFLICT (account_id) DO UPDATE SET user_id = excluded.user_id,
           base_key = excluded.base_key, base_snapshot_id = excluded.base_snapshot_id,
           session = excluded.session, last_seq = 0, opened_at = excluded.opened_at,
           updated_at = excluded.updated_at, changes = 0, bytes = 0,
           figures = excluded.figures, items = excluded.items`,
      )
      .bind(
        start.accountId,
        start.userId,
        base,
        start.snapshotId,
        start.session,
        start.takenAt,
        now,
        encodeFigures(start.summary),
        start.items ? encodeItemIndex(start.items) : null,
      ),
  ])
  return base
}

interface JournalRow {
  account_id: number
  user_id: number
  base_key: string
  base_snapshot_id: number
  session: string
  last_seq: number
  opened_at: number
  updated_at: number
  changes: number
  bytes: number
  figures: unknown
  items: unknown
  day: string
  day_batches: number
}

interface BatchRow {
  seq_from: number
  seq_to: number
  at: number
  changes: number
  data: unknown
}

export interface StoredBatch {
  seq: number
  collapse: boolean
  duplicate: boolean
  /** The batch for the live event, when its JSON is at most PUSH_MAX_BYTES. */
  batch?: LiveBatchPush
}

/**
 * The largest batch the live event carries (JSON characters): tabs apply it
 * without reading the journal. A bigger one is announced bare and re-read.
 */
export const PUSH_MAX_BYTES = 32_000

/**
 * Stores one batch in the account's journal (POST /api/irminsul/changes).
 * 409 `resync` when it does not continue the journal; 429
 * `daily_live_limit` past DAILY_BATCHES today.
 */
export async function storeBatch(
  live: D1Database,
  account: { id: number; userId: number },
  delta: GoodDelta,
  now = Date.now(),
): Promise<StoredBatch> {
  const today = utcDay(now)
  const [journalResult, newestResult, pointsResult] = await live.batch<Record<string, unknown>>([
    live.prepare('SELECT * FROM live_journals WHERE account_id = ?1').bind(account.id),
    live
      .prepare(
        `SELECT seq_from, seq_to, at, changes, data FROM live_batches
         WHERE account_id = ?1 ORDER BY seq_from DESC LIMIT 1`,
      )
      .bind(account.id),
    live
      .prepare('SELECT data FROM live_points WHERE account_id = ?1 AND day = ?2')
      .bind(account.id, today),
  ])
  const journal = journalResult!.results[0] as JournalRow | undefined
  if (journal && journal.base_key === delta.base && delta.seq <= journal.last_seq) {
    return { seq: delta.seq, collapse: false, duplicate: true }
  }
  if (
    !journal ||
    journal.base_key !== delta.base ||
    (journal.session !== '' && journal.session !== delta.session) ||
    delta.seq !== journal.last_seq + 1
  ) {
    throw new ApiError(409, 'resync', 'This batch does not follow the journal: send a snapshot')
  }
  const dayBatches = journal.day === today ? journal.day_batches : 0
  if (dayBatches >= DAILY_BATCHES) {
    throw new ApiError(
      429,
      'daily_live_limit',
      `Live sync sent ${DAILY_BATCHES.toLocaleString('en-US')} batches today; snapshots only until 00:00 UTC.`,
      undefined,
      { 'Retry-After': String(secondsToNextUtcDay(now)) },
    )
  }

  // The batch row: merged into the newest one while it is young.
  const newest = newestResult!.results[0] as BatchRow | undefined
  const merge = newest !== undefined && now - newest.at < MERGE_WINDOW_MS
  const changes = merge
    ? mergeChanges(decodeChanges(toBytes(newest.data)), delta.changes)
    : [...delta.changes]
  const data = encodeChanges(changes)
  const paths = distinctPaths(changes)
  const addedBytes = data.length - (merge ? toBytes(newest.data).length : 0)
  const addedPaths = paths - (merge ? newest.changes : 0)

  const figures = applyFigures(
    journal.figures ? decodeFigures(toBytes(journal.figures)) : emptyFigures(),
    delta.changes,
    delta.sum,
  )
  const pointsRow = pointsResult!.results[0] as { data: unknown } | undefined
  const points = addPoint(pointsRow ? decodePoints(today, toBytes(pointsRow.data)) : [], {
    at: now,
    figures,
  })

  // Every write is guarded by the journal still being where this batch read
  // it, so a concurrent batch of the same seq cannot store twice.
  // (?1 the account, ?6 the base, ?7 the last seq this batch read.)
  const guard = `EXISTS (SELECT 1 FROM live_journals WHERE account_id = ?1
    AND base_key = ?6 AND last_seq = ?7)`
  const statements: D1PreparedStatement[] = [
    merge
      ? live
          .prepare(
            `UPDATE live_batches SET seq_to = ?3, changes = ?4, data = ?5
             WHERE account_id = ?1 AND seq_from = ?2 AND ${guard}`,
          )
          .bind(account.id, newest.seq_from, delta.seq, paths, data, delta.base, journal.last_seq)
      : live
          .prepare(
            `INSERT INTO live_batches (account_id, seq_from, seq_to, at, changes, data)
             SELECT ?1, ?2, ?2, ?3, ?4, ?5 WHERE ${guard}
             ON CONFLICT DO NOTHING`,
          )
          .bind(account.id, delta.seq, now, paths, data, delta.base, journal.last_seq),
    live
      .prepare(
        `INSERT INTO live_points (account_id, day, user_id, data, updated_at)
         SELECT ?1, ?2, ?3, ?4, ?5 WHERE ${guard}
         ON CONFLICT (account_id, day) DO UPDATE SET data = excluded.data,
           updated_at = excluded.updated_at`,
      )
      .bind(
        account.id,
        today,
        account.userId,
        encodePoints(today, points),
        now,
        delta.base,
        journal.last_seq,
      ),
    live
      .prepare(
        `UPDATE live_journals SET last_seq = ?4, updated_at = ?5, changes = changes + ?6,
           bytes = bytes + ?7, figures = ?8, day = ?9, day_batches = ?10
         WHERE account_id = ?1 AND base_key = ?2 AND last_seq = ?3`,
      )
      .bind(
        account.id,
        delta.base,
        journal.last_seq,
        delta.seq,
        now,
        addedPaths,
        addedBytes,
        encodeFigures(figures),
        today,
        dayBatches + 1,
      ),
  ]
  const results = await live.batch(statements)
  if ((results.at(-1)!.meta.changes ?? 0) === 0) {
    // Another request moved the journal between the read and the write.
    throw new ApiError(409, 'resync', 'The journal moved on: send a snapshot')
  }
  const journalChanges = journal.changes + addedPaths
  const journalBytes = journal.bytes + addedBytes
  const collapse =
    (now - journal.opened_at > COLLAPSE_AFTER_MS && journalChanges > COLLAPSE_CHANGES) ||
    journalBytes > COLLAPSE_BYTES
  return {
    seq: delta.seq,
    collapse,
    duplicate: false,
    batch: pushOf(journal, delta, figures, now, journalBytes),
  }
}

/** The batch as tabs apply it (LiveBatchPush), or undefined when too big. */
function pushOf(
  journal: JournalRow,
  delta: GoodDelta,
  figures: Figures,
  now: number,
  bytes: number,
): LiveBatchPush | undefined {
  const touched = touchedBaseItems(delta.changes)
  const items: LiveBatchPush['items'] = []
  // The item index is decoded only when the batch touches a base item.
  if (touched.length > 0 && journal.items) {
    const index = decodeItemIndex(toBytes(journal.items))
    const lookup = { artifacts: new Map(index.artifacts), weapons: new Map(index.weapons) }
    for (const { kind, guid } of touched) {
      const fp = lookup[kind].get(guid)
      if (fp !== undefined) items.push([kind, guid, fp])
    }
  }
  const batch: LiveBatchPush = {
    base: journal.base_key,
    prev: journal.last_seq,
    changes: [...delta.changes],
    items,
    figures,
    updatedAt: now,
    bytes,
  }
  return JSON.stringify(batch).length <= PUSH_MAX_BYTES ? batch : undefined
}

function emptyFigures(): Figures {
  return {
    characters: 0,
    weapons: 0,
    artifacts: 0,
    materials: 0,
    mora: 0,
    primogem: 0,
    artifact3: 0,
    artifact4: 0,
  }
}

/** GET /api/accounts/:id/live: the journal, its rows merged into one list. */
export async function readJournal(
  live: D1Database,
  accountId: number,
): Promise<{ response: LiveJournalResponse; etag: string }> {
  const [journalResult, batchesResult] = await live.batch<Record<string, unknown>>([
    live.prepare('SELECT * FROM live_journals WHERE account_id = ?1').bind(accountId),
    live
      .prepare('SELECT data FROM live_batches WHERE account_id = ?1 ORDER BY seq_from')
      .bind(accountId),
  ])
  const journal = journalResult!.results[0] as JournalRow | undefined
  if (!journal) return { response: { open: false }, etag: '"live-none"' }
  let changes: DeltaChange[] = []
  for (const row of batchesResult!.results) {
    changes = mergeChanges(changes, decodeChanges(toBytes(row.data)))
  }
  const index = journal.items ? decodeItemIndex(toBytes(journal.items)) : null
  const items: NonNullable<LiveJournalResponse['items']> = []
  if (index) {
    const lookup = {
      artifacts: new Map(index.artifacts),
      weapons: new Map(index.weapons),
    }
    for (const { kind, guid } of touchedBaseItems(changes)) {
      const fp = lookup[kind].get(guid)
      if (fp !== undefined) items.push([kind, guid, fp])
    }
  }
  return {
    response: {
      open: true,
      base: {
        snapshotId: journal.base_snapshot_id,
        contentKey: journal.base_key,
        takenAt: journal.opened_at,
      },
      session: journal.session,
      seq: journal.last_seq,
      updatedAt: journal.updated_at,
      figures: journal.figures ? decodeFigures(toBytes(journal.figures)) : undefined,
      changes,
      items,
      bytes: journal.bytes,
    },
    etag: `"live-${journal.base_key}-${journal.base_snapshot_id}-${journal.last_seq}"`,
  }
}

/** The account's chart points from day `from` to day `to` (inclusive, YYYY-MM-DD). */
export async function readPoints(
  live: D1Database,
  accountId: number,
  from: string,
  to: string,
): Promise<LivePoint[]> {
  const { results } = await live
    .prepare(
      'SELECT day, data FROM live_points WHERE account_id = ?1 AND day >= ?2 AND day <= ?3 ORDER BY day',
    )
    .bind(accountId, from, to)
    .all<{ day: string; data: unknown }>()
  return results.flatMap((row) => decodePoints(row.day, toBytes(row.data)))
}

/** Deletes an account's journal (its batches; the row is kept closed for its day counter). */
export function deleteJournalStatements(
  live: D1Database,
  accountId: number,
): D1PreparedStatement[] {
  return [
    live.prepare('DELETE FROM live_batches WHERE account_id = ?1').bind(accountId),
    live.prepare('DELETE FROM live_journals WHERE account_id = ?1').bind(accountId),
  ]
}

/** A deleted snapshot that a journal follows ends that journal. */
export async function endJournalOn(
  live: D1Database | null,
  accountId: number,
  snapshotIds: number[],
): Promise<void> {
  if (!live || snapshotIds.length === 0) return
  const ids = JSON.stringify(snapshotIds)
  await live.batch([
    live
      .prepare(
        `DELETE FROM live_batches WHERE account_id = ?1 AND EXISTS (SELECT 1 FROM live_journals
           WHERE account_id = ?1 AND base_snapshot_id IN (SELECT value FROM json_each(?2)))`,
      )
      .bind(accountId, ids),
    live
      .prepare(
        `DELETE FROM live_journals WHERE account_id = ?1
           AND base_snapshot_id IN (SELECT value FROM json_each(?2))`,
      )
      .bind(accountId, ids),
  ])
}

/** Everything `gdt-live` keeps for these users (users deleted). */
export async function deleteUsersLiveData(
  live: D1Database | null,
  userIds: number[],
): Promise<void> {
  if (!live || userIds.length === 0) return
  const ids = JSON.stringify(userIds)
  await live.batch([
    live
      .prepare(
        `DELETE FROM live_batches WHERE account_id IN (SELECT account_id FROM live_journals
           WHERE user_id IN (SELECT value FROM json_each(?1)))`,
      )
      .bind(ids),
    live
      .prepare('DELETE FROM live_journals WHERE user_id IN (SELECT value FROM json_each(?1))')
      .bind(ids),
    live
      .prepare('DELETE FROM live_points WHERE user_id IN (SELECT value FROM json_each(?1))')
      .bind(ids),
  ])
}

/** Everything `gdt-live` keeps for these accounts (account or user deleted). */
export async function deleteLiveData(live: D1Database | null, accountIds: number[]): Promise<void> {
  if (!live || accountIds.length === 0) return
  const ids = JSON.stringify(accountIds)
  await live.batch([
    live
      .prepare('DELETE FROM live_batches WHERE account_id IN (SELECT value FROM json_each(?1))')
      .bind(ids),
    live
      .prepare('DELETE FROM live_journals WHERE account_id IN (SELECT value FROM json_each(?1))')
      .bind(ids),
    live
      .prepare('DELETE FROM live_points WHERE account_id IN (SELECT value FROM json_each(?1))')
      .bind(ids),
  ])
}

/** Bytes a user keeps in `gdt-live` (journal batch rows and item indexes, chart points). */
export function liveUsageStatement(live: D1Database, userId: number): D1PreparedStatement {
  return live
    .prepare(
      `SELECT (SELECT coalesce(sum(bytes + coalesce(length(items), 0)), 0) FROM live_journals
               WHERE user_id = ?1)
            + (SELECT coalesce(sum(length(data)), 0) FROM live_points WHERE user_id = ?1)
         AS bytes`,
    )
    .bind(userId)
}

/** `gdt-live` bytes per user, for the staff storage page (empty when the read fails). */
export async function liveBytesByUser(
  live: D1Database | null,
  userIds: number[],
): Promise<Map<number, number>> {
  if (!live || userIds.length === 0) return new Map()
  try {
    const ids = JSON.stringify(userIds)
    const { results } = await live
      .prepare(
        `SELECT user_id, sum(bytes) AS bytes FROM (
           SELECT user_id, bytes + coalesce(length(items), 0) AS bytes FROM live_journals
             WHERE user_id IN (SELECT value FROM json_each(?1))
           UNION ALL
           SELECT user_id, length(data) AS bytes FROM live_points
             WHERE user_id IN (SELECT value FROM json_each(?1)))
         GROUP BY user_id`,
      )
      .bind(ids)
      .all<{ user_id: number; bytes: number }>()
    return new Map(results.map((row) => [row.user_id, Number(row.bytes)]))
  } catch (error) {
    console.warn('live_bytes_failed', String(error))
    return new Map()
  }
}

/** A user's `gdt-live` bytes (0 without the binding, or when the read fails). */
export async function liveUsage(live: D1Database | null, userId: number): Promise<number> {
  if (!live) return 0
  try {
    const row = await liveUsageStatement(live, userId).first<{ bytes: number }>()
    return Number(row?.bytes ?? 0)
  } catch (error) {
    console.warn('live_usage_failed', String(error))
    return 0
  }
}
