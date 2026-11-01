<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMediaQuery, usePreferredReducedMotion } from '@vueuse/core'
import {
  ArrowLeft,
  LayoutGrid,
  LogOut,
  Menu,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldCheck,
  Sun,
  Upload,
  X,
} from 'lucide-vue-next'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import { readStorage, writeStorage } from '@/lib/storage'
import { resolvedTheme } from '@/lib/theme'
import { lastAccountId, useAccounts } from '@/stores/accounts'
import { useFeedback } from '@/stores/feedback'
import { copyText } from '@/data/import-setup'
import { useSession } from '@/stores/session'
import { useStaff } from '@/stores/staff'
import AccountSwitcher from './AccountSwitcher.vue'
import AppearanceButton from './AppearanceButton.vue'
import CaptureButton from './CaptureButton.vue'
import DiscordButton from './DiscordButton.vue'
import LastSync from './LastSync.vue'
import { t } from '@/i18n'
import { ACCOUNT_SECTIONS, NAV_PARENT, STAFF_SECTIONS, pageTitle } from './nav'
import { USER_SETTINGS_DEFAULTS } from '@gdt/shared/settings'
import { NAV_COLLAPSED_KEY, useNavCollapse } from './nav-collapse'
import SectionLabel from './SectionLabel.vue'

/**
 * The signed-in frame, in the original dashboard layout: a sidebar with
 * section labels, a top bar with the page title and account, and (on
 * mobile) a drawer plus a bottom tab bar. On desktop the sidebar collapses
 * to an icon rail (remembered per device, see nav-collapse.ts).
 */
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
  // Inspect's account is someone else's: the switcher keeps the user's own.
  const param = staffMode.value ? NaN : Number(route.params.accountId)
  if (Number.isSafeInteger(param) && param > 0) return param
  const last = lastAccountId()
  return last && accounts.byId.has(last) ? last : (accounts.list[0]?.id ?? null)
})
const current = computed(() => (currentId.value ? accounts.byId.get(currentId.value) : undefined))

/** The top bar's account name and UID copy on click. */
async function copyFromBar(what: 'name' | 'uid', value: string, event: MouseEvent) {
  const ok = await copyText(value, event.currentTarget as HTMLElement | null)
  const title = what === 'name' ? t('shell.nameCopied') : t('shell.uidCopied')
  if (ok) feedback.toast({ tone: 'success', title, detail: value })
  else feedback.toast({ tone: 'danger', title: t('common.copyFailed'), detail: value })
}

const sections = computed(() =>
  currentId.value
    ? ACCOUNT_SECTIONS.map((s) => ({
        ...s,
        label: t(`shell.nav.${s.label}`),
        to: { name: s.name, params: { accountId: currentId.value } },
      }))
    : [],
)
/** The phone tab bar: the pages the user picked (Settings → Appearance), in the sidebar's order. */
const primary = computed(() => {
  if (staffMode.value) return staffSections.value.filter((s) => s.primary)
  const picked = new Set(session.settings.tabBar ?? USER_SETTINGS_DEFAULTS.tabBar)
  return sections.value.filter((s) =>
    picked.has(ACCOUNT_SECTIONS.find((a) => a.name === s.name)!.label),
  )
})
const title = computed(() => pageTitle(route.meta))

// Flips what is painted; from "system" it pins the opposite theme.
const theme = resolvedTheme
async function toggleTheme() {
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
          <AccountSwitcher :current-id="currentId" :collapsed="narrow" />
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
            <RouterLink
              :to="{ name: 'home' }"
              class="flex items-center gap-3 rounded-md px-3 py-2.5 text-base font-medium"
              :class="navClass(isActive('home'))"
              :aria-current="isActive('home') ? 'page' : undefined"
              :title="narrow ? $t('shell.accounts') : undefined"
            >
              <LayoutGrid class="size-5 shrink-0" aria-hidden="true" />
              <span :class="labelClass">{{ $t('shell.accounts') }}</span>
            </RouterLink>
            <RouterLink
              v-if="session.can('staff.view')"
              :to="{ name: 'staff-overview' }"
              class="flex items-center gap-3 rounded-md px-3 py-2.5 text-base font-medium"
              :class="navClass(staffMode)"
              :aria-current="route.name === 'staff-overview' ? 'page' : undefined"
              :title="narrow ? $t('shell.staff') : undefined"
            >
              <ShieldCheck class="size-5 shrink-0" aria-hidden="true" />
              <span :class="labelClass">{{ $t('shell.staff') }}</span>
            </RouterLink>
            <div class="flex" :class="compact ? 'flex-col gap-0.5' : 'items-center gap-1'">
              <RouterLink
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
          class="mb-3 flex items-center gap-3 px-1.5"
          :title="narrow ? session.me?.username : undefined"
        >
          <span
            class="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-overlay text-sm font-bold text-text-secondary"
          >
            {{ session.me?.username.charAt(0).toUpperCase() }}
          </span>
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
          <button
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
      <header
        class="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border-default bg-surface-nav px-4 shadow-sm sm:px-8"
      >
        <UiIconButton :label="$t('shell.openMenu')" class="-ml-2 lg:hidden" @click="drawer = true">
          <Menu class="size-5" aria-hidden="true" />
        </UiIconButton>
        <span class="truncate text-lg font-semibold sm:shrink-0">{{ title }}</span>
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
          <span
            class="hidden min-w-0 items-center gap-1.5 text-sm font-medium text-text-muted sm:flex"
          >
            <span class="size-2 shrink-0 rounded-full bg-emerald-500" />
            <button
              v-if="current.name"
              type="button"
              class="min-w-0 truncate rounded-md px-1 py-0.5 transition-colors hover:bg-surface-overlay hover:text-text-primary"
              :title="$t('shell.copyName')"
              @click="copyFromBar('name', current.name, $event)"
            >
              {{ current.name }}
            </button>
            <span v-if="current.name && current.uid" aria-hidden="true">·</span>
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
            <LastSync :account="current" />
          </span>
        </template>
        <div class="ml-auto flex shrink-0 items-center gap-2">
          <DiscordButton />
          <CaptureButton :account="staffMode ? undefined : current" />
          <AppearanceButton />
          <RouterLink
            v-if="currentId && !staffMode && current?.access !== 'viewer'"
            :to="{ name: 'account-import', params: { accountId: currentId } }"
            class="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-medium text-accent-ink shadow-sm shadow-accent/30 hover:bg-accent-hover"
          >
            <Upload class="size-4" aria-hidden="true" />
            <span class="hidden sm:inline">{{ $t('shell.import') }}</span>
          </RouterLink>
        </div>
      </header>

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
</style>
