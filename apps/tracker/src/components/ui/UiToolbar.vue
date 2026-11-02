<script setup lang="ts">
/**
 * The filter card above a list (Characters, Artifacts, Weapons, Planner
 * goals, Achievements): search, sort and view on the first row, filter chips
 * on the next, selects and the "shown / total · Clear" readout last. The
 * card, padding and row gap live here; the rows are the page's own.
 */
defineProps<{
  label: string
  /** Stays under the app bar while the list below scrolls past (from lg: on phones it would fill the screen). */
  sticky?: boolean
}>()
</script>

<template>
  <div
    class="flex flex-col gap-3 rounded-xl border border-border-default bg-surface-raised p-3 shadow-sm sm:p-4"
    :class="sticky && 'lg:sticky lg:top-[4.5rem] lg:z-20'"
    role="search"
    :aria-label="label"
  >
    <slot />
  </div>
</template>
