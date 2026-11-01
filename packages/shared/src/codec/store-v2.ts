/**
 * Storage format v2 of a snapshot: which section blobs a new snapshot stores
 * and which existing ones it points at. Pure: the Worker reads what this
 * needs (the latest snapshot's blobs, which hashes exist) and writes what it
 * returns.
 *
 * The cost model is v1's ("bases & deltas" in sections.ts), applied to the
 * v2 sizes, with one addition: a full section may be compressed against the
 * account's previous standalone section of its kind (its "anchor"), so a
 * section that changed a little costs about what changed. A blob is stored
 * against its anchor only while that is at most half the standalone size;
 * past that the section is stored standalone and becomes the next anchor.
 */

import { sha256Hex128 } from '../hash'
import type { KeyDictionary } from '../dictionary'
import type { GiPlayer } from '../good'
import type { PreparedSnapshot, EncodedSnapshot } from './snapshot'
import {
  DELTA_KINDS,
  decodeSectionBlob,
  encodeSectionBlob,
  encodeSectionBlobVariants,
  kindCode,
  kindOfCode,
  shortHashHex,
  type DecodedBlob,
  type EncodedBlob,
} from './section-blob'
import {
  decodeMaterials,
  encodeAchievementTimesDelta,
  encodeArtifactsDelta,
  encodeMaterialsDelta,
  type AchievementTimesSection,
  type ArtifactsSection,
  type MaterialsSection,
  type SectionKind,
} from './sections'
import { splitPlayer, type PlayerVars } from './snapshot-meta'

/** The sixteen section slots of a v2 snapshot row, in column order (append-only). */
export const SLOTS = [
  'characters',
  'weapons',
  'artifacts',
  'materials',
  'achievements',
  'player',
  'achievementTimes',
  'characterExtras',
  'anecdotes',
  'tasks',
  'collections',
  'collections2',
  'wardrobe',
  'exploration',
  'progress',
  'extras',
] as const satisfies readonly SectionKind[]
export type Slot = (typeof SLOTS)[number]

/** A blob read from storage. */
export interface RawBlob {
  id: number
  /** `section_blobs.kind`. */
  code: number
  baseId: number | null
  data: Uint8Array
}

/**
 * Decodes blobs by id, each once, bases first. `get` returns a blob the
 * caller has loaded; the key a delta's `b` is set to is `#<base id>`.
 */
export class BlobDecoder {
  private readonly decoded = new Map<number, DecodedBlob>()

  constructor(private readonly get: (id: number) => RawBlob | undefined) {}

  decode(id: number, depth = 0): DecodedBlob {
    const cached = this.decoded.get(id)
    if (cached) return cached
    if (depth > 2) throw new Error(`Section ${id} is deeper than a base of a base`)
    const blob = this.get(id)
    if (!blob) throw new Error(`Section ${id} is missing`)
    const base = blob.baseId === null ? null : this.decode(blob.baseId, depth + 1)
    const value = decodeSectionBlob(
      blob.code,
      blob.data,
      base,
      blob.baseId === null ? null : blobKey(blob.baseId),
    )
    this.decoded.set(id, value)
    return value
  }

  /** The section's canonical JSON, as a v1 blob would inflate to (`b` as a blob key). */
  text(id: number): string {
    return JSON.stringify(this.decode(id).value)
  }
}

/** How bundles and decoded snapshots name a v2 blob (v1 blobs go by their hex hash). */
export function blobKey(id: number): string {
  return `#${id}`
}

/** A blob of the latest snapshot (or a base of one), decoded. */
export interface KnownBlob {
  id: number
  code: number
  /** 16 hex digits: `section_blobs.hash`. */
  hash: string
  size: number
  decoded: DecodedBlob
  base: KnownBlob | null
}

/** Where a planned row points: an existing blob, or one this plan stores. */
export type BlobRef = { id: number } | { hash: string }

export interface PlannedBlob {
  /** 16 hex digits. */
  hash: string
  code: number
  base: BlobRef | null
  data: Uint8Array
}

export interface SnapshotPlan {
  blobs: PlannedBlob[]
  refs: Record<Slot, BlobRef | null>
  /** Bytes of the blobs this snapshot stores. */
  storedSize: number
  playerVars: PlayerVars
}

export interface PlanInput {
  encoded: EncodedSnapshot
  prepared: PreparedSnapshot
  materialsDictionary: KeyDictionary
  /** The latest live snapshot's blob of each slot (v2 rows only), bases attached. */
  latest: Partial<Record<Slot, KnownBlob | null>>
  /** Existing blobs by short hash (16 hex digits). */
  existing: ReadonlyMap<string, { id: number; code: number }>
  /** The cost model's delta growth per snapshot (tests and measurements vary it). */
  growthBytes?: number
}

/**
 * Bytes a delta grows by per changed snapshot, in the cost model of
 * "bases & deltas" (sections.ts): a delta is stored while its size² is at
 * most 2 · this · the size a new keyframe would take now. Re-measured for v2
 * (binary deltas, keyframes compressed against their anchor) on two real
 * capture sequences (38 and 113 stored snapshots): the mean bytes per
 * snapshot vary by under 2% for any value from 15 to 40, so v1's 25 stays.
 */
export const DELTA_GROWTH_BYTES_V2 = 25

/**
 * A full section is stored compressed against its anchor only while that is
 * at most 1/REANCHOR of its standalone size; past that it becomes the next
 * anchor.
 */
const REANCHOR = 2

/** The player section v2 stores (the part that does not move every login), and its hash. */
export async function storedPlayer(
  player: GiPlayer,
): Promise<{ stable: GiPlayer; vars: PlayerVars; hash: string }> {
  const { stable, vars } = splitPlayer(player)
  return { stable, vars, hash: await sha256Hex128(`player:${JSON.stringify(stable)}`) }
}

/** The v1 content address of a decoded full section (what a delta's `b` names). */
export function sectionHashOf(kind: SectionKind, value: unknown): Promise<string> {
  return sha256Hex128(`${kind}:${JSON.stringify(value)}`)
}

export async function planSnapshotV2(input: PlanInput): Promise<SnapshotPlan> {
  const { encoded, prepared, existing } = input
  const blobs: PlannedBlob[] = []
  const planned = new Map<string, PlannedBlob>()

  const refTo = (hash: string, latest: KnownBlob | null | undefined): BlobRef | null => {
    if (latest && latest.hash === hash) return { id: latest.id }
    const found = existing.get(hash)
    if (found) return { id: found.id }
    if (planned.has(hash)) return { hash }
    return null
  }
  const store = (hash: string, code: number, base: KnownBlob | null, blob: EncodedBlob) => {
    const entry: PlannedBlob = { hash, code, base: base ? { id: base.id } : null, data: blob.data }
    blobs.push(entry)
    planned.set(hash, entry)
    return { hash }
  }

  /** A full section: against its anchor when that pays, else standalone. */
  const storeFull = (
    kind: SectionKind,
    value: unknown,
    hash: string,
    anchor: KnownBlob | null,
  ): { ref: BlobRef; size: number; base: KnownBlob | null; blob: EncodedBlob } => {
    const { standalone, withBase } = encodeSectionBlobVariants(kind, value, anchor?.decoded ?? null)
    const useBase = withBase !== null && withBase.data.length * REANCHOR <= standalone.data.length
    const blob = useBase ? withBase : standalone
    const base = useBase ? anchor : null
    return { ref: { hash }, size: blob.data.length, base, blob }
  }
  /** The standalone blob a full section of this kind would be compressed against. */
  const anchorOf = (blob: KnownBlob | null | undefined): KnownBlob | null => {
    if (!blob) return null
    const keyframe = kindOfCode(blob.code).delta ? blob.base : blob
    if (!keyframe) return null
    return keyframe.base ?? keyframe
  }

  const refs = {} as Record<Slot, BlobRef | null>
  let playerVars: PlayerVars = {}

  for (const slot of SLOTS) {
    const latest = input.latest[slot] ?? null
    const section = encoded[slot]
    let value: unknown
    let hash: string
    if (slot === 'player') {
      if (!section || !prepared.good.player) {
        refs.player = null
        continue
      }
      const player = await storedPlayer(prepared.good.player)
      playerVars = player.vars
      value = player.stable
      hash = shortHashHex(player.hash)
    } else {
      if (!section) {
        refs[slot] = null
        continue
      }
      value = JSON.parse(section.json)
      hash = shortHashHex(section.hash)
    }
    // Delta kinds are full here (planSnapshotV2 takes the snapshot before withBases).
    if ((value as { b?: unknown } | null)?.b !== undefined) {
      throw new Error(`${slot} must be a full section`)
    }

    const known = refTo(hash, latest)
    if (known) {
      refs[slot] = known
      continue
    }

    // A delta of the latest snapshot's keyframe, or a new keyframe.
    const keyframe = !latest ? null : kindOfCode(latest.code).delta ? latest.base : latest
    if (!DELTA_KINDS.has(slot) || !keyframe) {
      const full = storeFull(slot, value, hash, anchorOf(latest))
      refs[slot] = store(hash, kindCode(slot, false), full.base, full.blob)
      continue
    }
    const keyframeHash = await sectionHashOf(slot, keyframe.decoded.value)
    let delta: object
    if (slot === 'materials') {
      const base = keyframe.decoded.value as MaterialsSection
      delta = encodeMaterialsDelta(prepared.good.materials, input.materialsDictionary, {
        hash: keyframeHash,
        materials: decodeMaterials(base, input.materialsDictionary, null),
      })
    } else if (slot === 'artifacts') {
      delta = encodeArtifactsDelta(
        value as ArtifactsSection,
        keyframe.decoded.value as ArtifactsSection,
        keyframeHash,
      )
    } else {
      delta = encodeAchievementTimesDelta(
        value as AchievementTimesSection,
        keyframe.decoded.value as AchievementTimesSection,
        keyframeHash,
      )
    }
    const deltaHash = shortHashHex(await sectionHashOf(slot, delta))
    const knownDelta = refTo(deltaHash, latest)
    if (knownDelta) {
      refs[slot] = knownDelta
      continue
    }
    const deltaBlob = encodeSectionBlob(slot, delta, true, keyframe.decoded)
    const growth = input.growthBytes ?? DELTA_GROWTH_BYTES_V2
    // A delta far under the cost model's bound against the keyframe's own
    // size (a new full section is about as big) is stored without making the
    // full section to compare: that took two strong deflates of the whole
    // section per upload.
    if (deltaBlob.data.length ** 2 <= growth * keyframe.size) {
      refs[slot] = store(deltaHash, kindCode(slot, true), keyframe, deltaBlob)
      continue
    }
    const full = storeFull(slot, value, hash, keyframe.base ?? keyframe)
    if (deltaBlob.data.length ** 2 <= 2 * growth * full.size) {
      refs[slot] = store(deltaHash, kindCode(slot, true), keyframe, deltaBlob)
    } else {
      refs[slot] = store(hash, kindCode(slot, false), full.base, full.blob)
    }
  }

  return {
    blobs,
    refs,
    storedSize: blobs.reduce((sum, blob) => sum + blob.data.length, 0),
    playerVars,
  }
}
