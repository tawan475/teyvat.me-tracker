/**
 * Material history for an account, built once per data version.
 *
 * Only the materials sections of every snapshot are fetched (~1 KB per
 * snapshot once deltas kick in), then walked into per-key change points (see
 * materials-history.ts). The walk is cheap enough for the main thread:
 * measured at 8 ms for 151 snapshots and 22 ms for 1,208, so no worker.
 */

import {
  accountCacheKey,
  loadBundle,
  loadMaterialsDictionary,
  type AccountRef,
} from './account-data'
import { buildMaterialsHistory, type MaterialsHistory } from './materials-history'

export * from './materials-history'

const cache = new Map<string, Promise<MaterialsHistory>>()
const MAX_ENTRIES = 4

export function loadMaterialsHistory(account: AccountRef): Promise<MaterialsHistory> {
  const key = accountCacheKey(account)
  let entry = cache.get(key)
  if (!entry) {
    entry = (async () => {
      const [bundle, dictionary] = await Promise.all([
        loadBundle(account, { sections: ['materials'] }),
        loadMaterialsDictionary(),
      ])
      const snapshots = [...bundle.snapshots].sort((a, b) => a.takenAt - b.takenAt || a.id - b.id)
      return buildMaterialsHistory(snapshots, bundle.texts, dictionary)
    })()
    entry.catch(() => cache.delete(key))
    cache.set(key, entry)
    while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!)
  }
  return entry
}
