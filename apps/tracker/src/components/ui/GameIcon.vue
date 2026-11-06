<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ItemArt from './ItemArt.vue'

/**
 * A game image (see `@/lib/assets`) on the game's square cell art for its
 * rarity (ItemArt `small`: the gradient with the knot). Falls back to the
 * item's initials when there is no URL or the image fails, so a missing icon
 * never leaves a broken-image glyph.
 */
const props = withDefaults(
  defineProps<{
    src: string
    name: string
    rarity?: number
    size?: 'xs' | 'sm' | 'md' | 'lg'
    /** Load now rather than near the viewport (a page that shows them all, e.g. the roster). */
    eager?: boolean
    /** Fetch before (`high`: the first screen of a grid) or after the page's other images. */
    priority?: 'high' | 'low'
  }>(),
  { size: 'md' },
)
const failed = ref(false)
watch(
  () => props.src,
  () => (failed.value = false),
)

const initials = computed(() =>
  props.name
    .replace(/[^A-Za-z0-9 ]/g, '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase(),
)
</script>

<template>
  <span
    class="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg"
    :class="[
      { xs: 'size-7', sm: 'size-9', md: 'size-12', lg: 'size-16' }[size],
      'bg-surface-sunken',
    ]"
  >
    <ItemArt :rarity="rarity" small />
    <!-- loading/decoding before src: a lazy image off screen then isn't fetched or decoded.
         Keyed by src: a new picture gets a new <img>, so the old one never lingers while it loads. -->
    <img
      v-if="src && !failed"
      :key="src"
      :loading="eager ? 'eager' : 'lazy'"
      :fetchpriority="priority"
      decoding="async"
      :data-skeleton="rarity ? 'off' : undefined"
      :src="src"
      :alt="name"
      class="relative size-full object-contain"
      @error="failed = true"
    />
    <span v-else class="relative font-mono text-sm text-text-muted" :title="name">{{
      initials
    }}</span>
  </span>
</template>
