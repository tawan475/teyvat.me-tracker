<script setup lang="ts">
import { computed, ref, watch } from 'vue'

/**
 * A Stygian boss's picture standing on its ground, whole (object-contain;
 * the game's art, which has room around the boss, 15% closer).
 * Without one (no host has it, or it fails) the boss's initials in a disc,
 * so a missing picture never shows a broken image or its alt text.
 */
const props = defineProps<{
  src: string
  name: string
  /** The game's boss art (a square with room around the boss): drawn closer, by `zoom` (1.15). */
  art?: boolean
  zoom?: number
}>()
const failed = ref(false)
watch(
  () => props.src,
  () => (failed.value = false),
)
const initials = computed(() =>
  props.name
    .split(/[\s:-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase(),
)
</script>

<template>
  <img
    v-if="src && !failed"
    :src="src"
    :alt="name"
    loading="lazy"
    decoding="async"
    class="object-contain drop-shadow-lg"
    :style="art ? { transform: `scale(${zoom ?? 1.15})` } : undefined"
    @error="failed = true"
  />
  <span v-else role="img" :aria-label="name" class="flex items-center justify-center">
    <span
      class="flex aspect-square w-1/2 max-w-24 items-center justify-center rounded-full bg-surface-overlay/80 text-lg font-bold text-text-secondary"
      >{{ initials }}</span
    >
  </span>
</template>
