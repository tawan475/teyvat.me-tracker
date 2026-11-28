<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ImageOff } from 'lucide-vue-next'
import { fightSize, otherIcons, type BossEntry } from '@/data/boss-randomizer'
import { gameIcon } from '@/lib/assets'

/**
 * A boss's picture in a square: the first monster's picture whole (never
 * cut or squeezed), and for a fight with more than one monster a "2 to
 * fight" badge at the bottom left, plus the other monsters that look
 * different as small insets at the bottom right. A picture that fails
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
const n = computed(() => fightSize(props.boss))
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
      class="absolute inset-0 size-full object-contain"
      :class="large ? 'p-[6%]' : 'p-[8%]'"
      @error="failed = true"
    />
    <ImageOff v-else class="text-text-muted" :class="large ? 'size-10' : 'size-6'" />
    <template v-if="!bare && n > 1">
      <span
        class="absolute bottom-[5%] left-[5%] rounded bg-[#3b4255]/90 font-semibold whitespace-nowrap text-white"
        :class="
          large ? 'px-2 py-0.5 text-xs' : 'max-w-[66%] truncate px-1.5 text-[0.625rem] leading-4'
        "
        >{{ $t('fun.boss.fight', { n }) }}</span
      >
      <!-- Small tiles stack them, so the badge keeps its room. -->
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
            class="absolute inset-0 size-full object-contain p-[6%]"
          />
        </span>
      </span>
    </template>
  </span>
</template>
