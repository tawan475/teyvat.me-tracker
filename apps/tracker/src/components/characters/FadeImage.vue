<script setup lang="ts">
import { ref, watch } from 'vue'
import { isDecoded, markDecoded } from '@/lib/image-preload'

/**
 * A character image that never shows the previous character's picture: a
 * new <img> per `src` (keyed), invisible until its own picture has loaded,
 * then faded in; at once when it was preloaded and decoded already
 * (lib/image-preload).
 * Whatever sits behind it (a disc, a rarity strip) shows meanwhile, so it
 * opts out of the site's loading look (lib/image-loading): its square box drawn
 * over a round disc or a white glyph read as broken (the user, 2026-11-07).
 * Attributes (class, alt) go to the <img>.
 */
const props = defineProps<{ src: string }>()
const loaded = ref(isDecoded(props.src))
watch(
  () => props.src,
  (src) => (loaded.value = isDecoded(src)),
)

function onLoad() {
  markDecoded(props.src)
  loaded.value = true
}
</script>

<template>
  <img
    v-if="src"
    :key="src"
    :src="src"
    alt=""
    decoding="async"
    draggable="false"
    data-skeleton="off"
    class="transition-opacity duration-200 motion-reduce:transition-none"
    :style="loaded ? undefined : { opacity: 0 }"
    @load="onLoad"
  />
</template>
