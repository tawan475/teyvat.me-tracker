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
  decodeSnapshotMeta,
  encodeContent,
  contentKey,
  encodeCatalogChunk,
  fillCatalogChunk,
  needsFill,
  rollsAgree,
  readCatalogChunk,
  encodeSnapshotMeta,
  encodeStaticSections,
  kindOfCode,
  olderContentHashes,
  planSnapshotV2,
  RECENT_ANCHORS,
  prepareSnapshot,
  resolveDeferredArtifacts,
  resolveImportTimestamp,
  withHeldArtifacts,
  offSectionMask,
  sameOff,
  shortHashHex,
  storedPlayer,
  uploadUid,
  BlobDecoder,
  type ArtifactFigures,
  type ArtifactIdentity,
  type BlobRef,
  type CatalogChunkParts,
  type DecodedBlob,
  type GiCapture,
  type ImportResponse,
  type ImportWarning,
  type KnownBlob,
  type PreparedSnapshot,
  type RawBlob,
  type RollsText,
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
  ROLLS_STORE_ON_SQL,
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
  created_at: number
  /** The newest time a part was removed from the account's history (null: never). */
  removed_at: number | null
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

/** Artifacts per catalog chunk an import writes (repack merges small ones). */
export const CATALOG_CHUNK_SIZE = 512

/**
 * The latest live snapshot (a v1 row's content hash only while the schema has
 * v1), with the newest time a part was removed from the account's history
 * (settings `parts.removed`, issue 12): a row stored before that no longer
 * holds what its content key names.
 */
const latestSql = (legacy: boolean) => `SELECT id, taken_at, created_at,
    ${legacy ? 'content_hash' : 'NULL AS content_hash'}, content_key, meta, ${REFS_SQL},
    (SELECT max(j.value) FROM genshin_accounts AS g,
       json_each(g.settings, '$.parts.removed') AS j WHERE g.id = ?1) AS removed_at
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
 * The snapshots before the nearest one (RECENT_ANCHORS of them, nearest
 * first): their blobs are more anchors a changed section may be compressed
 * against (store-v2 RecentBlobs). With no capture at or before the upload's
 * time the nearest is after it and there are none. ?1 the account, ?2 the
 * upload's capture time.
 */
export const RECENT_SQL = `SELECT id, ${REFS_SQL} FROM snapshots
  WHERE account_id = ?1 AND deleted_at IS NULL AND taken_at <= ?2
  ORDER BY taken_at DESC, id DESC LIMIT ${RECENT_ANCHORS} OFFSET 1`

/**
 * The v2 sections of the nearest snapshot (NEAREST_SQL) and of the ones
 * before it (RECENT_SQL), and every blob they need (bases, and their
 * dictionaries), with data: at most three levels. Nothing for a v1 row.
 */
export const LATEST_BLOBS_SQL = `WITH RECURSIVE latest AS (
    SELECT ${REFS_SQL} FROM (${NEAREST_SQL})
    UNION ALL SELECT ${REFS_SQL} FROM (${RECENT_SQL})),
  need(id, depth) AS (
    SELECT j.value, 0 FROM latest, json_each(json_array(${REFS_SQL})) AS j
    UNION SELECT b.base_id, n.depth + 1 FROM section_blobs AS b JOIN need AS n ON b.id = n.id
      WHERE b.base_id IS NOT NULL AND n.depth < 3)
  SELECT b.id, b.kind, hex(b.hash) AS hash, b.base_id, b.data FROM section_blobs AS b
  WHERE +b.account_id = ?1 AND b.id IN (SELECT id FROM need WHERE id IS NOT NULL)`

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
  /**
   * The upload's artifact list was not read: a stored section made from the
   * same list stood in for it, so `prepared.good.artifacts` is empty (the
   * summary is whole). `prepared.deferred` still holds the list.
   */
  heldArtifacts: boolean
  /** The fingerprint of the upload's artifact list, when it came with a guid per piece. */
  artifactsFingerprint?: string
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
  parsed: PreparedSnapshot,
  legacy: boolean,
  extraStoredBytes?: Promise<number>,
): Promise<ImportResult> {
  let prepared = parsed
  // The artifact list is not read yet when it came with a guid per piece
  // (parseUpload): step 1 asks whether a section made from the same list is
  // stored, and only reads the list when none is.
  const deferred = parsed.deferred
  const accountId = account.id
  const now = Date.now()
  const day = utcDay(now)
  const takenAt = resolveImportTimestamp(upload.timestamp, prepared.good.timestamp, now)
  const sections = await encodeStaticSections(prepared, MATERIALS)
  const player = prepared.good.player ? await storedPlayer(prepared.good.player) : null
  const warnings = uidWarnings(account, prepared)

  // Catalog entry for each distinct artifact identity in this upload.
  const identities = new Map<string, ArtifactIdentity>()
  // Rolls for each identity: the first piece of it whose rolls passed the
  // check (normalize drops any that do not), not simply its first piece.
  const incomingRolls = new Map<string, RollsText>()
  // Twins (one identity) whose valid rolls differ from the ones kept.
  let rollConflicts = 0
  const readIdentities = () => {
    prepared.artifactHashes.forEach((hash, i) => {
      const artifact = prepared.good.artifacts[i]!
      if (!identities.has(hash)) identities.set(hash, artifact.identity)
      if (artifact.rolls === undefined) return
      const kept = incomingRolls.get(hash)
      if (kept === undefined) incomingRolls.set(hash, artifact.rolls)
      else if (!rollsAgree(kept, artifact.rolls)) rollConflicts++
    })
    return [...identities.keys()]
  }
  let hashes = deferred ? [] : readIdentities()
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
    recentResult,
    sameTimeResult,
    idsResult,
    chunksResult,
    blobsResult,
    existingResult,
    usageResult,
    markResult,
  ] = await meter.batch(d1, 'lookup', [
    d1.prepare(latestSql(legacy)).bind(accountId),
    d1.prepare(NEAREST_SQL).bind(accountId, takenAt),
    d1.prepare(RECENT_SQL).bind(accountId, takenAt),
    d1.prepare(sameTimeSql(legacy)).bind(accountId, takenAt),
    deferred
      ? d1.prepare('SELECT id, hash FROM artifacts WHERE account_id = ?1').bind(accountId)
      : selectArtifactIds(d1, accountId, hashes),
    // The catalog is read only when the list will be: not while a section
    // made from the same list is stored.
    deferred
      ? d1
          .prepare(
            `SELECT id, data FROM artifact_chunks
             WHERE account_id = ?1 AND NOT EXISTS (${HELD_ARTIFACTS_SQL})`,
          )
          .bind(accountId, deferred.fingerprint)
      : d1.prepare('SELECT id, data FROM artifact_chunks WHERE account_id = ?1').bind(accountId),
    d1.prepare(LATEST_BLOBS_SQL).bind(accountId, takenAt),
    d1
      .prepare(
        `SELECT b.id, hex(b.hash) AS hash, b.kind FROM json_each(?2) AS j
           CROSS JOIN section_blobs AS b ON b.account_id = ?1 AND b.hash = unhex(j.value)`,
      )
      .bind(accountId, JSON.stringify(staticHashes)),
    usageStatement(d1, accountId, day),
    d1.prepare(HELD_ARTIFACTS_SQL).bind(accountId, deferred?.fingerprint ?? ''),
  ])
  const held = deferred ? readHeldArtifacts(markResult!.results[0]) : null
  if (deferred && !held) {
    prepared = await resolveDeferredArtifacts(parsed)
    hashes = readIdentities()
  } else if (held) {
    prepared = withHeldArtifacts(parsed, held.figures)
  }
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
  let staged: { id: number; identity: ArtifactIdentity; rolls?: RollsText }[] = []
  // What the store batch checks before it writes: no other upload added a
  // chunk to this account's catalog since this one read it.
  let catalogGuard: CatalogGuard | null = null
  // Exact rolls are written only while the `rolls.store` switch is on.
  const storeRolls = usage?.storeRolls ?? false
  // New pieces whose rolls the switch kept out of their chunk.
  let rollsWithheld = false
  const chunkRows = [...chunks.rows]
  if (missing.length > 0) {
    // An artifact the catalog lacks: this upload stores a snapshot.
    assertCanStore(usage, now)
    const reserved = await reserveArtifactIds(d1, meter, accountId, missing.length, chunks.maxId)
    chunkRows.push(...reserved.chunkRows)
    for (const [i, hash] of missing.entries()) {
      // A chunk written since step 1 may hold it already: use that id.
      const held = reserved.chunkIds.get(keys.get(hash)!)
      const id = held ?? reserved.first + i
      artifactIds.set(hash, id)
      if (held !== undefined) continue
      const rolls = incomingRolls.get(hash)
      if (rolls !== undefined && !storeRolls) rollsWithheld = true
      staged.push({
        id,
        identity: identities.get(hash)!,
        ...(rolls !== undefined && storeRolls ? { rolls } : {}),
      })
    }
    staged = staged.sort((x, y) => x.id - y.id)
    catalogGuard = {
      afterChunk: reserved.maxChunkId,
      first: reserved.first,
      last: reserved.first + missing.length - 1,
    }
  }

  const encoded = await encodeContent(sections, prepared, artifactIds, held?.sectionHash)
  const key = contentKey(encoded.contentHash)
  // Every other hash this file had under older trackers (olderContentHashes
  // is most of the hashing work): worked out only for a snapshot of the same
  // capture time whose key is not this upload's own (sameCapture).
  let olderHashes: Promise<string[]> | undefined
  const older = () =>
    (olderHashes ??= olderContentHashes(
      sections,
      encoded,
      prepared,
      artifactIds,
      held?.sectionHash,
    ).then((o) => [
      encoded.legacyContentHash,
      encoded.preAnecdotesContentHash,
      encoded.preTasksContentHash,
      encoded.preCollectionsContentHash,
      encoded.preCollections2ContentHash,
      encoded.preWardrobeContentHash,
      encoded.preExplorationContentHash,
      o.pre17ContentHash,
      o.pre18ContentHash,
      o.pre19ContentHash,
      o.pre20ContentHash,
      o.pre21ContentHash,
      o.pre22ContentHash,
      o.preRecipesContentHash,
      // Stored before the tracker dropped fields it no longer keeps (dropped.ts).
      ...o.preDropContentHashes,
    ]))
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
    heldArtifacts: held !== null,
    ...(deferred ? { artifactsFingerprint: deferred.fingerprint } : {}),
  })
  // The same capture, also when it was stored before irminsul's extra keys
  // (or later its anecdotes, tasks, collections, Capture 1.4.0's keys, then
  // its exploration, then Capture 1.7.0's, then 1.8.0's, then 1.17's, then 1.17.12's, then 1.17.20's, then 1.17.21's parts) were kept
  // (its hash then left them out), in either storage format.
  const sameCapture = async (row: SameTimeRow) => {
    if (
      row.content_key !== null ? row.content_key === key : row.content_hash === encoded.contentHash
    ) {
      return true
    }
    const hashes = await older()
    return row.content_key !== null
      ? hashes.some((hash) => contentKey(hash) === row.content_key)
      : hashes.includes(row.content_hash!)
  }
  const sameInventory = (row: LatestRow) =>
    (row.content_key !== null
      ? row.content_key === key
      : row.content_hash === encoded.contentHash) &&
    // A part removed from history since the row was stored: its key names
    // what it held before, so an equal upload brings the part back (issue 12).
    (row.removed_at === null || row.removed_at < row.created_at) &&
    // Capture's switches changed: the pages' "Not shared" notes read them
    // from the newest snapshot, so it is stored even when equal.
    sameOff(prepared.good.off, offOf(row.meta))

  if (sameTime) {
    // A re-upload of the same capture is a no-op, so uploaders can retry freely.
    if (await sameCapture(sameTime)) {
      return response('unchanged', sameTime.id, 0, null, undefined, sameTime.id === latest?.id)
    }
    throw new ApiError(
      409,
      'duplicate_capture',
      'A different snapshot exists for this capture time',
    )
  }

  // Rolls for pieces the catalog has already (in a chunk: a piece still in
  // the v1 `artifacts` table gets none), written by a compare-and-swap of
  // each chunk row that lacks some, in the batch below.
  const rollsByKey = new Map<string, RollsText>()
  for (const [hash, rolls] of incomingRolls) {
    if (!legacyIds.has(hash)) rollsByKey.set(keys.get(hash)!, rolls)
  }
  const planned = planFills(chunkRows, rollsByKey, storeRolls, accountId)
  if (rollConflicts + planned.conflicts > 0) {
    console.warn(
      'rolls_conflict',
      JSON.stringify({ accountId, count: rollConflicts + planned.conflicts }),
    )
  }
  const fills = planned.fills.map((fill) => fillStatement(d1, accountId, fill))
  // The held-list mark says "this list is dealt with": not while a fill rides
  // in the batch (a lost swap would leave the list held, its rolls unwritten)
  // or rows are left for a later upload (FILLS_PER_BATCH). While the switch
  // keeps out rolls a fill or a new chunk would write, the mark is written
  // flagged (`withheld`): it holds the list only while the switch stays off
  // (HELD_ARTIFACTS_SQL), so the first upload after turning it on is read in
  // full and fills. A mark written while on is never flagged.
  const withheld = !storeRolls && (planned.pending || rollsWithheld)
  const markList = !!deferred && !held && fills.length === 0 && !planned.deferred

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
    const seen = [
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
    ]
    const fillsAt = seen.length
    seen.push(...fills)
    // The list was read: the newest snapshot (equal to this upload) was made
    // from it, so the next upload of it need not be (named by its own id).
    if (markList) {
      seen.push(
        markArtifactsStatement(d1, accountId, {
          fingerprint: deferred!.fingerprint,
          sectionHash: encoded.artifacts.hash,
          figures: prepared.summary,
          snapshot: { id: latest.id },
          withheld,
          now,
        }),
      )
    }
    const results = await meter.batch(d1, 'seen', seen)
    logFills(accountId, results, fillsAt, planned.fills)
    const [, bumped, listening] = results
    return response('unchanged', latest.id, 0, dataVersionOf(bumped) ?? null, listenerOf(listening))
  }

  assertCanStore(usage, now)

  // The nearest snapshot's sections (NEAREST_SQL) are what new ones are
  // deltas of or compressed against; a v1 row has none, so everything is
  // stored whole (once per account, until repack converts it).
  // (A held artifacts section is pointed at as it is: the neighbour's is not decoded.)
  const known =
    nearest?.characters_ref != null ? knownBlobs(blobsResult!.results, held !== null) : null
  const blobsOf = (row: Record<string, unknown>, slot: Slot) =>
    known!.get((row[REF_COLUMNS[slot]] as number | null) ?? -1) ?? null
  const plan = await planSnapshotV2({
    encoded,
    prepared,
    materialsDictionary: MATERIALS,
    latest: known ? Object.fromEntries(SLOTS.map((slot) => [slot, blobsOf(nearest!, slot)])) : {},
    recent: known
      ? Object.fromEntries(
          SLOTS.map((slot) => [slot, recentResult!.results.map((row) => blobsOf(row, slot))]),
        )
      : {},
    existing,
    ...(held ? { held: { artifacts: held.blobId } } : {}),
  })

  // 3.
  const statements = plan.blobs.map((blob) => insertBlobStatement(d1, accountId, blob))
  statements.push(
    insertSnapshotStatement(d1, accountId, legacy, catalogGuard, {
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
        ...(prepared.good.off ? { off: prepared.good.off } : {}),
      }),
      offSections: offSectionMask(prepared.good.off),
    }),
  )
  const snapshotIndex = statements.length - 1
  const chunkBytes = { bytes: 0 }
  if (catalogGuard) {
    statements.push(...newChunkStatements(d1, accountId, staged, catalogGuard, chunkBytes))
  }
  // Rolls onto pieces the catalog had: their bytes are not counted in the
  // day's upload (the storage quota sums the table as it is).
  const fillsAt = statements.length
  statements.push(...fills)
  // The list this snapshot's artifacts section was made from, for the next upload.
  if (markList) {
    statements.push(
      markArtifactsStatement(d1, accountId, {
        fingerprint: deferred!.fingerprint,
        sectionHash: encoded.artifacts.hash,
        figures: prepared.summary,
        snapshot: { takenAt, contentKey: key },
        withheld,
        now,
      }),
    )
  }
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
      if (row && (await sameCapture(row)))
        return response('unchanged', row.id, 0, null, undefined, false)
      throw new ApiError(
        409,
        'duplicate_capture',
        'A different snapshot exists for this capture time',
      )
    }
    throw error
  }
  logFills(accountId, results, fillsAt, planned.fills)
  const inserted = results[snapshotIndex]!.results[0] as { id: number } | undefined
  // A section it points at was collected in between, or another upload added
  // to the catalog since this one read it (its chunk may hold a piece this
  // one was about to store again). The batch stored only sections (the next
  // collection takes them), so try again from the top.
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

/** A stored meta's `gi_off` (undefined: none, or a meta that does not decode). */
function offOf(meta: unknown): string[] | undefined {
  if (meta === null || meta === undefined) return undefined
  try {
    return decodeSnapshotMeta(toBytes(meta)).off
  } catch {
    return undefined
  }
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
    return await prepareSnapshot(input, { materials: MATERIALS, deferArtifacts: true })
  } catch (error) {
    if (error instanceof GoodLimitError) throw new ApiError(422, error.code, error.message)
    if (error instanceof GoodPartialCaptureError) throw new ApiError(422, error.code, error.message)
    if (error instanceof GoodFormatError) throw new ApiError(400, 'invalid_good', error.message)
    throw error
  }
}

/**
 * A capture whose UID (`uploadUid`: `gi_player.uid`, else `metadata.uid`) is
 * not the account's UID is probably another
 * account's inventory. It is stored anyway (the key decides where an upload
 * goes, and irminsul warns its user too); the response and the log say so.
 * An account without a UID has nothing to compare.
 */
function uidWarnings(account: ImportTarget, prepared: PreparedSnapshot): ImportWarning[] {
  const captured = uploadUid(prepared.good)
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
 * Fills what the account lacks from the capture: the UID (`uploadUid`; unless
 * another of the owner's accounts has it), then, when the account's UID is
 * the capture's, the server it implies and the in-game name (`gi_player`
 * only). Never replaces what is set. Rides in the import's own batch: no
 * extra round trip.
 */
function fillAccountStatements(
  d1: D1Database,
  accountId: number,
  prepared: PreparedSnapshot,
): D1PreparedStatement[] {
  const player = prepared.good.player
  const fileUid = uploadUid(prepared.good)
  if (fileUid === undefined) return []
  const uid = String(fileUid)
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
  // The name only when the UID used is gi_player's own: a file whose
  // gi_player.uid is broken (its UID from metadata.uid) names nothing.
  if (player?.uid !== undefined && player.nickname) {
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

/**
 * The stored artifacts section made from the list with fingerprint `?2`, for
 * account `?1`: its blob (which must still be there), its full hash and the
 * figures the summary takes from the list. No row: the list has to be read.
 * A mark written while the `rolls.store` switch kept rolls out (`w` in its
 * info) holds only while the switch is off: once on, that list is read in
 * full so its rolls are filled. Ordinary marks never read `site_settings`.
 */
const HELD_ARTIFACTS_SQL = `SELECT m.blob_id AS blobId, hex(m.section_hash) AS sectionHash, m.info
  FROM part_marks AS m JOIN section_blobs AS b ON b.id = m.blob_id AND b.account_id = m.account_id
  WHERE m.account_id = ?1 AND m.part = 'artifacts' AND m.fingerprint = unhex(?2)
    AND (CASE WHEN json_valid(m.info) THEN json_extract(m.info, '$.w') END IS NULL
         OR NOT ${ROLLS_STORE_ON_SQL})`

interface HeldArtifacts {
  blobId: number
  /** 32 hex digits: the full section's content hash. */
  sectionHash: string
  figures: ArtifactFigures
}

function readHeldArtifacts(row: Record<string, unknown> | undefined): HeldArtifacts | null {
  if (!row) return null
  try {
    const info = JSON.parse(row.info as string) as {
      v?: unknown
      n?: unknown
      a3?: unknown
      a4?: unknown
    }
    const sectionHash = (row.sectionHash as string).toLowerCase()
    const whole = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0
    if (info.v !== 1 || !whole(info.n) || !whole(info.a3) || !whole(info.a4)) return null
    if (!/^[0-9a-f]{32}$/.test(sectionHash)) return null
    return {
      blobId: row.blobId as number,
      sectionHash,
      figures: { artifacts: info.n, artifact3: info.a3, artifact4: info.a4 },
    }
  } catch {
    return null
  }
}

/**
 * Remembers which list the artifacts section of a snapshot was made from
 * (one row per account: the newest list), once that snapshot row is there:
 * the one this batch stores (by its capture time and content key), or the
 * stored one an upload was seen again as (by its own id).
 */
function markArtifactsStatement(
  d1: D1Database,
  accountId: number,
  mark: {
    fingerprint: string
    sectionHash: string
    figures: ArtifactFigures
    snapshot: { takenAt: number; contentKey: number } | { id: number }
    /** The `rolls.store` switch kept out rolls this list brought: `w` (see HELD_ARTIFACTS_SQL). */
    withheld: boolean
    now: number
  },
): D1PreparedStatement {
  const info = JSON.stringify({
    v: 1,
    n: mark.figures.artifacts,
    a3: mark.figures.artifact3,
    a4: mark.figures.artifact4,
    ...(mark.withheld ? { w: 1 } : {}),
  })
  const { snapshot } = mark
  const [which, params] =
    'id' in snapshot
      ? ['s.id = ?6', [snapshot.id]]
      : ['s.taken_at = ?6 AND s.content_key = ?7', [snapshot.takenAt, snapshot.contentKey]]
  return d1
    .prepare(
      `INSERT INTO part_marks (account_id, part, fingerprint, section_hash, blob_id, info, updated_at)
       SELECT ?1, 'artifacts', unhex(?2), unhex(?3), s.artifacts_ref, ?4, ?5 FROM snapshots AS s
       WHERE s.account_id = ?1 AND ${which} AND s.deleted_at IS NULL
         AND s.artifacts_ref IS NOT NULL
       ON CONFLICT (account_id, part) DO UPDATE SET fingerprint = excluded.fingerprint,
         section_hash = excluded.section_hash, blob_id = excluded.blob_id, info = excluded.info,
         updated_at = excluded.updated_at`,
    )
    .bind(accountId, mark.fingerprint, mark.sectionHash, info, mark.now, ...params)
}

/** v1 catalog rows (not repacked yet) by identity hash. */
function selectArtifactIds(
  d1: D1Database,
  accountId: number,
  hashes: string[],
): D1PreparedStatement {
  return d1
    .prepare(
      // Walks the account's v1 rows (none, but for a handful of accounts) and
      // only then looks at the hashes: the `+` keeps SQLite from seeking the
      // index once per hash, which read a row per artifact of every upload
      // (30% of all the rows the database read) to find nothing.
      `SELECT a.id, a.hash FROM artifacts AS a
       WHERE a.account_id = ?1 AND +a.hash IN (SELECT value FROM json_each(?2))`,
    )
    .bind(accountId, JSON.stringify(hashes))
}

function idMap(rows: Record<string, unknown>[]): Map<string, number> {
  return new Map(rows.map((row) => [row.hash as string, row.id as number]))
}

/** A catalog chunk row as read: its id, its bytes exactly as stored, and them read apart. */
interface ChunkRow {
  id: number
  data: Uint8Array
  parts: CatalogChunkParts
}

/**
 * Catalog ids by packed identity, from chunk rows; the highest chunk row id
 * seen; and the rows themselves (a fill swaps a row's bytes only while they
 * are still the ones read here).
 */
function readChunks(rows: Record<string, unknown>[]): {
  ids: Map<string, number>
  maxId: number
  rows: ChunkRow[]
} {
  const ids = new Map<string, number>()
  const read: ChunkRow[] = []
  let maxId = 0
  for (const row of rows) {
    maxId = Math.max(maxId, row.id as number)
    const data = toBytes(row.data)
    const parts = readCatalogChunk(data)
    for (const entry of parts.entries) ids.set(entry.key, entry.id)
    read.push({ id: row.id as number, data, parts })
  }
  return { ids, maxId, rows: read }
}

/** New bytes for one chunk row, swapped in only while it still holds `old`. */
interface ChunkFill {
  id: number
  old: Uint8Array
  data: Uint8Array
  /** How many of the row's entries get rolls. */
  pieces: number
}

/**
 * Fill statements one batch carries at most: each binds a chunk row's old
 * and new bytes, so a first fill of a long history is spread over uploads
 * (no mark is written until none is left).
 */
export const FILLS_PER_BATCH = 16

/**
 * What the rolls of an upload (`rollsByKey`: packed identity to checked
 * rolls) would write onto the chunk rows read: `pending` when some entry
 * there lacks them (`needsFill`), `fills` the new bytes per row when
 * `store` (the `rolls.store` switch) allows writing, each verified before
 * it is used, at most FILLS_PER_BATCH of them (`deferred`: rows left for a
 * later upload); `conflicts` the entries whose stored rolls differ (kept).
 */
function planFills(
  rows: readonly ChunkRow[],
  rollsByKey: ReadonlyMap<string, RollsText>,
  store: boolean,
  accountId: number,
): { fills: ChunkFill[]; pending: boolean; deferred: boolean; conflicts: number } {
  const fills: ChunkFill[] = []
  let pending = false
  let deferred = false
  let conflicts = 0
  if (rollsByKey.size === 0) return { fills, pending, deferred, conflicts }
  for (const row of rows) {
    let pieces = 0
    for (const entry of row.parts.entries) {
      const incoming = rollsByKey.get(entry.key)
      if (incoming === undefined) continue
      if (needsFill(entry.rolls, incoming)) pieces++
      // A conflict is other tiers: `~` rolls that agree with stored ordered
      // ones (or the reverse) are the same rolls, known less well.
      else if (entry.rolls !== undefined && !rollsAgree(entry.rolls, incoming)) conflicts++
    }
    if (pieces === 0) continue
    pending = true
    if (!store) continue
    if (fills.length >= FILLS_PER_BATCH) {
      deferred = true
      continue
    }
    const data = fillCatalogChunk(row.data, rollsByKey)
    if (data !== row.data && fillVerified(row.parts, data, rollsByKey)) {
      fills.push({ id: row.id, old: row.data, data, pieces })
    } else {
      console.warn('rolls_fill_mismatch', JSON.stringify({ accountId, chunk: row.id }))
    }
  }
  return { fills, pending, deferred, conflicts }
}

/**
 * True when `data` is `before` with exactly the intended rolls added: the
 * same bytes up to the rolls block (count, ids, packed identities), the same
 * ids and keys in the same order, every stored roll kept unless `needsFill`
 * lets the incoming one replace it. (Exported for tests.)
 */
export function fillVerified(
  before: CatalogChunkParts,
  data: Uint8Array,
  rollsByKey: ReadonlyMap<string, RollsText>,
): boolean {
  let after: CatalogChunkParts
  try {
    after = readCatalogChunk(data)
  } catch {
    return false
  }
  if (after.identitiesEnd !== before.identitiesEnd) return false
  for (let i = 0; i < before.identitiesEnd; i++) {
    if (after.body[i] !== before.body[i]) return false
  }
  if (after.entries.length !== before.entries.length) return false
  return before.entries.every((entry, i) => {
    const next = after.entries[i]!
    const incoming = rollsByKey.get(entry.key)
    const wanted =
      incoming !== undefined && needsFill(entry.rolls, incoming) ? incoming : entry.rolls
    return next.id === entry.id && next.key === entry.key && next.rolls === wanted
  })
}

/** Swaps a chunk row's bytes for its filled ones while it still holds the ones read (RETURNING: landed). */
function fillStatement(d1: D1Database, accountId: number, fill: ChunkFill): D1PreparedStatement {
  return d1
    .prepare(
      `UPDATE artifact_chunks SET data = ?4 WHERE id = ?2 AND account_id = ?1 AND data = ?3
       RETURNING id`,
    )
    .bind(accountId, fill.id, fill.old, fill.data)
}

/**
 * Logs the fills of a batch (`fills`, from result index `from`): those that
 * found their row changed (`rolls_fill_lost`; not retried, the next read
 * fills) and those that landed (`rolls_filled`: rows and pieces). Numbers only.
 */
function logFills(
  accountId: number,
  results: readonly D1Result<Record<string, unknown>>[],
  from: number,
  fills: readonly ChunkFill[],
): void {
  let lost = 0
  let rows = 0
  let pieces = 0
  fills.forEach((fill, i) => {
    if (results[from + i]!.results.length === 0) {
      lost++
    } else {
      rows++
      pieces += fill.pieces
    }
  })
  if (lost > 0) console.warn('rolls_fill_lost', JSON.stringify({ accountId, lost }))
  if (rows > 0) console.log('rolls_filled', JSON.stringify({ accountId, rows, pieces }))
}

/** What a store batch needs to know that the catalog is still as this upload read it. */
interface CatalogGuard {
  /** The newest chunk row this upload has seen. */
  afterChunk: number
  /** The catalog ids this upload reserved (its own chunks start inside them). */
  first: number
  last: number
}

/** True while no other upload has written a chunk since `afterChunk` (account `?1`). */
function catalogGuardSql(afterChunk: string, first: string, last: string): string {
  return `NOT EXISTS (SELECT 1 FROM artifact_chunks WHERE account_id = ?1 AND id > ${afterChunk}
            AND (first_id < ${first} OR first_id > ${last}))`
}

/**
 * Reserves `count` catalog ids in a row (returns the first) without writing
 * a row per artifact: a placeholder row takes the next id of the `artifacts`
 * sequence, a second one at the range's end moves the sequence past it, and
 * both are deleted, all in one batch. The ids come from the sequence the v1
 * rows used, so they never meet an id given out before. Also reads the
 * chunks written since `afterChunk` (their identities, and the newest row).
 *
 * Until 2026-11 every new artifact was inserted into `artifacts` here and
 * deleted again once its chunk was written: four row writes per piece, three
 * quarters of all the rows the database wrote.
 */
async function reserveArtifactIds(
  d1: D1Database,
  meter: D1Meter,
  accountId: number,
  count: number,
  afterChunk: number,
): Promise<{
  first: number
  chunkIds: Map<string, number>
  maxChunkId: number
  /** The chunk rows written since `afterChunk`, as read. */
  chunkRows: ChunkRow[]
}> {
  const now = Date.now()
  const tag = `~reserve:${crypto.randomUUID()}`
  const columns = `account_id, hash, set_key, slot_key, level, rarity, main_stat_key,
           substats, unactivated_substats, total_rolls, elixer_crafted, created_at`
  const blank = `'', '', 0, 0, '', '[]', '[]', 0, 0, ?3`
  const statements: D1PreparedStatement[] = [
    d1
      .prepare('SELECT id, data FROM artifact_chunks WHERE account_id = ?1 AND id > ?2')
      .bind(accountId, afterChunk),
    d1
      .prepare(`INSERT INTO artifacts (${columns}) VALUES (?1, ?2, ${blank}) RETURNING id`)
      .bind(accountId, `${tag}:a`, now),
  ]
  if (count > 1) {
    statements.push(
      d1
        .prepare(
          `INSERT INTO artifacts (id, ${columns})
           SELECT id + ?4, ?1, ?5, ${blank} FROM artifacts WHERE account_id = ?1 AND hash = ?2`,
        )
        .bind(accountId, `${tag}:a`, now, count - 1, `${tag}:b`),
    )
  }
  statements.push(
    d1
      .prepare('DELETE FROM artifacts WHERE account_id = ?1 AND hash IN (?2, ?3)')
      .bind(accountId, `${tag}:a`, `${tag}:b`),
  )
  const results = await meter.batch(d1, 'catalog', statements)
  const first = (results[1]!.results[0] as { id: number } | undefined)?.id
  if (first === undefined) throw new Error('No catalog ids were reserved')
  const read = readChunks(results[0]!.results)
  return {
    first,
    chunkIds: read.ids,
    maxChunkId: Math.max(afterChunk, read.maxId),
    chunkRows: read.rows,
  }
}

/**
 * The chunks of an upload's new catalog entries (ids it reserved), written
 * only while `guard` holds: the snapshot beside them carries the same check,
 * so either all of it is stored or none.
 */
function newChunkStatements(
  d1: D1Database,
  accountId: number,
  /** `rolls` only while the `rolls.store` switch is on (chunks without any keep formats 1/2). */
  entries: readonly { id: number; identity: ArtifactIdentity; rolls?: RollsText }[],
  guard: CatalogGuard,
  /** Adds the bytes of the chunks it writes to `written.bytes`. */
  written: { bytes: number },
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = []
  for (let i = 0; i < entries.length; i += CATALOG_CHUNK_SIZE) {
    const part = entries.slice(i, i + CATALOG_CHUNK_SIZE)
    const data = encodeCatalogChunk(part)
    written.bytes += data.length
    statements.push(
      d1
        .prepare(
          `INSERT INTO artifact_chunks (account_id, first_id, last_id, count, data)
           SELECT ?1, ?2, ?3, ?4, ?5 WHERE ${catalogGuardSql('?6', '?7', '?8')}`,
        )
        .bind(
          accountId,
          part[0]!.id,
          part.at(-1)!.id,
          part.length,
          data,
          guard.afterChunk,
          guard.first,
          guard.last,
        ),
    )
  }
  return statements
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

/**
 * Rows of LATEST_BLOBS_SQL by id, each decoded on its first read (planSections
 * reads only the neighbour sections it compresses or diffs against: one whose
 * hash matches decodes nothing). A base missing from the rows fails here, as
 * it did when every row was decoded up front; a chain of any depth whose
 * bases are all among the rows decodes.
 */
function knownBlobs(
  rows: Record<string, unknown>[],
  /** Leaves the artifacts section's blobs out (and undecoded). */
  withoutArtifacts = false,
): Map<number, KnownBlob> {
  const raw = new Map<number, RawBlob & { hash: string }>()
  for (const row of rows) {
    if (withoutArtifacts && kindOfCode(row.kind as number).kind === 'artifacts') continue
    raw.set(row.id as number, {
      id: row.id as number,
      code: row.kind as number,
      baseId: (row.base_id as number | null) ?? null,
      data: toBytes(row.data),
      hash: (row.hash as string).toLowerCase(),
    })
  }
  const decoder = new BlobDecoder((id) => raw.get(id))
  // Every base a row names must be among the rows (the decoder's message).
  // A chain that loops is refused as the decoder's depth limit refused it.
  for (const blob of raw.values()) {
    const seen = new Set([blob.id])
    for (let base = blob.baseId; base !== null; base = raw.get(base)!.baseId) {
      if (!raw.has(base)) throw new Error(`Section ${base} is missing`)
      if (seen.has(base)) throw new Error(`Section ${base} is deeper than a base of a base`)
      seen.add(base)
    }
  }
  // Bases first, so the decoder (which reads at most a base of a base) finds
  // each one decoded already: the old loop decoded every row in row order, so
  // a chain deeper than that decoded whenever its bases came first.
  const decode = (id: number): DecodedBlob => {
    const baseId = raw.get(id)!.baseId
    if (baseId !== null) decode(baseId)
    return decoder.decode(id)
  }
  const known = new Map<number, KnownBlob>()
  const build = (id: number): KnownBlob | null => {
    const cached = known.get(id)
    if (cached) return cached
    const blob = raw.get(id)
    if (!blob) return null
    const entry = {
      id,
      code: blob.code,
      hash: blob.hash,
      size: blob.data.length,
      base: blob.baseId === null ? null : build(blob.baseId),
    } as KnownBlob
    // The decoder keeps what it decoded: each blob is decoded once at most.
    Object.defineProperty(entry, 'decoded', { get: () => decode(id), enumerable: true })
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
  /** The build sections the upload's gi_off left out (offSectionMask). */
  offSections: number
}

/**
 * The v2 snapshot row, inserted only when every section it names exists
 * (RETURNING then has no row). The v1 NOT NULL columns get '' / 0.
 */
function insertSnapshotStatement(
  d1: D1Database,
  accountId: number,
  legacy: boolean,
  /** Set when the upload adds to the catalog: nothing is stored once it moved. */
  catalog: CatalogGuard | null,
  row: SnapshotRowV2,
): D1PreparedStatement {
  const params: unknown[] = [accountId, row.takenAt, Date.now(), row.rawSize, row.plan.storedSize]
  params.push(row.contentKey, row.meta, row.offSections)
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
  if (catalog) {
    guards.push(
      catalogGuardSql(
        `?${params.push(catalog.afterChunk)}`,
        `?${params.push(catalog.first)}`,
        `?${params.push(catalog.last)}`,
      ),
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
         stored_size, ${v1Columns}content_key, meta, off_sections, ${REFS_SQL})
       SELECT ?1, ?2, ?2, ?3, ?4, ?5, ${v1Values}?6, ?7, ?8,
         ${SLOTS.map((slot) => `r.${REF_COLUMNS[slot]}`).join(', ')}
       FROM (SELECT ${selects.join(', ')}) AS r
       WHERE ${guards.join(' AND ')}
       RETURNING id`,
    )
    .bind(...params)
}
