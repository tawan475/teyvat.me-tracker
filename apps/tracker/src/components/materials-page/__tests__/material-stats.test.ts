import { describe, expect, it } from 'vitest'
import { DAY, HOUR } from '@/data/chart-range'
import {
  chartFrame,
  seriesPoints,
  withLiveMaterials,
  type MaterialsHistory,
} from '@/data/materials-history'
import {
  chartPoints,
  flowBetween,
  frameChange,
  frameStart,
  isChangePeriod,
  rangeFrame,
  referenceFor,
} from '../material-stats'

const at = (y: number, m: number, d: number, h = 0, min = 0) =>
  new Date(y, m - 1, d, h, min).getTime()

/** A history of one key ("Mora") with the given counts per snapshot. */
function history(times: number[], counts: number[], lastSeenAt = times.at(-1)!): MaterialsHistory {
  return {
    times,
    ids: times.map((_, i) => i + 1),
    lastSeenAt,
    series: new Map([['Mora', { at: counts.map((_, i) => i), value: counts }]]),
    latest: new Map([['Mora', counts.at(-1)!]]),
  }
}

describe('materials chart range', () => {
  const end = at(2026, 10, 5, 14, 20)

  it('keeps every snapshot of a short range, the count at its start carried in', () => {
    // A burst of six snapshots inside one hour, after an older one.
    const times = [end - 5 * HOUR, ...[50, 40, 30, 20, 10, 0].map((ago) => end - ago * 60_000)]
    const h = history(times, [100, 110, 120, 130, 140, 150, 160])
    const frame = rangeFrame(h, '1h')
    expect(frame.from).toBe(end - HOUR)
    expect(frame.carryIn).toBe(0)
    expect(frame.indices).toEqual([1, 2, 3, 4, 5, 6])
    expect(chartPoints(h, 'Mora', frame).map((p) => p.y)).toEqual([
      100, 110, 120, 130, 140, 150, 160,
    ])
    expect(frameChange(h, 'Mora', frame)).toBe(60)
    expect(flowBetween(h.series.get('Mora'), frame.baseline, 6).gained).toBe(60)
    expect(frameStart(h, frame)).toBe(end - HOUR)
  })

  it('draws the last known count flat when nothing was taken in the range', () => {
    // The newest snapshot was taken 5 hours before Irminsul last saw it unchanged.
    const h = history([end - 30 * HOUR, end - 5 * HOUR], [100, 200], end)
    const frame = rangeFrame(h, '1h')
    expect(frame.indices).toEqual([])
    expect(frame.carryIn).toBe(1)
    expect(frame.count).toBe(0)
    expect(chartPoints(h, 'Mora', frame)).toEqual([
      { x: end - HOUR, y: 200 },
      { x: end, y: 200 },
    ])
    expect(frameChange(h, 'Mora', frame)).toBe(0)
  })

  it('keeps the last snapshot per day over long spans', () => {
    const times: number[] = []
    for (let d = 200; d >= 0; d--) {
      times.push(end - d * DAY - 2 * HOUR, end - d * DAY)
    }
    const h = history(
      times,
      times.map((_, i) => i),
    )
    const year = rangeFrame(h, '1y')
    expect(year.indices.length).toBe(201)
    // 14 days: every snapshot is kept per hour (two a day, two hours apart).
    const fortnight = rangeFrame(h, '14d')
    expect(fortnight.indices.length).toBe(fortnight.count)
    // 3 days: every snapshot.
    const days = rangeFrame(h, '3d')
    expect(days.indices.length).toBe(days.count)
  })
})

describe('change since', () => {
  const end = at(2026, 10, 5, 14, 20)
  // Captures 40 days, 8 days, 2 days, 5 hours and 30 minutes before the newest.
  const times = [40 * DAY, 8 * DAY, 2 * DAY, 5 * HOUR, 30 * 60_000, 0].map((ago) => end - ago)
  const h = history(times, [1, 2, 3, 4, 5, 6])
  const index = (period: Parameters<typeof referenceFor>[1]) => referenceFor(h, period)?.index

  it('compares with the count held when the range starts', () => {
    expect(index('last')).toBe(4)
    // An hour back the count was the one captured 5 hours before the newest.
    expect(index('1h')).toBe(3)
    expect(index('3h')).toBe(3)
    expect(index('6h')).toBe(2)
    expect(index('1d')).toBe(2)
    expect(index('3d')).toBe(1)
    expect(index('7d')).toBe(1)
    expect(index('14d')).toBe(0)
    expect(index('all')).toBe(0)
  })

  it('never compares the newest capture with itself, and needs two', () => {
    const close = history([end - 10 * 60_000, end], [1, 2])
    expect(referenceFor(close, '1h')?.index).toBe(0)
    expect(referenceFor(history([end], [1]), '1d')).toBeNull()
  })

  it('reads stored choices, old ones included', () => {
    for (const value of ['last', '7d', '30d', '1h', '14d', 'all'])
      expect(isChangePeriod(value)).toBe(true)
    for (const value of ['90d', '', null, 7]) expect(isChangePeriod(value)).toBe(false)
  })
})

describe('captures that did not share the materials', () => {
  const end = at(2026, 10, 5, 14, 20)
  const MIN = 60_000
  const ago = (minutes: number) => end - minutes * MIN

  /**
   * As `history`, with the captures that left the materials out (Capture's
   * gi_off): `seen` is each snapshot's last sighting, `unshared` their times.
   */
  function gapped(
    times: number[],
    counts: number[],
    seen: number[],
    unshared: number[],
  ): MaterialsHistory {
    return { ...history(times, counts, seen.at(-1)!), unshared: { at: unshared, seen } }
  }

  it('breaks the line there: no 0, no count held across', () => {
    // Shared 50 minutes ago (seen again 5 minutes later), two captures with
    // the switch off, then shared again 10 minutes ago and seen until now.
    const h = gapped([ago(50), ago(10)], [100, 120], [ago(45), end], [ago(30), ago(20)])
    const frame = rangeFrame(h, '1h')
    expect(frame.indices).toEqual([0, 1])
    expect(frame.gaps).toEqual([ago(30), ago(20)])
    expect(frame.opensUnshared).toBeUndefined()
    const points = [
      { x: ago(50), y: 100 },
      // The line ends where the count was last confirmed.
      { x: ago(45), y: 100 },
      { x: ago(30), y: null },
      { x: ago(20), y: null },
      { x: ago(10), y: 120 },
      { x: end, y: 120 },
    ]
    expect(chartPoints(h, 'Mora', frame)).toEqual(points)
    expect(seriesPoints(h, 'Mora', frame)).toEqual(points)
    // The figures beside the chart still compare the captures that shared them.
    expect(frameChange(h, 'Mora', frame)).toBe(20)
  })

  it('holds nothing to the end after one', () => {
    const h = gapped([ago(50)], [100], [ago(40)], [ago(30), ago(5)])
    const frame = rangeFrame(h, '1h')
    expect(frame.end).toBe(ago(40))
    expect(chartPoints(h, 'Mora', frame)).toEqual([
      { x: ago(50), y: 100 },
      { x: ago(40), y: 100 },
      { x: ago(30), y: null },
      { x: ago(5), y: null },
    ])
    // A snapshot never seen again ends on its own point.
    const once = gapped([ago(50)], [100], [ago(50)], [ago(30)])
    expect(chartPoints(once, 'Mora', rangeFrame(once, '1h'))).toEqual([
      { x: ago(50), y: 100 },
      { x: ago(30), y: null },
    ])
  })

  it('carries no count into a range that opens after one', () => {
    // Shared 5 hours ago, switched off 3 hours ago, shared again 30 minutes ago.
    const times = [end - 5 * HOUR, ago(30)]
    const off = gapped(times, [100, 120], [end - 5 * HOUR, end], [end - 3 * HOUR])
    const frame = rangeFrame(off, '1h')
    expect(frame.carryIn).toBe(0)
    expect(frame.opensUnshared).toBe(true)
    expect(frame.gaps).toBeUndefined()
    expect(chartPoints(off, 'Mora', frame)).toEqual([
      { x: end - HOUR, y: null },
      { x: ago(30), y: 120 },
      { x: end, y: 120 },
    ])
    // One before the snapshot carried in says nothing about the range.
    const earlier = gapped(times, [100, 120], [end - 5 * HOUR, end], [end - 6 * HOUR])
    const shared = rangeFrame(earlier, '1h')
    expect(shared.opensUnshared).toBeUndefined()
    expect(chartPoints(earlier, 'Mora', shared)[0]).toEqual({ x: end - HOUR, y: 100 })
    // No snapshot before the range at all, only a capture that shared nothing.
    const first = gapped([ago(30)], [120], [end], [end - 3 * HOUR])
    const opening = rangeFrame(first, '1h')
    expect(opening.carryIn).toBe(-1)
    expect(chartPoints(first, 'Mora', opening)).toEqual([
      { x: end - HOUR, y: null },
      { x: ago(30), y: 120 },
      { x: end, y: 120 },
    ])
  })

  it('keeps one per period, and none in a period a snapshot closes', () => {
    const day = (d: number, h: number) => at(2026, 3, d, h)
    // Day 1: shared, then off (the day closes on the shared one). Day 2: off
    // twice. Day 3: off, then shared again. Day 4 on: shared until today.
    const times = [day(1, 10), day(3, 18), day(4, 9), end]
    const off = [day(1, 12), day(2, 9), day(2, 15), day(3, 8)]
    const h = gapped(times, [100, 130, 140, 150], [day(1, 11), day(3, 18), day(4, 9), end], off)
    const frame = chartFrame(h, -Infinity, 'day')
    expect(frame.indices).toEqual([0, 1, 2, 3])
    expect(frame.gaps).toEqual([day(2, 15)])
    expect(chartPoints(h, 'Mora', frame)).toEqual([
      { x: day(1, 10), y: 100 },
      { x: day(1, 11), y: 100 },
      { x: day(2, 15), y: null },
      { x: day(3, 18), y: 130 },
      { x: day(4, 9), y: 140 },
      { x: end, y: 150 },
    ])
    // Every capture is kept when the range plots every snapshot.
    expect(chartFrame(h, -Infinity, 'raw').gaps).toEqual(off)
    // The year range buckets by day: the same single break.
    expect(rangeFrame(h, '1y').gaps).toEqual([day(2, 15)])
  })

  it('lets a snapshot stamped the same instant stand', () => {
    const h = gapped([ago(50), ago(10)], [100, 120], [ago(50), end], [ago(10)])
    expect(chartPoints(h, 'Mora', rangeFrame(h, '1h'))).toEqual([
      { x: ago(50), y: 100 },
      { x: ago(10), y: 120 },
      { x: end, y: 120 },
    ])
  })

  it('leaves a history where every capture shared them as it was', () => {
    const h = history([ago(50), ago(10)], [100, 120], end)
    const frame = rangeFrame(h, '1h')
    expect(frame).not.toHaveProperty('gaps')
    expect(frame).not.toHaveProperty('opensUnshared')
    expect(chartPoints(h, 'Mora', frame)).toEqual([
      { x: ago(50), y: 100 },
      { x: ago(10), y: 120 },
      { x: end, y: 120 },
    ])
  })

  it("keeps the breaks under live sync's point", () => {
    const h = gapped([ago(50), ago(10)], [100, 120], [ago(45), ago(10)], [ago(30)])
    const live = withLiveMaterials(h, {
      open: true,
      base: { snapshotId: 2, takenAt: ago(10) },
      updatedAt: ago(2),
      changes: [['set', ['materials', 'Mora'], 125]],
    })
    expect(live.unshared).toEqual({ at: [ago(30)], seen: [ago(45), ago(10), ago(2)] })
    expect(chartPoints(live, 'Mora', rangeFrame(live, '1h'))).toEqual([
      { x: ago(50), y: 100 },
      { x: ago(45), y: 100 },
      { x: ago(30), y: null },
      { x: ago(10), y: 120 },
      { x: ago(2), y: 125 },
    ])
  })
})
