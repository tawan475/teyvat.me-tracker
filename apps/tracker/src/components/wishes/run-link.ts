import type { RouteLocationRaw } from 'vue-router'
import { useRoute } from 'vue-router'
import type { EventBanner } from '@/data/wish-history'
import { runKey } from '@/data/wish-run-key'
import { useAccountRoute } from '@/views/account/context'

/**
 * Where a banner run opens: the account's Wishes page, Banner history view,
 * with that run expanded (`?run=`; WishesView reads it). For the banner
 * page's 5★ headings and the pull table's Banner column.
 */
export function useRunLink(): (banner: EventBanner) => RouteLocationRaw {
  const route = useRoute()
  const accountRoute = useAccountRoute()
  return (banner) => ({
    name: accountRoute('account-wishes'),
    params: { accountId: route.params.accountId },
    query: { run: runKey(banner) },
  })
}
