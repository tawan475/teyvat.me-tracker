<script setup lang="ts">
import { wishItemName } from './item-name'
import type { WishItem } from '@gdt/shared'
import GameIcon from '@/components/ui/GameIcon.vue'
import type { Outcome } from '@/data/wish-history'
import { OUTCOME_STYLE, outcomeLabel, wishIcon } from './wish-labels'

/**
 * A pulled item's icon with the 50/50 as a ring inside its edge and a mark
 * in its corner (OUTCOME_STYLE: ▲ won blue solid, ▼ lost orange dashed,
 * ● guaranteed grey dotted); none on banners without one.
 */
withDefaults(
  defineProps<{ item: WishItem; outcome?: Outcome | null; size?: 'sm' | 'md' | 'lg' }>(),
  { outcome: null, size: 'md' },
)

const SIZE = { sm: 'size-6!', md: 'size-[1.9rem]!', lg: 'size-8!' } as const
</script>

<template>
  <span class="relative inline-flex shrink-0">
    <GameIcon
      :src="wishIcon(item)"
      :name="wishItemName(item)"
      :rarity="item.rank || undefined"
      size="xs"
      :class="SIZE[size]"
    />
    <template v-if="outcome">
      <span
        class="pointer-events-none absolute inset-0 rounded-lg outline-2 -outline-offset-2"
        :class="OUTCOME_STYLE[outcome].ring"
        aria-hidden="true"
      />
      <span
        class="pointer-events-none absolute -right-1 -bottom-1 flex size-3.5 items-center justify-center rounded-full bg-surface-raised text-[0.5rem] leading-none font-bold shadow-sm"
        :class="OUTCOME_STYLE[outcome].text"
        :title="outcomeLabel(outcome)"
        >{{ OUTCOME_STYLE[outcome].mark }}</span
      >
    </template>
  </span>
</template>
