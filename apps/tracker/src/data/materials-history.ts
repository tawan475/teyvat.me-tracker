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

export interface MaterialsSnapshotRef {
  id: number
  takenAt: number
  lastSeenAt: number
  /** Section hash of this snapshot's materials (a keyframe or a delta). */
  materials: string
  /** Hash of the keyframe the delta applies to; equals `materials` for a keyframe. */
  materialsKeyframe: string
}

/** A key's count as change points: `value[i]` holds from snapshot `at[i]` on. */
export interface MaterialSeries {
  at: number[]
  value: number[]
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
}

/** In a stored delta, this count means "the key is gone" (see @gdt/shared). */
const REMOVED = -1

export function buildMaterialsHistory(
  snapshots: readonly MaterialsSnapshotRef[],
  texts: ReadonlyMap<string, string>,
  dictionary: KeyDictionary,
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
    let candidates: Iterable<string>
    if (snapshot.materialsKeyframe === previousKeyframe) {
      candidates = new Set([...previousDelta.keys(), ...delta.keys()])
    } else {
      candidates = new Set([...state.keys(), ...base.keys(), ...delta.keys()])
    }

    for (const key of candidates) {
      const next = countOf(key)
      const current = state.get(key)
      if (next === current) continue
      if (next === undefined) state.delete(key)
      else state.set(key, next)
      let entry = series.get(key)
      if (!entry) {
        entry = { at: [], value: [] }
        series.set(key, entry)
      }
      entry.at.push(index)
      entry.value.push(next ?? 0)
    }

    previousKeyframe = snapshot.materialsKeyframe
    previousDelta = delta
  })

  return { times, ids, lastSeenAt: snapshots.at(-1)?.lastSeenAt ?? 0, series, latest: state }
}

// ------------------------------------------------------------------ queries

/** The count at snapshot `index` (0 before the key first appears). */
export function valueAt(series: MaterialSeries | undefined, index: number): number {
  if (!series || index < 0) return 0
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
  return {
    from,
    indices,
    carryIn,
    baseline: carryIn >= 0 ? carryIn : Math.min(start, times.length - 1),
    count: times.length - start,
    end: Math.max(history.lastSeenAt, times.at(-1) ?? 0),
  }
}

/** Chart points for one key: last count in each period, held to the end. */
export function seriesPoints(
  history: MaterialsHistory,
  key: string,
  frame: ChartFrame,
): { x: number; y: number }[] {
  const series = history.series.get(key)
  const points: { x: number; y: number }[] = []
  if (frame.carryIn >= 0) points.push({ x: frame.from, y: valueAt(series, frame.carryIn) })
  for (const index of frame.indices)
    points.push({ x: history.times[index]!, y: valueAt(series, index) })
  const last = history.times.length - 1
  if (last >= 0 && frame.end > history.times[last]!) {
    points.push({ x: frame.end, y: valueAt(series, last) })
  }
  return points
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
    })
  }
  return {
    times: [...history.times, at],
    // The live point is no snapshot: -1 matches none.
    ids: [...history.ids, -1],
    lastSeenAt: Math.max(history.lastSeenAt, at),
    series,
    latest,
  }
}
