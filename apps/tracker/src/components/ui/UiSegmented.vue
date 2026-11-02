<script setup lang="ts" generic="T extends string | number">
import { useTemplateRef, type Component } from 'vue'
import { formatNumber } from '@/lib/format'

export interface SegmentedOption<V> {
  value: V
  label: string
  /** A lucide icon before the label. */
  icon?: Component
  /** Colour for the icon (e.g. `text-success-text`). */
  iconClass?: string
  /** A count after the label, in tabular figures. */
  count?: number
  disabled?: boolean
  /** Tooltip; icon-only options fall back to the label. */
  title?: string
}

/**
 * Two to five mutually exclusive options (day / month / year, cards / list).
 * The chosen one lifts to surface-raised. Arrow keys move the choice, as
 * with native radios.
 * - `iconOnly`: icons only; the label stays the accessible name and tooltip.
 * - `compact`: options with an icon hide their label below `sm`.
 * - `size`: `sm` (default) is the 45px row height of inputs and selects;
 *   `md` gives 44px+ items for touch-first rows.
 */
const props = withDefaults(
  defineProps<{
    options: SegmentedOption<T>[]
    label: string
    iconOnly?: boolean
    compact?: boolean
    size?: 'sm' | 'md'
  }>(),
  { size: 'sm' },
)
const model = defineModel<T>({ required: true })
const group = useTemplateRef<HTMLElement>('group')

/** Tab stop: the chosen option, else the first enabled one. */
function tabStop(index: number): boolean {
  const chosen = props.options.findIndex((o) => o.value === model.value && !o.disabled)
  return index === (chosen >= 0 ? chosen : props.options.findIndex((o) => !o.disabled))
}

function move(from: number, by: 1 | -1) {
  const count = props.options.length
  for (let step = 1; step < count; step++) {
    const index = (from + by * step + count) % count
    const option = props.options[index]!
    if (option.disabled) continue
    model.value = option.value
    group.value?.querySelectorAll<HTMLElement>('[role="radio"]')[index]?.focus()
    return
  }
}

function onKey(event: KeyboardEvent, index: number) {
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') move(index, 1)
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') move(index, -1)
  else return
  event.preventDefault()
}

const hideLabel = (option: SegmentedOption<T>) =>
  props.iconOnly ? 'sr-only' : props.compact && option.icon ? 'sr-only sm:not-sr-only' : ''
</script>

<template>
  <div
    ref="group"
    class="inline-flex shrink-0 rounded-lg bg-surface-overlay p-1"
    role="radiogroup"
    :aria-label="label"
  >
    <button
      v-for="(option, index) in options"
      :key="option.value"
      type="button"
      role="radio"
      :aria-checked="model === option.value"
      :aria-label="iconOnly ? option.label : undefined"
      :title="option.title ?? (iconOnly || (compact && option.icon) ? option.label : undefined)"
      :disabled="option.disabled"
      :tabindex="tabStop(index) ? 0 : -1"
      class="inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-[color,background-color,box-shadow] duration-150 disabled:opacity-50"
      :class="[
        size === 'md' ? 'min-h-10 min-w-10' : 'min-h-8 min-w-8',
        iconOnly ? 'px-0' : compact && option.icon ? 'px-2 sm:px-3' : 'px-3',
        model === option.value
          ? 'bg-surface-raised text-text-primary shadow-sm'
          : 'text-text-secondary enabled:hover:text-text-primary',
      ]"
      @click="model = option.value"
      @keydown="onKey($event, index)"
    >
      <component
        :is="option.icon"
        v-if="option.icon"
        class="size-4 shrink-0"
        :class="option.iconClass"
        aria-hidden="true"
      />
      <span :class="hideLabel(option)">{{ option.label }}</span>
      <!-- On the track, muted text is under 4.5:1: counts step up to secondary there. -->
      <span
        v-if="option.count !== undefined"
        class="tabular font-mono"
        :class="model === option.value ? 'text-text-muted' : 'text-text-secondary'"
        >{{ formatNumber(option.count) }}</span
      >
    </button>
  </div>
</template>
