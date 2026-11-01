/**
 * Teyvat.me Capture playing an account now (docs/plans/capture-link.md): what
 * `GET /api/accounts/:id/presence` and the live `presence` event say, kept per
 * account for the pages that show it. A heartbeat older than 5 minutes counts
 * as gone (Capture closed without saying so).
 */

import type { CaptureCommandKind, PresenceResponseForAccount } from '@gdt/shared'
import { shallowReactive } from 'vue'
import { api } from '@/api'

export const PRESENCE_TTL_MS = 5 * 60_000

const byAccount = shallowReactive(new Map<number, PresenceResponseForAccount>())
const loading = new Map<number, Promise<void>>()

/** Pages ask once per account; later changes arrive as live events. */
export function loadPresence(accountId: number): Promise<void> {
  let pending = loading.get(accountId)
  if (!pending) {
    pending = api
      .capturePresence(accountId)
      .then((answer) => void byAccount.set(accountId, answer))
      .catch(() => {
        loading.delete(accountId)
      })
    loading.set(accountId, pending)
  }
  return pending
}

/** A live `presence` event. */
export function setPresence(accountId: number, state: PresenceResponseForAccount): void {
  byAccount.set(accountId, state)
}

/** The Capture playing the account at `now`, or null. */
export function presenceOf(accountId: number, now: number): PresenceResponseForAccount | null {
  const state = byAccount.get(accountId)
  if (!state?.presence || state.presence.at < now - PRESENCE_TTL_MS) return null
  return state
}

/** Asks that Capture to act; the answer (and its later event) say what waits. */
export async function sendCommand(accountId: number, kind: CaptureCommandKind): Promise<void> {
  setPresence(accountId, await api.captureCommand(accountId, kind))
}
