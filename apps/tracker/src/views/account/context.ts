import type { AccountAccess, AccountResponse } from '@gdt/shared'
import { computed, inject, provide, type ComputedRef, type InjectionKey } from 'vue'
import type { RouteLocationRaw } from 'vue-router'

const ACCOUNT: InjectionKey<ComputedRef<AccountResponse>> = Symbol('account')
const MODE: InjectionKey<AccountMode> = Symbol('account-mode')

/**
 * How the account's pages are shown. The owner's (AccountLayout) can change
 * things; staff Inspect (StaffInspectLayout) is read-only: nothing is saved,
 * account settings (favourites, tracked charts, the Planner) are not read,
 * and links to the owner's own pages are hidden.
 */
export interface AccountMode {
  readOnly: boolean
  /**
   * The public demo account (DemoLayout, docs/plans/open-site.md §2): pages
   * stay interactive (changes are kept in the tab, src/api/demo-store.ts), but
   * whatever would upload, store or reach a device is hidden: import, keys,
   * sharing, deletion, Capture.
   */
  demo?: boolean
  /**
   * Guest mode (GuestLayout, docs/plans/open-site.md §4): the account kept in
   * this browser. Everything works and is kept; what needs a server (Capture
   * uploads, live sync, alerts, sharing, more accounts) shows a lock.
   */
  guest?: boolean
  /** Staff with `data.delete`: purges snapshots (Inspect's Snapshots page). */
  purge?: (ids: number[]) => Promise<number>
  /** Re-reads the account after a purge. */
  reload?: () => Promise<AccountResponse | undefined>
  /** The route a link to an account page (`account-weapons`…) goes to here. */
  route?: (name: string) => string
}

const OWNER: AccountMode = { readOnly: false }

/** Provided by AccountLayout (and Inspect) for every account section. */
export function provideAccount(
  account: ComputedRef<AccountResponse>,
  mode: AccountMode = OWNER,
): void {
  provide(ACCOUNT, account)
  provide(MODE, mode)
}

export function useAccountMode(): AccountMode {
  return inject(MODE, OWNER)
}

/** True on staff Inspect pages: show, never save. */
export function useReadOnly(): boolean {
  return useAccountMode().readOnly
}

/** True on the public demo's pages (see AccountMode `demo`). */
export function useDemo(): boolean {
  return useAccountMode().demo === true
}

/** True on guest mode's pages (see AccountMode `guest`). */
export function useGuest(): boolean {
  return useAccountMode().guest === true
}

/**
 * The user's access to the account (account sharing): 'owner', or the role
 * it was shared with them as. Owner-only controls (rename, keys, deleting
 * snapshots, sharing) check it; a viewer's pages are also read-only (`useReadOnly`).
 */
export function useAccess(): ComputedRef<AccountAccess> {
  const account = useAccount()
  return computed(() => account.value.access ?? 'owner')
}

/** Maps an account page's route name to where it opens here (Inspect has its own). */
export function useAccountRoute(): (name: string) => string {
  const mode = useAccountMode()
  return (name) => mode.route?.(name) ?? name
}

/**
 * A link to one of the account's own pages (`account-import`…) where it
 * opens here: the owner's route with the account's id, or the demo's or the
 * guest's (which have none).
 */
export function useAccountLink(): (name: string) => RouteLocationRaw {
  const mode = useAccountMode()
  const account = inject(ACCOUNT, null)
  return (name) =>
    mode.demo || mode.guest
      ? { name: mode.route?.(name) ?? name }
      : { name, params: { accountId: account?.value.id } }
}

/**
 * The account the current route is about. Reactive: after an import the
 * accounts store reloads it and `dataVersion` moves, which is what data
 * loaders (see @/data/account-data) key their caches on.
 */
export function useAccount(): ComputedRef<AccountResponse> {
  const account = inject(ACCOUNT)
  if (!account) throw new Error('useAccount() outside an account route')
  return account
}
