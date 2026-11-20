/**
 * Whether this browser holds a guest account with data: the `gdt:guest-data`
 * hint the guest store keeps (local/local-store.ts GUEST_DATA_FLAG), read
 * without loading the store. Sign-up sends it, so staff can see how many
 * accounts started as a guest. On its own so the startup code can import it.
 */
export function guestHint(): boolean {
  try {
    return localStorage.getItem('gdt:guest-data') === '1'
  } catch {
    return false
  }
}
