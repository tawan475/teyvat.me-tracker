<script setup lang="ts">
import { linePoints } from '@gdt/shared'
import { computed } from 'vue'
import { formatNumber } from '@/lib/format'

/**
 * Up to three figures over time as lines, oldest left. Each line has its own
 * dash pattern as well as its colour (solid, dashed, dotted), and the legend
 * draws the same pattern beside the name, so the lines are told apart
 * without colour. The scale's top is written at the left; a table of the
 * same numbers is there for screen readers.
 */
export interface TrendSeries {
  key: string
  /** The legend's text ("Online, peak 17"). */
  label: string
  values: number[]
}

const props = defineProps<{
  series: TrendSeries[]
  /** Labels under the chart, left to right. */
  ticks: string[]
  /** What the chart shows, for assistive tech. */
  label: string
}>()

const STYLES = [
  { color: 'var(--chart-1)', dash: undefined, cap: 'butt' },
  { color: 'var(--chart-2)', dash: '7 4', cap: 'butt' },
  { color: 'var(--chart-4)', dash: '1.5 4.5', cap: 'round' },
] as const

const top = computed(() => Math.max(1, ...props.series.flatMap((s) => s.values)))
const lines = computed(() =>
  props.series.map((s, i) => ({
    ...s,
    style: STYLES[i % STYLES.length]!,
    points: s.values.length > 1 ? linePoints(s.values, top.value * 1.06, 300, 100) : '',
  })),
)
const rows = computed(() => Math.max(0, ...props.series.map((s) => s.values.length)))
</script>

<template>
  <div>
    <div class="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-text-secondary">
      <span v-for="line in lines" :key="line.key" class="inline-flex items-center gap-1.5">
        <svg class="h-2.5 w-6 shrink-0" viewBox="0 0 24 10" aria-hidden="true">
          <line
            x1="1"
            y1="5"
            x2="23"
            y2="5"
            :stroke="line.style.color"
            stroke-width="2"
            :stroke-dasharray="line.style.dash"
            :stroke-linecap="line.style.cap"
          />
        </svg>
        {{ line.label }}
      </span>
    </div>
    <div class="relative">
      <span
        class="tabular pointer-events-none absolute top-0 left-0 font-mono text-xs text-text-muted"
        aria-hidden="true"
        >{{ formatNumber(top) }}</span
      >
      <svg
        class="block h-40 w-full border-b border-border-default"
        viewBox="0 0 300 100"
        preserveAspectRatio="none"
        role="img"
        :aria-label="label"
      >
        <line
          x1="0"
          y1="50"
          x2="300"
          y2="50"
          stroke="var(--chart-grid)"
          stroke-width="1"
          vector-effect="non-scaling-stroke"
        />
        <polyline
          v-for="line in lines"
          :key="line.key"
          :points="line.points"
          fill="none"
          :stroke="line.style.color"
          stroke-width="2"
          stroke-linejoin="round"
          :stroke-dasharray="line.style.dash"
          :stroke-linecap="line.style.cap"
          vector-effect="non-scaling-stroke"
        />
      </svg>
    </div>
    <div class="tabular mt-1.5 flex justify-between font-mono text-xs text-text-muted">
      <span v-for="(tick, i) in ticks" :key="i">{{ tick }}</span>
    </div>
    <!-- A table is never narrower than its cells: hidden by its wrapper. -->
    <div class="sr-only">
      <table>
        <caption>
          {{
            label
          }}
        </caption>
        <thead>
          <tr>
            <th v-for="s in series" :key="s.key" scope="col">{{ s.label }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="n in rows" :key="n">
            <td v-for="s in series" :key="s.key">{{ s.values[n - 1] ?? '' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
