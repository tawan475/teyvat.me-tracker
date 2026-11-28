<script setup lang="ts">
import { Check } from 'lucide-vue-next'
import { gameIcon } from '@/lib/assets'

export interface NamecardEntry {
  id: number
  name: string
  /** The card's picture (a game image name), '' for none. */
  icon: string
  have: boolean
}

/**
 * Namecards as their pictures (the user's pick, design B): the name under
 * each, a tick on the ones owned, a dashed outline, a faded picture and the
 * word "Missing" on the rest, so owned and missing never differ by colour alone.
 */
defineProps<{ entries: readonly NamecardEntry[]; label: string }>()

const failed = (event: Event) => {
  ;(event.target as HTMLImageElement).hidden = true
}
</script>

<template>
  <ul
    class="grid gap-x-3 gap-y-4 [--card:9.5rem] sm:[--card:12rem]"
    style="grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--card)), 1fr))"
    :aria-label="label"
  >
    <li
      v-for="entry in entries"
      :key="entry.id"
      class="flex min-w-0 flex-col gap-1.5 [content-visibility:auto] [contain-intrinsic-size:auto_8rem]"
      :title="entry.name"
    >
      <div
        class="relative aspect-[21/10] overflow-hidden rounded-lg bg-surface-sunken"
        :class="
          entry.have
            ? 'border border-border-default'
            : 'border-2 border-dashed border-border-strong'
        "
      >
        <img
          v-if="entry.icon && gameIcon(entry.icon)"
          :src="gameIcon(entry.icon)"
          alt=""
          loading="lazy"
          decoding="async"
          class="size-full object-cover"
          :class="!entry.have && 'opacity-35 grayscale'"
          @error="failed"
        />
        <span
          v-if="entry.have"
          class="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-full bg-surface-raised text-accent-text shadow-sm"
        >
          <Check class="size-4" :stroke-width="3" aria-hidden="true" />
          <span class="sr-only">{{ $t('collections.spincrystals.filters.have') }}</span>
        </span>
        <span
          v-else
          class="absolute bottom-1.5 left-1.5 rounded-sm bg-surface-raised px-1.5 py-0.5 text-xs text-text-secondary"
          >{{ $t('collections.spincrystals.filters.missing') }}</span
        >
      </div>
      <span
        class="truncate text-sm"
        :class="entry.have ? 'font-medium text-text-primary' : 'text-text-muted'"
        >{{ entry.name }}</span
      >
    </li>
  </ul>
</template>
