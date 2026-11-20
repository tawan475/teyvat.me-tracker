<script setup lang="ts">
import { ACTIVITY_RANGES, type ActivityRange } from '@gdt/shared'
import { Activity } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import StackedBars from '@/components/staff/StackedBars.vue'
import TrendLines from '@/components/staff/metrics/TrendLines.vue'
import { bucketDays, bucketSize, share, thin } from '@/components/staff/metrics/series'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import UiError from '@/components/ui/UiError.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import UiStat from '@/components/ui/UiStat.vue'
import { api } from '@/api'
import { useResource } from '@/data/use-resource'
import { t } from '@/i18n'
import { formatBytes, formatMonthDay, formatNumber } from '@/lib/format'

/**
 * Activity: daily, weekly and monthly users now and over time, sign-ups by
 * how people signed up, who uploads, when users were last seen, client
 * programs and wish history use. A range past two months draws its bars a
 * week each, so a year still fits a phone.
 */
const props = defineProps<{ refresh: number }>()
const emit = defineEmits<{ loaded: [at: number] }>()

const range = ref<ActivityRange>('30d')
const figure = ref<'uploaders' | 'snapshots'>('uploaders')
const { data, error, reload } = useResource(
  () => ({ range: range.value, refresh: props.refresh }),
  ({ range }) => api.staff.metricsActivity(range),
)
watch(data, (value) => value && emit('loaded', value.at))

const ranges = computed(() =>
  ACTIVITY_RANGES.map((value) => ({ value, label: t(`staff.metrics.ranges.${value}`) })),
)
const figures = computed(() => [
  { value: 'uploaders' as const, label: t('staff.metrics.activity.uploaders') },
  { value: 'snapshots' as const, label: t('staff.common.snapshots') },
])

const METHODS = ['password', 'discord', 'google'] as const
const signupSeries = computed(() => [
  { key: 'password', label: t('staff.methods.password'), color: 'var(--chart-2)' },
  { key: 'discord', label: 'Discord', color: 'var(--chart-1)' },
  { key: 'google', label: 'Google', color: 'var(--chart-3)' },
])
const weekly = computed(() => bucketSize(data.value?.signups.length ?? 0) > 1)
const signups = computed(() => {
  const days = data.value?.signups ?? []
  return bucketDays(days, bucketSize(days.length), METHODS)
})
const signupTotal = computed(() =>
  (data.value?.signups ?? []).reduce(
    (sum, day) => sum + METHODS.reduce((n, m) => n + (Number(day[m]) || 0), 0),
    0,
  ),
)
const uploadSeries = computed(() => [
  {
    key: figure.value,
    label: figures.value.find((f) => f.value === figure.value)!.label,
    color: 'var(--chart-4)',
  },
])
const uploadedBytes = computed(() =>
  (data.value?.uploads ?? []).reduce((sum, day) => sum + (Number(day.bytes) || 0), 0),
)

const dayMs = (day: string) => Date.parse(`${day}T12:00:00Z`)
const active = computed(() => {
  const days = thin(data.value?.active ?? [], 120)
  const ticks = days.length
    ? [0, Math.floor((days.length - 1) / 2), days.length - 1].map((i) =>
        formatMonthDay(dayMs(days[i]!.day)),
      )
    : []
  return {
    enough: days.length > 1,
    ticks,
    lines: [
      {
        key: 'dau',
        label: t('staff.metrics.activity.dailyNow', { n: formatNumber(data.value?.dau ?? 0) }),
        values: days.map((d) => Number(d.dau) || 0),
      },
      {
        key: 'wau',
        label: t('staff.metrics.activity.weeklyNow', { n: formatNumber(data.value?.wau ?? 0) }),
        values: days.map((d) => Number(d.wau) || 0),
      },
    ],
  }
})

// One colour in four strengths (never hue alone), and the list under the bar names each.
const seen = computed(() => {
  const s = data.value?.lastSeen
  const total = Math.max(1, data.value?.users ?? 0)
  return (
    [
      { key: 'today', cls: 'bg-chart-1' },
      { key: 'week', cls: 'bg-chart-1/60' },
      { key: 'month', cls: 'bg-chart-1/30' },
      { key: 'older', cls: 'bg-border-strong' },
    ] as const
  ).map((band) => ({
    ...band,
    n: s?.[band.key] ?? 0,
    width: `${((s?.[band.key] ?? 0) / total) * 100}%`,
    label: t(`staff.metrics.activity.seen.${band.key}`),
  }))
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
    <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <UiSkeleton v-for="n in 4" :key="n" class="h-20" />
    </div>
    <UiSkeleton class="h-64" />
  </div>

  <template v-else>
    <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <UiStat
        v-for="tile in [
          { key: 'daily', value: data.dau, sub: 'DAU' },
          { key: 'weekly', value: data.wau, sub: 'WAU' },
          { key: 'monthly', value: data.mau, sub: 'MAU' },
        ]"
        :key="tile.key"
        :label="$t(`staff.metrics.activity.${tile.key}`)"
        :value="tile.value"
        :hint="$t(`staff.metrics.activity.${tile.key}Hint`)"
        exact
      >
        <span class="tabular truncate font-mono text-sm text-text-muted">{{ tile.sub }}</span>
      </UiStat>
      <UiStat
        :label="$t('staff.metrics.activity.stickiness')"
        :value="share(data.dau, data.mau)"
        :hint="$t('staff.metrics.activity.stickinessHint')"
      >
        <span class="tabular truncate font-mono text-sm text-text-muted">DAU / MAU</span>
      </UiStat>
    </div>

    <UiPanel :title="$t('staff.metrics.activity.activeTitle')">
      <template #actions>
        <UiSegmented v-model="range" :options="ranges" :label="$t('staff.metrics.rangeLabel')" />
      </template>
      <TrendLines
        v-if="active.enough"
        :series="active.lines"
        :ticks="active.ticks"
        :label="$t('staff.metrics.activity.activeLabel')"
      />
      <UiEmpty
        v-else
        :title="$t('staff.metrics.now.noReadings')"
        :body="$t('staff.metrics.now.noReadingsBody')"
      >
        <template #icon><Activity aria-hidden="true" /></template>
      </UiEmpty>
    </UiPanel>

    <div class="grid items-start gap-6 lg:grid-cols-2">
      <UiPanel :title="$t('staff.metrics.activity.signups')">
        <template #actions>
          <UiBadge v-if="weekly" :title="$t('staff.metrics.activity.perWeekTitle')">{{
            $t('staff.metrics.activity.perWeek')
          }}</UiBadge>
          <span class="tabular font-mono text-sm text-text-muted">{{
            formatNumber(signupTotal)
          }}</span>
          <UiSegmented v-model="range" :options="ranges" :label="$t('staff.metrics.rangeLabel')" />
        </template>
        <StackedBars
          :days="signups"
          :series="signupSeries"
          :label="$t('staff.metrics.activity.signupsLabel')"
        />
      </UiPanel>
      <UiPanel :title="$t('staff.metrics.activity.uploads')">
        <template #actions>
          <span
            class="tabular font-mono text-sm text-text-muted"
            :title="$t('staff.metrics.activity.uploadedTitle')"
            >{{ formatBytes(uploadedBytes) }}</span
          >
          <UiSegmented
            v-model="figure"
            :options="figures"
            :label="$t('staff.metrics.activity.figure')"
          />
        </template>
        <StackedBars
          :days="data.uploads"
          :series="uploadSeries"
          :label="$t('staff.metrics.activity.uploadsLabel')"
        />
      </UiPanel>
    </div>

    <div class="grid items-start gap-6 md:grid-cols-2 xl:grid-cols-3">
      <UiPanel :title="$t('staff.metrics.activity.lastSeen')">
        <div
          class="mb-4 flex h-2.5 gap-0.5 overflow-hidden rounded-full"
          role="img"
          :aria-label="$t('staff.metrics.activity.lastSeenLabel')"
        >
          <span
            v-for="band in seen"
            :key="band.key"
            class="block h-full"
            :class="band.cls"
            :style="{ width: band.width }"
          />
        </div>
        <dl class="flex flex-col divide-y divide-border-subtle text-sm">
          <div
            v-for="band in seen"
            :key="band.key"
            class="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
          >
            <dt class="flex min-w-0 flex-1 items-center gap-1.5 text-text-secondary">
              <span class="size-2.5 shrink-0 rounded-sm" :class="band.cls" aria-hidden="true" />
              <span class="truncate">{{ band.label }}</span>
            </dt>
            <dd class="tabular font-mono font-medium">{{ formatNumber(band.n) }}</dd>
          </div>
        </dl>
      </UiPanel>

      <UiPanel :title="$t('staff.metrics.activity.capture')">
        <dl class="flex flex-col divide-y divide-border-subtle text-sm">
          <div
            v-for="row in [
              { key: 'devices', n: data.capture.devices },
              { key: 'captureUsers', n: data.capture.users },
              { key: 'seen24', n: data.capture.seen24h },
              { key: 'seen7', n: data.capture.seen7d },
              { key: 'new7', n: data.capture.new7d },
            ]"
            :key="row.key"
            class="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
          >
            <dt class="min-w-0 flex-1 truncate text-text-secondary">
              {{ $t(`staff.metrics.activity.${row.key}`) }}
            </dt>
            <dd class="tabular font-mono font-medium">{{ formatNumber(row.n) }}</dd>
          </div>
        </dl>
      </UiPanel>

      <UiPanel :title="$t('staff.metrics.activity.wishes')">
        <dl class="flex flex-col divide-y divide-border-subtle text-sm">
          <div class="flex items-center gap-3 pb-2.5">
            <dt class="min-w-0 flex-1 truncate text-text-secondary">
              {{ $t('staff.common.accounts') }}
            </dt>
            <dd class="tabular font-mono font-medium">
              {{ formatNumber(data.wishes.histories) }}
              <span class="font-normal text-text-muted"
                >/ {{ formatNumber(data.wishes.accounts) }}</span
              >
            </dd>
          </div>
          <div
            v-for="row in [
              { key: 'synced24', text: formatNumber(data.wishes.synced24h) },
              { key: 'synced7', text: formatNumber(data.wishes.synced7d) },
              { key: 'pulls', text: formatNumber(data.wishes.pulls) },
              { key: 'wishStored', text: formatBytes(data.wishes.bytes) },
            ]"
            :key="row.key"
            class="flex items-center gap-3 py-2.5 last:pb-0"
          >
            <dt class="min-w-0 flex-1 truncate text-text-secondary">
              {{ $t(`staff.metrics.activity.${row.key}`) }}
            </dt>
            <dd class="tabular font-mono font-medium">{{ row.text }}</dd>
          </div>
        </dl>
      </UiPanel>
    </div>
  </template>
</template>
