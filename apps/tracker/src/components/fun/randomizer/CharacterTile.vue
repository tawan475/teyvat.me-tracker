<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Ban, Lock } from 'lucide-vue-next'
import ElementIcon from '@/components/ui/ElementIcon.vue'
import ItemTile from '@/components/ui/ItemTile.vue'
import { TILE_CHIP, TILE_CHIP_ICON, TILE_LOCK } from '@/components/ui/item-tile'
import type { PoolCharacter } from '@/data/team-randomizer'
import { t } from '@/i18n'
import { characterIcon } from '@/lib/assets'
import { POP, play } from './motion'

/**
 * A character in the team randomizer, as the game's bag cell: the portrait,
 * the element's own icon top-left (bare, as everywhere on the site), the
 * name on the strip. `mark`: a lock (kept through rolls) or a ban (left out
 * of the pool, the tile dimmed too) in the top-right corner. One button:
 * `label` says what a click does. Locking or banning pops the tile once.
 */
const props = defineProps<{
  character: PoolCharacter
  label: string
  mark?: 'lock' | 'ban' | null
  selected?: boolean
  priority?: boolean
}>()
defineEmits<{ open: [] }>()

/** The Traveler's element is the icon's to say. */
const name = computed(() =>
  props.character.key.startsWith('Traveler') ? t('game.traveler') : props.character.name,
)
/** Long names get smaller before they are cut. */
const size = computed(() => {
  const cqw = Math.min(10.5, 150 / Math.max(1, name.value.length))
  return `max(${cqw.toFixed(1)}cqw, ${cqw < 10 ? 8.5 : 10}px)`
})

const tile = ref<InstanceType<typeof ItemTile> | null>(null)
watch(
  () => props.mark,
  () => play(tile.value?.$el as Element | undefined, POP, 180),
)
</script>

<template>
  <ItemTile
    ref="tile"
    :src="characterIcon(character.key)"
    :name="name"
    :rarity="character.rarity"
    :label="label"
    :selected="selected"
    :pressed="mark != null"
    :priority="priority"
    :class="mark === 'ban' ? 'opacity-45' : ''"
    class="transition-[opacity,transform] duration-150 motion-reduce:transition-none"
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
      <span class="leading-[1.4]" :style="{ fontSize: size }">{{ name }}</span>
    </template>
  </ItemTile>
</template>
