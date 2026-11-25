/**
 * Messages between this browser's tabs (BroadcastChannel). One tab, the
 * leader (see leader.ts), holds the live socket for all of them, and one
 * tab's read of the account list serves them all:
 * - `event`: the leader got a socket event (relayed to the others).
 * - `link`: the leader's socket went up or down (`fallback`: it keeps failing,
 *   so visible tabs poll slowly); also the answer to `link?`, which a new tab
 *   sends to learn the state.
 * - `nudge`: a visible tab asks the leader to check its socket (`shown`: a
 *   tab came back; `tick`: the five-minute beat while some tab is visible).
 * - `reading`: a tab started reading the list; the others put off a read of
 *   their own that the same events asked for.
 * - `list`: that read's answer: the rows when they changed, null for a 304.
 *   Other tabs take the rows and drop the read they put off.
 * - `rows`: a tab re-read accounts itself (after an import or a delete there).
 * - `bye`: this browser signed out (its cookies are gone): every tab lets go
 *   of live updates, the leader closes the socket.
 * - `view`: a tab became visible or hidden (or closes, or starts); the
 *   leader tells the hub whether any tab of this browser is in view. `view?`
 *   asks every tab to say (a new tab, so it knows the others).
 * Scoped by user id: a tab signed in as someone else ignores them. Without
 * BroadcastChannel every tab holds its own socket and reads for itself.
 */

import type { AccountResponse, LiveEvent } from '@gdt/shared'
import type { PingReason } from './policy'

export type TabMessage =
  | { type: 'event'; userId: number; event: LiveEvent }
  | { type: 'link'; userId: number; up: boolean; fallback: boolean }
  | { type: 'link?'; userId: number }
  | { type: 'nudge'; userId: number; reason: Exclude<PingReason, 'online'> }
  | { type: 'reading'; userId: number; startedAt: number }
  | {
      type: 'list'
      userId: number
      startedAt: number
      etag: string | null
      list: AccountResponse[] | null
    }
  | { type: 'rows'; userId: number; rows: AccountResponse[] }
  | { type: 'bye'; userId: number }
  | { type: 'view'; userId: number; tab: string; visible: boolean }
  | { type: 'view?'; userId: number }

const NAME = 'gdt:live'

let channel: BroadcastChannel | null | undefined

function open(): BroadcastChannel | null {
  if (channel === undefined) {
    try {
      channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(NAME)
    } catch {
      channel = null
    }
  }
  return channel
}

/** Whether tabs can talk at all (else each one keeps its own socket). */
export function tabsCanTalk(): boolean {
  return open() !== null
}

export function postToTabs(message: TabMessage): void {
  try {
    open()?.postMessage(message)
  } catch {
    // A closed channel or an uncloneable value: the other tabs read for themselves.
  }
}

/** Listens to the other tabs; returns the unsubscribe. */
export function onTabMessage(handler: (message: TabMessage) => void): () => void {
  const target = open()
  if (!target) return () => {}
  const listener = (event: MessageEvent<TabMessage>) => handler(event.data)
  target.addEventListener('message', listener)
  return () => target.removeEventListener('message', listener)
}
