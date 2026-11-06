<script setup lang="ts">
import type { AscensionPhase } from '@gdt/game-data'
import { computed, useTemplateRef } from 'vue'
import { levelGrid, pairAbove, shownSteps, stepIndex, type LevelStep } from './level-grid'

/**
 * One-click level buttons (level-grid.ts): 1, 20, 20✦ … 90, a level and
 * ascension each. The chosen one is filled; with `from` (the goal grid gets
 * "now") the steps between are tinted and the ones below it muted; steps
 * below `min` can't be picked (the "now" grid: a state set by hand only
 * counts ahead of the capture). A radio group: arrow keys move the choice
 * (up/down a row), Home/End jump.
 */
const props = defineProps<{
  phases: readonly AscensionPhase[]
  level: number
  ascension: number
  label: string
  /** Where the range starts (the current level, on the goal grid). */
  from?: { level: number; ascension: number } | null
  /** The lowest pair that can be picked. */
  min?: { level: number; ascension: number } | null
}>()
const emit = defineEmits<{ pick: [step: LevelStep] }>()
const group = useTemplateRef<HTMLElement>('group')

const COLUMNS = 7
const steps = computed(() => levelGrid(props.phases))
const chosen = computed(() =>
  stepIndex(steps.value, { level: props.level, ascension: props.ascension }),
)
const start = computed(() => (props.from ? stepIndex(steps.value, props.from) : -1))
/** The chosen button shows the level as it is (a capture's 71, not 70✦). */
const buttons = computed(() =>
  shownSteps(steps.value, { level: props.level, ascension: props.ascension }),
)

const floor = computed(() => (props.min ? stepIndex(steps.value, props.min) : 0))
const blocked = (index: number) => index < floor.value

function tone(index: number, step: LevelStep) {
  if (index === chosen.value) return 'bg-accent text-accent-ink shadow-sm'
  if (blocked(index)) return 'cursor-not-allowed text-text-muted/60'
  if (props.from && index > start.value && index < chosen.value) {
    return 'bg-accent/15 text-text-primary hover:bg-accent/25'
  }
  if (props.from && pairAbove(props.from, step)) {
    return 'text-text-muted hover:bg-surface-overlay hover:text-text-secondary'
  }
  return 'text-text-secondary hover:bg-surface-overlay hover:text-text-primary'
}

function pick(index: number, focus = false) {
  const step = steps.value[index]
  if (!step || blocked(index)) return
  emit('pick', step)
  if (focus) group.value?.querySelectorAll<HTMLElement>('[role="radio"]')[index]?.focus()
}

function onKey(event: KeyboardEvent, index: number) {
  const last = steps.value.length - 1
  const to = {
    ArrowRight: index + 1,
    ArrowLeft: index - 1,
    ArrowDown: index + COLUMNS,
    ArrowUp: index - COLUMNS,
    Home: 0,
    End: last,
  }[event.key]
  if (to === undefined) return
  event.preventDefault()
  pick(Math.max(floor.value, Math.min(last, to)), true)
}
</script>

<template>
  <div
    ref="group"
    role="radiogroup"
    :aria-label="label"
    class="grid grid-cols-7 gap-1 rounded-lg bg-surface-sunken p-1"
  >
    <button
      v-for="(step, index) in buttons"
      :key="index"
      type="button"
      role="radio"
      :aria-checked="index === chosen"
      :aria-disabled="blocked(index) || undefined"
      :tabindex="index === (chosen >= 0 ? chosen : floor) ? 0 : -1"
      :title="
        blocked(index)
          ? $t('planner.levelGrid.below')
          : step.ascended
            ? $t('planner.levelGrid.ascended', { level: step.level, ascension: step.ascension })
            : $t('planner.levelGrid.level', { level: step.level, ascension: step.ascension })
      "
      class="tabular inline-flex min-h-10 items-center justify-center rounded-md font-mono text-sm font-medium transition-colors"
      :class="tone(index, step)"
      @click="pick(index)"
      @keydown="onKey($event, index)"
    >
      {{ step.level
      }}<span v-if="step.ascended" class="ml-px text-[0.8em] leading-none" aria-hidden="true"
        >✦</span
      >
      <span v-if="step.ascended" class="sr-only">{{ $t('planner.levelGrid.ascendedWord') }}</span>
    </button>
  </div>
</template>
