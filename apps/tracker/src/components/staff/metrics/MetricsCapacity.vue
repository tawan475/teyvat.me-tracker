<script setup lang="ts">
import type { UsageItem } from '@gdt/shared'
import { CloudOff, TriangleAlert } from 'lucide-vue-next'
import { computed, watch } from 'vue'
import StorageSplitBar from '@/components/staff/StorageSplitBar.vue'
import { daysUntilFull, share, spanOf } from '@/components/staff/metrics/series'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import UiError from '@/components/ui/UiError.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiProgress from '@/components/ui/UiProgress.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import { api } from '@/api'
import { useResource } from '@/data/use-resource'
import { t } from '@/i18n'
import { formatBytes, formatCompact, formatMonthDay, formatNumber } from '@/lib/format'

/**
 * Capacity: each database against D1's 10 GB, what the main one holds, how
 * fast it grows, and (with the usage token) Cloudflare's own figures for
 * the month against what the plan includes. A figure past 80% carries a
 * warning mark and its share in words, not only a colour.
 */
const props = defineProps<{ refresh: number }>()
const emit = defineEmits<{ loaded: [at: number] }>()

const { data, error, reload } = useResource(
  () => props.refresh,
  () => api.staff.metricsCapacity(),
)
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

  <div v-else class="grid items-start gap-6 lg:grid-cols-2">
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
        <dl class="flex flex-col divide-y divide-border-subtle border-t border-border-default pt-4">
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
</template>
