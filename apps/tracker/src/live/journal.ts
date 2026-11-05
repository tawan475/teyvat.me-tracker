/**
 * Live sync in the browser (docs/plans/live-sync.md §8): a version per
 * account that moves whenever its journal changes (the live socket's `live`
 * event), so "now" views re-read `/live` and re-apply it. An open popover or pinned
 * tip holds the move until it closes, as it holds snapshot updates (live/holds.ts).
 */

import type { LiveBatchPush, LiveJournalMark } from '@gdt/shared'
import { reactive, watch } from 'vue'
import { updatesHeld } from './holds'

/** Account id -> journal version (0 until its first `live` event). */
export const liveVersions = reactive(new Map<number, number>())

/** Account id -> when its last `live` event arrived (ms): the top bar's Capture button. */
export const liveSeenAt = reactive(new Map<number, number>())

const waiting = new Set<number>()

function bump(accountId: number): void {
  liveVersions.set(accountId, (liveVersions.get(accountId) ?? 0) + 1)
}

/**
 * What the data layer (data/live-known.ts) does with a `live` event: apply
 * its batch to the journal it holds, or drop that journal. Registered when
 * it loads; before that nothing is held, so there is nothing to apply.
 */
type BatchHandler = (accountId: number, seq: number, batch: LiveBatchPush | undefined) => void
/** Whether the journal held for an account is where the hello says it stands. */
type MarkCheck = (accountId: number, marks: readonly LiveJournalMark[] | undefined) => boolean

let onBatch: BatchHandler | null = null
let isCurrent: MarkCheck | null = null

export function onLiveBatch(handler: BatchHandler, check: MarkCheck): void {
  onBatch = handler
  isCurrent = check
}

/**
 * The account's journal changed: views of it re-read it (once no popover or
 * tip holds them). With the event's batch the data layer applies it to the
 * journal it holds, so that re-read needs no request; without, the re-read
 * goes to the server.
 */
export function noteLiveChange(accountId: number, seq = 0, batch?: LiveBatchPush): void {
  onBatch?.(accountId, seq, batch)
  if (updatesHeld.value) waiting.add(accountId)
  else bump(accountId)
}

/**
 * A (re)connect's hello: an account whose held journal is where `marks` say
 * is current; any other may have moved while there was no socket.
 */
export function noteLiveMarks(
  accountIds: readonly number[],
  marks: readonly LiveJournalMark[] | undefined,
): void {
  for (const id of accountIds) if (!isCurrent?.(id, marks)) noteLiveChange(id)
}

watch(updatesHeld, (held) => {
  if (held) return
  for (const id of waiting) bump(id)
  waiting.clear()
})
