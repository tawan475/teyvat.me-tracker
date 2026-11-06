/**
 * Repack: converts what was stored in storage format v1 to v2, a batch at a
 * time, idempotently. Run by `POST /api/admin/repack` (DIAG_KEY) and, when
 * REPACK_CRON_LIMIT is set, by the daily maintenance.
 *
 * - Snapshot rows: each v1 row's sections are read, re-encoded as v2 blobs,
 *   and decoded back; only when every section, the player values and the
 *   summary/header decode to exactly what the v1 row gives is the row
 *   rewritten (its refs set and v1 columns emptied, in one batch with the new
 *   blobs, and only if the row is still the v1 row that was read). A row
 *   that does not match is left as it is and logged by id.
 * - The catalog: v1 rows become compact chunks under the same ids (chunks are
 *   decoded back and compared first), and small chunks are merged.
 * - v1 blobs no v1 row needs any more are deleted.
 *
 * Nothing here reads or logs inventory data beyond what it converts: logs
 * name snapshot and account ids only.
 */

import {
  BlobDecoder,
  SLOTS,
  artifactIdentityText,
  contentKey,
  decodeCatalogChunk,
  blobUsesBase,
  decodeSnapshotMeta,
  encodeCatalogChunk,
  encodeSectionBlob,
  encodeSnapshotMeta,
  expandSubstats,
  inflateRaw,
  kindCode,
  mergePlayer,
  shortHashHex,
  storedPlayer,
  withoutBase,
  type ArtifactIdentity,
  type BlobRef,
  type DecodedBlob,
  type GiPlayer,
  type PlayerVars,
  type RawBlob,
  type SectionKind,
  type SnapshotMeta,
  type SnapshotSummary,
  type Slot,
} from '@gdt/shared'
import { D1Meter } from '../lib/meter'
import { CATALOG_CHUNK_SIZE, catalogChunkStatements, insertBlobStatement } from './import'
import { REF_COLUMNS, toBytes, withLegacySchema } from './storage'

export interface RepackRemaining {
  /** Snapshot rows (live or in the trash) still in format v1. */
  snapshots: number
  /** Rows of the v1 `blobs` table. */
  legacyBlobs: number
  /** Rows of the v1 catalog (`artifacts`): repack moves them into chunks. */
  legacyArtifacts: number
  /** Accounts with catalog chunks small enough to merge. */
  smallChunkAccounts: number
}

export interface RepackResult {
  snapshots: { converted: number; mismatched: number[] }
  catalog: { moved: number; mismatchedAccounts: number[]; chunksMerged: number }
  legacyBlobsDeleted: number
  /** Pass as `after` to continue past rows that did not convert. */
  next: number
  remaining: RepackRemaining
  /** What this run cost in D1 (what it bills): to size `limit`. */
  d1: { roundTrips: number; rowsRead: number; rowsWritten: number; sqlMs: number }
}

/**
 * Catalog rows moved per snapshot row of `limit`: an account's whole catalog
 * (a few thousand pieces) is about one snapshot's worth of work.
 */
const ARTIFACTS_PER_ROW = 50

/** Converted snapshot rows per D1 batch (each with the new blobs it needs). */
const ROWS_PER_BATCH = 20

/** Chunks with fewer entries than this are merged when an account has two or more. */
const SMALL_CHUNK = CATALOG_CHUNK_SIZE / 2

export async function repackStatus(d1: D1Database): Promise<RepackRemaining> {
  const row = await withLegacySchema((legacy) =>
    d1
      .prepare(
        `SELECT (SELECT count(*) FROM snapshots WHERE characters_ref IS NULL) AS snapshots,
           ${legacy ? '(SELECT count(*) FROM blobs)' : '0'} AS legacyBlobs,
           (SELECT count(*) FROM artifacts) AS legacyArtifacts,
           (SELECT count(*) FROM (SELECT account_id FROM artifact_chunks WHERE count < ?1
             GROUP BY account_id HAVING count(*) > 1)) AS smallChunkAccounts`,
      )
      .bind(SMALL_CHUNK)
      .first<RepackRemaining>(),
  )
  return row!
}

/**
 * Converts up to `limit` v1 snapshot rows with ids above `after`, moves up to
 * 50 × `limit` v1 catalog rows into chunks and merges small chunks.
 */
export interface RepackOptions {
  limit: number
  after?: number
  /** The section encoder (tests pass a broken one to see rows refused). */
  encodeSection?: typeof encodeSectionBlob
}

export async function repack(
  database: D1Database,
  { limit, after = 0, encodeSection = encodeSectionBlob }: RepackOptions,
): Promise<RepackResult> {
  const meter = new D1Meter()
  const d1 = meter.wrap(database)
  // Once the v1 columns are dropped there is no v1 row left to convert.
  const snapshots = await withLegacySchema((legacy) =>
    legacy
      ? repackSnapshots(d1, limit, after, encodeSection)
      : Promise.resolve({ converted: 0, mismatched: [], next: after }),
  )
  const catalog = await repackCatalog(d1, limit * ARTIFACTS_PER_ROW)
  const chunksMerged = await mergeSmallChunks(d1, limit)
  const legacyBlobsDeleted = await withLegacySchema((legacy) =>
    legacy ? collectLegacyBlobs(d1) : Promise.resolve(0),
  )
  return {
    snapshots: { converted: snapshots.converted, mismatched: snapshots.mismatched },
    catalog: { ...catalog, chunksMerged },
    legacyBlobsDeleted,
    next: snapshots.next,
    remaining: await repackStatus(d1),
    d1: {
      roundTrips: meter.roundTrips,
      rowsRead: meter.rowsRead,
      rowsWritten: meter.rowsWritten,
      sqlMs: Math.round(meter.sqlMs),
    },
  }
}

/**
 * v1 blobs no v1 snapshot row (live or in the trash) names any more; a row
 * per blob deleted (meta.changes would also count the counter trigger's).
 */
export const COLLECT_LEGACY_BLOBS = `DELETE FROM blobs WHERE NOT EXISTS (
  SELECT 1 FROM snapshots s WHERE s.account_id = blobs.account_id AND blobs.hash IN (
    s.characters_hash, s.weapons_hash, s.artifacts_hash, s.materials_hash,
    s.materials_keyframe_hash, s.achievements_hash, s.player_hash,
    s.achievement_times_hash, s.character_extras_hash, s.artifacts_base_hash,
    s.achievement_times_base_hash)
) RETURNING 1`

async function collectLegacyBlobs(d1: D1Database): Promise<number> {
  return (await d1.prepare(COLLECT_LEGACY_BLOBS).all()).results.length
}

// ---------------------------------------------------------------- snapshots

interface V1Row {
  id: number
  account_id: number
  format: string
  version: number
  source: string
  content_hash: string
  summary: string
  characters_hash: string
  weapons_hash: string
  artifacts_hash: string
  materials_hash: string
  materials_keyframe_hash: string
  achievements_hash: string | null
  player_hash: string | null
  achievement_times_hash: string | null
  character_extras_hash: string | null
  artifacts_base_hash: string | null
  achievement_times_base_hash: string | null
}

/** Each slot's v1 section hash and the full section a delta of it needs. */
function v1Sections(row: V1Row): Record<Slot, { hash: string; base: string | null } | null> {
  const keyframe = row.materials_keyframe_hash
  return {
    characters: { hash: row.characters_hash, base: null },
    weapons: { hash: row.weapons_hash, base: null },
    artifacts: { hash: row.artifacts_hash, base: row.artifacts_base_hash },
    materials: {
      hash: row.materials_hash,
      base: keyframe && keyframe !== row.materials_hash ? keyframe : null,
    },
    achievements: row.achievements_hash ? { hash: row.achievements_hash, base: null } : null,
    player: row.player_hash ? { hash: row.player_hash, base: null } : null,
    achievementTimes: row.achievement_times_hash
      ? { hash: row.achievement_times_hash, base: row.achievement_times_base_hash }
      : null,
    characterExtras: row.character_extras_hash
      ? { hash: row.character_extras_hash, base: null }
      : null,
    // Kept only since v2: a v1 row never has them.
    anecdotes: null,
    tasks: null,
    collections: null,
    collections2: null,
    wardrobe: null,
    exploration: null,
    progress: null,
    extras: null,
  }
}

/** A v2 blob this run reuses or writes, as the decoder and the writes see it. */
interface Target {
  /** 16 hex digits. */
  hash: string
  /** Existing id, or a provisional negative one for a blob this run writes. */
  id: number
  raw: RawBlob
  /** For a blob this run writes: its insert, base given by hash or id. */
  write: { hash: string; code: number; base: BlobRef | null; data: Uint8Array } | null
  /** The blob it needs to decode (a delta's base, or its dictionary), when this run knows it. */
  base: Target | null
}

async function repackSnapshots(
  d1: D1Database,
  limit: number,
  after: number,
  encodeSection: typeof encodeSectionBlob,
): Promise<{ converted: number; mismatched: number[]; next: number }> {
  const { results: rows } = await d1
    .prepare(
      `SELECT id, account_id, format, version, source, content_hash, summary, characters_hash,
         weapons_hash, artifacts_hash, materials_hash, materials_keyframe_hash, achievements_hash,
         player_hash, achievement_times_hash, character_extras_hash, artifacts_base_hash,
         achievement_times_base_hash
       FROM snapshots WHERE characters_ref IS NULL AND id > ?1 ORDER BY id LIMIT ?2`,
    )
    .bind(after, limit)
    .all<V1Row>()
  let converted = 0
  const mismatched: number[] = []
  const byAccount = new Map<number, V1Row[]>()
  for (const row of rows) {
    const list = byAccount.get(row.account_id)
    if (list) list.push(row)
    else byAccount.set(row.account_id, [row])
  }
  for (const [accountId, accountRows] of byAccount) {
    const result = await repackAccountSnapshots(d1, accountId, accountRows, encodeSection)
    converted += result.converted
    mismatched.push(...result.mismatched)
  }
  return { converted, mismatched, next: rows.at(-1)?.id ?? after }
}

async function repackAccountSnapshots(
  d1: D1Database,
  accountId: number,
  rows: V1Row[],
  encodeSection: typeof encodeSectionBlob,
): Promise<{ converted: number; mismatched: number[] }> {
  // Every v1 section these rows name (bases included), inflated.
  const hashes = new Set<string>()
  for (const row of rows) {
    for (const section of Object.values(v1Sections(row))) {
      if (!section) continue
      hashes.add(section.hash)
      if (section.base) hashes.add(section.base)
    }
  }
  const { results: blobRows } = await d1
    .prepare(
      `SELECT hash, data FROM blobs WHERE account_id = ?1
       AND hash IN (SELECT value FROM json_each(?2))`,
    )
    .bind(accountId, JSON.stringify([...hashes]))
    .all<{ hash: string; data: unknown }>()
  const v1 = new Map<string, string>()
  for (const row of blobRows) v1.set(row.hash, await inflateRaw(toBytes(row.data)))

  // The stored (stable) part of each player section, by v1 hash.
  const players = new Map<string, PlayerSplit>()
  for (const row of rows) {
    if (!row.player_hash || players.has(row.player_hash)) continue
    const text = v1.get(row.player_hash)
    if (text !== undefined) players.set(row.player_hash, await storedPlayer(JSON.parse(text)))
  }

  // The v2 blobs that already exist under these hashes (and their bases).
  const shortHashes = new Set([...hashes].map(shortHashHex))
  for (const split of players.values()) shortHashes.add(shortHashHex(split.hash))
  const { results: existingRows } = await d1
    .prepare(
      `WITH RECURSIVE need(id, depth) AS (
         SELECT b.id, 0 FROM json_each(?2) AS j
         CROSS JOIN section_blobs AS b ON b.account_id = ?1 AND b.hash = unhex(j.value)
         UNION SELECT b.base_id, n.depth + 1 FROM section_blobs AS b JOIN need AS n ON b.id = n.id
           WHERE b.base_id IS NOT NULL AND n.depth < 3)
       SELECT id, kind, hex(hash) AS hash, base_id, data FROM section_blobs
       WHERE account_id = ?1 AND id IN (SELECT id FROM need)`,
    )
    .bind(accountId, JSON.stringify([...shortHashes]))
    .all<Record<string, unknown>>()
  const targets = new Map<string, Target>()
  const raw = new Map<number, RawBlob>()
  for (const row of existingRows) {
    const blob: RawBlob = {
      id: row.id as number,
      code: row.kind as number,
      baseId: (row.base_id as number | null) ?? null,
      data: toBytes(row.data),
    }
    raw.set(blob.id, blob)
    const hash = (row.hash as string).toLowerCase()
    targets.set(hash, { hash, id: blob.id, raw: blob, write: null, base: null })
  }
  const decoder = new BlobDecoder((id) => raw.get(id))
  let provisional = 0
  /**
   * The last standalone full section of each kind this run stored: what the
   * next one is compressed against while that halves it (as an import does,
   * see planSnapshotV2), so converted history is about as compact as new.
   */
  const anchors = new Map<SectionKind, Target>()

  /**
   * The v2 blob of a v1 section, reused or planned. `base` is a delta's base
   * (a v1 delta stays a delta of the same content); a full section may get
   * an anchor as its dictionary instead.
   */
  const targetOf = (
    kind: SectionKind,
    hash: string,
    value: unknown,
    base: Target | null,
  ): Target => {
    const short = shortHashHex(hash)
    const found = targets.get(short)
    if (found) return found
    const delta = base !== null
    let encoded = encodeSection(kind, value, delta, base ? decoder.decode(base.id) : null)
    let dictionary: Target | null = base
    if (!delta) {
      const anchor = anchors.get(kind) ?? null
      const against = anchor ? encodeSection(kind, value, false, decoder.decode(anchor.id)) : null
      if (against && blobUsesBase(against.data) && against.data.length * 2 <= encoded.data.length) {
        encoded = against
        dictionary = anchor
      }
    }
    const id = --provisional
    const blob: RawBlob = {
      id,
      code: kindCode(kind, delta),
      baseId: dictionary ? dictionary.id : null,
      data: encoded.data,
    }
    raw.set(id, blob)
    const target: Target = {
      hash: short,
      id,
      raw: blob,
      write: {
        hash: short,
        code: blob.code,
        base: dictionary
          ? dictionary.write
            ? { hash: dictionary.hash }
            : { id: dictionary.id }
          : null,
        data: encoded.data,
      },
      base: dictionary,
    }
    targets.set(short, target)
    if (!delta && !dictionary) anchors.set(kind, target)
    return target
  }

  let statements: D1PreparedStatement[] = []
  /** Positions of the row updates in `statements`, and their snapshot ids. */
  let updates: [number, number][] = []
  const written = new Set<string>()
  let converted = 0
  const mismatched: number[] = []
  const skipped: number[] = []
  // Each row is written with the blobs it needs; a few rows share a batch.
  // A row whose update changed nothing (it changed in between, or a section
  // it names was not there) is left for the next run.
  const flush = async () => {
    if (statements.length > 0) {
      const results = await d1.batch(statements)
      for (const [index, snapshotId] of updates) {
        if ((results[index]?.meta.changes ?? 0) > 0) converted++
        else skipped.push(snapshotId)
      }
    }
    statements = []
    updates = []
  }
  for (const row of rows) {
    const plan = planRow(row, v1, players, targetOf, decoder)
    if (typeof plan === 'string') {
      mismatched.push(row.id)
      console.warn('repack_mismatch', JSON.stringify({ snapshotId: row.id, accountId, at: plan }))
      continue
    }
    // Bases before the blobs that name them; each blob once.
    const write = (target: Target) => {
      if (!target.write || written.has(target.hash)) return
      if (target.base) write(target.base)
      written.add(target.hash)
      statements.push(insertBlobStatement(d1, accountId, target.write))
    }
    for (const target of plan.writes) write(target)
    updates.push([statements.length, row.id])
    statements.push(convertRowStatement(d1, accountId, row, plan))
    if (updates.length >= ROWS_PER_BATCH) await flush()
  }
  await flush()
  for (const snapshotId of skipped) {
    console.warn('repack_skipped', JSON.stringify({ snapshotId, accountId }))
  }
  return { converted, mismatched: [...mismatched, ...skipped] }
}

interface RowPlan {
  refs: Record<Slot, Target | null>
  meta: Uint8Array
  /** Blobs to write, bases first. */
  writes: Target[]
}

/**
 * The v2 form of one v1 row, decoded back and compared with the v1 decode;
 * when anything differs or a section is missing, where (a slot and check
 * name, nothing of the data).
 */
function planRow(
  row: V1Row,
  v1: ReadonlyMap<string, string>,
  players: ReadonlyMap<string, PlayerSplit>,
  targetOf: (kind: SectionKind, hash: string, value: unknown, base: Target | null) => Target,
  decoder: BlobDecoder,
): RowPlan | string {
  try {
    if (row.format !== 'GOOD') return 'format'
    const sections = v1Sections(row)
    const refs = {} as Record<Slot, Target | null>
    const writes: Target[] = []
    const need = (target: Target) => {
      if (target.write) writes.push(target)
      return target
    }
    let playerVars: PlayerVars = {}
    for (const slot of SLOTS) {
      const section = sections[slot]
      if (!section) {
        refs[slot] = null
        continue
      }
      const text = v1.get(section.hash)
      if (text === undefined) return `${slot}:missing`
      let value: unknown = JSON.parse(text)
      if (slot === 'player') {
        const split = players.get(section.hash)
        if (!split) return 'player:split'
        playerVars = split.vars
        value = split.stable
        const target = need(targetOf('player', split.hash, value, null))
        // The merged player must be the v1 section, byte for byte.
        const stable = decoder.decode(target.id).value as GiPlayer
        if (JSON.stringify(mergePlayer(stable, split.vars)) !== text) return 'player:merge'
        refs.player = target
        continue
      }
      let base: Target | null = null
      if (section.base) {
        const baseText = v1.get(section.base)
        if (baseText === undefined) return `${slot}:base-missing`
        const baseValue: unknown = JSON.parse(baseText)
        base = need(targetOf(slot, section.base, baseValue, null))
        if (!sameValue(decoder.decode(base.id), baseValue)) return `${slot}:base-value`
      }
      // A v1 delta names its base by hash (v2: the blob row names it, as above).
      if ((value as { b?: string } | null)?.b !== (section.base ?? undefined)) return `${slot}:b`
      const target = need(targetOf(slot, section.hash, value, base))
      // Same kind of section (full or delta), same content, same base.
      if ((target.raw.code & 0x10) !== (base ? 0x10 : 0)) return `${slot}:kind`
      if (base && target.raw.baseId !== base.id) return `${slot}:base`
      if (!sameValue(decoder.decode(target.id), value)) return `${slot}:value`
      refs[slot] = target
    }
    const meta: SnapshotMeta = {
      format: row.format,
      version: row.version,
      source: row.source,
      summary: JSON.parse(row.summary) as SnapshotSummary,
      playerVars,
    }
    const encodedMeta = encodeSnapshotMeta(meta)
    const decodedMeta = decodeSnapshotMeta(encodedMeta)
    if (
      JSON.stringify(decodedMeta.summary) !== row.summary ||
      decodedMeta.format !== row.format ||
      decodedMeta.version !== row.version ||
      decodedMeta.source !== row.source ||
      decodedMeta.playerVars.resin !== playerVars.resin ||
      decodedMeta.playerVars.arExp !== playerVars.arExp
    ) {
      return 'meta'
    }
    return { refs, meta: encodedMeta, writes: dedupe(writes) }
  } catch (error) {
    return `error:${error instanceof Error ? error.name : 'unknown'}`
  }
}

/** A v1 player section's stored part, its per-login values and the stored part's hash. */
type PlayerSplit = Awaited<ReturnType<typeof storedPlayer>>

/** Decoded v2 value vs v1 value, `b` aside (it names the base in each format's own way). */
function sameValue(decoded: DecodedBlob, v1Value: unknown): boolean {
  return JSON.stringify(withoutBase(decoded.value)) === JSON.stringify(withoutBase(v1Value))
}

function dedupe(targets: Target[]): Target[] {
  const seen = new Set<string>()
  return targets.filter((t) => !seen.has(t.hash) && seen.add(t.hash))
}

/** Rewrites one v1 row as v2, only if it is still that v1 row and every section exists. */
function convertRowStatement(
  d1: D1Database,
  accountId: number,
  row: V1Row,
  plan: RowPlan,
): D1PreparedStatement {
  const params: unknown[] = [
    accountId,
    row.id,
    row.content_hash,
    contentKey(row.content_hash),
    plan.meta,
  ]
  const sets: string[] = []
  const guards: string[] = []
  for (const slot of SLOTS) {
    const target = plan.refs[slot]
    if (!target) continue
    const expr = target.write
      ? `(SELECT id FROM section_blobs WHERE account_id = ?1 AND hash = unhex(?${params.push(target.hash)}))`
      : `(SELECT id FROM section_blobs WHERE account_id = ?1 AND id = ?${params.push(target.id)})`
    sets.push(`${REF_COLUMNS[slot]} = ${expr}`)
    guards.push(`${expr} IS NOT NULL`)
  }
  return d1
    .prepare(
      `UPDATE snapshots SET content_key = ?4, meta = ?5, ${sets.join(', ')},
         format = '', version = 0, source = '', content_hash = '', summary = '',
         characters_hash = '', weapons_hash = '', artifacts_hash = '', materials_hash = '',
         materials_keyframe_hash = '', achievements_hash = NULL, player_hash = NULL,
         achievement_times_hash = NULL, character_extras_hash = NULL,
         artifacts_base_hash = NULL, achievement_times_base_hash = NULL
       WHERE id = ?2 AND account_id = ?1 AND characters_ref IS NULL AND content_hash = ?3
         AND ${guards.join(' AND ')}`,
    )
    .bind(...params)
}

// ---------------------------------------------------------------- catalog

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

/** True when the chunk decodes to exactly these entries. */
function chunkMatches(
  data: Uint8Array,
  entries: readonly { id: number; identity: ArtifactIdentity }[],
): boolean {
  const decoded = decodeCatalogChunk(data)
  return (
    decoded.length === entries.length &&
    decoded.every(
      (entry, i) =>
        entry.id === entries[i]!.id &&
        artifactIdentityText(entry.identity) === artifactIdentityText(entries[i]!.identity),
    )
  )
}

async function repackCatalog(
  d1: D1Database,
  limit: number,
): Promise<{ moved: number; mismatchedAccounts: number[] }> {
  let moved = 0
  const mismatchedAccounts: number[] = []
  const { results: accounts } = await d1
    .prepare('SELECT DISTINCT account_id FROM artifacts LIMIT 100')
    .all<{ account_id: number }>()
  for (const { account_id: accountId } of accounts) {
    if (moved >= limit) break
    const { results } = await d1
      .prepare(
        `SELECT ${CATALOG_COLUMNS} FROM artifacts WHERE account_id = ?1 ORDER BY id LIMIT ?2`,
      )
      .bind(accountId, Math.min(CATALOG_CHUNK_SIZE * 4, Math.max(1, limit - moved)))
      .all<Record<string, unknown>>()
    const entries = results.map((row) => ({ id: row.id as number, identity: identityOfRow(row) }))
    let good = true
    for (let i = 0; i < entries.length && good; i += CATALOG_CHUNK_SIZE) {
      const part = entries.slice(i, i + CATALOG_CHUNK_SIZE)
      good = chunkMatches(encodeCatalogChunk(part), part)
    }
    if (!good) {
      mismatchedAccounts.push(accountId)
      console.warn('repack_catalog_mismatch', JSON.stringify({ accountId }))
      continue
    }
    await d1.batch(catalogChunkStatements(d1, accountId, entries))
    moved += entries.length
  }
  return { moved, mismatchedAccounts }
}

/** Merges each account's small chunks (by first id) into chunks of up to CATALOG_CHUNK_SIZE. */
async function mergeSmallChunks(d1: D1Database, limit: number): Promise<number> {
  const { results: accounts } = await d1
    .prepare(
      `SELECT account_id FROM artifact_chunks WHERE count < ?1
       GROUP BY account_id HAVING count(*) > 1 LIMIT ?2`,
    )
    .bind(SMALL_CHUNK, Math.max(1, Math.ceil(limit / 10)))
    .all<{ account_id: number }>()
  let merged = 0
  for (const { account_id: accountId } of accounts) {
    const { results } = await d1
      .prepare(
        `SELECT id, data FROM artifact_chunks WHERE account_id = ?1 AND count < ?2
         ORDER BY first_id`,
      )
      .bind(accountId, SMALL_CHUNK)
      .all<{ id: number; data: unknown }>()
    const statements: D1PreparedStatement[] = []
    let group: { ids: number[]; entries: { id: number; identity: ArtifactIdentity }[] } = {
      ids: [],
      entries: [],
    }
    const flush = () => {
      if (group.ids.length > 1) {
        const seen = new Set<number>()
        const entries = group.entries
          .filter((e) => !seen.has(e.id) && seen.add(e.id))
          .sort((a, b) => a.id - b.id)
        const data = encodeCatalogChunk(entries)
        if (chunkMatches(data, entries)) {
          statements.push(...mergeStatements(d1, accountId, group.ids, entries, data))
          merged += group.ids.length
        }
      }
      group = { ids: [], entries: [] }
    }
    for (const row of results) {
      const entries = decodeCatalogChunk(toBytes(row.data)).map(({ id, identity }) => ({
        id,
        identity,
      }))
      if (group.entries.length + entries.length > CATALOG_CHUNK_SIZE) flush()
      group.ids.push(row.id)
      group.entries.push(...entries)
    }
    flush()
    if (statements.length > 0) await d1.batch(statements)
  }
  return merged
}

/** One merged chunk in place of `parts`, only while all of them are still there. */
function mergeStatements(
  d1: D1Database,
  accountId: number,
  parts: number[],
  entries: readonly { id: number }[],
  data: Uint8Array,
): D1PreparedStatement[] {
  const ids = JSON.stringify(parts)
  const first = entries[0]!.id
  const last = entries.at(-1)!.id
  return [
    d1
      .prepare(
        `INSERT INTO artifact_chunks (account_id, first_id, last_id, count, data)
         SELECT ?1, ?2, ?3, ?4, ?5
         WHERE (SELECT count(*) FROM artifact_chunks
                WHERE account_id = ?1 AND id IN (SELECT value FROM json_each(?6))) = ?7`,
      )
      .bind(accountId, first, last, entries.length, data, ids, parts.length),
    d1
      .prepare(
        `DELETE FROM artifact_chunks WHERE account_id = ?1
         AND id IN (SELECT value FROM json_each(?2))
         AND EXISTS (SELECT 1 FROM artifact_chunks WHERE account_id = ?1 AND first_id = ?3
                     AND last_id = ?4 AND count = ?5 AND id NOT IN (SELECT value FROM json_each(?2)))`,
      )
      .bind(accountId, ids, first, last, entries.length),
  ]
}
