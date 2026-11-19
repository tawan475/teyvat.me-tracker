/**
 * Figures for the accounts home and the account overview, derived from the
 * snapshot summaries alone (nothing is decoded). Pure functions: views call
 * them through computed() so each runs once per data version, not per render.
 */

import type { AccountResponse, GenshinServer, SnapshotResponse, SnapshotSummary } from '@gdt/shared'
import {
  OFF_SECTIONS,
  SECTION_FIGURES,
  sharedSummaryOf,
  sharesSection,
  type OffSection,
} from '@gdt/shared/off'
import { t } from '@/i18n'
import { dateLocale, formatNumber } from '@/lib/format'
import { rangeStart, type ChartRange } from './chart-range'

// ------------------------------------------------------------------ accounts

/** A server's name in the language on screen ("America", "TW, HK, MO"). */
export function serverLabel(server: GenshinServer | null): string | null {
  return server ? t(`overview.server.${server}`) : null
}

/** "692×": how many times smaller the stored copy is than what was uploaded. */
export function compressionRatio(rawBytes: number, storedBytes: number): string | null {
  if (rawBytes <= 0 || storedBytes <= 0) return null
  const ratio = rawBytes / storedBytes
  if (ratio >= 10) return `${formatNumber(Math.round(ratio))}×`
  return `${ratio.toFixed(1)}×`
}

export interface AccountTotals {
  accounts: number
  snapshots: number
  rawBytes: number
  storedBytes: number
  /** When the newest snapshot across all accounts was taken. */
  lastCapture: number | null
}

export function accountTotals(accounts: readonly AccountResponse[]): AccountTotals {
  let snapshots = 0
  let rawBytes = 0
  let storedBytes = 0
  let lastCapture: number | null = null
  for (const account of accounts) {
    snapshots += account.snapshotCount
    rawBytes += account.rawBytes
    storedBytes += account.storedBytes
    const taken = account.latest?.takenAt ?? null
    if (taken !== null && (lastCapture === null || taken > lastCapture)) lastCapture = taken
  }
  return { accounts: accounts.length, snapshots, rawBytes, storedBytes, lastCapture }
}

// -------------------------------------------------------------------- deltas

export type SummaryKey = keyof SnapshotSummary
/** Null where the change cannot be told (see currencyMissing). */
export type SummaryDelta = Record<SummaryKey, number | null>

const SUMMARY_KEYS: SummaryKey[] = [
  'characters',
  'weapons',
  'artifacts',
  'materials',
  'mora',
  'primogem',
  'artifact3',
  'artifact4',
]

const CURRENCY_KEYS: ReadonlySet<SummaryKey> = new Set(['mora', 'primogem'])

/** The summary figures each section Capture can leave out is counted from. */
export { SECTION_FIGURES }

/**
 * Irminsul sometimes misses the packet that carries mora and primogems: the
 * snapshot then reads 0 for both while the rest of the inventory is there.
 * A real account essentially never has exactly 0 of both.
 */
export function currencyMissing(summary: SnapshotSummary): boolean {
  return summary.mora === 0 && summary.primogem === 0
}

export function summaryDelta(current: SnapshotSummary, previous: SnapshotSummary): SummaryDelta {
  const unknown = currencyMissing(current) || currencyMissing(previous)
  const delta = {} as SummaryDelta
  for (const key of SUMMARY_KEYS) {
    delta[key] = unknown && CURRENCY_KEYS.has(key) ? null : current[key] - previous[key]
  }
  return delta
}

/** The section each summary figure is counted from (SECTION_FIGURES, the other way). */
export const FIGURE_SECTION = Object.fromEntries(
  OFF_SECTIONS.flatMap((section) => SECTION_FIGURES[section].map((key) => [key, section])),
) as Readonly<Record<SummaryKey, OffSection>>

/** Whether a snapshot with this `off` shared the section a summary figure is counted from. */
export const sharesFigure = (off: readonly string[] | undefined, key: SummaryKey): boolean =>
  sharesSection(off, FIGURE_SECTION[key])

/**
 * Change of snapshot `index` (`snapshots` newest first) against the one
 * before it, figure by figure. A figure whose section the snapshot left out
 * on purpose (Capture's gi_off, issue 12) has no change (null: it says
 * nothing about it, so never "-85 characters"); one it shared is measured
 * against the newest older snapshot that shared it too (never "+85" after a
 * not-shared stretch), null when none did. Mora and primogems are null when
 * either side misses them (currencyMissing). Null: no snapshot before it.
 */
export function sharedDelta(
  snapshots: readonly SnapshotResponse[],
  index: number,
): SummaryDelta | null {
  const current = snapshots[index]
  if (!current || index + 1 >= snapshots.length) return null
  const delta = {} as SummaryDelta
  for (const key of SUMMARY_KEYS) {
    delta[key] = null
    if (!sharesFigure(current.off, key)) continue
    const since = snapshots.slice(index + 1).find((s) => sharesFigure(s.off, key))
    if (!since) continue
    const unknown = currencyMissing(current.summary) || currencyMissing(since.summary)
    if (unknown && CURRENCY_KEYS.has(key)) continue
    delta[key] = current.summary[key] - since.summary[key]
  }
  return delta
}

/**
 * Change of the newest snapshot against the one before it. `snapshots` is
 * newest first (as loadSnapshots returns it); null when there is no pair.
 */
export function latestDelta(snapshots: readonly SnapshotResponse[]): SummaryDelta | null {
  return sharedDelta(snapshots, 0)
}

/**
 * Snapshot `index`'s figures (`snapshots` newest first), those of a section
 * it left out on purpose (Capture's gi_off, issue 12) from the newest older
 * snapshot that shared it, as the pages show "now"; 0 when none did.
 */
export function sharedSummary(
  snapshots: readonly SnapshotResponse[],
  index: number,
): SnapshotSummary {
  return sharedSummaryOf(snapshots, index)
}

/** `figures` with those of the sections `off` names taken from `from` (live figures over a base that left them out). */
export function withSharedFigures(
  figures: SnapshotSummary,
  off: readonly string[] | undefined,
  from: SnapshotSummary,
): SnapshotSummary {
  let out = figures
  for (const section of OFF_SECTIONS) {
    if (sharesSection(off, section)) continue
    out = { ...out }
    for (const field of SECTION_FIGURES[section]) out[field] = from[field]
  }
  return out
}

// ------------------------------------------------------------------- history

/**
 * One observation of the inventory: a snapshot being taken, or Irminsul
 * seeing the same inventory again later (`lastSeenAt`), which proves the
 * values still held at that time.
 */
export interface Capture {
  at: number
  /**
   * As captured, except missing currency carried over from the capture
   * before, and the figures of a section it did not share (`unshared`),
   * which are the last shared ones (0 before any): never this capture's.
   */
  summary: SnapshotSummary
  /** The snapshot shown (a re-sighting shows its own); none for a live sync point. */
  snapshot?: number
  /**
   * When the server stored the snapshot shown (its `createdAt`, the
   * server's clock, like a live sync point's time; `at` is the capture's own).
   */
  storedAt?: number
  /**
   * The build sections this capture did not share (Capture's gi_off, issue
   * 12; a live sync point: its journal's base snapshot's). The charts break
   * their line there and count no change. Absent when it shared them all.
   */
  unshared?: readonly OffSection[]
}

/** Whether a capture's summary figure is its own (its section was shared). */
export const figureShared = (capture: Pick<Capture, 'unshared'>, key: SummaryKey): boolean =>
  !capture.unshared?.includes(FIGURE_SECTION[key])

/**
 * A capture that should have had mora and primogems but read neither (see
 * currencyMissing). One that left the materials out on purpose is not that.
 */
export const currencyLost = (capture: Pick<Capture, 'summary' | 'unshared'>): boolean =>
  currencyMissing(capture.summary) && !capture.unshared?.includes('materials')

export interface History {
  /** Oldest first. */
  captures: Capture[]
  /** The last capture of each local calendar day, oldest first. */
  days: DayClose[]
}

export interface DayClose {
  /** Local date, YYYY-MM-DD. */
  key: string
  at: number
  summary: SnapshotSummary
  /** Captures that day (snapshots taken plus sightings of an unchanged inventory). */
  captures: number
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/** Local calendar day of a timestamp, as YYYY-MM-DD. */
export function dayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Everything the overview charts and the monthly table need, computed once. */
export function buildHistory(snapshots: readonly SnapshotResponse[]): History {
  const offById = new Map(snapshots.map((s) => [s.id, s.off]))
  const captures: Capture[] = []
  for (const s of snapshots) {
    captures.push({ at: s.takenAt, summary: s.summary, snapshot: s.id, storedAt: s.createdAt })
    if (s.lastSeenAt > s.takenAt) {
      captures.push({
        at: s.lastSeenAt,
        summary: s.summary,
        snapshot: s.id,
        storedAt: s.createdAt,
      })
    }
  }
  captures.sort((a, b) => a.at - b.at)

  // A capture without currency keeps the previous known mora and primogems,
  // so charts and daily changes don't plunge to 0 and back. A section
  // Capture left out on purpose (its gi_off, issue 12) does the same with its
  // figures, so no change is counted on those captures, and the capture is
  // marked (`unshared`): the charts break their line there.
  let known: SnapshotSummary | null = null
  const shared = new Map<OffSection, SnapshotSummary>()
  for (const capture of captures) {
    const off = offById.get(capture.snapshot ?? -1)
    const unshared: OffSection[] = []
    for (const section of OFF_SECTIONS) {
      if (sharesSection(off, section)) {
        shared.set(section, capture.summary)
        continue
      }
      unshared.push(section)
      const last = shared.get(section)
      const next = { ...capture.summary }
      for (const field of SECTION_FIGURES[section]) next[field] = last?.[field] ?? 0
      capture.summary = next
    }
    if (unshared.length > 0) capture.unshared = unshared
    if (!currencyMissing(capture.summary)) known = capture.summary
    else if (known) {
      capture.summary = { ...capture.summary, mora: known.mora, primogem: known.primogem }
    }
  }

  const days: DayClose[] = []
  for (const capture of captures) {
    const key = dayKey(capture.at)
    const last = days[days.length - 1]
    if (last && last.key === key) {
      last.at = capture.at
      last.summary = capture.summary
      last.captures++
    } else {
      days.push({ key, at: capture.at, summary: capture.summary, captures: 1 })
    }
  }
  return { captures, days }
}

/** A live sync chart point this close to a capture is left out: the capture wins. */
export const POINT_NEAR_CAPTURE_MS = 60_000

/**
 * Captures with live sync's chart points (real samples between snapshots,
 * no interpolation) merged in, oldest first. A point within a minute of a
 * capture is dropped; points without currency are left out.
 *
 * A point's figures are Capture's journal sums, counted from the export it
 * uploads: a section its switches leave out (gi_off, issue 12) counts 0
 * there. The journal's base is the newest snapshot at the point's time, so a
 * point after a capture that did not share a section is not-shared for it
 * too: marked like that capture, with its last shared figures, never 0.
 * "At the point's time" is by the server's clock, which stamps the points
 * and `storedAt`: a capture's own time may run ahead of it, and a point
 * right after a switch was flipped must not fall to the snapshot before.
 */
export function withPoints(
  captures: readonly Capture[],
  points: readonly { at: number; figures: SnapshotSummary }[],
): Capture[] {
  if (points.length === 0) return [...captures]
  const near = (at: number) => {
    const i = lowerBound(captures, at - POINT_NEAR_CAPTURE_MS)
    const capture = captures[i]
    return capture !== undefined && capture.at <= at + POINT_NEAR_CAPTURE_MS
  }
  // The capture each point's journal follows: of those stored by then, the
  // newest (a file imported later with an older capture time is not it).
  const byStored = captures
    .filter((capture) => capture.snapshot !== undefined)
    .sort((a, b) => (a.storedAt ?? a.at) - (b.storedAt ?? b.at))
  const ordered = [...points].sort((a, b) => a.at - b.at)
  let stored = 0
  let base: Capture | undefined
  const extra: Capture[] = []
  for (const point of ordered) {
    for (; stored < byStored.length; stored++) {
      const capture = byStored[stored]!
      if ((capture.storedAt ?? capture.at) > point.at) break
      if (!base || capture.at >= base.at) base = capture
    }
    if (near(point.at)) continue
    const unshared = base?.unshared
    if (!base || !unshared?.length) {
      if (!currencyMissing(point.figures)) extra.push({ at: point.at, summary: point.figures })
      continue
    }
    const summary = { ...point.figures }
    for (const section of unshared) {
      for (const field of SECTION_FIGURES[section]) summary[field] = base.summary[field]
    }
    const capture: Capture = { at: point.at, summary, unshared }
    if (!currencyLost({ summary: point.figures, unshared })) extra.push(capture)
  }
  return [...captures, ...extra].sort((a, b) => a.at - b.at)
}

/** First index whose `at` is >= `from` (captures are sorted by `at`). */
function lowerBound(captures: readonly Capture[], from: number): number {
  let lo = 0
  let hi = captures.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (captures[mid]!.at < from) lo = mid + 1
    else hi = mid
  }
  return lo
}

export interface HistoryWindow {
  /**
   * Oldest first: the value held when the window opens (a capture from
   * before it, moved to `from`), then every capture inside it.
   */
  captures: Capture[]
  /** Captures inside the window; the carried-in value is not one. */
  count: number
  /** Where the window starts: the range start, or the first capture when history is shorter. */
  from: number
  /** The newest capture. */
  to: number
}

/**
 * The captures a range shows. Ranges end at the newest capture rather than
 * now (see chart-range.ts), so an account that has not been captured for a
 * while still shows its last stretch of history, and the value held at the
 * range start is carried in: an hour with one capture still draws a line,
 * and the change in range is measured from what was held when it opened.
 */
export function historyWindow(captures: readonly Capture[], range: ChartRange): HistoryWindow {
  const last = captures[captures.length - 1]
  if (!last) return { captures: [], count: 0, from: 0, to: 0 }
  const start = rangeStart(range, last.at)
  const index = lowerBound(captures, start)
  const inside = captures.slice(index)
  const before = index > 0 ? captures[index - 1]! : null
  const carry = before && inside[0]!.at > start
  return {
    captures: carry ? [{ at: start, summary: before.summary }, ...inside] : inside,
    count: inside.length,
    from: carry ? start : inside[0]!.at,
    to: last.at,
  }
}

export interface Point {
  x: number
  y: number
}

/**
 * A stepped series for one figure. Inventory holds its value until the next
 * capture changes it, so a run of equal values draws the same line as its
 * first point: those repeats are dropped (keeping the final point so the
 * line reaches the newest capture). 1,000 captures of a slowly changing
 * figure become a few dozen points.
 */
export function stepSeries(captures: readonly Capture[], key: SummaryKey): Point[] {
  const points: Point[] = []
  let previous: number | undefined
  for (let i = 0; i < captures.length; i++) {
    const capture = captures[i]!
    const y = capture.summary[key]
    if (y !== previous || i === captures.length - 1) points.push({ x: capture.at, y })
    previous = y
  }
  return points
}

export interface RangeFigure {
  /** Value at the newest capture in range. */
  last: number
  /** Change from the first to the last capture in range. */
  change: number
}

export function rangeFigure(captures: readonly Capture[], key: SummaryKey): RangeFigure | null {
  const first = captures[0]
  const last = captures[captures.length - 1]
  if (!first || !last) return null
  return { last: last.summary[key], change: last.summary[key] - first.summary[key] }
}

// ----------------------------------------------------------- monthly analysis

export interface MonthRef {
  year: number
  /** 0–11, as Date uses. */
  month: number
}

export function monthLabel(ref: MonthRef): string {
  return new Date(ref.year, ref.month, 1).toLocaleDateString(dateLocale(), {
    month: 'long',
    year: 'numeric',
  })
}

/** Base artifact EXP a level-0 piece gives when used to enhance another. */
export const ARTIFACT_LEVEL0_EXP = { artifact4: 2520, artifact3: 1260 } as const

// ---------------------------------------------------------- recent snapshots

export interface RecentSnapshot {
  id: number
  takenAt: number
  /** Set when Irminsul saw the same inventory again after it was taken. */
  seenAgainAt: number | null
  source: string
  rawSize: number
  storedSize: number
  summary: SnapshotSummary
  /** Non-zero changes against the snapshot before it, in display order (label in the language on screen). */
  changes: { key: SummaryKey; label: string; value: number }[]
  /** False for the account's first snapshot (nothing to compare with). */
  hasPrevious: boolean
  /** Mora and primogems were not in this capture (see currencyMissing). */
  currencyMissing: boolean
}

const CHANGE_KEYS = [
  'mora',
  'primogem',
  'characters',
  'weapons',
  'artifacts',
  'artifact4',
  'artifact3',
] as const satisfies readonly SummaryKey[]

/** The newest `count` snapshots with what changed in each. Input is newest first. */
export function recentSnapshots(
  snapshots: readonly SnapshotResponse[],
  count = 5,
): RecentSnapshot[] {
  return snapshots.slice(0, count).map((s, i) => {
    const previous = snapshots[i + 1]
    const changes: RecentSnapshot['changes'] = []
    // A figure the capture did not share (Capture's gi_off) is no change.
    const delta = sharedDelta(snapshots, i)
    if (delta) {
      for (const key of CHANGE_KEYS) {
        const value = delta[key]
        if (value !== null && value !== 0) {
          changes.push({ key, label: t(`overview.figure.${key}`), value })
        }
      }
    }
    return {
      id: s.id,
      takenAt: s.takenAt,
      seenAgainAt: s.lastSeenAt > s.takenAt ? s.lastSeenAt : null,
      source: s.source,
      rawSize: s.rawSize,
      storedSize: s.storedSize,
      summary: s.summary,
      changes,
      hasPrevious: !!previous,
      // Left out on purpose is not a missed packet.
      currencyMissing: currencyMissing(s.summary) && sharesSection(s.off, 'materials'),
    }
  })
}

/** "+1,234" / "−1,234" / "0": exact, for tables where every digit matters. */
export function formatSignedExact(value: number): string {
  if (value === 0) return '0'
  return `${value > 0 ? '+' : '−'}${formatNumber(Math.abs(value))}`
}
