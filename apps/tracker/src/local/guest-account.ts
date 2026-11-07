/**
 * The guest account as the pages see it (docs/plans/open-site.md §4): one
 * reactive AccountResponse, read from the guest store and re-read whenever
 * it changes (an import here, or a write in another tab). GuestLayout
 * provides it to the account pages; its `dataVersion` is what their caches
 * key on, as for an account on the server.
 */

import type { AccountResponse } from '@gdt/shared'
import { shallowRef } from 'vue'
import { api } from '@/api'
import type { AccountRef } from '@/data/account-data'
import { readStorage } from '@/lib/storage'
import { GUEST_ACCOUNT_ID } from './guest-id'
import { GUEST_DATA_FLAG, guestStore } from './local-store'

export type GuestAccount = AccountResponse & AccountRef

export const guestAccount = shallowRef<GuestAccount | null>(null)

let watching = false

/** Reads the guest account (again) from this browser. */
export async function loadGuestAccount(): Promise<GuestAccount> {
  if (!watching) {
    watching = true
    guestStore().onChange(() => {
      if (guestAccount.value) void loadGuestAccount().catch(() => undefined)
    })
  }
  const fresh = await api.account(GUEST_ACCOUNT_ID)
  const account: GuestAccount = { ...fresh, source: 'local', liveSync: false }
  guestAccount.value = account
  return account
}

/** Whether this browser holds guest data (the hint; cheap, no IndexedDB). */
export function hasGuestHint(): boolean {
  return readStorage(GUEST_DATA_FLAG) === '1'
}

/** Whether this browser holds guest data worth keeping (reads the store). */
export async function hasGuestData(): Promise<boolean> {
  if (!hasGuestHint()) return false
  try {
    return (await guestStore().ready()).hasData()
  } catch {
    return false
  }
}
