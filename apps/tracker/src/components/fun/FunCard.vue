<script setup lang="ts">
import type { Component } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import { ChevronRight } from 'lucide-vue-next'
import UiBadge from '@/components/ui/UiBadge.vue'

/**
 * One card of the Fun hub (design A: the Collections hub's card): the page's
 * icon, name and one line on what it does, "New" while it is. Opens the page.
 */
defineProps<{
  to: RouteLocationRaw
  title: string
  pitch: string
  icon: Component
  isNew?: boolean
}>()
</script>

<template>
  <RouterLink
    :to="to"
    class="group flex min-h-32 min-w-0 flex-col gap-2.5 rounded-xl border border-border-default bg-surface-raised p-3 shadow-sm transition-colors hover:border-border-strong hover:bg-surface-overlay focus-visible:outline-2 focus-visible:outline-accent sm:min-h-36 sm:gap-3 sm:p-4"
  >
    <span class="flex min-w-0 items-center gap-3">
      <span
        class="grid size-9 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent-text sm:size-10"
      >
        <component :is="icon" class="size-5" aria-hidden="true" />
      </span>
      <UiBadge v-if="isNew" tone="accent">{{ $t('fun.new') }}</UiBadge>
    </span>
    <!-- Under the icon, not pushed to the foot: a two-line pitch on one card would lift its title above its neighbours'. -->
    <span class="flex min-w-0 items-center gap-1">
      <span class="line-clamp-2 min-w-0 leading-snug font-semibold break-words">{{ title }}</span>
      <ChevronRight
        class="size-5 shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </span>
    <span class="line-clamp-2 min-w-0 text-sm text-text-secondary">{{ pitch }}</span>
  </RouterLink>
</template>
