import { inject, provide, type ComputedRef, type InjectionKey } from 'vue'
import type { RouteLocationRaw } from 'vue-router'

/**
 * Where a Fun page is shown (docs/plans/fun.md): an account's Fun section
 * (`/app/a/:id/fun`, `/guest/fun`, `/demo/fun`) or the public pages (`/fun`,
 * open signed out). The view around the pages provides it, so the four page
 * components never read the account themselves and run with no account.
 */
export interface FunHost {
  /** The account the page sits in; null on the public page. Old per-account settings are read from it. */
  accountId: number | null
  /** Whether the team randomizer can read the account's roster (only inside an account). */
  roster: boolean
  /** Where the team randomizer remembers what was set: per account in the app, its own on the public page. */
  teamKey: string
  /** The hub, as a link in this place. */
  hub: RouteLocationRaw
  /** A sub-page, as a link in this place. */
  page: (slug: string) => RouteLocationRaw
}

const FUN_HOST: InjectionKey<ComputedRef<FunHost>> = Symbol('fun-host')

export function provideFunHost(host: ComputedRef<FunHost>): void {
  provide(FUN_HOST, host)
}

export function useFunHost(): ComputedRef<FunHost> {
  const host = inject(FUN_HOST, null)
  if (!host) throw new Error('useFunHost() outside a Fun view')
  return host
}

/** The team randomizer's key on the public page (the same as the old /randomizer page's). */
export const PUBLIC_TEAM_KEY = 'fun:randomizer:public'

/** The public pages' host. */
export function publicFunHost(): FunHost {
  return {
    accountId: null,
    roster: false,
    teamKey: PUBLIC_TEAM_KEY,
    hub: '/fun',
    page: (slug) => `/fun/${slug}`,
  }
}
