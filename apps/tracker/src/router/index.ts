import type { InspectView, PermissionNode } from '@gdt/shared'
import { nextTick } from 'vue'
import {
  createRouter,
  createWebHistory,
  type RouteLocationNormalized,
  type RouteMeta,
} from 'vue-router'
import { loadSignInOptions } from '@/components/oauth/oauth'
import { pageTitle, type PageKey } from '@/components/shell/nav'
import { onLocaleChange, t } from '@/i18n'
import { setPublicPage } from '@/lib/theme'
import { useAccounts } from '@/stores/accounts'
import { useSession } from '@/stores/session'
import { setAppRouter } from './instance'
import { installLinkPrefetch } from './prefetch'

declare module 'vue-router' {
  interface RouteMeta {
    /** Requires a signed-in user; the app shell wraps it. */
    auth?: boolean
    /** Only for signed-out visitors (login, register). */
    guest?: boolean
    /** A public page (landing, AuthFrame): the whole document is dark while it shows. */
    public?: boolean
    /** The page's title: a key of the `shell.page` messages (top bar and tab title). */
    title?: PageKey
    /** A staff node the page needs: without it the page is Not found (the Worker 404s too). */
    permission?: PermissionNode
    /** A staff page: the sidebar lists the staff pages. */
    staff?: boolean
    /** Inspect: which page of someone's account (logged when opened). */
    inspect?: InspectView
    /**
     * A page whose content runs long (lists, grids, history): the shell leaves about 30% of the
     * screen empty after it, so its last row can be scrolled up to mid-screen. `'param'`: only
     * when the route has a param of that name (Collections' tabs, not its hub).
     */
    long?: true | { param: string }
  }
}

/** Collections' tabs and the wish banners' pages, for the owner's routes and Inspect's alike. */
const COLLECTION_TAB_PATTERN =
  'achievements|world|spincrystals|anecdotes|archive|handbook|living-beings|tcg|recipes|crafting|wardrobe|hangouts|blueprints|music|aranara'
const WISH_BANNER_PATTERN = 'character|weapon|standard|chronicled|beginners'
// data/endgame.ts ENDGAME_MODES (kept here: the router is startup code, the data module isn't).
const ENDGAME_MODE_PATTERN = 'abyss|theater|stygian'

const account = (
  path: string,
  name: string,
  title: PageKey,
  load: () => Promise<unknown>,
  long?: RouteMeta['long'],
) => ({
  path,
  name,
  component: load,
  meta: { auth: true, title, long },
})

const staffPage = (
  path: string,
  name: string,
  title: PageKey,
  permission: PermissionNode,
  load: () => Promise<unknown>,
) => ({ path, name, component: load, meta: { auth: true, staff: true, title, permission } })

/** Inspect's pages that are the owner's long pages (RouteMeta `long`). */
const LONG_INSPECT = new Set<InspectView>([
  'characters',
  'weapons',
  'artifacts',
  'materials',
  'snapshots',
])

/** Someone's account page, read-only, under Inspect (the owner's views, reused). */
const inspectPage = (
  view: InspectView,
  title: PageKey,
  load: () => Promise<unknown>,
  { path = view as string, name = view as string } = {},
) => ({
  path,
  name: `staff-inspect-${name}`,
  component: load,
  meta: {
    auth: true,
    staff: true,
    title,
    permission: 'data.inspect' as const,
    inspect: view,
    long: LONG_INSPECT.has(view) ? (true as const) : undefined,
  },
})

/**
 * The email pages while the email features are paused: back to sign-in. A
 * reset link with its token still opens (admins hand those out).
 */
async function emailPage(to: RouteLocationNormalized) {
  if (to.name === 'reset-password' && typeof to.query.token === 'string' && to.query.token) {
    return true
  }
  return (await loadSignInOptions()).emailFeatures ? true : { name: 'login' }
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  // Arriving on another page with a #hash (/developers#gi_tasks) goes to that element.
  scrollBehavior: (to, from, saved) =>
    saved ??
    (to.path !== from.path ? (to.hash ? { el: to.hash, top: 16 } : { top: 0 }) : undefined),
  routes: [
    {
      path: '/',
      name: 'landing',
      component: () => import('@/views/LandingView.vue'),
      meta: { public: true },
    },
    // The export format and the upload API, for developers (public, dark).
    {
      path: '/developers',
      name: 'developers',
      component: () => import('@/views/DevelopersView.vue'),
      meta: { public: true, title: 'leyline' },
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { guest: true, public: true, title: 'signIn' },
    },
    {
      path: '/register',
      name: 'register',
      component: () => import('@/views/RegisterView.vue'),
      meta: { guest: true, public: true, title: 'createAccount' },
    },
    // Back from Discord / Google with an account no user has linked yet.
    {
      path: '/oauth',
      name: 'oauth-continue',
      component: () => import('@/views/OAuthContinueView.vue'),
      meta: { guest: true, public: true, title: 'continue' },
    },
    // irminsul's "Sign in with the tracker" (README "Sign in from irminsul"):
    // signed out, sign-in comes first and returns here (`?next=`).
    {
      path: '/link',
      name: 'link',
      component: () => import('@/views/LinkView.vue'),
      meta: { auth: true, public: true, title: 'linkIrminsul' },
    },
    // Account recovery: open signed in or not (links arrive by email, or from
    // an admin). While email is paused, only a reset link with a token opens.
    {
      path: '/forgot-password',
      name: 'forgot-password',
      component: () => import('@/views/ForgotPasswordView.vue'),
      meta: { public: true, title: 'resetPassword' },
      beforeEnter: emailPage,
    },
    {
      path: '/reset-password',
      name: 'reset-password',
      component: () => import('@/views/ResetPasswordView.vue'),
      meta: { public: true, title: 'newPassword' },
      beforeEnter: emailPage,
    },
    {
      path: '/verify-email',
      name: 'verify-email',
      component: () => import('@/views/VerifyEmailView.vue'),
      meta: { public: true, title: 'confirmEmail' },
      beforeEnter: emailPage,
    },
    {
      path: '/app',
      component: () => import('@/views/app/AppLayout.vue'),
      meta: { auth: true },
      children: [
        {
          path: '',
          name: 'home',
          component: () => import('@/views/app/HomeView.vue'),
          meta: { auth: true, title: 'accounts' },
        },
        // Pages that existed briefly; old links land on their replacements.
        { path: 'accounts', redirect: { name: 'home' } },
        {
          path: 'accounts/new',
          name: 'account-new',
          component: () => import('@/views/app/NewAccountView.vue'),
          meta: { auth: true, title: 'addAccount' },
        },
        {
          path: 'settings',
          name: 'settings',
          component: () => import('@/views/app/SettingsView.vue'),
          meta: { auth: true, title: 'settings' },
          beforeEnter: (to) =>
            to.hash === '#devices' || to.query.device !== undefined
              ? { name: 'settings-devices', query: to.query, replace: true }
              : true,
        },
        // Irminsul's Configure button (README "Sign in from irminsul") opens
        // `?device=<sid>`; shipped builds still open it on Settings, as
        // `/app/settings?device=<sid>#devices`.
        {
          path: 'settings/devices',
          name: 'settings-devices',
          component: () => import('@/views/app/DevicesView.vue'),
          meta: { auth: true, title: 'devices' },
        },
        {
          path: 'staff',
          component: () => import('@/views/staff/StaffLayout.vue'),
          meta: { auth: true, staff: true, permission: 'staff.view' },
          children: [
            staffPage(
              '',
              'staff-overview',
              'overview',
              'staff.view',
              () => import('@/views/staff/StaffOverviewView.vue'),
            ),
            staffPage(
              'users',
              'staff-users',
              'users',
              'users.view',
              () => import('@/views/staff/StaffUsersView.vue'),
            ),
            staffPage(
              'users/:userId(\\d+)',
              'staff-user',
              'user',
              'users.view',
              () => import('@/views/staff/StaffUserView.vue'),
            ),
            staffPage(
              'storage',
              'staff-storage',
              'storage',
              'data.storage',
              () => import('@/views/staff/StaffStorageView.vue'),
            ),
            staffPage(
              'roles',
              'staff-roles',
              'roles',
              'roles.manage',
              () => import('@/views/staff/StaffRolesView.vue'),
            ),
            staffPage(
              'audit',
              'staff-audit',
              'audit',
              'audit.view',
              () => import('@/views/staff/StaffAuditView.vue'),
            ),
            {
              path: 'inspect/:accountId(\\d+)',
              component: () => import('@/views/staff/StaffInspectLayout.vue'),
              meta: { auth: true, staff: true, permission: 'data.inspect' },
              // The owner's pages in the owner's order (nav.ts ACCOUNT_SECTIONS).
              children: [
                inspectPage(
                  'overview',
                  'overview',
                  () => import('@/views/account/OverviewView.vue'),
                  { path: '' },
                ),
                inspectPage(
                  'characters',
                  'characters',
                  () => import('@/views/account/CharactersView.vue'),
                ),
                inspectPage('weapons', 'weapons', () => import('@/views/account/WeaponsView.vue')),
                inspectPage(
                  'artifacts',
                  'artifacts',
                  () => import('@/views/account/ArtifactsView.vue'),
                ),
                inspectPage(
                  'materials',
                  'materials',
                  () => import('@/views/account/MaterialsView.vue'),
                ),
                inspectPage('planner', 'planner', () => import('@/views/account/PlannerView.vue')),
                inspectPage(
                  'collections',
                  'collections',
                  () => import('@/views/account/CollectionsView.vue'),
                  { path: `collections/:tab(${COLLECTION_TAB_PATTERN})?` },
                ),
                inspectPage(
                  'wishes',
                  'wishHistory',
                  () => import('@/views/account/WishesView.vue'),
                ),
                inspectPage(
                  'wishes',
                  'wishHistory',
                  () => import('@/views/account/WishBannerView.vue'),
                  { path: `wishes/:banner(${WISH_BANNER_PATTERN})`, name: 'wishes-banner' },
                ),
                inspectPage(
                  'snapshots',
                  'snapshots',
                  () => import('@/views/account/SnapshotsView.vue'),
                ),
              ],
            },
          ],
        },
        {
          path: 'a/:accountId(\\d+)',
          component: () => import('@/views/account/AccountLayout.vue'),
          meta: { auth: true },
          children: [
            account(
              '',
              'account-overview',
              'overview',
              () => import('@/views/account/OverviewView.vue'),
            ),
            // Folded into Overview (its monthly analysis is there now).
            { path: 'progression', redirect: { name: 'account-overview' } },
            account(
              'characters',
              'account-characters',
              'characters',
              () => import('@/views/account/CharactersView.vue'),
              true,
            ),
            account(
              'weapons',
              'account-weapons',
              'weapons',
              () => import('@/views/account/WeaponsView.vue'),
              true,
            ),
            account(
              'artifacts',
              'account-artifacts',
              'artifacts',
              () => import('@/views/account/ArtifactsView.vue'),
              true,
            ),
            account(
              'materials',
              'account-materials',
              'materials',
              () => import('@/views/account/MaterialsView.vue'),
              true,
            ),
            account(
              'planner',
              'account-planner',
              'planner',
              () => import('@/views/account/PlannerView.vue'),
              true,
            ),
            // A tab of Collections now (2026-10-27), with the others' back button.
            {
              path: 'achievements',
              redirect: (to) => ({
                name: 'account-collections',
                params: { ...to.params, tab: 'achievements' },
              }),
            },
            // A tab of Collections now.
            {
              path: 'anecdotes',
              redirect: (to) => ({
                name: 'account-collections',
                params: { ...to.params, tab: 'anecdotes' },
              }),
            },
            // The Events tab is gone (2026-10-27): old links open the hub.
            {
              path: 'collections/events',
              redirect: (to) => ({ name: 'account-collections', params: to.params }),
            },
            account(
              `collections/:tab(${COLLECTION_TAB_PATTERN})?`,
              'account-collections',
              'collections',
              () => import('@/views/account/CollectionsView.vue'),
              { param: 'tab' },
            ),
            account(
              `endgame/:mode(${ENDGAME_MODE_PATTERN})?/:season(\\d+)?`,
              'account-endgame',
              'endgame',
              () => import('@/views/account/EndgameView.vue'),
              true,
            ),
            account(
              'wishes',
              'account-wishes',
              'wishHistory',
              () => import('@/views/account/WishesView.vue'),
              true,
            ),
            account(
              `wishes/:banner(${WISH_BANNER_PATTERN})`,
              'account-wishes-banner',
              'wishHistory',
              () => import('@/views/account/WishBannerView.vue'),
              true,
            ),
            account(
              'snapshots',
              'account-snapshots',
              'snapshots',
              () => import('@/views/account/SnapshotsView.vue'),
              true,
            ),
            { path: 'export', redirect: { name: 'account-snapshots' } },
            account(
              'import',
              'account-import',
              'import',
              () => import('@/views/account/ImportView.vue'),
            ),
            account(
              'settings',
              'account-settings',
              'accountSettings',
              () => import('@/views/account/AccountSettingsView.vue'),
            ),
          ],
        },
      ],
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('@/views/NotFoundView.vue'),
      meta: { title: 'notFound' },
    },
  ],
})

/**
 * Opening the app: the page's code and (on an account page this device has
 * seen) its data start loading at once, beside the bootstrap request, rather
 * than one after the other.
 */
let opening = true
function startLoadingAhead(to: RouteLocationNormalized) {
  for (const record of to.matched) {
    const load = record.components?.default
    if (typeof load === 'function') void (load as () => Promise<unknown>)().catch(() => undefined)
  }
  if (to.meta.auth) {
    void import('@/data/boot-prefetch')
      .then((m) => m.prefetchAccountPage(to.path))
      .catch(() => undefined)
  }
}

router.beforeEach(async (to) => {
  const session = useSession()
  if (opening) {
    opening = false
    if (session.status === 'unknown') startLoadingAhead(to)
  }
  if (to.meta.auth || to.meta.guest || to.name === 'landing') await session.ensureLoaded()

  if (to.meta.auth && session.status !== 'signed-in') {
    return { name: 'login', query: to.fullPath !== '/app' ? { next: to.fullPath } : {} }
  }
  if (to.meta.guest && session.status === 'signed-in') return { name: 'home' }
  // A staff page without its node doesn't exist, as far as this user can tell.
  if (to.matched.some((r) => r.meta.permission && !session.can(r.meta.permission))) {
    return {
      name: 'not-found',
      params: { pathMatch: to.path.slice(1).split('/') },
      query: to.query,
      hash: to.hash,
      replace: true,
    }
  }
  if (to.meta.auth) await useAccounts().ensureLoaded()
})

/**
 * Moving between pages crossfades the old page into the new one (View
 * Transitions) instead of swapping it at once: the old page stays on screen
 * until the new one has rendered (its code and, when cached, its data are in
 * by then: links load their page's code on hover or touch, AccountLayout
 * preloads the neighbours' and the newest capture), then fades out over it. Not for
 * query changes on one page (filters, an open dialog), nor with reduced
 * motion or without the API.
 */
let finishTransition: (() => void) | null = null
router.beforeResolve((to, from) => {
  if (!from.matched.length || to.path === from.path) return
  if (!('startViewTransition' in document)) return
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  return new Promise<void>((resolve) => {
    const transition = document.startViewTransition(
      () =>
        new Promise<void>((done) => {
          finishTransition = done
          resolve()
        }),
    )
    // A transition skipped or aborted must never hold the navigation.
    transition.ready.catch(() => resolve())
  })
})

router.afterEach((to) => {
  if (finishTransition) {
    const finish = finishTransition
    finishTransition = null
    // The new page renders on the next tick; the fade starts from there.
    void nextTick().then(finish)
  }
  setPublicPage(to.meta.public === true)
  setDocumentTitle(to)
})

/** The tab's title: the page's, in the language on screen (again on a switch). */
function setDocumentTitle(to: RouteLocationNormalized) {
  const title = pageTitle(to.meta)
  document.title = title ? t('shell.documentTitle', { title }) : t('shell.site')
}
onLocaleChange(() => setDocumentTitle(router.currentRoute.value))

/** After a deploy, an open tab may ask for a chunk that no longer exists: reload once. */
router.onError((error, to) => {
  finishTransition?.()
  finishTransition = null
  const message = String((error as Error)?.message ?? error)
  if (
    !/dynamically imported module|Importing a module script failed|Failed to fetch/i.test(message)
  )
    return
  try {
    const last = Number(sessionStorage.getItem('gdt:chunk-reload') ?? 0)
    if (Date.now() - last < 10_000) return
    sessionStorage.setItem('gdt:chunk-reload', String(Date.now()))
  } catch {
    // Without sessionStorage we cannot rate-limit; reload anyway.
  }
  window.location.assign(to.fullPath)
})

// A page's code loads when a link to it is hovered, focused or touched.
installLinkPrefetch(router)
setAppRouter(router)

export default router
