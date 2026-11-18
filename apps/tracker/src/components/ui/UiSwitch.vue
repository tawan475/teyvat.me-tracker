<script setup lang="ts">
/**
 * On/off setting with its label and an optional description; `disabled` shows it, locked.
 * `states` also names the state beside the track ("On" / "Off"), so it reads without colour.
 */
defineProps<{
  label: string
  description?: string
  disabled?: boolean
  states?: { on: string; off: string }
}>()
const model = defineModel<boolean>({ required: true })
</script>

<template>
  <label
    class="flex items-start justify-between gap-4 py-2"
    :class="disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'"
  >
    <span class="flex min-w-0 flex-col">
      <span class="text-sm font-medium">{{ label }}</span>
      <span v-if="description" class="text-sm text-text-muted">{{ description }}</span>
    </span>
    <span class="mt-0.5 inline-flex shrink-0 items-center gap-2">
      <span v-if="states" class="text-xs font-semibold text-text-secondary" aria-hidden="true">
        {{ model ? states.on : states.off }}
      </span>
      <span class="relative inline-flex">
        <input
          v-model="model"
          type="checkbox"
          role="switch"
          class="peer sr-only"
          :disabled="disabled"
        />
        <span
          class="h-6 w-11 rounded-full bg-surface-overlay ring-1 ring-border-strong transition-colors ring-inset peer-checked:bg-accent peer-checked:ring-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus-ring"
        />
        <span
          class="absolute top-1 left-1 size-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5"
        />
      </span>
    </span>
  </label>
</template>
