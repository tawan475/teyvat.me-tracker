<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ARCHIVE_TABS, type ArchiveTab } from '@gdt/shared'
import EntryGrid, { type GridEntry } from './EntryGrid.vue'
import HaveFilter, { type HaveFilterValue } from './HaveFilter.vue'
import NotCaptured from './NotCaptured.vue'
import WorldQuestsList from './WorldQuestsList.vue'
import FilterChip from '@/components/ui/FilterChip.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiProgress from '@/components/ui/UiProgress.vue'
import UiStat from '@/components/ui/UiStat.vue'
import { CheckCheck, SearchX } from 'lucide-vue-next'
import type { CapturedCollections } from '@/data/collections'
import {
  archiveEntries,
  idLabel,
  nameOf,
  questChapter,
  type CollectionCatalog,
  ARCHIVE_SECTIONS,
  wikiGuide,
} from '@/data/collection-names'
import { formatNumber } from '@/lib/format'
import { readStorage, writeStorage } from '@/lib/storage'
import { worldQuestList } from '@/data/world-quests'
import { t } from '@/i18n'

/**
 * The Archive: per tab (the game's own), what is unlocked of what the game
 * data lists, and the chosen tab's entries: All, Missing or Have. After the
 * game's tabs, World Quests (not an Archive tab in game: WorldQuestsList).
 */
const props = defineProps<{ captured: CapturedCollections; catalog: CollectionCatalog }>()

const archive = computed(() => props.captured.archive?.value ?? null)

const TAB_KEY = 'collections:archive'
const FILTER_KEY = 'collections:archive-filter'
const WORLD_QUESTS = 'worldQuests'
type Chosen = ArchiveTab | typeof WORLD_QUESTS
const storedTab = readStorage(TAB_KEY)
const chosen = ref<Chosen>(
  [...ARCHIVE_TABS, WORLD_QUESTS].includes(storedTab as Chosen) ? (storedTab as Chosen) : 'quests',
)
watch(chosen, (value) => writeStorage(TAB_KEY, value === 'quests' ? null : value))
const storedFilter = readStorage(FILTER_KEY) as HaveFilterValue | null
const filter = ref<HaveFilterValue>(
  storedFilter === 'missing' || storedFilter === 'have' ? storedFilter : 'all',
)
watch(filter, (value) => writeStorage(FILTER_KEY, value === 'all' ? null : value))

/** Per tab: every entry, marked had or not, then captured ids the game data lacks. */
const tabs = computed(() =>
  ARCHIVE_TABS.map((tab) => {
    const owned = new Set(archive.value?.[tab] ?? [])
    const known = archiveEntries(props.catalog, tab)
    const knownIds = new Set(known.map((entry) => entry.id))
    const entries = [
      ...known.map((entry) => ({ ...entry, have: owned.has(entry.id) })),
      ...[...owned]
        .filter((id) => !knownIds.has(id))
        .map((id) => ({ id, name: idLabel(id), icon: '', order: Infinity, have: true })),
    ]
    return {
      tab,
      label: t(`collections.archive.tabs.${tab}`),
      entries,
      have: entries.filter((entry) => entry.have).length,
      total: known.length,
      unknown: entries.length - known.length,
    }
  }),
)
const current = computed(() => tabs.value.find((tab) => tab.tab === chosen.value) ?? tabs.value[0]!)
const quests = computed(() => props.captured.quests?.value ?? null)
const worldQuests = computed(() => {
  const list = worldQuestList(props.catalog, quests.value)
  return { have: list.filter((q) => q.done).length, total: list.length }
})
const totals = computed(() => ({
  have: tabs.value.reduce((sum, tab) => sum + tab.have, 0),
  total: tabs.value.reduce((sum, tab) => sum + tab.total, 0),
}))

const note = (tab: ArchiveTab, id: number): string | undefined => {
  if (tab === 'quests') return questChapter(props.catalog, id) || undefined
  if (tab === 'books') {
    const series = props.catalog.data.books.find((book) => book.id === id)?.series
    const name = typeof series === 'number' ? nameOf(props.catalog, 'bookSeries', series) : ''
    return name && !name.startsWith('#') ? name : undefined
  }
  // One entry per set and rarity: the rarity tells them apart.
  if (tab === 'artifacts') {
    const level = props.catalog.data.artifacts.find((row) => row.id === id)?.level
    return typeof level === 'number' ? `${level}★` : undefined
  }
  return undefined
}
const pictured = computed(() => current.value.entries.some((entry) => entry.icon))
/**
 * Every tab's entries have a wiki page each; tutorials and viewpoints as
 * subpages (`Tutorial/Wind Catcher`, `Viewpoint/Manor of Daybreak`: 735 of
 * 742 and 263 of 264 found at 7.1).
 */
const WIKI_PREFIX: Readonly<Partial<Record<ArchiveTab, string>>> = {
  tutorials: 'Tutorial/',
  viewpoints: 'Viewpoint/',
}
const guide = (id: number) =>
  wikiGuide(
    props.catalog,
    ARCHIVE_SECTIONS[current.value.tab].section,
    id,
    WIKI_PREFIX[current.value.tab] ?? '',
  )
const shown = computed<GridEntry[]>(() =>
  current.value.entries
    .filter((entry) => filter.value === 'all' || entry.have === (filter.value === 'have'))
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      ...(pictured.value ? { icon: entry.icon } : {}),
      note: note(current.value.tab, entry.id),
      missing: !entry.have,
      title: [
        entry.name,
        note(current.value.tab, entry.id),
        guide(entry.id) ? t('collections.guide') : '',
      ]
        .filter(Boolean)
        .join(' · '),
      href: guide(entry.id),
    })),
)
</script>

<template>
  <NotCaptured v-if="!archive" :title="$t('collections.tabs.archive')" />
  <div v-else class="flex flex-col gap-4">
    <ul
      class="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4"
      :aria-label="$t('collections.summary')"
    >
      <li class="flex min-w-0">
        <UiStat
          :label="$t('collections.archive.unlocked')"
          :hint="$t('collections.archive.unlockedHint')"
        >
          <template #value>
            <span class="tabular truncate font-mono text-lg font-medium sm:text-xl">
              {{ formatNumber(totals.have)
              }}<span class="text-sm text-text-muted"> / {{ formatNumber(totals.total) }}</span>
            </span>
          </template>
          <UiProgress
            class="mt-1"
            :value="totals.have"
            :max="totals.total"
            :label="$t('collections.archive.unlocked')"
          />
        </UiStat>
      </li>
    </ul>

    <UiPanel flush sticky>
      <template #header>
        <div
          class="scroll-hide scroll-fade-x -mx-5 flex min-w-0 flex-1 items-center gap-2 overflow-x-auto px-5 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:scroll-fade-none"
          role="radiogroup"
          :aria-label="$t('collections.archive.pick')"
        >
          <FilterChip
            v-for="tab in tabs"
            :key="tab.tab"
            radio
            :pressed="chosen === tab.tab"
            @toggle="chosen = tab.tab"
          >
            {{ tab.label }}
            <span
              class="tabular font-mono"
              :class="tab.have >= tab.total ? 'text-success-text' : 'text-text-muted'"
              >{{ formatNumber(tab.have) }}/{{ formatNumber(tab.total) }}</span
            >
          </FilterChip>
          <FilterChip radio :pressed="chosen === WORLD_QUESTS" @toggle="chosen = WORLD_QUESTS">
            {{ $t('collections.archive.tabs.worldQuests') }}
            <span
              class="tabular font-mono"
              :class="
                worldQuests.have >= worldQuests.total ? 'text-success-text' : 'text-text-muted'
              "
              >{{ formatNumber(worldQuests.have) }}/{{ formatNumber(worldQuests.total) }}</span
            >
          </FilterChip>
        </div>
      </template>
      <template v-if="chosen !== WORLD_QUESTS" #toolbar>
        <HaveFilter
          v-model="filter"
          :have="current.have - current.unknown"
          :total="current.total"
          :label="$t('collections.archive.show')"
        />
      </template>
      <div v-if="chosen === WORLD_QUESTS" class="p-3 sm:p-5">
        <WorldQuestsList v-model:filter="filter" :catalog="catalog" :quests="quests" />
      </div>
      <div v-else class="flex flex-col gap-3 p-3 sm:p-5">
        <EntryGrid v-if="shown.length > 0" :entries="shown" :label="current.label" />
        <UiEmpty
          v-else-if="filter === 'missing'"
          :title="$t('collections.spincrystals.allCollected')"
        >
          <template #icon><CheckCheck class="text-success-text" aria-hidden="true" /></template>
        </UiEmpty>
        <UiEmpty v-else :title="$t('collections.archive.none')">
          <template #icon><SearchX aria-hidden="true" /></template>
        </UiEmpty>
      </div>
    </UiPanel>
  </div>
</template>
