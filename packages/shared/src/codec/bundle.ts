/**
 * The export bundle: snapshot metadata plus the stored sections they use,
 * sent exactly as stored so the server does no decoding at all. The browser
 * decodes and rebuilds GOOD files itself.
 *
 * Two layouts (little-endian), told apart by their first four bytes:
 *
 *   "GDT1" | u32 manifest length | manifest JSON (UTF-8)
 *   then, for each hash in manifest.blobs in order: u32 length | bytes
 *   Every blob is a v1 section: deflated canonical JSON.
 *
 *   "GDT2" | u32 manifest length | manifest JSON | blobs as in GDT1
 *   manifest.blobs lists each blob as a v1 hash (a string; the bytes are
 *   LEGACY_FORMAT then the v1 blob) or as [id, kind code, base id or null]
 *   (a v2 section blob, see section-blob.ts). A snapshot names a v2 blob by
 *   its id (a number) and a v1 blob by its hash, and carries the per-login
 *   player values (`playerVars`) its v2 player section leaves out.
 *
 * The app asks for GDT2 (`?format=2`); a build from before it asks for
 * nothing and gets GDT1, which the server then builds by decoding v2
 * sections into the v1 form (the Worker's buildBundle, through SectionTexts
 * and deflateRaw). Either way, `decodeBundle` gives
 * the snapshots in the v1 shape: keys are strings (`#<id>` for v2 blobs, a
 * player section with its per-login values under a key of its own), and each
 * key's text is the section's canonical JSON, a delta's `b` naming its
 * base's key. Code that reads sections never sees the difference.
 */

import { inflateRaw } from './compress'
import { CorruptDataError } from './bytes'
import { inflate } from './deflate'
import { LEGACY_FORMAT } from './section-blob'
import { mergePlayer, type PlayerVars } from './snapshot-meta'
import type { GiPlayer } from '../good'
import { BlobDecoder, blobKey, type RawBlob } from './store-v2'
import type { StoredSnapshot } from './snapshot'

export interface BundleSnapshot {
  id: number
  takenAt: number
  lastSeenAt: number
  format: string
  version: number
  source: string
  characters: string
  weapons: string
  artifacts: string
  materials: string
  materialsKeyframe: string
  achievements: string | null
  // irminsul's extra sections (null when the snapshot has none). Optional:
  // a bundle cached before they existed lacks them.
  player?: string | null
  achievementTimes?: string | null
  characterExtras?: string | null
  anecdotes?: string | null
  tasks?: string | null
  collections?: string | null
  collections2?: string | null
  wardrobe?: string | null
  exploration?: string | null
  progress?: string | null
  extras?: string | null
  // The full sections `artifacts` and `achievementTimes` are deltas of; null
  // when they are stored in full (and absent from bundles written before
  // they could be deltas).
  artifactsBase?: string | null
  achievementTimesBase?: string | null
}

export interface BundleManifest {
  snapshots: BundleSnapshot[]
  /** Hashes of the blobs that follow, in order. */
  blobs: string[]
}

/** A section reference in a GDT2 manifest: a v2 blob id or a v1 hash. */
export type BundleKey = number | string

export interface BundleSnapshotV2 {
  id: number
  takenAt: number
  lastSeenAt: number
  format: string
  version: number
  source: string
  characters: BundleKey
  weapons: BundleKey
  artifacts: BundleKey
  artifactsBase: BundleKey | null
  materials: BundleKey
  materialsKeyframe: BundleKey
  achievements: BundleKey | null
  player: BundleKey | null
  achievementTimes: BundleKey | null
  achievementTimesBase: BundleKey | null
  characterExtras: BundleKey | null
  /** Absent from manifests written before anecdotes were kept. */
  anecdotes?: BundleKey | null
  /** Absent from manifests written before tasks were kept. */
  tasks?: BundleKey | null
  /** Absent from manifests written before collections were kept. */
  collections?: BundleKey | null
  /** Absent from manifests written before Capture 1.4.0's collections were kept. */
  collections2?: BundleKey | null
  /** Absent from manifests written before the wardrobe was kept. */
  wardrobe?: BundleKey | null
  /** Absent from manifests written before the exploration was kept. */
  exploration?: BundleKey | null
  /** Absent from manifests written before Capture 1.7.0's progress was kept. */
  progress?: BundleKey | null
  /** Absent from manifests written before Capture 1.8.0's extras were kept. */
  extras?: BundleKey | null
  /** The player values a v2 player section leaves out (absent: none). */
  playerVars?: PlayerVars
}

/** A v1 blob by hash, or a v2 blob as [id, kind code, base id]. */
export type BundleBlobV2 = string | [number, number, number | null]

export interface BundleManifestV2 {
  snapshots: BundleSnapshotV2[]
  blobs: BundleBlobV2[]
}

const MAGIC_V1 = [0x47, 0x44, 0x54, 0x31] // "GDT1"
const MAGIC_V2 = [0x47, 0x44, 0x54, 0x32] // "GDT2"

function write(
  magic: readonly number[],
  manifest: unknown,
  parts: readonly Uint8Array[],
): Uint8Array<ArrayBuffer> {
  const header = new TextEncoder().encode(JSON.stringify(manifest))
  const size = 8 + header.length + parts.reduce((sum, p) => sum + 4 + p.length, 0)
  const out = new Uint8Array(size)
  const view = new DataView(out.buffer)
  out.set(magic, 0)
  view.setUint32(4, header.length, true)
  out.set(header, 8)
  let offset = 8 + header.length
  for (const part of parts) {
    view.setUint32(offset, part.length, true)
    out.set(part, offset + 4)
    offset += 4 + part.length
  }
  return out
}

function read(bytes: Uint8Array): { magic: 1 | 2; manifest: unknown; parts: Uint8Array[] } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const magic = MAGIC_V1.every((b, i) => bytes[i] === b)
    ? 1
    : MAGIC_V2.every((b, i) => bytes[i] === b)
      ? 2
      : null
  if (magic === null) throw new Error('Not a GDT bundle')
  const headerLength = view.getUint32(4, true)
  const manifest = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + headerLength))) as {
    blobs: unknown[]
  }
  const parts: Uint8Array[] = []
  let offset = 8 + headerLength
  for (let i = 0; i < manifest.blobs.length; i++) {
    if (offset + 4 > bytes.length) throw new CorruptDataError('Bundle ends early')
    const length = view.getUint32(offset, true)
    if (offset + 4 + length > bytes.length) throw new CorruptDataError('Bundle ends early')
    parts.push(bytes.subarray(offset + 4, offset + 4 + length))
    offset += 4 + length
  }
  return { magic, manifest, parts }
}

/**
 * A GDT2 bundle as stored: its manifest's snapshots and every blob's stored
 * bytes, nothing inflated (the Snapshots page's raw download for developers).
 * `legacy` are v1 blobs by hash, each with LEGACY_FORMAT in front.
 */
export function readBundleV2Raw(buffer: ArrayBuffer | Uint8Array): {
  snapshots: BundleSnapshotV2[]
  blobs: RawBlob[]
  legacy: Map<string, Uint8Array>
} {
  const { magic, manifest, parts } = read(asBytes(buffer))
  if (magic !== 2) throw new Error('Not a GDT2 bundle')
  const v2 = manifest as BundleManifestV2
  const blobs: RawBlob[] = []
  const legacy = new Map<string, Uint8Array>()
  v2.blobs.forEach((entry, i) => {
    if (typeof entry === 'string') legacy.set(entry, parts[i]!)
    else blobs.push({ id: entry[0], code: entry[1], baseId: entry[2], data: parts[i]! })
  })
  return { snapshots: v2.snapshots, blobs, legacy }
}

const asBytes = (buffer: ArrayBuffer | Uint8Array) =>
  buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)

export function writeBundle(
  manifest: BundleManifest,
  blobs: ReadonlyMap<string, Uint8Array>,
): Uint8Array<ArrayBuffer> {
  return write(
    MAGIC_V1,
    manifest,
    manifest.blobs.map((hash) => {
      const data = blobs.get(hash)
      if (!data) throw new Error(`Bundle is missing blob ${hash}`)
      return data
    }),
  )
}

/** A GDT1 bundle as sent; see decodeBundle for one of either layout. */
export function readBundle(buffer: ArrayBuffer | Uint8Array): {
  manifest: BundleManifest
  blobs: Map<string, Uint8Array>
} {
  const { magic, manifest, parts } = read(asBytes(buffer))
  if (magic !== 1) throw new Error('Not a GDT1 bundle')
  const v1 = manifest as BundleManifest
  return { manifest: v1, blobs: new Map(v1.blobs.map((hash, i) => [hash, parts[i]!])) }
}

export function writeBundleV2(
  snapshots: readonly BundleSnapshotV2[],
  sections: {
    /** v1 blobs (deflated JSON) by hash, as the `blobs` table holds them. */
    legacy?: readonly { hash: string; data: Uint8Array }[]
    /** v2 section blobs, bases included. */
    blobs?: readonly RawBlob[]
  },
): Uint8Array<ArrayBuffer> {
  const entries: BundleBlobV2[] = []
  const parts: Uint8Array[] = []
  for (const { hash, data } of sections.legacy ?? []) {
    entries.push(hash)
    const tagged = new Uint8Array(data.length + 1)
    tagged[0] = LEGACY_FORMAT
    tagged.set(data, 1)
    parts.push(tagged)
  }
  for (const blob of sections.blobs ?? []) {
    entries.push([blob.id, blob.code, blob.baseId])
    parts.push(blob.data)
  }
  return write(
    MAGIC_V2,
    { snapshots: [...snapshots], blobs: entries } satisfies BundleManifestV2,
    parts,
  )
}

/** The key under which a snapshot's player section and per-login values decode. */
function playerKey(key: string, vars: PlayerVars | undefined): string {
  if (!vars || (vars.resin === undefined && vars.arExp === undefined)) return key
  return `${key}+${vars.resin ?? ''}+${vars.arExp ?? ''}`
}

const keyOf = (key: BundleKey): string => (typeof key === 'number' ? blobKey(key) : key)
const optionalKey = (key: BundleKey | null | undefined) =>
  key === null || key === undefined ? null : keyOf(key)

/** A GDT2 snapshot entry in the v1 shape, plus how to build its player text. */
export function v1SnapshotOf(snapshot: BundleSnapshotV2): {
  snapshot: BundleSnapshot
  /** Player key -> [stable section key, values], when the player text is derived. */
  player: [string, string, PlayerVars] | null
} {
  const player = optionalKey(snapshot.player)
  const merged = player === null ? null : playerKey(player, snapshot.playerVars)
  return {
    snapshot: {
      id: snapshot.id,
      takenAt: snapshot.takenAt,
      lastSeenAt: snapshot.lastSeenAt,
      format: snapshot.format,
      version: snapshot.version,
      source: snapshot.source,
      characters: keyOf(snapshot.characters),
      weapons: keyOf(snapshot.weapons),
      artifacts: keyOf(snapshot.artifacts),
      artifactsBase: optionalKey(snapshot.artifactsBase),
      materials: keyOf(snapshot.materials),
      materialsKeyframe: keyOf(snapshot.materialsKeyframe),
      achievements: optionalKey(snapshot.achievements),
      player: merged,
      achievementTimes: optionalKey(snapshot.achievementTimes),
      achievementTimesBase: optionalKey(snapshot.achievementTimesBase),
      characterExtras: optionalKey(snapshot.characterExtras),
      anecdotes: optionalKey(snapshot.anecdotes),
      tasks: optionalKey(snapshot.tasks),
      collections: optionalKey(snapshot.collections),
      collections2: optionalKey(snapshot.collections2),
      wardrobe: optionalKey(snapshot.wardrobe),
      exploration: optionalKey(snapshot.exploration),
      progress: optionalKey(snapshot.progress),
      extras: optionalKey(snapshot.extras),
    },
    player:
      merged !== null && merged !== player ? [merged, player!, snapshot.playerVars ?? {}] : null,
  }
}

/**
 * Section texts by key, decoded on demand, each once. `v1` blobs are deflated
 * JSON (GDT1, or GDT2's legacy entries); `v2` ones decode with their bases.
 */
export class SectionTexts {
  private readonly texts = new Map<string, string>()
  private readonly decoder: BlobDecoder
  private readonly players = new Map<string, [string, PlayerVars]>()

  constructor(
    private readonly v1: ReadonlyMap<string, Uint8Array>,
    private readonly v2: ReadonlyMap<number, RawBlob>,
    /** v1 blobs are given without LEGACY_FORMAT in front (GDT1) or with it (GDT2). */
    private readonly tagged: boolean,
  ) {
    this.decoder = new BlobDecoder((id) => v2.get(id))
  }

  /** Registers a player key whose text is a v2 player section merged with per-login values. */
  derivePlayer(key: string, stable: string, vars: PlayerVars): void {
    this.players.set(key, [stable, vars])
  }

  /** True when the bundle carries this section (a bundle of some sections lacks the rest). */
  has(key: string): boolean {
    if (this.texts.has(key) || this.v1.has(key)) return true
    const derived = this.players.get(key)
    if (derived) return this.has(derived[0])
    const id = key.startsWith('#') ? this.v2Id(key) : null
    return id !== null && this.v2.has(id)
  }

  private v2Id(key: string): number | null {
    const id = Number(key.slice(1))
    return Number.isSafeInteger(id) ? id : null
  }

  /** The section's canonical JSON; throws when the bundle lacks it. */
  async text(key: string): Promise<string> {
    const cached = this.texts.get(key)
    if (cached !== undefined) return cached
    let text: string
    const derived = this.players.get(key)
    if (derived) {
      const stable = JSON.parse(await this.text(derived[0])) as GiPlayer
      text = JSON.stringify(mergePlayer(stable, derived[1]))
    } else if (this.v1.has(key)) {
      const data = this.v1.get(key)!
      if (this.tagged) {
        if (data[0] !== LEGACY_FORMAT) throw new CorruptDataError(`Unknown v1 blob format`)
        text = new TextDecoder().decode(inflate(data.subarray(1)))
      } else text = await inflateRaw(data)
    } else if (key.startsWith('#')) {
      const id = this.v2Id(key)
      if (id === null) throw new Error(`Bundle is missing section ${key}`)
      text = this.decoder.text(id)
    } else throw new Error(`Bundle is missing section ${key}`)
    this.texts.set(key, text)
    return text
  }

  /** Texts of `keys` (each once), as a map. */
  async many(keys: Iterable<string>): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    for (const key of keys) if (!out.has(key)) out.set(key, await this.text(key))
    return out
  }
}

export interface OpenedBundle {
  /** Snapshots in the v1 shape, keys as strings. */
  snapshots: BundleSnapshot[]
  sections: SectionTexts
}

/** Reads a GDT1 or GDT2 bundle; sections decode on demand (see SectionTexts). */
export function openBundle(buffer: ArrayBuffer | Uint8Array): OpenedBundle {
  const { magic, manifest, parts } = read(asBytes(buffer))
  if (magic === 1) {
    const v1 = manifest as BundleManifest
    return {
      snapshots: v1.snapshots,
      sections: new SectionTexts(
        new Map(v1.blobs.map((hash, i) => [hash, parts[i]!])),
        new Map(),
        false,
      ),
    }
  }
  const v2 = manifest as BundleManifestV2
  const legacy = new Map<string, Uint8Array>()
  const blobs = new Map<number, RawBlob>()
  v2.blobs.forEach((entry, i) => {
    if (typeof entry === 'string') legacy.set(entry, parts[i]!)
    else blobs.set(entry[0], { id: entry[0], code: entry[1], baseId: entry[2], data: parts[i]! })
  })
  const sections = new SectionTexts(legacy, blobs, true)
  const snapshots = v2.snapshots.map((entry) => {
    const { snapshot, player } = v1SnapshotOf(entry)
    if (player) sections.derivePlayer(...player)
    return snapshot
  })
  return { snapshots, sections }
}

/**
 * Every section of every snapshot (bases included), decoded: what code that
 * walks a whole bundle wants.
 */
export async function decodeBundle(
  buffer: ArrayBuffer | Uint8Array,
): Promise<{ snapshots: BundleSnapshot[]; texts: Map<string, string> }> {
  const { snapshots, sections } = openBundle(buffer)
  const keys = new Set(snapshots.flatMap(sectionHashesOf))
  return { snapshots, texts: await sections.many([...keys].filter((key) => sections.has(key))) }
}

/**
 * One bundle entry as `decodeSnapshot` takes it. `text` returns a section's
 * inflated JSON by hash (and throws when the bundle lacks it); only the
 * sections the snapshot has are asked for.
 */
export function storedSnapshotOf(
  snapshot: BundleSnapshot,
  text: (hash: string) => string,
): StoredSnapshot {
  const optional = (hash: string | null | undefined) => (hash ? text(hash) : null)
  return {
    format: snapshot.format,
    version: snapshot.version,
    source: snapshot.source,
    takenAt: snapshot.takenAt,
    characters: text(snapshot.characters),
    weapons: text(snapshot.weapons),
    artifacts: text(snapshot.artifacts),
    artifactsBase: optional(snapshot.artifactsBase),
    materials: text(snapshot.materials),
    materialsKeyframe:
      snapshot.materialsKeyframe === snapshot.materials ? null : text(snapshot.materialsKeyframe),
    achievements: optional(snapshot.achievements),
    player: optional(snapshot.player),
    achievementTimes: optional(snapshot.achievementTimes),
    achievementTimesBase: optional(snapshot.achievementTimesBase),
    characterExtras: optional(snapshot.characterExtras),
    anecdotes: optional(snapshot.anecdotes),
    tasks: optional(snapshot.tasks),
    collections: optional(snapshot.collections),
    collections2: optional(snapshot.collections2),
    wardrobe: optional(snapshot.wardrobe),
    exploration: optional(snapshot.exploration),
    progress: optional(snapshot.progress),
    extras: optional(snapshot.extras),
  }
}

/**
 * Every section hash a full decode of `snapshot` reads (bases included), for
 * callers that inflate only what a selection of snapshots needs.
 */
export function sectionHashesOf(snapshot: BundleSnapshot): string[] {
  return [
    snapshot.characters,
    snapshot.weapons,
    snapshot.artifacts,
    snapshot.artifactsBase,
    snapshot.materials,
    snapshot.materialsKeyframe,
    snapshot.achievements,
    snapshot.player,
    snapshot.achievementTimes,
    snapshot.achievementTimesBase,
    snapshot.characterExtras,
    snapshot.anecdotes,
    snapshot.tasks,
    snapshot.collections,
    snapshot.collections2,
    snapshot.wardrobe,
    snapshot.exploration,
    snapshot.progress,
    snapshot.extras,
  ].filter((hash): hash is string => !!hash)
}

/** Inflates every blob once; snapshots sharing a section share the text. */
export async function inflateBundle(blobs: ReadonlyMap<string, Uint8Array>) {
  const texts = new Map<string, string>()
  await Promise.all([...blobs].map(async ([hash, data]) => texts.set(hash, await inflateRaw(data))))
  return texts
}
