<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { PoolCharacter } from '@/data/team-randomizer'
import CharacterTile from './CharacterTile.vue'
import { POP, SNAP, reducedMotion, type Spin } from './motion'

/**
 * A team slot's tile with its roll: the strip of `spin.through` portraits
 * runs down past the slot and stops on the tile (the slot's content), which
 * then pops. `snap` (Undo) only fades the tile in. Transform and opacity
 * only; nothing moves under reduced motion. `settle()` ends it at once.
 */
const props = defineProps<{ spin: Spin | null }>()
const emit = defineEmits<{ start: []; end: [] }>()

const strip = ref<HTMLElement | null>(null)
const through = ref<readonly PoolCharacter[]>([])
let animation: Animation | null = null
let running = false

function end() {
  if (!running) return
  running = false
  animation = null
  through.value = []
  emit('end')
}

watch(
  () => props.spin?.id,
  async () => {
    const spin = props.spin
    if (!spin || reducedMotion()) return
    settle()
    if (spin.kind === 'snap') {
      strip.value?.animate(SNAP, { duration: 200, easing: 'ease-out' })
      return
    }
    running = true
    through.value = spin.through
    emit('start')
    // The tile itself already shows who was rolled: cover it in this same frame.
    await nextTick()
    const el = strip.value
    if (!running || !el) return end()
    animation = el.animate(
      [{ transform: `translateY(${spin.through.length * 100}%)` }, { transform: 'translateY(0)' }],
      { duration: spin.duration, easing: 'cubic-bezier(0.15, 0.7, 0.2, 1)' },
    )
    const mine = animation
    mine.onfinish = () => {
      if (animation !== mine) return
      end()
      el.animate(POP, { duration: 180, easing: 'ease-out' })
    }
  },
  { flush: 'post' },
)

/** Ends the roll now, on its result. */
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
  <!-- Clipped only while it rolls: a locked tile's ring reaches past its edge. -->
  <div class="relative w-full" :class="through.length ? 'overflow-hidden rounded-lg' : ''">
    <div ref="strip" class="relative w-full" :class="through.length ? 'will-change-transform' : ''">
      <slot />
      <div
        v-for="(character, index) in through"
        :key="index"
        inert
        aria-hidden="true"
        class="absolute inset-x-0 h-full"
        :style="{ top: `${(index + 1) * -100}%` }"
      >
        <CharacterTile :character="character" label="" priority />
      </div>
    </div>
  </div>
</template>
