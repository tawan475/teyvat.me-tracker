<script setup lang="ts">
import { GripVertical } from 'lucide-vue-next'

/**
 * The sortable row's handle (kit: UiSortableRow, also the Planner's goal
 * cards): the place number over a grip. A drag starts here only
 * (`touch-action: none`, so a finger on it never scrolls the page): `grab`
 * is its pointerdown, `nudge` its keydown (arrows one place, Home / End to
 * the ends, see planner/use-drag-order). Without a `place` it is a bare grip
 * for pointers only (no Tab stop: the row's move button is the keyboard
 * path). 44 px wide on phones, 2u from `sm`. Data attributes fall through to
 * the handle (the drag finds it again by them to keep the focus).
 */
defineProps<{
  /** 1-based place; none: a bare grip, pointer only. */
  place?: number | null
  /** The button's name (place, page, and that the arrow keys move it). */
  label?: string
  title?: string
}>()
const emit = defineEmits<{ grab: [event: PointerEvent]; nudge: [event: KeyboardEvent] }>()
</script>

<template>
  <button
    v-if="place != null"
    type="button"
    class="inline-flex w-[44px] shrink-0 cursor-grab touch-none flex-col items-center justify-center gap-px self-stretch text-text-muted transition-colors select-none hover:bg-surface-overlay hover:text-text-primary focus-visible:bg-surface-overlay focus-visible:text-text-primary focus-visible:-outline-offset-2 active:cursor-grabbing sm:w-8"
    :aria-label="label"
    :title="title"
    @pointerdown="emit('grab', $event)"
    @keydown="emit('nudge', $event)"
  >
    <span class="tabular text-[0.6875rem] leading-none font-bold">{{ place }}</span>
    <GripVertical class="size-3.5" aria-hidden="true" />
  </button>
  <span
    v-else
    class="inline-flex w-[44px] shrink-0 cursor-grab touch-none items-center justify-center self-stretch text-text-muted transition-colors select-none hover:bg-surface-overlay hover:text-text-primary active:cursor-grabbing sm:w-8"
    aria-hidden="true"
    :title="title"
    @pointerdown="emit('grab', $event)"
  >
    <GripVertical class="size-3.5" aria-hidden="true" />
  </span>
</template>
