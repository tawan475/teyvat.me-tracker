<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, CheckCheck, Disc3, Music, Search, SearchX } from 'lucide-vue-next'
import FilterChip from '@/components/ui/FilterChip.vue'
import GameIcon from '@/components/ui/GameIcon.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiProgress from '@/components/ui/UiProgress.vue'
import UiSegmented, { type SegmentedOption } from '@/components/ui/UiSegmented.vue'
import UiStat from '@/components/ui/UiStat.vue'
import { nameOf, type CollectionCatalog } from '@/data/collection-names'
import {
  SPINCRYSTAL_ICON,
  filterSpincrystals,
  spincrystalGuide,
  type SpincrystalFilter,
  type SpincrystalProgress,
  type SpincrystalRow,
} from '@/data/spincrystals'
import { gameIcon } from '@/lib/assets'
import { formatNumber } from '@/lib/format'
import { normalizeSearch } from '@/lib/search'
import { readStorage, writeStorage } from '@/lib/storage'
import { materialEnglishName, materialName, materialRarity } from '@/utils/materials'
import { t } from '@/i18n'

/**
 * Radiant Spincrystals, like the Serenitea Pot's music list (and seelie's
 * page, the user's example): collected / total, then the songs by region,
 * each with its number ("#12") and its song, the six every Pot starts with
 * marked Default. Region chips, All / Missing / Have and a search stay in
 * the panel's sticky header. `progress` is null while no capture has the list.
 */
const props = defineProps<{ progress: SpincrystalProgress | null; catalog: CollectionCatalog }>()

const FILTER_KEY = 'collections:spincrystals'
const FILTERS: SpincrystalFilter[] = ['all', 'missing', 'have']
const stored = readStorage(FILTER_KEY) as SpincrystalFilter | null
const filter = ref<SpincrystalFilter>(stored && FILTERS.includes(stored) ? stored : 'all')
watch(filter, (value) => writeStorage(FILTER_KEY, value === 'all' ? null : value))
const region = ref<number | null>(null)
const query = ref('')

const missing = computed(() => (props.progress ? props.progress.total - props.progress.have : 0))
const options = computed<SegmentedOption<SpincrystalFilter>[]>(() => {
  const p = props.progress
  const counts = { all: p?.total, missing: missing.value, have: p?.have }
  return FILTERS.map((value) => ({
    value,
    label: t(`collections.spincrystals.filters.${value}`),
    count: counts[value],
  }))
})

/** A song's name in the language on screen (English when it has none). */
const song = (row: SpincrystalRow) => nameOf(props.catalog, 'spincrystals', row.id)
/** Its region's name; 99 (songs of no region) reads as Other. */
const regionName = (city: number) => {
  if (city === 99) return t('collections.archive.otherRegion')
  const name = nameOf(props.catalog, 'cities', city)
  return name && !name.startsWith('#') ? name : t('collections.archive.otherRegion')
}

/** The regions in the game's order, with what the capture holds of each. */
const regions = computed(() => {
  const out: { city: number; label: string; have: number; total: number }[] = []
  for (const row of props.progress?.rows ?? []) {
    let r = out.find((x) => x.city === row.city)
    if (!r) out.push((r = { city: row.city, label: regionName(row.city), have: 0, total: 0 }))
    r.total++
    if (row.have) r.have++
  }
  return out
})

const sections = computed(() => {
  const p = props.progress
  if (!p) return []
  const needle = normalizeSearch(query.value.trim())
  const matches = (row: SpincrystalRow) =>
    !needle ||
    normalizeSearch(song(row)).includes(needle) ||
    (row.number !== null && String(row.number) === needle) ||
    (row.key !== null && normalizeSearch(materialName(row.key)).includes(needle))
  const shown = filterSpincrystals(p.rows, filter.value).filter(
    (row) => (region.value === null || row.city === region.value) && matches(row),
  )
  return regions.value
    .map((r) => ({ ...r, rows: shown.filter((row) => row.city === r.city) }))
    .filter((r) => r.rows.length)
})
const empty = computed(() =>
  props.progress && sections.value.length === 0
    ? query.value.trim()
      ? 'search'
      : filter.value
    : null,
)

const icon = computed(() => gameIcon(SPINCRYSTAL_ICON))
const title = computed(() => t('collections.spincrystals.title'))

const collectedHint = computed(() => {
  const unknown = props.progress?.unknown.length ?? 0
  const hint = t('collections.spincrystals.collectedHint')
  return unknown
    ? `${hint} · ${t('collections.spincrystals.unknown', { n: formatNumber(unknown) })}`
    : hint
})

const state = (row: SpincrystalRow) =>
  t(`collections.spincrystals.${row.have ? 'stateHave' : 'stateMissing'}`)
/** What the card's tooltip says: the item (or Default), the song, have / missing. */
const cardTitle = (row: SpincrystalRow) =>
  [
    row.key ? materialName(row.key) : t('collections.spincrystals.defaultTip'),
    song(row),
    state(row),
    row.key ? t('collections.guide') : '',
  ]
    .filter(Boolean)
    .join(' · ')
/** Its wiki page (where the item is found); the starting songs have none. */
const guide = (row: SpincrystalRow) =>
  row.key ? spincrystalGuide(row, materialEnglishName(row.key)) : undefined
</script>

<template>
  <div class="flex flex-col gap-4 lg:gap-6">
    <ul
      v-if="progress"
      class="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4"
      :aria-label="$t('collections.spincrystals.summary')"
    >
      <li class="flex min-w-0">
        <UiStat :label="$t('collections.spincrystals.collected')" :hint="collectedHint">
          <template #value>
            <span class="tabular truncate font-mono text-lg font-medium sm:text-xl">
              {{ formatNumber(progress.have)
              }}<span class="text-sm text-text-muted"> / {{ formatNumber(progress.total) }}</span>
            </span>
          </template>
          <UiProgress
            class="mt-1"
            :value="progress.have"
            :max="progress.total"
            :label="$t('collections.spincrystals.collectedLabel')"
          />
        </UiStat>
      </li>
      <li class="flex min-w-0">
        <UiStat
          :label="$t('collections.spincrystals.missing')"
          :value="missing"
          exact
          :hint="$t('collections.spincrystals.missingHint')"
        />
      </li>
    </ul>

    <UiPanel flush sticky>
      <template #header>
        <div class="flex min-w-0 items-center gap-2.5">
          <GameIcon
            :src="icon"
            :name="title"
            :rarity="materialRarity('RadiantSpincrystal1') ?? 4"
            size="xs"
          />
          <h2 class="truncate text-base font-semibold">{{ title }}</h2>
        </div>
      </template>
      <template v-if="progress" #actions>
        <UiSegmented
          v-model="filter"
          :options="options"
          :label="$t('collections.spincrystals.show')"
        />
      </template>
      <template v-if="progress" #toolbar>
        <div class="flex flex-col gap-3">
          <div
            class="scroll-hide scroll-fade-x -mx-3 flex min-w-0 items-center gap-2 overflow-x-auto px-3 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:scroll-fade-none"
            role="radiogroup"
            :aria-label="$t('collections.spincrystals.region')"
          >
            <FilterChip radio :pressed="region === null" @toggle="region = null">
              {{ $t('collections.spincrystals.filters.all') }}
              <span class="tabular font-mono text-text-muted"
                >{{ formatNumber(progress.have) }}/{{ formatNumber(progress.total) }}</span
              >
            </FilterChip>
            <FilterChip
              v-for="r in regions"
              :key="r.city"
              radio
              :pressed="region === r.city"
              @toggle="region = r.city"
            >
              {{ r.label }}
              <span
                class="tabular font-mono"
                :class="r.have >= r.total ? 'text-success-text' : 'text-text-muted'"
                >{{ formatNumber(r.have) }}/{{ formatNumber(r.total) }}</span
              >
            </FilterChip>
          </div>
          <label class="relative min-w-0 sm:w-72">
            <span class="sr-only">{{ $t('collections.spincrystals.search') }}</span>
            <Search
              class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-muted"
              aria-hidden="true"
            />
            <UiInput
              v-model="query"
              type="search"
              class="pl-9"
              :placeholder="$t('collections.spincrystals.search')"
              autocomplete="off"
            />
          </label>
        </div>
      </template>

      <UiEmpty
        v-if="!progress"
        :title="$t('collections.spincrystals.notCaptured')"
        :body="$t('collections.spincrystals.notCapturedBody')"
      >
        <template #icon><Disc3 aria-hidden="true" /></template>
      </UiEmpty>
      <UiEmpty v-else-if="empty === 'missing'" :title="$t('collections.spincrystals.allCollected')">
        <template #icon><CheckCheck class="text-success-text" aria-hidden="true" /></template>
      </UiEmpty>
      <UiEmpty v-else-if="empty === 'search'" :title="$t('characters.page.noMatches')">
        <template #icon><SearchX aria-hidden="true" /></template>
      </UiEmpty>
      <UiEmpty v-else-if="empty" :title="$t('collections.spincrystals.noneCollected')">
        <template #icon><SearchX aria-hidden="true" /></template>
      </UiEmpty>

      <div v-else class="flex flex-col gap-5 p-3 sm:p-5">
        <section v-for="s in sections" :key="s.city" :aria-label="s.label">
          <h3 class="mb-2 flex items-center gap-2 text-sm font-medium">
            <span class="truncate">{{ s.label }}</span>
            <span
              class="tabular font-mono"
              :class="s.have >= s.total ? 'text-success-text' : 'text-text-muted'"
              >{{ formatNumber(s.have) }}/{{ formatNumber(s.total) }}</span
            >
            <span class="h-px min-w-4 flex-1 bg-border-default" aria-hidden="true" />
          </h3>
          <ul class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-1.5">
            <li v-for="row in s.rows" :key="row.id" class="flex min-w-0">
              <component
                :is="guide(row) ? 'a' : 'div'"
                :href="guide(row)"
                :target="guide(row) ? '_blank' : undefined"
                :rel="guide(row) ? 'noopener noreferrer' : undefined"
                class="flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-sm transition-colors"
                :class="
                  row.have
                    ? 'border-accent-text/40 bg-accent/10 hover:bg-accent/20'
                    : 'border-dashed border-border-strong text-text-secondary hover:border-solid hover:text-text-primary'
                "
                :title="cardTitle(row)"
              >
                <!-- Number (or Default / a song-named item's note), then the song -->
                <span
                  class="tabular flex h-6 min-w-9 shrink-0 items-center justify-center rounded-md px-1.5 font-mono text-xs font-semibold"
                  :class="row.have ? 'bg-accent/20 text-accent-text' : 'bg-surface-sunken'"
                >
                  <template v-if="row.number !== null">#{{ row.number }}</template>
                  <template v-else-if="row.isDefault">{{
                    $t('collections.spincrystals.default')
                  }}</template>
                  <Music v-else class="size-3.5" aria-hidden="true" />
                </span>
                <span class="line-clamp-2 min-w-0 flex-1 leading-snug break-words">{{
                  song(row)
                }}</span>
                <Check
                  v-if="row.have"
                  class="size-4 shrink-0 text-accent-text"
                  :aria-label="state(row)"
                />
                <span v-else class="sr-only">{{ state(row) }}</span>
              </component>
            </li>
          </ul>
        </section>
      </div>
    </UiPanel>
  </div>
</template>
