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
 *   the journal (base, session, seq), merged into the journal row's open
 *   tail, and updates the figures and the day's chart points, which the
 *   journal row holds too: a batch writes that one row
 *   (docs/plans/live-batch-writes.md). The tail moves to a `live_batches` row
 *   past SPILL_BYTES; the points move to `live_points` when the UTC day turns
 *   or the journal row goes (`FLUSH_POINTS_SQL`). Two LIVE_DB round trips (one
 *   read batch, one write batch) and one read of `gdt` in parallel with the
 *   first.
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
  encodeChangesNative,
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
/**
 * The open tail's largest encoded size: a batch that would grow it past this
 * moves the tail to a `live_batches` row and starts a new one. Bounds the
 * re-encoding per batch; a typical journal (~60 B a batch) never reaches it.
 */
export const SPILL_BYTES = 16 * 1024
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
 * Returns the base irminsul sends its batches for. The day's chart points in
 * the row stay: they belong to the account, not to the journal.
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
           figures = excluded.figures, items = excluded.items,
           tail_from = 0, tail_at = 0, tail_changes = 0, tail = NULL`,
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
  /** Null when the read left it out (no base item touched). */
  items: unknown
  day: string
  day_batches: number
  tail_from: number
  tail_at: number
  tail_changes: number
  tail: unknown
  points_day: string
  points: unknown
}

/** The journal row as a batch reads it: the item index only when `?2` is true. */
const JOURNAL_FOR_BATCH_SQL = `SELECT account_id, user_id, base_key, base_snapshot_id, session,
    last_seq, opened_at, updated_at, changes, bytes, figures,
    CASE WHEN ?2 THEN items END AS items, day, day_batches,
    tail_from, tail_at, tail_changes, tail, points_day, points
  FROM live_journals WHERE account_id = ?1`

/**
 * Copies journal rows' chart points to `live_points` (the whole day, as is:
 * the row holds every point of `points_day`). Runs before a journal row is
 * deleted or its day turns, so the points outlive it. `filter` picks the
 * journal rows (its binds follow).
 */
function flushPointsStatement(
  live: D1Database,
  filter: string,
  ...binds: unknown[]
): D1PreparedStatement {
  return live
    .prepare(
      `INSERT INTO live_points (account_id, day, user_id, data, updated_at)
       SELECT account_id, points_day, user_id, points, updated_at FROM live_journals
       WHERE points IS NOT NULL AND points_day <> '' AND ${filter}
       ON CONFLICT (account_id, day) DO UPDATE SET data = excluded.data,
         updated_at = excluded.updated_at`,
    )
    .bind(...binds)
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
 *
 * Writes one row (the journal's), plus a `live_batches` row when the tail
 * spills and a `live_points` row when the UTC day turns.
 */
export async function storeBatch(
  live: D1Database,
  account: { id: number; userId: number },
  delta: GoodDelta,
  now = Date.now(),
): Promise<StoredBatch> {
  const today = utcDay(now)
  const touched = touchedBaseItems(delta.changes)
  const [journalResult, pointsResult] = await live.batch<Record<string, unknown>>([
    live.prepare(JOURNAL_FOR_BATCH_SQL).bind(account.id, touched.length > 0 ? 1 : 0),
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

  // The tail: this batch merged into it, unless that would pass SPILL_BYTES;
  // then the old tail becomes a `live_batches` row and this batch starts anew.
  const oldTail = journal.tail_from > 0 && journal.tail ? toBytes(journal.tail) : null
  let changes = oldTail ? mergeChanges(decodeChanges(oldTail), delta.changes) : [...delta.changes]
  let tail = await encodeChangesNative(changes)
  const spill = oldTail !== null && tail.length > SPILL_BYTES
  if (spill) {
    changes = [...delta.changes]
    tail = await encodeChangesNative(changes)
  }
  const merged = oldTail !== null && !spill
  const paths = distinctPaths(changes)
  const addedBytes = tail.length - (merged ? oldTail.length : 0)
  const addedPaths = paths - (merged ? journal.tail_changes : 0)

  const figures = applyFigures(
    journal.figures ? decodeFigures(toBytes(journal.figures)) : emptyFigures(),
    delta.changes,
    delta.sum,
  )
  // Today's points: the row's own while they are today's. On a new day the
  // old day's go to `live_points`, and today's start from its row there (one
  // a deleted journal left), if any.
  const sameDay = journal.points_day === today && journal.points !== null
  const pointsRow = pointsResult!.results[0] as { data: unknown } | undefined
  const before = sameDay
    ? decodePoints(today, toBytes(journal.points))
    : pointsRow
      ? decodePoints(today, toBytes(pointsRow.data))
      : []
  const points = addPoint(before, { at: now, figures })
  const flushDay = !sameDay && journal.points !== null && journal.points_day !== ''

  // The extras run first, while the journal is still where this batch read
  // it (their filters say so); the journal update is its own guard.
  const statements: D1PreparedStatement[] = []
  if (spill) {
    statements.push(
      live
        .prepare(
          `INSERT INTO live_batches (account_id, seq_from, seq_to, at, changes, data)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE EXISTS (SELECT 1 FROM live_journals
             WHERE account_id = ?1 AND base_key = ?7 AND last_seq = ?3)
           ON CONFLICT DO NOTHING`,
        )
        .bind(
          account.id,
          journal.tail_from,
          journal.last_seq,
          journal.tail_at,
          journal.tail_changes,
          oldTail,
          delta.base,
        ),
    )
  }
  if (flushDay) {
    statements.push(
      flushPointsStatement(
        live,
        'account_id = ?1 AND base_key = ?2 AND last_seq = ?3',
        account.id,
        delta.base,
        journal.last_seq,
      ),
    )
  }
  statements.push(
    live
      .prepare(
        `UPDATE live_journals SET last_seq = ?4, updated_at = ?5, changes = changes + ?6,
           bytes = bytes + ?7, figures = ?8, day = ?9, day_batches = ?10,
           tail_from = ?11, tail_at = ?12, tail_changes = ?13, tail = ?14,
           points_day = ?9, points = ?15
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
        merged ? journal.tail_from : delta.seq,
        merged ? journal.tail_at : now,
        paths,
        tail,
        encodePoints(today, points),
      ),
  )
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
    batch: pushOf(journal, delta, touched, figures, now, journalBytes),
  }
}

/** The batch as tabs apply it (LiveBatchPush), or undefined when too big. */
function pushOf(
  journal: JournalRow,
  delta: GoodDelta,
  touched: ReturnType<typeof touchedBaseItems>,
  figures: Figures,
  now: number,
  bytes: number,
): LiveBatchPush | undefined {
  const items: LiveBatchPush['items'] = []
  // The item index is read (and decoded) only when the batch touches a base item.
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
  // The older rows in order, then the open tail (newer than every row).
  let changes: DeltaChange[] = []
  for (const row of batchesResult!.results) {
    changes = mergeChanges(changes, decodeChanges(toBytes(row.data)))
  }
  if (journal.tail_from > 0 && journal.tail) {
    changes = mergeChanges(changes, decodeChanges(toBytes(journal.tail)))
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

/**
 * The account's chart points from day `from` to day `to` (inclusive,
 * YYYY-MM-DD): the `live_points` rows, with the journal row's day in place of
 * that day's row (the row holds the whole day).
 */
export async function readPoints(
  live: D1Database,
  accountId: number,
  from: string,
  to: string,
): Promise<LivePoint[]> {
  const [rowsResult, journalResult] = await live.batch<{ day: string; data: unknown }>([
    live
      .prepare(
        'SELECT day, data FROM live_points WHERE account_id = ?1 AND day >= ?2 AND day <= ?3',
      )
      .bind(accountId, from, to),
    live
      .prepare(
        `SELECT points_day AS day, points AS data FROM live_journals
         WHERE account_id = ?1 AND points IS NOT NULL AND points_day >= ?2 AND points_day <= ?3`,
      )
      .bind(accountId, from, to),
  ])
  const days = new Map<string, unknown>()
  for (const row of rowsResult!.results) days.set(row.day, row.data)
  for (const row of journalResult!.results) days.set(row.day, row.data)
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .flatMap(([day, data]) => decodePoints(day, toBytes(data)))
}

/**
 * Deletes chart points: one UTC day, or every day without one. The journal
 * row's copy of that day goes too.
 */
export function deletePointsStatements(
  live: D1Database,
  accountId: number,
  day?: string,
): D1PreparedStatement[] {
  return day
    ? [
        live
          .prepare('DELETE FROM live_points WHERE account_id = ?1 AND day = ?2')
          .bind(accountId, day),
        live
          .prepare(
            `UPDATE live_journals SET points = NULL, points_day = ''
             WHERE account_id = ?1 AND points_day = ?2`,
          )
          .bind(accountId, day),
      ]
    : [
        live.prepare('DELETE FROM live_points WHERE account_id = ?1').bind(accountId),
        live
          .prepare(
            `UPDATE live_journals SET points = NULL, points_day = ''
             WHERE account_id = ?1 AND points IS NOT NULL`,
          )
          .bind(accountId),
      ]
}

/** Deletes an account's journal (its rows); the day's chart points move to `live_points` first. */
export function deleteJournalStatements(
  live: D1Database,
  accountId: number,
): D1PreparedStatement[] {
  return [
    flushPointsStatement(live, 'account_id = ?1', accountId),
    live.prepare('DELETE FROM live_batches WHERE account_id = ?1').bind(accountId),
    live.prepare('DELETE FROM live_journals WHERE account_id = ?1').bind(accountId),
  ]
}

/**
 * Moves every open tail to a `live_batches` row and every journal's points to
 * `live_points`, leaving the journals as the code before the tail wrote them
 * (scripts/live-flush.ts; only for rolling the Worker back past that change).
 * Safe at any time: the next batch starts a new tail and re-reads today's
 * points. Returns how many tails and point days moved.
 */
export async function flushJournals(live: D1Database): Promise<{ tails: number; points: number }> {
  const [tails, , points] = await live.batch([
    live.prepare(
      `INSERT INTO live_batches (account_id, seq_from, seq_to, at, changes, data)
       SELECT account_id, tail_from, last_seq, tail_at, tail_changes, tail FROM live_journals
       WHERE tail_from > 0 AND tail IS NOT NULL
       ON CONFLICT DO NOTHING`,
    ),
    live.prepare(
      `UPDATE live_journals SET tail_from = 0, tail_at = 0, tail_changes = 0, tail = NULL
       WHERE tail_from > 0 OR tail IS NOT NULL`,
    ),
    flushPointsStatement(live, 'true'),
    live.prepare(
      `UPDATE live_journals SET points = NULL, points_day = ''
       WHERE points IS NOT NULL OR points_day <> ''`,
    ),
  ])
  return { tails: tails!.meta.changes ?? 0, points: points!.meta.changes ?? 0 }
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
    flushPointsStatement(
      live,
      'account_id = ?1 AND base_snapshot_id IN (SELECT value FROM json_each(?2))',
      accountId,
      ids,
    ),
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

/**
 * A journal row's bytes: its batches (rows and tail, counted in `bytes`), its
 * item index and the day's points it holds.
 */
const JOURNAL_BYTES_SQL = 'bytes + coalesce(length(items), 0) + coalesce(length(points), 0)'

/**
 * `live_points` rows that a journal row does not hold a newer copy of (a
 * deleted journal's day that a later journal took over).
 */
const OWN_POINTS_SQL = `NOT EXISTS (SELECT 1 FROM live_journals AS j
  WHERE j.account_id = p.account_id AND j.points_day = p.day AND j.points IS NOT NULL)`

/** Bytes a user keeps in `gdt-live` (journal batch rows and item indexes, chart points). */
export function liveUsageStatement(live: D1Database, userId: number): D1PreparedStatement {
  return live
    .prepare(
      `SELECT (SELECT coalesce(sum(${JOURNAL_BYTES_SQL}), 0) FROM live_journals
               WHERE user_id = ?1)
            + (SELECT coalesce(sum(length(data)), 0) FROM live_points AS p
               WHERE user_id = ?1 AND ${OWN_POINTS_SQL})
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
           SELECT user_id, ${JOURNAL_BYTES_SQL} AS bytes FROM live_journals
             WHERE user_id IN (SELECT value FROM json_each(?1))
           UNION ALL
           SELECT user_id, length(data) AS bytes FROM live_points AS p
             WHERE user_id IN (SELECT value FROM json_each(?1)) AND ${OWN_POINTS_SQL})
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
