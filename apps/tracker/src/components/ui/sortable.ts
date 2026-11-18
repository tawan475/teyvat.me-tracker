/**
 * The two-list box's moves (UiSortableLists), kept pure so they are tested
 * on their own: an ordered list of at most `max` and at least `min` keys
 * beside the rest, which stay in a fixed order of their own (the box lists
 * them, nothing here keeps it). A move answers the next ordered list and
 * what a screen reader hears, or null when nothing changes.
 */

/** Where a dragged key would land. */
export type SortOver =
  /** A place in the ordered list (0 = first, length = after the last). */
  | { at: number }
  /** The ordered list is full: the key takes this place, its page goes to the other list. */
  | { swap: number }
  /** Back to the other list. */
  | { other: true }

/** Which list a dragged key comes from. */
export type SortFrom = 'ordered' | 'other'

export interface SortLimits {
  max: number
  min: number
}

/** What a move did, for the aria-live line (`n` is 1-based). */
export type SortSaid =
  | { kind: 'place'; key: string; n: number }
  | { kind: 'other'; key: string }
  | { kind: 'swap'; key: string; n: number; other: string }

export interface SortResult {
  list: string[]
  said: SortSaid
}

/** Tap or Enter on an other-list row: the key goes to the end of the ordered list. */
export function addToEnd(
  list: readonly string[],
  key: string,
  limits: SortLimits,
): SortResult | null {
  if (list.length >= limits.max || list.includes(key)) return null
  const next = [...list, key]
  return { list: next, said: { kind: 'place', key, n: next.length } }
}

/** Tap or Enter on an ordered row: the key goes back to the other list (never below `min`). */
export function removeKey(
  list: readonly string[],
  key: string,
  limits: SortLimits,
): SortResult | null {
  if (list.length <= limits.min || !list.includes(key)) return null
  return { list: list.filter((k) => k !== key), said: { kind: 'other', key } }
}

/** The arrow keys on an ordered row's handle: one place, or to an end. */
export function nudgeKey(
  list: readonly string[],
  key: string,
  by: number | 'start' | 'end',
): SortResult | null {
  const from = list.indexOf(key)
  if (from < 0) return null
  const wanted = by === 'start' ? 0 : by === 'end' ? list.length - 1 : from + by
  const to = Math.max(0, Math.min(list.length - 1, wanted))
  if (to === from) return null
  const next = list.filter((k) => k !== key)
  next.splice(to, 0, key)
  return { list: next, said: { kind: 'place', key, n: to + 1 } }
}

/**
 * Where a drag over an ordered row lands: the row's upper half is before it,
 * the lower half after it. From the other list into a full ordered list the
 * row is a swap target. A place that leaves the order as it is is no target.
 */
export function overRow(
  list: readonly string[],
  key: string,
  from: SortFrom,
  index: number,
  lowerHalf: boolean,
  limits: SortLimits,
): SortOver | null {
  if (from === 'other' && list.length >= limits.max) return { swap: index }
  const at = lowerHalf ? index + 1 : index
  if (from === 'ordered') {
    const src = list.indexOf(key)
    if (at === src || at === src + 1) return null
  }
  return { at }
}

/** A drag over an empty place of the ordered list: after its last key. */
export function overEmpty(
  list: readonly string[],
  key: string,
  from: SortFrom,
  limits: SortLimits,
): SortOver | null {
  if (from === 'ordered') return list.indexOf(key) === list.length - 1 ? null : { at: list.length }
  return list.length < limits.max ? { at: list.length } : null
}

/** A drag over the other list: only an ordered key, and never the last `min` ones. */
export function overOther(
  list: readonly string[],
  from: SortFrom,
  limits: SortLimits,
): SortOver | null {
  return from === 'ordered' && list.length > limits.min ? { other: true } : null
}

/** A drop on `over`. */
export function dropKey(
  list: readonly string[],
  key: string,
  from: SortFrom,
  over: SortOver,
  limits: SortLimits,
): SortResult | null {
  if ('other' in over) return from === 'ordered' ? removeKey(list, key, limits) : null
  if ('swap' in over) {
    const other = list[over.swap]
    if (from !== 'other' || other === undefined || list.includes(key)) return null
    const next = [...list]
    next[over.swap] = key
    return { list: next, said: { kind: 'swap', key, n: over.swap + 1, other } }
  }
  const next = [...list]
  let at = over.at
  if (from === 'ordered') {
    const src = next.indexOf(key)
    if (src < 0) return null
    next.splice(src, 1)
    if (at > src) at -= 1
  } else if (next.length >= limits.max || next.includes(key)) return null
  at = Math.max(0, Math.min(next.length, at))
  next.splice(at, 0, key)
  if (next.every((k, i) => k === list[i]) && next.length === list.length) return null
  return { list: next, said: { kind: 'place', key, n: at + 1 } }
}
