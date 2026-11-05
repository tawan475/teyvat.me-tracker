/**
 * The import pipeline: one GOOD file in, one snapshot (or nothing) out.
 * New snapshots are written in storage format v2 (@gdt/shared codec/store-v2.ts:
 * section blobs by id, binary layouts, the summary and GOOD header in `meta`);
 * rows from before are read as they are until the repack job converts them.
 *
 * D1 round trips, typical case (the Worker runs next to D1, so each is a few
 * milliseconds, but they still dominate an import):
 *   1. one batch: latest snapshot, same-capture-time snapshot, the catalog
 *      (its compact chunks, plus v1 rows not repacked yet, probed by hash),
 *      the latest snapshot's sections with their bases, which of the
 *      id-independent sections already exist, and the owner's upload usage
 *      and limits (upload-limits.ts)
 *   2. only if some artifacts are new: insert them (the `artifacts` table
 *      hands out their ids) and read their ids
 *   3. one batch: new sections, the snapshot row, the new artifacts as a
 *      catalog chunk, the owner's upload day, account update (atomic)
 * An unchanged re-upload stops after 1 (plus a one-row update when it is a
 * later capture of the same inventory). An upload that will store something
 * is checked against the upload limits before its first write (2 or 3).
 *
 * Lookups by hash are driven from json_each with CROSS JOIN, which makes
 * SQLite probe the unique index once per hash instead of scanning: D1 bills,
 * and waits on, every row read.
 */

import {
  GoodFormatError,
  GoodLimitError,
  GoodPartialCaptureError,
  SLOTS,
  serverFromUid,
  artifactKeyString,
  compactSubstats,
  completeSnapshot,
  decodeSnapshotMeta,
  contentKey,
  decodeCatalogChunk,
  encodeCatalogChunk,
  encodeSnapshotMeta,
  encodeStaticSections,
  planSnapshotV2,
  prepareSnapshot,
  resolveImportTimestamp,
  shortHashHex,
  storedPlayer,
  BlobDecoder,
  type ArtifactIdentity,
  type BlobRef,
  type GiCapture,
  type ImportResponse,
  type ImportWarning,
  type KnownBlob,
  type PreparedSnapshot,
  type RawBlob,
  type Section,
  type Slot,
  type SnapshotPlan,
} from '@gdt/shared'
import { MATERIALS } from '@gdt/shared/dictionary/materials'
import { ApiError, isUniqueViolation } from '../lib/http'
import { D1Meter } from '../lib/meter'
import { dataVersionOf, recomputeAccount } from './accounts'
import { listenerOf, listenerStatement, type Listener } from './live'
import { REFS_SQL, REF_COLUMNS, toBytes, withLegacySchema } from './storage'
import {
  assertCanStore,
  countUploadStatement,
  readUsage,
  usageStatement,
  utcDay,
} from './upload-limits'

export interface Upload {
  text: string
  rawSize: number
  /** The uploader's explicit capture time, if it sent one. */
  timestamp: unknown
}

interface LatestRow extends Record<string, unknown> {
  id: number
  taken_at: number
  content_hash: string | null
  content_key: number | null
  characters_ref: number | null
  meta: unknown
}

/** The snapshot an upload is stored against (NEAREST_SQL). */
interface NearestRow extends Record<string, unknown> {
  id: number
  characters_ref: number | null
}

interface SameTimeRow {
  id: number
  content_hash: string | null
  content_key: number | null
}

/** Artifacts per INSERT statement; keeps each bound JSON parameter well under D1's limits. */
const ARTIFACT_INSERT_CHUNK = 400
/** Artifacts per catalog chunk an import writes (repack merges small ones). */
export const CATALOG_CHUNK_SIZE = 512

/** The latest live snapshot (a v1 row's content hash only while the schema has v1). */
const latestSql = (legacy: boolean) => `SELECT id, taken_at,
    ${legacy ? 'content_hash' : 'NULL AS content_hash'}, content_key, meta, ${REFS_SQL}
  FROM snapshots WHERE account_id = ?1 AND deleted_at IS NULL
  ORDER BY taken_at DESC, id DESC LIMIT 1`

/**
 * The snapshot an upload is stored against (its sections are what the new
 * ones are deltas of or compressed against): the nearest capture at or
 * before the upload's time, else the first one after it. For a new capture
 * that is the latest; for older history imported afterwards it is its
 * neighbour in time, not the newest capture, which shares little with it
 * (an account whose history arrived after its newer captures stored most
 * of it whole, 2026-11-06). ?1 the account, ?2 the upload's capture time.
 */
export const NEAREST_SQL = `SELECT id, ${REFS_SQL} FROM (
    SELECT * FROM (SELECT id, ${REFS_SQL}, 0 AS side FROM snapshots
      WHERE account_id = ?1 AND deleted_at IS NULL AND taken_at <= ?2
      ORDER BY taken_at DESC, id DESC LIMIT 1)
    UNION ALL
    SELECT * FROM (SELECT id, ${REFS_SQL}, 1 AS side FROM snapshots
      WHERE account_id = ?1 AND deleted_at IS NULL AND taken_at > ?2
      ORDER BY taken_at ASC, id ASC LIMIT 1)
  ) ORDER BY side LIMIT 1`

/**
 * The nearest snapshot's (NEAREST_SQL) v2 sections and every blob they need
 * (bases, and their dictionaries), with data: at most three levels. Nothing
 * for a v1 row.
 */
const LATEST_BLOBS_SQL = `WITH RECURSIVE latest AS (
    SELECT ${REFS_SQL} FROM (${NEAREST_SQL})),
  need(id, depth) AS (
    SELECT j.value, 0 FROM latest, json_each(json_array(${REFS_SQL})) AS j
    UNION SELECT b.base_id, n.depth + 1 FROM section_blobs AS b JOIN need AS n ON b.id = n.id
      WHERE b.base_id IS NOT NULL AND n.depth < 3)
  SELECT b.id, b.kind, hex(b.hash) AS hash, b.base_id, b.data FROM section_blobs AS b
  WHERE b.account_id = ?1 AND b.id IN (SELECT id FROM need WHERE id IS NOT NULL)`

const sameTimeSql = (legacy: boolean) => `SELECT id,
    ${legacy ? 'content_hash' : 'NULL AS content_hash'}, content_key FROM snapshots
  WHERE account_id = ?1 AND taken_at = ?2 AND deleted_at IS NULL`

/** The account an upload goes to: its id and the UID it was given (if any). */
export interface ImportTarget {
  id: number
  uid: string | null
}

/**
 * What an import did: the response for the uploader; for the live event, the
 * account's new data version when it moved (null for a no-op) and who
 * listens, read in the same batch as the write.
 */
export interface ImportResult {
  response: ImportResponse
  dataVersion: number | null
  listener?: Listener[]
  /** The upload, parsed (live sync reads its summary, guids and gi_capture). */
  prepared: PreparedSnapshot
  /** The snapshot answered with is the account's newest (live sync starts a journal on it). */
  newest: boolean
  /** Its content key (as this upload hashes). */
  contentKey: number
}

/** A section another write removed between our read and our write: start over. */
class Retry extends Error {}

/**
 * Stores `upload` in `account`. `parsed` is the upload already parsed by
 * `parseUpload`, for a caller that had to read it first (a user key routes by
 * the file's UID).
 */
export async function importSnapshot(
  d1: D1Database,
  account: ImportTarget,
  upload: Upload,
  meter = new D1Meter(),
  parsed?: PreparedSnapshot,
  /** Bytes the owner keeps elsewhere (gdt-live), counted toward the storage quota. */
  extraStoredBytes?: Promise<number>,
): Promise<ImportResult> {
  const prepared = parsed ?? (await parseUpload(upload.text))
  for (let attempt = 1; ; attempt++) {
    try {
      return await withLegacySchema((legacy) =>
        importOnce(d1, account, upload, meter, prepared, legacy, extraStoredBytes),
      )
    } catch (error) {
      // Only the daily maintenance or repack can pull a section away mid-import.
      if (error instanceof Retry && attempt < 3) continue
      throw error
    }
  }
}

async function importOnce(
  d1: D1Database,
  account: ImportTarget,
  upload: Upload,
  meter: D1Meter,
  prepared: PreparedSnapshot,
  legacy: boolean,
  extraStoredBytes?: Promise<number>,
): Promise<ImportResult> {
  const accountId = account.id
  const now = Date.now()
  const day = utcDay(now)
  const takenAt = resolveImportTimestamp(upload.timestamp, prepared.good.timestamp, now)
  const sections = await encodeStaticSections(prepared, MATERIALS)
  const player = prepared.good.player ? await storedPlayer(prepared.good.player) : null
  const warnings = uidWarnings(account, prepared)

  // Catalog entry for each distinct artifact identity in this upload.
  const identities = new Map<string, ArtifactIdentity>()
  prepared.artifactHashes.forEach((hash, i) => {
    if (!identities.has(hash)) identities.set(hash, prepared.good.artifacts[i]!.identity)
  })
  const hashes = [...identities.keys()]
  // Sections whose hash needs no catalog ids: a server can ask which exist
  // in the first round trip.
  const staticHashes = [
    sections.characters,
    sections.weapons,
    sections.materials,
    sections.achievements,
    sections.achievementTimes,
    sections.characterExtras,
    sections.anecdotes,
    sections.tasks,
    sections.collections,
    sections.collections2,
    sections.wardrobe,
    sections.exploration,
    sections.progress,
    sections.extras,
  ]
    .filter((s): s is Section => s !== null)
    .map((s) => shortHashHex(s.hash))
  if (player) staticHashes.push(shortHashHex(player.hash))

  // 1.
  const [
    latestResult,
    nearestResult,
    sameTimeResult,
    idsResult,
    chunksResult,
    blobsResult,
    existingResult,
    usageResult,
  ] = await meter.batch(d1, 'lookup', [
    d1.prepare(latestSql(legacy)).bind(accountId),
    d1.prepare(NEAREST_SQL).bind(accountId, takenAt),
    d1.prepare(sameTimeSql(legacy)).bind(accountId, takenAt),
    selectArtifactIds(d1, accountId, hashes),
    d1.prepare('SELECT id, data FROM artifact_chunks WHERE account_id = ?1').bind(accountId),
    d1.prepare(LATEST_BLOBS_SQL).bind(accountId, takenAt),
    d1
      .prepare(
        `SELECT b.id, hex(b.hash) AS hash, b.kind FROM json_each(?2) AS j
           CROSS JOIN section_blobs AS b ON b.account_id = ?1 AND b.hash = unhex(j.value)`,
      )
      .bind(accountId, JSON.stringify(staticHashes)),
    usageStatement(d1, accountId, day),
  ])
  const latest = (latestResult!.results[0] as LatestRow | undefined) ?? null
  const nearest = (nearestResult!.results[0] as NearestRow | undefined) ?? null
  const sameTime = sameTimeResult!.results[0] as SameTimeRow | undefined
  const legacyIds = idMap(idsResult!.results)
  const chunks = readChunks(chunksResult!.results)
  const existing = new Map(
    existingResult!.results.map((row) => [
      (row.hash as string).toLowerCase(),
      { id: row.id as number, code: row.kind as number },
    ]),
  )
  const usage = readUsage(usageResult!.results[0])
  if (usage && extraStoredBytes) usage.storedBytes += await extraStoredBytes

  // Ids for every identity: a v1 row by hash, or a chunk by packed bytes.
  const artifactIds = new Map<string, number>()
  const keys = new Map<string, string>()
  for (const [hash, identity] of identities) {
    const key = artifactKeyString(identity)
    keys.set(hash, key)
    const id = legacyIds.get(hash) ?? chunks.ids.get(key)
    if (id !== undefined) artifactIds.set(hash, id)
  }

  // 2.
  const missing = hashes.filter((hash) => !artifactIds.has(hash))
  let staged: { id: number; identity: ArtifactIdentity }[] = []
  if (missing.length > 0) {
    // An artifact the catalog lacks: this upload stores a snapshot.
    assertCanStore(usage, now)
    const inserted = await insertArtifacts(d1, meter, accountId, missing, identities, chunks.maxId)
    for (const hash of missing) {
      // A chunk written since step 1 may hold it already: use that id.
      const id = inserted.chunkIds.get(keys.get(hash)!) ?? inserted.ids.get(hash)
      if (id === undefined) throw new Error(`No catalog id for artifact ${hash}`)
      artifactIds.set(hash, id)
      if (!inserted.chunkIds.has(keys.get(hash)!))
        staged.push({ id, identity: identities.get(hash)! })
    }
    staged = staged.sort((a, b) => a.id - b.id)
  }

  const encoded = await completeSnapshot(sections, prepared, artifactIds)
  const key = contentKey(encoded.contentHash)
  const legacyKey = contentKey(encoded.legacyContentHash)
  const preAnecdotesKey = contentKey(encoded.preAnecdotesContentHash)
  const preTasksKey = contentKey(encoded.preTasksContentHash)
  const preCollectionsKey = contentKey(encoded.preCollectionsContentHash)
  const preCollections2Key = contentKey(encoded.preCollections2ContentHash)
  const preWardrobeKey = contentKey(encoded.preWardrobeContentHash)
  const preExplorationKey = contentKey(encoded.preExplorationContentHash)
  const pre17Key = contentKey(encoded.pre17ContentHash)
  const pre18Key = contentKey(encoded.pre18ContentHash)
  const pre19Key = contentKey(encoded.pre19ContentHash)
  const pre20Key = contentKey(encoded.pre20ContentHash)
  const preRecipesKey = contentKey(encoded.preRecipesContentHash)
  const response = (
    status: ImportResponse['status'],
    snapshotId: number,
    storedSize = 0,
    dataVersion: number | null = null,
    listener?: Listener[],
    newest = true,
  ): ImportResult => ({
    response: {
      status,
      snapshotId,
      takenAt,
      rawSize: upload.rawSize,
      storedSize,
      ...(warnings.length > 0 ? { warnings } : {}),
      contentKey: key.toString(36),
    },
    dataVersion,
    ...(listener ? { listener } : {}),
    prepared,
    newest,
    contentKey: key,
  })
  // The same capture, also when it was stored before irminsul's extra keys
  // (or later its anecdotes, tasks, collections, Capture 1.4.0's keys, then
  // its exploration, then Capture 1.7.0's, then 1.8.0's, then 1.17's, then 1.17.12's parts) were kept
  // (its hash then left them out), in either storage format.
  const sameCapture = (row: SameTimeRow) =>
    row.content_key !== null
      ? row.content_key === key ||
        row.content_key === legacyKey ||
        row.content_key === preAnecdotesKey ||
        row.content_key === preTasksKey ||
        row.content_key === preCollectionsKey ||
        row.content_key === preCollections2Key ||
        row.content_key === preWardrobeKey ||
        row.content_key === preExplorationKey ||
        row.content_key === pre17Key ||
        row.content_key === pre18Key ||
        row.content_key === pre19Key ||
        row.content_key === pre20Key ||
        row.content_key === preRecipesKey
      : row.content_hash === encoded.contentHash ||
        row.content_hash === encoded.legacyContentHash ||
        row.content_hash === encoded.preAnecdotesContentHash ||
        row.content_hash === encoded.preTasksContentHash ||
        row.content_hash === encoded.preCollectionsContentHash ||
        row.content_hash === encoded.preCollections2ContentHash ||
        row.content_hash === encoded.preWardrobeContentHash ||
        row.content_hash === encoded.preExplorationContentHash ||
        row.content_hash === encoded.pre17ContentHash ||
        row.content_hash === encoded.pre18ContentHash ||
        row.content_hash === encoded.pre19ContentHash ||
        row.content_hash === encoded.pre20ContentHash ||
        row.content_hash === encoded.preRecipesContentHash
  const sameInventory = (row: LatestRow) =>
    row.content_key !== null ? row.content_key === key : row.content_hash === encoded.contentHash

  if (sameTime) {
    // A re-upload of the same capture is a no-op, so uploaders can retry freely.
    if (sameCapture(sameTime)) {
      return response('unchanged', sameTime.id, 0, null, undefined, sameTime.id === latest?.id)
    }
    throw new ApiError(
      409,
      'duplicate_capture',
      'A different snapshot exists for this capture time',
    )
  }

  if (
    latest &&
    sameInventory(latest) &&
    takenAt > latest.taken_at &&
    !newWorld(prepared.good.capture, latest.meta)
  ) {
    // Same inventory captured again later: remember when it was last seen
    // instead of storing a duplicate snapshot. (A full send of the game in
    // another world or session is kept as its own snapshot even unchanged:
    // live sync's session cards have one row per world stay.)
    const [, bumped, listening] = await meter.batch(d1, 'seen', [
      d1
        .prepare('UPDATE snapshots SET last_seen_at = max(last_seen_at, ?1) WHERE id = ?2')
        .bind(takenAt, latest.id),
      d1
        .prepare(
          'UPDATE genshin_accounts SET data_version = data_version + 1 WHERE id = ?1 RETURNING data_version',
        )
        .bind(accountId),
      listenerStatement(d1, accountId),
      ...fillAccountStatements(d1, accountId, prepared),
    ])
    return response('unchanged', latest.id, 0, dataVersionOf(bumped) ?? null, listenerOf(listening))
  }

  assertCanStore(usage, now)

  // The nearest snapshot's sections (NEAREST_SQL) are what new ones are
  // deltas of or compressed against; a v1 row has none, so everything is
  // stored whole (once per account, until repack converts it).
  const known = nearest?.characters_ref != null ? knownBlobs(blobsResult!.results) : null
  const plan = await planSnapshotV2({
    encoded,
    prepared,
    materialsDictionary: MATERIALS,
    latest: known
      ? Object.fromEntries(
          SLOTS.map((slot) => [
            slot,
            known.get((nearest![REF_COLUMNS[slot]] as number) ?? -1) ?? null,
          ]),
        )
      : {},
    existing,
  })

  // 3.
  const statements = plan.blobs.map((blob) => insertBlobStatement(d1, accountId, blob))
  statements.push(
    insertSnapshotStatement(d1, accountId, legacy, {
      takenAt,
      rawSize: upload.rawSize,
      contentKey: key,
      plan,
      meta: encodeSnapshotMeta({
        format: prepared.good.format,
        version: prepared.good.version,
        source: prepared.good.source,
        summary: prepared.summary,
        playerVars: plan.playerVars,
        ...(prepared.good.capture ? { capture: prepared.good.capture } : {}),
      }),
    }),
  )
  const snapshotIndex = statements.length - 1
  const chunkBytes = { bytes: 0 }
  statements.push(...catalogChunkStatements(d1, accountId, staged, chunkBytes))
  statements.push(
    countUploadStatement(d1, accountId, day, plan.storedSize + chunkBytes.bytes, {
      takenAt,
      contentKey: key,
    }),
    ...fillAccountStatements(d1, accountId, prepared),
    recomputeAccount(d1, accountId),
    listenerStatement(d1, accountId),
  )

  let results: D1Result<Record<string, unknown>>[]
  try {
    results = await meter.batch(d1, 'store', statements)
  } catch (error) {
    // Lost a race with a concurrent upload of the same capture time.
    if (isUniqueViolation(error, 'snapshots')) {
      const row = await d1
        .prepare(sameTimeSql(legacy))
        .bind(accountId, takenAt)
        .first<SameTimeRow>()
      if (row && sameCapture(row)) return response('unchanged', row.id, 0, null, undefined, false)
      throw new ApiError(
        409,
        'duplicate_capture',
        'A different snapshot exists for this capture time',
      )
    }
    throw error
  }
  const inserted = results[snapshotIndex]!.results[0] as { id: number } | undefined
  // A section it points at was collected in between. The batch stored only
  // sections (the next collection takes them) and the catalog chunk (which
  // the next attempt finds), so try again from the top.
  if (!inserted) throw new Retry()
  return response(
    'created',
    inserted.id,
    plan.storedSize,
    dataVersionOf(results.at(-2)) ?? null,
    listenerOf(results.at(-1)),
    !latest || takenAt >= latest.taken_at,
  )
}

/**
 * Whether an irminsul capture starts a world stay the newest snapshot does
 * not stand for: a full send of the game (`login`, `world`) in another
 * session or world than the newest snapshot's.
 */
function newWorld(capture: GiCapture | null | undefined, latestMeta: unknown): boolean {
  if (!capture || (capture.reason !== 'login' && capture.reason !== 'world')) return false
  if (latestMeta === null || latestMeta === undefined) return true
  let previous: GiCapture | undefined
  try {
    previous = decodeSnapshotMeta(toBytes(latestMeta)).capture
  } catch {
    return false
  }
  return !previous || previous.session !== capture.session || previous.world !== capture.world
}

/**
 * Parses and normalises a GOOD file; malformed input is a 400, a file over
 * GOOD_LIMITS (more items than the game holds, an overlong key) a 422, and so
 * is a capture taken halfway through a login (`partial_capture`: items but no
 * characters, which older Capture builds and irminsul can still send). Every
 * upload path (import key, Capture's Bearer, the website) comes through here.
 */
export async function parseUpload(text: string): Promise<PreparedSnapshot> {
  let input: unknown
  try {
    input = JSON.parse(text)
  } catch {
    throw new ApiError(400, 'invalid_json', 'The file is not valid JSON')
  }
  try {
    return await prepareSnapshot(input, { materials: MATERIALS })
  } catch (error) {
    if (error instanceof GoodLimitError) throw new ApiError(422, error.code, error.message)
    if (error instanceof GoodPartialCaptureError) throw new ApiError(422, error.code, error.message)
    if (error instanceof GoodFormatError) throw new ApiError(400, 'invalid_good', error.message)
    throw error
  }
}

/**
 * A capture whose `gi_player.uid` is not the account's UID is probably another
 * account's inventory. It is stored anyway (the key decides where an upload
 * goes, and irminsul warns its user too); the response and the log say so.
 * An account without a UID has nothing to compare.
 */
function uidWarnings(account: ImportTarget, prepared: PreparedSnapshot): ImportWarning[] {
  const captured = prepared.good.player?.uid
  const linked = account.uid?.trim()
  if (captured === undefined || !linked || linked === String(captured)) return []
  console.warn('uid_mismatch', JSON.stringify({ accountId: account.id, linked, captured }))
  return [
    {
      code: 'uid_mismatch',
      message: `This file is UID ${captured}, but the account is UID ${linked}. Stored anyway.`,
    },
  ]
}

/**
 * Fills what the account lacks from the capture's `gi_player`: the UID (unless
 * another of the owner's accounts has it), then, when the account's UID is
 * the capture's, the server it implies and the in-game name. Never replaces
 * what is set. Rides in the import's own batch: no extra round trip.
 */
function fillAccountStatements(
  d1: D1Database,
  accountId: number,
  prepared: PreparedSnapshot,
): D1PreparedStatement[] {
  const player = prepared.good.player
  if (player?.uid === undefined) return []
  const uid = String(player.uid)
  // After the UID statement: only an account that is (now) this UID's.
  const sameUid = 'uid = ?2'
  const statements = [
    d1
      .prepare(
        `UPDATE genshin_accounts SET uid = ?2 WHERE id = ?1 AND (uid IS NULL OR uid = '')
         AND NOT EXISTS (SELECT 1 FROM genshin_accounts AS o
           WHERE o.user_id = genshin_accounts.user_id AND o.uid = ?2)`,
      )
      .bind(accountId, uid),
  ]
  const server = serverFromUid(uid)
  if (server) {
    statements.push(
      d1
        .prepare(
          `UPDATE genshin_accounts SET server = ?3 WHERE id = ?1 AND server IS NULL AND ${sameUid}`,
        )
        .bind(accountId, uid, server),
    )
  }
  if (player.nickname) {
    statements.push(
      d1
        .prepare(
          `UPDATE genshin_accounts SET name = ?3 WHERE id = ?1 AND (name IS NULL OR name = '')
           AND ${sameUid}`,
        )
        .bind(accountId, uid, player.nickname.slice(0, 64)),
    )
  }
  return statements
}

/** v1 catalog rows (not repacked yet) by identity hash. */
function selectArtifactIds(
  d1: D1Database,
  accountId: number,
  hashes: string[],
): D1PreparedStatement {
  return d1
    .prepare(
      `SELECT a.id, a.hash FROM json_each(?2) AS j
       CROSS JOIN artifacts AS a ON a.account_id = ?1 AND a.hash = j.value`,
    )
    .bind(accountId, JSON.stringify(hashes))
}

function idMap(rows: Record<string, unknown>[]): Map<string, number> {
  return new Map(rows.map((row) => [row.hash as string, row.id as number]))
}

/** Catalog ids by packed identity, from chunk rows; and the highest chunk row id seen. */
function readChunks(rows: Record<string, unknown>[]): { ids: Map<string, number>; maxId: number } {
  const ids = new Map<string, number>()
  let maxId = 0
  for (const row of rows) {
    maxId = Math.max(maxId, row.id as number)
    for (const entry of decodeCatalogChunk(toBytes(row.data))) ids.set(entry.key, entry.id)
  }
  return { ids, maxId }
}

/**
 * Inserts catalog rows (idempotently) and returns the ids of `hashes`; also
 * any of them that a chunk written since `afterChunk` holds already.
 */
async function insertArtifacts(
  d1: D1Database,
  meter: D1Meter,
  accountId: number,
  hashes: string[],
  identities: ReadonlyMap<string, ArtifactIdentity>,
  afterChunk: number,
): Promise<{ ids: Map<string, number>; chunkIds: Map<string, number> }> {
  const now = Date.now()
  const statements: D1PreparedStatement[] = [
    d1
      .prepare('SELECT id, data FROM artifact_chunks WHERE account_id = ?1 AND id > ?2')
      .bind(accountId, afterChunk),
  ]
  for (let i = 0; i < hashes.length; i += ARTIFACT_INSERT_CHUNK) {
    const rows = hashes.slice(i, i + ARTIFACT_INSERT_CHUNK).map((hash) => {
      const a = identities.get(hash)!
      return [
        hash,
        a.setKey,
        a.slotKey,
        a.level,
        a.rarity,
        a.mainStatKey,
        compactSubstats(a.substats),
        compactSubstats(a.unactivatedSubstats),
        a.totalRolls,
        a.elixerCrafted ? 1 : 0,
      ]
    })
    statements.push(
      d1
        .prepare(
          `INSERT INTO artifacts (account_id, hash, set_key, slot_key, level, rarity, main_stat_key,
             substats, unactivated_substats, total_rolls, elixer_crafted, created_at)
           SELECT ?1, value->>0, value->>1, value->>2, value->>3, value->>4, value->>5,
             value->6, value->7, value->>8, value->>9, ?3
           FROM json_each(?2) WHERE true
           ON CONFLICT (account_id, hash) DO NOTHING`,
        )
        .bind(accountId, JSON.stringify(rows), now),
    )
  }
  statements.push(selectArtifactIds(d1, accountId, hashes))
  const results = await meter.batch(d1, 'catalog', statements)
  return {
    ids: idMap(results[results.length - 1]!.results),
    chunkIds: readChunks(results[0]!.results).ids,
  }
}

/**
 * Moves catalog rows into compact chunks: each chunk is written only while
 * every id in it still has its v1 row, and those rows are deleted only once
 * a chunk of exactly them exists, in one batch. Run against a concurrent
 * repack, every identity ends up in exactly one place.
 */
export function catalogChunkStatements(
  d1: D1Database,
  accountId: number,
  entries: readonly { id: number; identity: ArtifactIdentity }[],
  /** Adds the bytes of the chunks it writes to `written.bytes`. */
  written?: { bytes: number },
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = []
  for (let i = 0; i < entries.length; i += CATALOG_CHUNK_SIZE) {
    const part = entries.slice(i, i + CATALOG_CHUNK_SIZE)
    const ids = JSON.stringify(part.map((e) => e.id))
    const first = part[0]!.id
    const last = part.at(-1)!.id
    const data = encodeCatalogChunk(part)
    if (written) written.bytes += data.length
    statements.push(
      d1
        .prepare(
          `INSERT INTO artifact_chunks (account_id, first_id, last_id, count, data)
           SELECT ?1, ?2, ?3, ?4, ?5
           WHERE (SELECT count(*) FROM artifacts
                  WHERE account_id = ?1 AND id IN (SELECT value FROM json_each(?6))) = ?4`,
        )
        .bind(accountId, first, last, part.length, data, ids),
      d1
        .prepare(
          `DELETE FROM artifacts WHERE account_id = ?1 AND id IN (SELECT value FROM json_each(?2))
           AND EXISTS (SELECT 1 FROM artifact_chunks
                       WHERE account_id = ?1 AND first_id = ?3 AND last_id = ?4 AND count = ?5)`,
        )
        .bind(accountId, ids, first, last, part.length),
    )
  }
  return statements
}

/** Rows of LATEST_BLOBS_SQL, decoded, by id. */
function knownBlobs(rows: Record<string, unknown>[]): Map<number, KnownBlob> {
  const raw = new Map<number, RawBlob & { hash: string }>()
  for (const row of rows) {
    raw.set(row.id as number, {
      id: row.id as number,
      code: row.kind as number,
      baseId: (row.base_id as number | null) ?? null,
      data: toBytes(row.data),
      hash: (row.hash as string).toLowerCase(),
    })
  }
  const decoder = new BlobDecoder((id) => raw.get(id))
  const known = new Map<number, KnownBlob>()
  const build = (id: number): KnownBlob | null => {
    const cached = known.get(id)
    if (cached) return cached
    const blob = raw.get(id)
    if (!blob) return null
    const entry: KnownBlob = {
      id,
      code: blob.code,
      hash: blob.hash,
      size: blob.data.length,
      decoded: decoder.decode(id),
      base: blob.baseId === null ? null : build(blob.baseId),
    }
    known.set(id, entry)
    return entry
  }
  for (const id of raw.keys()) build(id)
  return known
}

/** A blob row; its base must still exist, or nothing is inserted (and the snapshot then fails). */
export function insertBlobStatement(
  d1: D1Database,
  accountId: number,
  blob: { hash: string; code: number; base: BlobRef | null; data: Uint8Array },
): D1PreparedStatement {
  const [baseId, baseHash] = refParams(blob.base)
  return d1
    .prepare(
      `INSERT INTO section_blobs (account_id, hash, kind, base_id, data)
       SELECT ?1, unhex(?2), ?3, base.id, ?4 FROM (SELECT ${refSql('?5', '?6')} AS id) AS base
       WHERE (?5 IS NULL AND ?6 IS NULL) OR base.id IS NOT NULL
       ON CONFLICT DO NOTHING`,
    )
    .bind(accountId, blob.hash, blob.code, blob.data, baseId, baseHash)
}

/** SQL for a blob's id, by id (checked to exist) or by hash; ?1 is the account. */
function refSql(idParam: string, hashParam: string): string {
  return `coalesce((SELECT id FROM section_blobs WHERE id = ${idParam} AND account_id = ?1),
    (SELECT id FROM section_blobs WHERE account_id = ?1 AND hash = unhex(${hashParam})))`
}

function refParams(ref: BlobRef | null): [number | null, string | null] {
  if (ref === null) return [null, null]
  return 'id' in ref ? [ref.id, null] : [null, ref.hash]
}

export interface SnapshotRowV2 {
  takenAt: number
  rawSize: number
  contentKey: number
  plan: Pick<SnapshotPlan, 'refs' | 'storedSize'>
  meta: Uint8Array
}

/**
 * The v2 snapshot row, inserted only when every section it names exists
 * (RETURNING then has no row). The v1 NOT NULL columns get '' / 0.
 */
function insertSnapshotStatement(
  d1: D1Database,
  accountId: number,
  legacy: boolean,
  row: SnapshotRowV2,
): D1PreparedStatement {
  const params: unknown[] = [accountId, row.takenAt, Date.now(), row.rawSize, row.plan.storedSize]
  params.push(row.contentKey, row.meta)
  const selects: string[] = []
  const guards: string[] = []
  for (const slot of SLOTS) {
    const [id, hash] = refParams(row.plan.refs[slot])
    const idParam = `?${params.push(id)}`
    const hashParam = `?${params.push(hash)}`
    selects.push(`${refSql(idParam, hashParam)} AS ${REF_COLUMNS[slot]}`)
    guards.push(
      `((${idParam} IS NULL AND ${hashParam} IS NULL) OR r.${REF_COLUMNS[slot]} IS NOT NULL)`,
    )
  }
  // While the v1 columns exist, their NOT NULL ones get '' / 0.
  const [v1Columns, v1Values] = legacy
    ? [
        `format, version, source, content_hash, characters_hash, weapons_hash, artifacts_hash,
         materials_hash, materials_keyframe_hash, summary, `,
        `'', 0, '', '', '', '', '', '', '', '', `,
      ]
    : ['', '']
  return d1
    .prepare(
      `INSERT INTO snapshots (account_id, taken_at, last_seen_at, created_at, raw_size,
         stored_size, ${v1Columns}content_key, meta, ${REFS_SQL})
       SELECT ?1, ?2, ?2, ?3, ?4, ?5, ${v1Values}?6, ?7,
         ${SLOTS.map((slot) => `r.${REF_COLUMNS[slot]}`).join(', ')}
       FROM (SELECT ${selects.join(', ')}) AS r
       WHERE ${guards.join(' AND ')}
       RETURNING id`,
    )
    .bind(...params)
}
