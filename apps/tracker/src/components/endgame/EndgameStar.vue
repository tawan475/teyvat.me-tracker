<script setup lang="ts">
import { computed } from 'vue'
import { giCdnArt } from '@/lib/assets'

/**
 * The game's own star: the Spiral Abyss star (`UI_Icon_Tower_Star`, drawn in
 * the text colour like the game's record list: dark on light, white on dark)
 * or the Imaginarium Theater's Star Challenge Stella (`UI_Icon_RoleCombat_Star`).
 * A Stella not earned is the same art in grey and faded, so earned or not
 * differs in lightness, never by hue alone; the caller's label or tooltip says
 * which. Both images are on gi-cdn (`extra`).
 */
const props = withDefaults(
  defineProps<{
    kind: 'abyss' | 'theater'
    earned?: boolean
    /** Rendered size in px. */
    size?: number
  }>(),
  { earned: true, size: 18 },
)

const box = computed(() => ({ width: `${props.size}px`, height: `${props.size}px` }))
const mask = computed(() => {
  const url = `url("${giCdnArt('UI_Icon_Tower_Star')}")`
  return {
    ...box.value,
    maskImage: url,
    WebkitMaskImage: url,
  }
})
</script>

<template>
  <span
    v-if="kind === 'abyss'"
    class="inline-block shrink-0 bg-current [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain]"
    :style="mask"
    aria-hidden="true"
  />
  <img
    v-else
    :src="giCdnArt('UI_Icon_RoleCombat_Star')"
    alt=""
    aria-hidden="true"
    data-skeleton="off"
    class="inline-block shrink-0"
    :class="earned ? '' : 'opacity-35 grayscale'"
    :style="box"
  />
</template>
