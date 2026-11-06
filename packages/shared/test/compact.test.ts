import { describe, expect, it } from 'vitest'
import { compactPlan } from '../src/compact'

const HOUR = 3_600_000
const DAY = 24 * HOUR
// Monday 2026-11-02 00:00 UTC.
const MONDAY = Date.UTC(2026, 10, 2)

const at = (id: number, ms: number) => ({ id, takenAt: ms })

describe('compactPlan', () => {
  it("keeps the newest snapshot of each day on the viewer's clock", () => {
    const rows = [
      at(1, MONDAY + 1 * HOUR),
      at(2, MONDAY + 5 * HOUR),
      at(3, MONDAY + 23 * HOUR),
      at(4, MONDAY + DAY + 2 * HOUR),
      at(5, MONDAY + DAY + 20 * HOUR),
    ]
    const utc = compactPlan(rows, { keep: 'day', offsetMinutes: 0 })
    expect([...utc.kept].sort()).toEqual([3, 5])
    expect([...utc.removed].sort()).toEqual([1, 2, 4])
    // At UTC+8 the 23:00 snapshot is already the next day: it stays, and so does Tuesday's.
    const east = compactPlan(rows, { keep: 'day', offsetMinutes: 480 })
    expect([...east.kept].sort()).toEqual([2, 4, 5])
    expect([...east.removed].sort()).toEqual([1, 3])
  })

  it('keeps one per Monday-started week', () => {
    const rows = [
      at(1, MONDAY - 2 * DAY), // Saturday of the week before
      at(2, MONDAY - 1 * DAY + 3 * HOUR), // Sunday
      at(3, MONDAY + 12 * HOUR), // Monday
      at(4, MONDAY + 6 * DAY + 23 * HOUR), // Sunday, same week
      at(5, MONDAY + 7 * DAY), // next Monday
    ]
    const plan = compactPlan(rows, { keep: 'week', offsetMinutes: 0 })
    expect([...plan.kept].sort()).toEqual([2, 4, 5])
    expect([...plan.removed].sort()).toEqual([1, 3])
  })

  it('leaves snapshots from `before` on untouched and always keeps the newest', () => {
    const rows = [
      at(1, MONDAY),
      at(2, MONDAY + HOUR),
      at(3, MONDAY + 2 * HOUR),
      at(4, MONDAY + DAY),
    ]
    const plan = compactPlan(rows, { keep: 'day', offsetMinutes: 0, before: MONDAY + 2 * HOUR })
    // 3 and 4 are at or after `before`: kept as they are; of 1 and 2 the newer stays.
    expect([...plan.kept].sort()).toEqual([2, 3, 4])
    expect(plan.removed).toEqual([1])
    const only = compactPlan([at(9, MONDAY)], { keep: 'week', offsetMinutes: 0, before: 0 })
    expect(only).toEqual({ kept: [9], removed: [] })
  })

  it('is empty for an empty history', () => {
    expect(compactPlan([], { keep: 'day', offsetMinutes: 0 })).toEqual({ kept: [], removed: [] })
  })
})
