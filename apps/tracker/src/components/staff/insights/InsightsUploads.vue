<script setup lang="ts">
import { computed, watch } from 'vue'
import StatList, { type StatRow } from '@/components/staff/StatList.vue'
import { share } from '@/components/staff/metrics/series'
import UiError from '@/components/ui/UiError.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import UiStat from '@/components/ui/UiStat.vue'
import { api } from '@/api'
import { useResource } from '@/data/use-resource'
import { t, te } from '@/i18n'
import { formatBytes, formatNumber } from '@/lib/format'

/**
 * Uploads: who runs into a limit (the daily caps, the quota, a staff block),
 * and what the last day's snapshots came from: the program each file names,
 * and why a client sent it.
 */
const props = defineProps<{ refresh: number }>()
const emit = defineEmits<{ loaded: [at: number] }>()

const { data, error, reload } = useResource(
  () => props.refresh,
  () => api.staff.insightsUploads(),
)
watch(data, (value) => value && emit('loaded', value.at))

const sources = computed<StatRow[]>(() =>
  (data.value?.sources ?? []).map((row) => ({
    key: row.key,
    label: row.key,
    code: true,
    value: formatNumber(row.snapshots),
    note: share(row.snapshots, data.value?.sampled ?? 0),
  })),
)
const reasons = computed<StatRow[]>(() =>
  (data.value?.reasons ?? []).map((row) => {
    const key = `staff.insights.uploads.reasons.${row.key}`
    return {
      key: row.key,
      // A reason a newer client sends before the site names it shows as it is.
      label: te(key) ? t(key) : row.key,
      value: formatNumber(row.snapshots),
      note: share(row.snapshots, data.value?.sampled ?? 0),
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
  <div v-else-if="!data" class="flex flex-col gap-6" aria-busy="true">
    <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <UiSkeleton v-for="n in 4" :key="n" class="h-20" />
    </div>
    <UiSkeleton class="h-48" />
  </div>

  <template v-else>
    <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <UiStat
        :label="$t('staff.insights.uploads.atCap')"
        :value="data.atCapToday"
        :tone="data.atCapToday ? 'warning' : undefined"
        :hint="
          $t('staff.insights.uploads.atCapHint', {
            snapshots: formatNumber(data.limits.dailySnapshots),
            size: formatBytes(data.limits.dailyBytes),
          })
        "
        exact
      >
        <span class="tabular truncate font-mono text-sm text-text-muted">{{
          $t('staff.insights.uploads.thisWeek', { n: formatNumber(data.atCapWeek) })
        }}</span>
      </UiStat>
      <UiStat
        :label="$t('staff.storage.nearQuota')"
        :value="data.nearQuota"
        :tone="data.nearQuota ? 'warning' : undefined"
        :hint="$t('staff.storage.nearQuotaHint')"
        exact
      />
      <UiStat :label="$t('staff.status.uploadsBlocked')" :value="data.blocked" exact />
      <UiStat :label="$t('staff.insights.uploads.day')" :value="data.snapshots24h" exact>
        <span class="tabular truncate font-mono text-sm text-text-muted">{{
          $t('staff.insights.uploads.stored', { size: formatBytes(data.bytes24h) })
        }}</span>
      </UiStat>
    </div>

    <div class="grid items-start gap-6 lg:grid-cols-2">
      <UiPanel :title="$t('staff.insights.uploads.sources')">
        <template #actions>
          <span
            class="tabular font-mono text-sm text-text-muted"
            :title="$t('staff.insights.uploads.sampledTitle', { n: formatNumber(data.sampled) })"
            >{{ $t('staff.metrics.ranges.24h') }}</span
          >
        </template>
        <StatList v-if="sources.length" :rows="sources" />
        <p v-else class="text-sm text-text-muted">{{ $t('staff.insights.uploads.none') }}</p>
      </UiPanel>
      <UiPanel :title="$t('staff.insights.uploads.reasonsTitle')">
        <template #actions>
          <span class="tabular font-mono text-sm text-text-muted">{{
            $t('staff.metrics.ranges.24h')
          }}</span>
        </template>
        <StatList v-if="reasons.length" :rows="reasons" />
        <p v-else class="text-sm text-text-muted">{{ $t('staff.insights.uploads.none') }}</p>
      </UiPanel>
    </div>
  </template>
</template>
