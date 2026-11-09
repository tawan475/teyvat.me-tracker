/**
 * Reading snapshots back, in either storage format (see storage.ts). The
 * bundle path sends stored bytes untouched (the browser decodes); the GOOD
 * path decodes one snapshot server-side for tools that just want a file.
 */

import {
  BlobDecoder,
  KIND_DELTA,
  SECTION_KIND_CODES,
  isPlayerV2,
  isTasksV2,
  jsonSectionBlob,
  SectionTexts,
  artifactRows,
  asLeyline,
  decodeCatalogChunk,
  decodeSnapshot,
  deflateRaw,
  expandSubstats,
  leylineFileStem,
  storedSnapshotOf,
  v1SnapshotOf,
  writeBundle,
  writeBundleV2,
  type ArtifactIdentity,
  type BundleKey,
  type BundleSnapshot,
  type BundleSnapshotV2,
  type CatalogRow,
  type Good,
  type RawBlob,
  type Slot,
} from '@gdt/shared'
import { MATERIALS } from '@gdt/shared/dictionary/materials'
import { notFound } from '../lib/http'
import {
  isV2,
  metaOf,
  refOf,
  rowColumns,
  toBytes,
  withLegacySchema,
  type StoredRow,
  type V1StoredRow,
} from './storage'

export const SECTION_NAMES = [
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
] as const satisfies readonly Slot[]
export type SectionName = (typeof SECTION_NAMES)[number]

/**
 * Most snapshots one bundle request may cover; sections dedupe, so this is
 * still small. Past it the newest are kept (the oldest drop out).
 */
export const MAX_BUNDLE_SNAPSHOTS = 5000

/** Kind codes of the sections that have a second binary form (2026-11-09). */
const TASKS_CODE = SECTION_KIND_CODES.tasks
const PLAYER_CODE = SECTION_KIND_CODES.player

/**
 * For a build that asks GDT2 (cached from before 2026-11-09): every tasks
 * or player blob in its second binary form, and every blob compressed
 * against one, as a standalone JSON-layout blob, which every deployed build
 * reads (their decoders refuse the new forms). Same ids, no base. Only
 * blobs of those two kinds are inflated to look; the rest pass as stored.
 */
export function oldBuildBlobs(blobs: Map<number, RawBlob>): Map<number, RawBlob> {
  const kinds = [...blobs.values()].filter(
    (blob) => (blob.code & ~KIND_DELTA) === TASKS_CODE || (blob.code & ~KIND_DELTA) === PLAYER_CODE,
  )
  if (kinds.length === 0) return blobs
  const decoder = new BlobDecoder((id) => blobs.get(id))
  const replaced = new Set<number>()
  const newForm = (blob: RawBlob) => {
    const payload = decoder.decode(blob.id).payload
    // Binary layout (0x10), then the layout's own bytes.
    if ((payload[0]! & 0xf0) !== 0x10) return false
    const body = payload.subarray(1)
    return (blob.code & ~KIND_DELTA) === TASKS_CODE ? isTasksV2(body) : isPlayerV2(body)
  }
  // Roots first: a blob compressed against a replaced one is replaced too.
  for (const blob of [...kinds].sort(
    (a, b) => (a.baseId === null ? 0 : 1) - (b.baseId === null ? 0 : 1),
  )) {
    if (newForm(blob) || (blob.baseId !== null && replaced.has(blob.baseId))) replaced.add(blob.id)
  }
  if (replaced.size === 0) return blobs
  const out = new Map(blobs)
  for (const id of replaced) {
    const blob = blobs.get(id)!
    out.set(id, {
      id,
      code: blob.code,
      baseId: null,
      data: jsonSectionBlob(decoder.decode(id).value),
    })
  }
  return out
}

/** Slots stored as a delta of a keyframe: the manifest names the keyframe. */
const DELTA_SLOTS = [
  'artifacts',
  'materials',
  'achievementTimes',
] as const satisfies readonly Slot[]

/**
 * Bundle layout: 1 for apps from before v2 storage (asked for nothing), 2
 * when asked, 3 = GDT2 with its manifest deflated (the app from 2026-11-09).
 */
export type BundleFormat = 1 | 2 | 3

// ------------------------------------------------------------------ v1 rows

function toBundleSnapshotV1(row: V1StoredRow): BundleSnapshot {
  return {
    id: row.id,
    takenAt: row.taken_at,
    lastSeenAt: row.last_seen_at,
    format: row.format,
    version: row.version,
    source: row.source,
    characters: row.characters_hash,
    weapons: row.weapons_hash,
    artifacts: row.artifacts_hash,
    materials: row.materials_hash,
    materialsKeyframe: row.materials_keyframe_hash,
    achievements: row.achievements_hash,
    player: row.player_hash,
    achievementTimes: row.achievement_times_hash,
    characterExtras: row.character_extras_hash,
    artifactsBase: row.artifacts_base_hash,
    achievementTimesBase: row.achievement_times_base_hash,
  }
}

function v1Hashes(row: V1StoredRow, sections: ReadonlySet<SectionName>): string[] {
  const hashes: string[] = []
  if (sections.has('characters')) hashes.push(row.characters_hash)
  if (sections.has('weapons')) hashes.push(row.weapons_hash)
  if (sections.has('artifacts')) {
    hashes.push(row.artifacts_hash)
    if (row.artifacts_base_hash) hashes.push(row.artifacts_base_hash)
  }
  if (sections.has('materials')) hashes.push(row.materials_hash, row.materials_keyframe_hash)
  if (sections.has('achievements') && row.achievements_hash) hashes.push(row.achievements_hash)
  if (sections.has('player') && row.player_hash) hashes.push(row.player_hash)
  if (sections.has('achievementTimes') && row.achievement_times_hash) {
    hashes.push(row.achievement_times_hash)
    if (row.achievement_times_base_hash) hashes.push(row.achievement_times_base_hash)
  }
  if (sections.has('characterExtras') && row.character_extras_hash) {
    hashes.push(row.character_extras_hash)
  }
  return hashes
}

async function loadV1Blobs(d1: D1Database, accountId: number, hashes: string[]) {
  if (hashes.length === 0) return new Map<string, Uint8Array>()
  const { results } = await d1
    .prepare(
      `SELECT hash, data FROM blobs WHERE account_id = ?1
       AND hash IN (SELECT value FROM json_each(?2))`,
    )
    .bind(accountId, JSON.stringify(hashes))
    .all<{ hash: string; data: unknown }>()
  return new Map(results.map((row) => [row.hash, toBytes(row.data)]))
}

// ------------------------------------------------------------------ v2 rows

/** `?1` account, `?2` JSON ids: those blobs and every base they need, with data. */
export const V2_BLOBS_SQL = `WITH RECURSIVE need(id, depth) AS (
    SELECT value, 0 FROM json_each(?2)
    UNION SELECT b.base_id, n.depth + 1 FROM section_blobs AS b JOIN need AS n ON b.id = n.id
      WHERE b.base_id IS NOT NULL AND n.depth < 3)
  SELECT id, kind, base_id, data FROM section_blobs
  WHERE +account_id = ?1 AND id IN (SELECT id FROM need)`

/** `?1` account, `?2` JSON ids: those blobs' kind and base. */
export const V2_META_SQL = `SELECT id, kind, base_id FROM section_blobs WHERE +account_id = ?1
  AND id IN (SELECT value FROM json_each(?2))`

/** `?1` account, `?2` JSON ids, `?3` cap: those live snapshots by primary key, newest first. */
export const BUNDLE_IDS_SQL = (columns: string) => `SELECT ${columns} FROM snapshots
  WHERE id IN (SELECT value FROM json_each(?2)) AND +account_id = ?1
  AND deleted_at IS NULL ORDER BY taken_at DESC, id DESC LIMIT ?3`

/**
 * Blob rows (with data) of `ids` and every base they need. Every blob lookup
 * here names `+account_id`: the unary plus keeps SQLite off the
 * `(account_id, hash)` unique index, whose use read every blob of the
 * account (rows read grew with its history); by id it reads only the rows
 * asked for. The account check stays.
 */
async function loadV2Blobs(
  d1: D1Database,
  accountId: number,
  ids: number[],
): Promise<Map<number, RawBlob>> {
  if (ids.length === 0) return new Map()
  const { results } = await d1
    .prepare(V2_BLOBS_SQL)
    .bind(accountId, JSON.stringify(ids))
    .all<Record<string, unknown>>()
  return new Map(
    results.map((row) => [
      row.id as number,
      {
        id: row.id as number,
        code: row.kind as number,
        baseId: (row.base_id as number | null) ?? null,
        data: toBytes(row.data),
      },
    ]),
  )
}

/** Kind and base of blobs, without their data. */
async function loadV2Meta(
  d1: D1Database,
  accountId: number,
  ids: number[],
): Promise<Map<number, { code: number; baseId: number | null }>> {
  if (ids.length === 0) return new Map()
  const { results } = await d1
    .prepare(V2_META_SQL)
    .bind(accountId, JSON.stringify(ids))
    .all<Record<string, unknown>>()
  return new Map(
    results.map((row) => [
      row.id as number,
      { code: row.kind as number, baseId: (row.base_id as number | null) ?? null },
    ]),
  )
}

/** The base a delta-kind section is a delta of, or null when it is stored in full. */
function deltaBase(
  meta: ReadonlyMap<number, { code: number; baseId: number | null }>,
  id: number | null,
): number | null {
  if (id === null) return null
  const blob = meta.get(id)
  return blob && (blob.code & KIND_DELTA) !== 0 ? blob.baseId : null
}

function toBundleSnapshotV2(
  row: StoredRow,
  meta: ReadonlyMap<number, { code: number; baseId: number | null }>,
): BundleSnapshotV2 {
  const ref = (slot: Slot) => refOf(row, slot)
  const required = (slot: Slot): BundleKey => {
    const id = ref(slot)
    if (id === null) throw new Error(`Snapshot ${row.id} has no ${slot}`)
    return id
  }
  const { format, version, source, playerVars } = metaOf(row)
  return {
    id: row.id,
    takenAt: row.taken_at,
    lastSeenAt: row.last_seen_at,
    format,
    version,
    source,
    characters: required('characters'),
    weapons: required('weapons'),
    artifacts: required('artifacts'),
    artifactsBase: deltaBase(meta, ref('artifacts')),
    materials: required('materials'),
    materialsKeyframe: deltaBase(meta, ref('materials')) ?? required('materials'),
    achievements: ref('achievements'),
    player: ref('player'),
    achievementTimes: ref('achievementTimes'),
    achievementTimesBase: deltaBase(meta, ref('achievementTimes')),
    characterExtras: ref('characterExtras'),
    anecdotes: ref('anecdotes'),
    tasks: ref('tasks'),
    collections: ref('collections'),
    collections2: ref('collections2'),
    wardrobe: ref('wardrobe'),
    exploration: ref('exploration'),
    progress: ref('progress'),
    extras: ref('extras'),
    ...(playerVars.resin !== undefined || playerVars.arExp !== undefined ? { playerVars } : {}),
  }
}

// ------------------------------------------------------------------ bundles

/** Live snapshots (all, or `ids`) and the requested sections, as a bundle. */
export async function buildBundle(
  d1: D1Database,
  accountId: number,
  ids: number[] | null,
  sections: ReadonlySet<SectionName>,
  format: BundleFormat = 1,
): Promise<Uint8Array<ArrayBuffer>> {
  // Chosen ids are read by primary key (an `OR` with them read every row);
  // the whole history newest first, so a cap would leave out the oldest.
  const { results: newestFirst } = await withLegacySchema((legacy) =>
    (ids
      ? d1
          .prepare(BUNDLE_IDS_SQL(rowColumns(legacy)))
          .bind(accountId, JSON.stringify(ids), MAX_BUNDLE_SNAPSHOTS)
      : d1
          .prepare(
            `SELECT ${rowColumns(legacy)} FROM snapshots
             WHERE account_id = ?1 AND deleted_at IS NULL
             ORDER BY taken_at DESC, id DESC LIMIT ?2`,
          )
          .bind(accountId, MAX_BUNDLE_SNAPSHOTS)
    ).all<StoredRow>(),
  )
  const rows = newestFirst.reverse()

  const v1Rows = rows.filter((row) => !isV2(row)) as V1StoredRow[]
  const v2Rows = rows.filter(isV2)
  const hashes = [...new Set(v1Rows.flatMap((row) => v1Hashes(row, sections)))]
  const wanted = [
    ...new Set(
      v2Rows.flatMap((row) =>
        SECTION_NAMES.filter((slot) => sections.has(slot))
          .map((slot) => refOf(row, slot))
          .filter((id): id is number => id !== null),
      ),
    ),
  ]
  // The manifest names a delta's keyframe: only the three delta slots need
  // their blob's kind and base, and only those not fetched with data anyway.
  const wantedSet = new Set(wanted)
  const refs = [
    ...new Set(
      v2Rows.flatMap((row) =>
        DELTA_SLOTS.map((slot) => refOf(row, slot)).filter(
          (id): id is number => id !== null && !wantedSet.has(id),
        ),
      ),
    ),
  ]
  const [legacy, metaRest, blobs] = await Promise.all([
    loadV1Blobs(d1, accountId, hashes),
    loadV2Meta(d1, accountId, refs),
    loadV2Blobs(d1, accountId, wanted),
  ])
  const meta = new Map(metaRest)
  for (const blob of blobs.values()) meta.set(blob.id, { code: blob.code, baseId: blob.baseId })
  const entries = rows.map((row) =>
    isV2(row) ? toBundleSnapshotV2(row, meta) : toBundleSnapshotV1(row as V1StoredRow),
  )

  if (format === 2 || format === 3) {
    const v2Entries = entries.map((entry, i) =>
      isV2(rows[i]!) ? (entry as BundleSnapshotV2) : v1AsV2(entry as BundleSnapshot),
    )
    // A build that asks GDT2 cannot read the second tasks/player forms.
    const sent = format === 2 ? oldBuildBlobs(blobs) : blobs
    return writeBundleV2(
      v2Entries,
      {
        legacy: hashes
          .filter((hash) => legacy.has(hash))
          .map((hash) => ({ hash, data: legacy.get(hash)! })),
        blobs: [...sent.values()].sort((a, b) => a.id - b.id),
      },
      format === 3,
    )
  }

  // An app from before v2 storage: every v2 section as the deflated JSON it
  // knows, under the key decodeBundle would give it.
  const snapshots: BundleSnapshot[] = []
  const texts = new SectionTexts(new Map(), blobs, false)
  const keys: string[] = []
  for (const [i, entry] of entries.entries()) {
    const row = rows[i]!
    if (!isV2(row)) {
      snapshots.push(entry as BundleSnapshot)
      continue
    }
    const { snapshot, player } = v1SnapshotOf(entry as BundleSnapshotV2)
    if (player) texts.derivePlayer(...player)
    snapshots.push(snapshot)
    for (const slot of SECTION_NAMES) {
      if (!sections.has(slot)) continue
      const key = slotKey(snapshot, slot)
      if (key) keys.push(key)
      if (slot === 'artifacts' && snapshot.artifactsBase) keys.push(snapshot.artifactsBase)
      if (slot === 'materials') keys.push(snapshot.materialsKeyframe)
      if (slot === 'achievementTimes' && snapshot.achievementTimesBase) {
        keys.push(snapshot.achievementTimesBase)
      }
    }
  }
  const out = new Map<string, Uint8Array>(legacy)
  for (const key of new Set(keys)) out.set(key, await deflateRaw(await texts.text(key)))
  return writeBundle(
    {
      snapshots,
      blobs: [...hashes.filter((hash) => legacy.has(hash)), ...new Set(keys)],
    },
    out,
  )
}

/** A v1 row's entry in a GDT2 manifest: the same, keys being v1 hashes. */
function v1AsV2(entry: BundleSnapshot): BundleSnapshotV2 {
  return {
    ...entry,
    artifactsBase: entry.artifactsBase ?? null,
    player: entry.player ?? null,
    achievementTimes: entry.achievementTimes ?? null,
    achievementTimesBase: entry.achievementTimesBase ?? null,
    characterExtras: entry.characterExtras ?? null,
    anecdotes: entry.anecdotes ?? null,
    tasks: entry.tasks ?? null,
    collections: entry.collections ?? null,
    collections2: entry.collections2 ?? null,
    wardrobe: entry.wardrobe ?? null,
    exploration: entry.exploration ?? null,
    progress: entry.progress ?? null,
    extras: entry.extras ?? null,
  }
}

function slotKey(snapshot: BundleSnapshot, slot: SectionName): string | null {
  return (snapshot[slot] as string | null | undefined) ?? null
}

// ------------------------------------------------------------------ GOOD

/** One live snapshot (or the latest) rebuilt as a GOOD file. */
export async function buildGood(
  d1: D1Database,
  accountId: number,
  snapshotId: number | 'latest',
): Promise<{ good: Good; takenAt: number }> {
  const row = await withLegacySchema((legacy) =>
    d1
      .prepare(
        `SELECT ${rowColumns(legacy)} FROM snapshots WHERE account_id = ?1 AND deleted_at IS NULL
         AND (?2 IS NULL OR id = ?2) ORDER BY taken_at DESC, id DESC LIMIT 1`,
      )
      .bind(accountId, snapshotId === 'latest' ? null : snapshotId)
      .first<StoredRow>(),
  )
  if (!row) throw notFound('Snapshot')

  let snapshot: BundleSnapshot
  let text: (key: string) => string
  if (isV2(row)) {
    const ids = SECTION_NAMES.map((slot) => refOf(row, slot)).filter(
      (id): id is number => id !== null,
    )
    const blobs = await loadV2Blobs(d1, accountId, ids)
    const opened = v1SnapshotOf(toBundleSnapshotV2(row, blobs))
    snapshot = opened.snapshot
    const texts = new SectionTexts(new Map(), blobs, false)
    if (opened.player) texts.derivePlayer(...opened.player)
    const decoded = await texts.many(
      [
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
      ].filter((key): key is string => !!key),
    )
    text = (key) => decoded.get(key)!
  } else {
    const v1 = row as V1StoredRow
    snapshot = toBundleSnapshotV1(v1)
    const hashes = v1Hashes(v1, new Set(SECTION_NAMES))
    const blobs = await loadV1Blobs(d1, accountId, hashes)
    const texts = new SectionTexts(blobs, new Map(), false)
    for (const hash of hashes) {
      if (!blobs.has(hash)) throw new Error(`Snapshot ${row.id} is missing section ${hash}`)
    }
    const decoded = await texts.many(hashes)
    text = (key) => decoded.get(key)!
  }
  const stored = storedSnapshotOf(snapshot, text)

  const artifactIds = [
    ...new Set(
      artifactRows(
        JSON.parse(stored.artifacts),
        stored.artifactsBase ? JSON.parse(stored.artifactsBase) : null,
      ).map((entry) => entry[0]),
    ),
  ]
  const catalog = await loadCatalog(d1, accountId, artifactIds)
  return { good: asLeyline(decodeSnapshot(stored, catalog, MATERIALS)), takenAt: row.taken_at }
}

// ------------------------------------------------------------------ catalog

const CATALOG_COLUMNS = `id, set_key, slot_key, level, rarity, main_stat_key, substats,
  total_rolls, elixer_crafted, unactivated_substats`

function identityOfRow(r: Record<string, unknown>): ArtifactIdentity {
  return {
    setKey: r.set_key as string,
    slotKey: r.slot_key as string,
    level: r.level as number,
    rarity: r.rarity as number,
    mainStatKey: r.main_stat_key as string,
    substats: expandSubstats(JSON.parse(r.substats as string)),
    totalRolls: r.total_rolls as number,
    elixirCrafted: r.elixer_crafted === 1,
    unactivatedSubstats: expandSubstats(JSON.parse(r.unactivated_substats as string)),
  }
}

/**
 * Catalog identities by id: v1 rows (all of the account's, or only `ids`)
 * and every compact chunk, which is where nearly all of them are.
 */
export async function loadCatalog(
  d1: D1Database,
  accountId: number,
  ids: number[] | null,
): Promise<Map<number, ArtifactIdentity>> {
  const [rows, chunks] = await d1.batch<Record<string, unknown>>([
    d1
      .prepare(
        `SELECT ${CATALOG_COLUMNS} FROM artifacts WHERE account_id = ?1
         AND (?2 IS NULL OR id IN (SELECT value FROM json_each(?2)))`,
      )
      .bind(accountId, ids ? JSON.stringify(ids) : null),
    d1.prepare('SELECT data FROM artifact_chunks WHERE account_id = ?1').bind(accountId),
  ])
  const wanted = ids ? new Set(ids) : null
  const catalog = new Map<number, ArtifactIdentity>()
  for (const row of chunks!.results) {
    for (const entry of decodeCatalogChunk(toBytes(row.data))) {
      if (!wanted || wanted.has(entry.id)) catalog.set(entry.id, entry.identity)
    }
  }
  for (const row of rows!.results) catalog.set(row.id as number, identityOfRow(row))
  return catalog
}

/**
 * The catalog as stored, for the Snapshots page's raw download: each
 * `artifact_chunks` row's bytes (base64; a format byte, then the chunk,
 * deflated or not: packages/shared/src/codec/catalog-binary.ts), and the few
 * identities an import keeps in `artifacts` until the chunks take them, as
 * CatalogRow.
 */
export async function catalogRawJson(d1: D1Database, accountId: number): Promise<string> {
  const [chunks, rows] = await d1.batch<Record<string, unknown>>([
    d1
      .prepare(
        'SELECT first_id, last_id, count, data FROM artifact_chunks WHERE account_id = ?1 ORDER BY first_id',
      )
      .bind(accountId),
    d1.prepare(`SELECT ${CATALOG_COLUMNS} FROM artifacts WHERE account_id = ?1`).bind(accountId),
  ])
  const pending = new Map<number, ArtifactIdentity>()
  for (const row of rows!.results) pending.set(row.id as number, identityOfRow(row))
  return JSON.stringify({
    format: 1,
    chunks: chunks!.results.map((row) => ({
      first: row.first_id as number,
      last: row.last_id as number,
      count: row.count as number,
      data: bytesToBase64(toBytes(row.data)),
    })),
    pending: catalogRows(pending),
  })
}

function bytesToBase64(bytes: Uint8Array): string {
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(text)
}

/** The whole catalog as a JSON array of CatalogRow, ordered by id. */
export async function catalogJson(d1: D1Database, accountId: number): Promise<string> {
  return JSON.stringify(catalogRows(await loadCatalog(d1, accountId, null)))
}

function catalogRows(catalog: ReadonlyMap<number, ArtifactIdentity>): CatalogRow[] {
  return [...catalog]
    .sort((a, b) => a[0] - b[0])
    .map(
      ([id, a]): CatalogRow => [
        id,
        a.setKey,
        a.slotKey,
        a.level,
        a.rarity,
        a.mainStatKey,
        a.substats.map((s) =>
          s.initialValue === undefined ? [s.key, s.value] : [s.key, s.value, s.initialValue],
        ),
        a.totalRolls,
        a.elixirCrafted ? 1 : 0,
        a.unactivatedSubstats.map((s) =>
          s.initialValue === undefined ? [s.key, s.value] : [s.key, s.value, s.initialValue],
        ),
      ],
    )
}

/** Gives a Leyline download a stable, sortable file name (`leyline-<time>.json`). */
export function goodFileName(takenAt: number): string {
  return `${leylineFileStem(takenAt)}.json`
}
