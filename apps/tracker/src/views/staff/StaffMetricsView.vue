<script setup lang="ts">
import { METRIC_TABS, type MetricTab } from '@gdt/shared'
import { RefreshCw } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SectionLabel from '@/components/shell/SectionLabel.vue'
import MetricsActivity from '@/components/staff/metrics/MetricsActivity.vue'
import MetricsCapacity from '@/components/staff/metrics/MetricsCapacity.vue'
import MetricsLive from '@/components/staff/metrics/MetricsLive.vue'
import MetricsNow from '@/components/staff/metrics/MetricsNow.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import { t } from '@/i18n'
import { formatDateTime, formatTime } from '@/lib/format'

/**
 * Staff metrics: who is online and in game, live sync, activity over time
 * and capacity. One switcher on top: All shows every section (the default),
 * each other choice shows one and reads only its figures. Nothing here is
 * counted per user or per request: the Worker reads each figure when this
 * page asks, at most once a minute however many staff look, which is why
 * Refresh within that minute shows the same time.
 */
const route = useRoute()
const router = useRouter()

const fromQuery = (value: unknown): MetricTab =>
  METRIC_TABS.includes(value as MetricTab) ? (value as MetricTab) : 'all'
const tab = ref<MetricTab>(fromQuery(route.query.tab))
watch(tab, (value) => {
  void router.replace({ query: value === 'all' ? {} : { tab: value } })
})
watch(
  () => route.query.tab,
  (value) => (tab.value = fromQuery(value)),
)

const tabs = computed(() =>
  METRIC_TABS.map((value) => ({
    value,
    label: t(`staff.metrics.tabs.${value}`),
    title: t(`staff.metrics.tabTitles.${value}`),
  })),
)
const shows = (section: Exclude<MetricTab, 'all'>) => tab.value === 'all' || tab.value === section

// Refresh asks every shown section again; each says when its figures were read.
const refresh = ref(0)
const readAt = ref<number | null>(null)
const loaded = (at: number) => (readAt.value = Math.max(readAt.value ?? 0, at))
</script>

<template>
  <PageHeader :title="$t('staff.metrics.title')" />

  <div class="flex flex-col gap-6">
    <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
      <UiSegmented
        v-model="tab"
        :options="tabs"
        :label="$t('staff.metrics.tabsLabel')"
        size="md"
        fill
        class="min-w-0 basis-full sm:basis-auto"
      />
      <span class="hidden flex-1 sm:block" />
      <span
        v-if="readAt"
        class="tabular font-mono text-sm whitespace-nowrap text-text-muted"
        :title="$t('staff.metrics.readAtTitle', { when: formatDateTime(readAt) })"
        >{{ formatTime(readAt) }}</span
      >
      <UiButton variant="ghost" size="sm" @click="refresh++">
        <RefreshCw class="size-4" aria-hidden="true" />
        {{ $t('staff.metrics.refresh') }}
      </UiButton>
    </div>

    <template v-if="shows('now')">
      <SectionLabel v-if="tab === 'all'" :label="$t('staff.metrics.tabs.now')" class="!mb-0" />
      <MetricsNow :refresh="refresh" @loaded="loaded" />
    </template>
    <template v-if="shows('live')">
      <SectionLabel v-if="tab === 'all'" :label="$t('staff.metrics.tabs.live')" class="!mb-0" />
      <MetricsLive :refresh="refresh" @loaded="loaded" />
    </template>
    <template v-if="shows('activity')">
      <SectionLabel v-if="tab === 'all'" :label="$t('staff.metrics.tabs.activity')" class="!mb-0" />
      <MetricsActivity :refresh="refresh" @loaded="loaded" />
    </template>
    <template v-if="shows('capacity')">
      <SectionLabel v-if="tab === 'all'" :label="$t('staff.metrics.tabs.capacity')" class="!mb-0" />
      <MetricsCapacity :refresh="refresh" @loaded="loaded" />
    </template>
  </div>
</template>
