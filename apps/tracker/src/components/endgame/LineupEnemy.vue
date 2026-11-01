<script setup lang="ts">
import type { EndgameMonster } from '@gdt/game-data/endgame'
import GameIcon from '@/components/ui/GameIcon.vue'
import { gameIcon } from '@/lib/assets'

/**
 * One enemy of a lineup: its picture, name and level. With a Living Beings
 * entry it opens that entry (`open`).
 */
defineProps<{ monster: EndgameMonster | undefined; name: string; level: number }>()
defineEmits<{ open: [codex: number] }>()
</script>

<template>
  <component
    :is="monster?.codex ? 'button' : 'span'"
    :type="monster?.codex ? 'button' : undefined"
    class="flex min-w-0 items-center gap-2 rounded-lg border border-border-default bg-surface-sunken py-1 pr-2.5 pl-1 text-left text-sm"
    :class="
      monster?.codex &&
      'transition-colors hover:border-border-strong hover:bg-surface-overlay focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none'
    "
    :title="name"
    @click="monster?.codex && $emit('open', monster.codex)"
  >
    <GameIcon :src="gameIcon(monster?.icon ?? '')" :name="name" size="sm" class="shrink-0" />
    <span class="line-clamp-2 min-w-0 flex-1 leading-tight break-words">{{ name }}</span>
    <span v-if="level" class="tabular shrink-0 font-mono text-xs text-text-muted">{{
      $t('endgame.level', { n: level })
    }}</span>
  </component>
</template>
