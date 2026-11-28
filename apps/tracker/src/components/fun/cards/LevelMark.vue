<script setup lang="ts">
import { HARDEST, type CardLevel } from '@/data/challenge-cards'

/**
 * A card's difficulty as a picture (the user's pick, design board E): four
 * rising bars like a signal meter, 1 lit for trivial to 4 for hard, and the
 * Ⓜ️ emoji itself for the hardest. The lit bars differ from the unlit ones
 * in lightness, and the level's word always stands beside the bars, so it
 * never reads by colour alone.
 */
defineProps<{ level: CardLevel; large?: boolean }>()
</script>

<template>
  <span
    v-if="level === HARDEST"
    class="leading-none"
    :class="large ? 'text-2xl' : 'text-base'"
    aria-hidden="true"
    >Ⓜ️</span
  >
  <span
    v-else
    class="inline-flex items-end"
    :class="large ? 'h-4 gap-[3px]' : 'h-3 gap-0.5'"
    aria-hidden="true"
  >
    <span
      v-for="n in 4"
      :key="n"
      class="rounded-[1px]"
      :class="[large ? 'w-[5px]' : 'w-1', n <= level + 1 ? 'bg-text-primary' : 'bg-border-strong']"
      :style="{ height: `${n * 25}%` }"
    />
  </span>
</template>
