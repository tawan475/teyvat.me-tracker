import { loadPlanner, type PlannerData } from '@gdt/game-data'
import { constellationBoosts } from '@gdt/game-data/planner-math'
import { computed, shallowRef, type ComputedRef } from 'vue'
import type { ConstellationBoosts } from '@/data/character-build'
import { imageUrl } from '@/lib/assets'

/**
 * Which talents a character's C3 and C5 raise, from the planner data
 * (loaded once, on first use; the Planner and Materials pages share it).
 * null until it has loaded, or when it fails: talents then show base levels.
 */
const planner = shallowRef<PlannerData | null>(null)
let loading: Promise<void> | null = null

function load() {
  loading ??= loadPlanner().then(
    (data) => {
      planner.value = data
    },
    () => {
      loading = null
    },
  )
}

export function useConstellationBoosts(key: () => string): ComputedRef<ConstellationBoosts | null> {
  load()
  return computed(() => (planner.value ? constellationBoosts(planner.value, key()) : null))
}

/** Settles once the planner data has loaded or failed (a drawing that waits draws once). */
export function constellationBoostsReady(): Promise<void> {
  load()
  return loading ?? Promise.resolve()
}

/** The same for any character (a roster): a lookup by key, null until the data has loaded. */
export function useConstellationBoostTable(): ComputedRef<
  ((key: string) => ConstellationBoosts | null) | null
> {
  load()
  return computed(() => {
    const data = planner.value
    return data ? (key: string) => constellationBoosts(data, key) : null
  })
}

/**
 * The Crown of Insight's icon (the planner data's `crown` material, as the
 * game names it), for crowned talents; '' until the data has loaded.
 */
export function useCrownIcon(): ComputedRef<string> {
  load()
  return computed(() => {
    const crown =
      planner.value && [...planner.value.materials.values()].find((m) => m.kind === 'crown')
    return crown ? imageUrl(crown.icon) : ''
  })
}
