/**
 * The Snapshots page's "Raw download" for developers: the selected
 * snapshots' sections and the artifact catalog exactly as stored
 * (compressed, deduplicated), with `inflate.mjs`, a dependency-free Node
 * script that inflates them, and a README of the formats. Built in the
 * export worker from a GDT2 bundle and `catalog?raw=1`; nothing is decoded.
 */

import { Zip, ZipDeflate, ZipPassThrough } from 'fflate'
import { kindOfCode, readBundleV2Raw, type BundleSnapshotV2, type CatalogRow } from '@gdt/shared'
import readme from './raw-export/README.md?raw'
import script from './raw-export/inflate.mjs?raw'

/** `GET …/catalog?raw=1`. */
export interface RawCatalog {
  format: 1
  chunks: { first: number; last: number; count: number; data: string }[]
  pending: CatalogRow[]
}

export interface RawFile {
  name: string
  data: Uint8Array
  /** Already compressed (stored in the zip as is). */
  packed: boolean
}

const SNAPSHOT_REFS = [
  'characters',
  'weapons',
  'artifacts',
  'artifactsBase',
  'materials',
  'materialsKeyframe',
  'achievements',
  'player',
  'achievementTimes',
  'achievementTimesBase',
  'characterExtras',
  'anecdotes',
  'tasks',
  'collections',
  'collections2',
  'wardrobe',
  'exploration',
  'progress',
  'extras',
] as const satisfies readonly (keyof BundleSnapshotV2)[]

function fromBase64(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** A legacy (v1) blob's file-safe name. */
const legacyName = (hash: string) => `v1-${hash.replace(/[^A-Za-z0-9]/g, '')}`

/**
 * The zip's files: the snapshots of `ids` (null: all in the bundle), every
 * blob they need (their bases too, however deep), the catalog, the script
 * and the README. Pure.
 */
export function rawExportFiles(input: {
  bundle: Uint8Array
  catalog: RawCatalog
  ids: readonly number[] | null
}): RawFile[] {
  const { snapshots: all, blobs, legacy } = readBundleV2Raw(input.bundle)
  const wanted = input.ids ? new Set(input.ids) : null
  const snapshots = wanted ? all.filter((s) => wanted.has(s.id)) : all
  const byId = new Map(blobs.map((blob) => [blob.id, blob]))

  const needed = new Set<number>()
  const neededLegacy = new Set<string>()
  const need = (id: number) => {
    for (let at: number | null = id; at !== null && !needed.has(at); ) {
      needed.add(at)
      at = byId.get(at)?.baseId ?? null
    }
  }
  for (const snapshot of snapshots) {
    for (const field of SNAPSHOT_REFS) {
      const key = snapshot[field]
      if (typeof key === 'number') need(key)
      else if (typeof key === 'string') neededLegacy.add(key)
    }
  }

  const encoder = new TextEncoder()
  const json = (value: unknown) => encoder.encode(`${JSON.stringify(value, null, 1)}\n`)
  const files: RawFile[] = []
  const sections: unknown[] = []
  for (const blob of blobs) {
    if (!needed.has(blob.id)) continue
    const { kind, delta } = kindOfCode(blob.code)
    const file = `sections/${blob.id}.bin`
    sections.push({ id: blob.id, kind, delta, base: blob.baseId, file, bytes: blob.data.length })
    files.push({ name: file, data: blob.data, packed: true })
  }
  for (const [hash, data] of legacy) {
    if (!neededLegacy.has(hash)) continue
    const file = `sections/${legacyName(hash)}.bin`
    sections.push({ id: hash, kind: 'v1', delta: false, base: null, file, bytes: data.length })
    files.push({ name: file, data, packed: true })
  }

  const chunks = input.catalog.chunks.map((chunk) => {
    const file = `catalog/${chunk.first}-${chunk.last}.bin`
    files.push({ name: file, data: fromBase64(chunk.data), packed: true })
    return { first: chunk.first, last: chunk.last, count: chunk.count, file }
  })

  return [
    { name: 'README.md', data: encoder.encode(readme), packed: false },
    { name: 'inflate.mjs', data: encoder.encode(script), packed: false },
    { name: 'snapshots.json', data: json(snapshots), packed: false },
    { name: 'sections.json', data: json(sections), packed: false },
    { name: 'catalog.json', data: json({ chunks, pending: input.catalog.pending }), packed: false },
    ...files,
  ]
}

/** Streams `files` as a zip through `onChunk`; stored files pass through, the rest deflate. */
export function writeRawZip(
  files: readonly RawFile[],
  onChunk: (chunk: Uint8Array) => void,
): { files: number; zipBytes: number } {
  let zipBytes = 0
  const state: { failure: Error | null; finished: boolean } = { failure: null, finished: false }
  const zip = new Zip((error, chunk, final) => {
    if (error) {
      state.failure = error
      return
    }
    zipBytes += chunk.length
    onChunk(chunk)
    if (final) state.finished = true
  })
  for (const file of files) {
    const entry = file.packed
      ? new ZipPassThrough(file.name)
      : new ZipDeflate(file.name, { level: 6 })
    zip.add(entry)
    entry.push(file.data, true)
    if (state.failure) throw state.failure
  }
  zip.end()
  if (state.failure) throw state.failure
  if (!state.finished) throw new Error('The zip did not finish')
  return { files: files.length, zipBytes }
}
