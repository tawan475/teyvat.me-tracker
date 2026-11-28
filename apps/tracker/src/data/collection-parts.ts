import type { LiveJournalResponse } from '@gdt/shared'
import { withLiveParts } from '@/data/live-now'
import {
  decodeCollections,
  decodeExploration,
  decodeExtras,
  decodeWardrobe,
  type BundleSnapshot,
  type CollectionsSection,
  type ExplorationSection,
  type ExtrasSection,
  type GiTeapot,
  type GiCollections,
  type GiExploration,
  type GiWardrobe,
  type WardrobeSection,
} from '@gdt/shared'

/**
 * What the captures say the player has collected: each part of
 * `gi_collections` (sections `collections` + `collections2`) and
 * `gi_wardrobe` and `gi_exploration` from the newest snapshot that has that part, with that
 * snapshot's time. A part no capture had is absent (absent is not "none").
 * `gi_exploration` goes one level further: each of its parts (statues,
 * offerings, explore…) from the newest snapshot that has it, since a capture
 * often lacks one (the game sends some after the login snapshot is taken).
 */

export interface Captured<T> {
  value: T
  /** The snapshot's capture time (epoch ms). */
  takenAt: number
}

type Parts = Required<GiCollections> & {
  wardrobe: GiWardrobe
  /**
   * The owned namecards (`gi_wardrobe.namecards`), a part of their own: the game sends the list
   * only when the player opens the namecard picker, so the newest wardrobe usually lacks it.
   */
  namecards: number[]
  exploration: GiExploration
  /** gi_teapot (Capture 1.8.0): the Serenitea Pot's comfort. */
  teapot: GiTeapot
}
export type CapturedCollections = { [K in keyof Parts]?: Captured<Parts[K]> }

export const COLLECTION_SECTIONS = [
  'collections',
  'collections2',
  'wardrobe',
  'exploration',
  'extras',
] as const

/** A decoded bundle's snapshots (oldest first) and section texts (see account-data). */
export interface CollectionsBundle {
  snapshots: readonly BundleSnapshot[]
  texts: ReadonlyMap<string, string>
}

/** Pure: the newest value of every part across a bundle. */
export function capturedCollections(bundle: CollectionsBundle): CapturedCollections {
  const out: CapturedCollections = {}
  const put = <K extends keyof Parts>(key: K, value: Parts[K] | undefined, takenAt: number) => {
    if (value !== undefined && !out[key]) out[key] = { value, takenAt } as CapturedCollections[K]
  }
  for (const snapshot of [...bundle.snapshots].reverse()) {
    for (const key of [snapshot.collections, snapshot.collections2]) {
      const text = key ? bundle.texts.get(key) : undefined
      if (text === undefined) continue
      const parts = decodeCollections(JSON.parse(text) as CollectionsSection)
      for (const [part, value] of Object.entries(parts)) {
        put(part as keyof GiCollections, value as never, snapshot.takenAt)
      }
    }
    const wardrobe = snapshot.wardrobe ? bundle.texts.get(snapshot.wardrobe) : undefined
    if (wardrobe !== undefined) {
      const value = decodeWardrobe(JSON.parse(wardrobe) as WardrobeSection)
      put('wardrobe', value, snapshot.takenAt)
      put('namecards', value.namecards, snapshot.takenAt)
    }
    const exploration = snapshot.exploration ? bundle.texts.get(snapshot.exploration) : undefined
    if (exploration !== undefined) {
      const value = decodeExploration(JSON.parse(exploration) as ExplorationSection)
      if (!out.exploration) put('exploration', value, snapshot.takenAt)
      else {
        // An older capture fills only the parts the newer ones lack.
        const merged = out.exploration.value as Record<string, unknown>
        for (const [part, v] of Object.entries(value)) if (!(part in merged)) merged[part] = v
      }
    }
    const extras = snapshot.extras ? bundle.texts.get(snapshot.extras) : undefined
    if (extras !== undefined) {
      put('teapot', decodeExtras(JSON.parse(extras) as ExtrasSection).teapot, snapshot.takenAt)
    }
  }
  return out
}

/** Pure: the journal's saved teams and quests over the captured ones. */
export function withLiveCollections(
  captured: CapturedCollections,
  live: LiveJournalResponse | null | undefined,
  snapshotId: number | null,
): CapturedCollections {
  const wardrobe = captured.wardrobe?.value
  const quests = captured.quests?.value
  const now = withLiveParts(
    {
      ...(wardrobe ? { gi_wardrobe: wardrobe } : {}),
      ...(quests ? { gi_collections: { quests } } : {}),
    },
    live,
    snapshotId,
    ['gi_wardrobe', 'quests'],
  )
  const at = live?.updatedAt ?? Date.now()
  const out = { ...captured }
  let changed = false
  if (now.gi_wardrobe && now.gi_wardrobe !== wardrobe) {
    out.wardrobe = { value: now.gi_wardrobe, takenAt: at }
    changed = true
  }
  const nextQuests = now.gi_collections?.quests
  if (nextQuests && nextQuests !== quests) {
    out.quests = { value: nextQuests, takenAt: at }
    changed = true
  }
  return changed ? out : captured
}
