import { computed, ref } from 'vue'
import type { ProgressionGraph } from '@gdt/shared/settings'
import { readJson, readStorage, writeStorage } from '@/lib/storage'
import { useSession } from '@/stores/session'
import { DEFAULT_GRAPHS, knownGraphs, legacyGraphs, toStored, type Graph } from './graphs'

/** Where a signed-out page (guest, demo) keeps its graphs. */
const LOCAL_KEY = 'progression-graphs'
/** The card's figure chips before the Graphs dialog (this browser). */
const LEGACY_KEY = 'overview-progression-figures'

/**
 * The progression card's graphs: the user's settings when signed in (every
 * device), else this browser's. Until any are saved, the figures this browser
 * picked on the old card, else mora and primogems.
 */
export function useProgressionGraphs() {
  const session = useSession()
  const signedIn = computed(() => session.status === 'signed-in')
  const local = ref<ProgressionGraph[] | null>(readJson<ProgressionGraph[] | null>(LOCAL_KEY, null))

  const graphs = computed<readonly Graph[]>(() => {
    const stored = signedIn.value ? (session.settings.progressionGraphs ?? null) : local.value
    return knownGraphs(stored) ?? legacyGraphs(readStorage(LEGACY_KEY)) ?? DEFAULT_GRAPHS
  })

  /** Saves `next` (the defaults store as null); a refused save rolls back in the session. */
  async function save(next: readonly Graph[]): Promise<void> {
    const stored = toStored(next)
    // The old chips' choice has been carried over once anything is saved.
    writeStorage(LEGACY_KEY, null)
    if (signedIn.value) {
      await session.updateSettings({ progressionGraphs: stored })
      return
    }
    local.value = stored
    writeStorage(LOCAL_KEY, stored === null ? null : JSON.stringify(stored))
  }

  return { graphs, save, signedIn }
}
