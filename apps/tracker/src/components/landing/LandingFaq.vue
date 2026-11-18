<script setup lang="ts">
import { ArrowRight, ChevronDown } from 'lucide-vue-next'

/** Each question's i18n keys: `landing.faq.<key>Q` / `<key>A`. The first starts open. */
const QUESTIONS = ['what', 'free', 'modify', 'reads', 'admin', 'need', 'servers'] as const
</script>

<template>
  <section id="faq" class="sec band" aria-labelledby="faq-t">
    <div class="wrap">
      <div class="sec-h c">
        <div class="ov">{{ $t('landing.faq.overline') }}</div>
        <h2 id="faq-t" class="h2">{{ $t('landing.faq.title') }}</h2>
      </div>
      <div class="faq">
        <details v-for="(key, i) in QUESTIONS" :key="key" class="q" :open="i === 0">
          <summary>
            {{ $t(`landing.faq.${key}Q`) }}<ChevronDown class="ic" aria-hidden="true" />
          </summary>
          <p>{{ $t(`landing.faq.${key}A`) }}</p>
          <RouterLink v-if="key === 'reads'" :to="{ name: 'privacy' }" class="more-l q-more"
            >{{ $t('landing.faq.readsMore') }}<ArrowRight class="ic" aria-hidden="true"
          /></RouterLink>
        </details>
      </div>
    </div>
  </section>
</template>
