<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ArrowLeft } from 'lucide-vue-next'
import FunCard from '@/components/fun/FunCard.vue'
import { provideFunHost, publicFunHost } from '@/components/fun/host'
import { FUN_PAGES, funPage, isNewPage, type FunPage } from '@/components/fun/pages'
import LandingFooter from '@/components/landing/LandingFooter.vue'
import LandingNav from '@/components/landing/LandingNav.vue'
import { DOWNLOAD_URL } from '@/components/landing/links'
import AppearanceControls from '@/components/settings/AppearanceControls.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiModal from '@/components/ui/UiModal.vue'
import { t } from '@/i18n'
import '@/components/landing/landing.css'
import '@/components/landing/privacy.css'

/**
 * The public Fun pages (docs/plans/fun.md, 2026-11-28): `/fun` is the hub,
 * the same card grid as an account's Fun section, and `/fun/<slug>` one of
 * the same page components, open signed out. No account: the pages get
 * their storage and links from the public host (components/fun/host.ts), and
 * the team randomizer rolls from every released character.
 *
 * The frame (public bar, hero, footer, following the site's theme) is
 * /privacy's, as a placeholder until the owner picks the public look.
 */
const route = useRoute()
const languageOpen = ref(false)
const now = Date.now()

const host = publicFunHost()
provideFunHost(computed(() => host))

/** `/fun/<slug>`'s page; null on the hub (the routes list only real slugs). */
const page = computed(() => funPage(route.path.replace(/^\/fun\/?/, '').replace(/\/+$/, '')))
const title = computed(() =>
  page.value ? t(`fun.pages.${page.value.label}.title`) : t('fun.title'),
)
/** A page's one line; the team randomizer's in-app one speaks of "your own characters". */
const pitch = (entry: FunPage) =>
  entry.label === 'teamRandomizer' ? t('fun.publicPitch') : t(`fun.pages.${entry.label}.pitch`)
const lead = computed(() => (page.value ? pitch(page.value) : t('shell.description.funHub')))

const navLinks = computed(() => [
  { href: '/app', label: t('landing.footer.tracker') },
  { href: DOWNLOAD_URL, label: t('landing.footer.download') },
  { href: '/developers', label: t('landing.footer.developers') },
])
</script>

<template>
  <div>
    <div class="lp pp">
      <img class="pp-art" src="/hero-bg.webp" alt="" data-skeleton="off" />
      <div class="pp-shade" aria-hidden="true" />
      <LandingNav :links="navLinks" translated @language="languageOpen = true" />
      <section class="wrap pp-hero" aria-labelledby="fun-title">
        <h1 id="fun-title" class="pp-h1">{{ title }}</h1>
        <p class="pp-lead">{{ lead }}</p>
      </section>

      <main class="wrap pp-main max-sm:pt-4!">
        <template v-if="page">
          <div class="mb-4 flex min-w-0 items-center gap-x-3">
            <UiIconButton :label="$t('fun.title')" :to="host.hub">
              <ArrowLeft class="size-5" aria-hidden="true" />
            </UiIconButton>
            <span class="min-w-0 flex-1 truncate text-lg font-semibold">{{ $t('fun.title') }}</span>
          </div>
          <component :is="page.component" :key="page.slug" />
        </template>

        <div
          v-else
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
      </main>
      <LandingFooter />
    </div>

    <UiModal
      :open="languageOpen"
      :title="$t('settings.appearance.language')"
      @close="languageOpen = false"
    >
      <AppearanceControls language-only />
    </UiModal>
  </div>
</template>
