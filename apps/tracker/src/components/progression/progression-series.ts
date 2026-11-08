/**
 * The progression charts' figures (mora, primogems, artifact and item
 * counts, character EXP; the card shows the ones picked): a line through the
 * captures (stepped, or straight from each capture to the next), and the change under it either per period (hour / day / month /
 * year: each period's closing value against the period before) or per
 * snapshot (each capture that changed a figure against the capture before,
 * on the line's own time axis so every bar sits under its step). Pure: the
 * component calls it through computed().
 *
 * Short ranges stay detailed: the component fits the grouping to the range
 * (fitGroupBy: "Per day" over 6h shows hours), and the line keeps every
 * capture up to a week (pointBucket), never coarser than the bars (every
 * capture, per snapshot).
 *
 * Captures come from buildHistory, so a capture that missed the currency
 * packet already carries the previous mora and primogems. Leading captures
 * with nothing to carry (still 0 / 0) are left out rather than drawn as 0.
 */

import type { SnapshotSummary, TimelineGroupBy } from '@gdt/shared'
import {
  DAY,
  finerBucket,
  hourTick,
  pointBucket,
  rangeLength,
  rangeStart,
  type AxisFormat,
  type ChartRange,
  type PointBucket,
} from '@/data/chart-range'
import {
  indexAtOrBefore,
  periodStart,
  valueAt,
  type MaterialsHistory,
} from '@/data/materials-history'
import { currencyMissing, type Capture, type Point } from '@/data/overview'
import { nextPeriod } from '@/data/progression'
import { dateLocale } from '@/lib/format'

/**
 * A figure the progression card can chart: a snapshot summary count, or one
 * read from the materials (character EXP held in books, wishes held: see
 * withMaterialFigures).
 */
export type FigureKey =
  | 'mora'
  | 'primogem'
  | 'wishes'
  | 'characterExp'
  | 'artifacts'
  | 'artifact4'
  | 'artifact3'
  | 'characters'
  | 'weapons'
export const FIGURE_KEYS: readonly FigureKey[] = [
  'mora',
  'primogem',
  'wishes',
  'characterExp',
  'artifacts',
  'artifact4',
  'artifact3',
  'characters',
  'weapons',
]

/** Character EXP per book (the game's three character EXP materials). */
export const CHARACTER_EXP_BOOKS = {
  HerosWit: 20_000,
  AdventurersExperience: 5_000,
  WanderersAdvice: 1_000,
} as const

/** Figures read from the materials history rather than the snapshot summary. */
export const MATERIAL_FIGURES: readonly FigureKey[] = ['wishes', 'characterExp']

/** Primogems (or Genesis Crystals) a wish costs. */
export const WISH_PRICE = 160

/**
 * Wishes held: (Primogems + Genesis Crystals) ÷ 160, rounded down, plus
 * Intertwined Fates (a Discord user's ask, 2026-11-08; whole wishes, the
 * user's call).
 */
export function wishesHeld(primogem: number, genesis: number, fates: number): number {
  return Math.floor((primogem + genesis) / WISH_PRICE) + fates
}

/** What the series read from a capture: its summary, plus the materials' figures once known. */
export interface ProgressionCapture {
  at: number
  summary: SnapshotSummary & { characterExp?: number; wishes?: number }
}

/** A figure of a capture; the materials' figures are 0 until withMaterialFigures adds them. */
const figureOf = (capture: ProgressionCapture, key: FigureKey): number => capture.summary[key] ?? 0

/**
 * `captures` with the materials' figures at each one (character EXP held in
 * books, wishes held), from the materials history: a capture reads the
 * snapshot it shows (a re-sighting its own), a live sync point carries the
 * capture before it.
 */
export function withMaterialFigures(
  captures: readonly Capture[],
  materials: MaterialsHistory,
): ProgressionCapture[] {
  const indexById = new Map(materials.ids.map((id, i) => [id, i]))
  const books = Object.entries(CHARACTER_EXP_BOOKS).map(
    ([key, exp]) => [materials.series.get(key), exp] as const,
  )
  const [primogem, genesis, fates] = ['Primogem', 'GenesisCrystal', 'IntertwinedFate'].map((key) =>
    materials.series.get(key),
  )
  const figuresAt = (index: number) => ({
    characterExp: books.reduce((sum, [series, exp]) => sum + valueAt(series, index) * exp, 0),
    wishes: wishesHeld(valueAt(primogem, index), valueAt(genesis, index), valueAt(fates, index)),
  })
  let carried = { characterExp: 0, wishes: 0 }
  return captures.map((capture) => {
    if (capture.snapshot !== undefined) {
      carried = figuresAt(
        indexById.get(capture.snapshot) ?? indexAtOrBefore(materials.times, capture.at),
      )
    }
    return { at: capture.at, summary: { ...capture.summary, ...carried } }
  })
}

/**
 * How the line joins captures: `stepped` holds each value until the next
 * capture changes it; `straight` draws one straight line from each capture
 * to the next.
 */
export type LineShape = 'stepped' | 'straight'
export const LINE_SHAPES: readonly LineShape[] = ['stepped', 'straight']
/** The figures' old name (mora and primogems were the only ones). */
export type CurrencyKey = FigureKey
export const CURRENCY_KEYS = FIGURE_KEYS

/** The bar charts' grouping: every capture, or a period. */
export type ProgressionGroup = 'snapshot' | TimelineGroupBy

/**
 * The grouping until one is picked on this device: per snapshot up to a
 * week, where captures are few enough to read one by one; per day beyond.
 */
export function defaultGroup(range: ChartRange): ProgressionGroup {
  return rangeLength(range) <= 7 * DAY ? 'snapshot' : 'day'
}

/**
 * Most bars drawn at once, periods or snapshots (hourly over years would be
 * tens of thousands). Older ones are left out and the line starts with the
 * bars.
 */
export const MAX_PERIODS = 3000

/** Longest a period can be (DST adds an hour), to bound the walk back from the newest. */
const LONGEST: Record<TimelineGroupBy, number> = {
  hour: 3_600_000,
  day: DAY + 3_600_000,
  month: 31 * DAY + 3_600_000,
  year: 366 * DAY + 3_600_000,
}

type Figures = Record<FigureKey, number>

/** A record with one entry per figure. */
function perFigure<T>(make: (key: FigureKey) => T): Record<FigureKey, T> {
  return Object.fromEntries(FIGURE_KEYS.map((key) => [key, make(key)])) as Record<FigureKey, T>
}

export interface Period {
  /** Local start of the period (epoch ms). */
  start: number
  /** Captures inside the period. */
  captures: number
  /** At the period's last capture; carried from before when it has none. */
  close: Figures
  /** Against the previous period's close (the first period: against `open`). */
  change: Figures
}

export interface Progression {
  /** Oldest first, every period from the start of the range to the newest capture. */
  periods: Period[]
  /**
   * Stepped line per figure from the value held at the range start: every
   * capture, or the closing capture per `lineBucket`.
   */
  lines: Record<FigureKey, Point[]>
  lineBucket: PointBucket | TimelineGroupBy
  /** What the first period is measured against. */
  open: Figures
  /** Older periods were dropped to stay within MAX_PERIODS. */
  truncated: boolean
}

function figures(capture: ProgressionCapture): Figures {
  return perFigure((key) => figureOf(capture, key))
}

/** First index whose `at` is >= `from`. */
function lowerBound(captures: readonly ProgressionCapture[], from: number): number {
  let lo = 0
  let hi = captures.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (captures[mid]!.at < from) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Drops repeats of a value (the step line draws them anyway), keeping the
 * final point so the line reaches the newest capture. A straight line also
 * keeps the last point of each run, where its slope to the next value starts.
 */
function dedupe(points: Point[], shape: LineShape): Point[] {
  const out: Point[] = []
  const last = points.length - 1
  points.forEach((point, i) => {
    if (
      i === 0 ||
      i === last ||
      point.y !== points[i - 1]!.y ||
      (shape === 'straight' && point.y !== points[i + 1]!.y)
    ) {
      out.push(point)
    }
  })
  return out
}

/**
 * Line points from the value held at `x0` through the captures from `index`
 * on: every capture, or the last one per period of `by`, then held flat to
 * `end` (now): the newest value is still the value until a capture says not.
 */
function linePoints(
  captures: readonly ProgressionCapture[],
  index: number,
  x0: number,
  open: Figures,
  by: PointBucket | TimelineGroupBy,
  end: number,
  shape: LineShape,
): Record<FigureKey, Point[]> {
  const lines = perFigure<Point[]>((key) => [{ x: x0, y: open[key] }])
  let period = Number.NaN
  for (let i = index; i < captures.length; i++) {
    const capture = captures[i]!
    const p = by === 'raw' ? Number.NaN : periodStart(capture.at, by)
    for (const key of CURRENCY_KEYS) {
      const point = { x: capture.at, y: figureOf(capture, key) }
      // Same period as the capture before: the later one closes it.
      if (p === period) lines[key][lines[key].length - 1] = point
      else lines[key].push(point)
    }
    period = p
  }
  for (const key of CURRENCY_KEYS) {
    const line = lines[key]
    const held = line[line.length - 1]!
    if (end > held.x) line.push({ x: end, y: held.y })
  }
  return perFigure((key) => dedupe(lines[key], shape))
}

/** The chart's right edge: now, or the newest capture if the clock is behind it. */
const chartEnd = (now: number, last: ProgressionCapture) => Math.max(now, last.at)

/**
 * `captures` as buildHistory returns them (oldest first). Ranges end at
 * `now` (the right edge is always now; the line is held flat from the
 * newest capture to it) and snap to whole periods of `groupBy`.
 */
export function buildProgression(
  allCaptures: readonly ProgressionCapture[],
  groupBy: TimelineGroupBy,
  range: ChartRange,
  now: number = Date.now(),
  shape: LineShape = 'stepped',
): Progression | null {
  const captures = allCaptures.filter((c) => !currencyMissing(c.summary))
  const first = captures[0]
  const last = captures[captures.length - 1]
  if (!first || !last) return null

  const end = chartEnd(now, last)
  const wanted = Math.max(first.at, rangeStart(range, end))
  const bounded = Math.max(wanted, end - MAX_PERIODS * LONGEST[groupBy])
  const lastStart = periodStart(end, groupBy)
  let starts: number[] = []
  for (let t = periodStart(bounded, groupBy); t <= lastStart; t = nextPeriod(t, groupBy)) {
    starts.push(t)
  }
  if (starts.length > MAX_PERIODS) starts = starts.slice(-MAX_PERIODS)
  const from = starts[0]!
  const truncated = from > periodStart(wanted, groupBy)

  // The last capture before the range closes the period before it.
  let j = lowerBound(captures, from)
  const baseline = j > 0 ? captures[j - 1]! : null
  const open = figures(baseline ?? first)
  const x0 = baseline ? from : first.at
  const lineBucket = finerBucket(pointBucket(end - x0), groupBy)
  const lines = linePoints(captures, j, x0, open, lineBucket, end, shape)

  const periods: Period[] = []
  let previous = open
  starts.forEach((start, i) => {
    const end = starts[i + 1] ?? nextPeriod(start, groupBy)
    let closing: ProgressionCapture | null = null
    let count = 0
    while (j < captures.length && captures[j]!.at < end) {
      closing = captures[j]!
      count++
      j++
    }
    const close = closing ? figures(closing) : previous
    periods.push({
      start,
      captures: count,
      close,
      change: perFigure((key) => close[key] - previous[key]),
    })
    previous = close
  })

  return { periods, lines, lineBucket, open, truncated }
}

// --------------------------------------------------------------- per snapshot

export interface CaptureChange {
  /** The capture (epoch ms): the bar's place on the time axis. */
  at: number
  /** Against the capture before; the first in a range against the value carried in. */
  change: number
  /** After the capture. */
  value: number
}

/**
 * The change each capture from `index` on made to one figure, against the
 * capture before (the first against `open`, the value carried into the
 * range). Captures that left it as it was, re-sightings or ones where only
 * the other figure moved, get no entry: they draw no step either.
 */
export function captureChanges(
  captures: readonly ProgressionCapture[],
  index: number,
  open: number,
  key: FigureKey,
): CaptureChange[] {
  const changes: CaptureChange[] = []
  let previous = open
  for (let i = index; i < captures.length; i++) {
    const capture = captures[i]!
    const value = figureOf(capture, key)
    if (value !== previous) changes.push({ at: capture.at, change: value - previous, value })
    previous = value
  }
  return changes
}

export interface SnapshotProgression {
  /** Per figure, oldest first: one bar per capture that changed it. */
  changes: Record<FigureKey, CaptureChange[]>
  /** Every capture as a line from the value held at `domain[0]`. */
  lines: Record<FigureKey, Point[]>
  /** The time axis the line and the bars share: the line's start to now. */
  domain: [number, number]
  /** What the first change is measured against. */
  open: Figures
  /** Older captures were dropped to stay within MAX_PERIODS bars. */
  truncated: boolean
}

/**
 * Per-snapshot changes over `range`, not snapped to periods ("1h" is the
 * hour up to now), and the line they sit under, held flat to now. As in
 * buildProgression, the value held when the range opens is carried in at
 * its start. When more than MAX_PERIODS captures in the range changed mora
 * or primogems, the newest that many are kept and the range starts at the
 * capture before them, as "Per hour" over years keeps the newest hours.
 */
export function buildSnapshotProgression(
  allCaptures: readonly ProgressionCapture[],
  range: ChartRange,
  now: number = Date.now(),
  shape: LineShape = 'stepped',
): SnapshotProgression | null {
  const captures = allCaptures.filter((c) => !currencyMissing(c.summary))
  const first = captures[0]
  const last = captures[captures.length - 1]
  if (!first || !last) return null

  const end = chartEnd(now, last)
  const from = Math.max(first.at, rangeStart(range, end))
  let index = lowerBound(captures, from)
  let baseline = index > 0 ? captures[index - 1]! : null
  let x0 = baseline ? from : first.at

  // Captures in the range that changed any figure, for the cap.
  const changed: number[] = []
  let previous = figures(baseline ?? first)
  for (let i = index; i < captures.length; i++) {
    const current = figures(captures[i]!)
    if (FIGURE_KEYS.some((key) => current[key] !== previous[key])) changed.push(i)
    previous = current
  }
  const truncated = changed.length > MAX_PERIODS
  if (truncated) {
    index = changed[changed.length - MAX_PERIODS]!
    baseline = captures[index - 1]!
    x0 = baseline.at
  }

  const open = figures(baseline ?? first)
  return {
    changes: perFigure((key) => captureChanges(captures, index, open[key], key)),
    lines: linePoints(captures, index, x0, open, 'raw', end, shape),
    domain: [x0, end],
    open,
    truncated,
  }
}

/** Narrowest and widest a snapshot's bar is drawn (px). */
export const SNAPSHOT_BAR_WIDTH = { min: 2, max: 12 } as const

/**
 * Bar width for `count` snapshots across a plot `plotWidth` px wide: wide
 * for a handful, thinning as they crowd, never under 2px.
 */
export function snapshotBarWidth(count: number, plotWidth: number): number {
  const { min, max } = SNAPSHOT_BAR_WIDTH
  if (!(count > 0) || !(plotWidth > 0)) return max
  return Math.max(min, Math.min(max, Math.floor((plotWidth / count) * 0.6)))
}

// --------------------------------------------------------------------- totals

export interface PeriodTotals {
  /** Newest value. */
  last: number
  /** Newest value minus `open`: the sum of every bar's change. */
  net: number
  gained: number
  spent: number
}

export function periodTotals(progression: Progression, key: FigureKey): PeriodTotals {
  let gained = 0
  let spent = 0
  for (const period of progression.periods) {
    const change = period.change[key]
    if (change > 0) gained += change
    else spent -= change
  }
  const last = progression.periods[progression.periods.length - 1]?.close[key] ?? 0
  return { last, net: last - progression.open[key], gained, spent }
}

export function snapshotTotals(progression: SnapshotProgression, key: FigureKey): PeriodTotals {
  let gained = 0
  let spent = 0
  for (const { change } of progression.changes[key]) {
    if (change > 0) gained += change
    else spent -= change
  }
  const open = progression.open[key]
  const last = progression.changes[key].at(-1)?.value ?? open
  return { last, net: last - open, gained, spent }
}

interface PeriodFormats {
  dayTick: Intl.DateTimeFormat
  monthTick: Intl.DateTimeFormat
  hour: Intl.DateTimeFormat
  date: Intl.DateTimeFormat
  dayTitle: Intl.DateTimeFormat
  monthTitle: Intl.DateTimeFormat
}

const formatCache = new Map<string, PeriodFormats>()

/** Formatters per clock preference, built once (ticks are formatted thousands at a time). */
function formats(hour12: boolean): PeriodFormats {
  const key = `${dateLocale() ?? ''}|${hour12}`
  let f = formatCache.get(key)
  if (!f) {
    const make = (options: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(dateLocale(), options)
    f = {
      dayTick: make({ month: 'short', day: 'numeric' }),
      monthTick: make({ month: 'short', year: 'numeric' }),
      hour: make({ hour: 'numeric', minute: '2-digit', hour12 }),
      date: make({ month: 'short', day: 'numeric', year: 'numeric' }),
      dayTitle: make({ weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }),
      monthTitle: make({ month: 'long', year: 'numeric' }),
    }
    formatCache.set(key, f)
  }
  return f
}

/**
 * Short axis label for a period start: "Jul 6, 3 PM" ("3:00 PM" when the
 * bars span a day, see axisFormat), "Jul 6", "Jul 2026", "2026".
 */
export function periodTick(
  start: number,
  groupBy: TimelineGroupBy,
  hour12: boolean,
  axis: AxisFormat = 'date',
): string {
  const f = formats(hour12)
  if (groupBy === 'year') return String(new Date(start).getFullYear())
  if (groupBy === 'month') return f.monthTick.format(start)
  if (groupBy === 'hour') return hourTick(start, axis, hour12)
  return f.dayTick.format(start)
}

/** Tooltip title for a period: "Jul 6, 2026, 3:00 PM – 4:00 PM", "Mon, Jul 6, 2026", "July 2026". */
export function periodTitle(start: number, groupBy: TimelineGroupBy, hour12: boolean): string {
  const f = formats(hour12)
  if (groupBy === 'year') return String(new Date(start).getFullYear())
  if (groupBy === 'month') return f.monthTitle.format(start)
  if (groupBy === 'day') return f.dayTitle.format(start)
  const end = nextPeriod(start, 'hour')
  return `${f.date.format(start)}, ${f.hour.format(start)} – ${f.hour.format(end)}`
}
