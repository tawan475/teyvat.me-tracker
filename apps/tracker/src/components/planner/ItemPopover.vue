<script setup lang="ts">
import { materialName } from '@/utils/materials'
import type { PlannerData, PlannerMaterial } from '@gdt/game-data'
import type { PlanTotals } from '@gdt/game-data/planner-math'
import { computed, reactive, watch } from 'vue'
import { ChartLine, ListFilter, Minus, Plus, Repeat2, RotateCcw } from 'lucide-vue-next'
import MaterialIcon from '@/components/materials-page/MaterialIcon.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiPopover from '@/components/ui/UiPopover.vue'
import { t } from '@/i18n'
import { gameIcon, materialIcon } from '@/lib/assets'
import { formatCompact, formatNumber } from '@/lib/format'
import { sliderMax } from './craft-slider'
import { rowText, type CraftRow } from './crafting'
import type { ItemContext } from './item-popover'
import { materialSoft } from './material-soft'
import NumberStepper from './NumberStepper.vue'
import { solventSwap, swapRow, swapStart, type SwapSource } from './solvent-swap'

/**
 * The inventory editor every material icon opens: the material's whole
 * family (talent books, gems… tier by tier; EXP books or ores together),
 * each with what all goals need, what is still missing after crafting
 * (and what crafting covers), what the goal it was opened from needs, and
 * the count held: typed, or ±1 with the buttons, ↑/↓ or W/S (Shift: ±10),
 * or what was just obtained added on Enter or leaving the field (after a
 * domain run). A count that differs from the capture shows it, with a reset.
 * `history` adds a button to the material's history (the Materials page);
 * `goals` one to the goals using it (the Goals tab filtered by it), with
 * how many there are. A weekly boss material offers the Dream Solvent swap
 * from the boss's other materials (`swap`: recorded like a Crafting step).
 */
const props = defineProps<{
  open: boolean
  anchor: HTMLElement | null
  itemKey: string | null
  context: ItemContext | null
  /** Opened by touch: no focus, so the keyboard doesn't cover the sheet. */
  touch: boolean
  planner: PlannerData
  /** Counts the planner works with (capture + hand edits). */
  bag: Readonly<Record<string, number>>
  /** The capture's counts (none without a capture). */
  capture: Readonly<Record<string, number>>
  totals: PlanTotals | null
  /** Offer the material's history (emits `history`). */
  history?: boolean
  /** Offer the goals using it, this many (emits `goals`); null: not offered. */
  goals?: number | null
}>()
const emit = defineEmits<{
  close: []
  change: [key: string, value: number]
  /** Obtained: add to the count. */
  add: [key: string, count: number]
  history: [key: string]
  goals: [key: string]
  /** A Dream Solvent swap done in game, as a Convert row. */
  swap: [row: CraftRow]
}>()

const material = computed(() =>
  props.itemKey ? (props.planner.materialsByKey.get(props.itemKey) ?? null) : null,
)

/** The rows: the family, the EXP items of the same kind, or the one material. */
const members = computed<PlannerMaterial[]>(() => {
  const m = material.value
  if (!m) return []
  if (m.family) return m.family.members
  if (m.kind === 'exp') return props.planner.expItems.character.map((i) => i.material)
  if (m.kind === 'ore') return props.planner.expItems.weapon.map((i) => i.material)
  return [m]
})

const count = (bag: Readonly<Record<string, number>>, key: string) =>
  Math.max(0, Math.trunc(bag[key] ?? 0))

const iconOf = (m: PlannerMaterial) =>
  m.key === props.planner.mora.key ? materialIcon('Mora') : gameIcon(m.icon)

/** EXP shown in points for the group (books and ores add up). */
const expKind = computed(() => {
  const kind = material.value?.kind
  return kind === 'exp' ? 'character' : kind === 'ore' ? 'weapon' : null
})
const expSummary = computed(() => {
  const kind = expKind.value
  const t = props.totals
  if (!kind || !t) return null
  const total = kind === 'character' ? t.characterExp : t.weaponExp
  const mine = props.context
    ? kind === 'character'
      ? props.context.requirement.characterExp
      : props.context.requirement.weaponExp
    : 0
  return { need: total.need, missing: total.missing, mine }
})

interface Row {
  material: PlannerMaterial
  have: number
  captured: number
  need: number
  missing: number
  crafted: number
  /** Covered by a Dream Solvent swap from the boss's other materials, or given to one. */
  converted: number
  convertedAway: number
  /** The game's crafting slider maximum when this tier's turn comes (craft-slider.ts). */
  slider: number | null
  mine: number
}

const rows = computed<Row[]>(() => {
  const list = members.value.map((m) => {
    const line = props.totals?.lines.get(m.key)
    const isMora = m.key === props.planner.mora.key
    const mora = props.totals?.mora
    return {
      material: m,
      have: count(props.bag, m.key),
      captured: count(props.capture, m.key),
      need: isMora ? (mora?.need ?? 0) : (line?.need ?? 0),
      missing: isMora ? (mora?.missing ?? 0) : (line?.missing ?? 0),
      crafted: line?.crafted ?? 0,
      converted: line?.converted ?? 0,
      convertedAway: line?.convertedAway ?? 0,
      slider: null as number | null,
      mine: isMora
        ? (props.context?.requirement.mora ?? 0)
        : (props.context?.requirement.items.get(m.key) ?? 0),
    }
  })
  const family = material.value?.family
  if (family && family.members.length === list.length) {
    const max = sliderMax(
      list.map((r) => r.have),
      list.map((r) => r.crafted),
      family.craftMora,
      count(props.bag, props.planner.mora.key),
    )
    list.forEach((r, i) => (r.slider = max[i] ?? null))
  }
  return list
})

/** What is being typed, per material, while its input has focus. */
const drafts = reactive(new Map<string, string>())
watch(
  () => props.open,
  () => drafts.clear(),
)

function set(row: Row, value: number) {
  const n = Math.max(0, Math.min(1_000_000_000, Math.trunc(value)))
  if (n !== row.have) emit('change', row.material.key, n)
}

function onInput(row: Row, event: Event) {
  const input = event.target as HTMLInputElement
  const digits = input.value.replace(/\D+/g, '').slice(0, 10)
  if (digits !== input.value) input.value = digits
  drafts.set(row.material.key, digits)
  if (digits !== '') set(row, Number(digits))
}

function onKey(row: Row, event: KeyboardEvent) {
  if (event.altKey || event.ctrlKey || event.metaKey) return
  const step = event.shiftKey ? 10 : 1
  const key = event.key.toLowerCase()
  if (event.key === 'ArrowUp' || key === 'w') set(row, row.have + step)
  else if (event.key === 'ArrowDown' || key === 's') set(row, row.have - step)
  else if (event.key === 'Enter') emit('close')
  else if (event.key.length === 1 && !/\d/.test(event.key)) {
    /* only digits */
  } else return
  event.preventDefault()
  drafts.delete(row.material.key)
}

const value = (row: Row) => drafts.get(row.material.key) ?? String(row.have)

/** What is typed in the "obtained" fields, per material. */
const gains = reactive(new Map<string, string>())
watch(
  () => props.open,
  () => gains.clear(),
)

function onGain(row: Row, event: Event) {
  const input = event.target as HTMLInputElement
  const digits = input.value.replace(/\D+/g, '').slice(0, 9)
  if (digits !== input.value) input.value = digits
  gains.set(row.material.key, digits)
}

/** Adds what was typed in the row's "obtained" field (Enter, or leaving it). */
function commitGain(row: Row) {
  const n = Number(gains.get(row.material.key) ?? '')
  gains.delete(row.material.key)
  if (Number.isInteger(n) && n > 0) emit('add', row.material.key, n)
}
// ------------------------------------------------------- Dream Solvent swap

const swap = computed(() =>
  props.itemKey ? solventSwap(props.planner, props.itemKey, props.bag) : null,
)
const solventMaterial = computed(() =>
  swap.value ? (props.planner.materialsByKey.get(swap.value.solvent.key) ?? null) : null,
)
/** Counts chosen per source while open (else: what is missing, within what can be given). */
const swapCounts = reactive(new Map<string, number>())
watch(
  () => [props.open, props.itemKey],
  () => swapCounts.clear(),
)
const targetMissing = computed(() =>
  props.itemKey ? (props.totals?.lines.get(props.itemKey)?.missing ?? 0) : 0,
)
function swapCount(source: SwapSource): number {
  const chosen = swapCounts.get(source.material.key)
  const start = swapStart(source, targetMissing.value)
  return chosen === undefined ? start : Math.max(0, Math.min(source.max, chosen))
}
function swapTitle(source: SwapSource): string {
  const s = swap.value
  if (!s) return ''
  if (source.max === 0) {
    return source.have === 0
      ? t('planner.popover.swap.noneHeld', { name: materialName(source.material.key) })
      : t('planner.popover.swap.noSolvent', { n: formatNumber(s.solvent.each) })
  }
  const row = swapRow(s, source.material.key, swapCount(source))
  return rowText(row, materialName, [
    t('farm.craft.item', {
      count: formatNumber(row.costs[0]?.count ?? 0),
      name: materialName(s.solvent.key),
    }),
  ])
}
function doSwap(source: SwapSource) {
  const s = swap.value
  const n = swapCount(source)
  if (!s || n <= 0) return
  swapCounts.delete(source.material.key)
  emit('swap', swapRow(s, source.material.key, n))
}

const title = computed(() => material.value?.name ?? '')
const keysHint = '↑ / W +1 · ↓ / S −1 · Shift ±10'
</script>

<template>
  <UiPopover
    :open="open && !!material"
    :anchor="anchor"
    :label="title"
    :focus="!touch"
    @close="emit('close')"
  >
    <template #heading>
      <div class="min-w-0 flex-1 py-1">
        <h2 class="truncate text-base font-semibold">{{ title }}</h2>
        <p v-if="context" class="truncate text-xs text-text-muted">{{ context.label }}</p>
      </div>
      <button
        v-if="goals != null && material"
        type="button"
        class="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-text-secondary transition-colors hover:bg-surface-overlay hover:text-text-primary"
        :aria-label="$t('planner.popover.goalsLabel', { name: title, n: formatNumber(goals) })"
        :title="$t('planner.popover.goalsTitle')"
        data-goals-using
        @click="emit('goals', material.key)"
      >
        <ListFilter class="size-5" aria-hidden="true" />
        <span class="tabular font-mono text-sm">{{ formatNumber(goals) }}</span>
      </button>
      <UiIconButton
        v-if="history && material"
        :label="$t('planner.popover.history', { name: title })"
        @click="emit('history', material.key)"
      >
        <ChartLine class="size-5" aria-hidden="true" />
      </UiIconButton>
    </template>

    <p
      v-if="expSummary && expSummary.need > 0"
      class="tabular flex flex-wrap gap-x-3 border-b border-border-subtle px-4 py-2 font-mono text-xs text-text-secondary"
    >
      <span>{{ $t('planner.popover.expNeed', { n: formatCompact(expSummary.need) }) }}</span>
      <span v-if="expSummary.mine">{{
        $t('planner.popover.goal', { n: formatCompact(expSummary.mine) })
      }}</span>
      <span :class="expSummary.missing > 0 ? 'text-danger-text' : 'text-success-text'">{{
        expSummary.missing > 0
          ? $t('planner.popover.missing', { n: formatCompact(expSummary.missing) })
          : $t('planner.popover.enough')
      }}</span>
    </p>

    <ul class="flex flex-col py-1">
      <li
        v-for="row in rows"
        :key="row.material.key"
        class="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2"
        :class="row.material.key === itemKey ? 'bg-surface-overlay/60' : ''"
      >
        <span
          class="size-10 shrink-0 overflow-hidden rounded-lg text-xs"
          :class="materialSoft(row.material.key, row.material.rarity)"
        >
          <MaterialIcon :src="iconOf(row.material)" :name="materialName(row.material.key)" />
        </span>
        <span class="flex min-w-[6rem] flex-1 flex-col gap-0.5">
          <span class="line-clamp-2 text-sm leading-tight font-medium break-words">{{
            materialName(row.material.key)
          }}</span>
          <span class="tabular flex flex-wrap gap-x-2 font-mono text-xs leading-4 text-text-muted">
            <template v-if="!expKind && row.need > 0">
              <span>{{ $t('planner.popover.need', { n: formatCompact(row.need) }) }}</span>
              <span v-if="row.mine">{{
                $t('planner.popover.goal', { n: formatCompact(row.mine) })
              }}</span>
              <span :class="row.missing > 0 ? 'text-danger-text' : 'text-success-text'">{{
                row.missing > 0
                  ? $t('planner.popover.missing', { n: formatCompact(row.missing) })
                  : $t('planner.popover.enough')
              }}</span>
            </template>
            <span
              v-if="row.crafted"
              class="text-text-secondary"
              :title="
                row.slider === null
                  ? $t('planner.popover.craftedTitle')
                  : $t('planner.popover.sliderTitle', {
                      n: formatNumber(row.crafted),
                      max: formatNumber(row.slider),
                    })
              "
              >{{
                row.slider === null
                  ? $t('planner.popover.craft', { n: formatCompact(row.crafted) })
                  : $t('planner.popover.craftOf', {
                      n: formatNumber(row.crafted),
                      max: formatNumber(row.slider),
                    })
              }}</span
            >
            <span v-if="row.converted" class="text-text-secondary">{{
              $t('planner.cell.converted', { n: formatNumber(row.converted) })
            }}</span>
            <span v-if="row.convertedAway" class="text-text-secondary">{{
              $t('planner.cell.convertedAway', { n: formatNumber(row.convertedAway) })
            }}</span>
            <span
              v-if="row.have !== row.captured"
              class="inline-flex items-center gap-1 text-accent-text"
            >
              {{ $t('planner.popover.capture', { n: formatCompact(row.captured) }) }}
              <button
                type="button"
                class="inline-flex size-5 items-center justify-center rounded hover:bg-surface-overlay"
                :aria-label="
                  $t('planner.popover.backLabel', {
                    name: materialName(row.material.key),
                    n: formatNumber(row.captured),
                  })
                "
                :title="$t('planner.popover.backTitle', { n: formatNumber(row.captured) })"
                @click="emit('change', row.material.key, row.captured)"
              >
                <RotateCcw class="size-3.5" aria-hidden="true" />
              </button>
            </span>
          </span>
        </span>
        <span class="ml-auto flex shrink-0 items-center gap-1.5">
          <span class="flex items-center">
            <button
              type="button"
              class="inline-flex size-9 items-center justify-center rounded-l-md border border-border-strong bg-surface-overlay text-text-secondary hover:text-text-primary disabled:opacity-40"
              :aria-label="`${materialName(row.material.key)} −1`"
              :disabled="row.have === 0"
              @click="set(row, row.have - 1)"
            >
              <Minus class="size-4" aria-hidden="true" />
            </button>
            <input
              :value="value(row)"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              :autofocus="row.material.key === itemKey || undefined"
              :aria-label="$t('planner.popover.held', { name: materialName(row.material.key) })"
              :title="keysHint"
              class="tabular h-9 w-16 border-y border-border-strong bg-surface-raised px-1 text-center font-mono text-sm text-text-primary focus:relative focus:z-10 focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none"
              @input="onInput(row, $event)"
              @keydown="onKey(row, $event)"
              @blur="drafts.delete(row.material.key)"
            />
            <button
              type="button"
              class="inline-flex size-9 items-center justify-center rounded-r-md border border-border-strong bg-surface-overlay text-text-secondary hover:text-text-primary"
              :aria-label="`${materialName(row.material.key)} +1`"
              @click="set(row, row.have + 1)"
            >
              <Plus class="size-4" aria-hidden="true" />
            </button>
          </span>
          <input
            :value="gains.get(row.material.key) ?? ''"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            :placeholder="$t('planner.popover.addPlaceholder')"
            :aria-label="$t('planner.popover.addLabel', { name: materialName(row.material.key) })"
            :title="$t('planner.popover.addTitle')"
            class="tabular h-9 w-12 rounded-md border border-border-default bg-surface-raised px-1 text-center font-mono text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none"
            @input="onGain(row, $event)"
            @keydown.enter.prevent="commitGain(row)"
            @blur="commitGain(row)"
          />
        </span>
      </li>
    </ul>

    <section
      v-if="swap"
      class="flex flex-col gap-1 border-t border-border-subtle px-4 py-2"
      :aria-label="$t('planner.popover.swap.label')"
    >
      <p
        class="flex items-center gap-1.5 text-xs text-text-muted"
        :title="$t('planner.popover.swap.title', { n: formatNumber(swap.solvent.each) })"
      >
        <Repeat2 class="size-3.5" aria-hidden="true" />
        <span>{{ $t('planner.popover.swap.heading') }}</span>
        <span
          v-if="solventMaterial"
          class="tabular ml-auto inline-flex items-center gap-1 font-mono"
          :title="
            $t('planner.popover.swap.solventHeld', {
              name: materialName(swap.solvent.key),
              n: formatNumber(swap.solvent.have),
            })
          "
        >
          <span class="size-5 overflow-hidden rounded">
            <MaterialIcon
              :src="iconOf(solventMaterial)"
              :name="materialName(solventMaterial.key)"
            />
          </span>
          {{ formatNumber(swap.solvent.have) }}
        </span>
      </p>
      <ul class="flex flex-col">
        <li
          v-for="source in swap.sources"
          :key="source.material.key"
          class="flex flex-wrap items-center gap-x-2 gap-y-1 py-1"
          :class="source.max === 0 ? 'opacity-60' : ''"
          :title="swapTitle(source)"
        >
          <span
            class="size-8 shrink-0 overflow-hidden rounded-md text-xs"
            :class="materialSoft(source.material.key, source.material.rarity)"
          >
            <MaterialIcon
              :src="iconOf(source.material)"
              :name="materialName(source.material.key)"
            />
          </span>
          <span class="flex min-w-[6rem] flex-1 flex-col">
            <span class="truncate text-sm">{{ materialName(source.material.key) }}</span>
            <span class="tabular font-mono text-xs text-text-muted">{{
              $t('planner.popover.swap.have', { n: formatNumber(source.have) })
            }}</span>
          </span>
          <span class="ml-auto flex shrink-0 items-center gap-1.5">
            <NumberStepper
              v-if="source.max > 0"
              :model-value="swapCount(source)"
              :min="1"
              :max="source.max"
              :label="materialName(source.material.key)"
              @update:model-value="(n: number) => swapCounts.set(source.material.key, n)"
            />
            <UiButton
              size="sm"
              :disabled="source.max === 0"
              :aria-label="swapTitle(source)"
              @click="doSwap(source)"
            >
              <Repeat2 class="size-4" aria-hidden="true" />
              {{ $t('planner.popover.swap.do') }}
            </UiButton>
          </span>
        </li>
      </ul>
    </section>
  </UiPopover>
</template>
