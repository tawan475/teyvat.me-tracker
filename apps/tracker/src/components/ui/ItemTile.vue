<script setup lang="ts">
import { ref, watch } from 'vue'
import ItemArt from './ItemArt.vue'

/**
 * One item in a bag grid, drawn as the game's bag draws its cells: the
 * game's 80×98 cell art for the rarity (ItemArt: gradient and knot), the
 * picture in its top square, gold stars on the art's foot (`stars`) and the
 * cream strip below, curling up into the art's bottom-right corner as the
 * game's does, with `footer` centred (`footer-end` on its right), in
 * light-theme colours in both themes. A corner slot in each corner over the
 * picture (`top-left`, `top-right`, `bottom-left`, `bottom-right`; the pieces
 * in item-tile.ts). Everything is sized in `cqw` (the tile is its own
 * container), so it scales like the game's cell. The whole tile is one
 * button; `label` is its accessible name and tooltip, so the slots stay
 * visual. `selected` gives it the game's white glow. The Weapons, Artifacts
 * and Materials bags draw their tiles with it.
 */
const props = defineProps<{
  src: string
  name: string
  rarity?: number | null
  label: string
  stars?: boolean
  selected?: boolean
  /** On the first screen of a bag: fetched at once and first, not when laid out (lazy). */
  priority?: boolean
}>()
/** `open` carries the click (its target anchors a popover; pointerType tells touch). */
defineEmits<{ open: [event: MouseEvent] }>()

const failed = ref(false)
watch(
  () => props.src,
  () => (failed.value = false),
)

/** The game's star (GameStars' shape). */
const STAR =
  'M12 1.8l2.95 6.6 7.2.75-5.4 4.85 1.53 7.08L12 17.4l-6.28 3.68 1.53-7.08-5.4-4.85 7.2-.75z'
const CORNER = 'absolute flex items-center gap-[2cqw]'

function initials(name: string): string {
  return name
    .replace(/[^A-Za-z0-9 ]/g, '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
}
</script>

<template>
  <button
    type="button"
    aria-haspopup="dialog"
    :aria-label="label"
    :title="label"
    class="group @container relative block w-full min-w-0 text-left transition-transform hover:-translate-y-px focus-visible:outline-none"
    @click="$emit('open', $event)"
  >
    <span
      class="relative block aspect-[80/98] w-full rounded-[7cqw] transition-[box-shadow,filter] group-hover:brightness-105 group-focus-visible:ring-[1.2cqw] group-focus-visible:ring-accent"
      :class="[
        rarity ? '' : 'bg-linear-to-br from-surface-overlay to-surface-sunken',
        selected ? 'ring-[1.2cqw] ring-white shadow-[0_0_5cqw_rgba(255,255,255,0.75)]' : '',
      ]"
      aria-hidden="true"
    >
      <ItemArt :rarity="rarity" class="rounded-[7cqw]" />
      <img
        v-if="src && !failed"
        :loading="priority ? 'eager' : 'lazy'"
        :fetchpriority="priority ? 'high' : undefined"
        decoding="async"
        :data-skeleton="rarity ? 'off' : undefined"
        :src="src"
        alt=""
        class="absolute inset-x-0 top-0 aspect-square w-full object-contain p-[3cqw]"
        @error="failed = true"
      />
      <span
        v-else
        class="absolute inset-x-0 top-0 flex aspect-square w-full items-center justify-center font-mono text-[16cqw] text-text-muted"
        >{{ initials(name) }}</span
      >
      <span
        v-if="stars && rarity"
        class="absolute inset-x-0 bottom-[19.5cqw] flex justify-center [filter:drop-shadow(0_0.5cqw_0.6cqw_rgba(60,35,0,0.55))]"
      >
        <svg
          v-for="n in rarity"
          :key="n"
          viewBox="0 0 24 24"
          class="size-[15.5cqw] shrink-0"
          aria-hidden="true"
        >
          <path
            :d="STAR"
            fill="var(--game-star)"
            stroke="var(--game-star-edge)"
            stroke-width="0.8"
          />
        </svg>
      </span>
      <!-- The strip's curl: the art's bottom-right corner rounds into the cream
           (the game's UI_ItemSlot_TextBg), a quarter circle cut out of a square. -->
      <span
        class="absolute right-0 bottom-[20.4cqw] size-[19cqw] bg-[radial-gradient(circle_19cqw_at_0_0,transparent_97%,#e9e5dc_100%)]"
      />
      <span
        data-theme="light"
        class="absolute inset-x-0 bottom-0 flex h-[20.5cqw] items-center gap-[2cqw] rounded-b-[7cqw] bg-[#e9e5dc] px-[5cqw] text-[15.5cqw] leading-none font-bold text-[#4a5366]"
        :class="$slots['footer-end'] ? 'justify-between' : 'justify-center'"
      >
        <span v-if="$slots.footer" class="min-w-0 truncate"><slot name="footer" /></span>
        <slot name="footer-end" />
      </span>
      <span
        v-if="$slots['top-left']"
        :class="CORNER"
        class="top-[4cqw] left-[4cqw] flex-col items-start"
      >
        <slot name="top-left" />
      </span>
      <span v-if="$slots['top-right']" :class="CORNER" class="top-[4cqw] right-[4cqw]">
        <slot name="top-right" />
      </span>
      <span v-if="$slots['bottom-left']" :class="CORNER" class="bottom-[24cqw] left-[4cqw]">
        <slot name="bottom-left" />
      </span>
      <span v-if="$slots['bottom-right']" :class="CORNER" class="right-[4cqw] bottom-[24cqw]">
        <slot name="bottom-right" />
      </span>
    </span>
  </button>
</template>
