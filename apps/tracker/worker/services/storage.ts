/**
 * What the Worker needs to read snapshot rows in either storage format: v1
 * (sections by hex hash in `blobs`, summary JSON) and v2 (sections by id in
 * `section_blobs`, `meta`). A row is v2 when `characters_ref` is set.
 */

import {
  SLOTS,
  decodeSnapshotMeta,
  type SnapshotMeta,
  type SnapshotSummary,
  type Slot,
} from '@gdt/shared'

// ------------------------------------------------- the v1 columns' lifetime
// Once repack has converted everything, a later migration drops the v1
// columns and the `blobs` table. Every query that names them is built for
// both schemas: it runs with them until the database says they are gone,
// then without them for the rest of the isolate's life. So that migration
// can ship on its own, with this code already running.

// Migration 0017 dropped them (2026-10-07): start without them, so a cold
// isolate no longer spends a failed round trip finding that out. A database
// that still had them would only be read without its v1 rows.
let legacySchema = false

/** True when `error` (or its cause) says a column or table does not exist. */
export function isMissingSchema(error: unknown): boolean {
  for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause) {
    const message = e instanceof Error ? e.message : String(e)
    if (/no such column|has no column named|no such table/.test(message)) return true
  }
  return false
}

/**
 * Runs `run` with the v1 columns (while the schema has them), or without
 * them once a run has found them gone.
 */
export async function withLegacySchema<T>(run: (legacy: boolean) => Promise<T>): Promise<T> {
  if (!legacySchema) return run(false)
  try {
    return await run(true)
  } catch (error) {
    if (!isMissingSchema(error)) throw error
    legacySchema = false
    return run(false)
  }
}

/** BLOB column bytes, whatever shape the driver hands back. */
export function toBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data
  if (Array.isArray(data)) return Uint8Array.from(data as number[])
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  throw new Error('Not a BLOB value')
}

/** `snapshots` columns of the sixteen v2 section slots. */
export const REF_COLUMNS: Readonly<Record<Slot, string>> = {
  characters: 'characters_ref',
  weapons: 'weapons_ref',
  artifacts: 'artifacts_ref',
  materials: 'materials_ref',
  achievements: 'achievements_ref',
  player: 'player_ref',
  achievementTimes: 'achievement_times_ref',
  characterExtras: 'character_extras_ref',
  anecdotes: 'anecdotes_ref',
  tasks: 'tasks_ref',
  collections: 'collections_ref',
  collections2: 'collections2_ref',
  wardrobe: 'wardrobe_ref',
  exploration: 'exploration_ref',
  progress: 'progress_ref',
  extras: 'extras_ref',
}
export const REFS_SQL = SLOTS.map((slot) => REF_COLUMNS[slot]).join(', ')

/** The v1 section hash columns. */
export const V1_HASH_COLUMNS = `characters_hash, weapons_hash, artifacts_hash, materials_hash,
  materials_keyframe_hash, achievements_hash, player_hash, achievement_times_hash,
  character_extras_hash, artifacts_base_hash, achievement_times_base_hash`

/** Everything a reader of either format selects (only v2's once v1 is dropped). */
export function rowColumns(legacy: boolean): string {
  return legacy
    ? `id, taken_at, last_seen_at, format, version, source, ${V1_HASH_COLUMNS},
      content_key, ${REFS_SQL}, meta`
    : `id, taken_at, last_seen_at, content_key, ${REFS_SQL}, meta`
}

/** A snapshot row as `rowColumns` reads it; the v1 fields are absent once v1 is dropped. */
export interface StoredRow {
  id: number
  taken_at: number
  last_seen_at: number
  format?: string
  version?: number
  source?: string
  characters_hash?: string
  weapons_hash?: string
  artifacts_hash?: string
  materials_hash?: string
  materials_keyframe_hash?: string
  achievements_hash?: string | null
  player_hash?: string | null
  achievement_times_hash?: string | null
  character_extras_hash?: string | null
  artifacts_base_hash?: string | null
  achievement_times_base_hash?: string | null
  content_key: number | null
  characters_ref: number | null
  weapons_ref: number | null
  artifacts_ref: number | null
  materials_ref: number | null
  achievements_ref: number | null
  player_ref: number | null
  achievement_times_ref: number | null
  character_extras_ref: number | null
  anecdotes_ref: number | null
  tasks_ref: number | null
  collections_ref: number | null
  collections2_ref: number | null
  wardrobe_ref: number | null
  exploration_ref: number | null
  progress_ref: number | null
  extras_ref: number | null
  meta: unknown
}

/** A v1 row: its v1 columns are there (a row is only ever v1 while the schema has them). */
export type V1StoredRow = StoredRow &
  Required<
    Pick<
      StoredRow,
      | 'format'
      | 'version'
      | 'source'
      | 'characters_hash'
      | 'weapons_hash'
      | 'artifacts_hash'
      | 'materials_hash'
      | 'materials_keyframe_hash'
      | 'achievements_hash'
      | 'player_hash'
      | 'achievement_times_hash'
      | 'character_extras_hash'
      | 'artifacts_base_hash'
      | 'achievement_times_base_hash'
    >
  >

export function isV2(row: { characters_ref?: unknown }): boolean {
  return row.characters_ref !== null && row.characters_ref !== undefined
}

export function refOf(row: StoredRow, slot: Slot): number | null {
  return (row[REF_COLUMNS[slot] as keyof StoredRow] as number | null) ?? null
}

/** A v2 row's meta, or a v1 row's columns in the same shape. */
export function metaOf(row: {
  format?: string
  version?: number
  source?: string
  summary?: unknown
  meta?: unknown
}): SnapshotMeta {
  if (row.meta !== null && row.meta !== undefined) return decodeSnapshotMeta(toBytes(row.meta))
  return {
    format: row.format ?? 'GOOD',
    version: row.version ?? 0,
    source: row.source ?? '',
    summary: JSON.parse(row.summary as string) as SnapshotSummary,
    playerVars: {},
  }
}
