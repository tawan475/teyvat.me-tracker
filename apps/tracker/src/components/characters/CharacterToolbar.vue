<script setup lang="ts">
import { computed } from 'vue'
import { LayoutGrid, List, Search, Share2, Star, UsersRound } from 'lucide-vue-next'
import { t } from '@/i18n'
import ElementIcon from '@/components/ui/ElementIcon.vue'
import FilterChip from '@/components/ui/FilterChip.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSegmented, { type SegmentedOption } from '@/components/ui/UiSegmented.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiToolbar from '@/components/ui/UiToolbar.vue'
import {
  BUILD_OPTIONS,
  ELEMENTS,
  ELEMENT_LABELS,
  TALENT_OPTIONS,
  WEAPON_TYPES,
  WEAPON_TYPE_LABELS,
  type CharacterFilters,
  type CharacterSort,
  type Element,
  type SortDirection,
  type SortOption,
} from '@/data/characters'
import { formatNumber } from '@/lib/format'
import SortControl from './SortControl.vue'

/**
 * Search, sort, view, and the roster filters. Chip counts are "matches if
 * you pick this", with the other filters applied.
 */
defineProps<{
  /** The sorts the roster offers (see characterSorts). */
  sorts: SortOption[]
  elementCounts: ReadonlyMap<Element | null, number>
  rarityCounts: ReadonlyMap<number | null, number>
  /** Favourites matching the other filters; null hides the chip (none yet). */
  favoriteCount: number | null
  /** Matches / roster size, shown while filtering. */
  shown: number
  total: number
  filtered: boolean
}>()
const filters = defineModel<CharacterFilters>('filters', { required: true })
const sort = defineModel<CharacterSort>('sort', { required: true })
const direction = defineModel<SortDirection>('direction', { required: true })
const view = defineModel<'grid' | 'list'>('view', { required: true })
defineEmits<{ clear: []; share: []; shareBuild: [] }>()

const weaponOptions = computed(() => [
  { value: 'all' as const, label: t('characters.toolbar.weapon') },
  ...WEAPON_TYPES.map((w) => ({ value: w, label: WEAPON_TYPE_LABELS[w] })),
])
const RARITIES = [5, 4] as const
const VIEWS = computed<SegmentedOption<'grid' | 'list'>[]>(() => [
  { value: 'grid', label: t('characters.toolbar.cards'), icon: LayoutGrid },
  { value: 'list', label: t('characters.toolbar.list'), icon: List },
])

function toggleElement(e: Element) {
  filters.value.element = filters.value.element === e ? 'all' : e
}
function toggleRarity(r: 5 | 4) {
  filters.value.rarity = filters.value.rarity === r ? 'all' : r
}
</script>

<template>
  <UiToolbar :label="$t('characters.toolbar.label')" sticky>
    <div class="flex flex-wrap items-center gap-2">
      <label class="relative min-w-0 basis-full sm:min-w-48 sm:basis-0 sm:flex-1">
        <span class="sr-only">{{ $t('characters.toolbar.search') }}</span>
        <Search
          class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-muted"
          aria-hidden="true"
        />
        <UiInput
          v-model="filters.query"
          type="search"
          class="pl-9"
          :placeholder="$t('characters.toolbar.search')"
          :title="$t('characters.toolbar.searchTitle')"
          autocomplete="off"
        />
      </label>
      <SortControl
        v-model:sort="sort"
        v-model:direction="direction"
        class="min-w-0 flex-1 sm:w-48 sm:flex-none"
        :options="sorts"
      />
      <UiSegmented
        v-model="view"
        :options="VIEWS"
        :label="$t('characters.toolbar.view')"
        icon-only
      />
      <!-- Two shares in one control: the roster card, or picked characters' builds -->
      <div
        class="flex basis-full overflow-hidden rounded-lg border border-border-strong bg-surface-overlay shadow-sm sm:shrink-0 sm:basis-auto"
        role="group"
        :aria-label="$t('share.menu.label')"
      >
        <button
          type="button"
          class="inline-flex min-h-[2.375rem] min-w-0 flex-1 items-center sm:flex-none justify-center gap-1.5 px-4 text-sm font-medium whitespace-nowrap text-text-secondary transition-colors select-none hover:bg-surface-raised hover:text-text-primary focus-visible:-outline-offset-2"
          :title="$t('characters.roster.share')"
          @click="$emit('share')"
        >
          <Share2 class="size-4 shrink-0 max-[22.5rem]:hidden" aria-hidden="true" />
          <span class="truncate">{{ $t('characters.roster.share') }}</span>
        </button>
        <span class="w-px shrink-0 bg-border-strong" aria-hidden="true" />
        <button
          type="button"
          class="inline-flex min-h-[2.375rem] min-w-0 flex-1 items-center sm:flex-none justify-center gap-1.5 px-4 text-sm font-medium whitespace-nowrap text-text-secondary transition-colors select-none hover:bg-surface-raised hover:text-text-primary focus-visible:-outline-offset-2"
          :title="$t('characters.team.share')"
          @click="$emit('shareBuild')"
        >
          <UsersRound class="size-4 shrink-0 max-[22.5rem]:hidden" aria-hidden="true" />
          <span class="truncate">{{ $t('characters.team.share') }}</span>
        </button>
      </div>
    </div>

    <div
      class="scroll-hide scroll-fade-x -mx-3 flex gap-2 overflow-x-auto px-3 sm:mx-0 sm:scroll-fade-none sm:flex-wrap sm:overflow-visible sm:px-0"
      role="group"
      :aria-label="$t('characters.toolbar.chips')"
    >
      <template v-if="favoriteCount !== null">
        <FilterChip
          :pressed="filters.favorites"
          :count="favoriteCount"
          :title="$t('characters.toolbar.favorites')"
          @toggle="filters.favorites = !filters.favorites"
        >
          <Star
            class="size-4 fill-game-star text-game-star-edge"
            :stroke-width="1.5"
            aria-hidden="true"
          />
          <span class="sr-only">{{ $t('characters.toolbar.favorites') }}</span>
        </FilterChip>
        <span class="my-1 w-px shrink-0 bg-border-default" aria-hidden="true" />
      </template>
      <FilterChip
        v-for="e in ELEMENTS"
        :key="e"
        :pressed="filters.element === e"
        :count="elementCounts.get(e) ?? 0"
        @toggle="toggleElement(e)"
      >
        <ElementIcon :element="e" decorative size="sm" />
        {{ ELEMENT_LABELS[e] }}
      </FilterChip>
      <span class="my-1 w-px shrink-0 bg-border-default" aria-hidden="true" />
      <FilterChip
        v-for="r in RARITIES"
        :key="r"
        :pressed="filters.rarity === r"
        :count="rarityCounts.get(r) ?? 0"
        @toggle="toggleRarity(r)"
      >
        <span :class="r === 5 ? 'text-rarity-5' : 'text-rarity-4'">{{ r }}★</span>
      </FilterChip>
    </div>

    <div class="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
      <label class="min-w-0 sm:w-36">
        <span class="sr-only">{{ $t('game.weaponTypeTitle') }}</span>
        <UiSelect v-model="filters.weaponType" :options="weaponOptions" />
      </label>
      <label class="min-w-0 sm:w-40">
        <span class="sr-only">{{ $t('characters.build.all') }}</span>
        <UiSelect
          v-model="filters.build"
          :options="BUILD_OPTIONS"
          :title="$t('characters.toolbar.buildTitle')"
        />
      </label>
      <label class="col-span-2 min-w-0 sm:w-36">
        <span class="sr-only">{{ $t('game.talents') }}</span>
        <UiSelect v-model="filters.talents" :options="TALENT_OPTIONS" />
      </label>
      <div
        v-if="filtered"
        class="col-span-2 flex items-center justify-between gap-2 sm:ml-auto sm:justify-end"
      >
        <span class="tabular font-mono text-sm text-text-secondary" aria-live="polite"
          >{{ formatNumber(shown) }} / {{ formatNumber(total) }}</span
        >
        <UiButton variant="ghost" size="sm" @click="$emit('clear')">{{
          $t('characters.toolbar.clear')
        }}</UiButton>
      </div>
    </div>
  </UiToolbar>
</template>
