<script setup lang="ts">
import GameIcon from '@/components/ui/GameIcon.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import { computed } from 'vue'
import { bonusSets, setBonusTitle } from '@/data/character-build'
import type { SetCount } from '@/data/characters'
import { artifactSetIcon } from '@/lib/assets'
import { useDetailTip } from './detail-tip'

/**
 * The set bonuses worn (bonusSets: 2 pieces or more, so a 4-piece or 2 + 2;
 * a single piece isn't listed): icon, name and the bonus reached. The
 * tooltip lists the stats each bonus adds. Nothing renders when no set
 * reaches 2 pieces. In the character details each shows its bonuses' text
 * (detail-tip).
 */
const props = defineProps<{ sets: SetCount[] }>()
const listed = computed(() => bonusSets(props.sets))
const tip = useDetailTip()

function title(set: SetCount): string {
  return [`${set.name} ×${set.count}`, ...setBonusTitle(set.setKey, set.active)]
    .filter(Boolean)
    .join('\n')
}
</script>

<template>
  <ul v-if="listed.length" class="flex min-w-0 flex-wrap gap-2" :aria-label="$t('characters.sets')">
    <li
      v-for="{ set, pieces } in listed"
      :key="set.setKey"
      class="flex min-w-0 items-center gap-2 rounded-lg border border-border-default bg-surface-raised py-1 pr-1.5 pl-1"
      :title="tip ? undefined : title(set)"
      v-bind="tip?.bind({ kind: 'set', setKey: set.setKey }) ?? {}"
    >
      <GameIcon
        :src="artifactSetIcon(set.setKey)"
        :name="set.name"
        :rarity="set.rarity"
        size="xs"
      />
      <span class="min-w-0 truncate text-sm">{{ set.name }}</span>
      <UiBadge tone="success" mono>
        {{ pieces }}
        <span class="sr-only">{{ $t('characters.pieceBonus') }}</span>
      </UiBadge>
    </li>
  </ul>
</template>
