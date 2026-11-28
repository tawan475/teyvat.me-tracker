<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ImageOff } from 'lucide-vue-next'
import { otherIcons, type BossEntry } from '@/data/boss-randomizer'
import { gameIcon } from '@/lib/assets'

/**
 * A boss's picture in a square: the first monster's picture filling it edge
 * to edge (the game's icons are square pictures: no padding around them),
 * and for a fight with more than one monster the others that look different
 * as small insets at the bottom right. A picture that fails
 * leaves the empty square with a muted mark (no initials). `large` is the
 * roll's big tile. Fills its parent; the parent sets the square.
 */
const props = defineProps<{
  boss: Pick<BossEntry, 'icons'>
  large?: boolean
  priority?: boolean
  /** Only the first picture: the reel's passers-by. */
  bare?: boolean
}>()

const failed = ref(false)
watch(
  () => props.boss.icons[0],
  () => (failed.value = false),
)
const others = computed(() => (props.bare ? [] : otherIcons(props.boss).slice(0, 2)))
</script>

<template>
  <span class="absolute inset-0 grid place-items-center bg-surface-sunken" aria-hidden="true">
    <img
      v-if="boss.icons[0] && !failed"
      :key="boss.icons[0]"
      :src="gameIcon(boss.icons[0])"
      alt=""
      :loading="priority ? 'eager' : 'lazy'"
      decoding="async"
      class="absolute inset-0 size-full object-cover"
      @error="failed = true"
    />
    <ImageOff v-else class="text-text-muted" :class="large ? 'size-10' : 'size-6'" />
    <span
      v-if="others.length"
      class="absolute right-[5%] bottom-[5%] flex"
      :class="large ? 'gap-1' : 'flex-col-reverse gap-0.5'"
    >
      <span
        v-for="icon in others"
        :key="icon"
        class="relative aspect-square overflow-hidden rounded-md border border-border-strong bg-surface-raised shadow-sm"
        :class="large ? 'w-12' : 'w-[1.4rem]'"
      >
        <img
          :src="gameIcon(icon)"
          alt=""
          loading="lazy"
          decoding="async"
          class="absolute inset-0 size-full object-cover"
        />
      </span>
    </span>
  </span>
</template>
