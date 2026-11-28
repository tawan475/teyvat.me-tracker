<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { BossEntry } from '@/data/boss-randomizer'
import { POP, SNAP, reducedMotion } from '../randomizer/motion'
import BossPicture from './BossPicture.vue'

/**
 * The roll's big tile: the rolled boss's picture over its name strip, ringed
 * like a hit. A `roll` spin drops a strip of `through` pictures down through
 * the square (fast, then slowing) and stops on the boss, which pops: the
 * team randomizer's slot reel (SlotReel), longer so each picture reads. A
 * `snap` (Undo) only fades the picture in. While the reel runs the name
 * strip keeps its height and shows nothing, so the text does not give the
 * answer away. Transform and opacity only; nothing moves under reduced
 * motion. A new spin ends the one running at once.
 */
export interface BossSpin {
  id: number
  kind: 'roll' | 'snap'
  /** In the order they pass; the last is just before the result. */
  through: readonly BossEntry[]
  /** ms */
  duration: number
}

const props = defineProps<{ boss: BossEntry; spin: BossSpin | null }>()
const emit = defineEmits<{ start: []; end: [] }>()

const strip = ref<HTMLElement | null>(null)
const tile = ref<HTMLElement | null>(null)
/** Nearest the result first: the strip's first picture sits just above it. */
const above = ref<readonly BossEntry[]>([])
let animation: Animation | null = null
let running = false

function end() {
  if (!running) return
  running = false
  animation = null
  above.value = []
  emit('end')
}

watch(
  () => props.spin?.id,
  async () => {
    const spin = props.spin
    if (!spin) return
    settle()
    if (reducedMotion()) return
    if (spin.kind === 'snap' || !spin.through.length) {
      strip.value?.animate(SNAP, { duration: 200, easing: 'ease-out' })
      return
    }
    running = true
    above.value = [...spin.through].reverse()
    emit('start')
    // The square already shows the result: cover it in this same frame.
    await nextTick()
    const el = strip.value
    if (!running || !el) return end()
    animation = el.animate(
      [{ transform: `translateY(${spin.through.length * 100}%)` }, { transform: 'translateY(0)' }],
      { duration: spin.duration, easing: 'cubic-bezier(0.12, 0.62, 0.22, 1)' },
    )
    const mine = animation
    mine.onfinish = () => {
      if (animation !== mine) return
      end()
      tile.value?.animate(POP, { duration: 200, easing: 'ease-out' })
    }
  },
  { flush: 'post' },
)

/** Ends the reel now, on its result. */
function settle() {
  if (!running) return
  const was = animation
  end()
  was?.cancel()
}
onBeforeUnmount(settle)
defineExpose({ settle })
</script>

<template>
  <div
    ref="tile"
    class="flex w-full min-w-0 flex-col overflow-hidden rounded-xl border border-accent-text bg-surface-raised ring-2 ring-accent-text"
  >
    <div class="relative aspect-square w-full overflow-hidden">
      <div
        ref="strip"
        class="absolute inset-0"
        :class="above.length ? 'will-change-transform' : ''"
      >
        <BossPicture :boss="boss" large priority />
        <div
          v-for="(passer, index) in above"
          :key="index"
          class="absolute inset-x-0 h-full"
          :style="{ top: `${(index + 1) * -100}%` }"
        >
          <BossPicture :boss="passer" large bare priority />
        </div>
      </div>
    </div>
    <p
      class="shrink-0 border-t border-border-default px-2.5 py-2.5 text-center text-sm leading-tight font-semibold"
    >
      <span class="line-clamp-2 h-[2lh] break-words">{{ above.length ? '' : boss.name }}</span>
    </p>
  </div>
</template>
