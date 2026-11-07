/**
 * Account data, fetched once per data version and decoded in the browser.
 *
 * The server stores snapshots as deduplicated, compressed sections and sends
 * them untouched (a GDT2 bundle); this module decodes and rebuilds them.
 * Everything is cached by `${accountId}:${dataVersion}`: an import or delete
 * moves the version, so stale entries are simply never asked for again. The
 * HTTP layer adds a second cache: responses carry an ETag on the same
 * version, so a reload revalidates for one round trip and no body.
 */

import { accountPlayer, type AccountPlayer } from '@/data/account-player'
import { withJournal, type LiveApplied } from '@/data/live-now'
import { heldJournal, heldPoints, holdJournal, holdPoints, liveEventsSeen } from '@/data/live-known'
import { liveVersions } from '@/live/journal'
import {
  artifactRows,
  catalogFromRows,
  decodePlayer,
  decodeSnapshot,
  storedSnapshotOf,
  type BundleSnapshot,
  type CatalogEntry,
  type CatalogRow,
  type Good,
  type KeyDictionary,
  type LiveJournalResponse,
  type SnapshotResponse,
  type SnapshotSummary,
} from '@gdt/shared'
import { api, bundlePath, BUNDLE_FORMAT, request } from '@/api'
import { accountPath } from '@/api/inspect'
import { yieldToMain } from '@/lib/yield'
import { decodeBundleOffThread } from './decode'
import { readCached, writeCached } from './idb-cache'

export interface AccountRef {
  id: number
  dataVersion: number
  /**
   * `staff`: read through /api/staff (Inspect, someone else's account),
   * cached apart from the owner's own reads. `demo`: the public demo
   * account, read through /api/demo with no cookie (docs/plans/open-site.md §2).
   * `local`: the guest account, kept in this browser (§4): its reads are
   * answered here (local/server.ts) and never copied into the data cache.
   */
  source?: 'staff' | 'demo' | 'local'
  /** Live sync is on for the account: "now" is its newest snapshot with the journal applied. */
  liveSync?: boolean
}

export type SectionName =
  | 'characters'
  | 'weapons'
  | 'artifacts'
  | 'materials'
  | 'achievements'
  | 'player'
  | 'achievementTimes'
  | 'characterExtras'
  | 'anecdotes'
  | 'tasks'
  | 'collections'
  | 'collections2'
  | 'wardrobe'
  | 'exploration'
  | 'progress'
  | 'extras'

export interface DecodedBundle {
  snapshots: BundleSnapshot[]
  /** Section key -> its canonical JSON text (see decodeBundle). */
  texts: Map<string, string>
}

const cache = new Map<string, Promise<unknown>>()
const MAX_ENTRIES = 40

function cached<T>(account: AccountRef, kind: string, load: () => Promise<T>): Promise<T> {
  // The bundle layout is part of the key: a decoded bundle never outlives a layout change.
  const key = `${account.source ?? 'own'}:${account.id}:${account.dataVersion}:${BUNDLE_FORMAT}:${kind}`
  let entry = cache.get(key) as Promise<T> | undefined
  if (!entry) {
    entry = load()
    entry.catch(() => cache.delete(key))
    cache.set(key, entry)
    // Oldest first: Map keeps insertion order.
    while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!)
  }
  return entry
}

/**
 * An account response as downloaded (bytes or JSON text), from this
 * device's store (see idb-cache) when it holds this data version, else from
 * the server, then kept. It is kept under the version its ETag names: the
 * server answers with its current data, whatever version was asked for.
 * The owner's data only: staff Inspect reads are never stored.
 */
async function stored<T extends ArrayBuffer | string>(
  account: AccountRef,
  kind: string,
  path: string,
  read: (response: Response) => Promise<T>,
): Promise<T> {
  // Already in this browser: nothing to keep a second copy of.
  if (account.source === 'local') return read(await request(path))
  const key = `${account.id}:${BUNDLE_FORMAT}:${kind}`
  const hit = await readCached(key, account.id, account.dataVersion)
  if (hit !== undefined) return hit as T
  const response = await request(path)
  const body = await read(response)
  const version = /\.v(\d+)/.exec(response.headers.get('etag') ?? '')
  if (version) void writeCached(key, account.id, Number(version[1]), body)
  return body
}

const text = (response: Response) => response.text()
const bytes = (response: Response) => response.arrayBuffer()

/** Snapshot metadata and summaries, newest first. */
export function loadSnapshots(account: AccountRef): Promise<SnapshotResponse[]> {
  return cached(account, 'snapshots', async () =>
    account.source === 'staff'
      ? api.staff.snapshots(account.id)
      : (JSON.parse(
          await stored(account, 'snapshots', accountPath(account.id, 'snapshots'), text),
        ) as SnapshotResponse[]),
  )
}

/** Every artifact the account has held, by catalog id, with CV/RV derived. */
export function loadCatalog(account: AccountRef): Promise<Map<number, CatalogEntry>> {
  return cached(account, 'catalog', async () => {
    const rows =
      account.source === 'staff'
        ? await api.staff.catalog(account.id)
        : (JSON.parse(
            await stored(account, 'catalog', accountPath(account.id, 'catalog'), text),
          ) as CatalogRow[])
    // Thousands of rows to derive: a task of their own.
    await yieldToMain()
    return catalogFromRows(rows)
  })
}

/** Stored sections for some or all snapshots (oldest first), inflated. */
export function loadBundle(
  account: AccountRef,
  options: { ids?: number[]; sections?: SectionName[] } = {},
): Promise<DecodedBundle> {
  const variant = `bundle:${options.sections?.join('+') ?? 'all'}:${options.ids?.join(',') ?? 'all'}`
  return cached(account, variant, async () =>
    decodeBundleOffThread(
      account.source === 'staff'
        ? await api.staff.bundle(account.id, options)
        : await stored(account, variant, bundlePath(account.id, options), bytes),
    ),
  )
}

let materialsDictionary: Promise<KeyDictionary> | null = null

/** The ~7,600-key materials dictionary, loaded only when something decodes materials. */
export function loadMaterialsDictionary(): Promise<KeyDictionary> {
  materialsDictionary ??= import('@gdt/shared/dictionary/materials').then((m) => m.MATERIALS)
  return materialsDictionary
}

/** Rebuilds the GOOD file for one snapshot of a full bundle. */
export function decodeBundleSnapshot(
  snapshot: BundleSnapshot,
  bundle: DecodedBundle,
  catalog: ReadonlyMap<number, CatalogEntry>,
  materials: KeyDictionary,
): Good {
  const text = (hash: string) => {
    const value = bundle.texts.get(hash)
    if (value === undefined) throw new Error(`Bundle is missing section ${hash}`)
    return value
  }
  return decodeSnapshot(storedSnapshotOf(snapshot, text), catalog, materials)
}

export interface Inventory {
  snapshot: BundleSnapshot
  good: Good
  catalog: Map<number, CatalogEntry>
  /**
   * Catalog id of each of `good.artifacts`, same order; -1 for a piece the
   * live journal added or changed (the catalog has no entry for it yet).
   */
  artifactIds: number[]
  /** The live journal applied on top of the snapshot (absent: the snapshot alone). */
  live?: LiveApplied
}

/** Catalog ids of a snapshot's artifacts, in `decodeArtifacts` order. */
function artifactIdsOf(snapshot: BundleSnapshot, bundle: DecodedBundle): number[] {
  const text = (hash: string | null | undefined) => {
    const value = hash ? bundle.texts.get(hash) : undefined
    return value === undefined ? null : JSON.parse(value)
  }
  const section = text(snapshot.artifacts)
  if (!section) throw new Error(`Bundle is missing section ${snapshot.artifacts}`)
  return artifactRows(section, text(snapshot.artifactsBase)).map((row) => row[0])
}

/** The newest snapshot, fully decoded, with the catalog for artifact details. */
function loadSnapshotInventory(
  account: AccountRef & { latest: { id: number } },
): Promise<Inventory | null> {
  const latest = account.latest
  return cached(account, `latest:${latest.id}`, async () => {
    const [bundle, catalog, materials] = await Promise.all([
      loadBundle(account, { ids: [latest.id] }),
      loadCatalog(account),
      loadMaterialsDictionary(),
    ])
    const snapshot = bundle.snapshots[0]
    if (!snapshot) return null
    // The catalog and the bundle may have come in this same task: the
    // snapshot's decode gets one of its own.
    await yieldToMain()
    return {
      snapshot,
      good: decodeBundleSnapshot(snapshot, bundle, catalog, materials),
      catalog,
      artifactIds: artifactIdsOf(snapshot, bundle),
    }
  })
}

/** The account's live journal version (moves on every `live` event). */
function liveVersion(account: AccountRef): number {
  return liveVersions.get(account.id) ?? 0
}

/**
 * The open live journal (null when live sync is off for the account or the
 * page is staff's Inspect). Re-read whenever its version moves; the ETag
 * makes an unchanged one a 304.
 */
export function loadLive(account: AccountRef): Promise<LiveJournalResponse | null> {
  if (!account.liveSync) return Promise.resolve(null)
  return cached(account, `live:${liveVersion(account)}`, async () => {
    if (account.source === 'staff') return api.staff.live(account.id)
    // Kept current from the socket's batches (live-known): no request.
    const held = heldJournal(account.id, account.dataVersion)
    if (held) return held
    const since = liveEventsSeen(account.id)
    const journal = await api.live(account.id)
    holdJournal(account.id, account.dataVersion, journal, since)
    return journal
  })
}

/**
 * Live sync's chart points of the last 400 days (none when live sync is off):
 * re-read when the journal moves (each batch may add or move today's).
 */
export function loadPoints(
  account: AccountRef,
): Promise<{ at: number; figures: SnapshotSummary }[]> {
  if (!account.liveSync) return Promise.resolve([])
  return cached(account, `points:${liveVersion(account)}`, async () => {
    try {
      if (account.source === 'staff') return (await api.staff.points(account.id)).points
      const held = heldPoints(account.id, account.dataVersion)
      if (held) return held
      const since = liveEventsSeen(account.id)
      const { points } = await api.points(account.id)
      holdPoints(account.id, account.dataVersion, points, since)
      return points
    } catch {
      // The charts still have every snapshot.
      return []
    }
  })
}

/**
 * The account as it is now: the newest snapshot, fully decoded, with the
 * live journal applied when one is open on it (live sync).
 */
export function loadLatestInventory(
  account: AccountRef & { latest: { id: number } | null },
): Promise<Inventory | null> {
  const latest = account.latest
  if (!latest) return Promise.resolve(null)
  const snapshot = loadSnapshotInventory({ ...account, latest })
  if (!account.liveSync) return snapshot
  return cached(account, `now:${latest.id}:${liveVersion(account)}`, async () => {
    const [inventory, live] = await Promise.all([snapshot, loadLive(account)])
    return inventory && live ? withJournal(inventory, live, latest.id) : inventory
  })
}

/**
 * Catalog ids of the artifacts in the snapshot before the newest one (null
 * when there is none): what the Artifacts page's "New" compares against. A
 * piece that levelled up has a new id, so "new" means new or changed. One
 * small bundle of just that snapshot's artifacts section.
 */
export function loadPreviousArtifactIds(
  account: AccountRef & { latest: { id: number; takenAt: number } | null },
): Promise<ReadonlySet<number> | null> {
  const latest = account.latest
  if (!latest) return Promise.resolve(null)
  return cached(account, `previous-artifacts:${latest.id}`, async () => {
    const snapshots = await loadSnapshots(account)
    const index = snapshots.findIndex((s) => s.id === latest.id)
    const previous =
      index >= 0 ? snapshots[index + 1] : snapshots.find((s) => s.takenAt < latest.takenAt)
    if (!previous) return null
    const bundle = await loadBundle(account, { ids: [previous.id], sections: ['artifacts'] })
    const snapshot = bundle.snapshots[0]
    return snapshot ? new Set(artifactIdsOf(snapshot, bundle)) : null
  })
}

/**
 * AR, World Level and Original Resin from irminsul's `gi_player` across the
 * snapshots (see accountPlayer); one small bundle of just those sections.
 */
export function loadAccountPlayer(account: AccountRef): Promise<AccountPlayer> {
  return cached(account, 'player', async () => {
    const bundle = await loadBundle(account, { sections: ['player'] })
    return accountPlayer(
      bundle.snapshots.map((s) => ({ takenAt: s.takenAt, key: s.player })),
      (key) => {
        const text = bundle.texts.get(key)
        return text === undefined ? {} : decodePlayer(JSON.parse(text))
      },
    )
  })
}
