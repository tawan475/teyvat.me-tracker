<script setup lang="ts">
import UiProgress from '@/components/ui/UiProgress.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'

/**
 * What a share card's dialog shows until its card is drawn (the roster
 * card's loader, used by every card; the user, 2026-11-07): the card's
 * shape as a skeleton, a bar counting its pictures and then "Drawing".
 * `progress` is null before the drawing starts (the skeleton alone); the
 * default slot replaces the bar (the roster's "Make card" on phones).
 */
defineProps<{
  /** The card's width / height, e.g. "1920 / 1080". */
  aspect: string
  progress: { loaded: number; total: number } | null
  /** The bar's accessible name: the card's title. */
  label: string
  /** The skeleton holds still (nothing is loading yet). */
  still?: boolean
}>()
</script>

<template>
  <div class="relative">
    <UiSkeleton
      class="w-full rounded-xl"
      :class="still && 'animate-none'"
      :style="{ aspectRatio: aspect }"
    />
    <div class="absolute inset-0 flex items-center justify-center p-6">
      <slot>
        <div v-if="progress" class="flex w-full max-w-xs flex-col items-center gap-2">
          <UiProgress :value="progress.loaded" :max="progress.total" :label="label" />
          <span class="tabular font-mono text-xs text-text-muted">{{
            progress.loaded < progress.total
              ? $t('characters.roster.pictures', { n: progress.loaded, total: progress.total })
              : $t('characters.roster.drawing')
          }}</span>
        </div>
      </slot>
    </div>
  </div>
</template>
