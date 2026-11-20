<script setup lang="ts">
import { ALERT_KINDS } from '@gdt/shared'
import { computed, watch } from 'vue'
import StatList, { type StatRow } from '@/components/staff/StatList.vue'
import { share } from '@/components/staff/metrics/series'
import UiError from '@/components/ui/UiError.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiProgress from '@/components/ui/UiProgress.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import { api } from '@/api'
import { useResource } from '@/data/use-resource'
import { t } from '@/i18n'
import { formatNumber, formatRelative } from '@/lib/format'

/**
 * Features: how many accounts use each part of the site and how many
 * changed it in the last week, then sharing, alerts and push, and the
 * public API's tokens.
 */
const props = defineProps<{ refresh: number }>()
const emit = defineEmits<{ loaded: [at: number] }>()

const { data, error, reload } = useResource(
  () => props.refresh,
  () => api.staff.insightsFeatures(),
)
watch(data, (value) => value && emit('loaded', value.at))

const row = (group: string, key: string, n: number, extra: Partial<StatRow> = {}): StatRow => ({
  key,
  label: t(`staff.insights.features.${group}.${key}`),
  value: formatNumber(n),
  ...extra,
})

const sharing = computed<StatRow[]>(() => {
  const s = data.value?.sharing
  if (!s) return []
  return [
    row('sharing', 'accounts', s.accounts),
    row('sharing', 'viewers', s.viewers),
    row('sharing', 'editors', s.editors),
    row('sharing', 'pending', s.pending, { title: t('staff.insights.features.sharing.pendingTitle') }),
    row('sharing', 'largest', s.largest, { title: t('staff.insights.features.sharing.largestTitle') }),
  ]
})
const alerts = computed<StatRow[]>(() => {
  const a = data.value?.alerts
  if (!a) return []
  return [
    row('alerts', 'devices', a.devices),
    ...ALERT_KINDS.map((kind) => row('alertKinds', kind, a.kinds[kind])),
    row('alerts', 'subscriptions', a.subscriptions),
    row('alerts', 'failing', a.failing, {
      title: t('staff.insights.features.alerts.failingTitle'),
      warn: a.failing > 0,
      note: a.failing > 0 ? share(a.failing, a.subscriptions) : undefined,
    }),
    {
      key: 'lastOk',
      label: t('staff.insights.features.alerts.lastOk'),
      value: a.lastOkAt ? formatRelative(a.lastOkAt) : '—',
    },
  ]
})
const tokens = computed<StatRow[]>(() => {
  const a = data.value?.api
  if (!a) return []
  return [
    row('api', 'tokens', a.tokens, {
      note: t('staff.insights.features.api.byUsers', { n: formatNumber(a.users) }),
    }),
    row('api', 'used24h', a.used24h),
    row('api', 'used7d', a.used7d),
    row('api', 'write', a.write, { title: t('staff.insights.features.api.writeTitle') }),
    row('api', 'expiring', a.expiring, { title: t('staff.insights.features.api.expiringTitle') }),
    row('api', 'revoked', a.revoked),
    row('api', 'supporters', a.supporters),
    row('api', 'customLimits', a.customLimits),
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
    <UiSkeleton class="h-80" />
  </div>

  <template v-else>
    <UiPanel :title="$t('staff.insights.features.title')" flush>
      <template #actions>
        <span class="tabular font-mono text-sm text-text-muted">{{
          $t('staff.metrics.live.ofAccounts', { n: formatNumber(data.accounts) })
        }}</span>
      </template>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[40rem] text-sm">
          <thead
            class="border-b border-border-default bg-surface-overlay/50 text-text-secondary [&_th]:whitespace-nowrap"
          >
            <tr>
              <th scope="col" class="px-3 py-2 text-left font-medium">
                {{ $t('staff.insights.features.feature') }}
              </th>
              <th scope="col" class="px-3 py-2 text-right font-medium">
                {{ $t('staff.common.accounts') }}
              </th>
              <th scope="col" class="w-[34%] px-3 py-2">
                <span class="sr-only">{{ $t('staff.insights.share') }}</span>
              </th>
              <th
                scope="col"
                class="px-3 py-2 text-right font-medium"
                :title="$t('staff.insights.features.changedTitle')"
              >
                {{ $t('staff.insights.features.changed') }}
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border-subtle [&_td]:whitespace-nowrap">
            <tr v-for="f in data.features" :key="f.key" class="hover:bg-surface-overlay/60">
              <th scope="row" class="px-3 py-2 text-left font-medium">
                {{ $t(`staff.insights.features.names.${f.key}`) }}
              </th>
              <td class="tabular px-3 py-2 text-right font-mono">{{ formatNumber(f.accounts) }}</td>
              <td class="px-3 py-2">
                <span class="flex items-center gap-2">
                  <UiProgress
                    class="flex-1"
                    :value="f.accounts"
                    :max="data.accounts"
                    :label="$t(`staff.insights.features.names.${f.key}`)"
                  />
                  <span class="tabular w-12 text-right font-mono text-text-muted">{{
                    share(f.accounts, data.accounts)
                  }}</span>
                </span>
              </td>
              <td class="tabular px-3 py-2 text-right font-mono">
                {{ formatNumber(f.changed7d) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UiPanel>

    <div class="grid items-start gap-6 md:grid-cols-2 xl:grid-cols-3">
      <UiPanel :title="$t('staff.insights.features.sharing.title')">
        <StatList :rows="sharing" />
      </UiPanel>
      <UiPanel :title="$t('staff.insights.features.alerts.title')">
        <StatList :rows="alerts" />
      </UiPanel>
      <UiPanel :title="$t('staff.insights.features.api.title')">
        <StatList :rows="tokens" />
      </UiPanel>
    </div>
  </template>
</template>
