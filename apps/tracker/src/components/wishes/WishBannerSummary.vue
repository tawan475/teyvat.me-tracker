<script setup lang="ts">
import { computed } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import type { BannerStats } from '@/data/wish-history'
import { formatNumber } from '@/lib/format'
import WishFiveGrid from './WishFiveGrid.vue'
import WishNumbers from './WishNumbers.vue'
import { bannerInfo } from './wish-labels'

/**
 * A banner with a 50/50 (Character, Weapon) on the overview: its numbers
 * (5★ and 4★ with rate and average pity, the 50/50s won and lost, 4★ by
 * type) beside every 5★ as tiles, newest first, in a box that scrolls.
 */
const props = defineProps<{ stats: BannerStats; to: RouteLocationRaw }>()
const info = computed(() => bannerInfo(props.stats.banner))
</script>

<template>
  <section
    :aria-label="info.title"
    class="min-w-0 rounded-xl border border-border-default bg-surface-raised shadow-sm"
  >
    <div class="flex min-w-0 items-center gap-2.5 border-b border-border-default px-4 py-3 sm:px-5">
      <h2 class="min-w-0 truncate text-base font-semibold">{{ info.title }}</h2>
      <span class="tabular shrink-0 font-mono text-xs text-text-muted">{{
        $t('wishes.pulls', { n: formatNumber(stats.total) })
      }}</span>
      <RouterLink :to="to" class="ml-auto shrink-0 text-xs text-accent-text hover:underline">{{
        $t('wishes.allWishes')
      }}</RouterLink>
    </div>
    <!-- A 1px gap on the border colour draws the line between the halves, side by side or stacked. -->
    <div class="flex flex-wrap gap-px overflow-hidden rounded-b-xl bg-border-default">
      <div class="min-w-0 flex-[1_1_380px] bg-surface-raised px-4 py-4 sm:px-5">
        <WishNumbers :stats="stats" compact />
      </div>
      <div class="min-w-0 flex-[999_1_520px] bg-surface-raised px-4 pt-3.5 pb-4 sm:px-5">
        <WishFiveGrid :stats="stats" box-class="max-h-[22rem]" />
      </div>
    </div>
  </section>
</template>
