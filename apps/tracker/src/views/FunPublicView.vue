<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useTemplateRef } from 'vue'
import { useRoute } from 'vue-router'
import { useResizeObserver } from '@vueuse/core'
import { ArrowLeft, Globe, Moon, Sun } from 'lucide-vue-next'
import FunCard from '@/components/fun/FunCard.vue'
import { provideFunHost, publicFunHost } from '@/components/fun/host'
import { FUN_TOOLS_ID } from '@/components/fun/page-tools'
import { FUN_PAGES, funPage, isNewPage, type FunPage } from '@/components/fun/pages'
import AppearanceControls from '@/components/settings/AppearanceControls.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiModal from '@/components/ui/UiModal.vue'
import { t } from '@/i18n'
import { LANGUAGE_NAMES } from '@/i18n/language-names'
import { locale } from '@/i18n/locale'
import { DISCORD_URL } from '@/lib/links'
import { applyTheme, resolvedTheme } from '@/lib/theme'
import { useFeedback } from '@/stores/feedback'
import { useSession } from '@/stores/session'

/**
 * The public Fun pages (docs/plans/fun.md, 2026-11-28): `/fun` is the hub,
 * the same card grid as an account's Fun section, and `/fun/<slug>` one of
 * the same page components, open signed out. No account: the pages get
 * their storage and links from the public host (components/fun/host.ts), and
 * the team randomizer rolls from every released character.
 *
 * The frame is the owner's pick "A" (2026-11-28): the app's own look, never
 * the landing's. One slim solid bar like the app shell's (brand, "/ Fun",
 * language, theme, Sign in, Open the tracker), the visitor's light or dark
 * theme (the routes are `themed`), the app's content column, a plain footer
 * line.
 */
const route = useRoute()
const session = useSession()
const feedback = useFeedback()
const languageOpen = ref(false)
const now = Date.now()

const host = publicFunHost()
provideFunHost(computed(() => host))

/** `/fun/<slug>`'s page; null on the hub (the routes list only real slugs). */
const page = computed(() => funPage(route.path.replace(/^\/fun\/?/, '').replace(/\/+$/, '')))
/** A page's one line; the team randomizer's in-app one speaks of "your own characters". */
const pitch = (entry: FunPage) =>
  entry.label === 'teamRandomizer' ? t('fun.publicPitch') : t(`fun.pages.${entry.label}.pitch`)

const signedIn = computed(() => session.status === 'signed-in')
const signIn = computed(() => ({ path: '/login', query: { next: route.fullPath } }))
const languageName = computed(() => LANGUAGE_NAMES[locale.value])

// The app shell's toggle: flips what is painted; signed in, saved to the account.
const theme = resolvedTheme
async function toggleTheme() {
  const next = theme.value === 'dark' ? 'light' : 'dark'
  if (!signedIn.value) return applyTheme(next)
  try {
    await session.updateSettings({ theme: next })
  } catch (error) {
    feedback.error(t('shell.themeNotSaved'), error)
  }
}

/** The bar's height as `--app-bar-bottom`, as the app shell does, for the tools' sticky parts. */
const bar = useTemplateRef<HTMLElement>('bar')
useResizeObserver(bar, (entries) => {
  const height = entries[0]?.borderBoxSize?.[0]?.blockSize ?? bar.value?.offsetHeight
  if (height) document.documentElement.style.setProperty('--app-bar-bottom', `${height}px`)
})
onBeforeUnmount(() => document.documentElement.style.removeProperty('--app-bar-bottom'))
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-surface-base text-text-primary">
    <!-- Solid, no backdrop blur, like the app's bar. -->
    <header
      ref="bar"
      class="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b border-border-default bg-surface-nav px-4 shadow-sm sm:px-8"
    >
      <nav class="flex min-w-0 flex-1 items-center gap-2" :aria-label="$t('fun.public.nav')">
        <RouterLink
          to="/"
          class="flex shrink-0 items-center gap-2 rounded-md text-lg font-bold whitespace-nowrap"
        >
          <span class="brand-spark text-paimon" aria-hidden="true">✦</span>Teyvat.me
        </RouterLink>
        <span class="text-text-muted max-sm:hidden" aria-hidden="true">/</span>
        <RouterLink
          to="/fun"
          class="truncate rounded-md font-semibold max-sm:hidden"
          :aria-current="page ? undefined : 'page'"
        >
          {{ $t('fun.title') }}
        </RouterLink>
      </nav>
      <button
        type="button"
        class="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-md px-2.5 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-overlay hover:text-text-primary"
        aria-haspopup="dialog"
        :aria-label="`${$t('settings.appearance.language')}: ${languageName}`"
        :title="$t('settings.appearance.language')"
        @click="languageOpen = true"
      >
        <Globe class="size-5 shrink-0" aria-hidden="true" />
        <span class="max-md:hidden">{{ languageName }}</span>
      </button>
      <UiIconButton
        :label="theme === 'dark' ? $t('shell.lightTheme') : $t('shell.darkTheme')"
        @click="toggleTheme"
      >
        <Moon v-if="theme === 'dark'" class="size-5" aria-hidden="true" />
        <Sun v-else class="size-5" aria-hidden="true" />
      </UiIconButton>
      <UiButton v-if="!signedIn" :to="signIn" class="max-sm:hidden">
        {{ $t('common.signIn') }}
      </UiButton>
      <UiButton to="/app" variant="primary" class="min-w-0 max-sm:px-3">
        <span class="truncate">{{ $t('fun.public.openTracker') }}</span>
      </UiButton>
    </header>

    <main class="mx-auto flex w-full max-w-7xl min-w-0 flex-1 flex-col px-4 py-6 sm:px-8 lg:py-8">
      <template v-if="page">
        <div class="mb-4 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-3">
          <UiIconButton :label="$t('fun.title')" :to="host.hub">
            <ArrowLeft class="size-5" aria-hidden="true" />
          </UiIconButton>
          <h1 class="min-w-[8rem] flex-1 truncate text-lg font-semibold">
            {{ $t(`fun.pages.${page.label}.title`) }}
          </h1>
          <!-- A page's own controls (components/fun/page-tools.ts). -->
          <div
            :id="FUN_TOOLS_ID"
            class="flex min-w-0 flex-wrap items-center gap-2 empty:hidden max-sm:w-full"
          />
        </div>
        <component :is="page.component" :key="page.slug" />
      </template>

      <div v-else class="flex min-w-0 flex-col gap-5 sm:gap-6">
        <div class="flex min-w-0 flex-col gap-1.5">
          <h1 class="text-2xl font-bold sm:text-3xl">{{ $t('fun.title') }}</h1>
          <p class="text-text-secondary">{{ $t('fun.public.lead') }}</p>
        </div>
        <div
          class="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] sm:gap-3"
        >
          <FunCard
            v-for="entry in FUN_PAGES"
            :key="entry.slug"
            :to="host.page(entry.slug)"
            :title="$t(`fun.pages.${entry.label}.title`)"
            :pitch="pitch(entry)"
            :icon="entry.icon"
            :is-new="isNewPage(entry, now)"
          />
        </div>
        <section
          class="flex min-w-0 flex-wrap items-center gap-4 rounded-xl border border-border-default bg-surface-raised p-4 shadow-sm sm:p-5"
        >
          <div class="flex min-w-0 flex-[1_1_16rem] flex-col gap-1">
            <h2 class="font-semibold">{{ $t('fun.public.guestTitle') }}</h2>
            <p class="text-sm text-text-secondary">{{ $t('fun.public.guestBody') }}</p>
          </div>
          <UiButton to="/guest/fun/team-randomizer">{{ $t('fun.public.guestButton') }}</UiButton>
        </section>
      </div>

      <footer
        class="mt-auto flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2 pt-10 text-sm text-text-muted"
      >
        <RouterLink :to="{ name: 'privacy' }" class="hover:text-text-primary">{{
          $t('shell.page.privacy')
        }}</RouterLink>
        <RouterLink :to="{ name: 'developers' }" class="hover:text-text-primary">{{
          $t('landing.footer.developers')
        }}</RouterLink>
        <a
          :href="DISCORD_URL"
          target="_blank"
          rel="noopener noreferrer"
          class="hover:text-text-primary"
          >Discord</a
        >
        <span class="min-w-0 basis-full text-xs sm:ml-auto sm:basis-auto sm:text-right">{{
          $t('landing.footer.disclaimer')
        }}</span>
      </footer>
    </main>

    <UiModal
      :open="languageOpen"
      :title="$t('settings.appearance.language')"
      @close="languageOpen = false"
    >
      <AppearanceControls language-only />
    </UiModal>
  </div>
</template>

<style scoped>
.brand-spark {
  filter: drop-shadow(0 0 8px var(--color-paimon-glow));
}
</style>
