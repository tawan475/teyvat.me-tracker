/**
 * Material counts over time, built from the stored materials sections.
 *
 * Pure and dependency-free apart from @gdt/shared, so it runs the same on the
 * main thread and in a worker (see materials.ts for which one is used).
 *
 * Stored snapshots keep materials as a full "keyframe" or as a delta against
 * one (see decodeMaterials in @gdt/shared). Consecutive snapshots almost
 * always share a keyframe, so the counts that can differ between them are
 * only the keys either delta names: the walk below touches a few dozen keys
 * per snapshot instead of all ~1,500. A full comparison only happens when the
 * keyframe changes.
 */

import { decodeMaterials, fromRef, type KeyDictionary, type MaterialsSection } from '@gdt/shared'
import { notSharedBagKeysAt, offBagKeys, sharesSection } from '@gdt/shared/off'

export interface MaterialsSnapshotRef {
  id: number
  takenAt: number
  lastSeenAt: number
  /** Section hash of this snapshot's materials (a keyframe or a delta). */
  materials: string
  /** Hash of the keyframe the delta applies to; equals `materials` for a keyframe. */
  materialsKeyframe: string
  /**
   * The capture's `gi_off` (Capture's switches that were off), when it had
   * one. A switch can cover a count of the bag (the bag copies, BAG_COPIES
   * in @gdt/shared): that capture did not share it (MaterialSeries.off).
   */
  off?: readonly string[]
}

/** A key's count as change points: `value[i]` holds from snapshot `at[i]` on. */
export interface MaterialSeries {
  at: number[]
  value: number[]
  /**
   * Snapshots (indices into `times`, ascending) whose capture did not share
   * this count: its own switches covered it (issue 12; Original Resin with
   * Account numbers off, Realm Currency with Serenitea Pot off). None of
   * them is a change point: the last shared count stands over them (never
   * 0), so changes compare the captures that shared it, and the charts
   * break the key's line there (framePoints). Absent when every capture
   * shared it.
   */
  off?: number[]
}

export interface MaterialsHistory {
  /** Capture time of each snapshot, oldest first (epoch ms). */
  times: number[]
  /** Snapshot id of each entry of `times`. */
  ids: number[]
  /** When the newest snapshot's counts were last confirmed by an upload. */
  lastSeenAt: number
  /** Every key present in any snapshot. A key absent from a snapshot counts 0. */
  series: Map<string, MaterialSeries>
  /** The newest snapshot's materials, exactly as its GOOD file lists them. */
  latest: Map<string, number>
  /**
   * Captures that did not share the materials (Capture's gi_off, issue 12).
   * Their snapshots are not in `times`: every count holds the last shared
   * one over them, and the charts break their lines there (chartFrame,
   * framePoints). Absent when every capture shared them and every count
   * (no series has an `off`); `at` is empty when only single counts were
   * left out.
   */
  unshared?: UnsharedCaptures
  /**
   * Keys that are not shared now (the bag copies, bag-copies.ts: Original
   * Resin with Account numbers off, Realm Currency with Serenitea Pot off):
   * the newest capture's switches cover them, or those of the capture this
   * bag is read from do (the newest left the Materials out). They are not in
   * `latest`, and the page lists none of them as held now; `series` keeps
   * their stored points. Absent when there is none.
   */
  hidden?: string[]
}

export interface UnsharedCaptures {
  /** When each capture without the materials was taken, and last seen again; oldest first (epoch ms). */
  at: number[]
  /** For each entry of `times`: when that snapshot's counts were last confirmed (its lastSeenAt). */
  seen: number[]
}

/** In a stored delta, this count means "the key is gone" (see @gdt/shared). */
const REMOVED = -1

/**
 * Counts that come with the player's properties, not the bag. A capture taken
 * before that message arrived has the bag but neither of these (see
 * currencyMissing in overview.ts); its series hold the count before it
 * instead of dropping to 0 and back.
 */
const CURRENCY: ReadonlySet<string> = new Set(['Mora', 'Primogem'])

/**
 * `snapshots`: the captures that shared the materials, oldest first, each
 * with its own `off`: a count its switches cover is not shared by it (the
 * key's series holds the last shared count and lists the snapshot in `off`).
 * `unshared`: those that did not share the materials at all (Capture's
 * gi_off), in any order; they hold no bag and only mark where the charts
 * break their lines.
 */
export function buildMaterialsHistory(
  snapshots: readonly MaterialsSnapshotRef[],
  texts: ReadonlyMap<string, string>,
  dictionary: KeyDictionary,
  unshared: readonly Pick<MaterialsSnapshotRef, 'takenAt' | 'lastSeenAt'>[] = [],
): MaterialsHistory {
  const parse = (hash: string): MaterialsSection => {
    const text = texts.get(hash)
    if (text === undefined) throw new Error(`Bundle is missing materials section ${hash}`)
    return JSON.parse(text) as MaterialsSection
  }

  // Each keyframe is parsed and decoded once, however many deltas use it.
  const keyframes = new Map<string, Map<string, number>>()
  const keyframe = (hash: string) => {
    let decoded = keyframes.get(hash)
    if (!decoded) {
      decoded = decodeMaterials(parse(hash), dictionary, null)
      keyframes.set(hash, decoded)
    }
    return decoded
  }

  const series = new Map<string, MaterialSeries>()
  const state = new Map<string, number>()
  const times: number[] = []
  const ids: number[] = []
  /** Per key: the snapshots whose capture did not share it. */
  const offAt = new Map<string, number[]>()
  /**
   * Keys a capture that did not share them moved in `state` (the key left
   * the bag; an upload from before the import dropped it may still hold a
   * count), so `state` no longer says what the series holds: the next
   * capture that shares one is compared with the series itself.
   */
  const stale = new Set<string>()

  let previousKeyframe: string | null = null
  let previousDelta = new Map<string, number>()

  snapshots.forEach((snapshot, index) => {
    times.push(snapshot.takenAt)
    ids.push(snapshot.id)
    const base = keyframe(snapshot.materialsKeyframe)
    const delta = new Map<string, number>()
    if (snapshot.materials !== snapshot.materialsKeyframe) {
      for (const [ref, count] of parse(snapshot.materials).m) {
        delta.set(fromRef(dictionary, ref), count)
      }
    }

    const countOf = (key: string): number | undefined => {
      const changed = delta.get(key)
      if (changed !== undefined) return changed === REMOVED ? undefined : changed
      return base.get(key)
    }

    // Keys whose count may differ from the previous snapshot.
    let candidates: Set<string>
    if (snapshot.materialsKeyframe === previousKeyframe) {
      candidates = new Set([...previousDelta.keys(), ...delta.keys()])
    } else {
      candidates = new Set([...state.keys(), ...base.keys(), ...delta.keys()])
    }
    for (const key of stale) candidates.add(key)

    // The counts this capture's own switches cover: not shared by it.
    const covered = offBagKeys(snapshot.off)
    for (const key of covered) {
      const list = offAt.get(key)
      if (list) list.push(index)
      else offAt.set(key, [index])
    }

    const currencyMissing = !countOf('Mora') && !countOf('Primogem')
    for (const key of candidates) {
      const next = countOf(key)
      const current = state.get(key)
      if (next !== current) {
        if (next === undefined) state.delete(key)
        else state.set(key, next)
      } else if (!stale.has(key)) continue
      // `state` stays exact (`latest` is the file as listed); only the series skip it.
      if (currencyMissing && CURRENCY.has(key)) continue
      // Not shared by this capture: no point, the last shared count stands.
      if (covered.includes(key)) {
        stale.add(key)
        continue
      }
      const behind = stale.delete(key)
      let entry = series.get(key)
      if (!entry) {
        // Never shared with a count, and none now: still no series.
        if (behind && next === undefined) continue
        entry = { at: [], value: [] }
        series.set(key, entry)
      }
      // The capture after a skipped one usually brings the count held already.
      if (entry.value.at(-1) === (next ?? 0)) continue
      entry.at.push(index)
      entry.value.push(next ?? 0)
    }

    previousKeyframe = snapshot.materialsKeyframe
    previousDelta = delta
  })

  // A count no capture ever shared has no series, and gets none here.
  let keyGaps = false
  for (const [key, list] of offAt) {
    const entry = series.get(key)
    if (!entry) continue
    entry.off = list
    keyGaps = true
  }

  const history: MaterialsHistory = {
    times,
    ids,
    lastSeenAt: snapshots.at(-1)?.lastSeenAt ?? 0,
    series,
    latest: state,
  }
  if (unshared.length > 0 || keyGaps) {
    // A later sighting of the same upload is a capture too.
    const at = unshared.flatMap((s) =>
      s.lastSeenAt > s.takenAt ? [s.takenAt, s.lastSeenAt] : [s.takenAt],
    )
    history.unshared = {
      at: at.sort((a, b) => a - b),
      seen: snapshots.map((s) => Math.max(s.lastSeenAt, s.takenAt)),
    }
  }
  return history
}

/**
 * The history with `keys` marked not shared now (`hidden`) and out of
 * `latest`; the same history when `keys` is empty.
 */
export function withHiddenKeys(
  history: MaterialsHistory,
  keys: readonly string[],
): MaterialsHistory {
  if (keys.length === 0) return history
  const latest = new Map(history.latest)
  for (const key of keys) latest.delete(key)
  return { ...history, latest, hidden: [...keys] }
}

/**
 * The history of an account's captures: `stored` holds the materials section
 * of every snapshot (in any order), `list` is the snapshot list, newest
 * first, with each capture's `gi_off` (issue 12).
 *
 * A capture whose Materials switch was off holds no bag: it is left out, so
 * every count holds the last shared one, and the charts break their lines
 * where it was taken. Each capture's own switches may cover a count the bag
 * holds a copy of (bag-copies.ts): that capture did not share it, and the
 * count's line breaks there too. And the counts that are not shared now
 * (`hidden`) go by the newest capture's switches and, when it left the
 * Materials out, by those of the capture the bag is read from: an older bag
 * taken without the count holds none, which would read as a current 0.
 */
export function historyOfCaptures(
  stored: readonly Omit<MaterialsSnapshotRef, 'off'>[],
  texts: ReadonlyMap<string, string>,
  dictionary: KeyDictionary,
  list: readonly (Pick<MaterialsSnapshotRef, 'id' | 'takenAt' | 'lastSeenAt'> & {
    off?: readonly string[]
  })[],
): MaterialsHistory {
  const unshared = list.filter((s) => !sharesSection(s.off, 'materials'))
  const left = new Set(unshared.map((s) => s.id))
  const off = new Map(list.map((s) => [s.id, s.off]))
  const snapshots = stored
    .filter((s) => !left.has(s.id))
    .map((s) => ({ ...s, off: off.get(s.id) }))
    .sort((a, b) => a.takenAt - b.takenAt || a.id - b.id)
  return withHiddenKeys(
    buildMaterialsHistory(snapshots, texts, dictionary, unshared),
    notSharedBagKeysAt(list, 0),
  )
}

// ------------------------------------------------------------------ queries

/** Place of `index` in the ascending list `off`, or -1. */
function offPlace(off: readonly number[], index: number): number {
  let lo = 0
  let hi = off.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const at = off[mid]!
    if (at === index) return mid
    if (at < index) lo = mid + 1
    else hi = mid - 1
  }
  return -1
}

/** Whether the capture of snapshot `index` shared the key's count (MaterialSeries.off). */
export function sharedAt(series: MaterialSeries | undefined, index: number): boolean {
  return !series?.off || offPlace(series.off, index) === -1
}

/**
 * The newest snapshot after `after`, up to `index`, whose capture shared the
 * key's count; -1 when none of them did.
 */
export function lastSharedIn(
  series: MaterialSeries | undefined,
  index: number,
  after = -1,
): number {
  const off = series?.off
  if (off) {
    let place = offPlace(off, index)
    while (place >= 0 && index > after && off[place] === index) {
      index--
      place--
    }
  }
  return index > after ? index : -1
}

/**
 * The first snapshot whose capture shared the key's count (0 when every one
 * did). The captures before it say nothing of the count: a figure asked of
 * one of them is read here, so the count's first sharing is no gain.
 */
export function firstShared(series: MaterialSeries | undefined): number {
  const off = series?.off
  let first = 0
  if (off) while (off[first] === first) first++
  return first
}

/**
 * The count at snapshot `index` (0 before the key first appears). Over a
 * capture that did not share the count (MaterialSeries.off) it is the last
 * shared one; before the first that shared it, that first one's.
 */
export function valueAt(series: MaterialSeries | undefined, index: number): number {
  if (!series || index < 0) return 0
  if (series.off) index = Math.max(index, firstShared(series))
  // Last change point at or before `index`.
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
  return found === -1 ? 0 : series.value[found]!
}

/** Index of the newest snapshot taken at or before `ms`, or -1. */
export function indexAtOrBefore(times: readonly number[], ms: number): number {
  let lo = 0
  let hi = times.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (times[mid]! <= ms) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

// ------------------------------------------------------------------- charts

export type GroupBy = 'hour' | 'day' | 'month' | 'year'

/** Start of the local-time hour, day, month or year containing `ms`. */
export function periodStart(ms: number, groupBy: GroupBy): number {
  const date = new Date(ms)
  if (groupBy === 'hour') date.setMinutes(0, 0, 0)
  else date.setHours(0, 0, 0, 0)
  if (groupBy === 'month') date.setDate(1)
  if (groupBy === 'year') date.setMonth(0, 1)
  return date.getTime()
}

/** Which snapshots a chart over `from`…end plots, shared by every series in it. */
export interface ChartFrame {
  from: number
  /** Last snapshot of each period inside the range, oldest first. */
  indices: number[]
  /** Snapshot whose counts held at `from` (the range opens mid-history), or -1. */
  carryIn: number
  /** Snapshot changes over the range are measured from. */
  baseline: number
  /** Snapshots taken inside the range. */
  count: number
  /** Where the newest counts stop being confirmed (its lastSeenAt). */
  end: number
  /**
   * Captures after `from` that did not share the materials, oldest first:
   * every line breaks there. Kept like `indices`: a period keeps its last
   * one, and none when a snapshot of the period is plotted (the period
   * closes on a capture that shared them). Absent when there is none.
   */
  gaps?: number[]
  /** The range opens after a capture that did not share them: no count is carried in. */
  opensUnshared?: boolean
}

/**
 * The frame for a chart from `from` on, keeping every snapshot (`raw`) or
 * the last one per local hour or day.
 */
export function chartFrame(
  history: MaterialsHistory,
  from: number,
  bucket: GroupBy | 'raw',
): ChartFrame {
  const { times } = history
  const start = indexAtOrBefore(times, from) + 1
  const carryIn = start > 0 && start <= times.length ? start - 1 : -1
  const indices: number[] = []
  let period = Number.NaN
  for (let i = start; i < times.length; i++) {
    if (bucket === 'raw') {
      indices.push(i)
      continue
    }
    const p = periodStart(times[i]!, bucket)
    // Same period as the previous snapshot: the later one replaces it.
    if (p === period) indices[indices.length - 1] = i
    else indices.push(i)
    period = p
  }
  const frame: ChartFrame = {
    from,
    indices,
    carryIn,
    baseline: carryIn >= 0 ? carryIn : Math.min(start, times.length - 1),
    count: times.length - start,
    end: Math.max(history.lastSeenAt, times.at(-1) ?? 0),
  }

  const unshared = history.unshared?.at ?? []
  if (unshared.length > 0 && times.length > 0) {
    const plotted = new Set(
      bucket === 'raw' ? [] : indices.map((i) => periodStart(times[i]!, bucket)),
    )
    const gaps: number[] = []
    /** The newest one at or before `from`. */
    let before: number | undefined
    period = Number.NaN
    for (const at of unshared) {
      if (at <= from) {
        before = at
        continue
      }
      if (bucket === 'raw') {
        gaps.push(at)
        continue
      }
      const p = periodStart(at, bucket)
      if (plotted.has(p)) continue
      if (p === period) gaps[gaps.length - 1] = at
      else gaps.push(at)
      period = p
    }
    if (gaps.length > 0) frame.gaps = gaps
    if (before !== undefined && (carryIn < 0 || before > times[carryIn]!)) {
      frame.opensUnshared = true
    }
  }
  return frame
}

/** A chart line's point: `y` null where a capture did not share the materials, or this count (the line breaks). */
export interface MaterialPoint {
  x: number
  y: number | null
}

/**
 * A line over `frame` from each plotted snapshot's count (`read`), held to
 * the end. A capture that did not share the materials (frame.gaps) is a
 * point without a value: the line ends where the count before it was last
 * confirmed and starts again at the next snapshot, with no 0 and no count
 * held across, as on the progression charts. Nothing is held to the end
 * after one.
 *
 * `series`: the key the line is of. A capture that shared the bag but not
 * this count (MaterialSeries.off) breaks this line the same way, under the
 * same rule per period: a period shows its last capture that shared the
 * count, at that capture's time, and is a break only when none of its
 * captures did.
 */
export function framePoints(
  history: MaterialsHistory,
  frame: ChartFrame,
  read: (index: number) => number,
  series?: MaterialSeries,
): MaterialPoint[] {
  const { times } = history
  const seen = history.unshared?.seen
  const gaps = frame.gaps ?? []
  const own = series?.off ? series : undefined
  const points: MaterialPoint[] = []
  /** The snapshot the last point shows; -1 at the start and after a break. */
  let shown = -1
  /** The line as far as its last count was confirmed, when that is before `limit`. */
  const holdBefore = (limit: number) => {
    const held = points[points.length - 1]
    const until = shown >= 0 ? (seen?.[shown] ?? 0) : 0
    if (held && until > held.x && until < limit) points.push({ x: until, y: held.y })
  }
  const breakAt = (gap: number) => {
    holdBefore(gap)
    points.push({ x: gap, y: null })
    shown = -1
  }
  let g = 0
  const breaksBefore = (limit: number) => {
    for (; g < gaps.length && gaps[g]! < limit; g++) breakAt(gaps[g]!)
  }

  if (frame.opensUnshared || (frame.carryIn >= 0 && !sharedAt(own, frame.carryIn))) {
    points.push({ x: frame.from, y: null })
  } else if (frame.carryIn >= 0) {
    points.push({ x: frame.from, y: read(frame.carryIn) })
    shown = frame.carryIn
  }
  /** The last snapshot before the period being plotted. */
  let before = frame.carryIn
  for (const index of frame.indices) {
    const plotted = lastSharedIn(own, index, before)
    before = index
    const x = times[plotted >= 0 ? plotted : index]!
    breaksBefore(x)
    if (plotted >= 0) {
      points.push({ x, y: read(plotted) })
      shown = plotted
    } else breakAt(x)
    // One stamped the same instant as a snapshot: the snapshot's point stands.
    while (g < gaps.length && gaps[g]! <= x) g++
  }
  breaksBefore(Infinity)
  const last = times.length - 1
  if (shown >= 0) {
    if (shown < last && !sharedAt(own, last)) holdBefore(times[shown + 1]!)
    else if (frame.end > times[last]!) points.push({ x: frame.end, y: read(last) })
  }
  return points
}

/** Chart points for one key: last count in each period, held to the end (see framePoints). */
export function seriesPoints(
  history: MaterialsHistory,
  key: string,
  frame: ChartFrame,
): MaterialPoint[] {
  const series = history.series.get(key)
  return framePoints(history, frame, (index) => valueAt(series, index), series)
}

/** Count change of `key` across the range (newest minus the baseline snapshot). */
export function changeOver(history: MaterialsHistory, key: string, frame: ChartFrame): number {
  const series = history.series.get(key)
  return valueAt(series, history.times.length - 1) - valueAt(series, frame.baseline)
}

// --------------------------------------------------------------------- live

/** The open live journal as the Materials page reads it (live sync). */
export interface MaterialsJournal {
  open?: boolean
  base?: { snapshotId: number; takenAt: number } | null
  updatedAt?: number | null
  changes?: readonly (readonly [string, readonly (string | number)[], unknown?])[]
}

/**
 * The history with the live journal's material changes as one more point
 * ("now", at the journal's last batch), so the bag, the wallet, the changes
 * and the charts show what Capture has sent since the newest snapshot. A
 * journal that isn't open on the newest snapshot, or names no material,
 * leaves the history as it is.
 */
export function withLiveMaterials(
  history: MaterialsHistory,
  live: MaterialsJournal | null | undefined,
): MaterialsHistory {
  const newest = history.ids.at(-1)
  if (!live?.open || newest === undefined || live.base?.snapshotId !== newest) return history
  const latest = new Map(history.latest)
  let touched = false
  for (const [op, path, value] of live.changes ?? []) {
    if (path[0] !== 'materials' || path.length !== 2) continue
    const key = String(path[1])
    // Not shared now: a journal from before the Worker dropped these keeps one.
    if (history.hidden?.includes(key)) continue
    if (op === 'del') latest.delete(key)
    else if (op === 'set' && typeof value === 'number' && Number.isFinite(value)) {
      latest.set(key, value)
    } else continue
    touched = true
  }
  if (!touched) return history
  const index = history.times.length
  const at = Math.max(live.updatedAt ?? 0, history.times.at(-1)!)
  const series = new Map(history.series)
  for (const key of new Set([...history.latest.keys(), ...latest.keys()])) {
    const next = latest.get(key) ?? 0
    const before = history.latest.get(key) ?? 0
    if (next === before && latest.has(key) === history.latest.has(key)) continue
    const entry = series.get(key)
    series.set(key, {
      at: [...(entry?.at ?? []), index],
      value: [...(entry?.value ?? []), next],
      ...(entry?.off ? { off: entry.off } : {}),
    })
  }
  // A count the newest capture did not share is not shared by the journal on
  // it either: the live point is one more break of its line, not its count.
  for (const [key, entry] of history.series) {
    if (entry.off?.at(-1) !== index - 1) continue
    series.set(key, { ...(series.get(key) ?? entry), off: [...entry.off, index] })
  }
  return {
    times: [...history.times, at],
    // The live point is no snapshot: -1 matches none.
    ids: [...history.ids, -1],
    lastSeenAt: Math.max(history.lastSeenAt, at),
    series,
    latest,
    ...(history.hidden ? { hidden: history.hidden } : {}),
    ...(history.unshared
      ? { unshared: { at: history.unshared.at, seen: [...history.unshared.seen, at] } }
      : {}),
  }
}
