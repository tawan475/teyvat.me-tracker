/**
 * The original tracker's material history (the old backend's
 * getMaterialsHistory + aggregateTimelineByGroup), computed in the browser:
 * one point per period holding the count of the last snapshot in it, carried
 * forward through empty periods up to now, then the newest `limit` points.
 * A key missing from a snapshot counts 0, as before; a count the period's
 * captures did not share (MaterialSeries.off) has no value there. Pure: it
 * imports the history module, not @/data/materials (which loads data), so
 * tests can run it.
 *
 * Periods are local time; the old backend bucketed in UTC.
 */

import type { TimelineGroupBy } from '@gdt/shared'
import {
  indexAtOrBefore,
  lastSharedIn,
  periodStart,
  valueAt,
  type MaterialsHistory,
} from '@/data/materials-history'
import { nextPeriod } from '@/data/progression'
import { materialName } from '@/utils/materials'

export interface HistoryPeriod {
  /** Start of the period (epoch ms, local time). */
  timestamp: number
  /** The snapshot whose counts the period shows (last one taken before it ends). */
  index: number
}

export interface HistorySeries {
  key: string
  name: string
  /** `count` null: no capture of the period shared the count (the line breaks, never 0). */
  points: { timestamp: number; count: number | null }[]
}

/** The periods a chart shows, shared by every series on it. */
export function historyPeriods(
  times: readonly number[],
  groupBy: TimelineGroupBy,
  limit: number,
  now = Date.now(),
): HistoryPeriod[] {
  const first = times[0]
  if (first === undefined) return []
  const starts: number[] = []
  for (let t = periodStart(first, groupBy); t <= now; t = nextPeriod(t, groupBy)) starts.push(t)
  return starts.slice(-limit).map((timestamp) => ({
    timestamp,
    index: indexAtOrBefore(times, nextPeriod(timestamp, groupBy) - 1),
  }))
}

export function historySeries(
  history: MaterialsHistory,
  keys: readonly string[],
  periods: readonly HistoryPeriod[],
): HistorySeries[] {
  return keys.map((key) => {
    const series = history.series.get(key)
    return {
      key,
      name: materialName(key),
      points: periods.map((p) => {
        // The period's own captures; the one carried in when it has none.
        const before = Math.min(indexAtOrBefore(history.times, p.timestamp - 1), p.index - 1)
        const shared = p.index < 0 || lastSharedIn(series, p.index, before) >= 0
        return { timestamp: p.timestamp, count: shared ? valueAt(series, p.index) : null }
      }),
    }
  })
}
