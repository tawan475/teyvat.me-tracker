/**
 * Live sync in the browser (docs/plans/live-sync.md §8): a version per
 * account that moves whenever its journal changes (the live socket's `live`
 * event), so "now" views re-read `/live` and re-apply it. An open popover or pinned
 * tip holds the move until it closes, as it holds snapshot updates (live/holds.ts).
 */

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

/** The account's journal changed: views of it re-read it (once no popover or tip holds them). */
export function noteLiveChange(accountId: number): void {
  if (updatesHeld.value) waiting.add(accountId)
  else bump(accountId)
}

watch(updatesHeld, (held) => {
  if (held) return
  for (const id of waiting) bump(id)
  waiting.clear()
})
