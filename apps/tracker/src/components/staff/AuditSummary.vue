<script setup lang="ts">
import { AUDIT_SUMMARY_SERIES } from '@gdt/shared'
import { computed } from 'vue'
import StackedBars from '@/components/staff/StackedBars.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import { api } from '@/api'
import { useResource } from '@/data/use-resource'
import { t } from '@/i18n'
import { formatNumber } from '@/lib/format'

/**
 * The audit log's last 30 days at a glance: staff actions per day by kind
 * (the legend writes each kind's total, so the bars never rest on colour),
 * and per staff member, the ID first.
 */
const { data } = useResource(
  () => true,
  () => api.staff.auditSummary(),
)

const COLORS: Record<(typeof AUDIT_SUMMARY_SERIES)[number], string> = {
  views: 'var(--chart-1)',
  users: 'var(--chart-4)',
  data: 'var(--chart-2)',
  deletes: 'var(--chart-5)',
  other: 'var(--chart-3)',
}
const series = computed(() =>
  AUDIT_SUMMARY_SERIES.map((key) => {
    const total = (data.value?.days ?? []).reduce((n, day) => n + (Number(day[key]) || 0), 0)
    return {
      key,
      label: `${t(`staff.audit.summary.${key}`)} ${formatNumber(total)}`,
      color: COLORS[key],
    }
  }),
)
</script>

<template>
  <div
    v-if="data && data.actors.length"
    class="grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]"
  >
    <UiPanel :title="$t('staff.audit.summary.title')">
      <template #actions>
        <span class="tabular font-mono text-sm text-text-muted">{{
          $t('staff.metrics.ranges.30d')
        }}</span>
      </template>
      <StackedBars :days="data.days" :series="series" :label="$t('staff.audit.summary.label')" />
    </UiPanel>
    <UiPanel :title="$t('staff.audit.summary.byStaff')" flush>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[22rem] text-sm">
          <thead
            class="border-b border-border-default bg-surface-overlay/50 text-text-secondary [&_th]:whitespace-nowrap"
          >
            <tr>
              <th scope="col" class="px-3 py-2 text-right font-medium">
                {{ $t('staff.common.id') }}
              </th>
              <th scope="col" class="px-3 py-2 text-left font-medium">
                {{ $t('staff.audit.summary.staff') }}
              </th>
              <th scope="col" class="px-3 py-2 text-right font-medium">
                {{ $t('staff.common.actions') }}
              </th>
              <th
                scope="col"
                class="px-3 py-2 text-right font-medium"
                :title="$t('staff.audit.summary.viewsTitle')"
              >
                {{ $t('staff.audit.summary.views') }}
              </th>
              <th scope="col" class="px-3 py-2 text-right font-medium">
                {{ $t('staff.audit.summary.deletes') }}
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border-subtle [&_td]:whitespace-nowrap">
            <tr v-for="actor in data.actors" :key="actor.id ?? actor.label">
              <td class="tabular px-3 py-1.5 text-right font-mono text-text-muted">
                {{ actor.id ?? '—' }}
              </td>
              <td class="max-w-48 truncate px-3 py-1.5 font-medium">{{ actor.label }}</td>
              <td class="tabular px-3 py-1.5 text-right font-mono">
                {{ formatNumber(actor.actions) }}
              </td>
              <td class="tabular px-3 py-1.5 text-right font-mono">
                {{ formatNumber(actor.views) }}
              </td>
              <td class="tabular px-3 py-1.5 text-right font-mono">
                {{ formatNumber(actor.deletes) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UiPanel>
  </div>
</template>
