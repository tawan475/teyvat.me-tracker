<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronLeft, ChevronRight, GripVertical, Plus, Trash2 } from 'lucide-vue-next'
import UiButton from '@/components/ui/UiButton.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { t } from '@/i18n'
import { formatNumber } from '@/lib/format'
import {
  BAG_LIMITS,
  DEFAULT_GRAPHS,
  MAX_PROGRESSION_GRAPHS,
  moveGraph,
  newGraph,
  type Graph,
} from './graphs'
import { FIGURE_KEYS, type FigureKey } from './progression-series'

/**
 * The progression card's Graphs dialog (design 1A, 2026-11-08): the graphs
 * on the left in the card's order (drag the grip, or arrow keys on it), Add
 * graph under them; the picked graph's settings on the right in three
 * sections: Shows, Graph settings (y axis from / to as option cards, the
 * delta graph), and a Preview drawn by the card (`preview` slot). On a phone
 * the list and one graph's settings are two steps. Every change is sent
 * (`change`) for the card to show and save.
 */
const props = defineProps<{
  open: boolean
  graphs: readonly Graph[]
  /** Where they are saved: the account (signed in) or this browser. */
  signedIn: boolean
  /** A figure's recent values for the list's sparklines (null: none yet). */
  spark: (figure: FigureKey) => readonly number[] | null
  colorOf: (figure: FigureKey) => number
}>()
const emit = defineEmits<{ close: []; change: [graphs: Graph[]]; preview: [graph: Graph | null] }>()
defineSlots<{ preview(): unknown }>()

interface Item {
  id: number
  graph: Graph
}
let nextId = 0
const items = ref<Item[]>([])
const picked = ref(0)
/** On a phone: the list, or one graph's settings. */
const step = ref<'list' | 'graph'>('list')
const adding = ref(false)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    items.value = props.graphs.map((graph) => ({ id: nextId++, graph }))
    picked.value = 0
    step.value = 'list'
    adding.value = false
  },
  { immediate: true },
)

const current = computed(() => items.value[picked.value] ?? items.value[0])
// The card draws the picked graph's preview (the `preview` slot) from this.
watch(
  () => (props.open ? (current.value?.graph ?? null) : null),
  (graph) => emit('preview', graph),
  { immediate: true },
)

function changed() {
  emit(
    'change',
    items.value.map((item) => item.graph),
  )
}
function update(patch: Partial<Graph>) {
  const item = current.value
  if (!item) return
  item.graph = { ...item.graph, ...patch }
  changed()
}
function pick(index: number) {
  picked.value = index
  step.value = 'graph'
}
function add(figure: FigureKey) {
  if (items.value.length >= MAX_PROGRESSION_GRAPHS) return
  items.value = [...items.value, { id: nextId++, graph: newGraph(figure) }]
  adding.value = false
  pick(items.value.length - 1)
  changed()
}
function remove() {
  if (items.value.length <= 1) return
  items.value = items.value.filter((_, i) => i !== picked.value)
  picked.value = Math.min(picked.value, items.value.length - 1)
  step.value = 'list'
  changed()
}
function reset() {
  items.value = DEFAULT_GRAPHS.map((graph) => ({ id: nextId++, graph: { ...graph } }))
  picked.value = 0
  changed()
}
function move(from: number, to: number) {
  if (to < 0 || to >= items.value.length || from === to) return
  const id = items.value[picked.value]?.id
  items.value = moveGraph(items.value, from, to)
  picked.value = Math.max(
    0,
    items.value.findIndex((item) => item.id === id),
  )
  changed()
}

// ------------------------------------------------------------- drag to order

const list = ref<HTMLElement>()
let drag: { index: number; y: number; row: number } | null = null
const dragging = ref<number | null>(null)

function startDrag(event: PointerEvent, index: number) {
  if (event.button !== 0) return
  const row = (event.currentTarget as HTMLElement).closest('li')
  if (!row) return
  try {
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  } catch {
    // No such pointer (a synthetic event): the drag still follows this button's events.
  }
  drag = { index, y: event.clientY, row: row.getBoundingClientRect().height + 6 }
  dragging.value = items.value[index]?.id ?? null
}
function moveDrag(event: PointerEvent) {
  if (!drag) return
  const dy = event.clientY - drag.y
  const steps = Math.trunc(dy / drag.row)
  if (steps === 0) return
  const to = Math.max(0, Math.min(items.value.length - 1, drag.index + steps))
  if (to === drag.index) return
  move(drag.index, to)
  drag.y += (to - drag.index) * drag.row
  drag.index = to
}
function endDrag() {
  drag = null
  dragging.value = null
}
function gripKey(event: KeyboardEvent, index: number) {
  if (event.key === 'ArrowUp') move(index, index - 1)
  else if (event.key === 'ArrowDown') move(index, index + 1)
  else return
  event.preventDefault()
}

// ------------------------------------------------------------------- labels

const figureTitle = (key: FigureKey) => t(`overview.figure.${key}`)
const figureOptions = computed(() =>
  FIGURE_KEYS.map((key) => ({ value: key, label: figureTitle(key) })),
)

function fromText(graph: Graph): string {
  if (graph.from === 'auto') return t('progression.graphs.lowestShort')
  return formatNumber(graph.from === 'zero' ? 0 : graph.from)
}
function toText(graph: Graph): string {
  if (graph.to === 'auto') return t('progression.graphs.highestShort')
  if (graph.to === 'bag') {
    return t('progression.graphs.bagShort', { n: formatNumber(BAG_LIMITS[graph.figure] ?? 0) })
  }
  return formatNumber(graph.to)
}
function summary(graph: Graph): string {
  const range = t('progression.graphs.range', { from: fromText(graph), to: toText(graph) })
  return graph.delta ? `${range} · ${t('progression.graphs.deltaShort')}` : range
}

/** A tiny line of a figure's recent values for the list (60 × 22). */
function sparkPoints(figure: FigureKey): string {
  const values = props.spark(figure)
  if (!values || values.length < 2) return ''
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  return values
    .map(
      (v, i) =>
        `${((i / (values.length - 1)) * 58 + 1).toFixed(1)},${(20 - ((v - min) / span) * 18).toFixed(1)}`,
    )
    .join(' ')
}

// ------------------------------------------------------------- axis options

type FromChoice = 'auto' | 'zero' | 'custom'
type ToChoice = 'auto' | 'bag' | 'custom'
const fromChoice = computed<FromChoice>(() => {
  const from = current.value?.graph.from
  return typeof from === 'number' ? 'custom' : (from ?? 'auto')
})
const toChoice = computed<ToChoice>(() => {
  const to = current.value?.graph.to
  return typeof to === 'number' ? 'custom' : (to ?? 'auto')
})
const hasBag = computed(
  () => !!current.value && BAG_LIMITS[current.value.graph.figure] !== undefined,
)

const fromOptions = computed(() => [
  {
    value: 'auto' as const,
    title: t('progression.graphs.auto'),
    hint: t('progression.graphs.lowest'),
  },
  {
    value: 'zero' as const,
    title: t('progression.graphs.zero'),
    hint: t('progression.graphs.zeroHint'),
  },
  {
    value: 'custom' as const,
    title: t('progression.graphs.custom'),
    hint: t('progression.graphs.customHint'),
  },
])
const toOptions = computed(() => [
  {
    value: 'auto' as const,
    title: t('progression.graphs.auto'),
    hint: t('progression.graphs.highest'),
  },
  ...(hasBag.value
    ? [
        {
          value: 'bag' as const,
          title: t('progression.graphs.bag'),
          hint: t('progression.graphs.bagHint', {
            n: formatNumber(BAG_LIMITS[current.value!.graph.figure] ?? 0),
          }),
        },
      ]
    : []),
  {
    value: 'custom' as const,
    title: t('progression.graphs.custom'),
    hint: t('progression.graphs.customHint'),
  },
])

function pickFrom(choice: FromChoice) {
  update({ from: choice === 'custom' ? (customFrom.value ?? 0) : choice })
}
function pickTo(choice: ToChoice) {
  const fallback = BAG_LIMITS[current.value?.graph.figure ?? 'mora'] ?? 1_000
  update({ to: choice === 'custom' ? (customTo.value ?? fallback) : choice })
}
const customFrom = computed(() =>
  typeof current.value?.graph.from === 'number' ? current.value.graph.from : null,
)
const customTo = computed(() =>
  typeof current.value?.graph.to === 'number' ? current.value.graph.to : null,
)
function typed(part: 'from' | 'to', event: Event) {
  const value = (event.target as HTMLInputElement).valueAsNumber
  if (Number.isFinite(value) && Math.abs(value) <= 1e15) update({ [part]: value })
}
function setFigure(figure: FigureKey) {
  const graph = current.value?.graph
  if (!graph) return
  // A bag limit only fits a figure that has one.
  const to = graph.to === 'bag' && BAG_LIMITS[figure] === undefined ? 'auto' : graph.to
  update({ figure, to })
}
</script>

<template>
  <UiModal
    :open="open"
    :title="$t('progression.graphs.title')"
    size="detail"
    @close="emit('close')"
  >
    <template #heading>
      <h2 class="mr-auto min-w-0 flex-1 truncate text-lg font-semibold">
        {{ $t('progression.graphs.title') }}
      </h2>
      <span class="mr-2 hidden text-sm text-text-muted sm:inline">
        {{
          signedIn ? $t('progression.graphs.savedAccount') : $t('progression.graphs.savedBrowser')
        }}
      </span>
    </template>

    <div class="grid gap-5 sm:grid-cols-[17rem_minmax(0,1fr)] sm:gap-6">
      <!-- The graphs, in the card's order -->
      <nav
        :aria-label="$t('progression.graphs.list')"
        class="flex flex-col gap-1.5 sm:border-r sm:border-border-default sm:pr-5"
        :class="step === 'graph' ? 'max-sm:hidden' : ''"
      >
        <ol ref="list" class="flex flex-col gap-1.5">
          <li
            v-for="(item, index) in items"
            :key="item.id"
            class="flex items-center gap-1 rounded-xl border transition-colors"
            :class="[
              index === picked
                ? 'border-accent bg-surface-overlay'
                : 'border-transparent hover:bg-surface-overlay/60',
              dragging === item.id ? 'opacity-70 shadow-overlay' : '',
            ]"
          >
            <button
              type="button"
              class="flex h-11 w-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-text-muted hover:text-text-primary active:cursor-grabbing"
              :aria-label="
                $t('progression.graphs.reorder', { figure: figureTitle(item.graph.figure) })
              "
              :title="$t('progression.graphs.dragHint')"
              @pointerdown="startDrag($event, index)"
              @pointermove="moveDrag"
              @pointerup="endDrag"
              @pointercancel="endDrag"
              @keydown="gripKey($event, index)"
            >
              <GripVertical class="size-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="flex min-h-12 min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 text-left"
              :aria-current="index === picked ? 'true' : undefined"
              @click="pick(index)"
            >
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="truncate font-medium">{{ figureTitle(item.graph.figure) }}</span>
                <span class="truncate text-xs text-text-muted">{{ summary(item.graph) }}</span>
              </span>
              <svg viewBox="0 0 60 22" class="h-[22px] w-[60px] shrink-0" aria-hidden="true">
                <polyline
                  :points="sparkPoints(item.graph.figure)"
                  fill="none"
                  :stroke="`var(--chart-${colorOf(item.graph.figure)})`"
                  stroke-width="2"
                />
              </svg>
              <ChevronRight class="size-4 shrink-0 text-text-muted sm:hidden" aria-hidden="true" />
            </button>
          </li>
        </ol>

        <button
          v-if="!adding"
          type="button"
          class="mt-1 flex min-h-11 items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong text-sm font-semibold text-accent-text hover:bg-surface-overlay/60 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="items.length >= MAX_PROGRESSION_GRAPHS"
          :title="
            items.length >= MAX_PROGRESSION_GRAPHS
              ? $t('progression.graphs.max', { n: MAX_PROGRESSION_GRAPHS })
              : undefined
          "
          @click="adding = true"
        >
          <Plus class="size-4" aria-hidden="true" />{{ $t('progression.graphs.add') }}
        </button>
        <div
          v-else
          class="mt-1 grid grid-cols-2 gap-1 rounded-xl border border-border-default bg-surface-base p-1.5"
          role="group"
          :aria-label="$t('progression.graphs.add')"
        >
          <button
            v-for="key in FIGURE_KEYS"
            :key="key"
            type="button"
            class="min-h-10 truncate rounded-lg px-2.5 text-left text-sm hover:bg-surface-overlay"
            @click="add(key)"
          >
            {{ figureTitle(key) }}
          </button>
        </div>
        <p class="mt-1 px-1 text-xs text-text-muted">{{ $t('progression.graphs.dragHint') }}</p>
      </nav>

      <!-- The picked graph -->
      <div
        v-if="current"
        class="flex min-w-0 flex-col gap-4"
        :class="step === 'list' ? 'max-sm:hidden' : ''"
      >
        <button
          type="button"
          class="-mt-1 flex min-h-11 items-center gap-1 self-start rounded-lg pr-2 text-sm font-medium text-text-secondary hover:text-text-primary sm:hidden"
          @click="step = 'list'"
        >
          <ChevronLeft class="size-5" aria-hidden="true" />{{ $t('progression.graphs.back') }}
        </button>

        <section aria-labelledby="graphs-shows" class="flex flex-col gap-2.5">
          <h3 id="graphs-shows" class="text-xs font-bold tracking-wider text-text-muted uppercase">
            {{ $t('progression.graphs.shows') }}
          </h3>
          <div class="flex flex-wrap items-center gap-3">
            <UiSelect
              class="w-full max-w-72"
              :model-value="current.graph.figure"
              :options="figureOptions"
              :aria-label="$t('progression.graphs.shows')"
              @update:model-value="(value) => setFigure(value as FigureKey)"
            />
            <UiButton
              variant="ghost"
              size="sm"
              class="ml-auto"
              :disabled="items.length <= 1"
              :title="items.length <= 1 ? $t('progression.graphs.lastOne') : undefined"
              @click="remove"
            >
              <Trash2 class="size-4" aria-hidden="true" />{{ $t('progression.graphs.remove') }}
            </UiButton>
          </div>
        </section>
        <hr class="border-border-default" />

        <section aria-labelledby="graphs-settings" class="flex flex-col gap-3.5">
          <h3
            id="graphs-settings"
            class="text-xs font-bold tracking-wider text-text-muted uppercase"
          >
            {{ $t('progression.graphs.settings') }}
          </h3>
          <fieldset class="flex flex-col gap-2">
            <legend class="mb-2 text-sm text-text-secondary">
              {{ $t('progression.graphs.from') }}
            </legend>
            <div class="grid grid-cols-3 gap-2">
              <label
                v-for="option in fromOptions"
                :key="option.value"
                class="option"
                :class="{ on: fromChoice === option.value }"
              >
                <input
                  type="radio"
                  class="sr-only"
                  name="graph-from"
                  :checked="fromChoice === option.value"
                  @change="pickFrom(option.value)"
                />
                <span class="dot" aria-hidden="true" />
                <span class="flex min-w-0 flex-col">
                  <span class="text-sm font-semibold">{{ option.title }}</span>
                  <span class="text-xs text-text-muted">{{ option.hint }}</span>
                </span>
              </label>
            </div>
            <label v-if="fromChoice === 'custom'" class="flex items-center gap-2 text-sm">
              <span class="text-text-secondary">{{ $t('progression.graphs.customFrom') }}</span>
              <input
                type="number"
                inputmode="numeric"
                class="tabular min-h-10 w-40 rounded-md border border-border-strong bg-surface-raised px-3 font-mono text-sm focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none"
                :value="customFrom ?? 0"
                @change="typed('from', $event)"
              />
            </label>
          </fieldset>
          <fieldset class="flex flex-col gap-2">
            <legend class="mb-2 text-sm text-text-secondary">
              {{ $t('progression.graphs.to') }}
            </legend>
            <div class="grid gap-2" :class="toOptions.length === 3 ? 'grid-cols-3' : 'grid-cols-2'">
              <label
                v-for="option in toOptions"
                :key="option.value"
                class="option"
                :class="{ on: toChoice === option.value }"
              >
                <input
                  type="radio"
                  class="sr-only"
                  name="graph-to"
                  :checked="toChoice === option.value"
                  @change="pickTo(option.value)"
                />
                <span class="dot" aria-hidden="true" />
                <span class="flex min-w-0 flex-col">
                  <span class="text-sm font-semibold">{{ option.title }}</span>
                  <span class="text-xs text-text-muted">{{ option.hint }}</span>
                </span>
              </label>
            </div>
            <label v-if="toChoice === 'custom'" class="flex items-center gap-2 text-sm">
              <span class="text-text-secondary">{{ $t('progression.graphs.customTo') }}</span>
              <input
                type="number"
                inputmode="numeric"
                class="tabular min-h-10 w-40 rounded-md border border-border-strong bg-surface-raised px-3 font-mono text-sm focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none"
                :value="customTo ?? 0"
                @change="typed('to', $event)"
              />
            </label>
          </fieldset>
          <label class="option on-plain">
            <input
              type="checkbox"
              class="size-5 shrink-0 accent-[var(--accent)]"
              :checked="current.graph.delta"
              @change="update({ delta: ($event.target as HTMLInputElement).checked })"
            />
            <span class="flex min-w-0 flex-col">
              <span class="text-sm font-semibold">{{ $t('progression.graphs.delta') }}</span>
              <span class="text-xs text-text-muted">{{ $t('progression.graphs.deltaHint') }}</span>
            </span>
          </label>
        </section>
        <hr class="border-border-default" />

        <section aria-labelledby="graphs-preview" class="flex flex-col gap-2.5">
          <h3
            id="graphs-preview"
            class="text-xs font-bold tracking-wider text-text-muted uppercase"
          >
            {{ $t('progression.graphs.preview') }}
          </h3>
          <div class="rounded-xl border border-border-default bg-surface-base p-4">
            <slot name="preview" />
          </div>
        </section>
      </div>
    </div>

    <template #footer>
      <UiButton variant="ghost" class="mr-auto" @click="reset">
        {{ $t('progression.graphs.reset') }}
      </UiButton>
      <UiButton variant="primary" @click="emit('close')">{{
        $t('progression.graphs.done')
      }}</UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
.option {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-width: 0;
  min-height: 3.25rem;
  padding: 0.55rem 0.75rem;
  border: 1px solid var(--border-default);
  border-radius: 0.75rem;
  background: var(--surface-base);
  cursor: pointer;
}
.option.on {
  border-color: var(--accent);
  box-shadow: inset 0 0 0 1px var(--accent);
  background: var(--surface-overlay);
}
.option:has(input:focus-visible) {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.dot {
  flex: none;
  width: 1rem;
  height: 1rem;
  border-radius: 999px;
  border: 2px solid var(--text-muted);
  box-sizing: border-box;
}
.option.on .dot {
  border: 5px solid var(--accent);
  background: var(--surface-raised);
}
</style>
