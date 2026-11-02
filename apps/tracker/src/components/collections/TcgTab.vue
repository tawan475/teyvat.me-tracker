<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { CheckCheck, ChevronRight } from 'lucide-vue-next'
import EntryGrid, { type GridEntry } from './EntryGrid.vue'
import HaveFilter, { type HaveFilterValue } from './HaveFilter.vue'
import NotCaptured from './NotCaptured.vue'
import FilterChip from '@/components/ui/FilterChip.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiStat from '@/components/ui/UiStat.vue'
import type { CapturedCollections } from '@/data/collections'
import { tcgCardName, tcgEntries, type CollectionCatalog } from '@/data/collection-names'
import { formatNumber } from '@/lib/format'
import { readStorage, writeStorage } from '@/lib/storage'
import { t } from '@/i18n'

/**
 * Genius Invokation TCG: the cards owned of every card a player can own
 * (character cards below 10000, action cards above), and the saved decks by
 * the names the player gave them, each with its cards.
 */
const props = defineProps<{ captured: CapturedCollections; catalog: CollectionCatalog }>()

const tcg = computed(() => props.captured.tcg?.value ?? null)
const owned = computed(() => tcg.value?.cards ?? {})

type Kind = 'characters' | 'actions'
const KIND_KEY = 'collections:tcg-kind'
const FILTER_KEY = 'collections:tcg-filter'
const kind = ref<Kind>(readStorage(KIND_KEY) === 'actions' ? 'actions' : 'characters')
watch(kind, (value) => writeStorage(KIND_KEY, value === 'characters' ? null : value))
const storedFilter = readStorage(FILTER_KEY) as HaveFilterValue | null
const filter = ref<HaveFilterValue>(
  storedFilter === 'missing' || storedFilter === 'have' ? storedFilter : 'all',
)
watch(filter, (value) => writeStorage(FILTER_KEY, value === 'all' ? null : value))

const kinds = computed(() =>
  (['characters', 'actions'] as const).map((k) => {
    const entries = tcgEntries(props.catalog, k)
    const have = entries.filter((entry) => owned.value[String(entry.id)]).length
    return {
      kind: k,
      label: t(`collections.tcg.${k === 'characters' ? 'characterCards' : 'actionCards'}`),
      entries,
      have,
    }
  }),
)
const current = computed(() => kinds.value.find((k) => k.kind === kind.value)!)
const copies = computed(() => Object.values(owned.value).reduce((sum, card) => sum + card.count, 0))
/** Capture 1.8.0: boss challenges unlocked (of the game data's), levels played, Tavern levels. */
const bosses = computed(() => {
  const list = tcg.value?.bosses
  if (!list) return null
  const known = new Set(props.catalog.data.tcgBosses.map((b) => b.id))
  return { have: list.filter((id) => known.has(id)).length, total: known.size }
})
const levelsPlayed = computed(() =>
  tcg.value?.levels ? Object.keys(tcg.value.levels).length : null,
)
const tavernLevels = computed(() =>
  tcg.value?.tavern
    ? Object.values(tcg.value.tavern).reduce((sum, list) => sum + list.length, 0)
    : null,
)

const shown = computed<GridEntry[]>(() =>
  current.value.entries
    .map((entry) => ({ entry, card: owned.value[String(entry.id)] }))
    .filter(({ card }) => filter.value === 'all' || !!card === (filter.value === 'have'))
    .map(({ entry, card }) => ({
      id: entry.id,
      name: entry.name,
      figure: card && card.count > 1 ? `×${formatNumber(card.count)}` : undefined,
      note: card?.proficiency
        ? t('collections.tcg.proficiency', { n: formatNumber(card.proficiency) })
        : undefined,
      missing: !card,
    })),
)

/** Decks with their cards counted (a deck holds a card up to twice). */
const decks = computed(() =>
  Object.entries(tcg.value?.decks ?? {})
    .map(([id, deck]) => {
      const counted = new Map<number, number>()
      for (const card of deck.cards) counted.set(card, (counted.get(card) ?? 0) + 1)
      return {
        id: Number(id),
        ...deck,
        characterNames: deck.characters.map((card) => tcgCardName(props.catalog, card)),
        cardRows: [...counted].map(([card, count]) => ({
          id: card,
          name: tcgCardName(props.catalog, card),
          figure: count > 1 ? `×${count}` : undefined,
        })),
      }
    })
    .sort((a, b) => a.id - b.id),
)
</script>

<template>
  <NotCaptured v-if="!tcg" :title="$t('collections.tabs.tcg')" />
  <div v-else class="flex flex-col gap-4">
    <ul
      class="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4"
      :aria-label="$t('collections.summary')"
    >
      <li v-for="k in kinds" :key="k.kind" class="flex min-w-0">
        <UiStat :label="k.label">
          <template #value>
            <span class="tabular truncate font-mono text-lg font-medium sm:text-xl">
              {{ formatNumber(k.have)
              }}<span class="text-sm text-text-muted"> / {{ formatNumber(k.entries.length) }}</span>
            </span>
          </template>
        </UiStat>
      </li>
      <li class="flex min-w-0">
        <UiStat
          :label="$t('collections.tcg.copies')"
          :value="copies"
          exact
          :hint="$t('collections.tcg.copiesHint')"
        />
      </li>
      <li class="flex min-w-0">
        <UiStat :label="$t('collections.tcg.decks')" :value="decks.length" exact />
      </li>
      <li v-if="bosses" class="flex min-w-0">
        <UiStat :label="$t('collections.tcg.bosses')">
          <template #value>
            <span class="tabular truncate font-mono text-lg font-medium sm:text-xl">
              {{ formatNumber(bosses.have)
              }}<span class="text-sm text-text-muted"> / {{ formatNumber(bosses.total) }}</span>
            </span>
          </template>
        </UiStat>
      </li>
      <li v-if="levelsPlayed !== null" class="flex min-w-0">
        <UiStat :label="$t('collections.tcg.levels')" :value="levelsPlayed" exact />
      </li>
      <li v-if="tavernLevels !== null" class="flex min-w-0">
        <UiStat :label="$t('collections.tcg.tavern')" :value="tavernLevels" exact />
      </li>
    </ul>

    <UiPanel :title="$t('collections.tcg.decks')" flush>
      <ul v-if="decks.length > 0" class="divide-y divide-border-subtle">
        <li v-for="deck in decks" :key="deck.id">
          <details class="group">
            <summary
              class="flex min-w-0 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3"
            >
              <ChevronRight
                class="size-4 shrink-0 text-text-muted transition-transform group-open:rotate-90"
                aria-hidden="true"
              />
              <span class="min-w-0 flex-[999_1_10rem] truncate font-medium" :title="deck.name">{{
                deck.name || '—'
              }}</span>
              <span class="flex shrink-0 items-center gap-2">
                <UiBadge v-if="deck.id === tcg.currentDeck" tone="accent">{{
                  $t('collections.tcg.inUse')
                }}</UiBadge>
                <UiBadge
                  v-if="!deck.valid"
                  tone="warning"
                  :title="$t('collections.tcg.invalidTitle')"
                  >{{ $t('collections.tcg.invalid') }}</UiBadge
                >
                <span
                  class="tabular font-mono text-sm text-text-secondary"
                  :title="
                    $t('collections.tcg.deckTitle', {
                      characters: formatNumber(deck.characters.length),
                      cards: formatNumber(deck.cards.length),
                    })
                  "
                  >{{ formatNumber(deck.characters.length) }} +
                  {{ formatNumber(deck.cards.length) }}</span
                >
              </span>
              <span
                class="basis-full truncate pl-7 text-sm text-text-secondary"
                :title="deck.characterNames.join(' · ')"
                >{{ deck.characterNames.join(' · ') }}</span
              >
            </summary>
            <div class="px-5 pb-4">
              <EntryGrid :entries="deck.cardRows" :label="deck.name" min="13rem" />
            </div>
          </details>
        </li>
      </ul>
      <UiEmpty v-else :title="$t('collections.tcg.noDecks')" />
    </UiPanel>

    <UiPanel flush sticky>
      <template #header>
        <div
          class="flex flex-wrap items-center gap-2"
          role="radiogroup"
          :aria-label="$t('collections.tcg.cards')"
        >
          <FilterChip
            v-for="k in kinds"
            :key="k.kind"
            radio
            :pressed="kind === k.kind"
            @toggle="kind = k.kind"
          >
            {{ k.label }}
            <span class="tabular font-mono text-text-muted"
              >{{ formatNumber(k.have) }}/{{ formatNumber(k.entries.length) }}</span
            >
          </FilterChip>
        </div>
      </template>
      <template #toolbar>
        <HaveFilter
          v-model="filter"
          :have="current.have"
          :total="current.entries.length"
          :label="$t('collections.archive.show')"
        />
      </template>
      <div class="flex flex-col gap-3 p-3 sm:p-5">
        <EntryGrid v-if="shown.length > 0" :entries="shown" :label="current.label" min="13rem" />
        <UiEmpty
          v-else-if="filter === 'missing'"
          :title="$t('collections.spincrystals.allCollected')"
        >
          <template #icon><CheckCheck class="text-success-text" aria-hidden="true" /></template>
        </UiEmpty>
        <UiEmpty v-else :title="$t('collections.spincrystals.noneCollected')" />
      </div>
    </UiPanel>
  </div>
</template>
