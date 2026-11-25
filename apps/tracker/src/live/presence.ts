/**
 * Teyvat.me Capture playing an account now (docs/plans/capture-link.md): what
 * `GET /api/accounts/:id/presence` and the live `presence` event say, kept per
 * account for the pages that show it (the store and its 25-minute expiry are
 * in presence-store.ts).
 */

import type { CaptureCommandKind } from '@gdt/shared'
import { api } from '@/api'
import { setPresence } from './presence-store'

export { PRESENCE_TTL_MS, presenceOf, setPresence } from './presence-store'

const loading = new Map<number, Promise<void>>()

/** Pages ask once per account; later changes arrive as live events. */
export function loadPresence(accountId: number): Promise<void> {
  let pending = loading.get(accountId)
  if (!pending) {
    pending = api
      .capturePresence(accountId)
      .then((answer) => setPresence(accountId, answer))
      .catch(() => {
        loading.delete(accountId)
      })
    loading.set(accountId, pending)
  }
  return pending
}

/** Asks that Capture to act; the answer (and its later event) say what waits. */
export async function sendCommand(accountId: number, kind: CaptureCommandKind): Promise<void> {
  setPresence(accountId, await api.captureCommand(accountId, kind))
}
