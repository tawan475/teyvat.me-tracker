<script setup lang="ts">
import { computed } from 'vue'
import { Globe } from 'lucide-vue-next'
import { LANGUAGE_NAMES } from '@/i18n/language-names'
import { locale } from '@/i18n/locale'
import { useSession } from '@/stores/session'
import { DOWNLOAD_URL } from './links'

/**
 * The landing page's top bar; the language button opens the appearance dialog
 * (LandingView). Another public page passes its own in-page `links`.
 */
defineProps<{ links?: { href: string; label: string }[] }>()
defineEmits<{ language: [] }>()
const session = useSession()
const languageName = computed(() => LANGUAGE_NAMES[locale.value])
const short = computed(() => locale.value.split('-')[0]!.toUpperCase())
</script>

<template>
  <header class="sky top">
    <nav class="wrap nav" :aria-label="$t('landing.nav.label')">
      <RouterLink :to="{ name: 'landing' }" class="brand">
        <span class="spark" aria-hidden="true">✦</span>Teyvat.me
      </RouterLink>
      <div v-if="links" class="navlinks" lang="en">
        <a v-for="link in links" :key="link.href" :href="link.href">{{ link.label }}</a>
      </div>
      <div v-else class="navlinks">
        <a href="#tracker">{{ $t('landing.nav.tracker') }}</a>
        <a href="#capture">{{ $t('landing.nav.app') }}</a>
        <a href="#video">{{ $t('landing.nav.video') }}</a>
        <a href="#faq">{{ $t('landing.nav.faq') }}</a>
      </div>
      <div class="nav-r">
        <button
          class="lang"
          type="button"
          aria-haspopup="dialog"
          :aria-label="`${$t('settings.appearance.language')}: ${languageName}`"
          :title="$t('settings.appearance.language')"
          @click="$emit('language')"
        >
          <Globe class="ic" aria-hidden="true" />
          <span class="long">{{ languageName }}</span>
          <span class="short">{{ short }}</span>
        </button>
        <RouterLink
          v-if="session.status === 'signed-in'"
          :to="{ name: 'home' }"
          class="btn btn-sm btn-t"
        >
          {{ $t('shell.public.dashboard') }}
        </RouterLink>
        <RouterLink v-else :to="{ name: 'login' }" class="btn btn-sm btn-t">
          {{ $t('common.signIn') }}
        </RouterLink>
        <a class="btn btn-sm btn-p hide-s" :href="DOWNLOAD_URL">{{ $t('landing.nav.download') }}</a>
      </div>
    </nav>
  </header>
</template>
