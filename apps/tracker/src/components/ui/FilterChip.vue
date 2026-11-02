<script setup lang="ts">
import { formatNumber } from '@/lib/format'

/**
 * A filter chip with an optional count: "● Pyro 14". On/off by default
 * (aria-pressed); in a single-choice row (`radio`, inside a radiogroup) it
 * is one of the row's radios. Chosen chips carry the accent as an outline
 * and text, never as a fill. A zero count dims the chip but keeps it
 * clickable. Lead with a colour dot, an icon or a short label.
 */
defineProps<{ pressed: boolean; count?: number; radio?: boolean }>()
defineEmits<{ toggle: [] }>()
</script>

<template>
  <button
    type="button"
    :role="radio ? 'radio' : undefined"
    :aria-pressed="radio ? undefined : pressed"
    :aria-checked="radio ? pressed : undefined"
    class="group inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,scale] duration-150 active:scale-[0.97]"
    :class="[
      pressed
        ? 'border-accent-text bg-surface-overlay text-accent-text'
        : 'border-border-default bg-surface-raised text-text-secondary hover:bg-surface-overlay hover:text-text-primary',
      count === 0 && !pressed ? 'opacity-50' : '',
    ]"
    @click="$emit('toggle')"
  >
    <slot />
    <span
      v-if="count !== undefined"
      class="tabular font-mono"
      :class="pressed ? 'text-accent-text' : 'text-text-muted group-hover:text-text-secondary'"
      >{{ formatNumber(count) }}</span
    >
  </button>
</template>
