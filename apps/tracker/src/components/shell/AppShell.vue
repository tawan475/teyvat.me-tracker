<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter, type RouteLocationRaw } from 'vue-router'
import { useEventListener, useMediaQuery, usePreferredReducedMotion } from '@vueuse/core'
import {
  ArrowLeft,
  History,
  LayoutGrid,
  LogOut,
  Menu,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  UserPlus,
  Lock,
  Monitor,
  Settings,
  ShieldCheck,
  Sun,
  Upload,
  X,
} from 'lucide-vue-next'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import type { AccountResponse } from '@gdt/shared'
import { readStorage, writeStorage } from '@/lib/storage'
import { applyTheme, resolvedTheme } from '@/lib/theme'
import { lastAccountId, useAccounts } from '@/stores/accounts'
import { useFeedback } from '@/stores/feedback'
import { copyText } from '@/data/import-setup'
import { useSession } from '@/stores/session'
import { useStaff } from '@/stores/staff'
import AccountSwitcher from './AccountSwitcher.vue'
import AppearanceButton from './AppearanceButton.vue'
import CaptureButton from './CaptureButton.vue'
import DiscordButton from './DiscordButton.vue'
import KofiButton from './KofiButton.vue'
import LastSync from './LastSync.vue'
import { t } from '@/i18n'
import { ACCOUNT_SECTIONS, NAV_PARENT, STAFF_SECTIONS, pageTitle } from './nav'
import { USER_SETTINGS_DEFAULTS } from '@gdt/shared/settings'
import { NAV_COLLAPSED_KEY, useNavCollapse } from './nav-collapse'
import SectionLabel from './SectionLabel.vue'
import SiteSearch from './SiteSearch.vue'
import TimeTravelBar from '@/components/time-travel/TimeTravelBar.vue'
import TimeTravelPicker from '@/components/time-travel/TimeTravelPicker.vue'
import { loadSnapshots } from '@/data/account-data'
import { travelling } from '@/data/time-travel'
import { useResource } from '@/data/use-resource'
import type { SnapshotResponse } from '@gdt/shared'

/**
 * The signed-in frame, in the original dashboard layout: a sidebar with
 * section labels, a top bar with the page title and account, and (on
 * mobile) a drawer plus a bottom tab bar. On desktop the sidebar collapses
 * to an icon rail (remembered per device, see nav-collapse.ts).
 *
 * `demo`: the public demo account's frame (DemoLayout): its pages only, no
 * account picker, no import or Capture, and a sign-up link where the user's
 * name and sign-out would be. The `band` slot sits above the top bar.
 *
 * `guest`: guest mode's frame (GuestLayout, docs/plans/open-site.md §4): the
 * account kept in this browser, every page of it (Import and Manage too), the
 * Guest chip in the top bar, no account picker or Capture button.
 */
const props = defineProps<{ demo?: AccountResponse | null; guest?: AccountResponse | null }>()
// null while the demo's account loads: the demo's frame already.
const demoMode = computed(() => props.demo !== undefined)
const guestMode = computed(() => props.guest !== undefined)
/** An account outside the user's list (the demo, the guest): its own frame. */
const framed = computed(() => demoMode.value || guestMode.value)
/** The demo's route for an account page's (`account-characters` -> `demo-characters`). */
const demoName = (name: string) => `demo-${name.slice('account-'.length)}`
const guestName = (name: string) => `guest-${name.slice('account-'.length)}`
const route = useRoute()
const router = useRouter()
const session = useSession()
const accounts = useAccounts()
const feedback = useFeedback()
const staff = useStaff()
const drawer = ref(false)

/** A staff page: the sidebar lists the staff pages instead of the account's. */
const staffMode = computed(() => route.meta.staff === true)
const staffSections = computed(() =>
  STAFF_SECTIONS.filter((s) => session.can(s.permission)).map((s) => ({
    ...s,
    label: t(`shell.nav.${s.label}`),
    to: { name: s.name },
  })),
)
/** Which staff page a route belongs to (a user's page is under Users). */
const staffActive = (name: string) =>
  route.name === name ||
  (name === 'staff-users' &&
    (route.name === 'staff-user' || String(route.name ?? '').startsWith('staff-inspect')))

watch(
  () => route.fullPath,
  () => (drawer.value = false),
)

/** Matches the rail's width transition (`.nav-rail` below). */
const RAIL_MS = 200
// Tailwind's lg: the sidebar is a drawer below it, and the drawer is always full width.
const isDesktop = useMediaQuery('(min-width: 64rem)')
const reducedMotion = usePreferredReducedMotion()
const nav = useNavCollapse({
  read: () => readStorage(NAV_COLLAPSED_KEY),
  write: (value) => writeStorage(NAV_COLLAPSED_KEY, value),
})
/** The icon rail's width, and the labels fading out. */
const narrow = computed(() => nav.collapsed.value && isDesktop.value)
/**
 * The icon-only arrangement (stacked buttons). It switches with the width
 * when collapsing, but only once the rail has grown when expanding, so the
 * side-by-side rows never squeeze into the narrow rail mid-animation.
 */
const compact = ref(narrow.value)
let settle: ReturnType<typeof setTimeout> | undefined
watch(narrow, (value) => {
  clearTimeout(settle)
  if (value || !isDesktop.value || reducedMotion.value === 'reduce') compact.value = value
  else settle = setTimeout(() => (compact.value = false), RAIL_MS)
})
onBeforeUnmount(() => clearTimeout(settle))

const currentId = computed<number | null>(() => {
  if (demoMode.value) return props.demo?.id ?? null
  if (guestMode.value) return props.guest?.id ?? null
  // Inspect's account is someone else's: the switcher keeps the user's own.
  const param = staffMode.value ? NaN : Number(route.params.accountId)
  if (Number.isSafeInteger(param) && param > 0) return param
  const last = lastAccountId()
  return last && accounts.byId.has(last) ? last : (accounts.list[0]?.id ?? null)
})
const current = computed(() =>
  demoMode.value
    ? (props.demo ?? undefined)
    : guestMode.value
      ? (props.guest ?? undefined)
      : currentId.value
        ? accounts.byId.get(currentId.value)
        : undefined,
)

/**
 * Time travel (data/time-travel.ts): the bar under the app bar while an
 * account page shows the past, and the clock in the top bar that opens the
 * capture picker. Both read the account's snapshot list (now's).
 */
const travelHere = computed(() => {
  const state = travelling.value
  return state && current.value && state.accountId === current.value.id ? state.travel : null
})
const canTravel = computed(
  () =>
    !staffMode.value &&
    !demoMode.value &&
    !guestMode.value &&
    !!current.value &&
    (current.value.snapshotCount ?? 0) > 1,
)
const travelPicking = ref(false)
const travelAnchor = ref<HTMLElement | null>(null)
function openTravelPicker(event: MouseEvent) {
  travelAnchor.value = event.currentTarget as HTMLElement
  travelPicking.value = true
}
const travelSnapshots = useResource(
  () => (canTravel.value && current.value ? current.value : null),
  (a) => (a ? loadSnapshots(a) : Promise.resolve([] as SnapshotResponse[])),
)

/** Site-wide search: the top bar's button, Ctrl+K (⌘K) anywhere, "/" outside a text field. */
const searching = ref(false)
const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (staffMode.value) return
  const target = event.target as HTMLElement | null
  const typing =
    !!target && (/^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName) || target.isContentEditable)
  const combo = (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k'
  const slash = event.key === '/' && !typing && !event.ctrlKey && !event.metaKey && !event.altKey
  if (!combo && !slash) return
  // Another dialog open: leave its keys alone.
  if (!searching.value && document.querySelector('dialog[open]')) return
  event.preventDefault()
  searching.value = true
})

/** The top bar's account name and UID copy on click. */
async function copyFromBar(what: 'name' | 'uid', value: string, event: MouseEvent) {
  const ok = await copyText(value, event.currentTarget as HTMLElement | null)
  const title = what === 'name' ? t('shell.nameCopied') : t('shell.uidCopied')
  if (ok) feedback.toast({ tone: 'success', title, detail: value })
  else feedback.toast({ tone: 'danger', title: t('common.copyFailed'), detail: value })
}

const sections = computed(() => {
  if (demoMode.value) {
    // Manage (rename, keys, sharing, deleting) is the owner's: not in the demo.
    return ACCOUNT_SECTIONS.filter((s) => s.name !== 'account-settings').map((s) => ({
      ...s,
      key: s.label,
      name: demoName(s.name),
      label: t(`shell.nav.${s.label}`),
      to: { name: demoName(s.name) } as RouteLocationRaw,
    }))
  }
  if (guestMode.value) {
    return ACCOUNT_SECTIONS.map((s) => ({
      ...s,
      key: s.label,
      name: guestName(s.name),
      label: t(`shell.nav.${s.label}`),
      to: { name: guestName(s.name) } as RouteLocationRaw,
    }))
  }
  return currentId.value
    ? ACCOUNT_SECTIONS.map((s) => ({
        ...s,
        key: s.label,
        label: t(`shell.nav.${s.label}`),
        to: { name: s.name, params: { accountId: currentId.value } } as RouteLocationRaw,
      }))
    : []
})
/** The phone tab bar: the pages the user picked (Settings → Appearance), in the sidebar's order. */
const primary = computed(() => {
  if (staffMode.value) return staffSections.value.filter((s) => s.primary)
  const picked = new Set(session.settings.tabBar ?? USER_SETTINGS_DEFAULTS.tabBar)
  return sections.value.filter((s) => picked.has(s.key))
})
const title = computed(() => pageTitle(route.meta))

// Flips what is painted; from "system" it pins the opposite theme.
const theme = resolvedTheme
async function toggleTheme() {
  // Signed out (the demo): this browser only.
  if (session.status !== 'signed-in') {
    applyTheme(theme.value === 'dark' ? 'light' : 'dark')
    return
  }
  try {
    await session.updateSettings({ theme: theme.value === 'dark' ? 'light' : 'dark' })
  } catch (error) {
    feedback.error(t('shell.themeNotSaved'), error)
  }
}

async function signOut() {
  await session.logout()
  accounts.clear()
  await router.push({ name: 'login' })
}

/**
 * A long page (RouteMeta `long`): about 30% of the screen stays empty after its content, so the
 * last row can be scrolled up to mid-screen instead of sitting on the bottom edge.
 */
const longPage = computed(() => {
  const long = route.meta.long
  return long === true || (!!long && !!route.params[long.param])
})

const routeSection = computed(() => {
  const name = String(route.name ?? '')
  return NAV_PARENT[name] ?? name
})
const isActive = (name: string) =>
  name.startsWith('staff-')
    ? staffActive(name)
    : routeSection.value === name || routeSection.value.startsWith(`${name}-`)
const navClass = (active: boolean) =>
  active
    ? 'bg-surface-overlay text-text-primary'
    : 'text-text-secondary hover:bg-surface-overlay/60 hover:text-text-primary'
/** A link's label: clipped to nothing and faded in the rail (still read by screen readers). */
const labelClass = computed(() => [
  'nav-fade min-w-0 overflow-hidden whitespace-nowrap',
  narrow.value ? 'opacity-0' : '',
])
const footButton =
  'flex min-h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg border border-border-strong px-3 py-2 text-sm font-medium text-text-secondary hover:bg-surface-overlay hover:text-text-primary'
</script>

<template>
  <div class="flex min-h-dvh">
    <div
      v-if="drawer"
      class="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm lg:hidden"
      aria-hidden="true"
      @click="drawer = false"
    />
    <!-- Sidebar on desktop; the same markup slides in as a drawer on mobile.
         Collapsed (desktop only) it is a 4.75rem rail: every icon keeps its
         place, so only the labels go. -->
    <aside
      class="nav-rail fixed inset-y-0 left-0 z-50 flex shrink-0 flex-col overflow-hidden border-r border-border-default bg-surface-nav lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0"
      :class="[drawer ? 'translate-x-0' : '-translate-x-full', narrow ? 'w-[4.75rem]' : 'w-64']"
    >
      <!-- The toggle sits at the right edge, so the shrinking rail carries it to the middle. -->
      <div
        class="flex h-16 shrink-0 items-center border-b border-border-default pr-[1.125rem]"
        :class="narrow ? 'pl-[1.125rem]' : 'pl-6'"
      >
        <RouterLink
          :to="{ name: 'home' }"
          class="nav-fade flex min-w-0 items-center gap-2 overflow-hidden text-xl font-bold tracking-tight whitespace-nowrap"
          :class="narrow ? 'invisible opacity-0' : ''"
        >
          <span class="text-paimon drop-shadow-[0_0_8px_var(--paimon-glow)]" aria-hidden="true"
            >✦</span
          >
          Teyvat.me
        </RouterLink>
        <UiIconButton
          :label="narrow ? $t('shell.expandMenu') : $t('shell.collapseMenu')"
          class="ml-auto max-lg:hidden"
          @click="nav.toggle"
        >
          <PanelLeftOpen v-if="narrow" class="size-5" aria-hidden="true" />
          <PanelLeftClose v-else class="size-5" aria-hidden="true" />
        </UiIconButton>
        <UiIconButton
          :label="$t('shell.closeMenu')"
          class="ml-auto lg:hidden"
          @click="drawer = false"
        >
          <X class="size-5" aria-hidden="true" />
        </UiIconButton>
      </div>

      <!-- In the rail the scrollbar takes its 10px out of the right padding
           (a kept gutter), so the items stay centred whether it shows or not. -->
      <div
        class="flex flex-1 flex-col gap-7 overflow-x-hidden overflow-y-auto py-6 pl-4"
        :class="narrow ? 'pr-[calc(1rem_-_10px)] [scrollbar-gutter:stable]' : 'pr-4'"
      >
        <div v-if="staffMode">
          <SectionLabel :label="$t('shell.section.staff')" :collapsed="narrow" />
          <nav class="space-y-0.5" :aria-label="$t('shell.section.staff')">
            <RouterLink
              v-for="section in staffSections"
              :key="section.name"
              :to="section.to"
              class="flex items-center gap-3 rounded-md px-3 py-2.5 text-base font-medium transition-colors"
              :class="navClass(isActive(section.name))"
              :aria-current="isActive(section.name) ? 'page' : undefined"
              :title="narrow ? section.label : undefined"
            >
              <component :is="section.icon" class="size-5 shrink-0" aria-hidden="true" />
              <span :class="labelClass">{{ section.label }}</span>
            </RouterLink>
          </nav>
        </div>

        <div v-else>
          <SectionLabel :label="$t('shell.section.account')" :collapsed="narrow" />
          <div
            v-if="demoMode"
            class="flex min-h-11 items-center gap-2 rounded-lg border border-border-default px-3 py-2"
            :title="narrow ? $t('demo.account') : undefined"
          >
            <span class="size-2 shrink-0 rounded-full bg-paimon" aria-hidden="true" />
            <span :class="labelClass" class="text-sm font-semibold">{{ $t('demo.account') }}</span>
            <span
              v-if="demo?.uid && !narrow"
              class="tabular ml-auto truncate font-mono text-xs text-text-muted"
              >{{ demo.uid }}</span
            >
          </div>
          <template v-else-if="guestMode">
            <div
              class="flex min-h-11 items-center gap-2 rounded-lg border border-border-default px-3 py-2"
              :title="narrow ? $t('guest.label') : undefined"
            >
              <Monitor class="size-4 shrink-0 text-accent-text" aria-hidden="true" />
              <span :class="labelClass" class="text-sm font-semibold">{{
                guest?.name || $t('guest.label')
              }}</span>
              <span
                v-if="guest?.uid && !narrow"
                class="tabular ml-auto truncate font-mono text-xs text-text-muted"
                >{{ guest.uid }}</span
              >
            </div>
            <!-- A second Genshin account is an account's (the guest has one): its lock. -->
            <RouterLink
              v-if="session.status !== 'signed-in'"
              :to="{ name: 'register' }"
              class="mt-1 flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-overlay/60 hover:text-text-primary"
              :title="$t('guest.lock.accounts')"
            >
              <Lock class="size-4 shrink-0" aria-hidden="true" />
              <span :class="labelClass">{{ $t('guest.addAccount') }}</span>
            </RouterLink>
          </template>
          <AccountSwitcher v-else :current-id="currentId" :collapsed="narrow" />
          <nav
            v-if="sections.length"
            class="mt-3 space-y-0.5"
            :aria-label="$t('shell.section.account')"
          >
            <RouterLink
              v-for="section in sections"
              :key="section.name"
              :to="section.to"
              class="flex items-center gap-3 rounded-md px-3 py-2.5 text-base font-medium transition-colors"
              :class="navClass(isActive(section.name))"
              :aria-current="isActive(section.name) ? 'page' : undefined"
              :title="narrow ? section.label : undefined"
            >
              <component :is="section.icon" class="size-5 shrink-0" aria-hidden="true" />
              <span :class="labelClass">{{ section.label }}</span>
            </RouterLink>
          </nav>
        </div>

        <div class="mt-auto">
          <SectionLabel :label="$t('shell.section.system')" :collapsed="narrow" />
          <nav class="space-y-0.5" :aria-label="$t('shell.section.system')">
            <!-- The theme button sits beside the last link of the section: Settings,
                 or in the demo (no Settings) Accounts, so it never has a row alone
                 while a link is there to sit beside (the user's call, 2026-11-06). -->
            <div
              v-if="!framed || session.status === 'signed-in'"
              class="flex"
              :class="compact ? 'flex-col gap-0.5' : 'items-center gap-1'"
            >
              <RouterLink
                :to="{ name: 'home' }"
                class="flex min-w-0 flex-1 items-center gap-3 rounded-md px-3 py-2.5 text-base font-medium"
                :class="navClass(isActive('home'))"
                :aria-current="isActive('home') ? 'page' : undefined"
                :title="narrow ? $t('shell.accounts') : undefined"
              >
                <LayoutGrid class="size-5 shrink-0" aria-hidden="true" />
                <span :class="labelClass">{{ $t('shell.accounts') }}</span>
              </RouterLink>
              <UiIconButton
                v-if="framed"
                :label="theme === 'dark' ? $t('shell.lightTheme') : $t('shell.darkTheme')"
                :class="compact ? 'self-center' : ''"
                @click="toggleTheme"
              >
                <Moon v-if="theme === 'dark'" class="size-5" aria-hidden="true" />
                <Sun v-else class="size-5" aria-hidden="true" />
              </UiIconButton>
            </div>
            <RouterLink
              v-if="!framed && session.can('staff.view')"
              :to="{ name: 'staff-overview' }"
              class="flex items-center gap-3 rounded-md px-3 py-2.5 text-base font-medium"
              :class="navClass(staffMode)"
              :aria-current="route.name === 'staff-overview' ? 'page' : undefined"
              :title="narrow ? $t('shell.staff') : undefined"
            >
              <ShieldCheck class="size-5 shrink-0" aria-hidden="true" />
              <span :class="labelClass">{{ $t('shell.staff') }}</span>
            </RouterLink>
            <div
              v-if="!framed || session.status !== 'signed-in'"
              class="flex"
              :class="compact ? 'flex-col gap-0.5' : 'items-center gap-1'"
            >
              <RouterLink
                v-if="!framed"
                :to="{ name: 'settings' }"
                class="flex min-w-0 flex-1 items-center gap-3 rounded-md px-3 py-2.5 text-base font-medium"
                :class="navClass(isActive('settings'))"
                :aria-current="isActive('settings') ? 'page' : undefined"
                :title="narrow ? $t('shell.settings') : undefined"
              >
                <Settings class="size-5 shrink-0" aria-hidden="true" />
                <span :class="labelClass">{{ $t('shell.settings') }}</span>
              </RouterLink>
              <UiIconButton
                :label="theme === 'dark' ? $t('shell.lightTheme') : $t('shell.darkTheme')"
                :class="compact ? 'self-center' : ''"
                @click="toggleTheme"
              >
                <Moon v-if="theme === 'dark'" class="size-5" aria-hidden="true" />
                <Sun v-else class="size-5" aria-hidden="true" />
              </UiIconButton>
            </div>
          </nav>
        </div>
      </div>

      <div class="border-t border-border-default p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div
          v-if="!framed"
          class="mb-3 flex items-center gap-3 px-1.5"
          :title="narrow ? session.me?.username : undefined"
        >
          <span
            class="nav-fade min-w-0 truncate text-sm font-semibold"
            :class="narrow ? 'opacity-0' : ''"
            >{{ session.me?.username }}</span
          >
        </div>
        <!-- Side by side; stacked icons in the rail. -->
        <div class="flex gap-2" :class="compact ? 'flex-col' : ''">
          <RouterLink
            :to="{ name: 'landing' }"
            :class="footButton"
            :title="$t('shell.landingPage')"
          >
            <ArrowLeft class="size-4 shrink-0" aria-hidden="true" />
            <span :class="compact ? 'sr-only' : ''">{{ $t('shell.return') }}</span>
          </RouterLink>
          <RouterLink
            v-if="framed && session.status !== 'signed-in'"
            :to="{ name: 'register' }"
            :class="footButton"
            :title="compact ? $t('demo.signUp') : undefined"
          >
            <UserPlus class="size-4 shrink-0" aria-hidden="true" />
            <span :class="compact ? 'sr-only' : ''">{{ $t('demo.signUp') }}</span>
          </RouterLink>
          <button
            v-else-if="!framed"
            type="button"
            :class="footButton"
            :title="compact ? $t('common.signOut') : undefined"
            @click="signOut"
          >
            <LogOut class="size-4 shrink-0" aria-hidden="true" />
            <span :class="compact ? 'sr-only' : ''">{{ $t('common.signOut') }}</span>
          </button>
        </div>
      </div>
    </aside>

    <div class="flex min-w-0 flex-1 flex-col">
      <!-- Solid, no backdrop blur (also the tab bar below): a blurred bar redraws
           everything scrolling under it on every frame, over 90% of a scroll
           frame's work on a long page (measured 2026-10-30). -->
      <!-- The demo's band rides with the bar; sticky headings measure the
           bar's foot (`data-app-bar`), so they clear both. -->
      <div class="sticky top-0 z-30">
        <slot name="band" />
        <header
          data-app-bar
          class="flex h-16 shrink-0 items-center gap-3 border-b border-border-default bg-surface-nav px-4 shadow-sm sm:px-8"
        >
          <UiIconButton
            :label="$t('shell.openMenu')"
            class="-ml-2 lg:hidden"
            @click="drawer = true"
          >
            <Menu class="size-5" aria-hidden="true" />
          </UiIconButton>
          <!-- On phones the title takes what the buttons leave; under 7rem it
             hides rather than show "C…" (the user's call, 2026-11-04). -->
          <span class="bar-title min-w-0 flex-1 sm:flex-none">
            <span class="block truncate text-lg font-semibold">{{ title }}</span>
          </span>
          <template v-if="staffMode">
            <template v-if="staff.topRole">
              <div class="hidden h-4 w-px bg-border-strong sm:block" />
              <span
                class="hidden min-w-0 items-center gap-2 text-sm font-medium text-text-muted sm:flex"
                :title="$t('shell.highestRole')"
              >
                <span
                  class="size-2 shrink-0 rounded-full"
                  :style="{ backgroundColor: staff.topRole.color }"
                />
                <span class="truncate">{{ staff.topRole.name }}</span>
              </span>
            </template>
          </template>
          <template v-else-if="current">
            <div class="hidden h-4 w-px bg-border-strong sm:block" />
            <!-- The line takes what the buttons leave (flex-1, a size container)
               and gives way in order (CSS below): the sync label first, then
               the name, rather than show "p…" beside the UID (the user's
               call, 2026-11-05). -->
            <span
              class="bar-account hidden min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-sm font-medium text-text-muted sm:flex"
            >
              <span class="size-2 shrink-0 rounded-full bg-emerald-500" />
              <button
                v-if="current.name"
                type="button"
                class="bar-name min-w-0 truncate rounded-md px-1 py-0.5 transition-colors hover:bg-surface-overlay hover:text-text-primary"
                :title="$t('shell.copyName')"
                @click="copyFromBar('name', current.name, $event)"
              >
                {{ current.name }}
              </button>
              <span v-if="current.name && current.uid" class="bar-name" aria-hidden="true">·</span>
              <button
                v-if="current.uid"
                type="button"
                class="tabular shrink-0 rounded-md px-1 py-0.5 font-mono transition-colors hover:bg-surface-overlay hover:text-text-primary"
                :title="$t('shell.copyUid')"
                :aria-label="$t('shell.copyUidValue', { uid: current.uid })"
                @click="copyFromBar('uid', String(current.uid), $event)"
              >
                {{ current.uid }}
              </button>
              <span v-if="!current.name && !current.uid" class="truncate">{{
                accounts.displayName(current)
              }}</span>
              <span class="bar-sync contents"><LastSync :account="current" /></span>
            </span>
          </template>
          <div class="ml-auto flex shrink-0 items-center gap-2">
            <template v-if="!staffMode">
              <button
                type="button"
                class="hidden min-h-9 w-56 items-center gap-2 rounded-lg border border-border-default bg-surface-sunken px-3 text-sm text-text-muted transition-colors hover:border-border-strong hover:text-text-secondary xl:flex"
                :title="$t('shell.search.hint')"
                @click="searching = true"
              >
                <Search class="size-4 shrink-0" aria-hidden="true" />
                {{ $t('shell.search.button') }}
                <kbd
                  class="ml-auto rounded border border-border-strong px-1.5 font-sans text-xs"
                  aria-hidden="true"
                  >{{ isMac ? '⌘K' : 'Ctrl K' }}</kbd
                >
              </button>
              <UiIconButton
                :label="$t('shell.search.button')"
                :title="$t('shell.search.hint')"
                class="xl:hidden"
                @click="searching = true"
              >
                <Search class="size-5" aria-hidden="true" />
              </UiIconButton>
            </template>
            <UiIconButton
              v-if="canTravel"
              class="max-sm:hidden"
              :label="$t('shell.timeTravel.open')"
              :title="$t('shell.timeTravel.openTitle')"
              @click="openTravelPicker($event)"
            >
              <History class="size-5" aria-hidden="true" />
            </UiIconButton>
            <DiscordButton />
            <KofiButton />
            <CaptureButton v-if="!framed" :account="staffMode ? undefined : current" />
            <AppearanceButton />
            <RouterLink
              v-if="currentId && !staffMode && !demoMode && current?.access !== 'viewer'"
              :to="
                guestMode
                  ? { name: 'guest-import' }
                  : { name: 'account-import', params: { accountId: currentId } }
              "
              class="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-medium text-accent-ink shadow-sm shadow-accent/30 hover:bg-accent-hover"
            >
              <Upload class="size-4" aria-hidden="true" />
              <span class="hidden sm:inline">{{ $t('shell.import') }}</span>
            </RouterLink>
          </div>
        </header>
        <TimeTravelBar
          v-if="travelHere && travelSnapshots.data.value"
          :travel="travelHere"
          :snapshots="travelSnapshots.data.value"
        />
      </div>

      <!-- overflow-x-clip: page art reaching past the content (PageBackdrop) never scrolls sideways -->
      <main
        class="min-w-0 flex-1 overflow-x-clip pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0"
      >
        <div
          class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-8 lg:py-8"
          :class="longPage && 'pb-[30vh] lg:pb-[30vh]'"
        >
          <slot />
        </div>
      </main>
    </div>

    <nav
      v-if="primary.length"
      class="fixed inset-x-0 bottom-0 z-30 flex border-t border-border-default bg-surface-nav pb-[env(safe-area-inset-bottom)] lg:hidden"
      :aria-label="staffMode ? $t('shell.section.staff') : $t('shell.section.account')"
    >
      <RouterLink
        v-for="section in primary"
        :key="section.name"
        :to="section.to"
        class="flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-0.5 text-[0.6875rem] font-medium"
        :class="isActive(section.name) ? 'text-accent-text' : 'text-text-muted'"
        :aria-current="isActive(section.name) ? 'page' : undefined"
      >
        <component :is="section.icon" class="size-5 shrink-0" aria-hidden="true" />
        <span class="max-w-full truncate">{{ section.label }}</span>
      </RouterLink>
      <button
        type="button"
        class="flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-0.5 text-[0.6875rem] font-medium text-text-muted"
        @click="drawer = true"
      >
        <MoreHorizontal class="size-5 shrink-0" aria-hidden="true" />
        <span class="max-w-full truncate">{{ $t('common.more') }}</span>
      </button>
    </nav>
    <SiteSearch v-model:open="searching" :account-id="currentId" :demo="demo" :guest="guest" />
    <TimeTravelPicker
      v-if="canTravel && travelSnapshots.data.value"
      :open="travelPicking"
      :anchor="travelAnchor"
      :snapshots="travelSnapshots.data.value"
      :at="travelHere?.at ?? null"
      @close="travelPicking = false"
    />
  </div>
</template>

<style scoped>
/* The rail's own transitions (main.css's reduced-motion rule still wins: it
   is !important). */
.nav-rail {
  transition-property: width, translate, background-color, border-color;
  transition-duration: 200ms;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
}
.nav-rail :deep(.nav-fade) {
  transition-property: opacity, visibility, max-width, gap, color, background-color, border-color;
  transition-duration: 150ms;
  transition-timing-function: ease;
}
/* The page title on phones: gone when the bar leaves it under 7rem (it would
   read "C..."); the page's own sr-only heading still names the page. */
@media (max-width: 39.9375rem) {
  .bar-title {
    container-type: inline-size;
  }
  @container (max-width: 7rem) {
    .bar-title > span {
      display: none;
    }
  }
}
/* The account line beside the title gives way as the bar narrows: under
   21rem the sync label goes (it took ~8rem, leaving a 1366px laptop's name
   cut), under 10rem the name and its dot (less than ~6 characters would
   show). The UID always stays; the sidebar and the account picker still name
   the account. */
.bar-account {
  container-type: inline-size;
}
@container (max-width: 21rem) {
  .bar-account > .bar-sync {
    display: none;
  }
}
@container (max-width: 10rem) {
  .bar-account > .bar-name {
    display: none;
  }
}
</style>
