<script setup lang="ts">
import { useTemplateRef } from 'vue'
import { useStickyToolbar } from '@/lib/sticky-stack'

/**
 * The filter card above a list (Characters, Artifacts, Weapons, Planner
 * goals, Achievements): search, sort and view on the first row, filter chips
 * on the next, selects and the "shown / total · Clear" readout last. The
 * card, padding and row gap live here; the rows are the page's own.
 * `sticky`: pinned flush under the app bar from lg (squared top while pinned,
 * lib/sticky-stack), with a table's header under it (lib/sticky-head).
 */
const props = defineProps<{
  label: string
  /** Stays under the app bar while the list below scrolls past (from lg: on phones it would fill the screen). */
  sticky?: boolean
}>()
const root = useTemplateRef<HTMLElement>('root')
useStickyToolbar(root, () => !!props.sticky)
</script>

<template>
  <div
    ref="root"
    class="flex flex-col gap-3 rounded-xl border border-border-default bg-surface-raised p-3 shadow-sm sm:p-4"
    :class="
      sticky &&
      'lg:sticky lg:top-[var(--app-bar-bottom,4rem)] lg:z-20 data-[stuck]:rounded-none data-[stuck]:border-t-0 data-[stuck]:shadow-md'
    "
    role="search"
    :aria-label="label"
  >
    <slot />
  </div>
</template>
