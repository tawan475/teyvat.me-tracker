/**
 * Reading the guest store back the way the Worker reads an account
 * (worker/services/export.ts, account-views.ts): the snapshot list with its
 * summaries, the catalog as CatalogRow JSON, GDT2 bundles of some or all
 * snapshots and sections (the stored blobs untouched, the browser decodes
 * as for any account), and one snapshot rebuilt as a GOOD file.
 */

import {
  KIND_DELTA,
  SLOTS,
  SectionTexts,
  artifactRows,
  asLeyline,
  decodeSnapshot,
  decodeSnapshotMeta,
  storedSnapshotOf,
  v1SnapshotOf,
  writeBundleV2,
  type AccountResponse,
  type ArtifactIdentity,
  type BundleKey,
  type BundleSnapshotV2,
  type CatalogRow,
  type Good,
  type KeyDictionary,
  type RawBlob,
  type SnapshotResponse,
  type Slot,
} from '@gdt/shared'
import { GUEST_ACCOUNT_ID } from './guest-id'
import { LocalApiError } from './errors'
import type { LocalStore, SnapshotRow } from './local-store'

const refOf = (row: SnapshotRow, slot: Slot): number | null => row.refs[SLOTS.indexOf(slot)] ?? null

/** The account as the account list shows it. */
export function accountResponse(store: LocalStore): AccountResponse {
  const account = store.account
  const latest = store.latest()
  let rawBytes = 0
  let storedBytes = 0
  for (const row of store.snapshots.values()) {
    rawBytes += row.rawSize
    storedBytes += row.storedSize
  }
  const meta = latest ? decodeSnapshotMeta(latest.meta) : null
  return {
    id: GUEST_ACCOUNT_ID,
    name: account?.name ?? null,
    uid: account?.uid ?? null,
    server: account?.server ?? null,
    createdAt: account?.createdAt ?? Date.now(),
    dataVersion: account?.dataVersion ?? 1,
    snapshotCount: store.snapshots.size,
    rawBytes,
    storedBytes,
    latest:
      latest && meta
        ? {
            id: latest.id,
            takenAt: latest.takenAt,
            lastSeenAt: latest.lastSeenAt,
            summary: meta.summary,
            source: meta.source,
          }
        : null,
    // No live journal in a browser: snapshots only.
    liveSync: false,
    access: 'owner',
  }
}

/** Snapshots newest first, with their summaries. */
export function listSnapshots(store: LocalStore): SnapshotResponse[] {
  return store.newestFirst().map((row) => {
    const meta = decodeSnapshotMeta(row.meta)
    return {
      id: row.id,
      takenAt: row.takenAt,
      lastSeenAt: row.lastSeenAt,
      createdAt: row.createdAt,
      source: meta.source,
      rawSize: row.rawSize,
      storedSize: row.storedSize,
      summary: meta.summary,
      ...(meta.capture ? { capture: meta.capture } : {}),
    }
  })
}

const substatRows = (list: ArtifactIdentity['substats']) =>
  list.map((s) =>
    s.initialValue === undefined ? [s.key, s.value] : [s.key, s.value, s.initialValue],
  ) as CatalogRow[6]

/** The whole catalog, ordered by id. */
export function catalogRows(store: LocalStore): CatalogRow[] {
  return [...store.artifacts.values()]
    .sort((a, b) => a.id - b.id)
    .map(({ id, identity: a }) => [
      id,
      a.setKey,
      a.slotKey,
      a.level,
      a.rarity,
      a.mainStatKey,
      substatRows(a.substats),
      a.totalRolls,
      a.elixirCrafted ? 1 : 0,
      substatRows(a.unactivatedSubstats),
    ])
}

/** The base a delta-kind blob is a delta of (null when stored in full). */
function deltaBase(store: LocalStore, id: number | null): number | null {
  if (id === null) return null
  const blob = store.blobs.get(id)
  return blob && (blob.code & KIND_DELTA) !== 0 ? blob.baseId : null
}

function bundleEntry(store: LocalStore, row: SnapshotRow): BundleSnapshotV2 {
  const ref = (slot: Slot) => refOf(row, slot)
  const required = (slot: Slot): BundleKey => {
    const id = ref(slot)
    if (id === null) throw new Error(`Snapshot ${row.id} has no ${slot}`)
    return id
  }
  const { format, version, source, playerVars } = decodeSnapshotMeta(row.meta)
  return {
    id: row.id,
    takenAt: row.takenAt,
    lastSeenAt: row.lastSeenAt,
    format,
    version,
    source,
    characters: required('characters'),
    weapons: required('weapons'),
    artifacts: required('artifacts'),
    artifactsBase: deltaBase(store, ref('artifacts')),
    materials: required('materials'),
    materialsKeyframe: deltaBase(store, ref('materials')) ?? required('materials'),
    achievements: ref('achievements'),
    player: ref('player'),
    achievementTimes: ref('achievementTimes'),
    achievementTimesBase: deltaBase(store, ref('achievementTimes')),
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

/** `ids` and every base they need (at most three levels down). */
function blobsWithBases(store: LocalStore, ids: Iterable<number>): Map<number, RawBlob> {
  const out = new Map<number, RawBlob>()
  const add = (id: number, depth: number) => {
    if (out.has(id) || depth > 3) return
    const blob = store.blobs.get(id)
    if (!blob) return
    out.set(id, { id, code: blob.code, baseId: blob.baseId, data: blob.data })
    if (blob.baseId !== null) add(blob.baseId, depth + 1)
  }
  for (const id of ids) add(id, 0)
  return out
}

/** Snapshots (all, or `ids`; oldest first) with the requested sections, as a GDT2 bundle. */
export function buildBundle(
  store: LocalStore,
  ids: readonly number[] | null,
  sections: ReadonlySet<Slot>,
): Uint8Array<ArrayBuffer> {
  const wanted = ids ? new Set(ids) : null
  const rows = [...store.snapshots.values()]
    .filter((row) => !wanted || wanted.has(row.id))
    .sort((a, b) => a.takenAt - b.takenAt || a.id - b.id)
  const blobIds = new Set<number>()
  for (const row of rows) {
    for (const slot of SLOTS) {
      if (!sections.has(slot)) continue
      const id = refOf(row, slot)
      if (id !== null) blobIds.add(id)
    }
  }
  const blobs = blobsWithBases(store, blobIds)
  return writeBundleV2(
    rows.map((row) => bundleEntry(store, row)),
    { blobs: [...blobs.values()].sort((a, b) => a.id - b.id) },
  )
}

/** One snapshot (or the newest) rebuilt as a GOOD file. */
export async function buildGood(
  store: LocalStore,
  snapshotId: number | 'latest',
  materials: KeyDictionary,
): Promise<{ good: Good; takenAt: number }> {
  const row = snapshotId === 'latest' ? store.latest() : (store.snapshots.get(snapshotId) ?? null)
  if (!row) throw new LocalApiError(404, 'not_found', 'Snapshot not found')
  const blobs = blobsWithBases(
    store,
    row.refs.filter((id): id is number => id !== null),
  )
  const opened = v1SnapshotOf(bundleEntry(store, row))
  const snapshot = opened.snapshot
  const texts = new SectionTexts(new Map(), blobs, false)
  if (opened.player) texts.derivePlayer(...opened.player)
  const keys = [
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
  ].filter((key): key is string => !!key)
  const decoded = await texts.many(keys)
  const stored = storedSnapshotOf(snapshot, (key) => decoded.get(key)!)
  const used = new Set(
    artifactRows(
      JSON.parse(stored.artifacts),
      stored.artifactsBase ? JSON.parse(stored.artifactsBase) : null,
    ).map((entry) => entry[0]),
  )
  const catalog = new Map<number, ArtifactIdentity>()
  for (const id of used) {
    const entry = store.artifacts.get(id)
    if (entry) catalog.set(id, entry.identity)
  }
  return { good: asLeyline(decodeSnapshot(stored, catalog, materials)), takenAt: row.takenAt }
}

/** Every blob the remaining snapshots need (bases included); the rest can go. */
export function unusedBlobs(store: LocalStore): number[] {
  const used = blobsWithBases(
    store,
    [...store.snapshots.values()].flatMap((row) =>
      row.refs.filter((id): id is number => id !== null),
    ),
  )
  return [...store.blobs.keys()].filter((id) => !used.has(id))
}
