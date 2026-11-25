/**
 * Building a zip of Leyline files (GOOD + `gi_*`) from a decoded bundle. Pure
 * (no DOM, no fetch): the export worker drives it, and it can be exercised
 * from Node.
 *
 * Snapshots are decoded and deflated one at a time and the archive leaves as
 * a stream of chunks, so memory holds one file plus the compressed output,
 * never the ~1 MB-per-snapshot JSON of the whole selection.
 */

import { Zip, ZipDeflate } from 'fflate'
import {
  asLeyline,
  decodeSnapshot,
  leylineFileStem,
  storedSnapshotOf,
  type ArtifactIdentity,
  type BundleSnapshot,
  type Good,
  type KeyDictionary,
  type RollsText,
} from '@gdt/shared'

/** "leyline-2026-06-20T14-05-43": the server's name for a download, minus `.json`. */
export function goodFileStem(takenAt: number): string {
  return leylineFileStem(takenAt)
}

export function goodFileName(takenAt: number): string {
  return `${goodFileStem(takenAt)}.json`
}

/**
 * A file name per snapshot, unique within one archive. Names have one-second
 * resolution, so captures that share a second all get their id appended
 * (`…T14-05-43_151.json`); every other name matches the single-file download.
 */
export function zipEntryNames(
  snapshots: readonly Pick<BundleSnapshot, 'id' | 'takenAt'>[],
): Map<number, string> {
  const stems = new Map<number, string>()
  const uses = new Map<string, number>()
  for (const { id, takenAt } of snapshots) {
    const stem = goodFileStem(takenAt)
    stems.set(id, stem)
    uses.set(stem, (uses.get(stem) ?? 0) + 1)
  }
  const names = new Map<number, string>()
  for (const [id, stem] of stems) {
    names.set(id, uses.get(stem)! > 1 ? `${stem}_${id}.json` : `${stem}.json`)
  }
  return names
}

/**
 * Rebuilds one snapshot's Leyline file (`leyline` set) from decoded bundle
 * sections. `rolls` = what the catalog knows of each id's rolls
 * (`catalogRolls`): its artifacts carry `gi_rolls` exactly where the
 * server's GOOD export gives them.
 */
export function decodeFromSections(
  snapshot: BundleSnapshot,
  texts: ReadonlyMap<string, string>,
  catalog: ReadonlyMap<number, ArtifactIdentity>,
  materials: KeyDictionary,
  rolls?: ReadonlyMap<number, RollsText>,
): Good & { leyline: number } {
  const text = (hash: string) => {
    const value = texts.get(hash)
    if (value === undefined) throw new Error(`Snapshot ${snapshot.id} is missing section ${hash}`)
    return value
  }
  return asLeyline(decodeSnapshot(storedSnapshotOf(snapshot, text), catalog, materials, rolls))
}

export interface ZipProgress {
  /** Snapshots decoded and added to the archive. */
  done: number
  total: number
  /** GOOD JSON produced so far (what the files hold once unzipped). */
  jsonBytes: number
  /** Archive bytes emitted so far. */
  zipBytes: number
}

export interface GoodZipOptions {
  snapshots: readonly BundleSnapshot[]
  decode: (snapshot: BundleSnapshot) => Good
  /** Receives the archive in order; chunks are not reused after the call. */
  onChunk: (chunk: Uint8Array) => void
  onProgress?: (progress: ZipProgress) => void
  /** DEFLATE level, 0-9. */
  level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
  /** More files after the snapshots (live sync's `live/` folder). */
  extra?: readonly { name: string; text: string; mtime?: number }[]
}

// DOS timestamps in a zip cover 1980-2099; outside that fflate throws.
const DOS_MIN = Date.UTC(1980, 0, 2)
const DOS_MAX = Date.UTC(2099, 11, 30)

/** Writes one GOOD file per snapshot into a zip, streaming. Returns the totals. */
export function writeGoodZip(options: GoodZipOptions): ZipProgress {
  const { snapshots, decode, onChunk, onProgress, level = 6, extra = [] } = options
  const progress: ZipProgress = { done: 0, total: snapshots.length, jsonBytes: 0, zipBytes: 0 }
  const names = zipEntryNames(snapshots)
  const encoder = new TextEncoder()
  // fflate reports through the callback; checked after each synchronous step.
  const state: { failure: Error | null; finished: boolean } = { failure: null, finished: false }

  const zip = new Zip((error, chunk, final) => {
    if (error) {
      state.failure = error
      return
    }
    progress.zipBytes += chunk.length
    onChunk(chunk)
    if (final) state.finished = true
  })

  for (const snapshot of snapshots) {
    const bytes = encoder.encode(JSON.stringify(decode(snapshot)))
    const file = new ZipDeflate(names.get(snapshot.id)!, { level })
    if (snapshot.takenAt >= DOS_MIN && snapshot.takenAt <= DOS_MAX) file.mtime = snapshot.takenAt
    zip.add(file)
    file.push(bytes, true)
    if (state.failure) throw state.failure
    progress.done++
    progress.jsonBytes += bytes.length
    onProgress?.({ ...progress })
  }
  for (const entry of extra) {
    const file = new ZipDeflate(entry.name, { level })
    if (entry.mtime !== undefined && entry.mtime >= DOS_MIN && entry.mtime <= DOS_MAX) {
      file.mtime = entry.mtime
    }
    zip.add(file)
    file.push(encoder.encode(entry.text), true)
    if (state.failure) throw state.failure
  }
  zip.end()
  if (state.failure) throw state.failure
  if (!state.finished) throw new Error('The zip did not finish')
  return progress
}
