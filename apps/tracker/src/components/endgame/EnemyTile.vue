<script setup lang="ts">
import { computed } from 'vue'
import type { EndgameMonster } from '@gdt/game-data/endgame'
import GameIcon from '@/components/ui/GameIcon.vue'
import { formatNumber, formatShort } from '@/lib/format'
import { gameIcon } from '@/lib/assets'
import { t } from '@/i18n'

/**
 * One enemy of a lineup: picture, name and HP at its level (1 player; the
 * tooltip has 1-4). With a Living Beings entry the whole tile opens it at
 * that level (`open`).
 */
const props = withDefaults(
  defineProps<{
    monster: EndgameMonster | undefined
    name: string
    level: number
    hp: number[] | null
    size?: 'md' | 'lg'
  }>(),
  { size: 'md' },
)
defineEmits<{ open: [codex: number, level: number] }>()

const hpTip = computed(() =>
  props.hp
    ? `${t('endgame.hpAt', { n: props.level })}\n${props.hp
        .map((v, i) => `${i + 1}P ${formatNumber(Math.round(v))}`)
        .join(' · ')}`
    : '',
)
</script>

<template>
  <component
    :is="monster?.codex ? 'button' : 'span'"
    :type="monster?.codex ? 'button' : undefined"
    class="group flex min-w-0 flex-col items-center gap-1 rounded-lg p-1 text-center"
    :class="[
      size === 'lg' ? 'w-24' : 'w-20',
      monster?.codex && 'transition-colors hover:bg-surface-overlay',
    ]"
    :title="monster?.codex ? name : `${name}\n${t('endgame.noEntry')}`"
    @click="monster?.codex && $emit('open', monster.codex, level)"
  >
    <GameIcon
      :src="gameIcon(monster?.icon ?? '')"
      :name="name"
      :size="size === 'lg' ? 'lg' : 'md'"
      class="ring-1 ring-border-default transition-shadow group-hover:ring-accent-text"
    />
    <span class="line-clamp-2 w-full text-xs leading-tight break-words text-text-secondary">{{
      name
    }}</span>
    <span v-if="hp" class="tabular font-mono text-xs font-semibold text-danger-text" :title="hpTip"
      >♥ {{ formatShort(hp[0]!) }}</span
    >
  </component>
</template>
