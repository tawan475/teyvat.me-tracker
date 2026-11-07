import type { LiveJournalResponse } from '@gdt/shared'
import { loadBundle, loadLive, type AccountRef, type DecodedBundle } from '@/data/account-data'
import {
  COLLECTION_SECTIONS,
  capturedCollections,
  type CapturedCollections,
} from '@/data/collection-parts'
import { withLiveParts } from '@/data/live-now'

export {
  COLLECTION_SECTIONS,
  type Captured,
  type CapturedCollections,
} from '@/data/collection-parts'

const decoded = new WeakMap<DecodedBundle, CapturedCollections>()

/**
 * The account's captured collections (one bundle of their sections, cached),
 * with what Capture sent since the newest snapshot (live sync: saved teams,
 * respawn times) applied.
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

/** Pure: the journal's saved teams and respawn times over the captured ones. */
export function withLiveCollections(
  captured: CapturedCollections,
  live: LiveJournalResponse | null | undefined,
  snapshotId: number | null,
): CapturedCollections {
  const wardrobe = captured.wardrobe?.value
  const respawns = captured.respawns?.value
  const now = withLiveParts(
    {
      ...(wardrobe ? { gi_wardrobe: wardrobe } : {}),
      ...(respawns ? { gi_tasks: { respawns } } : {}),
    },
    live,
    snapshotId,
    ['gi_wardrobe', 'gi_tasks'],
  )
  const at = live?.updatedAt ?? Date.now()
  const out = { ...captured }
  let changed = false
  if (now.gi_wardrobe && now.gi_wardrobe !== wardrobe) {
    out.wardrobe = { value: now.gi_wardrobe, takenAt: at }
    changed = true
  }
  const nextRespawns = now.gi_tasks?.respawns
  if (nextRespawns !== respawns) {
    if (nextRespawns) out.respawns = { value: nextRespawns, takenAt: at }
    else delete out.respawns
    changed = true
  }
  return changed ? out : captured
}
