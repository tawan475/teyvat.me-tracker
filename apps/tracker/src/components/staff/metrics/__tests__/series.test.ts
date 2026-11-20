import type { DayCount, SiteSample } from '@gdt/shared'
import { describe, expect, it } from 'vitest'
import { bucketDays, bucketSize, daysUntilFull, seriesOf, share, spanOf, thin } from '../series'

const days = (count: number): DayCount[] =>
  Array.from({ length: count }, (_, i) => ({
    day: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
    password: 1,
    discord: i % 2,
  }))

describe('thin', () => {
  it('keeps a short series whole', () => {
    expect(thin([1, 2, 3], 5)).toEqual([1, 2, 3])
  })

  it('spaces a long one evenly and always keeps both ends', () => {
    const values = Array.from({ length: 720 }, (_, i) => i)
    const out = thin(values, 120)
    expect(out).toHaveLength(120)
    expect(out[0]).toBe(0)
    expect(out.at(-1)).toBe(719)
    expect([...out].sort((a, b) => a - b)).toEqual(out)
  })
})

describe('seriesOf', () => {
  it('reads one figure of the readings', () => {
    const samples = [
      { at: 1, online: 3 },
      { at: 2, online: 5 },
    ] as SiteSample[]
    expect(seriesOf(samples, 'online')).toEqual([3, 5])
    expect(seriesOf(samples, 'inGame')).toEqual([0, 0])
  })
})

describe('bucketDays', () => {
  it('draws a month day by day and anything past two months by the week', () => {
    expect(bucketSize(30)).toBe(1)
    expect(bucketSize(90)).toBe(7)
    expect(bucketSize(365)).toBe(7)
  })

  it('sums whole weeks ending on the last day, the first run taking what is left', () => {
    const out = bucketDays(days(30), 7, ['password', 'discord'])
    expect(out).toHaveLength(5)
    // 30 = 2 + 4 x 7: the short run is the oldest.
    expect(out.map((d) => d.password)).toEqual([2, 7, 7, 7, 7])
    expect(out[0]!.day).toBe('2026-01-01')
    expect(out[1]!.day).toBe('2026-01-03')
    // Nothing is lost or counted twice.
    const total = out.reduce((n, d) => n + Number(d.password) + Number(d.discord), 0)
    expect(total).toBe(30 + 15)
    expect(bucketDays(days(3), 1, ['password'])).toHaveLength(3)
  })

  it('fits a year on a phone: 53 bars', () => {
    expect(bucketDays(days(365), bucketSize(365), ['password'])).toHaveLength(53)
  })
})

describe('share', () => {
  it('writes small shares with a decimal and large ones whole', () => {
    expect(share(14, 243)).toBe('5.8%')
    expect(share(69, 243)).toBe('28%')
    expect(share(0, 243)).toBe('0%')
    expect(share(5, 0)).toBe('0%')
    expect(share(1, 100_000)).toBe('<0.1%')
    expect(share(100, 100)).toBe('100%')
  })
})

describe('daysUntilFull', () => {
  const GB = 1024 ** 3
  it('counts the days left at the present growth', () => {
    expect(daysUntilFull(2 * GB, 10 * GB, GB)).toBe(8)
    expect(daysUntilFull(10 * GB, 10 * GB, GB)).toBe(0)
    expect(daysUntilFull(11 * GB, 10 * GB, GB)).toBe(0)
  })

  it('has no answer without a size or without growth', () => {
    expect(daysUntilFull(null, 10 * GB, GB)).toBeNull()
    expect(daysUntilFull(GB, 10 * GB, 0)).toBeNull()
  })
})

describe('spanOf', () => {
  it('picks the unit a span reads best in', () => {
    expect(spanOf(12)).toEqual({ unit: 'days', n: 12 })
    expect(spanOf(59)).toEqual({ unit: 'days', n: 59 })
    expect(spanOf(90)).toEqual({ unit: 'months', n: 3 })
    expect(spanOf(700)).toEqual({ unit: 'months', n: 23 })
    expect(spanOf(2922)).toEqual({ unit: 'years', n: 8 })
  })
})
