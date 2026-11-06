/**
 * Compacting a snapshot history: keep one snapshot per day or per week, the
 * newest of each period, and remove the rest. Pure, so the page previews
 * the plan from the list it holds and the Worker computes the same plan
 * from the database before deleting.
 *
 * Periods are calendar days or Monday-started weeks on the viewer's clock
 * (`offsetMinutes` east of UTC, as the page shows its dates), so "one a day"
 * means one per date the user sees. Only snapshots taken before `before`
 * (ms) are considered when it is set; the newest snapshot overall is always
 * kept.
 */

export type CompactKeep = 'day' | 'week'

export interface CompactRow {
  id: number
  /** Unix ms. */
  takenAt: number
}

export interface CompactOptions {
  keep: CompactKeep
  /** Minutes east of UTC of the clock the periods are cut on. */
  offsetMinutes: number
  /** Only snapshots taken before this (ms); null or absent: all of them. */
  before?: number | null
}

export interface CompactPlan {
  kept: number[]
  removed: number[]
}

const DAY = 86_400_000
/** 1970-01-01 was a Thursday: Monday-started weeks begin 3 days earlier. */
const WEEK_SHIFT = 3 * DAY

function periodOf(takenAt: number, options: CompactOptions): number {
  const local = takenAt + options.offsetMinutes * 60_000
  return options.keep === 'day'
    ? Math.floor(local / DAY)
    : Math.floor((local + WEEK_SHIFT) / (7 * DAY))
}

export function compactPlan(rows: readonly CompactRow[], options: CompactOptions): CompactPlan {
  const kept: number[] = []
  const removed: number[] = []
  if (rows.length === 0) return { kept, removed }
  const newer = (a: CompactRow, b: CompactRow) =>
    b.takenAt > a.takenAt || (b.takenAt === a.takenAt && b.id > a.id) ? b : a
  const newest = rows.reduce(newer)
  const before = options.before ?? null
  const winners = new Map<number, CompactRow>()
  for (const row of rows) {
    if (before !== null && row.takenAt >= before) continue
    const period = periodOf(row.takenAt, options)
    const current = winners.get(period)
    winners.set(period, current ? newer(current, row) : row)
  }
  const keep = new Set([newest.id, ...[...winners.values()].map((row) => row.id)])
  for (const row of rows) {
    const stays = keep.has(row.id) || (before !== null && row.takenAt >= before)
    ;(stays ? kept : removed).push(row.id)
  }
  return { kept, removed }
}
