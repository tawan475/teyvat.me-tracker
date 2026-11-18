<script setup lang="ts">
import { Info } from 'lucide-vue-next'

/**
 * A tooltip that phones can read (no hover there): `icon` is the ⓘ with the
 * text as its tooltip, from lg up; `line` is the same text as a visible line,
 * below lg. A place that shows one shows both.
 */
defineProps<{ text: string; mode: 'icon' | 'line'; glyph?: boolean }>()
</script>

<template>
  <span
    v-if="mode === 'icon'"
    class="hidden shrink-0 cursor-help text-text-muted lg:inline-flex"
    :title="text"
    role="img"
    :aria-label="text"
  >
    <Info class="size-[1.125rem]" aria-hidden="true" />
  </span>
  <p v-else class="flex min-w-0 items-start gap-1.5 text-sm text-text-secondary lg:hidden">
    <Info v-if="glyph" class="mt-0.5 size-4 shrink-0 text-text-muted" aria-hidden="true" />
    <span class="min-w-0 break-words">{{ text }}</span>
  </p>
</template>
