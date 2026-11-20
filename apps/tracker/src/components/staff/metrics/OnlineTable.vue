<script setup lang="ts">
import { ONLINE_FILTERS, type OnlineFilter, type StaffOnlineRow } from '@gdt/shared'
import { Clock, Lock, Pause, Play, Users } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import UserLink from '@/components/staff/UserLink.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import UiError from '@/components/ui/UiError.vue'
import UiPager from '@/components/ui/UiPager.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiProgress from '@/components/ui/UiProgress.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import { api } from '@/api'
import { useResource } from '@/data/use-resource'
import { t } from '@/i18n'
import { formatDateTime, formatNumber, formatRelative } from '@/lib/format'

/**
 * Who has the site open or a client program running: one row per user, the
 * ID first. Capture's state is a mark and a word (in game, game closed,
 * heard from), never a colour alone; device, program and version are each
 * their own column. The device's name shows only to staff who may see
 * private details.
 */
const props = defineProps<{ refresh: number }>()

const filter = ref<OnlineFilter>('all')
const page = ref(1)
watch(filter, () => (page.value = 1))

const { data, error, loading, reload } = useResource(
  () => ({ filter: filter.value, page: page.value, refresh: props.refresh }),
  ({ filter, page }) => api.staff.metricsOnline({ filter, page }),
)

const filters = computed(() =>
  ONLINE_FILTERS.map((value) => ({
    value,
    label: t(`staff.metrics.online.filters.${value}`),
    title: t(`staff.metrics.online.filterTitles.${value}`),
    count: data.value?.counts[value],
  })),
)
const pageCount = computed(() =>
  data.value ? Math.max(1, Math.ceil(data.value.total / data.value.pageSize)) : 1,
)

const STATE = {
  decoding: { icon: Play, tone: 'accent', key: 'inGame' },
  running: { icon: Pause, tone: 'neutral', key: 'gameClosed' },
  seen: { icon: Clock, tone: 'neutral', key: 'seen' },
} as const

function stateTitle(row: StaffOnlineRow): string {
  const capture = row.capture!
  return t(`staff.metrics.online.stateTitles.${capture.state}`, {
    when: formatDateTime(capture.at),
  })
}
</script>

<template>
  <UiPanel :title="$t('staff.metrics.online.title')" flush>
    <template #actions>
      <UiSegmented
        v-model="filter"
        :options="filters"
        :label="$t('staff.metrics.online.filterLabel')"
      />
    </template>

    <UiError
      v-if="error && !data"
      :error="error"
      :title="$t('staff.common.couldNotLoad')"
      @retry="reload"
    />
    <div v-else-if="!data" class="flex flex-col gap-2 p-5" aria-busy="true">
      <UiSkeleton v-for="n in 5" :key="n" class="h-10" />
    </div>
    <UiEmpty v-else-if="data.rows.length === 0" :title="$t('staff.metrics.online.nobody')">
      <template #icon><Users aria-hidden="true" /></template>
    </UiEmpty>

    <template v-else>
      <div class="overflow-x-auto" :aria-busy="loading">
        <table class="w-full min-w-[66rem] text-sm">
          <thead
            v-sticky-head
            class="border-b border-border-default bg-surface-overlay/50 text-text-secondary [&_th]:whitespace-nowrap"
          >
            <tr>
              <th scope="col" class="px-3 py-2 text-right font-medium">
                {{ $t('staff.common.id') }}
              </th>
              <th scope="col" class="px-3 py-2 text-left font-medium">
                {{ $t('staff.common.user') }}
              </th>
              <th
                scope="col"
                class="px-3 py-2 text-left font-medium"
                :title="$t('staff.metrics.online.siteTitle')"
              >
                {{ $t('staff.metrics.online.site') }}
              </th>
              <th
                scope="col"
                class="px-3 py-2 text-left font-medium"
                :title="$t('staff.metrics.online.captureTitle')"
              >
                {{ $t('staff.metrics.online.capture') }}
              </th>
              <th
                scope="col"
                class="px-3 py-2 text-left font-medium"
                :title="$t('staff.metrics.online.deviceTitle')"
              >
                {{ $t('staff.metrics.online.device') }}
              </th>
              <th
                scope="col"
                class="px-3 py-2 text-left font-medium"
                :title="$t('staff.metrics.online.programTitle')"
              >
                {{ $t('staff.metrics.online.program') }}
              </th>
              <th
                scope="col"
                class="px-3 py-2 text-left font-medium"
                :title="$t('staff.metrics.online.versionTitle')"
              >
                {{ $t('staff.metrics.online.version') }}
              </th>
              <th scope="col" class="px-3 py-2 text-left font-medium">
                {{ $t('staff.metrics.online.account') }}
              </th>
              <th
                scope="col"
                class="px-3 py-2 text-right font-medium"
                :title="
                  $t('staff.metrics.online.liveTodayTitle', { cap: formatNumber(data.dailyCap) })
                "
              >
                {{ $t('staff.metrics.online.liveToday') }}
              </th>
              <th scope="col" class="px-3 py-2 text-right font-medium">
                {{ $t('staff.metrics.lastBatch') }}
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border-subtle [&_td]:whitespace-nowrap">
            <tr v-for="row in data.rows" :key="row.id" class="hover:bg-surface-overlay/60">
              <td class="tabular px-3 py-2 text-right font-mono text-text-muted">{{ row.id }}</td>
              <td class="max-w-56 px-3 py-2"><UserLink :user="row" no-id /></td>
              <td class="px-3 py-2">
                <span
                  v-if="row.siteSince !== null"
                  class="tabular inline-flex items-center gap-1.5"
                  :title="
                    $t('staff.metrics.online.openSince', { when: formatDateTime(row.siteSince) })
                  "
                >
                  <span class="size-2 shrink-0 rounded-full bg-success-text" aria-hidden="true" />
                  {{ formatRelative(row.siteSince) }}
                </span>
                <span v-else class="text-text-muted">{{ $t('staff.metrics.online.notOpen') }}</span>
              </td>
              <td class="px-3 py-2">
                <UiBadge
                  v-if="row.capture"
                  :tone="STATE[row.capture.state].tone"
                  :title="stateTitle(row)"
                >
                  <component
                    :is="STATE[row.capture.state].icon"
                    class="size-3"
                    aria-hidden="true"
                  />
                  {{ $t(`staff.metrics.online.states.${STATE[row.capture.state].key}`) }}
                </UiBadge>
                <span v-else class="text-text-muted">{{
                  $t('staff.metrics.online.notRunning')
                }}</span>
              </td>
              <td class="max-w-48 truncate px-3 py-2">
                <template v-if="row.capture">
                  <span v-if="row.capture.device">{{ row.capture.device }}</span>
                  <span
                    v-else
                    class="inline-flex items-center gap-1 text-text-muted"
                    :title="$t('staff.metrics.online.hiddenTitle')"
                  >
                    <Lock class="size-3.5" aria-hidden="true" />
                    {{ $t('staff.metrics.online.hidden') }}
                  </span>
                </template>
                <span v-else class="text-text-muted">—</span>
              </td>
              <td class="px-3 py-2">
                <span v-if="row.capture?.program" class="font-code text-[0.8125rem]">{{
                  row.capture.program
                }}</span>
                <span
                  v-else-if="row.capture"
                  class="text-text-muted"
                  :title="$t('staff.metrics.online.importKeyTitle')"
                  >{{ $t('staff.metrics.online.importKey') }}</span
                >
                <span v-else class="text-text-muted">—</span>
              </td>
              <td class="px-3 py-2">
                <span v-if="row.capture?.version" class="font-code text-[0.8125rem]">{{
                  row.capture.version
                }}</span>
                <span v-else class="text-text-muted">—</span>
              </td>
              <td class="px-3 py-2" :title="row.account?.name ?? undefined">
                <span v-if="row.account" class="inline-flex items-center gap-1.5">
                  <span class="font-code text-[0.8125rem]">{{ row.account.uid ?? '—' }}</span>
                  <UiBadge v-if="row.account.server" mono>{{ row.account.server }}</UiBadge>
                </span>
                <span v-else class="text-text-muted">—</span>
              </td>
              <td class="tabular px-3 py-2 text-right font-mono">
                <span class="inline-flex items-center justify-end gap-2">
                  {{ formatNumber(row.batchesToday) }}
                  <span class="block w-16 shrink-0">
                    <UiProgress
                      :value="row.batchesToday"
                      :max="data.dailyCap"
                      :label="$t('staff.metrics.online.liveToday')"
                    />
                  </span>
                </span>
              </td>
              <td
                class="tabular px-3 py-2 text-right font-mono"
                :title="row.lastBatchAt ? formatDateTime(row.lastBatchAt) : undefined"
              >
                <template v-if="row.lastBatchAt">{{ formatRelative(row.lastBatchAt) }}</template>
                <span v-else class="text-text-muted">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <UiPager
        v-if="pageCount > 1"
        v-model="page"
        class="border-t border-border-default px-3 py-2"
        :page-count="pageCount"
        :total="data.total"
        :page-size="data.pageSize"
        :label="$t('staff.metrics.online.title')"
      />
    </template>
  </UiPanel>
</template>
