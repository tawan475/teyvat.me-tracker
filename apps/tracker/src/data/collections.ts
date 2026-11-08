import { loadBundle, loadLive, type AccountRef, type DecodedBundle } from '@/data/account-data'
import {
  COLLECTION_SECTIONS,
  capturedCollections,
  withLiveCollections,
  type CapturedCollections,
} from '@/data/collection-parts'

export {
  COLLECTION_SECTIONS,
  withLiveCollections,
  type Captured,
  type CapturedCollections,
} from '@/data/collection-parts'

const decoded = new WeakMap<DecodedBundle, CapturedCollections>()

/**
 * The account's captured collections (one bundle of their sections, cached),
 * with what Capture sent since the newest snapshot (live sync: saved teams,
 * respawn times, parent quests) applied.
 */
export async function loadCapturedCollections(
  account: AccountRef & { latest?: { id: number } | null },
): Promise<CapturedCollections> {
  const [bundle, live] = await Promise.all([
    loadBundle(account, { sections: [...COLLECTION_SECTIONS] }),
    loadLive(account).catch(() => null),
  ])
  let value = decoded.get(bundle)
  if (!value) decoded.set(bundle, (value = capturedCollections(bundle)))
  return withLiveCollections(value, live, account.latest?.id ?? null)
}
