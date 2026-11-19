<script setup lang="ts">
import type { TimelineGroupBy } from '@gdt/shared'
import { computed, ref } from 'vue'
import { X } from 'lucide-vue-next'
import ChartRangeSelect from '@/components/charts/ChartRangeSelect.vue'
import TimelineChart, { type TimelineSeries } from '@/components/charts/TimelineChart.vue'
import GameIcon from '@/components/ui/GameIcon.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import type { ChartRange } from '@/data/chart-range'
import { changeOver, seriesPoints, type ChartFrame, type MaterialsHistory } from '@/data/materials'
import { formatDate, formatNumber, formatSigned } from '@/lib/format'
import { readStorage, writeStorage } from '@/lib/storage'
import { materialName } from '@/utils/materials'
import { GROUP_OPTIONS } from './use-materials-graph'

const props = defineProps<{
  history: MaterialsHistory
  frame: ChartFrame
  keys: string[]
  ready: boolean
  icon: (key: string) => string
}>()
const emit = defineEmits<{ remove: [key: string]; reset: [] }>()
const groupBy = defineModel<TimelineGroupBy>('groupBy', { required: true })
const range = defineModel<ChartRange>('range', { required: true })

type Layout = 'combined' | 'split'
const LAYOUT_KEY = 'materials:chart-layout'
const storedLayout = readStorage(LAYOUT_KEY)
const layoutChoice = ref<Layout | null>(
  storedLayout === 'combined' || storedLayout === 'split' ? storedLayout : null,
)
const LAYOUT_OPTIONS: { value: Layout; label: string }[] = [
  { value: 'combined', label: 'Combined' },
  { value: 'split', label: 'Split' },
]

const rows = computed(() =>
  props.keys.map((key, index) => {
    const points = seriesPoints(props.history, key, props.frame)
    const latest = props.history.latest.get(key) ?? 0
    const change = changeOver(props.history, key, props.frame)
    const name = materialName(key)
    return {
      key,
      name,
      color: ((index % 6) + 1) as TimelineSeries['color'],
      points,
      peak: points.reduce((max, p) => Math.max(max, p.y ?? 0), 0),
      latest,
      change,
      detail: `${name}: ${formatNumber(latest)} (${formatSigned(change)} in range)`,
    }
  }),
)

/** One shared axis flattens small series next to a much larger one (Mora vs Primogem). */
const scalesDiffer = computed(() => {
  const peaks = rows.value.map((r) => r.peak).filter((p) => p > 0)
  return peaks.length > 1 && Math.max(...peaks) / Math.min(...peaks) >= 20
})

/** No saved choice: split automatically when the scales are far apart. */
const layout = computed<Layout>({
  get: () => layoutChoice.value ?? (scalesDiffer.value ? 'split' : 'combined'),
  set: (value) => {
    layoutChoice.value = value
    writeStorage(LAYOUT_KEY, value)
  },
})

const combined = computed<TimelineSeries[]>(() =>
  rows.value.map((r) => ({ label: r.name, color: r.color, points: r.points })),
)

const rangeLabel = computed(() => (range.value === 'all' ? 'all history' : `last ${range.value}`))
const chartLabel = (names: string[]) =>
  `${names.join(', ')}: count over ${rangeLabel.value}, last value per ${groupBy.value}`

/** What the chart covers, for the title tooltip. */
const coverage = computed(() => {
  const { frame, history } = props
  const from = frame.carryIn >= 0 ? frame.from : (history.times[frame.baseline] ?? 0)
  const n = frame.count
  return `${formatNumber(n)} ${n === 1 ? 'snapshot' : 'snapshots'}, ${formatDate(from)} to ${formatDate(frame.end)}`
})

const deltaClass = (value: number) =>
  value > 0 ? 'text-success-text' : value < 0 ? 'text-danger-text' : 'text-text-muted'
</script>

<template>
  <UiPanel>
    <template #header>
      <h2 class="font-display text-xl font-bold" :title="coverage">History</h2>
    </template>
    <template #actions>
      <UiSegmented v-model="groupBy" :options="GROUP_OPTIONS" label="Group by" />
      <ChartRangeSelect v-model="range" />
    </template>

    <div v-if="!ready" class="flex flex-col gap-4" aria-busy="true">
      <div class="flex flex-wrap gap-2">
        <UiSkeleton class="h-11 w-32" />
        <UiSkeleton class="h-11 w-36" />
      </div>
      <UiSkeleton class="h-72 w-full" />
    </div>

    <div v-else-if="rows.length === 0" class="flex flex-col items-center gap-3 py-12">
      <p class="text-text-secondary">Nothing on the chart</p>
      <UiButton @click="emit('reset')">Add Mora and Primogem</UiButton>
    </div>

    <div v-else class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <ul class="flex flex-wrap gap-2" aria-label="On the chart">
          <li
            v-for="row in rows"
            :key="row.key"
            class="inline-flex max-w-full items-center gap-2 rounded-lg border border-border-default bg-surface-sunken pl-3"
            :title="row.detail"
          >
            <span
              class="size-3 shrink-0 rounded-sm"
              :style="{ backgroundColor: `var(--chart-${row.color})` }"
              aria-hidden="true"
            />
            <span class="truncate text-sm font-medium">{{ row.name }}</span>
            <button
              type="button"
              class="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-overlay hover:text-text-primary"
              :aria-label="`Remove ${row.name}`"
              @click="emit('remove', row.key)"
            >
              <X class="size-4" aria-hidden="true" />
            </button>
          </li>
        </ul>
        <UiSegmented
          v-if="rows.length > 1"
          v-model="layout"
          :options="LAYOUT_OPTIONS"
          label="Chart layout"
        />
      </div>

      <TimelineChart
        v-if="layout === 'combined' || rows.length === 1"
        :series="combined"
        :label="chartLabel(rows.map((r) => r.name))"
        :height="300"
        stepped
      />
      <div v-else class="grid gap-4 md:grid-cols-2">
        <figure
          v-for="row in rows"
          :key="row.key"
          class="flex min-w-0 flex-col gap-3 rounded-xl border border-border-subtle p-4"
        >
          <figcaption class="flex items-center gap-3" :title="row.detail">
            <GameIcon :src="icon(row.key)" :name="row.name" size="sm" />
            <span class="min-w-0 flex-1 truncate font-medium">{{ row.name }}</span>
            <span class="tabular font-mono text-sm" :class="deltaClass(row.change)">{{
              formatSigned(row.change)
            }}</span>
          </figcaption>
          <TimelineChart
            :series="[{ label: row.name, color: row.color, points: row.points }]"
            :label="chartLabel([row.name])"
            :height="180"
            stepped
          />
        </figure>
      </div>
    </div>
  </UiPanel>
</template>
