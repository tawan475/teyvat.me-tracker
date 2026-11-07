/**
 * Guest mode (docs/plans/open-site.md §4): one Genshin account kept in this
 * browser only. It has an id no server account can have, so its paths
 * (`/api/accounts/-1/…`) are told apart by their text alone, in the page and
 * in workers alike, and are answered in the browser (local/server.ts) instead
 * of going to the Worker. Startup code: keep this module free of imports.
 */

/** The guest account's id: negative, never a server account's. */
export const GUEST_ACCOUNT_ID = -1

const PREFIX = `/api/accounts/${GUEST_ACCOUNT_ID}`

export function isGuestAccount(id: number): boolean {
  return id === GUEST_ACCOUNT_ID
}

/** A path the browser answers itself: the guest account and anything under it. */
export function isGuestPath(path: string): boolean {
  return path === PREFIX || path.startsWith(`${PREFIX}/`) || path.startsWith(`${PREFIX}?`)
}
