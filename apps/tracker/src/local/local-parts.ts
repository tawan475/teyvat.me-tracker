/**
 * Guest mode's "Remove part…" (issue 12, item 3): the Worker's
 * `/parts` routes (worker/services/remove-part.ts) over the guest store, the
 * same plan (@gdt/shared planPartRemoval), the same answers and codes. A
 * guest has no live sync, so no journal rows to drop.
 */

import {
  ACCOUNT_SETTINGS_DEFAULTS,
  SLOTS,
  countParts,
  deepMerge,
  planPartRemoval,
  type AccountSettings,
  type PartBlobRow,
  type PartSnapshotRow,
  type PartsResponse,
  type RemovablePart,
  type RemovePartResponse,
} from '@gdt/shared'
import { LocalApiError } from './errors'
import { unusedBlobs } from './local-read'
import type { LocalStore, Transaction } from './local-store'

function rowsOf(store: LocalStore): {
  rows: PartSnapshotRow[]
  blobs: Map<number, PartBlobRow>
  guard: string
} {
  const rows: PartSnapshotRow[] = [...store.snapshots.values()].map((row) => ({
    id: row.id,
    takenAt: row.takenAt,
    deleted: false,
    refs: Object.fromEntries(SLOTS.map((slot, i) => [slot, row.refs[i] ?? null])),
  }))
  const blobs = new Map<number, PartBlobRow>(
    [...store.blobs.values()].map((b) => [
      b.id,
      { id: b.id, code: b.code, baseId: b.baseId, data: b.data, hash: b.hash },
    ]),
  )
  const maxId = rows.reduce((max, row) => Math.max(max, row.id), 0)
  return { rows, blobs, guard: `${rows.length}:${maxId}` }
}

/** GET …/parts. */
export function countPartsLocal(store: LocalStore): PartsResponse {
  const { rows, blobs, guard } = rowsOf(store)
  return {
    total: rows.length,
    guard,
    live: false,
    // The guest store has no trash: every count is of snapshots on the list.
    parts: countParts(rows, blobs).map((count) => ({ ...count, liveChanges: 0 })),
  }
}

/** The settings as the guest store keeps them (the patches merged, no defaults). */
function storedSettings(store: LocalStore): object {
  return (store.state.get('settings') as { settings?: object } | undefined)?.settings ?? {}
}

function writeSettings(tx: Transaction, settings: object): void {
  tx.setState('settings', { settings })
}

/** POST …/parts/remove. */
export function removePartLocal(
  store: LocalStore,
  part: RemovablePart,
  guard: string,
): Promise<RemovePartResponse> {
  return store.transact(async (tx) => {
    const loaded = rowsOf(store)
    if (loaded.guard !== guard) {
      throw new LocalApiError(
        409,
        'capture_changed',
        'A capture arrived while removing, so nothing was removed. Read the counts again.',
      )
    }
    const plan = await planPartRemoval(part, loaded.rows, loaded.blobs)
    const account = tx.account()
    const newIds = new Map<string, number>()
    for (const blob of plan.blobs) {
      const id = account.nextBlobId++
      newIds.set(blob.hash, id)
      tx.putBlob({ id, code: blob.code, hash: blob.hash, baseId: null, data: blob.data })
    }
    // Blobs that leaned on a base holding the part: standalone now, same id.
    for (const blob of plan.rewrites) {
      const row = store.blobs.get(blob.id)!
      tx.putBlob({ ...row, code: blob.code, baseId: null, data: blob.data })
    }
    for (const update of plan.updates) {
      const row = store.snapshots.get(update.id)!
      const refs = [...row.refs]
      for (const [slot, ref] of Object.entries(update.refs)) {
        const index = (SLOTS as readonly string[]).indexOf(slot)
        refs[index] = ref === null ? null : 'id' in ref! ? ref.id : newIds.get(ref!.hash)!
      }
      tx.putSnapshot({
        ...row,
        refs,
        storedSize: Math.max(0, row.storedSize + update.storedDelta),
      })
    }
    for (const id of unusedBlobs(store)) tx.deleteBlob(id)
    const now = Date.now()
    const current = deepMerge(ACCOUNT_SETTINGS_DEFAULTS, storedSettings(store)) as AccountSettings
    writeSettings(
      tx,
      deepMerge(storedSettings(store), {
        parts: { removed: { ...current.parts.removed, [part]: now } },
      }),
    )
    tx.saveAccount()
    tx.bumpVersion()
    return { part, snapshots: plan.snapshots, freed: plan.freed, liveChanges: 0, removedAt: now }
  })
}

/** POST …/parts/hide: the settings as the server answers them. */
export async function hidePartLocal(
  store: LocalStore,
  key: string,
): Promise<{ settings: AccountSettings }> {
  const stored = await store.transact((tx) => {
    const current = deepMerge(ACCOUNT_SETTINGS_DEFAULTS, storedSettings(store)) as AccountSettings
    const next = deepMerge(storedSettings(store), {
      parts: { hidden: { ...current.parts.hidden, [key]: Date.now() } },
    })
    writeSettings(tx, next)
    return next
  })
  return { settings: deepMerge(ACCOUNT_SETTINGS_DEFAULTS, stored) as AccountSettings }
}
