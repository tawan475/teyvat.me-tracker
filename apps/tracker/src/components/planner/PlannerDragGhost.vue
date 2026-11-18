<script setup lang="ts">
import type { ShallowRef } from 'vue'
import { GripVertical } from 'lucide-vue-next'
import UiDragGhost from '@/components/ui/UiDragGhost.vue'
import type { DragLift } from './use-drag-order'

/**
 * The lifted copy of the goal card being dragged (UiDragGhost, the tab bar's
 * look). It takes the drag's `lift` ref itself and reads it here: `lift`
 * changes on every pointer move, so only this small component re-renders
 * then, never the whole Planner.
 */
defineProps<{
  lift: Readonly<ShallowRef<DragLift | null>>
  rank: number
  name: string
  icon: string
  badge: string | null
}>()
</script>

<template>
  <UiDragGhost v-if="lift.value" :lift="lift.value" :badge="badge">
    <template #handle>
      <span
        class="inline-flex w-[44px] shrink-0 flex-col items-center justify-center gap-px text-text-primary sm:w-8"
      >
        <span class="tabular text-[0.6875rem] leading-none font-bold">{{ rank }}</span>
        <GripVertical class="size-3.5" aria-hidden="true" />
      </span>
    </template>
    <img
      v-if="icon"
      :src="icon"
      alt=""
      class="size-[30px] shrink-0 rounded-md bg-surface-overlay object-cover"
    />
    <span class="min-w-0 flex-1 truncate font-semibold">{{ name }}</span>
  </UiDragGhost>
</template>
