/**
 * The presence each page holds per account (src/live/presence.ts loads it,
 * live events replace it). Apart from the API so worker tests can drive the
 * same store: a heartbeat older than 25 minutes counts as gone (Capture closed
 * without saying so); the hub tells every written heartbeat, a time-only one
 * too, so a running Capture's copy here stays fresh without asking again.
 */

import type { PresenceResponseForAccount } from '@gdt/shared'
import { shallowReactive } from 'vue'

/** As the worker's (services/alert-hub.ts PRESENCE_TTL_MS). */
export const PRESENCE_TTL_MS = 25 * 60_000

const byAccount = shallowReactive(new Map<number, PresenceResponseForAccount>())

/** A live `presence` event, or an answer of the API. */
export function setPresence(accountId: number, state: PresenceResponseForAccount): void {
  byAccount.set(accountId, state)
}

/** The Capture playing the account at `now`, or null. */
export function presenceOf(accountId: number, now: number): PresenceResponseForAccount | null {
  const state = byAccount.get(accountId)
  if (!state?.presence || state.presence.at < now - PRESENCE_TTL_MS) return null
  return state
}
