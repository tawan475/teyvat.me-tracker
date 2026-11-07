/**
 * A guest's GOOD import, in the browser: worker/services/import.ts without
 * D1. The same steps in the same order, so a file stores here what it would
 * store on an account: parse and normalise (prepareSnapshot), catalog ids for
 * new artifacts, the content key, then either nothing (the same capture
 * again), a later sighting of the same inventory (last seen moves), or a new
 * snapshot planned by planSnapshotV2 (store-v2's planSections) against the
 * snapshot nearest in time.
 */

import {
  BlobDecoder,
  GoodFormatError,
  GoodLimitError,
  GoodPartialCaptureError,
  SLOTS,
  artifactKeyString,
  completeSnapshot,
  contentKey,
  decodeSnapshotMeta,
  encodeSnapshotMeta,
  encodeStaticSections,
  planSnapshotV2,
  prepareSnapshot,
  resolveImportTimestamp,
  serverFromUid,
  type ArtifactIdentity,
  type BlobRef,
  type GiCapture,
  type ImportResponse,
  type KeyDictionary,
  type KnownBlob,
  type PreparedSnapshot,
} from '@gdt/shared'
import { LocalApiError } from './errors'
import type { BlobRow, LocalStore, SnapshotRow, Transaction } from './local-store'

let materials: Promise<KeyDictionary> | null = null
function materialsDictionary(): Promise<KeyDictionary> {
  materials ??= import('@gdt/shared/dictionary/materials').then((m) => m.MATERIALS)
  return materials
}

/** Parses and normalises a GOOD file, with the server's error codes. */
export async function parseGood(text: string): Promise<PreparedSnapshot> {
  let input: unknown
  try {
    input = JSON.parse(text)
  } catch {
    throw new LocalApiError(400, 'invalid_json', 'The file is not valid JSON')
  }
  try {
    return await prepareSnapshot(input, { materials: await materialsDictionary() })
  } catch (error) {
    if (error instanceof GoodLimitError) throw new LocalApiError(422, error.code, error.message)
    if (error instanceof GoodPartialCaptureError) {
      throw new LocalApiError(422, error.code, error.message)
    }
    if (error instanceof GoodFormatError) {
      throw new LocalApiError(400, 'invalid_good', error.message)
    }
    throw error
  }
}

/** Every content key a snapshot of this capture may have been stored under (old hashes too). */
function captureKeys(encoded: object): Set<number> {
  const keys = new Set<number>()
  for (const [name, value] of Object.entries(encoded)) {
    if ((name === 'contentHash' || name.endsWith('ContentHash')) && typeof value === 'string') {
      keys.add(contentKey(value))
    }
  }
  return keys
}

/** Whether a full send of the game starts a world stay the newest snapshot doesn't stand for. */
function newWorld(capture: GiCapture | null | undefined, latest: SnapshotRow): boolean {
  if (!capture || (capture.reason !== 'login' && capture.reason !== 'world')) return false
  let previous: GiCapture | undefined
  try {
    previous = decodeSnapshotMeta(latest.meta).capture
  } catch {
    return false
  }
  return !previous || previous.session !== capture.session || previous.world !== capture.world
}

/** The snapshot an upload is stored against: the nearest at or before its time, else the first after. */
function nearestOf(store: LocalStore, takenAt: number): SnapshotRow | null {
  let before: SnapshotRow | null = null
  let after: SnapshotRow | null = null
  for (const row of store.snapshots.values()) {
    if (row.takenAt <= takenAt) {
      if (
        !before ||
        row.takenAt > before.takenAt ||
        (row.takenAt === before.takenAt && row.id > before.id)
      ) {
        before = row
      }
    } else if (
      !after ||
      row.takenAt < after.takenAt ||
      (row.takenAt === after.takenAt && row.id < after.id)
    ) {
      after = row
    }
  }
  return before ?? after
}

/** A blob with its bases, decoded (as knownBlobs reads them from D1). */
function knownBlobs(store: LocalStore, ids: readonly (number | null)[]): Map<number, KnownBlob> {
  const decoder = new BlobDecoder((id) => store.blobs.get(id))
  const known = new Map<number, KnownBlob>()
  const build = (id: number, depth: number): KnownBlob | null => {
    const cached = known.get(id)
    if (cached) return cached
    const blob = store.blobs.get(id)
    if (!blob || depth > 3) return null
    const entry: KnownBlob = {
      id,
      code: blob.code,
      hash: blob.hash,
      size: blob.data.length,
      decoded: decoder.decode(id),
      base: blob.baseId === null ? null : build(blob.baseId, depth + 1),
    }
    known.set(id, entry)
    return entry
  }
  for (const id of ids) if (id !== null) build(id, 0)
  return known
}

/** Fills what the account lacks from the capture's `gi_player` (never replaces what is set). */
function fillAccount(tx: Transaction, prepared: PreparedSnapshot): void {
  const player = prepared.good.player
  if (player?.uid === undefined) return
  const account = tx.account()
  const uid = String(player.uid)
  let changed = false
  if (!account.uid) {
    account.uid = uid
    changed = true
  }
  if (account.uid === uid) {
    const server = serverFromUid(uid)
    if (server && !account.server) {
      account.server = server
      changed = true
    }
    if (player.nickname && !account.name) {
      account.name = player.nickname.slice(0, 64)
      changed = true
    }
  }
  if (changed) tx.saveAccount()
}

export interface LocalUpload {
  text: string
  rawSize: number
  /** The uploader's explicit capture time, if it sent one. */
  timestamp?: unknown
}

/** Stores one GOOD file in the guest store. */
export async function importLocal(store: LocalStore, upload: LocalUpload): Promise<ImportResponse> {
  const prepared = await parseGood(upload.text)
  const dictionary = await materialsDictionary()
  const sections = await encodeStaticSections(prepared, dictionary)
  return store.transact(async (tx) => {
    const now = Date.now()
    const takenAt = resolveImportTimestamp(upload.timestamp, prepared.good.timestamp, now)
    const account = tx.account()
    const warnings =
      prepared.good.player?.uid !== undefined &&
      account.uid &&
      account.uid !== String(prepared.good.player.uid)
        ? [
            {
              code: 'uid_mismatch' as const,
              message: `This file is UID ${prepared.good.player.uid}, but the account is UID ${account.uid}. Stored anyway.`,
            },
          ]
        : []

    // Catalog ids: known identities by packed key, new ones numbered on.
    const identities = new Map<string, ArtifactIdentity>()
    prepared.artifactHashes.forEach((hash, i) => {
      if (!identities.has(hash)) identities.set(hash, prepared.good.artifacts[i]!.identity)
    })
    const artifactIds = new Map<string, number>()
    const staged: { id: number; key: string; identity: ArtifactIdentity }[] = []
    for (const [hash, identity] of identities) {
      const key = artifactKeyString(identity)
      let id = store.artifactIds.get(key)
      if (id === undefined) {
        id = account.nextArtifactId++
        staged.push({ id, key, identity })
      }
      artifactIds.set(hash, id)
    }

    const encoded = await completeSnapshot(sections, prepared, artifactIds)
    const key = contentKey(encoded.contentHash)
    const keys = captureKeys(encoded)
    const response = (
      status: ImportResponse['status'],
      snapshotId: number,
      storedSize = 0,
    ): ImportResponse => ({
      status,
      snapshotId,
      takenAt,
      rawSize: upload.rawSize,
      storedSize,
      ...(warnings.length > 0 ? { warnings } : {}),
      contentKey: key.toString(36),
    })

    const sameTime = [...store.snapshots.values()].find((row) => row.takenAt === takenAt)
    if (sameTime) {
      // The ids handed out above were never written: give them back.
      account.nextArtifactId -= staged.length
      if (keys.has(sameTime.contentKey)) return response('unchanged', sameTime.id)
      throw new LocalApiError(
        409,
        'duplicate_capture',
        'A different snapshot exists for this capture time',
      )
    }

    const latest = store.latest()
    if (
      latest &&
      latest.contentKey === key &&
      takenAt > latest.takenAt &&
      !newWorld(prepared.good.capture, latest)
    ) {
      account.nextArtifactId -= staged.length
      tx.putSnapshot({ ...latest, lastSeenAt: Math.max(latest.lastSeenAt, takenAt) })
      fillAccount(tx, prepared)
      tx.bumpVersion()
      return response('unchanged', latest.id)
    }

    const nearest = nearestOf(store, takenAt)
    const known = nearest ? knownBlobs(store, nearest.refs) : new Map<number, KnownBlob>()
    const existing = new Map<string, { id: number; code: number }>()
    for (const blob of store.blobs.values())
      existing.set(blob.hash, { id: blob.id, code: blob.code })
    const plan = await planSnapshotV2({
      encoded,
      prepared,
      materialsDictionary: dictionary,
      latest: nearest
        ? Object.fromEntries(
            SLOTS.map((slot, i) => [slot, known.get(nearest.refs[i] ?? -1) ?? null]),
          )
        : {},
      existing,
    })

    // New blobs get ids in order; a ref by hash names one of them.
    const byHash = new Map<string, number>()
    const resolve = (ref: BlobRef | null): number | null => {
      if (ref === null) return null
      if ('id' in ref) return ref.id
      const id = byHash.get(ref.hash) ?? existing.get(ref.hash)?.id
      if (id === undefined) throw new Error(`Section ${ref.hash} is not stored`)
      return id
    }
    for (const blob of plan.blobs) {
      if (byHash.has(blob.hash) || existing.has(blob.hash)) continue
      const row: BlobRow = {
        id: account.nextBlobId++,
        code: blob.code,
        hash: blob.hash,
        baseId: resolve(blob.base),
        data: blob.data,
      }
      byHash.set(blob.hash, row.id)
      tx.putBlob(row)
    }
    for (const entry of staged) tx.putArtifact(entry)

    const id = account.nextSnapshotId++
    tx.putSnapshot({
      id,
      takenAt,
      lastSeenAt: takenAt,
      createdAt: now,
      rawSize: upload.rawSize,
      storedSize: plan.storedSize,
      contentKey: key,
      refs: SLOTS.map((slot) => resolve(plan.refs[slot])),
      meta: encodeSnapshotMeta({
        format: prepared.good.format,
        version: prepared.good.version,
        source: prepared.good.source,
        summary: prepared.summary,
        playerVars: plan.playerVars,
        ...(prepared.good.capture ? { capture: prepared.good.capture } : {}),
      }),
    })
    fillAccount(tx, prepared)
    tx.bumpVersion()
    return response('created', id, plan.storedSize)
  })
}
