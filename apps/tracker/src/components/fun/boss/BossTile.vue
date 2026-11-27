<script setup lang="ts">
import { ref, watch } from 'vue'
import { Ban } from 'lucide-vue-next'
import type { BossEntry } from '@/data/boss-randomizer'
import { gameIcon } from '@/lib/assets'
import { POP, play } from '../randomizer/motion'

/**
 * A boss in the boss randomizer's pool: its picture (a pair of Local Legends
 * shows both), the name on up to two lines. One button: a click leaves it out
 * (dimmed, with a ban mark) or puts it back. `hit` rings the one the roll
 * landed on; `lit` is the roll passing over it.
 */
const props = defineProps<{
  boss: BossEntry
  label: string
  banned?: boolean
  hit?: boolean
  lit?: boolean
  priority?: boolean
}>()
defineEmits<{ toggle: [] }>()

const failed = ref(false)
const root = ref<HTMLElement | null>(null)
watch(
  () => [props.banned, props.hit],
  () => play(root.value, POP, 180),
)
</script>

<template>
  <button
    ref="root"
    type="button"
    :aria-pressed="banned"
    :aria-label="label"
    :title="label"
    class="relative flex min-w-0 flex-col gap-1.5 rounded-lg border bg-surface-raised p-1.5 text-left transition-[opacity,border-color,box-shadow] duration-150 hover:bg-surface-overlay motion-reduce:transition-none"
    :class="[
      banned ? 'opacity-45' : '',
      hit
        ? 'border-accent-text ring-2 ring-accent-text'
        : lit
          ? 'border-text-primary ring-2 ring-text-primary'
          : 'border-border-default',
    ]"
    @click="$emit('toggle')"
  >
    <span
      class="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-md bg-surface-sunken"
      aria-hidden="true"
    >
      <template v-if="boss.icons.length && !failed">
        <img
          v-for="(icon, i) in boss.icons.slice(0, 2)"
          :key="i"
          :src="gameIcon(icon)"
          alt=""
          :loading="priority ? 'eager' : 'lazy'"
          decoding="async"
          class="h-full min-w-0 object-contain"
          :class="boss.icons.length > 1 ? 'w-1/2' : 'w-full'"
          @error="failed = true"
        />
      </template>
      <span v-else class="px-1 text-center font-mono text-xs text-text-muted">{{
        boss.name.slice(0, 2).toUpperCase()
      }}</span>
      <span
        v-if="banned"
        class="absolute top-1 right-1 grid size-5 place-items-center rounded bg-[#3b4255]/90 text-white"
      >
        <Ban class="size-3.5" stroke-width="2.6" />
      </span>
    </span>
    <span class="line-clamp-2 min-h-[2lh] text-xs leading-tight font-semibold break-words">{{
      boss.name
    }}</span>
  </button>
</template>
