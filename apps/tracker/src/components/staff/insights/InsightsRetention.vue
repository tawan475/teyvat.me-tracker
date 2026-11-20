<script setup lang="ts">
import { computed, watch } from 'vue'
import StatList, { type StatRow } from '@/components/staff/StatList.vue'
import { share } from '@/components/staff/metrics/series'
import UiError from '@/components/ui/UiError.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import { api } from '@/api'
import { useResource } from '@/data/use-resource'
import { t } from '@/i18n'
import { dateFormat, formatMonthDay, formatNumber } from '@/lib/format'

/**
 * Retention: each sign-up week as a row, the weeks since as columns, and in
 * each cell the share of that week's sign-ups who still stored a snapshot.
 * A cell's shade follows its share (lightness, one colour) and the number
 * is always written, so the grid reads without colour. Beside it, how many
 * of each sign-up month were seen lately, and how many sign-ups came with a
 * guest account.
 */
const props = defineProps<{ refresh: number }>()
const emit = defineEmits<{ loaded: [at: number] }>()

const { data, error, reload } = useResource(
  () => props.refresh,
  () => api.staff.insightsRetention(),
)
watch(data, (value) => value && emit('loaded', value.at))

const follow = computed(() => data.value?.cohorts[0]?.active.length ?? 0)
const cohorts = computed(() =>
  (data.value?.cohorts ?? []).map((cohort) => ({
    week: cohort.week,
    label: formatMonthDay(Date.parse(`${cohort.week}T12:00:00Z`)),
    users: cohort.users,
    cells: cohort.active.map((active, k) => {
      if (active === null || cohort.users === 0) return { k, text: '', title: undefined, style: {} }
      const percent = (active / cohort.users) * 100
      return {
        k,
        text: `${Math.round(percent)}%`,
        title: t('staff.insights.retention.cellTitle', {
          n: formatNumber(active),
          of: formatNumber(cohort.users),
        }),
        style: {
          backgroundColor: `color-mix(in oklab, var(--accent) ${Math.round(percent * 0.32)}%, transparent)`,
        },
      }
    }),
  })),
)

const month = (key: string) =>
  dateFormat({ month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    Date.parse(`${key}-15T12:00:00Z`),
  )

const guests = computed<StatRow[]>(() => {
  const g = data.value?.guests
  if (!g) return []
  return [
    { key: 'signups', label: t('staff.metrics.activity.signups'), value: formatNumber(g.signups) },
    {
      key: 'fromGuest',
      label: t('staff.insights.retention.fromGuest'),
      title: t('staff.insights.retention.fromGuestTitle'),
      value: formatNumber(g.fromGuest),
      note: share(g.fromGuest, g.signups),
    },
    {
      key: 'stillActive',
      label: t('staff.insights.retention.stillActive'),
      title: t('staff.insights.retention.stillActiveTitle'),
      value: formatNumber(g.stillActive),
      note: share(g.stillActive, g.fromGuest),
    },
  ]
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
    <UiSkeleton class="h-96" />
  </div>

  <template v-else>
    <UiPanel :title="$t('staff.insights.retention.title')" flush>
      <template #actions>
        <span
          class="tabular font-mono text-sm text-text-muted"
          :title="$t('staff.insights.retention.ruleTitle')"
          >{{ $t('staff.insights.retention.rule') }}</span
        >
      </template>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[48rem] text-sm">
          <thead
            class="border-b border-border-default bg-surface-overlay/50 text-text-secondary [&_th]:whitespace-nowrap"
          >
            <tr>
              <th scope="col" class="px-3 py-2 text-left font-medium">
                {{ $t('staff.insights.retention.signedUp') }}
              </th>
              <th scope="col" class="px-3 py-2 text-right font-medium">
                {{ $t('staff.overview.users') }}
              </th>
              <th
                v-for="k in follow"
                :key="k"
                scope="col"
                class="px-3 py-2 text-right font-medium"
                :title="$t('staff.insights.retention.weekTitle', { n: k - 1 })"
              >
                {{ $t('staff.insights.retention.week', { n: k - 1 }) }}
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border-subtle [&_td]:whitespace-nowrap">
            <tr v-for="cohort in cohorts" :key="cohort.week">
              <th scope="row" class="px-3 py-2 text-left font-normal">{{ cohort.label }}</th>
              <td class="tabular px-3 py-2 text-right font-mono">
                {{ formatNumber(cohort.users) }}
              </td>
              <td
                v-for="cell in cohort.cells"
                :key="cell.k"
                class="tabular px-3 py-2 text-right font-mono"
                :style="cell.style"
                :title="cell.title"
              >
                {{ cell.text }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UiPanel>

    <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <UiPanel :title="$t('staff.insights.retention.months')" flush>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[26rem] text-sm">
            <thead
              class="border-b border-border-default bg-surface-overlay/50 text-text-secondary [&_th]:whitespace-nowrap"
            >
              <tr>
                <th scope="col" class="px-3 py-2 text-left font-medium">
                  {{ $t('staff.insights.retention.signedUp') }}
                </th>
                <th scope="col" class="px-3 py-2 text-right font-medium">
                  {{ $t('staff.overview.users') }}
                </th>
                <th scope="col" class="px-3 py-2 text-right font-medium">
                  {{ $t('staff.metrics.activity.seen7') }}
                </th>
                <th scope="col" class="px-3 py-2 text-right font-medium">
                  {{ $t('staff.insights.retention.seen30') }}
                </th>
                <th
                  scope="col"
                  class="px-3 py-2 text-right font-medium"
                  :title="$t('staff.insights.retention.goneTitle')"
                >
                  {{ $t('staff.insights.retention.gone') }}
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border-subtle [&_td]:whitespace-nowrap">
              <tr v-for="row in data.months" :key="row.month">
                <th scope="row" class="px-3 py-2 text-left font-normal">{{ month(row.month) }}</th>
                <td class="tabular px-3 py-2 text-right font-mono">
                  {{ formatNumber(row.users) }}
                </td>
                <td class="tabular px-3 py-2 text-right font-mono">
                  {{ formatNumber(row.seen7d) }}
                  <span class="text-text-muted">{{ share(row.seen7d, row.users) }}</span>
                </td>
                <td class="tabular px-3 py-2 text-right font-mono">
                  {{ formatNumber(row.seen30d) }}
                  <span class="text-text-muted">{{ share(row.seen30d, row.users) }}</span>
                </td>
                <td class="tabular px-3 py-2 text-right font-mono">
                  {{ formatNumber(row.users - row.seen30d) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UiPanel>
      <UiPanel :title="$t('staff.insights.retention.guests')">
        <template #actions>
          <span class="tabular font-mono text-sm text-text-muted">{{
            $t('staff.metrics.ranges.30d')
          }}</span>
        </template>
        <StatList :rows="guests" />
      </UiPanel>
    </div>
  </template>
</template>
