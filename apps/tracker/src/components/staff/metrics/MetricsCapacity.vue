<script setup lang="ts">
import { TREND_RANGES, type TrendRange, type UsageItem } from '@gdt/shared'
import { CloudOff, TriangleAlert } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import StorageSplitBar from '@/components/staff/StorageSplitBar.vue'
import TrendLines from '@/components/staff/metrics/TrendLines.vue'
import { daysUntilFull, share, spanOf, thin } from '@/components/staff/metrics/series'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import UiError from '@/components/ui/UiError.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiProgress from '@/components/ui/UiProgress.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import { api } from '@/api'
import { useResource } from '@/data/use-resource'
import { t } from '@/i18n'
import { formatBytes, formatCompact, formatMonthDay, formatNumber, formatTime } from '@/lib/format'

/**
 * Capacity: each database against D1's 10 GB, what the main one holds, how
 * fast it grows, and (with the usage token) Cloudflare's own figures for
 * the month against what the plan includes. A figure past 80% carries a
 * warning mark and its share in words, not only a colour.
 */
const props = defineProps<{ refresh: number }>()
const emit = defineEmits<{ loaded: [at: number] }>()

const range = ref<TrendRange>('7d')
const figure = ref<'requests' | 'cpu'>('requests')
const { data, error, reload } = useResource(
  () => ({ range: range.value, refresh: props.refresh }),
  ({ range }) => api.staff.metricsCapacity(range),
)
const ranges = computed(() =>
  TREND_RANGES.map((value) => ({ value, label: t(`staff.metrics.ranges.${value}`) })),
)
const figures = computed(() => [
  { value: 'requests' as const, label: t('staff.metrics.capacity.historyRequests') },
  { value: 'cpu' as const, label: t('staff.metrics.capacity.items.cpuMs') },
])

/** Cloudflare's hourly figures from the readings: requests and what was refused, or CPU time. */
const history = computed(() => {
  const samples = thin(data.value?.history ?? [], 120)
  const pick = (read: (cf: NonNullable<(typeof samples)[number]['cf']>) => number | null) =>
    samples.map((s) => (s.cf ? (read(s.cf) ?? 0) : 0))
  const peak = (values: number[]) => formatCompact(Math.max(0, ...values))
  const requests = pick((cf) => cf.requests)
  const refused = pick((cf) =>
    cf.http4xx === null && cf.http429 === null && cf.http5xx === null
      ? null
      : (cf.http4xx ?? 0) + (cf.http429 ?? 0) + (cf.http5xx ?? 0),
  )
  const cpu = pick((cf) => cf.cpuMs)
  const lines =
    figure.value === 'requests'
      ? [
          {
            key: 'requests',
            values: requests,
            label: t('staff.metrics.capacity.historyPeak', {
              name: t('staff.metrics.capacity.historyRequests'),
              n: peak(requests),
            }),
          },
          {
            key: 'refused',
            values: refused,
            label: t('staff.metrics.capacity.historyPeak', {
              name: t('staff.metrics.capacity.historyRefused'),
              n: peak(refused),
            }),
          },
        ]
      : [
          {
            key: 'cpu',
            values: cpu,
            label: t('staff.metrics.capacity.historyPeak', {
              name: t('staff.metrics.capacity.items.cpuMs'),
              n: t('staff.metrics.capacity.ms', { n: peak(cpu) }),
            }),
          },
        ]
  const stamp = range.value === '24h' ? formatTime : formatMonthDay
  const count = Math.min(samples.length, 4)
  const ticks = Array.from({ length: count }, (_, i) =>
    stamp(samples[Math.round((i * (samples.length - 1)) / Math.max(1, count - 1))]!.at),
  )
  return { lines, ticks, enough: samples.length > 1 }
})
watch(data, (value) => value && emit('loaded', value.at))

const fullIn = computed(() => {
  const d = data.value
  if (!d) return null
  const days = daysUntilFull(d.databases[0]?.bytes ?? null, d.databases[0]!.limit, d.growthPerDay)
  if (days === null) return null
  const span = spanOf(days)
  return t(`staff.metrics.capacity.${span.unit}`, { n: formatNumber(span.n) }, span.n)
})

const usd = (value: number) => `$${value.toFixed(2)}`

function amount(key: UsageItem['key'], value: number): string {
  const n = formatCompact(value)
  if (key === 'cpuMs') return t('staff.metrics.capacity.ms', { n })
  if (key === 'doDuration') return t('staff.metrics.capacity.gbs', { n })
  return n
}

const usage = computed(() =>
  (data.value?.usage?.items ?? []).map((item) => {
    const percent = item.used === null ? null : (item.used / item.included) * 100
    return {
      key: item.key,
      label: t(`staff.metrics.capacity.items.${item.key}`),
      used: item.used,
      usedText: item.used === null ? '—' : amount(item.key, item.used),
      includedText: amount(item.key, item.included),
      exact: item.used === null ? undefined : formatNumber(item.used),
      percent: percent === null ? null : share(item.used!, item.included),
      high: percent !== null && percent >= 80,
    }
  }),
)
</script>

<template>
  <UiError
    v-if="error && !data"
    :error="error"
    :title="$t('staff.common.couldNotLoad')"
    @retry="reload"
  />
  <div v-else-if="!data" class="grid gap-6 lg:grid-cols-2" aria-busy="true">
    <UiSkeleton class="h-72" />
    <UiSkeleton class="h-72" />
  </div>

  <template v-else>
    <div class="grid items-start gap-6 lg:grid-cols-2">
      <UiPanel :title="$t('staff.metrics.capacity.databases')">
        <template #actions>
          <span class="tabular font-mono text-sm text-text-muted">{{
            $t('staff.metrics.capacity.limitEach', { size: formatBytes(data.databases[0]!.limit) })
          }}</span>
        </template>
        <div class="flex flex-col gap-5">
          <div v-for="db in data.databases" :key="db.name" class="flex flex-col gap-1.5 text-sm">
            <div class="flex items-baseline gap-2">
              <span class="min-w-0 flex-1 truncate font-code text-[0.8125rem]">{{ db.name }}</span>
              <span class="tabular font-mono font-medium">{{
                db.bytes === null ? $t('staff.metrics.capacity.unknown') : formatBytes(db.bytes)
              }}</span>
              <span v-if="db.bytes !== null" class="tabular w-14 text-right text-text-muted">{{
                share(db.bytes, db.limit)
              }}</span>
            </div>
            <UiProgress
              :value="db.bytes ?? 0"
              :max="db.limit"
              :tone="(db.bytes ?? 0) / db.limit >= 0.8 ? 'danger' : 'accent'"
              :label="$t('staff.metrics.capacity.sizeLabel', { name: db.name })"
            />
          </div>
          <StorageSplitBar
            :split="data.storage"
            :label="$t('staff.storage.siteSplit')"
            :pulls="data.storage.wishPulls"
            legend
          />
          <dl class="flex flex-col divide-y divide-border-subtle text-sm">
            <div class="flex items-center gap-3 pb-2.5">
              <dt class="min-w-0 flex-1 truncate text-text-secondary">
                <span :title="$t('staff.metrics.capacity.growthTitle')">{{
                  $t('staff.metrics.capacity.growth')
                }}</span>
              </dt>
              <dd class="tabular font-mono font-medium">
                {{ $t('staff.metrics.capacity.perDay', { size: formatBytes(data.growthPerDay) }) }}
              </dd>
            </div>
            <div class="flex items-center gap-3 pt-2.5">
              <dt class="min-w-0 flex-1 truncate text-text-secondary">
                <span :title="$t('staff.metrics.capacity.fullInTitle')">{{
                  $t('staff.metrics.capacity.fullIn')
                }}</span>
              </dt>
              <dd class="tabular font-mono font-medium">
                {{ fullIn ?? $t('staff.metrics.capacity.notGrowing') }}
              </dd>
            </div>
          </dl>
        </div>
      </UiPanel>

      <UiPanel :title="$t('staff.metrics.capacity.usage')">
        <template v-if="data.usage" #actions>
          <span
            class="tabular font-mono text-sm text-text-muted"
            :title="$t('staff.metrics.capacity.usageTitle')"
            >{{ formatMonthDay(data.usage.from) }} – {{ formatMonthDay(data.usage.to) }}</span
          >
        </template>
        <UiEmpty
          v-if="!data.usage"
          :title="$t('staff.metrics.capacity.off')"
          :body="$t('staff.metrics.capacity.offBody')"
        >
          <template #icon><CloudOff aria-hidden="true" /></template>
        </UiEmpty>
        <div v-else class="flex flex-col gap-4 text-sm">
          <div v-for="item in usage" :key="item.key" class="flex flex-col gap-1.5">
            <div class="flex flex-wrap items-baseline gap-x-2">
              <span class="min-w-0 flex-1 truncate text-text-secondary">{{ item.label }}</span>
              <span
                class="tabular font-mono font-medium"
                :title="item.exact ?? $t('staff.metrics.capacity.notAnswered')"
                >{{ item.usedText }}</span
              >
              <span class="tabular font-mono text-text-muted">/ {{ item.includedText }}</span>
              <UiBadge v-if="item.high" tone="warning" :title="$t('staff.metrics.capacity.over80')">
                <TriangleAlert class="size-3" aria-hidden="true" />
                {{ item.percent }}
              </UiBadge>
              <span v-else class="tabular w-12 text-right text-text-muted">{{
                item.percent ?? ''
              }}</span>
            </div>
            <UiProgress
              :value="item.used ?? 0"
              :max="data.usage.items.find((i) => i.key === item.key)!.included"
              :tone="item.high ? 'danger' : 'accent'"
              :label="item.label"
            />
          </div>
          <dl
            class="flex flex-col divide-y divide-border-subtle border-t border-border-default pt-4"
          >
            <div class="flex items-center gap-3 pb-2.5">
              <dt class="min-w-0 flex-1 truncate text-text-secondary">
                <span :title="$t('staff.metrics.capacity.billTitle')">{{
                  $t('staff.metrics.capacity.bill')
                }}</span>
              </dt>
              <dd class="tabular font-mono font-medium">{{ usd(data.usage.billUsd) }}</dd>
            </div>
            <div class="flex items-center gap-3 pt-2.5">
              <dt class="min-w-0 flex-1 truncate text-text-secondary">
                <span :title="$t('staff.metrics.capacity.projectedTitle')">{{
                  $t('staff.metrics.capacity.projected')
                }}</span>
              </dt>
              <dd class="tabular font-mono font-medium">{{ usd(data.usage.projectedUsd) }}</dd>
            </div>
          </dl>
        </div>
      </UiPanel>
    </div>

    <!-- Shown with the token, or while readings from when it was set are still in range. -->
    <div
      v-if="data.usage || data.history.length"
      class="grid items-start gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]"
    >
      <UiPanel :title="$t('staff.metrics.capacity.history')">
        <template #actions>
          <UiSegmented
            v-model="figure"
            :options="figures"
            :label="$t('staff.metrics.activity.figure')"
          />
          <UiSegmented v-model="range" :options="ranges" :label="$t('staff.metrics.rangeLabel')" />
        </template>
        <TrendLines
          v-if="history.enough"
          :series="history.lines"
          :ticks="history.ticks"
          :label="$t('staff.metrics.capacity.historyLabel')"
        />
        <UiEmpty
          v-else
          :title="$t('staff.metrics.now.noReadings')"
          :body="$t('staff.metrics.now.noReadingsBody')"
        >
          <template #icon><CloudOff aria-hidden="true" /></template>
        </UiEmpty>
      </UiPanel>
      <UiPanel :title="$t('staff.metrics.capacity.errors')" flush>
        <template #actions>
          <span
            class="tabular font-mono text-sm text-text-muted"
            :title="$t('staff.metrics.capacity.errorsTitle')"
            >{{ $t('staff.metrics.ranges.24h') }}</span
          >
        </template>
        <p v-if="!data.routes" class="p-5 text-sm text-text-muted">
          {{ $t('staff.metrics.capacity.errorsOff') }}
        </p>
        <p v-else-if="data.routes.length === 0" class="p-5 text-sm text-text-muted">
          {{ $t('staff.metrics.capacity.errorsNone') }}
        </p>
        <div v-else class="overflow-x-auto">
          <table class="w-full min-w-[24rem] text-sm">
            <thead
              class="border-b border-border-default bg-surface-overlay/50 text-text-secondary [&_th]:whitespace-nowrap"
            >
              <tr>
                <th scope="col" class="px-3 py-2 text-left font-medium">
                  {{ $t('staff.metrics.capacity.route') }}
                </th>
                <th
                  v-for="column in ['http4xx', 'http429', 'http5xx']"
                  :key="column"
                  scope="col"
                  class="px-3 py-2 text-right font-medium"
                  :title="$t(`staff.metrics.capacity.${column}Title`)"
                >
                  {{ column.slice(4) }}
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border-subtle [&_td]:whitespace-nowrap">
              <tr v-for="row in data.routes" :key="row.route">
                <td
                  class="max-w-64 truncate px-3 py-1.5 font-code text-[0.8125rem]"
                  :title="row.route"
                >
                  {{ row.route === 'other' ? $t('staff.metrics.capacity.otherRoutes') : row.route }}
                </td>
                <td class="tabular px-3 py-1.5 text-right font-mono">
                  {{ formatNumber(row.http4xx) }}
                </td>
                <td class="tabular px-3 py-1.5 text-right font-mono">
                  {{ formatNumber(row.http429) }}
                </td>
                <td
                  class="tabular px-3 py-1.5 text-right font-mono"
                  :class="row.http5xx ? 'font-semibold text-warning-text' : ''"
                >
                  {{ formatNumber(row.http5xx) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UiPanel>
    </div>
  </template>
</template>
