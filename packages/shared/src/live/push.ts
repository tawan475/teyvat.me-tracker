/**
 * A live batch applied in the browser (the socket's `live` event carries
 * it, LiveBatchPush): the journal and chart points a read would answer after
 * it, worked out from the ones before it with the server's own merge, so the
 * page needs no request. worker/test/live-sync.test.ts checks it against
 * the server's read after every batch.
 */

import type { LiveBatchPush, LiveJournalResponse } from '../api'
import type { SnapshotSummary } from '../codec/snapshot'
import { mergeChanges } from './delta'
import { addPoint, pointDay } from './storage'

export type LivePointRow = { at: number; figures: SnapshotSummary }

/**
 * The journal after `batch` (the event's `seq`), as the server would answer
 * it, or null when the batch does not follow `journal`.
 */
export function applyLiveBatch(
  journal: LiveJournalResponse,
  seq: number,
  batch: LiveBatchPush,
): LiveJournalResponse | null {
  if (!journal.open || journal.base?.contentKey !== batch.base) return null
  if ((journal.seq ?? 0) !== batch.prev || seq !== batch.prev + 1) return null
  const items = [...(journal.items ?? [])]
  const have = new Set(items.map(([kind, guid]) => `${kind}:${guid}`))
  for (const item of batch.items) {
    const key = `${item[0]}:${item[1]}`
    if (!have.has(key)) {
      have.add(key)
      items.push(item)
    }
  }
  return {
    ...journal,
    seq,
    updatedAt: batch.updatedAt,
    figures: batch.figures,
    bytes: batch.bytes,
    changes: mergeChanges(journal.changes ?? [], batch.changes),
    items,
  }
}

/** The chart points with the batch's sample added to its day, as the server stores it. */
export function applyLivePoint(list: readonly LivePointRow[], point: LivePointRow): LivePointRow[] {
  const day = pointDay(point.at)
  let start = list.length
  while (start > 0 && pointDay(list[start - 1]!.at) === day) start--
  return [...list.slice(0, start), ...addPoint(list.slice(start), point)]
}
