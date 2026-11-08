<script setup lang="ts">
import { Radar } from 'lucide-vue-next'
import UiButton from '@/components/ui/UiButton.vue'

/**
 * "3 synced just now · Hide" over a list whose rows a capture finished
 * while the page was open: Hide puts the list back to normal without
 * touching the filters (lib/just-synced.ts).
 */
defineProps<{ count: number }>()
defineEmits<{ hide: [] }>()
</script>

<template>
  <div
    v-if="count > 0"
    class="flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-sm text-text-primary"
    role="status"
  >
    <Radar class="size-4 shrink-0 text-accent-text" aria-hidden="true" />
    <span class="min-w-0 flex-1">{{ $t('live.justSynced.count', { n: count }, count) }}</span>
    <UiButton size="sm" variant="ghost" @click="$emit('hide')">{{
      $t('live.justSynced.hide')
    }}</UiButton>
  </div>
</template>
