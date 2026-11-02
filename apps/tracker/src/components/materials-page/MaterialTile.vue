<script setup lang="ts">
import ItemTile from '@/components/ui/ItemTile.vue'
import { formatCompact, formatSigned } from '@/lib/format'

/** The game writes counts plain ("7453"); only the very large ones are shortened here. */
const bagCount = (n: number) => (n < 100_000 ? String(n) : formatCompact(n))

/**
 * One material in the bag, as the game draws it: the picture on its
 * rarity's cell with its stars, the count along the foot (plain, as the game
 * writes it; shortened from 100,000) (in the accent when set by hand
 * on the Planner). Over the picture: the change in the period (top right)
 * and a dot when it is tracked (top left). Dimmed at 0. Words in `label`.
 */
defineProps<{
  name: string
  src: string
  /** The game's (material index); null for a key newer than the data. */
  rarity: number | null
  /** The count shown (the hand-set one where the Planner has one). */
  count: number
  change: number
  tracked: boolean
  edited: boolean
  label: string
  /** Not dimmed at 0 ("Don't have": every tile is). */
  undimmed?: boolean
}>()
defineEmits<{ open: [event: MouseEvent] }>()
</script>

<template>
  <ItemTile
    :src="src"
    :name="name"
    :rarity="rarity"
    :label="label"
    stars
    :class="count === 0 && !undimmed ? 'opacity-50 grayscale' : ''"
    @open="$emit('open', $event)"
  >
    <template v-if="tracked" #top-left>
      <span class="size-[9cqw] rounded-full bg-accent ring-[1.5cqw] ring-white/85" />
    </template>
    <template v-if="change" #top-right>
      <span
        class="tabular rounded-[3cqw] bg-[#3b4255]/90 px-[2.5cqw] py-[1cqw] text-[11cqw] leading-none font-semibold"
        :class="change > 0 ? 'text-[#7ee2a8]' : 'text-[#ff9b8a]'"
        >{{ formatSigned(change) }}</span
      >
    </template>
    <template #footer>
      <span class="tabular" :class="edited ? 'text-accent-text' : ''">{{ bagCount(count) }}</span>
    </template>
  </ItemTile>
</template>
