<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, type Component } from 'vue'
import { ArrowDown, GripVertical, Info } from 'lucide-vue-next'
import { useDragOrder } from '@/components/planner/use-drag-order'
import UiBadge from './UiBadge.vue'
import UiDragGhost from './UiDragGhost.vue'
import UiSortableRow from './UiSortableRow.vue'
import {
  addToEnd,
  dropKey,
  nudgeKey,
  overEmpty,
  overOther,
  overRow,
  removeKey,
  type SortFrom,
  type SortOver,
  type SortResult,
  type SortSaid,
} from './sortable'

export interface SortableItem {
  key: string
  label: string
  icon?: Component
}

/** Every text the box shows, in the language on screen. */
export interface SortableTexts {
  ordered: string
  orderedHint: string
  other: string
  full: string
  fullHint: string
  last: string
  lastHint: string
  dropHere: string
  /** The swap target's mark ("→ More"). */
  toOther: string
  /** A bare grip's title (an other-list row). */
  otherGripTitle: string
  handleLabel: (name: string, n: number) => string
  handleTitle: (n: number) => string
  toOtherLabel: (name: string) => string
  toOrderedLabel: (name: string) => string
  /** The lifted copy's badge: a place in the ordered list, a swap. */
  badgePlace: (n: number) => string
  badgeSwap: (n: number) => string
  /** The aria-live line after a move. */
  said: (said: SortSaid, names: (key: string) => string) => string
}

/**
 * Kit: the two-list box. An ordered list (numbered places, `min` to `max`
 * keys, empty places dashed) beside the rest in their fixed order (`items`'
 * order; not sortable within itself). Side by side when the box is wide
 * enough, stacked otherwise (the other list one column on phones).
 *
 * Drag from a handle (pointer events, planner/use-drag-order): a 3 px line
 * with a ring at each end marks the place; into a full list the row under
 * the pointer is the swap target; over the other list it is outlined with
 * "Drop here" (never for the last `min` keys). Near the window's or the
 * dialog body's top or bottom edge (48 px) the list scrolls along, nothing
 * targeted meanwhile. Escape, or a drop outside both lists, cancels. Taps:
 * the row's move button (+ to the end of the ordered list, × back). Keys:
 * arrows / Home / End on an ordered row's handle. Each move emits `change`
 * (the caller saves it and puts the old list back if that fails), washes
 * the moved row once and says where it went (aria-live).
 */
const props = defineProps<{
  /** The ordered list's keys, in order. */
  modelValue: readonly string[]
  /** Every item, in the other list's fixed order. */
  items: readonly SortableItem[]
  max: number
  min: number
  texts: SortableTexts
  otherIcon?: Component
}>()
const emit = defineEmits<{ change: [list: string[]] }>()

const uid = useId()
const limits = computed(() => ({ max: props.max, min: props.min }))
const byKey = computed(() => new Map(props.items.map((item) => [item.key, item])))
const ordered = computed(() =>
  props.modelValue.flatMap((key) => {
    const item = byKey.value.get(key)
    return item ? [item] : []
  }),
)
const list = computed(() => ordered.value.map((item) => item.key))
const others = computed(() => props.items.filter((item) => !list.value.includes(item.key)))
const full = computed(() => list.value.length >= props.max)
const last = computed(() => list.value.length <= props.min)
const empties = computed(() =>
  Array.from(
    { length: Math.max(0, props.max - list.value.length) },
    (_, i) => list.value.length + i + 1,
  ),
)
const name = (key: string) => byKey.value.get(key)?.label ?? key

/** Drag ids are this box's, so two boxes on one page (Settings + the globe dialog) stay apart. */
const dragId = (key: string) => `${uid}:${key}`
const keyOf = (id: string) => id.slice(uid.length + 1)
const fromOf = (key: string): SortFrom => (list.value.includes(key) ? 'ordered' : 'other')

const root = ref<HTMLElement | null>(null)
function target(x: number, y: number, id: string): SortOver | null {
  const el = document.elementFromPoint(x, y)
  if (!el || !root.value?.contains(el)) return null
  const key = keyOf(id)
  const from = fromOf(key)
  const row = el.closest<HTMLElement>('[data-sort-row="ordered"]')
  if (row) {
    const rect = row.getBoundingClientRect()
    const lower = y >= rect.top + rect.height / 2
    return overRow(list.value, key, from, Number(row.dataset.sortIndex), lower, limits.value)
  }
  if (el.closest('[data-sort-slot]')) return overEmpty(list.value, key, from, limits.value)
  if (el.closest('[data-sort-box="other"]')) return overOther(list.value, from, limits.value)
  return null
}

const said = ref('')
const moved = ref<string | null>(null)
let washTimer: ReturnType<typeof setTimeout> | undefined
function apply(result: SortResult | null) {
  if (!result) return
  emit('change', result.list)
  said.value = props.texts.said(result.said, name)
  moved.value = result.said.key
  clearTimeout(washTimer)
  // The wash comes in quickly and fades out over 1.2 s (the row's transitions).
  washTimer = setTimeout(() => (moved.value = null), 260)
}
onBeforeUnmount(() => clearTimeout(washTimer))

const drag = useDragOrder<SortOver>({
  target,
  drop: (id, over) => {
    const key = keyOf(id)
    apply(dropKey(list.value, key, fromOf(key), over, limits.value))
  },
  same: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  step: (id, by) => apply(nudgeKey(list.value, keyOf(id), by)),
  handle: 'sort-handle',
  edge: { band: 48, speed: 16, ramp: true, blind: true, inset: 'tab-bar' },
})
const draggedKey = computed(() => (drag.dragging.value ? keyOf(drag.dragging.value) : null))
const over = computed(() => drag.over.value)
const atLine = computed(() => (over.value && 'at' in over.value ? over.value.at : -1))
const swapAt = computed(() => (over.value && 'swap' in over.value ? over.value.swap : -1))
const otherDrop = computed(() => !!over.value && 'other' in over.value)

function rowState(key: string, index: number | null) {
  if (draggedKey.value === key) return 'source' as const
  if (index !== null && swapAt.value === index) return 'swap' as const
  if (moved.value === key) return 'moved' as const
  return 'rest' as const
}

const ghost = computed(() => {
  const key = draggedKey.value
  if (!key) return null
  const place = list.value.indexOf(key)
  const o = over.value
  let badge: string | null = null
  if (o && 'other' in o) badge = props.texts.other
  else if (o && 'swap' in o) badge = props.texts.badgeSwap(o.swap + 1)
  else if (o) {
    const result = dropKey(list.value, key, fromOf(key), o, limits.value)
    if (result && result.said.kind === 'place') badge = props.texts.badgePlace(result.said.n)
  }
  return { item: byKey.value.get(key), place: place >= 0 ? place + 1 : null, badge }
})
</script>

<template>
  <div ref="root" class="flex flex-wrap items-stretch gap-4">
    <div class="min-w-0 [flex:1_1_13rem]">
      <div
        role="group"
        :aria-label="texts.ordered"
        data-sort-box="ordered"
        class="relative h-full rounded-xl border border-border-default bg-surface-sunken p-2"
      >
        <div
          class="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1.5 px-1.5 pt-0.5 pb-2 text-[0.875rem] font-semibold text-text-secondary"
          :title="texts.orderedHint"
        >
          <span>{{ texts.ordered }}</span>
          <UiBadge mono>{{ list.length }}/{{ max }}</UiBadge>
          <Info class="size-3.5 text-text-muted" aria-hidden="true" />
          <span
            v-if="last"
            class="inline-flex items-center gap-1 font-medium"
            :title="texts.lastHint"
          >
            · {{ texts.last }} <Info class="size-3.5 text-text-muted" aria-hidden="true" />
          </span>
        </div>
        <div class="flex flex-col gap-1">
          <template v-for="(item, i) in ordered" :key="item.key">
            <div v-if="atLine === i" class="drop-line" aria-hidden="true"><i /></div>
            <UiSortableRow
              data-sort-row="ordered"
              :data-sort-index="i"
              :place="i + 1"
              :icon="item.icon"
              :label="item.label"
              action="remove"
              :disabled="last"
              :reason="texts.lastHint"
              :move-label="texts.toOtherLabel(item.label)"
              :handle-label="texts.handleLabel(item.label, i + 1)"
              :handle-title="texts.handleTitle(i + 1)"
              :handle-attrs="{ 'data-sort-handle': dragId(item.key) }"
              :state="rowState(item.key, i)"
              :swap-text="texts.toOther"
              @grab="drag.start(dragId(item.key), $event)"
              @nudge="drag.key(dragId(item.key), $event)"
              @move="apply(removeKey(list, item.key, limits))"
            />
          </template>
          <div v-if="atLine === ordered.length" class="drop-line" aria-hidden="true"><i /></div>
          <div
            v-for="n in empties"
            :key="`empty-${n}`"
            data-sort-slot
            class="flex min-h-[48px] items-center gap-2 rounded-[0.375rem] border border-dashed border-border-strong pl-4 text-[0.875rem] text-text-muted sm:min-h-10 sm:pl-2.5"
          >
            <span class="tabular text-[0.6875rem] font-bold">{{ n }}</span>
            <span aria-hidden="true">—</span>
          </div>
        </div>
      </div>
    </div>
    <div class="min-w-0 [flex:999_1_20rem]">
      <div
        role="group"
        :aria-label="texts.other"
        data-sort-box="other"
        class="relative h-full rounded-xl border p-2 transition-colors"
        :class="
          otherDrop
            ? 'border-accent-text bg-surface-overlay ring-1 ring-accent-text ring-inset'
            : 'border-border-default bg-surface-sunken'
        "
      >
        <div
          class="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1.5 px-1.5 pt-0.5 pb-2 text-[0.875rem] font-semibold text-text-secondary"
        >
          <component
            :is="otherIcon"
            v-if="otherIcon"
            class="size-3.5 text-text-muted"
            aria-hidden="true"
          />
          <span>{{ texts.other }}</span>
          <UiBadge mono>{{ others.length }}</UiBadge>
          <span
            v-if="full"
            class="inline-flex items-center gap-1 font-medium"
            :title="texts.fullHint"
          >
            · {{ texts.full }} <Info class="size-3.5 text-text-muted" aria-hidden="true" />
          </span>
          <span
            v-if="otherDrop"
            class="ml-auto inline-flex items-center gap-1 font-bold text-accent-text"
          >
            <ArrowDown class="size-3.5" aria-hidden="true" />
            {{ texts.dropHere }}
          </span>
        </div>
        <div
          class="grid grid-cols-1 gap-1 sm:grid-cols-[repeat(auto-fill,minmax(min(100%,10rem),1fr))]"
        >
          <UiSortableRow
            v-for="item in others"
            :key="item.key"
            :icon="item.icon"
            :label="item.label"
            action="add"
            :disabled="full"
            :reason="texts.fullHint"
            :move-label="texts.toOrderedLabel(item.label)"
            :handle-title="texts.otherGripTitle"
            :state="rowState(item.key, null)"
            @grab="drag.start(dragId(item.key), $event)"
            @move="apply(addToEnd(list, item.key, limits))"
          />
        </div>
      </div>
    </div>
    <p class="sr-only" aria-live="polite">{{ said }}</p>
    <UiDragGhost v-if="drag.lift.value && ghost" :lift="drag.lift.value" :badge="ghost.badge">
      <template #handle>
        <span
          class="inline-flex w-[44px] shrink-0 flex-col items-center justify-center gap-px text-text-primary sm:w-8"
        >
          <span v-if="ghost.place" class="tabular text-[0.6875rem] leading-none font-bold">{{
            ghost.place
          }}</span>
          <GripVertical class="size-3.5" aria-hidden="true" />
        </span>
      </template>
      <component :is="ghost.item?.icon" v-if="ghost.item?.icon" class="size-4 shrink-0" />
      <span class="min-w-0 flex-1 truncate font-semibold">{{ ghost.item?.label }}</span>
    </UiDragGhost>
  </div>
</template>

<style scoped>
/* The drop place: a 3 px line with a ring at each end (shape, not colour alone). */
.drop-line {
  position: relative;
  z-index: 2;
  height: 0;
  margin: -2px 0;
}
.drop-line i {
  position: absolute;
  inset-inline: 6px;
  top: -1.5px;
  height: 3px;
  border-radius: 2px;
  background: var(--accent-text);
}
.drop-line::before,
.drop-line::after {
  content: '';
  position: absolute;
  top: -5px;
  width: 10px;
  height: 10px;
  border: 2px solid var(--accent-text);
  border-radius: 50%;
  background: var(--surface-raised);
}
.drop-line::before {
  left: -2px;
}
.drop-line::after {
  right: -2px;
}
</style>
