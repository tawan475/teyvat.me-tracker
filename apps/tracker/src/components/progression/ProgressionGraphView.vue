<script setup lang="ts">
import { computed } from 'vue'
import TimelineChart, { type TimelineSeries } from '@/components/charts/TimelineChart.vue'
import ChangeValue from '@/components/overview/ChangeValue.vue'
import { formatNumber } from '@/lib/format'
import type { ChangeBar } from './ChangeBarChart.vue'
import ChangeBarChart from './ChangeBarChart.vue'

/** One graph as the card draws it (see DetailedProgression's views). */
export interface GraphView {
  id: string
  title: string
  /** Tooltip on the title (how a computed figure is counted). */
  hint?: string
  last: number
  net: number
  gained: number
  spent: number
  series: TimelineSeries[]
  lineLabel: string
  bars: ChangeBar[]
  domain?: [number, number]
  barsLabel: string
  /** The game's bag limit the axis ends at: shown as "1,965 / 2,700 · 73%" and a fill bar. */
  bag: number | null
  yMin?: number
  yMax?: number
  delta: boolean
}

/**
 * One progression graph: the heading with the latest value (over the bag
 * limit when the axis ends at it), the line, and its delta graph (change
 * per snapshot or period) when on. The y axes of the line and the bars take
 * the wider of the two (`yAxisWidth`) so their plots line up.
 */
const props = defineProps<{
  view: GraphView
  stepped: boolean
  perLabel: string
  perDetail: string
  yAxisWidth: number
  padRight: number
  /** Taller charts on the card; a little shorter in the dialog's preview. */
  compact?: boolean
}>()
const emit = defineEmits<{ fit: [part: 'line' | 'bars', width: number] }>()

const percent = computed(() =>
  props.view.bag ? Math.round((props.view.last / props.view.bag) * 100) : 0,
)
</script>

<template>
  <section class="min-w-0" :aria-labelledby="`graph-${view.id}`">
    <div class="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h3 :id="`graph-${view.id}`" class="font-display text-lg font-bold" :title="view.hint">
        {{ view.title }}
      </h3>
      <p class="flex flex-wrap items-baseline justify-end gap-x-2">
        <span class="tabular font-mono font-medium">{{ formatNumber(view.last) }}</span>
        <span v-if="view.bag" class="tabular font-mono text-sm text-text-muted">
          / {{ formatNumber(view.bag) }} · {{ formatNumber(percent) }}%
        </span>
        <ChangeValue :value="view.net" :hint="$t('progression.inRange')" class="text-sm" />
      </p>
    </div>
    <div
      v-if="view.bag"
      class="mb-3 h-1.5 overflow-hidden rounded-full bg-surface-overlay"
      role="meter"
      :aria-valuenow="view.last"
      :aria-valuemin="0"
      :aria-valuemax="view.bag"
      :aria-label="$t('progression.graphs.bagMeter', { figure: view.title })"
    >
      <div
        class="h-full rounded-full"
        :style="{
          width: `${Math.min(100, percent)}%`,
          background: `var(--chart-${view.series[0]?.color ?? 1})`,
        }"
      />
    </div>
    <TimelineChart
      :series="view.series"
      :label="view.lineLabel"
      :height="compact ? 180 : 220"
      fill
      :stepped="stepped"
      :y-axis-width="yAxisWidth"
      :pad-right="padRight"
      :y-min="view.yMin"
      :y-max="view.yMax"
      @y-axis-fit="(width) => emit('fit', 'line', width)"
    />

    <template v-if="view.delta">
      <div class="mt-5 mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h4 class="text-sm font-medium text-text-secondary" :title="perDetail">
          {{ perLabel }}
        </h4>
        <p class="flex items-baseline gap-3 text-sm">
          <ChangeValue :value="view.gained" :hint="$t('progression.gainedInRange')" />
          <ChangeValue :value="-view.spent" :hint="$t('progression.spentInRange')" />
        </p>
      </div>
      <ChangeBarChart
        :bars="view.bars"
        :name="view.title"
        :label="view.barsLabel"
        :height="compact ? 110 : 150"
        :domain="view.domain"
        :y-axis-width="yAxisWidth"
        :pad-right="padRight"
        @y-axis-fit="(width) => emit('fit', 'bars', width)"
      />
    </template>
  </section>
</template>
