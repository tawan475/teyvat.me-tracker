<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check } from 'lucide-vue-next'
import ElementIcon from '@/components/ui/ElementIcon.vue'
import ItemArt from '@/components/ui/ItemArt.vue'
import type { Element } from '@/data/game-meta'

/**
 * A goal card's portrait, drawn as the game draws one: the picture on its
 * rarity's cell (the game's gradient with the knot, ItemArt `small`), the element in a corner disc and a corner tag
 * ("C1" for a character's constellation, "R5" for a weapon's refinement).
 * A custom character (no picture) gets its initials in a dashed frame.
 * While picking cards, a tick sits on it. 64 px on phones, 72 from `sm`;
 * `size` sm is 48 / 56 px without the corner tag (a row of them).
 */
const props = withDefaults(
  defineProps<{
    src: string
    name: string
    rarity: number | null
    element?: Element | null
    /** "C1", "R5" (none: nothing). */
    tag?: string
    tagTitle?: string
    custom?: boolean
    /** Picking cards: null when not, else whether this one is picked. */
    picked?: boolean | null
    size?: 'md' | 'sm'
  }>(),
  // A boolean prop left out would read false (picking, nothing picked): null is "not picking".
  { element: null, tag: '', tagTitle: undefined, picked: null, size: 'md' },
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
    class="relative inline-block shrink-0"
    :class="size === 'sm' ? 'size-12 sm:size-14' : 'size-16 sm:size-18'"
  >
    <span
      class="relative block size-full overflow-hidden rounded-xl bg-surface-sunken"
      :class="custom && !src ? 'outline-1 outline-border-strong outline-dashed' : ''"
    >
      <ItemArt :rarity="rarity" small />
      <img
        v-if="src && !failed"
        :key="src"
        loading="lazy"
        decoding="async"
        :src="src"
        :alt="name"
        class="relative size-full object-contain"
        @error="failed = true"
      />
      <span
        v-else
        class="relative flex size-full items-center justify-center font-mono text-base text-text-muted"
        :title="name"
        >{{ initials }}</span
      >
    </span>
    <span
      v-if="tag && size !== 'sm'"
      class="tabular absolute top-1 left-1 rounded bg-surface-raised/85 px-1 font-mono text-[0.625rem] leading-4 font-semibold text-text-primary shadow-sm"
      :title="tagTitle"
      >{{ tag }}</span
    >
    <span
      v-if="element"
      class="absolute -right-1 -bottom-1 inline-flex rounded-full bg-surface-raised p-0.5 shadow-sm ring-1 ring-border-subtle"
    >
      <ElementIcon :element="element" />
    </span>
    <span
      v-if="picked !== null"
      class="absolute -top-1 -left-1 inline-flex size-5 items-center justify-center rounded-full border-2"
      :class="
        picked
          ? 'border-accent bg-accent text-accent-ink'
          : 'border-border-strong bg-surface-raised'
      "
      aria-hidden="true"
    >
      <Check v-if="picked" class="size-3" />
    </span>
  </span>
</template>
