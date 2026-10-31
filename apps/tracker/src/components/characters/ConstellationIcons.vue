<script setup lang="ts">
import { computed } from 'vue'
import type { Element } from '@/data/game-meta'
import ElementDisc from './ElementDisc.vue'
import { useDetailTip } from './detail-tip'
import { constellationIcons } from './talent-icons'

/**
 * The six constellations as the game's own icons on dark discs ringed in
 * the element colour (ElementDisc), Enka-style; locked ones dimmed with a
 * lock. A column by default (beside splash art); space it out with
 * `justify-between` and a height from outside. In the character details
 * each shows what it does (detail-tip).
 */
const props = withDefaults(
  defineProps<{
    characterKey: string
    value: number
    element: Element | null
    size?: 'md' | 'lg' | 'xl'
  }>(),
  { size: 'md' },
)

const icons = computed(() => constellationIcons(props.characterKey))
const level = computed(() => Math.min(6, Math.max(0, Math.trunc(props.value) || 0)))
const tip = useDetailTip()
</script>

<template>
  <ol class="flex flex-col gap-2" :aria-label="$t('characters.constellation.title', { level })">
    <li
      v-for="(src, index) in icons"
      :key="index"
      class="flex rounded-full"
      :title="
        tip
          ? undefined
          : index < level
            ? `C${index + 1}`
            : $t('characters.constellation.lockedTitle', { n: index + 1 })
      "
      v-bind="tip?.bind({ kind: 'constellation', index }, { side: true }) ?? {}"
    >
      <ElementDisc
        :src="src"
        :element="element"
        :size="size"
        :locked="index >= level"
        :fallback="`C${index + 1}`"
      />
      <span class="sr-only">{{
        index < level
          ? $t('characters.constellation.unlocked', { n: index + 1 })
          : $t('characters.constellation.locked', { n: index + 1 })
      }}</span>
    </li>
  </ol>
</template>
