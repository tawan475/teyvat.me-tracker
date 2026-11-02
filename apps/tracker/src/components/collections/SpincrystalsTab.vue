<script setup lang="ts">
import { computed } from 'vue'
import SpincrystalsSection from './SpincrystalsSection.vue'
import { useCollectionCatalog } from './use-catalog'
import UiError from '@/components/ui/UiError.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import type { CapturedCollections } from '@/data/collections'
import { loadSpincrystals, spincrystalProgress } from '@/data/spincrystals'
import { useResource } from '@/data/use-resource'
import { loadGameIcons } from '@/lib/assets'

/** Radiant Spincrystals: the captured list against the game data's songs (names: `home`, regions: `world`). */
const props = defineProps<{ captured: CapturedCollections }>()

const game = useResource(
  () => 0,
  async () => (await Promise.all([loadSpincrystals(), loadGameIcons()]))[0],
)
const catalog = useCollectionCatalog(() => ['home', 'world'])
const progress = computed(() => {
  const owned = props.captured.spincrystals?.value
  return game.data.value && owned ? spincrystalProgress(game.data.value, owned) : null
})
</script>

<template>
  <UiError
    v-if="game.error.value && !game.data.value"
    :title="$t('collections.loadFailed')"
    :error="game.error.value"
    @retry="game.reload()"
  />
  <SpincrystalsSection
    v-else-if="game.data.value && catalog.data.value"
    :progress="progress"
    :catalog="catalog.data.value"
  />
  <UiSkeleton v-else class="h-96 w-full" />
</template>
