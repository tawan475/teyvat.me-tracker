<script setup lang="ts">
import { computed, ref } from 'vue'
import RandomizerBoard from '@/components/fun/randomizer/RandomizerBoard.vue'
import LandingFooter from '@/components/landing/LandingFooter.vue'
import LandingNav from '@/components/landing/LandingNav.vue'
import { DOWNLOAD_URL } from '@/components/landing/links'
import AppearanceControls from '@/components/settings/AppearanceControls.vue'
import UiModal from '@/components/ui/UiModal.vue'
import { t } from '@/i18n'
import '@/components/landing/landing.css'
import '@/components/landing/privacy.css'

/**
 * /randomizer (docs/plans/fun.md): the team randomizer for anyone, signed out
 * too, over every released character. /privacy's frame (the public bar and
 * footer, following the site's theme) around the same board as in Fun.
 */
const languageOpen = ref(false)
const now = Date.now()
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
      <section class="wrap pp-hero" aria-labelledby="rnd-title">
        <h1 id="rnd-title" class="pp-h1">{{ $t('fun.pages.teamRandomizer.title') }}</h1>
        <p class="pp-lead">{{ $t('fun.publicPitch') }}</p>
      </section>
      <main class="wrap pp-main max-sm:pt-4!">
        <RandomizerBoard storage-key="fun:randomizer:public" :at="now" />
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
