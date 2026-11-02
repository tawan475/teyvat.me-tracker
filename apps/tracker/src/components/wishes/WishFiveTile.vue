<script setup lang="ts">
import { wishItemName } from './item-name'
import { computed } from 'vue'
import type { UigfGachaType } from '@gdt/shared'
import { HARD_PITY, pityBand, type PullRow } from '@/data/wish-history'
import { t } from '@/i18n'
import { formatNumber } from '@/lib/format'
import WishItemIcon from './WishItemIcon.vue'
import { BAND_COLOR, oddsOf, outcomeLabel, runName, wishDay, wishMinute } from './wish-labels'

/**
 * One 5★: its pull's number in the banner run (the pull table's #) and
 * (`dated`) its day on top, then its icon ringed by the 50/50, the name and
 * the pity in its band's colour, over a bar against hard pity.
 */
const props = defineProps<{
  row: PullRow
  number: number
  banner: UigfGachaType
  dated?: boolean
}>()

const color = computed(() => BAND_COLOR[pityBand(props.row.pity, props.banner)])
const width = computed(
  () => `${Math.min(100, (props.row.pity / HARD_PITY[props.banner][0]) * 100)}%`,
)
const title = computed(() =>
  [
    t('wishes.five.pity', { name: wishItemName(props.row.pull.item), pity: props.row.pity }),
    props.row.outcome
      ? t('wishes.five.outcome', {
          outcome: outcomeLabel(props.row.outcome),
          odds: oddsOf(props.banner),
        })
      : '',
    wishMinute(props.row.pull.time),
    runName(props.row),
  ]
    .filter(Boolean)
    .join('\n'),
)
</script>

<template>
  <div class="flex min-w-0 flex-col gap-2 rounded-lg bg-surface-sunken px-3 py-2.5" :title="title">
    <span class="tabular flex items-baseline justify-between gap-2 font-mono text-xs">
      <span class="font-bold text-text-secondary">#{{ formatNumber(number) }}</span>
      <span v-if="dated" class="truncate text-text-muted">{{ wishDay(row.pull.time) }}</span>
    </span>
    <span class="flex min-w-0 items-center gap-2.5">
      <WishItemIcon :item="row.pull.item" :outcome="row.outcome" size="lg" />
      <span class="min-w-0 flex-1 truncate text-sm font-semibold">{{
        wishItemName(row.pull.item)
      }}</span>
      <span class="tabular shrink-0 font-mono text-lg leading-none font-bold" :style="{ color }">{{
        row.pity
      }}</span>
    </span>
    <span class="h-1.5 rounded-full bg-surface-overlay" aria-hidden="true">
      <span class="block h-full rounded-full" :style="{ width, background: color }" />
    </span>
  </div>
</template>
