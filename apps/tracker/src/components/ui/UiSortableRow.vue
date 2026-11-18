<script setup lang="ts">
import type { Component } from 'vue'
import { ArrowLeftRight, Plus, X } from 'lucide-vue-next'
import UiSortableHandle from './UiSortableHandle.vue'

/**
 * Kit: one row of a sortable list (UiSortableLists; the Planner's goal
 * cards share its handle and drag look). Handle (UiSortableHandle: place
 * number over a grip, or a bare grip) | the page (icon + name, one line) |
 * the action (× removes, + adds). The move button is the whole rest of the
 * row: a tap or Enter moves the page to the other list; disabled, its
 * `reason` is the title. Every state differs by line style or lightness as
 * well as colour: `source` (its own place while dragged: dashed, faded),
 * `swap` (the full list's target: dashed accent outline, name struck, the
 * ⇄ text), `moved` (one accent wash after a move). Phones: handle 44 px,
 * row 48 px, action 36 px; from `sm` 2u / 2.5u / 1.75u.
 */
defineProps<{
  /** 1-based place in an ordered list; none: a bare grip (pointer only). */
  place?: number | null
  icon?: Component
  label: string
  action: 'add' | 'remove'
  disabled?: boolean
  /** Why it is disabled (the title then). */
  reason?: string
  moveLabel: string
  handleLabel?: string
  handleTitle?: string
  state?: 'rest' | 'source' | 'swap' | 'moved'
  /** The swap target's text ("→ More"). */
  swapText?: string
  /** Data attributes for the handle (the drag finds it again by them to keep the focus). */
  handleAttrs?: Record<string, string>
}>()
const emit = defineEmits<{
  grab: [event: PointerEvent]
  nudge: [event: KeyboardEvent]
  move: []
}>()
</script>

<template>
  <div
    data-drag-item
    class="relative flex min-h-[48px] min-w-0 items-stretch rounded-[0.375rem] border text-text-primary transition-[background-color,border-color] sm:min-h-10"
    :class="
      {
        rest: 'border-border-default bg-surface-raised duration-[1200ms] hover:border-border-strong',
        source: 'border-dashed border-border-strong bg-transparent [&>*]:opacity-45',
        swap: 'border-dashed border-accent-text bg-surface-overlay ring-1 ring-accent-text ring-inset',
        moved:
          'border-accent-text bg-[color-mix(in_srgb,var(--accent)_16%,var(--surface-raised))] duration-200',
      }[state ?? 'rest']
    "
  >
    <UiSortableHandle
      :place="place"
      :label="handleLabel"
      :title="handleTitle"
      class="rounded-l-[0.375rem]"
      v-bind="handleAttrs"
      @grab="emit('grab', $event)"
      @nudge="emit('nudge', $event)"
    />
    <button
      type="button"
      class="group flex min-w-0 flex-1 items-center gap-2 rounded-r-[0.375rem] px-1 text-left text-[0.875rem] focus-visible:-outline-offset-2 disabled:cursor-not-allowed"
      :disabled="disabled"
      :aria-label="moveLabel"
      :title="disabled ? reason : moveLabel"
      @click="emit('move')"
    >
      <component :is="icon" v-if="icon" class="size-4 shrink-0" aria-hidden="true" />
      <span
        class="min-w-0 flex-1 truncate"
        :class="state === 'swap' ? 'text-text-secondary line-through decoration-1' : ''"
        >{{ label }}</span
      >
      <span
        v-if="state === 'swap' && swapText"
        class="mr-1 inline-flex max-w-[55%] shrink-0 items-center gap-1 truncate rounded-[4.5px] border border-accent-text bg-surface-raised px-1.5 py-0.5 text-[0.6875rem] font-bold whitespace-nowrap text-accent-text"
      >
        <ArrowLeftRight class="size-[13px] shrink-0" aria-hidden="true" />
        {{ swapText }}
      </span>
      <span
        class="grid size-[36px] shrink-0 place-items-center rounded-md text-text-muted group-hover:bg-surface-overlay group-hover:text-text-primary group-disabled:bg-transparent group-disabled:text-text-muted group-disabled:opacity-50 sm:size-7"
        aria-hidden="true"
      >
        <Plus v-if="action === 'add'" class="size-4" />
        <X v-else class="size-4" />
      </span>
    </button>
  </div>
</template>
