<script setup lang="ts">
import { TREND_RANGES, type TrendRange } from '@gdt/shared'
import { Activity } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import OnlineTable from '@/components/staff/metrics/OnlineTable.vue'
import SparkLine from '@/components/staff/metrics/SparkLine.vue'
import TrendLines from '@/components/staff/metrics/TrendLines.vue'
import { seriesOf, share } from '@/components/staff/metrics/series'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import UiError from '@/components/ui/UiError.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import UiStat from '@/components/ui/UiStat.vue'
import { api } from '@/api'
import { useResource } from '@/data/use-resource'
import { t } from '@/i18n'
import { formatMonthDay, formatNumber, formatTime } from '@/lib/format'
import { useSession } from '@/stores/session'

/**
 * Now: six tiles (each with its readings as a small line), the Online and in
 * game chart over 24 hours, 7 or 30 days, and who is online. The tiles are
 * read from what the site keeps anyway; the lines from the hourly readings.
 */
const props = defineProps<{ refresh: number }>()
const emit = defineEmits<{ loaded: [at: number] }>()
const session = useSession()

const range = ref<TrendRange>('24h')
const { data, error, reload } = useResource(
  () => ({ range: range.value, refresh: props.refresh }),
  ({ range }) => api.staff.metricsNow(range),
)
watch(data, (value) => value && emit('loaded', value.at))

const ranges = computed(() =>
  TREND_RANGES.map((value) => ({ value, label: t(`staff.metrics.ranges.${value}`) })),
)

const tiles = computed(() => {
  const d = data.value
  if (!d) return []
  const line = (key: Parameters<typeof seriesOf>[1]) => seriesOf(d.trend, key, 48)
  return [
    {
      key: 'online',
      value: d.online,
      sub: t('staff.metrics.now.ofUsers', { share: share(d.online, d.users) }),
      line: line('online'),
    },
    {
      key: 'capture',
      value: d.captureRunning,
      sub: t('staff.metrics.now.ofDevices', { n: formatNumber(d.captureDevices) }),
      line: line('capture'),
    },
    { key: 'inGame', value: d.inGame, sub: t('staff.metrics.now.sending'), line: line('inGame') },
    {
      key: 'journals',
      value: d.journals,
      sub: t('staff.metrics.now.activeCount', { n: formatNumber(d.inGame) }),
      line: line('journals'),
    },
    {
      key: 'batches',
      value: d.batchesToday,
      sub: t('staff.metrics.now.atCap', { n: formatNumber(d.atCap) }),
      line: line('batches'),
    },
    {
      key: 'active',
      value: d.dau,
      sub: t('staff.metrics.now.ofUsers', { share: share(d.dau, d.users) }),
      line: line('dau'),
    },
  ].map((tile) => ({
    ...tile,
    label: t(`staff.metrics.now.${tile.key}`),
    hint: t(`staff.metrics.now.${tile.key}Hint`),
  }))
})

const peak = (values: number[]) => formatNumber(Math.max(0, ...values))
const chart = computed(() => {
  const trend = data.value?.trend ?? []
  const lines = (['online', 'inGame', 'capture'] as const).map((key) => {
    const values = seriesOf(trend, key)
    return {
      key,
      values,
      label: t('staff.metrics.now.peak', {
        name: t(`staff.metrics.now.${key}`),
        n: peak(values),
      }),
    }
  })
  // Three or five labels under the chart: its ends and what lies between.
  const stamp = range.value === '24h' ? formatTime : formatMonthDay
  const count = Math.min(trend.length, range.value === '24h' ? 5 : 3)
  const ticks = Array.from({ length: count }, (_, i) =>
    stamp(trend[Math.round((i * (trend.length - 1)) / Math.max(1, count - 1))]!.at),
  )
  return { lines, ticks, enough: trend.length > 1 }
})
</script>

<template>
  <UiError
    v-if="error && !data"
    :error="error"
    :title="$t('staff.common.couldNotLoad')"
    @retry="reload"
  />
  <div v-else-if="!data" class="flex flex-col gap-6" aria-busy="true">
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      <UiSkeleton v-for="n in 6" :key="n" class="h-28" />
    </div>
    <UiSkeleton class="h-64" />
  </div>

  <template v-else>
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      <UiStat
        v-for="tile in tiles"
        :key="tile.key"
        :label="tile.label"
        :value="tile.value"
        :hint="tile.hint"
        exact
      >
        <span class="tabular truncate font-mono text-sm text-text-muted">{{ tile.sub }}</span>
        <SparkLine
          :values="tile.line"
          :label="$t('staff.metrics.now.spark', { name: tile.label })"
        />
      </UiStat>
    </div>

    <UiPanel :title="$t('staff.metrics.now.trendTitle')">
      <template #actions>
        <UiSegmented v-model="range" :options="ranges" :label="$t('staff.metrics.rangeLabel')" />
      </template>
      <TrendLines
        v-if="chart.enough"
        :series="chart.lines"
        :ticks="chart.ticks"
        :label="$t('staff.metrics.now.trendLabel')"
      />
      <UiEmpty
        v-else
        :title="$t('staff.metrics.now.noReadings')"
        :body="$t('staff.metrics.now.noReadingsBody')"
      >
        <template #icon><Activity aria-hidden="true" /></template>
      </UiEmpty>
    </UiPanel>

    <OnlineTable v-if="session.can('users.view')" :refresh="refresh" />
  </template>
</template>
