/**
 * Parts of a capture a user can keep out of the tracker (issue 12, item 3).
 *
 * Teyvat.me Capture lists the upload switches that are off in an optional
 * top-level key, `gi_off` (switch names, `[]` when everything is shared;
 * absent from older builds and from files saved to a folder). The tracker
 * keeps that list in the snapshot's meta (snapshot-meta.ts, format 3) and
 * says "Not shared by Capture" where a part is missing from the newest
 * capture. An owner can also remove a part from every stored snapshot:
 * a removable part's sections are dropped, and the sections it shares with
 * others (the profile in the player section, achievement progress and events
 * in `progress`, endgame, teapot and Miliastra in `extras`) are re-encoded
 * without it, their neighbours kept. Builds (characters, weapons, artifacts,
 * materials) are never removable.
 *
 * Pure: the Worker (services/remove-part.ts) and guest mode (local/server.ts)
 * read their rows, plan here and write what the plan says.
 */

import type { GiPlayer } from './good'
import type { DeltaChange } from './live/delta'
import {
  BlobDecoder,
  SLOTS,
  sectionHashOf,
  type BlobRef,
  type RawBlob,
  type Slot,
} from './codec/store-v2'
import { decodeSectionBlob, encodeSectionBlob, kindCode, shortHashHex } from './codec/section-blob'
import { REMOVABLE_PARTS, type RemovablePart } from './off'

export * from './off'

/** The profile's fields in the player section (Capture's Profile switch). */
export const PROFILE_FIELDS = [
  'nickname',
  'signature',
  'nameCard',
  'profilePicture',
  'birthday',
] as const satisfies readonly (keyof GiPlayer)[]

/**
 * Where a part is stored: slots it has to itself (dropped whole), and the
 * shared slot it is one key of (re-encoded without it).
 */
interface PartPlace {
  own: Slot[]
  shared?: { slot: 'player' | 'progress' | 'extras'; keys: readonly string[] }
}

export const PART_PLACES: Readonly<Record<RemovablePart, PartPlace>> = {
  achievements: {
    own: ['achievements', 'achievementTimes'],
    shared: { slot: 'progress', keys: ['a'] },
  },
  anecdotes: { own: ['anecdotes'] },
  tasks: { own: ['tasks'] },
  endgame: { own: [], shared: { slot: 'extras', keys: ['e'] } },
  collections: { own: ['collections', 'collections2'] },
  profile: { own: [], shared: { slot: 'player', keys: PROFILE_FIELDS } },
  wardrobe: { own: ['wardrobe'] },
  exploration: { own: ['exploration'] },
  teapot: { own: [], shared: { slot: 'extras', keys: ['t'] } },
  events: { own: [], shared: { slot: 'progress', keys: ['e'] } },
  miliastra: { own: [], shared: { slot: 'extras', keys: ['m'] } },
  characterExtras: { own: ['characterExtras'] },
}

/** The parts stored in the same section as `part` (they stay when it goes). */
export function partNeighbours(part: RemovablePart): RemovablePart[] {
  const shared = PART_PLACES[part].shared
  if (!shared) return []
  return REMOVABLE_PARTS.filter(
    (other) => other !== part && PART_PLACES[other].shared?.slot === shared.slot,
  )
}

/** Every slot a part touches. */
export function partSlots(part: RemovablePart): Slot[] {
  const place = PART_PLACES[part]
  return place.shared ? [...place.own, place.shared.slot] : [...place.own]
}

/** The section kind codes a part's slots are stored under (full and delta). */
export function partKindCodes(part: RemovablePart): number[] {
  return partSlots(part).flatMap((slot) => [kindCode(slot, false), kindCode(slot, true)])
}

/** A shared section's value without the part's keys: null when nothing else is left. */
export function withoutPartKeys(value: unknown, keys: readonly string[]): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
  const out: Record<string, unknown> = {}
  for (const [key, inner] of Object.entries(value)) if (!keys.includes(key)) out[key] = inner
  return Object.keys(out).length > 0 ? out : null
}

/** Whether a shared section's value holds any of the part's keys. */
export function holdsPartKeys(value: unknown, keys: readonly string[]): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    keys.some((key) => key in value)
  )
}

// ------------------------------------------------------------------ planning

/** A snapshot row as the plan reads it (live or in the trash). */
export interface PartSnapshotRow {
  id: number
  takenAt: number
  /** In the trash: kept, counted apart. */
  deleted: boolean
  /** Blob id per slot (absent or null: the snapshot has none). */
  refs: Partial<Record<Slot, number | null>>
}

/** A stored blob: `RawBlob` and its 16-hex-digit hash. */
export interface PartBlobRow extends RawBlob {
  hash: string
  /**
   * Its stored bytes, when `data` was not read (a blob that is only counted,
   * never decoded: the part's own sections).
   */
  size?: number
}

const sizeOf = (blob: PartBlobRow | undefined): number => blob?.size ?? blob?.data.length ?? 0

export interface PlannedPartBlob {
  hash: string
  code: number
  data: Uint8Array
}

/** What changes in one snapshot row: per slot, the blob it points at now (null: none). */
export interface PartRowUpdate {
  id: number
  refs: Partial<Record<Slot, BlobRef | null>>
  /** Change of the row's `stored_size` (the blobs it first stored, before and after). */
  storedDelta: number
}

export interface PartRemovalPlan {
  part: RemovablePart
  /** Live snapshots that hold the part (the trash is cleaned too, not counted). */
  snapshots: number
  /** Live snapshots in all. */
  total: number
  /** Takes of the newest live snapshot that holds it (null: none). */
  lastAt: number | null
  /** Bytes the account stores less afterwards (blobs collected, minus new ones). */
  freed: number
  blobs: PlannedPartBlob[]
  updates: PartRowUpdate[]
}

/**
 * Removes `part` from every snapshot row: its own slots become null, its
 * shared slot points at a standalone blob of the section without it (the
 * same blob for every row that shared one; an existing blob when one already
 * holds exactly that). Every new blob is checked to decode back to the value
 * it was made of. `blobs` must hold every blob the rows point at in the
 * part's slots, with their bases.
 */
export async function planPartRemoval(
  part: RemovablePart,
  rows: readonly PartSnapshotRow[],
  blobs: ReadonlyMap<number, PartBlobRow>,
): Promise<PartRemovalPlan> {
  const place = PART_PLACES[part]
  const decoder = new BlobDecoder((id) => blobs.get(id))
  const byHash = new Map<string, number>()
  for (const blob of blobs.values()) byHash.set(blob.hash.toLowerCase(), blob.id)

  // The shared slot's blobs, each re-encoded once.
  const replaced = new Map<number, BlobRef | null>()
  const made = new Map<string, PlannedPartBlob>()
  const shared = place.shared
  const sharedIds = new Set<number>()
  if (shared) {
    for (const row of rows) {
      const id = row.refs[shared.slot] ?? null
      if (id !== null) sharedIds.add(id)
    }
    for (const id of sharedIds) {
      const value = decoder.decode(id).value
      if (!holdsPartKeys(value, shared.keys)) continue
      const rest = withoutPartKeys(value, shared.keys)
      if (rest === null) {
        replaced.set(id, null)
        continue
      }
      const hash = shortHashHex(await sectionHashOf(shared.slot, rest))
      const existing = byHash.get(hash)
      if (existing !== undefined && existing !== id) {
        replaced.set(id, { id: existing })
        continue
      }
      if (!made.has(hash)) {
        const code = kindCode(shared.slot, false)
        const blob = encodeSectionBlob(shared.slot, rest, false, null)
        const back = decodeSectionBlob(code, blob.data, null, null).value
        if (JSON.stringify(back) !== JSON.stringify(rest)) {
          throw new Error(`The ${shared.slot} section did not decode back without ${part}`)
        }
        made.set(hash, { hash, code, data: blob.data })
      }
      replaced.set(id, { hash })
    }
  }

  // Which rows change, and what they hold.
  const holds = (row: PartSnapshotRow) =>
    place.own.some((slot) => (row.refs[slot] ?? null) !== null) ||
    (shared !== undefined && replaced.has(row.refs[shared.slot] ?? -1))
  const updates: PartRowUpdate[] = []
  let snapshots = 0
  let total = 0
  let lastAt: number | null = null
  for (const row of rows) {
    if (!row.deleted) total++
    if (!holds(row)) continue
    if (!row.deleted) {
      snapshots++
      if (lastAt === null || row.takenAt > lastAt) lastAt = row.takenAt
    }
    const refs: PartRowUpdate['refs'] = {}
    for (const slot of place.own) if ((row.refs[slot] ?? null) !== null) refs[slot] = null
    if (shared) {
      const id = row.refs[shared.slot] ?? null
      if (id !== null && replaced.has(id)) refs[shared.slot] = replaced.get(id)!
    }
    updates.push({ id: row.id, refs, storedDelta: 0 })
  }

  // Bytes: the blobs every row reaches (with bases) before and after.
  const reach = (ids: Iterable<number>) => {
    const seen = new Set<number>()
    for (const id of ids) {
      for (let next: number | null = id; next !== null && !seen.has(next); ) {
        seen.add(next)
        next = blobs.get(next)?.baseId ?? null
      }
    }
    return seen
  }
  const changed = new Map(updates.map((u) => [u.id, u]))
  const before: number[] = []
  const after: number[] = []
  const newUsers = new Map<string, number>()
  for (const row of rows) {
    const update = changed.get(row.id)
    for (const slot of SLOTS) {
      const id = row.refs[slot] ?? null
      if (id !== null) before.push(id)
      if (update && slot in update.refs) {
        const ref = update.refs[slot]
        if (ref && 'id' in ref) after.push(ref.id)
        else if (ref) newUsers.set(ref.hash, (newUsers.get(ref.hash) ?? 0) + 1)
      } else if (id !== null) after.push(id)
    }
  }
  const was = reach(before)
  const is = reach(after)
  let freed = 0
  for (const id of was) if (!is.has(id)) freed += sizeOf(blobs.get(id))
  for (const blob of made.values()) freed -= blob.data.length

  // stored_size: a blob's bytes count on the oldest row that points at it.
  const firstOf = new Map<string, number>()
  const ordered = [...rows].sort((a, b) => a.takenAt - b.takenAt || a.id - b.id)
  const firstById = new Map<number, number>()
  for (const row of ordered) {
    for (const slot of partSlots(part)) {
      const id = row.refs[slot] ?? null
      if (id !== null && !firstById.has(id)) firstById.set(id, row.id)
      const ref = changed.get(row.id)?.refs[slot]
      if (ref && 'hash' in ref && !firstOf.has(ref.hash)) firstOf.set(ref.hash, row.id)
    }
  }
  for (const [id, rowId] of firstById) {
    if (is.has(id)) continue
    const update = changed.get(rowId)
    if (update) update.storedDelta -= sizeOf(blobs.get(id))
  }
  for (const [hash, rowId] of firstOf) {
    const update = changed.get(rowId)
    if (update) update.storedDelta += made.get(hash)?.data.length ?? 0
  }

  return { part, snapshots, total, lastAt, freed, blobs: [...made.values()], updates }
}

/**
 * What the remove dialog lists for every part: snapshots holding it, the
 * newest one's time and about how many bytes it takes. Cheap (no
 * re-encoding): the bytes of a part in a shared section are its share of
 * that section's JSON, times the blob's size.
 */
export interface PartCount {
  part: RemovablePart
  snapshots: number
  lastAt: number | null
  bytes: number
}

export function countParts(
  rows: readonly PartSnapshotRow[],
  blobs: ReadonlyMap<number, PartBlobRow>,
): PartCount[] {
  const decoder = new BlobDecoder((id) => blobs.get(id))
  const reachSize = (ids: Iterable<number>) => {
    const seen = new Set<number>()
    let size = 0
    for (const id of ids) {
      for (let next: number | null = id; next !== null && !seen.has(next); ) {
        seen.add(next)
        const blob = blobs.get(next)
        size += sizeOf(blob)
        next = blob?.baseId ?? null
      }
    }
    return size
  }
  return REMOVABLE_PARTS.map((part) => {
    const place = PART_PLACES[part]
    const shared = place.shared
    const holding = new Map<number, number>()
    let share = 0
    if (shared) {
      const ids = new Set<number>()
      for (const row of rows) {
        const id = row.refs[shared.slot] ?? null
        if (id !== null) ids.add(id)
      }
      for (const id of ids) {
        const value = decoder.decode(id).value
        if (!holdsPartKeys(value, shared.keys)) continue
        const whole = JSON.stringify(value).length
        const rest = JSON.stringify(withoutPartKeys(value, shared.keys) ?? {}).length
        const fraction = whole > 0 ? Math.max(0, whole - rest) / whole : 0
        holding.set(id, fraction)
        share += Math.round(sizeOf(blobs.get(id)) * fraction)
      }
    }
    const own = new Set<number>()
    let snapshots = 0
    let lastAt: number | null = null
    for (const row of rows) {
      let holds = false
      for (const slot of place.own) {
        const id = row.refs[slot] ?? null
        if (id !== null) {
          own.add(id)
          holds = true
        }
      }
      if (shared && holding.has(row.refs[shared.slot] ?? -1)) holds = true
      if (holds && !row.deleted) {
        snapshots++
        if (lastAt === null || row.takenAt > lastAt) lastAt = row.takenAt
      }
    }
    return { part, snapshots, lastAt, bytes: reachSize(own) + share }
  })
}

// ------------------------------------------------------------------ live sync

const LIVE_ROOTS: Readonly<Record<RemovablePart, readonly string[]>> = {
  achievements: [
    'achievements',
    'gi_achievements',
    'gi_achievement_times',
    'gi_achievement_progress',
  ],
  anecdotes: ['anecdotes', 'gi_anecdotes'],
  tasks: ['gi_tasks'],
  endgame: ['gi_endgame'],
  collections: ['quests', 'gi_collections'],
  profile: [],
  wardrobe: ['gi_wardrobe'],
  exploration: ['gi_exploration'],
  teapot: ['gi_teapot'],
  events: ['gi_events'],
  miliastra: ['gi_miliastra'],
  characterExtras: ['gi_characters'],
}

/** Whether a live change belongs to the part (by its path). */
export function isPartChange(part: RemovablePart, change: DeltaChange): boolean {
  const [root, field] = change[1].map(String)
  if (part === 'profile') {
    return root === 'gi_player' && (PROFILE_FIELDS as readonly string[]).includes(field ?? '')
  }
  return root !== undefined && LIVE_ROOTS[part].includes(root)
}

/** A journal row's changes without the part's: the rest, and how many went. */
export function withoutPartChanges(
  part: RemovablePart,
  changes: readonly DeltaChange[],
): { changes: DeltaChange[]; dropped: number } {
  const kept = changes.filter((change) => !isPartChange(part, change))
  return { changes: kept, dropped: changes.length - kept.length }
}
