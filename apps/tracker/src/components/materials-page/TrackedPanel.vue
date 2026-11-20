<script setup lang="ts">
import { computed } from 'vue'
import { Plus, X } from 'lucide-vue-next'
import ItemArt from '@/components/ui/ItemArt.vue'
import ChartRangeSelect from '@/components/charts/ChartRangeSelect.vue'
import TimelineChart, { type TimelineSeries } from '@/components/charts/TimelineChart.vue'
import { MAX_SERIES } from '@/components/materials/use-materials-graph'
import UiButton from '@/components/ui/UiButton.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import { formatRangeEdge, formatWindow, type ChartRange } from '@/data/chart-range'
import type { ChartFrame, MaterialsHistory } from '@/data/materials'
import { t } from '@/i18n'
import { clock24, formatNumber } from '@/lib/format'
import { materialName, materialRarity } from '@/utils/materials'
import DeltaText from './DeltaText.vue'
import MaterialIcon from './MaterialIcon.vue'
import { frameStart, trackedTiles } from './material-stats'

/**
 * Tracked materials as small multiples: one stepped chart each, so Mora and
 * Primogems never squash each other on a shared axis.
 *
 * `keys` are the saved pins, all of them: a pin on a count that is not shared
 * now (issue 12) keeps its tile in its place. It says "Not shared" where the
 * count stands, its line has the history's breaks, it opens no detail (there
 * is none to open for such a count) and its remove unpins it like any other.
 */
const props = defineProps<{
  history: MaterialsHistory
  frame: ChartFrame
  keys: string[]
  ready: boolean
  icon: (key: string) => string
}>()
const emit = defineEmits<{ open: [key: string]; remove: [key: string]; add: [] }>()
const range = defineModel<ChartRange>('range', { required: true })

const from = computed(() => frameStart(props.history, props.frame))
const rangeHint = computed(() =>
  t('materials.since', {
    date: formatRangeEdge(from.value, props.frame.end - from.value, !clock24()),
  }),
)
const rangeDetail = computed(() => formatWindow(from.value, props.frame.end, !clock24()))

const rows = computed(() =>
  trackedTiles(props.history, props.keys, props.frame).map((tile) => {
    const name = materialName(tile.key)
    const series: TimelineSeries = { label: name, color: tile.color, points: tile.points }
    return { ...tile, name, rarity: materialRarity(tile.key), series: [series] }
  }),
)

function open(key: string, count: number | null) {
  if (count !== null) emit('open', key)
}
</script>

<template>
  <UiPanel>
    <template #header>
      <h2 class="text-base font-semibold">
        {{ $t('materials.tracked.title') }}
        <span
          class="tabular ml-1 font-mono text-sm font-normal text-text-muted"
          :title="$t('materials.trackedOfMax')"
          >{{ keys.length }}/{{ MAX_SERIES }}</span
        >
      </h2>
    </template>
    <template #actions>
      <ChartRangeSelect v-model="range" :detail="rangeDetail" />
      <UiButton v-if="keys.length > 0 && keys.length < MAX_SERIES" size="sm" @click="emit('add')">
        <Plus class="size-4" aria-hidden="true" />
        {{ $t('materials.track') }}
      </UiButton>
    </template>

    <div v-if="!ready" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
      <UiSkeleton v-for="n in 2" :key="n" class="h-52" />
    </div>

    <button
      v-else-if="keys.length === 0"
      type="button"
      class="flex min-h-24 w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border-default text-sm font-medium text-text-muted transition-colors hover:border-accent hover:text-accent-text"
      @click="emit('add')"
    >
      <Plus class="size-5" aria-hidden="true" />
      {{ $t('materials.track') }}
    </button>

    <ul
      v-else
      class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
      :aria-label="$t('materials.tracked.list')"
    >
      <li
        v-for="row in rows"
        :key="row.key"
        class="flex min-w-0 flex-col gap-2 rounded-xl border border-border-default p-3"
      >
        <div class="flex items-start gap-1">
          <component
            :is="row.count === null ? 'div' : 'button'"
            :type="row.count === null ? undefined : 'button'"
            class="-m-1 flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1 text-left"
            :class="row.count === null ? '' : 'transition-colors hover:bg-surface-overlay'"
            :title="row.name"
            @click="open(row.key, row.count)"
          >
            <span
              class="relative size-10 shrink-0 overflow-hidden rounded-lg bg-surface-overlay p-0.5 text-xs"
            >
              <ItemArt :rarity="row.rarity" small />
              <MaterialIcon :src="icon(row.key)" :name="row.name" />
            </span>
            <span class="flex min-w-0 flex-col">
              <span class="truncate text-sm text-text-secondary">{{ row.name }}</span>
              <span class="flex flex-wrap items-baseline gap-x-2">
                <span
                  v-if="row.count === null"
                  class="text-sm leading-6 font-medium whitespace-nowrap text-text-muted"
                  :title="$t('snapshots.parts.notShared')"
                  >{{ $t('snapshots.parts.notSharedShort') }}</span
                >
                <span v-else class="tabular font-mono text-lg leading-6 font-semibold">{{
                  formatNumber(row.count)
                }}</span>
                <DeltaText :value="row.change" :hint="rangeHint" dash class="text-sm" />
              </span>
            </span>
          </component>
          <button
            type="button"
            class="-mt-1 -mr-1 inline-flex size-9 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-overlay hover:text-text-primary"
            :aria-label="$t('materials.tracked.untrackName', { name: row.name })"
            :title="$t('materials.untrack')"
            @click="emit('remove', row.key)"
          >
            <X class="size-4" aria-hidden="true" />
          </button>
        </div>
        <TimelineChart
          :series="row.series"
          :label="$t('materials.detail.chartLabel', { name: row.name, since: rangeHint })"
          :height="132"
          stepped
          fill
        />
      </li>
    </ul>
  </UiPanel>
</template>
