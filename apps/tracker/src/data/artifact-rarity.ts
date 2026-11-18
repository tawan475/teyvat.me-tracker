/**
 * Loads the account's unlocked, unequipped artifacts per rarity at every
 * snapshot (see artifact-rarity-history), cached per data version.
 */

import { sharesSection } from '@gdt/shared/off'
import {
  accountCacheKey,
  loadBundle,
  loadCatalog,
  loadSnapshots,
  type AccountRef,
} from './account-data'
import { buildArtifactRarityHistory, type ArtifactRarityHistory } from './artifact-rarity-history'

const cache = new Map<string, Promise<ArtifactRarityHistory>>()
const MAX_ENTRIES = 4

/** The account's counts per snapshot; one per data version. */
export function loadArtifactRarityHistory(account: AccountRef): Promise<ArtifactRarityHistory> {
  const key = accountCacheKey(account)
  let entry = cache.get(key)
  if (!entry) {
    entry = (async () => {
      const [bundle, catalog, list] = await Promise.all([
        loadBundle(account, { sections: ['artifacts'] }),
        loadCatalog(account),
        loadSnapshots(account),
      ])
      // A capture whose Artifacts switch was off (issue 12) gets no count:
      // the charts hold the last shared one.
      const unshared = new Set(
        list.filter((s) => !sharesSection(s.off, 'artifacts')).map((s) => s.id),
      )
      return buildArtifactRarityHistory(
        bundle.snapshots.filter((s) => !unshared.has(s.id)),
        bundle.texts,
        (id) => catalog.get(id)?.rarity,
      )
    })()
    entry.catch(() => cache.delete(key))
    cache.set(key, entry)
    while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!)
  }
  return entry
}
