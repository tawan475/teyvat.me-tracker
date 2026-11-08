import { nextTick, reactive, shallowRef } from 'vue'
import { describe, expect, it } from 'vitest'
import { newKeys, nextSynced, useJustSynced } from '../just-synced'

describe('rows a capture just finished', () => {
  it('finds the new keys and drops the ones no longer done', () => {
    expect(newKeys(new Set([1, 2]), new Set([1, 2, 3, 4]))).toEqual([3, 4])
    const start = new Map([[9, 100]])
    expect([...nextSynced(start, new Set([1, 9]), new Set([1, 9, 3]), 200)]).toEqual([
      [9, 100],
      [3, 200],
    ])
    // Un-done by a later capture: no longer marked.
    expect([...nextSynced(start, new Set([1, 9]), new Set([1]), 200)]).toEqual([])
    // Nothing moved: the same map (no re-render).
    expect(nextSynced(start, new Set([9]), new Set([9]), 200)).toBe(start)
  })

  it('marks only what a capture finishes while the page is open', async () => {
    const done = shallowRef<ReadonlySet<number> | null>(new Set([1, 2]))
    const filters = reactive({ completion: 'missing' })
    let now = 1_000
    const { synced, hide } = useJustSynced(
      () => done.value,
      () => filters,
      () => now,
    )
    // What was done when the page opened is the baseline.
    expect(synced.value.size).toBe(0)

    now = 2_000
    done.value = new Set([1, 2, 3])
    await nextTick()
    expect([...synced.value]).toEqual([[3, 2_000]])

    // A filter change puts the list back to normal.
    filters.completion = 'all'
    await nextTick()
    expect(synced.value.size).toBe(0)

    done.value = new Set([1, 2, 3, 4])
    await nextTick()
    expect([...synced.value.keys()]).toEqual([4])
    hide()
    expect(synced.value.size).toBe(0)

    // Another account loading (null): its first set is a new baseline.
    done.value = null
    await nextTick()
    done.value = new Set([7, 8])
    await nextTick()
    expect(synced.value.size).toBe(0)
  })
})
