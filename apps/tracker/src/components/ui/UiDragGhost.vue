<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { DragLift } from '@/components/planner/use-drag-order'

/**
 * The lifted copy that follows the pointer while a sortable item is dragged
 * (the tab bar's lists and the Planner's goal cards share it): the item's
 * handle stays under the pointer where it was grabbed; shadow, an accent
 * outline and a slight tilt; `badge` names where it lands (none while
 * nothing is targeted). It sits in the top layer (a manual popover), so it
 * shows over a modal dialog too, and never takes the pointer.
 */
defineProps<{ lift: DragLift; badge?: string | null }>()
const el = ref<HTMLElement | null>(null)
onMounted(() => {
  try {
    el.value?.showPopover?.()
  } catch {
    // No popover support: it is still fixed over the page.
  }
})
</script>

<template>
  <div
    ref="el"
    popover="manual"
    aria-hidden="true"
    class="pointer-events-none fixed inset-auto z-50 m-0 flex min-h-[48px] -rotate-[1.5deg] items-stretch gap-2 overflow-visible rounded-[0.375rem] border border-accent-text bg-surface-raised p-0 pr-1.5 text-[0.875rem] text-text-primary shadow-overlay sm:min-h-10"
    :style="{
      left: `${lift.x - lift.dx}px`,
      top: `${lift.y - lift.dy}px`,
      width: 'max-content',
      minWidth: `${lift.width}px`,
      maxWidth: 'min(20rem, calc(100vw - 1rem))',
    }"
  >
    <slot name="handle" />
    <span class="flex min-w-0 flex-1 items-center gap-2">
      <slot />
      <span
        v-if="badge"
        class="tabular shrink-0 rounded bg-accent px-1.5 py-0.5 font-mono text-xs font-bold whitespace-nowrap text-accent-ink"
        >{{ badge }}</span
      >
    </span>
  </div>
</template>
