<script setup lang="ts">
import { Coffee } from 'lucide-vue-next'
import { KOFI_URL } from '@/lib/links'

/**
 * The top bar's Ko-fi button, beside Discord (the user's placement,
 * 2026-11-06): support for the site's running costs. Grey like Discord's,
 * Ko-fi's coral on hover.
 */
</script>

<template>
  <a
    :href="KOFI_URL"
    target="_blank"
    rel="noopener noreferrer"
    class="kofi inline-flex size-10 shrink-0 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-overlay"
    :aria-label="$t('shell.support')"
    :title="$t('shell.support')"
  >
    <Coffee class="size-5" aria-hidden="true" />
  </a>
</template>

<style scoped>
.kofi:hover,
.kofi:focus-visible {
  color: #ff5e5b;
}
</style>
