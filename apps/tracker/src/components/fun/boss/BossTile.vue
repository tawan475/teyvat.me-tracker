<script setup lang="ts">
import { ref, watch } from 'vue'
import { Ban, Check } from 'lucide-vue-next'
import type { BossEntry } from '@/data/boss-randomizer'
import { POP, play } from '../randomizer/motion'
import BossPicture from './BossPicture.vue'

/**
 * A boss in the boss randomizer's pool: a square with its picture whole
 * (BossPicture), the name on exactly two lines' height, so every tile of a
 * row is the same height. One button: a click leaves it out (dimmed, with a
 * ban mark) or puts it back. `hit` rings the one the roll stopped on, with a
 * tick mark too (not colour alone).
 */
const props = defineProps<{
  boss: BossEntry
  label: string
  banned?: boolean
  hit?: boolean
  priority?: boolean
}>()
defineEmits<{ toggle: [] }>()

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
    class="relative flex min-w-0 flex-col overflow-hidden rounded-lg border bg-surface-raised text-left transition-[opacity,border-color,box-shadow] duration-150 hover:bg-surface-overlay motion-reduce:transition-none"
    :class="[
      banned ? 'opacity-45' : '',
      hit ? 'border-accent-text ring-2 ring-accent-text' : 'border-border-default',
    ]"
    @click="$emit('toggle')"
  >
    <span class="relative block aspect-square w-full">
      <BossPicture :boss="boss" :priority="priority" />
      <span
        v-if="banned"
        class="absolute top-1 right-1 grid size-5 place-items-center rounded bg-[#3b4255]/90 text-white"
        aria-hidden="true"
      >
        <Ban class="size-3.5" stroke-width="2.6" />
      </span>
      <span
        v-else-if="hit"
        class="absolute top-1 right-1 grid size-5 place-items-center rounded bg-accent text-accent-ink"
        aria-hidden="true"
      >
        <Check class="size-3.5" stroke-width="3" />
      </span>
    </span>
    <!-- Padding outside the clamp: a third line never peeks into it. -->
    <span class="block shrink-0 px-1.5 py-1.5 text-xs leading-tight font-semibold">
      <span class="line-clamp-2 h-[2lh] break-words">{{ boss.name }}</span>
    </span>
  </button>
</template>
