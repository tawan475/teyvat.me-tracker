<script setup lang="ts">
import { D1_LIMIT_BYTES, JOURNAL_SORTS, type JournalSort } from '@gdt/shared'
import { Radio } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import StackedBars from '@/components/staff/StackedBars.vue'
import UserLink from '@/components/staff/UserLink.vue'
import { share } from '@/components/staff/metrics/series'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import UiError from '@/components/ui/UiError.vue'
import UiPager from '@/components/ui/UiPager.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiProgress from '@/components/ui/UiProgress.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import UiStat from '@/components/ui/UiStat.vue'
import { api } from '@/api'
import { useResource } from '@/data/use-resource'
import { vStickyHead } from '@/lib/sticky-head'
import { t } from '@/i18n'
import { formatBytes, formatDateTime, formatNumber, formatRelative } from '@/lib/format'
import { useSession } from '@/stores/session'

/**
 * Live sync: the open journals in the live database, how many are sending,
 * today's batches against the cap, the journals' health, and the journals
 * themselves (for staff who may see users), each opening in Inspect.
 */
const props = defineProps<{ refresh: number }>()
const emit = defineEmits<{ loaded: [at: number] }>()
const session = useSession()

const sort = ref<JournalSort>('last')
const page = ref(1)
watch(sort, () => (page.value = 1))

const { data, error, loading, reload } = useResource(
  () => ({ sort: sort.value, page: page.value, refresh: props.refresh }),
  ({ sort, page }) => api.staff.metricsLive({ sort, page }),
)
watch(data, (value) => value && emit('loaded', value.at))

const sorts = computed(() =>
  JOURNAL_SORTS.map((value) => ({ value, label: t(`staff.metrics.live.sorts.${value}`) })),
)
const daySeries = computed(() => [
  { key: 'accounts', label: t('staff.common.accounts'), color: 'var(--chart-1)' },
])
const pageCount = computed(() =>
  data.value ? Math.max(1, Math.ceil(data.value.total / data.value.pageSize)) : 1,
)
const canInspect = computed(() => session.can('data.inspect'))
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
        :label="$t('staff.metrics.live.open')"
        :value="data.journals"
        :hint="$t('staff.metrics.live.openHint')"
        exact
      >
        <span class="tabular truncate font-mono text-sm text-text-muted">{{
          $t('staff.metrics.live.ofAccounts', { n: formatNumber(data.accounts) })
        }}</span>
      </UiStat>
      <UiStat
        :label="$t('staff.metrics.live.active')"
        :value="data.active"
        :hint="$t('staff.metrics.now.inGameHint')"
        exact
      >
        <span class="tabular truncate font-mono text-sm text-text-muted">{{
          $t('staff.metrics.live.activeSub')
        }}</span>
      </UiStat>
      <UiStat
        :label="$t('staff.metrics.now.batches')"
        :value="data.batchesToday"
        :hint="$t('staff.metrics.now.batchesHint')"
        exact
      >
        <span class="tabular truncate font-mono text-sm text-text-muted">{{
          $t('staff.metrics.live.accountsToday', { n: formatNumber(data.accountsToday) })
        }}</span>
      </UiStat>
      <UiStat
        :label="$t('staff.metrics.live.data')"
        :value="formatBytes(data.bytes)"
        :hint="$t('staff.metrics.live.dataHint')"
      >
        <span class="tabular truncate font-mono text-sm text-text-muted">{{
          $t('staff.common.d1Share', { share: share(data.bytes, D1_LIMIT_BYTES) })
        }}</span>
      </UiStat>
    </div>

    <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <UiPanel :title="$t('staff.metrics.live.daysTitle')">
        <StackedBars
          :days="data.days"
          :series="daySeries"
          :label="$t('staff.metrics.live.daysLabel')"
        />
      </UiPanel>
      <UiPanel :title="$t('staff.metrics.live.health')">
        <dl class="flex flex-col divide-y divide-border-subtle text-sm">
          <div class="flex items-center gap-3 pb-2.5">
            <dt class="min-w-0 flex-1 truncate text-text-secondary">
              <span :title="$t('staff.metrics.live.tailTitle')">{{
                $t('staff.metrics.live.tailChanges')
              }}</span>
            </dt>
            <dd class="tabular font-mono font-medium">
              {{ formatNumber(data.health.tailChanges) }}
            </dd>
          </div>
          <div class="flex items-center gap-3 py-2.5">
            <dt class="min-w-0 flex-1 truncate text-text-secondary">
              <span :title="$t('staff.metrics.live.spilledTitle')">{{
                $t('staff.metrics.live.spilled')
              }}</span>
            </dt>
            <dd class="tabular font-mono font-medium">
              {{ formatNumber(data.health.spilledRows) }}
            </dd>
          </div>
          <div class="flex items-center gap-3 py-2.5">
            <dt class="min-w-0 flex-1 truncate text-text-secondary">
              <span
                :title="$t('staff.metrics.live.atCapTitle', { cap: formatNumber(data.dailyCap) })"
                >{{ $t('staff.metrics.live.atCap') }}</span
              >
            </dt>
            <dd
              class="tabular font-mono font-medium"
              :class="data.health.atCap ? 'text-warning-text' : ''"
            >
              {{ formatNumber(data.health.atCap) }}
              <span class="font-normal text-text-muted">/ {{ formatNumber(data.journals) }}</span>
            </dd>
          </div>
          <div class="flex items-center gap-3 py-2.5">
            <dt class="min-w-0 flex-1 truncate text-text-secondary">
              {{ $t('staff.metrics.live.oldest') }}
            </dt>
            <dd
              class="tabular font-mono font-medium"
              :title="
                data.health.oldestOpenedAt ? formatDateTime(data.health.oldestOpenedAt) : undefined
              "
            >
              {{ data.health.oldestOpenedAt ? formatRelative(data.health.oldestOpenedAt) : '—' }}
            </dd>
          </div>
          <div
            v-for="row in [
              { key: 'resyncs', value: data.health.resyncs24h },
              { key: 'refused', value: data.health.capRefusals24h },
            ]"
            :key="row.key"
            class="flex items-center gap-3 py-2.5 last:pb-0"
          >
            <dt class="min-w-0 flex-1 truncate text-text-secondary">
              <span :title="$t(`staff.metrics.live.${row.key}Title`)">{{
                $t(`staff.metrics.live.${row.key}`)
              }}</span>
            </dt>
            <dd class="tabular font-mono font-medium">
              <template v-if="row.value !== null">{{ formatNumber(row.value) }}</template>
              <UiBadge v-else :title="$t('staff.metrics.live.needsTokenTitle')">{{
                $t('staff.metrics.live.needsToken')
              }}</UiBadge>
            </dd>
          </div>
        </dl>
      </UiPanel>
    </div>

    <UiPanel v-if="data.rows" :title="$t('staff.metrics.live.journals')" flush>
      <template #actions>
        <UiSegmented v-model="sort" :options="sorts" :label="$t('staff.common.sort')" />
      </template>
      <UiEmpty v-if="data.rows.length === 0" :title="$t('staff.metrics.live.none')">
        <template #icon><Radio aria-hidden="true" /></template>
      </UiEmpty>
      <template v-else>
        <div class="overflow-x-auto" :aria-busy="loading">
          <table class="w-full min-w-[64rem] text-sm">
            <thead
              v-sticky-head
              class="border-b border-border-default bg-surface-overlay/50 text-text-secondary [&_th]:whitespace-nowrap"
            >
              <tr>
                <th scope="col" class="px-3 py-2 text-right font-medium">
                  {{ $t('staff.common.id') }}
                </th>
                <th scope="col" class="px-3 py-2 text-left font-medium">
                  {{ $t('staff.metrics.online.account') }}
                </th>
                <th scope="col" class="px-3 py-2 text-left font-medium">
                  {{ $t('staff.metrics.live.owner') }}
                </th>
                <th
                  scope="col"
                  class="px-3 py-2 text-right font-medium"
                  :title="$t('staff.metrics.live.openedTitle')"
                >
                  {{ $t('staff.metrics.live.opened') }}
                </th>
                <th
                  scope="col"
                  class="px-3 py-2 text-right font-medium"
                  :class="sort === 'last' ? 'text-text-primary' : ''"
                >
                  {{ $t('staff.metrics.lastBatch') }}
                </th>
                <th
                  scope="col"
                  class="px-3 py-2 text-right font-medium"
                  :title="$t('staff.metrics.live.seqTitle')"
                >
                  {{ $t('staff.metrics.live.seq') }}
                </th>
                <th
                  scope="col"
                  class="px-3 py-2 text-right font-medium"
                  :class="sort === 'today' ? 'text-text-primary' : ''"
                  :title="
                    $t('staff.metrics.online.liveTodayTitle', { cap: formatNumber(data.dailyCap) })
                  "
                >
                  {{ $t('staff.metrics.live.today') }}
                </th>
                <th
                  scope="col"
                  class="px-3 py-2 text-right font-medium"
                  :title="$t('staff.metrics.live.changesTitle')"
                >
                  {{ $t('staff.metrics.live.changes') }}
                </th>
                <th
                  scope="col"
                  class="px-3 py-2 text-right font-medium"
                  :class="sort === 'size' ? 'text-text-primary' : ''"
                >
                  {{ $t('staff.metrics.live.size') }}
                </th>
                <th v-if="canInspect" scope="col" class="px-3 py-2">
                  <span class="sr-only">{{ $t('staff.common.actions') }}</span>
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border-subtle [&_td]:whitespace-nowrap">
              <tr v-for="row in data.rows" :key="row.accountId" class="hover:bg-surface-overlay/60">
                <td class="tabular px-3 py-1.5 text-right font-mono text-text-muted">
                  {{ row.accountId }}
                </td>
                <td class="px-3 py-1.5" :title="row.name ?? undefined">
                  <span class="inline-flex items-center gap-1.5">
                    <span class="font-code text-[0.8125rem]">{{ row.uid ?? '—' }}</span>
                    <UiBadge v-if="row.server" mono>{{ row.server }}</UiBadge>
                  </span>
                </td>
                <td class="max-w-56 px-3 py-1.5"><UserLink :user="row.owner" /></td>
                <td
                  class="tabular px-3 py-1.5 text-right font-mono"
                  :title="formatDateTime(row.openedAt)"
                >
                  {{ formatRelative(row.openedAt) }}
                </td>
                <td
                  class="tabular px-3 py-1.5 text-right font-mono"
                  :title="formatDateTime(row.updatedAt)"
                >
                  {{ formatRelative(row.updatedAt) }}
                </td>
                <td class="tabular px-3 py-1.5 text-right font-mono">
                  {{ formatNumber(row.seq) }}
                </td>
                <td class="tabular px-3 py-1.5 text-right font-mono">
                  <span class="inline-flex items-center justify-end gap-2">
                    {{ formatNumber(row.today) }}
                    <span class="block w-16 shrink-0">
                      <UiProgress
                        :value="row.today"
                        :max="data.dailyCap"
                        :label="$t('staff.metrics.live.today')"
                      />
                    </span>
                  </span>
                </td>
                <td class="tabular px-3 py-1.5 text-right font-mono">
                  {{ formatNumber(row.changes) }}
                </td>
                <td class="tabular px-3 py-1.5 text-right font-mono">
                  {{ formatBytes(row.bytes) }}
                </td>
                <td v-if="canInspect" class="px-3 py-1.5 text-right">
                  <UiButton
                    variant="ghost"
                    size="sm"
                    :to="{ name: 'staff-inspect-overview', params: { accountId: row.accountId } }"
                    :title="$t('staff.inspect.loggedTitle')"
                  >
                    {{ $t('staff.metrics.live.inspect') }}
                  </UiButton>
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
          :label="$t('staff.metrics.live.journals')"
        />
      </template>
    </UiPanel>
  </template>
</template>
