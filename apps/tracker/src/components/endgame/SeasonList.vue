<script setup lang="ts">
import { ChevronRight } from 'lucide-vue-next'
import UiBadge from '@/components/ui/UiBadge.vue'
import type { SeasonRow } from '@/data/endgame'

/** A mode's seasons, newest first: id, status, name and period; each opens its season page. */
defineProps<{ rows: readonly SeasonRow[]; label: string }>()
</script>

<template>
  <ul
    class="divide-y divide-border-default overflow-hidden rounded-xl border border-border-default bg-surface-raised shadow-sm"
    :aria-label="label"
  >
    <li v-for="row in rows" :key="row.id">
      <RouterLink
        :to="row.to"
        class="flex min-w-0 items-center gap-3 px-3 py-2.5 transition-colors hover:bg-surface-overlay focus-visible:bg-surface-overlay focus-visible:outline-none sm:gap-4 sm:px-4"
        :class="row.status === 'active' && 'shadow-[inset_3px_0_0_var(--color-success-text)]'"
      >
        <span class="flex w-24 shrink-0 flex-col gap-1 sm:w-28">
          <span class="tabular font-mono text-xs text-text-muted">{{
            $t('endgame.id', { id: row.id })
          }}</span>
          <UiBadge :tone="row.status === 'active' ? 'success' : 'neutral'" class="self-start">{{
            $t(`endgame.status.${row.status}`)
          }}</UiBadge>
        </span>
        <span class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="truncate font-semibold text-text-primary">{{ row.name }}</span>
          <span class="tabular truncate font-mono text-xs text-text-muted">{{ row.period }}</span>
        </span>
        <ChevronRight class="size-4 shrink-0 text-text-muted" aria-hidden="true" />
      </RouterLink>
    </li>
  </ul>
</template>
