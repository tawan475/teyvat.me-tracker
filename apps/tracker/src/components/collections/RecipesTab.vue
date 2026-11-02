<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { SearchX } from 'lucide-vue-next'
import EntryGrid, { type GridEntry } from './EntryGrid.vue'
import NotCaptured from './NotCaptured.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiProgress from '@/components/ui/UiProgress.vue'
import UiSegmented, { type SegmentedOption } from '@/components/ui/UiSegmented.vue'
import UiStat from '@/components/ui/UiStat.vue'
import type { CapturedCollections } from '@/data/collections'
import { idLabel, recipeEntries, type CollectionCatalog } from '@/data/collection-names'
import { recipeRows, type RecipeFilter } from '@/data/recipes'
import { formatNumber } from '@/lib/format'
import { readStorage, writeStorage } from '@/lib/storage'
import { wikiPage } from '@/lib/wiki'
import { t } from '@/i18n'

/**
 * Cooking recipes (Capture 1.5.0): every recipe the game has, unlocked or
 * locked, and each unlocked one's proficiency against what masters it.
 */
const props = defineProps<{ captured: CapturedCollections; catalog: CollectionCatalog }>()

const recipes = computed(() => props.captured.recipes?.value ?? null)
const rows = computed(() =>
  recipes.value ? recipeRows(recipeEntries(props.catalog), recipes.value) : [],
)

const FILTERS: RecipeFilter[] = ['all', 'unmastered', 'mastered', 'locked']
const KEY = 'collections:recipes'
const stored = readStorage(KEY) as RecipeFilter | null
const filter = ref<RecipeFilter>(stored && FILTERS.includes(stored) ? stored : 'all')
watch(filter, (value) => writeStorage(KEY, value === 'all' ? null : value))

const counts = computed(() => {
  const out = { all: 0, unmastered: 0, mastered: 0, locked: 0 }
  for (const row of rows.value) {
    if (row.unknown) continue
    out.all++
    out[row.state]++
  }
  return out
})
const options = computed<SegmentedOption<RecipeFilter>[]>(() =>
  FILTERS.map((value) => ({
    value,
    label: t(`collections.recipes.filters.${value}`),
    count: counts.value[value],
  })),
)
const unlocked = computed(() => counts.value.unmastered + counts.value.mastered)

const shown = computed<GridEntry[]>(() =>
  rows.value
    .filter((row) => filter.value === 'all' || row.state === filter.value)
    .map((row) => {
      const figure =
        row.state === 'locked'
          ? undefined
          : `${formatNumber(row.proficiency)} / ${formatNumber(row.max)}`
      return {
        id: row.id,
        name: row.unknown ? idLabel(row.id) : row.name,
        icon: row.icon,
        figure,
        note:
          row.state === 'mastered'
            ? t('collections.recipes.filters.mastered')
            : row.state === 'locked'
              ? t('collections.recipes.filters.locked')
              : undefined,
        missing: row.state === 'locked',
        title: [row.name, '★'.repeat(row.rarity), figure, t('collections.guide')]
          .filter(Boolean)
          .join(' · '),
        href: guide(row.id),
      }
    }),
)

/** The dish's wiki page: titled with its English name ("Sweet Madame"). */
function guide(id: number): string | undefined {
  const english = (props.catalog.english.recipes.get(id) as { name?: string } | undefined)?.name
  return english ? wikiPage(english) : undefined
}
</script>

<template>
  <NotCaptured v-if="!recipes" :title="$t('collections.tabs.recipes')" />
  <div v-else class="flex flex-col gap-4">
    <ul
      class="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4"
      :aria-label="$t('collections.summary')"
    >
      <li class="flex min-w-0">
        <UiStat :label="$t('collections.recipes.unlocked')">
          <template #value>
            <span class="tabular truncate font-mono text-lg font-medium sm:text-xl">
              {{ formatNumber(unlocked)
              }}<span class="text-sm text-text-muted"> / {{ formatNumber(counts.all) }}</span>
            </span>
          </template>
          <UiProgress
            class="mt-1"
            :value="unlocked"
            :max="counts.all"
            :label="$t('collections.recipes.unlocked')"
          />
        </UiStat>
      </li>
      <li class="flex min-w-0">
        <UiStat :label="$t('collections.recipes.filters.mastered')">
          <template #value>
            <span class="tabular truncate font-mono text-lg font-medium sm:text-xl">
              {{ formatNumber(counts.mastered)
              }}<span class="text-sm text-text-muted"> / {{ formatNumber(unlocked) }}</span>
            </span>
          </template>
        </UiStat>
      </li>
    </ul>

    <UiPanel flush sticky>
      <template #header>
        <h2 class="text-base font-semibold">{{ $t('collections.tabs.recipes') }}</h2>
      </template>
      <template #toolbar>
        <div
          class="scroll-hide scroll-fade-x -mx-3 flex max-w-full overflow-x-auto px-3 sm:mx-0 sm:px-0"
        >
          <UiSegmented
            v-model="filter"
            :options="options"
            :label="$t('collections.archive.show')"
          />
        </div>
      </template>
      <div class="flex flex-col gap-3 p-3 sm:p-5">
        <EntryGrid
          v-if="shown.length > 0"
          :entries="shown"
          :label="$t('collections.tabs.recipes')"
          min="15rem"
        />
        <UiEmpty v-else :title="$t('collections.handbook.noneShown')">
          <template #icon><SearchX aria-hidden="true" /></template>
        </UiEmpty>
      </div>
    </UiPanel>
  </div>
</template>
