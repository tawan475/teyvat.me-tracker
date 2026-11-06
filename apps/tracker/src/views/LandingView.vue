<script setup lang="ts">
import { ref } from 'vue'
import LandingCapture from '@/components/landing/LandingCapture.vue'
import LandingFaq from '@/components/landing/LandingFaq.vue'
import LandingFooter from '@/components/landing/LandingFooter.vue'
import LandingHero from '@/components/landing/LandingHero.vue'
import LandingNav from '@/components/landing/LandingNav.vue'
import LandingPrivacy from '@/components/landing/LandingPrivacy.vue'
import LandingSteps from '@/components/landing/LandingSteps.vue'
import LandingTracker from '@/components/landing/LandingTracker.vue'
import AppearanceControls from '@/components/settings/AppearanceControls.vue'
import UiModal from '@/components/ui/UiModal.vue'
import '@/components/landing/landing.css'

/**
 * The landing page: the tracker first (the site is the tracker), then how the
 * Teyvat.me Capture app keeps it up to date (docs/plans/open-site.md §1; until
 * 2026-11-06 the app came first and search engines took the site for the app).
 * Always dark (a public route). Signed in, its links lead to the dashboard
 * instead of sign-in and sign-up. Prerendered at build (vite.config.ts), so its
 * text is in the HTML before any script runs.
 */
const languageOpen = ref(false)
</script>

<template>
  <div>
    <div class="lp" data-theme="dark">
      <LandingNav @language="languageOpen = true" />
      <main>
        <LandingHero />
        <LandingTracker />
        <LandingSteps />
        <LandingCapture />
        <LandingPrivacy />
        <LandingFaq />
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
