/**
 * The raw download's script (bundled into the zip's `inflate.mjs` by
 * build/script-bundle.ts, with the site's own decoder inside it, so it needs
 * no packages): reads the stored sections and catalog chunks the zip holds and
 * writes them out as readable JSON.
 *
 *   inflated/snapshots/leyline-<time>.json  each snapshot as a Leyline file:
 *                                           what the site's Download gives,
 *                                           indented
 *   inflated/sections/<id>.json             each stored section decoded (a
 *                                           delta holds only its changes)
 *   inflated/catalog.json                   every artifact identity by id
 *
 * Pure apart from `io`: the raw-export test runs it on a zip the Worker made.
 */

import {
  asLeyline,
  blobKey,
  decodeCatalogChunk,
  decodeSnapshot,
  kindCode,
  openBundle,
  sectionHashesOf,
  storedSnapshotOf,
  writeBundleV2,
  type ArtifactIdentity,
  type BundleSnapshotV2,
  type CatalogRow,
  type GoodSubstat,
  type RawBlob,
  type SectionKind,
} from '@gdt/shared'
import { MATERIALS } from '@gdt/shared/dictionary/materials'
import { zipEntryNames } from '../export-zip'

export interface InflateIo {
  read(path: string): Uint8Array
  write(path: string, bytes: Uint8Array): void
}

export interface Inflated {
  snapshots: number
  sections: number
  artifacts: number
  /** Stored bytes read (sections + catalog chunks). */
  bytesIn: number
  /** JSON bytes written. */
  bytesOut: number
}

/** One entry of the zip's sections.json. */
interface SectionEntry {
  id: number | string
  kind: SectionKind | 'v1'
  delta: boolean
  base: number | null
  file: string
  bytes: number
}

const encoder = new TextEncoder()

/** Lines up to this long stay on one line. */
const WIDTH = 100

const entriesOf = (value: object) => Object.entries(value).filter(([, v]) => v !== undefined)

/** One line, spaced like Prettier: `{"auto": 6, "skill": 7}`, `[1, 90, 6]`. */
function inline(value: unknown): string {
  if (value === null || value === undefined || typeof value !== 'object') {
    return JSON.stringify(value ?? null)
  }
  if (Array.isArray(value)) return `[${value.map(inline).join(', ')}]`
  return `{${entriesOf(value)
    .map(([k, v]) => `${JSON.stringify(k)}: ${inline(v)}`)
    .join(', ')}}`
}

/**
 * JSON indented two spaces, but an array or object whose line fits in WIDTH
 * (indent and key included) stays on one line, like Prettier: a character
 * row is one line, not twenty. Fully indented, one capture history came to
 * 1.7 GB. Parses back to the same value. `lead` is what precedes the value
 * on its line (indent + key).
 */
export function formatJson(value: unknown, indent = '', lead = indent.length): string {
  const flat = inline(value)
  if (value === null || typeof value !== 'object' || lead + flat.length + 1 <= WIDTH) return flat
  const inner = `${indent}  `
  if (Array.isArray(value)) {
    return `[\n${value.map((v) => inner + formatJson(v, inner)).join(',\n')}\n${indent}]`
  }
  return `{\n${entriesOf(value)
    .map(([k, v]) => {
      const key = `${inner}${JSON.stringify(k)}: `
      return key + formatJson(v, inner, key.length)
    })
    .join(',\n')}\n${indent}}`
}

const pretty = (value: unknown) => encoder.encode(`${formatJson(value)}\n`)

const substats = (list: CatalogRow[6]): GoodSubstat[] =>
  list.map(([key, value, initialValue]) =>
    initialValue === undefined ? { key, value } : { key, value, initialValue },
  )

/** A CatalogRow (the catalog's `pending` identities) as an identity. */
function identityOfRow(row: CatalogRow): [number, ArtifactIdentity] {
  const [id, setKey, slotKey, level, rarity, mainStatKey, subs, totalRolls, elixir, unactivated] =
    row
  return [
    id,
    {
      setKey,
      slotKey,
      level,
      rarity,
      mainStatKey,
      substats: substats(subs),
      totalRolls,
      elixirCrafted: elixir === 1,
      unactivatedSubstats: substats(unactivated),
    },
  ]
}

export async function inflateAll(io: InflateIo): Promise<Inflated> {
  const json = <T>(path: string) => JSON.parse(new TextDecoder().decode(io.read(path))) as T
  const snapshots = json<BundleSnapshotV2[]>('snapshots.json')
  const entries = json<SectionEntry[]>('sections.json')
  const done: Inflated = { snapshots: 0, sections: 0, artifacts: 0, bytesIn: 0, bytesOut: 0 }
  const write = (path: string, bytes: Uint8Array) => {
    io.write(path, bytes)
    done.bytesOut += bytes.length
  }

  // The zip's blobs, back in a bundle: the same reader the site uses.
  const blobs: RawBlob[] = []
  const legacy: { hash: string; data: Uint8Array }[] = []
  for (const entry of entries) {
    const data = io.read(entry.file)
    done.bytesIn += data.length
    if (entry.kind === 'v1') {
      // Stored with its format byte in front; the bundle adds it again.
      legacy.push({ hash: String(entry.id), data: data.subarray(1) })
    } else {
      blobs.push({
        id: Number(entry.id),
        code: kindCode(entry.kind, entry.delta),
        baseId: entry.base,
        data,
      })
    }
  }
  const { snapshots: opened, sections } = openBundle(writeBundleV2(snapshots, { legacy, blobs }))

  for (const entry of entries) {
    const key = entry.kind === 'v1' ? String(entry.id) : blobKey(Number(entry.id))
    const name =
      entry.kind === 'v1' ? `v1-${String(entry.id).replace(/[^A-Za-z0-9]/g, '')}` : entry.id
    write(`inflated/sections/${name}.json`, pretty(JSON.parse(await sections.text(key))))
    done.sections++
  }

  const catalog = new Map<number, ArtifactIdentity>()
  const raw = json<{ chunks: { file: string }[]; pending: CatalogRow[] }>('catalog.json')
  for (const chunk of raw.chunks) {
    const data = io.read(chunk.file)
    done.bytesIn += data.length
    for (const { id, identity } of decodeCatalogChunk(data)) catalog.set(id, identity)
  }
  for (const row of raw.pending) catalog.set(...identityOfRow(row))
  const ids = [...catalog.keys()].sort((a, b) => a - b)
  write('inflated/catalog.json', pretty(ids.map((id) => ({ id, ...catalog.get(id)! }))))
  done.artifacts = ids.length

  // Each snapshot whole, named like the site's Download.
  const names = zipEntryNames(opened)
  for (const snapshot of opened) {
    const texts = new Map<string, string>()
    for (const key of sectionHashesOf(snapshot)) texts.set(key, await sections.text(key))
    const text = (key: string) => {
      const value = texts.get(key)
      if (value === undefined) throw new Error(`Snapshot ${snapshot.id} is missing section ${key}`)
      return value
    }
    const good = asLeyline(decodeSnapshot(storedSnapshotOf(snapshot, text), catalog, MATERIALS))
    write(`inflated/snapshots/${names.get(snapshot.id)}`, pretty(good))
    done.snapshots++
  }
  return done
}
