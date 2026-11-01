<script setup lang="ts">
import { computed } from 'vue'
import { gameRuns } from '@/data/endgame'
import { gameIcon } from '@/lib/assets'

/**
 * Game text as the game shows it: its line breaks, colour spans (mixed toward
 * the ink so the light game colours read on both themes) and inline icons
 * (`{SPRITE_PRESET#<id>}`: an element or a reaction, drawn from `sprites`,
 * else its name from `spriteName`).
 */
const props = defineProps<{
  text: string
  sprites?: ReadonlyMap<number, string>
  spriteName?: (id: number) => string
}>()

const lines = computed(() => gameRuns(props.text))
const runColor = (color: string) => `color-mix(in oklab, ${color} 55%, var(--color-text-primary))`
const spriteSrc = (id: number) => gameIcon(props.sprites?.get(id) ?? '')
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <p v-for="(line, i) in lines" :key="i" class="min-h-2 break-words">
      <template v-for="(run, j) in line" :key="j">
        <template v-if="run.sprite !== undefined">
          <img
            v-if="spriteSrc(run.sprite)"
            :src="spriteSrc(run.sprite)"
            :alt="spriteName?.(run.sprite) ?? ''"
            :title="spriteName?.(run.sprite)"
            class="inline size-[1.25em] align-[-0.25em]"
          />
          <span v-else>{{ spriteName?.(run.sprite) }}</span>
        </template>
        <span v-else-if="run.color" class="font-semibold" :style="{ color: runColor(run.color) }">{{
          run.text
        }}</span>
        <template v-else>{{ run.text }}</template>
      </template>
    </p>
  </div>
</template>
