<script setup lang="ts">
import type { BannerStats } from '@/data/wish-history'
import { t } from '@/i18n'
import { formatNumber } from '@/lib/format'
import WishFiveTile from './WishFiveTile.vue'
import { OUTCOME_STYLE } from './wish-labels'

/**
 * Every 5★ of a banner as tiles, newest first, in a box that scrolls (its
 * height from `boxClass`), with the 50/50 ring legend where the banner has
 * one. `dated` adds each one's day (the banner page).
 */
defineProps<{ stats: BannerStats; boxClass?: string; dated?: boolean }>()

const LEGEND = [{ key: 'won' }, { key: 'lost' }, { key: 'guaranteed' }] as const
const legendLabel = (key: (typeof LEGEND)[number]['key']) => t(`wishes.legend.${key}`)
</script>

<template>
  <div class="flex min-w-0 flex-col gap-2.5">
    <div class="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
      <span class="font-semibold text-rarity-5">{{ $t('wishes.five.every') }}</span>
      <span class="tabular font-mono text-text-muted">{{
        $t('wishes.five.newestFirst', { n: formatNumber(stats.fives.length) })
      }}</span>
      <span v-if="stats.rate5" class="ml-auto inline-flex gap-3 text-text-muted">
        <span v-for="l in LEGEND" :key="l.key" class="inline-flex items-center gap-1.5"
          ><span class="text-xs font-bold" :class="OUTCOME_STYLE[l.key].text" aria-hidden="true">{{
            OUTCOME_STYLE[l.key].mark
          }}</span
          >{{ legendLabel(l.key) }}</span
        >
      </span>
    </div>
    <p v-if="!stats.fives.length" class="py-6 text-center text-xs text-text-muted">
      {{ $t('wishes.five.none') }}
    </p>
    <div
      v-else
      class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,10.5rem),1fr))] gap-2 overflow-y-auto pr-1"
      :class="boxClass"
    >
      <WishFiveTile
        v-for="row in stats.fives"
        :key="row.pull.id.toString()"
        :row="row"
        :banner="stats.banner"
        :dated="dated"
      />
    </div>
  </div>
</template>
