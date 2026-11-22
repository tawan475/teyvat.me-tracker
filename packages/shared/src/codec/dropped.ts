/**
 * Upload fields the tracker no longer keeps (the user's audit, 2026-11-22):
 * no page shows them, yet they were about 11% of everything stored.
 *
 * - `gi_tasks.respawns`: bosses' and elites' respawn times. Hidden since the
 *   user found them unverifiable; a co-op host's times and the spot sets the
 *   game picks made it change on nearly every upload.
 * - `gi_events`: event progress, read by no page.
 * - `gi_miliastra`: Miliastra Wonderland cosmetics; their page is shelved.
 * - `gi_collections.monstersSeen`: Living Beings shows only how many, so
 *   only the count is kept (`monstersSeenCount`).
 *
 * Teyvat.me Capture still sends them (its own export keeps them). The import
 * normalises them as before, then stores the snapshot without them; the
 * content hash an older tracker gave the same file is still worked out, so a
 * re-upload of a capture stored before is still the same capture. Live
 * changes to them are not stored. `admin:repack --clean` takes them out of
 * history (`cleanSection`).
 */

import type { DeltaChange } from '../live/delta'
import type { NormalizedGood } from './normalize'
import type { SectionKind } from './sections'

/**
 * Removable parts (parts.ts) that are dropped whole: once a history holds
 * none of them, the remove dialog leaves them out.
 */
export const DROPPED_PARTS = ['events', 'miliastra'] as const

/** `good` without the dropped fields; the same object when it has none. */
export function withoutDropped(good: NormalizedGood): NormalizedGood {
  const respawns = good.tasks?.respawns !== undefined
  const seen = good.collections?.monstersSeen !== undefined
  if (!respawns && !seen && good.events === null && good.miliastra === null) return good
  const out: NormalizedGood = { ...good, events: null, miliastra: null }
  if (respawns) {
    const { respawns: _respawns, ...tasks } = good.tasks!
    out.tasks = Object.keys(tasks).length > 0 ? tasks : null
  }
  if (seen) {
    const { monstersSeen, ...collections } = good.collections!
    out.collections = { ...collections, monstersSeenCount: monstersSeen!.length }
  }
  return out
}

/** Whether a live change is to a dropped field (it is then not stored). */
export function isDroppedChange(change: DeltaChange): boolean {
  const [root, field] = change[1]
  if (root === 'gi_events' || root === 'gi_miliastra') return true
  if (root === 'gi_tasks') return field === 'respawns'
  if (root === 'gi_collections') return field === 'monstersSeen'
  return false
}

/**
 * A stored section's value (storage letters) without the dropped fields, as
 * the import stores it now: null when nothing is left, the same value when
 * it held none. `monstersSeen` (collections2 `m`) becomes its count (`c`).
 */
export function cleanSection(kind: SectionKind, value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
  const v = value as Record<string, unknown>
  const drop = (key: string) => {
    if (!(key in v)) return value
    const out = { ...v }
    delete out[key]
    return Object.keys(out).length > 0 ? out : null
  }
  if (kind === 'tasks') return drop('m')
  if (kind === 'progress') return drop('e')
  if (kind === 'extras') return drop('m')
  if (kind === 'collections2' && Array.isArray(v.m)) {
    const { m, ...rest } = v
    return { ...rest, c: (m as unknown[]).length }
  }
  return value
}
