/**
 * Unlocked, unequipped artifacts of every rarity (1★-5★) at every snapshot,
 * for the progression card's 5★ / 2★ / 1★ Artifact graphs. The snapshot
 * summary only carries the 4★ and 3★ counts (artifact4 / artifact3), so the
 * others are counted here from what every snapshot already stores: its
 * artifact rows (catalog id, wearer, lock) over the account's catalog. That
 * keeps the storage formats as they are and gives old snapshots their exact
 * counts too. Each distinct artifacts section is counted once; loaded only
 * while a graph shows one of these figures (artifact-rarity.ts). Pure.
 */

import { artifactRows, type ArtifactsSection, type BundleSnapshot } from '@gdt/shared'
import { yieldToMain } from '@/lib/yield'

/** Unlocked, unequipped pieces per rarity: index `rarity - 1` (1★ … 5★). */
export type RarityCounts = [number, number, number, number, number]

export interface ArtifactRarityHistory {
  /** Per snapshot id (every snapshot of the bundle). */
  counts: Map<number, RarityCounts>
}

/** Bit 0 of an artifact row's flags (sections.ts `LOCK`). */
const LOCK = 1

/**
 * Counts a section's unlocked pieces nobody wears by rarity, as the
 * snapshot summary counts its 3★ / 4★ ones (see `summarize` in the shared
 * codec). `rarityOf` gives a catalog id's rarity.
 */
export function countByRarity(
  section: ArtifactsSection,
  base: ArtifactsSection | null,
  rarityOf: (id: number) => number | undefined,
): RarityCounts {
  const counts: RarityCounts = [0, 0, 0, 0, 0]
  for (const [id, location, flags] of artifactRows(section, base)) {
    if (flags & LOCK || (location !== 0 && location !== '')) continue
    const rarity = rarityOf(id)
    if (rarity !== undefined && rarity >= 1 && rarity <= 5)
      counts[rarity - 1] = counts[rarity - 1]! + 1
  }
  return counts
}

/** Every snapshot's counts from a bundle's snapshots and section texts. */
export async function buildArtifactRarityHistory(
  snapshots: readonly BundleSnapshot[],
  texts: ReadonlyMap<string, string>,
  rarityOf: (id: number) => number | undefined,
): Promise<ArtifactRarityHistory> {
  const json = (hash: string | null | undefined): ArtifactsSection | null => {
    const text = hash ? texts.get(hash) : undefined
    return text === undefined ? null : (JSON.parse(text) as ArtifactsSection)
  }
  const bySection = new Map<string, RarityCounts | null>()
  const counts = new Map<number, RarityCounts>()
  for (let i = 0; i < snapshots.length; i++) {
    const snapshot = snapshots[i]!
    // Hundreds of snapshots: let the page breathe between batches.
    if (i % 25 === 24) await yieldToMain()
    const key = `${snapshot.artifacts}:${snapshot.artifactsBase ?? ''}`
    let section = bySection.get(key)
    if (section === undefined) {
      const own = json(snapshot.artifacts)
      try {
        section = own ? countByRarity(own, json(snapshot.artifactsBase), rarityOf) : null
      } catch {
        // A delta whose base is missing: this snapshot has no count.
        section = null
      }
      bySection.set(key, section)
    }
    if (section) counts.set(snapshot.id, section)
  }
  return { counts }
}
