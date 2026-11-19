/**
 * The bag copies (issue 12, 2026-11-19): Original Resin and Realm Currency
 * are player properties that Teyvat.me Capture also writes into the materials
 * bag. Its Account numbers switch covers the first and its Serenitea Pot
 * switch the second (`BAG_COPIES` in @gdt/shared), so while the newest
 * capture has that switch off, the count is not shared: no page shows it as a
 * current figure, whatever an older capture or an older Capture build left in
 * the bag. Pure.
 */

import { dropMaterialChanges, type LiveJournalResponse, type SnapshotResponse } from '@gdt/shared'
import { offBagKeys } from '@gdt/shared/off'

type Listed = Pick<SnapshotResponse, 'id' | 'off'>

/**
 * The material keys the switches of capture `id` cover (the newest capture's
 * without an id). `list` is newest first, as the snapshot list comes; a
 * capture that is not listed, or has no `gi_off`, covers none.
 */
export function hiddenBagKeys(list: readonly Listed[], id?: number): string[] {
  const capture = id === undefined ? list[0] : list.find((s) => s.id === id)
  return offBagKeys(capture?.off)
}

/** `materials` without `keys` (the same object when it holds none of them). */
export function withoutBagKeys<T extends Readonly<Record<string, number>>>(
  materials: T,
  keys: readonly string[],
): T {
  if (!keys.some((key) => key in materials)) return materials
  const rest: Record<string, number> = { ...materials }
  for (const key of keys) delete rest[key]
  return rest as T
}

/**
 * The live journal as the pages apply it: without changes to a count its
 * base snapshot's switches cover. The Worker drops them when a batch arrives;
 * this covers a journal stored before it did.
 */
export function bagJournal(
  live: LiveJournalResponse,
  list: readonly Listed[],
): LiveJournalResponse {
  const base = live.base?.snapshotId
  if (!live.open || base === undefined || !live.changes) return live
  const changes = dropMaterialChanges(live.changes, hiddenBagKeys(list, base))
  return changes === live.changes ? live : { ...live, changes: [...changes] }
}
