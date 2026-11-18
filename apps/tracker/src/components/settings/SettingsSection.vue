<script setup lang="ts">
import type { Component } from 'vue'

/**
 * A group of cards on Settings and Manage (design "Picked mix"): a title
 * column (icon, name, one line) beside a two-column card grid; under 1100 px
 * the title sits above its cards, under 900 px the cards are one column.
 * A card that needs the whole row takes `class="col-span-full"`. Sections
 * after the first are ruled off above. The `link` slot puts a link beside the
 * section's line (Account's Privacy).
 */
defineProps<{ label: string; description?: string; icon?: Component }>()
</script>

<template>
  <section
    class="grid gap-4 border-t border-border-default py-7 first:border-t-0 first:pt-0 min-[1100px]:grid-cols-[240px_minmax(0,1fr)] min-[1100px]:gap-10"
  >
    <header class="flex min-w-0 items-start gap-3 min-[1100px]:flex-col min-[1100px]:gap-2">
      <span
        v-if="icon"
        class="grid size-9 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent-text"
        aria-hidden="true"
      >
        <component :is="icon" class="size-5" />
      </span>
      <div class="min-w-0">
        <h2 class="text-base font-semibold">{{ label }}</h2>
        <p v-if="description" class="text-sm text-text-muted">{{ description }}</p>
      </div>
      <div v-if="$slots.link" class="ms-auto shrink-0 min-[1100px]:ms-0">
        <slot name="link" />
      </div>
    </header>
    <div
      class="grid min-w-0 grid-cols-1 items-start gap-4 min-[900px]:grid-cols-[repeat(auto-fit,minmax(min(100%,22rem),1fr))] min-[1100px]:grid-cols-2"
    >
      <slot />
    </div>
  </section>
</template>
