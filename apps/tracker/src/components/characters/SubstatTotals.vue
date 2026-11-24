<script setup lang="ts">
import { computed } from 'vue'
import type { CharacterView } from '@/data/characters'
import { formatStatShort, formatStatValue } from '@/utils/artifact-stats'
import { substatTotals } from './share-card-model'

/**
 * What the worn pieces' substats add as a whole, each with its roll count
 * (the share card's totals line, for the details without the card): a tile
 * after the five pieces. CRIT Rate and CRIT DMG come first, bold on a fill.
 */
const props = defineProps<{ character: CharacterView }>()

const totals = computed(() => substatTotals(props.character))
const rolls = computed(() => totals.value.reduce((sum, s) => sum + s.rolls, 0))
</script>

<template>
  <section
    v-if="totals.length"
    class="flex min-w-0 flex-col gap-2 rounded-xl border border-border-default bg-surface-raised p-3"
    :aria-label="$t('game.substats')"
  >
    <h4 class="px-1 text-sm font-medium text-text-secondary">{{ $t('game.substats') }}</h4>
    <ul class="flex flex-col gap-0.5 text-sm">
      <li
        v-for="total in totals"
        :key="total.key"
        class="flex items-baseline gap-2 rounded-md px-1.5 py-0.5"
        :class="total.crit ? 'bg-surface-overlay/60 font-semibold' : ''"
      >
        <span
          class="min-w-0 flex-1 truncate"
          :class="total.crit ? 'text-text-primary' : 'text-text-secondary'"
          >{{ formatStatShort(total.key) }}</span
        >
        <span class="tabular font-mono">{{ formatStatValue(total.key, total.value) }}</span>
        <span
          class="tabular w-9 text-right font-mono text-xs"
          :class="total.crit ? 'text-text-secondary' : 'text-text-muted'"
          >×{{ total.rolls }}</span
        >
      </li>
    </ul>
    <i18n-t
      keypath="characters.piece.rolls"
      tag="p"
      class="mt-auto border-t border-border-subtle px-1 pt-2 text-right text-sm text-text-secondary"
      :plural="rolls"
      ><template #n
        ><span class="tabular font-mono">{{ rolls }}</span></template
      ></i18n-t
    >
  </section>
</template>
