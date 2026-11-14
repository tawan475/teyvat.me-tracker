/**
 * Loads the account's unlocked, unequipped artifacts per rarity at every
 * snapshot (see artifact-rarity-history), cached per data version.
 */

import { accountCacheKey, loadBundle, loadCatalog, type AccountRef } from './account-data'
import { buildArtifactRarityHistory, type ArtifactRarityHistory } from './artifact-rarity-history'

const cache = new Map<string, Promise<ArtifactRarityHistory>>()
const MAX_ENTRIES = 4

/** The account's counts per snapshot; one per data version. */
export function loadArtifactRarityHistory(account: AccountRef): Promise<ArtifactRarityHistory> {
  const key = accountCacheKey(account)
  let entry = cache.get(key)
  if (!entry) {
    entry = (async () => {
      const [bundle, catalog] = await Promise.all([
        loadBundle(account, { sections: ['artifacts'] }),
        loadCatalog(account),
      ])
      return buildArtifactRarityHistory(
        bundle.snapshots,
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
