<script setup lang="ts">
import { Ban, Lock } from 'lucide-vue-next'
import ElementIcon from '@/components/ui/ElementIcon.vue'
import ItemTile from '@/components/ui/ItemTile.vue'
import { TILE_CHIP, TILE_CHIP_ICON, TILE_LOCK } from '@/components/ui/item-tile'
import type { PoolCharacter } from '@/data/team-randomizer'
import { characterIcon } from '@/lib/assets'

/**
 * A character in the team randomizer, as the game's bag cell: the portrait,
 * the element's own icon top-left (bare, as everywhere on the site), the
 * name on the strip. `mark`: a lock (kept through rolls) or a ban (left out
 * of the pool, the tile dimmed too) in the top-right corner. One button:
 * `label` says what a click does.
 */
defineProps<{
  character: PoolCharacter
  label: string
  mark?: 'lock' | 'ban' | null
  selected?: boolean
  priority?: boolean
}>()
defineEmits<{ open: [] }>()
</script>

<template>
  <ItemTile
    :src="characterIcon(character.key)"
    :name="character.name"
    :rarity="character.rarity"
    :label="label"
    :selected="selected"
    :priority="priority"
    :class="mark === 'ban' ? 'opacity-45' : ''"
    @open="$emit('open')"
  >
    <template v-if="character.element" #top-left>
      <span class="grid *:size-[24cqw]!">
        <ElementIcon :element="character.element" decorative />
      </span>
    </template>
    <template v-if="mark" #top-right>
      <span :class="TILE_CHIP">
        <Lock v-if="mark === 'lock'" :class="[TILE_CHIP_ICON, TILE_LOCK]" stroke-width="2.6" />
        <Ban v-else :class="TILE_CHIP_ICON" stroke-width="2.6" />
      </span>
    </template>
    <!-- Smaller than the bag's "Lv. 90": character names are long. -->
    <template #footer>
      <span class="text-[max(10.5cqw,10px)] leading-[1.4]">{{ character.name }}</span>
    </template>
  </ItemTile>
</template>
