<script setup lang="ts">
import { computed } from 'vue'
import ItemDisplay from '@/components/legacy/ItemDisplay.vue'
import MoraDisplay from '@/components/legacy/MoraDisplay.vue'
import { materialIcon } from '@/lib/assets'
import { formatSigned } from '@/lib/format'
import { figureTitle, type Change } from './snapshot-figures'

/**
 * A table figure with its change since the snapshot before, in small green
 * or red under it; the tooltip has the exact numbers. "—" when the snapshot
 * has no currency; "Not shared" when Capture left the figure's section out
 * of it on purpose (its gi_off), never 0 or a change.
 */
const props = defineProps<{
  value: number
  kind?: 'count' | 'mora' | 'primogem'
  change?: Change
  missing?: boolean
  notShared?: boolean
}>()

const delta = computed(() => props.change?.delta ?? 0)
const title = computed(() => figureTitle(props.value, props.change))
</script>

<template>
  <span
    v-if="notShared"
    class="text-xs font-medium whitespace-nowrap text-text-muted"
    :title="$t('snapshots.parts.notShared')"
    >{{ $t('snapshots.parts.notSharedShort') }}</span
  >
  <span
    v-else-if="missing"
    class="font-medium text-text-muted"
    :title="$t('snapshots.figure.noCurrency')"
    >—</span
  >
  <span v-else class="inline-flex flex-col items-start" :title="title">
    <MoraDisplay v-if="kind === 'mora'" :amount="value" class="font-medium text-text-primary" />
    <ItemDisplay
      v-else-if="kind === 'primogem'"
      :amount="value"
      :image="materialIcon('Primogem')"
      :name="$t('progression.monthly.primogemUnit')"
      class="font-medium text-text-primary"
    />
    <span v-else class="font-medium text-text-primary">{{ value }}</span>
    <span
      v-if="delta !== 0"
      class="text-[11px] leading-4 font-semibold tabular-nums whitespace-nowrap"
      :class="delta > 0 ? 'text-success-text' : 'text-danger-text'"
      >{{ formatSigned(delta) }}</span
    >
  </span>
</template>
