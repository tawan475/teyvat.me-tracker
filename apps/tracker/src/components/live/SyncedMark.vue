<script setup lang="ts">
import { Radar } from 'lucide-vue-next'
import { formatTime } from '@/lib/format'

/**
 * "Synced 04:47": a row a capture finished while the page was open (see
 * lib/just-synced.ts). An icon and text, so it never rests on colour alone.
 */
defineProps<{ at: number }>()
</script>

<template>
  <span
    class="inline-flex shrink-0 items-center gap-1 rounded-md bg-accent/15 px-1.5 py-0.5 text-xs font-medium text-accent-text"
    :title="$t('live.justSynced.title', { time: formatTime(at) })"
  >
    <Radar class="size-3.5" aria-hidden="true" />
    {{ $t('live.justSynced.mark', { time: formatTime(at) }) }}
  </span>
</template>
