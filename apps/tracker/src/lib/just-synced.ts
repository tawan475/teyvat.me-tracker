import { shallowRef, watch, type ShallowRef } from 'vue'

/**
 * Rows a capture finished while the page was open (a live sync batch or a
 * new snapshot; the user's ask, 2026-11-09): under a filter that hides done
 * rows ("Missing", "Left"…) they stay in view, marked "Synced", so the user
 * sees what just came in. A filter change, leaving the page, a reload or
 * Hide puts the list back to normal. Nothing is stored.
 */

/** The keys in `now` that `before` lacked, in `now`'s order. Pure. */
export function newKeys<K>(before: ReadonlySet<K>, now: ReadonlySet<K>): K[] {
  const added: K[] = []
  for (const key of now) if (!before.has(key)) added.push(key)
  return added
}

/**
 * `synced` after the done set moved from `before` to `now` at `at`: new keys
 * marked with the time, keys no longer done dropped. The same map when
 * nothing changed. Pure.
 */
export function nextSynced<K>(
  synced: ReadonlyMap<K, number>,
  before: ReadonlySet<K>,
  now: ReadonlySet<K>,
  at: number,
): ReadonlyMap<K, number> {
  const added = newKeys(before, now)
  let next: Map<K, number> | null = null
  for (const key of added) {
    next ??= new Map(synced)
    next.set(key, at)
  }
  for (const key of synced.keys()) {
    if (now.has(key)) continue
    next ??= new Map(synced)
    next.delete(key)
  }
  return next ?? synced
}

export interface JustSynced<K> {
  /** Key → when the capture finished it (ms), while the page is open. */
  synced: Readonly<ShallowRef<ReadonlyMap<K, number>>>
  /** Back to the normal list (the page's "Hide"). */
  hide: () => void
}

/**
 * Watches `done`, the keys a capture says are done (never the hand marks).
 * Its first value, and the first after it was null (another account
 * loading), is the baseline: nothing is marked for what was already done
 * when the page opened. `reset` (the filters) clears the marks.
 */
export function useJustSynced<K>(
  done: () => ReadonlySet<K> | null,
  reset: () => unknown,
  clock: () => number = Date.now,
): JustSynced<K> {
  const synced = shallowRef<ReadonlyMap<K, number>>(new Map())
  let before: ReadonlySet<K> | null = null
  watch(
    done,
    (now) => {
      if (!now) {
        before = null
        synced.value = new Map()
        return
      }
      if (before && before !== now) synced.value = nextSynced(synced.value, before, now, clock())
      before = now
    },
    { immediate: true },
  )
  watch(reset, () => (synced.value = new Map()), { deep: true })
  return { synced, hide: () => (synced.value = new Map()) }
}
