<script setup lang="ts">
import { INSIGHT_TABS, type InsightTab } from '@gdt/shared'
import { RefreshCw } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SectionLabel from '@/components/shell/SectionLabel.vue'
import InsightsFeatures from '@/components/staff/insights/InsightsFeatures.vue'
import InsightsPeople from '@/components/staff/insights/InsightsPeople.vue'
import InsightsRetention from '@/components/staff/insights/InsightsRetention.vue'
import InsightsUploads from '@/components/staff/insights/InsightsUploads.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import { t } from '@/i18n'
import { formatDateTime, formatTime } from '@/lib/format'

/**
 * Staff insights: who the users are, whether they come back, which parts of
 * the site they use and how uploads run into limits. Totals and shares
 * only: nobody is named here. One switcher on top, as on Metrics: All shows
 * every section, each other choice one. The Worker reads each section when
 * this page asks, at most once in ten minutes however many staff look.
 */
const route = useRoute()
const router = useRouter()

const fromQuery = (value: unknown): InsightTab =>
  INSIGHT_TABS.includes(value as InsightTab) ? (value as InsightTab) : 'all'
const tab = ref<InsightTab>(fromQuery(route.query.tab))
watch(tab, (value) => {
  void router.replace({ query: value === 'all' ? {} : { tab: value } })
})
watch(
  () => route.query.tab,
  (value) => (tab.value = fromQuery(value)),
)

const tabs = computed(() =>
  INSIGHT_TABS.map((value) => ({
    value,
    label: t(`staff.insights.tabs.${value}`),
    title: t(`staff.insights.tabTitles.${value}`),
  })),
)
const shows = (section: Exclude<InsightTab, 'all'>) => tab.value === 'all' || tab.value === section

const refresh = ref(0)
const readAt = ref<number | null>(null)
const loaded = (at: number) => (readAt.value = Math.max(readAt.value ?? 0, at))
</script>

<template>
  <PageHeader :title="$t('staff.insights.title')" />

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
        :title="$t('staff.insights.readAtTitle', { when: formatDateTime(readAt) })"
        >{{ formatTime(readAt) }}</span
      >
      <UiButton variant="ghost" size="sm" @click="refresh++">
        <RefreshCw class="size-4" aria-hidden="true" />
        {{ $t('staff.metrics.refresh') }}
      </UiButton>
    </div>

    <template v-if="shows('people')">
      <SectionLabel v-if="tab === 'all'" :label="$t('staff.insights.tabs.people')" class="!mb-0" />
      <InsightsPeople :refresh="refresh" @loaded="loaded" />
    </template>
    <template v-if="shows('retention')">
      <SectionLabel
        v-if="tab === 'all'"
        :label="$t('staff.insights.tabs.retention')"
        class="!mb-0"
      />
      <InsightsRetention :refresh="refresh" @loaded="loaded" />
    </template>
    <template v-if="shows('features')">
      <SectionLabel
        v-if="tab === 'all'"
        :label="$t('staff.insights.tabs.features')"
        class="!mb-0"
      />
      <InsightsFeatures :refresh="refresh" @loaded="loaded" />
    </template>
    <template v-if="shows('uploads')">
      <SectionLabel v-if="tab === 'all'" :label="$t('staff.insights.tabs.uploads')" class="!mb-0" />
      <InsightsUploads :refresh="refresh" @loaded="loaded" />
    </template>
  </div>
</template>
