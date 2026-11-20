/**
 * Changes and flows over a material's history (see @/data/materials-history
 * for the change-point series these walk). Pure functions; they import that
 * module rather than @/data/materials (which loads data) so tests can run them.
 *
 * Some captures miss part of the inventory (a key absent from a snapshot
 * counts 0), so a series can drop to 0 for one snapshot and come straight
 * back to the same count. Counting that as spending everything and getting
 * it back would swamp every figure (Mora: 70M "spent" in one hop), so these
 * functions read such a dip as the count it interrupts.
 *
 * A capture whose own switches covered a count (MaterialSeries.off: Original
 * Resin, Realm Currency) is no change point at all: every figure here
 * compares the captures that shared the count, the last one before such a
 * capture against the next one after it.
 */

import type { SelectGroup, SelectOption } from '@/components/ui/UiSelect.vue'
import {
  CHART_RANGE_GROUPS,
  isChartRange,
  pointBucket,
  rangeLabel,
  rangeStart,
  type ChartRange,
} from '@/data/chart-range'
import {
  chartFrame,
  firstShared,
  framePoints,
  indexAtOrBefore,
  type ChartFrame,
  type MaterialPoint,
  type MaterialSeries,
  type MaterialsHistory,
} from '@/data/materials-history'
import { t } from '@/i18n'

/** What a change is measured against: the previous snapshot, or one ~7 / 30 days older. */
export type ChangePeriod = 'last' | ChartRange

/** The detail dialog's three change figures (labels in the language on screen). */
export function periodOptions(): { value: ChangePeriod; label: string }[] {
  return [
    { value: 'last', label: t('materials.periods.last') },
    { value: '7d', label: rangeLabel('7d') },
    { value: '30d', label: rangeLabel('30d') },
  ]
}

/** The page's "Change since" select: the previous capture, then the charts' ranges. */
export function changeSinceOptions(): (SelectOption<ChangePeriod> | SelectGroup<ChangePeriod>)[] {
  return [
    { value: 'last', label: t('materials.periods.last') },
    ...CHART_RANGE_GROUPS.flatMap(
      (group): (SelectOption<ChangePeriod> | SelectGroup<ChangePeriod>)[] => {
        const options = group.ranges.map((value) => ({ value, label: rangeLabel(value) }))
        return group.label ? [{ group: group.label, options }] : options
      },
    ),
  ]
}

export function isChangePeriod(value: unknown): value is ChangePeriod {
  return value === 'last' || isChartRange(value)
}

// ------------------------------------------------------------------ values

/** Change point `i` is a one-snapshot drop to 0 that the next change point undoes. */
function isGap(series: MaterialSeries, i: number): boolean {
  const v = series.value
  return i > 0 && v[i] === 0 && v[i - 1]! > 0 && v[i + 1] === v[i - 1]
}

/** Index of the last change point at or before snapshot `index`, or -1. */
function pointAt(series: MaterialSeries, index: number): number {
  let lo = 0
  let hi = series.at.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (series.at[mid]! <= index) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

/**
 * The count at snapshot `index`, reading a capture gap as the count around
 * it. Over a capture that did not share the count it is the last shared one
 * (the first shared one's before any was), as valueAt in @/data/materials.
 */
export function countAt(series: MaterialSeries | undefined, index: number): number {
  if (!series || index < 0) return 0
  const i = pointAt(series, series.off ? Math.max(index, firstShared(series)) : index)
  if (i === -1) return 0
  return isGap(series, i) ? series.value[i - 1]! : series.value[i]!
}

/**
 * Chart points for one key over `frame` (as seriesPoints in @/data/materials,
 * capture gaps bridged). A capture that did not share the materials, or this
 * count, is a point without a value: the line breaks there (see framePoints).
 */
export function chartPoints(
  history: MaterialsHistory,
  key: string,
  frame: ChartFrame,
): MaterialPoint[] {
  const series = history.series.get(key)
  return framePoints(history, frame, (index) => countAt(series, index), series)
}

/** Count change of `key` over the frame (newest minus its baseline snapshot). */
export function frameChange(history: MaterialsHistory, key: string, frame: ChartFrame): number {
  const series = history.series.get(key)
  return countAt(series, history.times.length - 1) - countAt(series, frame.baseline)
}

// ------------------------------------------------------------------ tracked

/** One tracked chart as the Tracked panel shows it. */
export interface TrackedTile {
  key: string
  /** The chart's colour (--chart-1…6): the key's place among the saved pins. */
  color: 1 | 2 | 3 | 4 | 5 | 6
  /**
   * The newest count. Null while the count is not shared now (the newest
   * capture's switches cover it, `history.hidden`): the tile says so where
   * the count stands, never 0, and opens no detail.
   */
  count: number | null
  /**
   * Change over the frame, between the captures that shared the count
   * (frameChange). Null while the count is not shared now: the tile shows no
   * figure there, since "Not shared 0" would read as a count of 0.
   */
  change: number | null
  /** The chart's line, broken where a capture did not share the count (chartPoints). */
  points: MaterialPoint[]
}

/**
 * The Tracked panel's tiles: one per saved pin, in the saved order. A pin on
 * a count that is not shared now keeps its tile, its place and its colour
 * (issue 12): slots, the counter and the colours go by the saved pins alone,
 * so nothing shifts while a part is off and the tile's own remove still
 * unpins it.
 */
export function trackedTiles(
  history: MaterialsHistory,
  keys: readonly string[],
  frame: ChartFrame,
): TrackedTile[] {
  return keys.map((key, index) => {
    const hidden = history.hidden?.includes(key) ?? false
    return {
      key,
      color: ((index % 6) + 1) as TrackedTile['color'],
      count: hidden ? null : (history.latest.get(key) ?? 0),
      change: hidden ? null : frameChange(history, key, frame),
      points: chartPoints(history, key, frame),
    }
  })
}

// ------------------------------------------------------------------ periods

export interface Reference {
  /** Snapshot index changes are measured from. */
  index: number
  takenAt: number
}

/**
 * The snapshot a period compares the newest one with: the previous one, or
 * the last taken at or before the range's start, counted back from the
 * newest snapshot (not from now, like the charts); a history shorter than
 * the period falls back to its first snapshot. Null with fewer than two.
 */
export function referenceFor(history: MaterialsHistory, period: ChangePeriod): Reference | null {
  const { times } = history
  const n = times.length
  if (n < 2) return null
  let index = n - 2
  if (period !== 'last') {
    const start = rangeStart(period, times[n - 1]!)
    index = Math.min(n - 2, Math.max(0, indexAtOrBefore(times, start)))
  }
  return { index, takenAt: times[index]! }
}

/** Count change of every key from `reference` to the newest snapshot. */
export function changesSince(
  history: MaterialsHistory,
  reference: Reference | null,
): Map<string, number> {
  const changes = new Map<string, number>()
  if (!reference) return changes
  const last = history.times.length - 1
  for (const [key, series] of history.series) {
    const change = countAt(series, last) - countAt(series, reference.index)
    if (change !== 0) changes.set(key, change)
  }
  return changes
}

export interface Flow {
  /** Sum of the rises between consecutive snapshots. */
  gained: number
  /** Sum of the falls, as a positive number. */
  spent: number
  /** Highest count held in the range. */
  peak: number
}

/** Rises and falls of one key between snapshot `from` and `to` (inclusive). */
export function flowBetween(series: MaterialSeries | undefined, from: number, to: number): Flow {
  let previous = countAt(series, from)
  const flow: Flow = { gained: 0, spent: 0, peak: previous }
  if (!series) return flow
  for (let i = 0; i < series.at.length; i++) {
    const at = series.at[i]!
    if (at <= from) continue
    if (at > to) break
    if (isGap(series, i)) continue
    const value = series.value[i]!
    if (value > previous) flow.gained += value - previous
    else flow.spent += previous - value
    if (value > flow.peak) flow.peak = value
    previous = value
  }
  return flow
}

/** When the key first had a count above zero (epoch ms), or null. */
export function firstSeen(history: MaterialsHistory, key: string): number | null {
  const series = history.series.get(key)
  if (!series) return null
  const i = series.value.findIndex((v) => v > 0)
  return i === -1 ? null : (history.times[series.at[i]!] ?? null)
}

/**
 * The snapshots a chart over `range` plots, ending at the newest capture
 * (its last sighting), not now. The count held at the range start is carried
 * in, so a short range with nothing new draws the last known count as a flat
 * line. Up to a week every snapshot is kept; longer spans keep the last per
 * hour, then per day, so a year stays light (see pointBucket).
 */
export function rangeFrame(history: MaterialsHistory, range: ChartRange): ChartFrame {
  const end = Math.max(history.lastSeenAt, history.times.at(-1) ?? 0)
  const from = rangeStart(range, end)
  const first = history.times[0] ?? end
  return chartFrame(history, from, pointBucket(end - Math.max(first, from)))
}

/** Where the frame's line starts: the range start, or the first snapshot when history is shorter. */
export function frameStart(history: MaterialsHistory, frame: ChartFrame): number {
  return frame.carryIn >= 0 ? frame.from : (history.times[frame.baseline] ?? 0)
}
