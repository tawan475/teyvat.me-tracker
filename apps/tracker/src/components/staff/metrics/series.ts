/**
 * Pure helpers for the staff Metrics page's charts (tested): thinning a
 * reading series so a line never has more points than pixels, summing day
 * bars into weeks so a year of them fits a phone, and what share and how
 * long until a database is full.
 */

import type { DayCount, SiteSample } from '@gdt/shared'

/** At most `max` values of a series, evenly spaced, always keeping the last. */
export function thin<T>(values: readonly T[], max: number): T[] {
  if (values.length <= max || max < 2) return [...values]
  const out: T[] = []
  const step = (values.length - 1) / (max - 1)
  for (let i = 0; i < max; i++) out.push(values[Math.round(i * step)]!)
  return out
}

/** One figure of the readings as a plain series, thinned. */
export function seriesOf(
  samples: readonly SiteSample[],
  key: keyof SiteSample,
  max = 120,
): number[] {
  return thin(
    samples.map((s) => Number(s[key]) || 0),
    max,
  )
}

/**
 * Days summed into runs of `size` days (the last run ends on the last day,
 * so a short first run takes what is left); each run keeps its first day.
 */
export function bucketDays(
  days: readonly DayCount[],
  size: number,
  series: readonly string[],
): DayCount[] {
  if (size <= 1) return [...days]
  const out: DayCount[] = []
  for (let end = days.length; end > 0; end -= size) {
    const run = days.slice(Math.max(0, end - size), end)
    const sum: DayCount = { day: run[0]!.day }
    for (const name of series) sum[name] = run.reduce((n, d) => n + (Number(d[name]) || 0), 0)
    out.unshift(sum)
  }
  return out
}

/** How many days one bar stands for, so the bars of a range still fit a phone. */
export function bucketSize(days: number): number {
  return days > 60 ? 7 : 1
}

/** A share as "5.8%" (one decimal under 10, none from there; "0%" for nothing). */
export function share(part: number, whole: number): string {
  if (!(whole > 0) || !(part > 0)) return '0%'
  const percent = (part / whole) * 100
  if (percent < 0.1) return '<0.1%'
  return `${percent < 10 ? Number(percent.toFixed(1)) : Math.round(percent)}%`
}

/** Days until `bytes` reaches `limit` at `perDay` (null: not growing, or unknown). */
export function daysUntilFull(bytes: number | null, limit: number, perDay: number): number | null {
  if (bytes === null || !(perDay > 0)) return null
  return Math.max(0, Math.floor((limit - bytes) / perDay))
}

/** A span of days in the unit it reads best in: days under 60, months under 2 years, else years. */
export function spanOf(days: number): { unit: 'days' | 'months' | 'years'; n: number } {
  if (days < 60) return { unit: 'days', n: days }
  if (days < 730) return { unit: 'months', n: Math.round(days / 30.44) }
  return { unit: 'years', n: Math.round(days / 365.25) }
}
