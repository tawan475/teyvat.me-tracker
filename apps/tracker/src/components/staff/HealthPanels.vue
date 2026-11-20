<script setup lang="ts">
import type { JobRun } from '@gdt/shared'
import { TriangleAlert } from 'lucide-vue-next'
import { computed } from 'vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import { api } from '@/api'
import { useResource } from '@/data/use-resource'
import { t } from '@/i18n'
import { formatDateTime, formatNumber, formatRelative } from '@/lib/format'

/**
 * The staff Overview's health panels: which features are switched on (each
 * with the word On, Off or Paused, never a colour alone), when the hourly
 * reading last ran, and what each scheduled job did on its last runs. A job
 * that failed carries a warning mark and its error.
 */
const { data } = useResource(
  () => true,
  () => api.staff.health(),
)

const switches = computed(() => {
  const f = data.value?.features
  if (!f) return []
  const on = (value: boolean) => ({
    text: value ? t('staff.common.on') : t('staff.common.off'),
    tone: value ? ('success' as const) : ('neutral' as const),
  })
  return [
    // The human check, Discord, Google and email are on the Site panel above.
    { key: 'push', ...on(f.push) },
    { key: 'liveDb', ...on(f.liveDb) },
    { key: 'usage', ...on(f.usage) },
    { key: 'usageZone', ...on(f.usageZone) },
  ].map((row) => ({
    ...row,
    label: t(`staff.health.${row.key}`),
    title: t(`staff.health.${row.key}Title`),
  }))
})

const seconds = (ms: number) =>
  t('staff.health.took', { n: (ms / 1000).toFixed(ms < 10_000 ? 1 : 0) })

/** A run's result in a few words: its counts, or its error. */
function summary(run: JobRun): string {
  const d = run.detail
  if (typeof d.error === 'string') return d.error
  const parts: string[] = []
  const walk = (value: unknown, name?: string) => {
    if (typeof value === 'number' && name) {
      if (value > 0) parts.push(`${formatNumber(value)} ${name}`)
    } else if (Array.isArray(value)) {
      for (const item of value) if (typeof item === 'string') parts.push(item)
    } else if (value && typeof value === 'object') {
      for (const [key, inner] of Object.entries(value)) walk(inner, key)
    }
  }
  walk(d)
  return parts.slice(0, 6).join(' · ')
}
</script>

<template>
  <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
    <UiPanel :title="$t('staff.health.title')">
      <UiSkeleton v-if="!data" class="h-48" />
      <dl v-else class="flex flex-col divide-y divide-border-subtle text-sm">
        <div
          v-for="row in switches"
          :key="row.key"
          class="flex items-center gap-3 py-2.5 first:pt-0"
        >
          <dt class="min-w-0 flex-1 truncate text-text-secondary">
            <span :title="row.title">{{ row.label }}</span>
          </dt>
          <dd>
            <UiBadge :tone="row.tone">{{ row.text }}</UiBadge>
          </dd>
        </div>
        <div class="flex items-center gap-3 pt-2.5">
          <dt class="min-w-0 flex-1 truncate text-text-secondary">
            <span :title="$t('staff.health.lastSampleTitle')">{{
              $t('staff.health.lastSample')
            }}</span>
          </dt>
          <dd
            class="tabular font-mono font-medium"
            :title="data.lastSampleAt ? formatDateTime(data.lastSampleAt) : undefined"
          >
            {{ data.lastSampleAt ? formatRelative(data.lastSampleAt) : $t('staff.health.never') }}
          </dd>
        </div>
      </dl>
    </UiPanel>

    <UiPanel :title="$t('staff.health.jobs')" flush>
      <div v-if="!data" class="p-5"><UiSkeleton class="h-48" /></div>
      <p v-else-if="data.jobs.length === 0" class="p-5 text-sm text-text-muted">
        {{ $t('staff.health.noRuns') }}
      </p>
      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[32rem] text-sm">
          <thead
            class="border-b border-border-default bg-surface-overlay/50 text-text-secondary [&_th]:whitespace-nowrap"
          >
            <tr>
              <th scope="col" class="px-3 py-2 text-left font-medium">
                {{ $t('staff.health.job') }}
              </th>
              <th scope="col" class="px-3 py-2 text-right font-medium">
                {{ $t('staff.health.ran') }}
              </th>
              <th scope="col" class="px-3 py-2 text-right font-medium">
                {{ $t('staff.health.tookHead') }}
              </th>
              <th scope="col" class="px-3 py-2 text-left font-medium">
                {{ $t('staff.health.result') }}
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border-subtle">
            <tr v-for="run in data.jobs" :key="run.id">
              <th scope="row" class="px-3 py-2 text-left font-medium whitespace-nowrap">
                {{ $t(`staff.health.jobNames.${run.job}`) }}
              </th>
              <td
                class="tabular px-3 py-2 text-right font-mono whitespace-nowrap"
                :title="formatDateTime(run.startedAt)"
              >
                {{ formatRelative(run.startedAt) }}
              </td>
              <td class="tabular px-3 py-2 text-right font-mono whitespace-nowrap">
                {{ seconds(run.tookMs) }}
              </td>
              <td class="px-3 py-2">
                <span class="flex min-w-0 items-center gap-2">
                  <UiBadge :tone="run.ok ? 'success' : 'warning'">
                    <TriangleAlert v-if="!run.ok" class="size-3" aria-hidden="true" />
                    {{ run.ok ? $t('staff.health.done') : $t('staff.health.failed') }}
                  </UiBadge>
                  <span class="truncate text-xs text-text-muted" :title="summary(run)">{{
                    summary(run)
                  }}</span>
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UiPanel>
  </div>
</template>
