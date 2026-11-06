<script setup lang="ts">
import type { PlannerData } from '@gdt/game-data'
import type { PlanGoal, PlanOptions, Requirement } from '@gdt/game-data/planner-math'
import { computed } from 'vue'
import { Check, CircleAlert, TriangleAlert } from 'lucide-vue-next'
import MaterialIcon from '@/components/materials-page/MaterialIcon.vue'
import { RARITY_SOFT } from '@/components/characters/tokens'
import { formatCompact } from '@/lib/format'
import { mergeRequirements } from './model'
import { costCells } from './cost-cells'
import { STOCK_MEANING } from './farm-format'
import { fromTouch, useItemPopover } from './item-popover'

/**
 * The goal editor's cost as a checklist (the user's pick "D", 2026-11-02):
 * one row per item (cost-cells.ts order), its name, what the bag holds of
 * what this goal needs as a bar and "have of need", and its state by a mark
 * as well as a colour (the site is colour-blind friendly): ✓ enough for
 * every goal, ⓘ enough for this goal only, ▲ "N short". A row opens the
 * inventory editor, like the tiles (CostList, still the item editor's).
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

const rows = computed(() =>
  costCells({
    planner: props.planner,
    requirements: props.requirements,
    others: props.others,
    inventory: props.inventory,
    options: props.options,
  }).map((cell) => {
    const have = cell.have ?? props.inventory[cell.key] ?? 0
    return {
      ...cell,
      have,
      missing: Math.max(cell.count - have, 0),
      fill: cell.count > 0 ? Math.min(have / cell.count, 1) : 1,
    }
  }),
)
/** Mark colours: teal, blue and orange, which also differ in lightness and shape. */
const MARK = {
  all: 'text-success-text',
  alone: 'text-accent-text',
  short: 'text-warning-text',
} as const
const BAR = {
  all: 'bg-success-text',
  alone: 'bg-accent-text',
  short: 'bar-short',
} as const
</script>

<template>
  <ul v-if="rows.length" class="flex flex-col gap-3">
    <li v-for="r in rows" :key="r.key" :title="r.title">
      <component
        :is="openItem ? 'button' : 'div'"
        :type="openItem ? 'button' : undefined"
        class="grid w-full grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-2.5 rounded-lg text-left"
        :class="openItem ? '-m-1 p-1 transition-colors hover:bg-surface-overlay' : ''"
        :aria-haspopup="openItem ? 'dialog' : undefined"
        @click="open(r.key, $event)"
      >
        <span
          class="size-10 overflow-hidden rounded-lg text-xs"
          :class="RARITY_SOFT[r.rarity] ?? 'bg-surface-sunken'"
        >
          <MaterialIcon :src="r.icon" :name="r.name" />
        </span>
        <span class="flex min-w-0 flex-col gap-1">
          <span class="flex min-w-0 items-center gap-1.5 text-sm">
            <span class="min-w-0 flex-1 truncate">{{ r.name }}</span>
            <span
              class="inline-flex shrink-0 items-center gap-1 text-xs font-semibold"
              :class="MARK[r.status]"
            >
              <TriangleAlert v-if="r.status === 'short'" class="size-3.5" aria-hidden="true" />
              <CircleAlert v-else-if="r.status === 'alone'" class="size-3.5" aria-hidden="true" />
              <Check v-else class="size-4" aria-hidden="true" />
              <template v-if="r.status === 'short' && r.missing">{{
                $t('planner.cost.short', { n: formatCompact(r.missing) })
              }}</template>
              <span class="sr-only">{{ STOCK_MEANING[r.status] }}</span>
            </span>
          </span>
          <span class="block h-1.5 overflow-hidden rounded-full bg-surface-sunken">
            <span
              class="block h-full rounded-full"
              :class="BAR[r.status]"
              :style="{ width: `${Math.round(r.fill * 100)}%` }"
            />
          </span>
          <span class="tabular font-mono text-xs text-text-muted">{{
            $t('planner.cost.haveOf', { have: formatCompact(r.have), need: formatCompact(r.count) })
          }}</span>
        </span>
      </component>
    </li>
  </ul>
  <p v-else class="text-sm text-text-muted">{{ $t('planner.cost.nothing') }}</p>
</template>

<style scoped>
/* Short: striped, so it reads without its colour. */
.bar-short {
  background: repeating-linear-gradient(
    45deg,
    var(--color-warning-text) 0 6px,
    color-mix(in srgb, var(--color-warning-text) 55%, transparent) 6px 12px
  );
}
</style>
