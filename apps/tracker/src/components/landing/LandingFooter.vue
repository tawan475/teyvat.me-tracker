<script setup lang="ts">
import { ChevronDown, Globe } from 'lucide-vue-next'
import { t } from '@/i18n'
import { applyLocale } from '@/i18n/apply'
import { LANGUAGE_NAMES } from '@/i18n/language-names'
import { isLocale, locale, LOCALES } from '@/i18n/locale'
import { useFeedback } from '@/stores/feedback'
import { useSession } from '@/stores/session'
import { KOFI_URL } from '@/lib/links'
import { DOWNLOAD_URL, GITHUB_URL } from './links'

/**
 * The footer: the fan-project notice, links, and a language picker (as the
 * appearance dialog does: shown at once and kept on this device; signed in,
 * also saved to the account).
 */
const session = useSession()
const feedback = useFeedback()

async function pickLanguage(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  if (!isLocale(value)) return
  void applyLocale(value, { persist: true, animate: true })
  if (session.status !== 'signed-in') return
  try {
    await session.updateSettings({ language: value })
  } catch (error) {
    feedback.error(t('settings.appearance.languageNotSaved'), error)
  }
}
</script>

<template>
  <footer class="foot">
    <div class="wrap foot-g">
      <div class="foot-col">
        <RouterLink :to="{ name: 'landing' }" class="brand">
          <span class="spark" aria-hidden="true">✦</span>Teyvat.me
        </RouterLink>
        <p class="disc-t">{{ $t('landing.footer.disclaimer') }}</p>
      </div>
      <div class="foot-col foot-r">
        <nav class="flinks" :aria-label="$t('landing.footer.label')">
          <RouterLink :to="{ name: 'home' }">{{ $t('landing.footer.tracker') }}</RouterLink>
          <a :href="DOWNLOAD_URL">{{ $t('landing.footer.download') }}</a>
          <RouterLink :to="{ name: 'developers' }">{{
            $t('landing.footer.developers')
          }}</RouterLink>
          <a :href="GITHUB_URL">GitHub</a>
          <a :href="KOFI_URL" target="_blank" rel="noopener noreferrer">{{
            $t('landing.footer.support')
          }}</a>
        </nav>
        <div class="sel">
          <label for="ft-lang">{{ $t('settings.appearance.language') }}</label>
          <Globe class="ic lft" aria-hidden="true" />
          <select id="ft-lang" :value="locale" @change="pickLanguage">
            <option v-for="code in LOCALES" :key="code" :value="code" :lang="code">
              {{ LANGUAGE_NAMES[code] }}
            </option>
          </select>
          <ChevronDown class="ic s rgt" aria-hidden="true" />
        </div>
      </div>
    </div>
  </footer>
</template>
