<script setup lang="ts">
import type { PlannerData } from '@gdt/game-data'
import type { PlanGoal, PlanOptions, Requirement } from '@gdt/game-data/planner-math'
import { computed } from 'vue'
import MaterialIcon from '@/components/materials-page/MaterialIcon.vue'
import { RARITY_SOFT } from '@/components/characters/tokens'
import { formatCompact, formatNumber } from '@/lib/format'
import { mergeRequirements } from './model'
import { costCells, stockCounts } from './cost-cells'
import { STOCK_MEANING, STOCK_TONE } from './farm-format'
import { fromTouch, useItemPopover } from './item-popover'

/**
 * What a goal costs, as item tiles (cost-cells.ts): materials by kind and
 * tier, EXP as books / ores, then Mora. Each count is coloured by what the
 * bag covers: every counted goal with this one, this one alone, or not
 * even that; `legend` adds how many tiles have each colour. On the Planner
 * each tile opens the inventory editor, which shows what this goal
 * (`label`) needs of it.
 */
const props = defineProps<{
  planner: PlannerData
  requirements: readonly Requirement[]
  /** The other goals (the totals' goals without these). */
  others: readonly PlanGoal[]
  inventory: Readonly<Record<string, number>>
  options: PlanOptions
  /** The goal's name, for the inventory editor. */
  label?: string
  /** Show the colours' legend with their counts. */
  legend?: boolean
}>()
const openItem = useItemPopover()

const owned = computed(() =>
  props.options.passives ? new Set<string>(props.options.passives) : null,
)

function open(key: string, event: MouseEvent) {
  openItem?.({
    key,
    anchor: event.currentTarget as HTMLElement,
    touch: fromTouch(event),
    context: {
      label: props.label ?? '',
      requirement: mergeRequirements(props.planner, props.requirements, owned.value),
    },
  })
}

const cells = computed(() =>
  costCells({
    planner: props.planner,
    requirements: props.requirements,
    others: props.others,
    inventory: props.inventory,
    options: props.options,
  }),
)
const legendRows = computed(() => {
  const counts = stockCounts(cells.value)
  return (['all', 'alone', 'short'] as const)
    .filter((s) => counts[s] > 0)
    .map((s) => ({ status: s, count: counts[s], tone: STOCK_TONE[s], meaning: STOCK_MEANING[s] }))
})
</script>

<template>
  <ul v-if="cells.length" class="flex flex-wrap gap-x-1.5 gap-y-2">
    <li v-for="c in cells" :key="c.key" class="w-14" :title="c.title">
      <component
        :is="openItem ? 'button' : 'span'"
        :type="openItem ? 'button' : undefined"
        class="flex w-full flex-col items-center gap-0.5 rounded-lg"
        :class="
          openItem
            ? 'transition-[background-color,box-shadow] hover:bg-surface-overlay hover:ring-[3px] hover:ring-surface-overlay'
            : ''
        "
        :aria-haspopup="openItem ? 'dialog' : undefined"
        @click="open(c.key, $event)"
      >
        <span
          class="size-11 overflow-hidden rounded-lg text-xs"
          :class="RARITY_SOFT[c.rarity] ?? 'bg-surface-sunken'"
        >
          <MaterialIcon :src="c.icon" :name="c.name" />
        </span>
        <span class="tabular font-mono text-xs font-medium" :class="STOCK_TONE[c.status]">{{
          formatCompact(c.count)
        }}</span>
        <span class="sr-only">{{ c.title }}</span>
      </component>
    </li>
  </ul>
  <p v-else class="text-sm text-text-muted">{{ $t('planner.cost.nothing') }}</p>
  <ul
    v-if="legend && legendRows.length"
    class="flex flex-col gap-0.5 text-xs text-text-muted"
    :aria-label="$t('planner.cost.colours')"
  >
    <li v-for="l in legendRows" :key="l.status" class="flex items-center gap-1.5">
      <span class="tabular min-w-5 font-mono font-semibold" :class="l.tone">{{
        formatNumber(l.count)
      }}</span>
      {{ l.meaning }}
    </li>
  </ul>
</template>
