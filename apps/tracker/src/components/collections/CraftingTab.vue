<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { CheckCheck, Search, SearchX } from 'lucide-vue-next'
import EntryGrid, { type GridEntry } from './EntryGrid.vue'
import HaveFilter, { type HaveFilterValue } from './HaveFilter.vue'
import NotCaptured from './NotCaptured.vue'
import FilterChip from '@/components/ui/FilterChip.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiProgress from '@/components/ui/UiProgress.vue'
import UiStat from '@/components/ui/UiStat.vue'
import { normalizeSearch } from '@/lib/search'
import type { CapturedCollections } from '@/data/collections'
import { idLabel, nameOf, wikiGuide, type CollectionCatalog } from '@/data/collection-names'
import { formatNumber } from '@/lib/format'
import { readStorage, writeStorage } from '@/lib/storage'
import { t } from '@/i18n'

/**
 * Recipes unlocked (Capture 1.8.0's `gi_collections.crafting`): the crafting
 * bench, the blacksmith and processing, each against the game data's list.
 */
const props = defineProps<{ captured: CapturedCollections; catalog: CollectionCatalog }>()

// Processing is captured but not shown: its game data names most recipes "Fish" (the user).
const KINDS = ['crafting', 'forging'] as const
type Kind = (typeof KINDS)[number]

const crafting = computed(() => props.captured.crafting?.value ?? null)
const TAB_KEY = 'collections:crafting'
const FILTER_KEY = 'collections:crafting-filter'
const storedKind = readStorage(TAB_KEY) as Kind | null
const kind = ref<Kind>(storedKind && KINDS.includes(storedKind) ? storedKind : 'crafting')
watch(kind, (value) => writeStorage(TAB_KEY, value === 'crafting' ? null : value))
const storedFilter = readStorage(FILTER_KEY) as HaveFilterValue | null
const filter = ref<HaveFilterValue>(
  storedFilter === 'missing' || storedFilter === 'have' ? storedFilter : 'all',
)
watch(filter, (value) => writeStorage(FILTER_KEY, value === 'all' ? null : value))

/** By name (accents and case ignored), within the list and filter picked. */
const search = ref('')

const kinds = computed(() =>
  KINDS.map((k) => {
    const owned = new Set(crafting.value?.[k] ?? [])
    const known = props.catalog.data[k].map((r) => ({
      id: r.id,
      name: nameOf(props.catalog, k, r.id),
      // The made item's icon (game data v7.1.27).
      icon: String(r.icon ?? ''),
      have: owned.has(r.id),
    }))
    const knownIds = new Set(known.map((r) => r.id))
    const entries = [
      ...known,
      ...[...owned]
        .filter((id) => !knownIds.has(id))
        .map((id) => ({ id, name: idLabel(id), icon: '', have: true })),
    ]
    return {
      kind: k,
      label: t(`collections.crafting.kinds.${k}`),
      captured: crafting.value?.[k] !== undefined,
      entries,
      have: known.filter((r) => r.have).length,
      total: known.length,
    }
  }),
)
const current = computed(() => kinds.value.find((k) => k.kind === kind.value)!)
const needle = computed(() => normalizeSearch(search.value).trim())
const shown = computed<GridEntry[]>(() =>
  current.value.entries
    .filter((e) => filter.value === 'all' || e.have === (filter.value === 'have'))
    .filter((e) => !needle.value || normalizeSearch(e.name).includes(needle.value))
    .map((e) => {
      const href = wikiGuide(props.catalog, current.value.kind, e.id)
      return {
        id: e.id,
        name: e.name,
        icon: e.icon,
        missing: !e.have,
        title: href ? `${e.name} · ${t('collections.guide')}` : e.name,
        href,
      }
    }),
)
</script>

<template>
  <NotCaptured v-if="!crafting" :title="$t('collections.tabs.crafting')" />
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
              }}<span class="text-sm text-text-muted"> / {{ formatNumber(k.total) }}</span>
            </span>
          </template>
          <UiProgress class="mt-1" :value="k.have" :max="k.total" :label="k.label" />
        </UiStat>
      </li>
    </ul>

    <UiPanel flush sticky>
      <template #header>
        <div
          class="scroll-hide scroll-fade-x -mx-5 flex min-w-0 flex-1 items-center gap-2 overflow-x-auto px-5 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:scroll-fade-none"
          role="radiogroup"
          :aria-label="$t('collections.tabs.crafting')"
        >
          <FilterChip
            v-for="k in kinds"
            :key="k.kind"
            radio
            :pressed="kind === k.kind"
            @toggle="kind = k.kind"
          >
            {{ k.label }}
            <span
              class="tabular font-mono"
              :class="k.have >= k.total ? 'text-success-text' : 'text-text-muted'"
              >{{ formatNumber(k.have) }}/{{ formatNumber(k.total) }}</span
            >
          </FilterChip>
        </div>
      </template>
      <template #toolbar>
        <div class="flex flex-wrap items-center gap-2">
          <label class="relative min-w-0 basis-full sm:w-72 sm:basis-auto">
            <span class="sr-only">{{ $t('materials.search') }}</span>
            <Search
              class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-muted"
              aria-hidden="true"
            />
            <UiInput
              v-model="search"
              type="search"
              class="pl-9"
              :placeholder="$t('materials.search')"
              autocomplete="off"
            />
          </label>
          <HaveFilter
            v-model="filter"
            :have="current.have"
            :total="current.total"
            :label="$t('collections.archive.show')"
          />
        </div>
      </template>
      <div class="flex flex-col gap-3 p-3 sm:p-5">
        <EntryGrid v-if="shown.length > 0" :entries="shown" :label="current.label" />
        <UiEmpty
          v-else-if="filter === 'missing' && !needle"
          :title="$t('collections.spincrystals.allCollected')"
        >
          <template #icon><CheckCheck class="text-success-text" aria-hidden="true" /></template>
        </UiEmpty>
        <UiEmpty
          v-else
          :title="needle ? $t('characters.page.noMatches') : $t('collections.archive.none')"
        >
          <template #icon><SearchX aria-hidden="true" /></template>
        </UiEmpty>
      </div>
    </UiPanel>
  </div>
</template>
