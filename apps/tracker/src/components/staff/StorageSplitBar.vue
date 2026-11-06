<script setup lang="ts">
import type { StorageSplit } from '@gdt/shared'
import { computed } from 'vue'
import { t } from '@/i18n'
import { formatBytes, formatNumber } from '@/lib/format'

/**
 * What a user (or the site) stores, as one bar: snapshot sections, the
 * artifact catalog, wish history, and live sync's journals when known. The
 * bands differ in lightness as well as hue, the tooltip names each with
 * its bytes, and `legend` writes them out under the bar, so the split never
 * rests on colour alone (the site's colour-blind rule).
 */
const props = defineProps<{
  split: StorageSplit & { liveBytes?: number }
  /** The bar's label for assistive tech (what it is the storage of). */
  label: string
  legend?: boolean
  /** Pulls, shown beside the wish band in the legend. */
  pulls?: number
}>()

const parts = computed(() => {
  const list = [
    { key: 'sections', bytes: props.split.sectionBytes, cls: 'bg-chart-1' },
    { key: 'catalog', bytes: props.split.catalogBytes, cls: 'bg-chart-4' },
    { key: 'wishes', bytes: props.split.wishBytes, cls: 'bg-chart-2' },
    { key: 'live', bytes: props.split.liveBytes ?? 0, cls: 'bg-text-muted' },
  ]
  const total = Math.max(
    1,
    list.reduce((sum, p) => sum + p.bytes, 0),
  )
  return list.map((p) => ({
    ...p,
    label: t(`staff.split.${p.key}`),
    text: formatBytes(p.bytes),
    share: (p.bytes / total) * 100,
  }))
})
const title = computed(() => parts.value.map((p) => `${p.label} ${p.text}`).join(' · '))
</script>

<template>
  <span class="flex min-w-0 flex-col gap-1.5">
    <span
      class="flex h-2 w-full overflow-hidden rounded-full bg-surface-sunken"
      role="img"
      :aria-label="`${label}: ${title}`"
      :title="title"
    >
      <span
        v-for="p in parts"
        :key="p.key"
        class="h-full"
        :class="p.cls"
        :style="{ width: `${p.share}%` }"
      />
    </span>
    <span v-if="legend" class="flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-text-secondary">
      <span
        v-for="p in parts.filter((x) => x.key !== 'live' || x.bytes > 0)"
        :key="p.key"
        class="inline-flex items-center gap-1.5"
      >
        <span class="size-2.5 shrink-0 rounded-sm" :class="p.cls" aria-hidden="true" />
        {{ p.label }}
        <span class="tabular font-mono text-text-primary">{{ p.text }}</span>
        <span v-if="p.key === 'wishes' && pulls" class="tabular font-mono text-text-muted">{{
          $t('staff.split.pulls', { n: formatNumber(pulls) })
        }}</span>
      </span>
    </span>
  </span>
</template>
