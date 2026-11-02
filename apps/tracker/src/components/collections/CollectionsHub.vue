<script setup lang="ts">
import { computed } from 'vue'
import CollectionCard from './CollectionCard.vue'
import { COLLECTION_TABS, TAB_ART, TAB_ICON, TAB_LABEL, TAB_PART } from './tabs'
import type { HubExtras } from './use-hub-extras'
import type { CollectionCatalog } from '@/data/collection-names'
import { collectionFigures } from '@/data/collection-summary'
import type { CapturedCollections } from '@/data/collections'
import { loadSpincrystals } from '@/data/spincrystals'
import { useResource } from '@/data/use-resource'
import { useAccount, useAccountRoute } from '@/views/account/context'
import { t } from '@/i18n'

/**
 * The Collections hub: a card per collection, each with its figure and
 * capture time, opening the collection's page. Figures wait for the game
 * data; the cards don't. Achievements and Anecdotes count hand marks too,
 * as their pages do (`extras`, loaded by the page beside the captures).
 */
const props = defineProps<{
  captured: CapturedCollections
  catalog: CollectionCatalog | null
  extras: HubExtras
}>()

const account = useAccount()
const accountRoute = useAccountRoute()
const to = (name: string, tab?: string) => ({
  name: accountRoute(name),
  params: { accountId: account.value.id, ...(tab ? { tab } : {}) },
})
const spincrystals = useResource(
  () => 0,
  () => loadSpincrystals(),
)
const figures = computed(() =>
  collectionFigures(props.captured, props.catalog, spincrystals.data.value ?? null),
)

const extras = props.extras
const EXTRA = { achievements: 'achievement', anecdotes: 'anecdote' } as const

const cards = computed(() =>
  COLLECTION_TABS.map((tab) => {
    const part = TAB_PART[tab]
    return {
      tab,
      title: t(`collections.tabs.${TAB_LABEL[tab]}`),
      icon: TAB_ICON[tab],
      art: TAB_ART[tab],
      to: to('account-collections', tab),
      figure:
        tab === 'achievements' || tab === 'anecdotes'
          ? extras[EXTRA[tab]].value.figure
          : tab === 'local-legends'
            ? undefined
            : figures.value[tab],
      takenAt:
        tab === 'achievements' || tab === 'anecdotes'
          ? extras[EXTRA[tab]].value.takenAt
          : part
            ? (props.captured[part]?.takenAt ?? null)
            : null,
    }
  }),
)
</script>

<template>
  <div class="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] sm:gap-3">
    <CollectionCard
      v-for="card in cards"
      :key="card.tab"
      :to="card.to"
      :title="card.title"
      :icon="card.icon"
      :art="card.art"
      :figure="card.figure"
      :count-label="$t('collections.defeats.kinds')"
      :taken-at="card.takenAt"
    />
  </div>
</template>
