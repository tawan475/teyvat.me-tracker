<script setup lang="ts">
import { computed } from 'vue'
import { Globe, Heart } from 'lucide-vue-next'
import { LANGUAGE_NAMES } from '@/i18n/language-names'
import { locale } from '@/i18n/locale'
import { DISCORD_URL, KOFI_URL } from '@/lib/links'
import { useSession } from '@/stores/session'
import DiscordMark from './DiscordMark.vue'
import { DOWNLOAD_URL } from './links'

/**
 * The landing page's top bar; the language button opens the appearance dialog
 * (LandingView). Another public page passes its own `links` (English, like
 * the developers pages' text, unless `translated`). Discord
 * and Ko-fi sit left of the language button (the user's pick, 2026-11-19, row E
 * of https://claude.ai/artifact/FGBTwZdsTvrucA1F9gsJGD); landing.css says how
 * the bar gives way as it narrows.
 */
defineProps<{ links?: { href: string; label: string }[]; translated?: boolean }>()
defineEmits<{ language: [] }>()
const session = useSession()
const languageName = computed(() => LANGUAGE_NAMES[locale.value])
</script>

<template>
  <header class="sky top">
    <nav class="wrap nav" :aria-label="$t('landing.nav.label')">
      <RouterLink :to="{ name: 'landing' }" class="brand">
        <span class="spark" aria-hidden="true">✦</span>Teyvat.me
      </RouterLink>
      <div v-if="links" class="navlinks" :lang="translated ? undefined : 'en'">
        <a v-for="link in links" :key="link.href" :href="link.href">{{ link.label }}</a>
      </div>
      <div v-else class="navlinks">
        <a href="#tracker">{{ $t('landing.nav.tracker') }}</a>
        <a href="#capture">{{ $t('landing.nav.app') }}</a>
        <a href="#video">{{ $t('landing.nav.video') }}</a>
        <a href="#faq">{{ $t('landing.nav.faq') }}</a>
      </div>
      <div class="nav-r">
        <div class="nav-socs">
          <a
            class="btn btn-sm btn-g nav-soc"
            :href="DISCORD_URL"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Discord"
            title="Discord"
          >
            <DiscordMark /><span class="lbl">Discord</span>
          </a>
          <a
            class="btn btn-sm btn-g nav-soc"
            :href="KOFI_URL"
            target="_blank"
            rel="noopener noreferrer"
            :aria-label="$t('landing.footer.support')"
            :title="$t('landing.footer.support')"
          >
            <Heart class="ic" aria-hidden="true" /><span class="lbl">Ko-fi</span>
          </a>
        </div>
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
