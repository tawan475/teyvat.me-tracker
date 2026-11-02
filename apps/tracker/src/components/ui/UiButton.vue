<script setup lang="ts">
import { computed } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import UiSpinner from './UiSpinner.vue'

const props = withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
    size?: 'md' | 'sm'
    type?: 'button' | 'submit'
    to?: RouteLocationRaw
    href?: string
    loading?: boolean
    disabled?: boolean
    block?: boolean
  }>(),
  { variant: 'secondary', size: 'md', type: 'button' },
)

const classes = computed(() => [
  'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap select-none transition-[color,background-color,border-color,box-shadow,scale] duration-150 active:scale-[0.97]',
  'disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
  props.size === 'md' ? 'min-h-10 px-4 text-sm' : 'min-h-8 px-3 text-sm',
  props.block ? 'w-full' : '',
  {
    primary: 'bg-accent text-accent-ink shadow-sm shadow-accent/30 hover:bg-accent-hover',
    secondary:
      'border border-border-strong bg-surface-overlay text-text-secondary shadow-sm hover:bg-surface-raised hover:text-text-primary',
    ghost: 'text-text-secondary hover:bg-surface-overlay hover:text-text-primary',
    danger: 'bg-danger text-white shadow-sm hover:brightness-110',
  }[props.variant],
])
</script>

<template>
  <RouterLink v-if="to" :to="to" :class="classes" :aria-disabled="disabled || undefined">
    <slot />
  </RouterLink>
  <a v-else-if="href" :href="href" :class="classes" target="_blank" rel="noopener noreferrer">
    <slot />
  </a>
  <button v-else :type="type" :class="classes" :disabled="disabled || loading">
    <UiSpinner v-if="loading" class="size-4" />
    <slot />
  </button>
</template>
