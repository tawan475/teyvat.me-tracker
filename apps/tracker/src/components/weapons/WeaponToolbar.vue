<script setup lang="ts">
import { computed } from 'vue'
import { ArrowUp, Backpack, Layers, List, Search } from 'lucide-vue-next'
import { t } from '@/i18n'
import SortControl from '@/components/characters/SortControl.vue'
import FilterChip from '@/components/ui/FilterChip.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSegmented, { type SegmentedOption } from '@/components/ui/UiSegmented.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiToolbar from '@/components/ui/UiToolbar.vue'
import {
  LEVEL_OPTIONS,
  WEAPON_RARITIES,
  WEAPON_SORTS,
  WEAPON_TYPES,
  WEAPON_TYPE_LABELS,
  type SortDirection,
  type WeaponFilters,
  type WeaponSort,
  type WeaponType,
  type WeaponView,
} from '@/data/weapons'
import { formatNumber } from '@/lib/format'

/**
 * Search, sort, view and the armory filters. Chip counts are copies that
 * would match if you picked the chip, with the other filters applied.
 */
defineProps<{
  typeCounts: ReadonlyMap<WeaponType | null, number>
  rarityCounts: ReadonlyMap<number | null, number>
  /** Rarities the inventory has at all (a chip without any says so). */
  present: ReadonlySet<number>
  refinableCount: number
  /** Matching copies / all copies, shown while filtering. */
  shown: number
  total: number
  filtered: boolean
}>()
const filters = defineModel<WeaponFilters>('filters', { required: true })
const sort = defineModel<WeaponSort>('sort', { required: true })
const direction = defineModel<SortDirection>('direction', { required: true })
const view = defineModel<WeaponView>('view', { required: true })
defineEmits<{ clear: [] }>()

const RARITY_TEXT: Record<number, string> = {
  5: 'text-rarity-5',
  4: 'text-rarity-4',
  3: 'text-rarity-3',
  2: 'text-rarity-2',
  1: 'text-rarity-1',
}
const VIEWS = computed<SegmentedOption<WeaponView>[]>(() => [
  { value: 'bag', label: t('weapons.toolbar.bag'), icon: Backpack },
  { value: 'weapon', label: t('weapons.toolbar.byWeapon'), icon: Layers },
  { value: 'list', label: t('weapons.toolbar.list'), icon: List },
])
const statusOptions = computed(() => [
  { value: 'all' as const, label: t('weapons.toolbar.status') },
  { value: 'equipped' as const, label: t('weapons.toolbar.equipped') },
  { value: 'unequipped' as const, label: t('weapons.toolbar.unused') },
])
const lockOptions = computed(() => [
  { value: 'all' as const, label: t('weapons.toolbar.lock') },
  { value: 'locked' as const, label: t('weapons.toolbar.locked') },
  { value: 'unlocked' as const, label: t('weapons.toolbar.unlocked') },
])

function toggleType(type: WeaponType) {
  filters.value.type = filters.value.type === type ? 'all' : type
}
function toggleRarity(r: (typeof WEAPON_RARITIES)[number]) {
  filters.value.rarity = filters.value.rarity === r ? 'all' : r
}
</script>

<template>
  <UiToolbar :label="$t('weapons.toolbar.label')" sticky>
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
          :title="$t('weapons.toolbar.searchTitle')"
          autocomplete="off"
        />
      </label>
      <SortControl
        v-model:sort="sort"
        v-model:direction="direction"
        class="min-w-0 flex-1 sm:w-48 sm:flex-none"
        :options="WEAPON_SORTS"
      />
      <UiSegmented
        v-model="view"
        :options="VIEWS"
        :label="$t('characters.toolbar.view')"
        icon-only
      />
    </div>

    <div
      class="scroll-hide scroll-fade-x -mx-3 flex gap-2 overflow-x-auto px-3 sm:mx-0 sm:scroll-fade-none sm:flex-wrap sm:overflow-visible sm:px-0"
      role="group"
      :aria-label="$t('weapons.toolbar.chips')"
    >
      <FilterChip
        v-for="t in WEAPON_TYPES"
        :key="t"
        :pressed="filters.type === t"
        :count="typeCounts.get(t) ?? 0"
        @toggle="toggleType(t)"
      >
        {{ WEAPON_TYPE_LABELS[t] }}
      </FilterChip>
      <span class="my-1 w-px shrink-0 bg-border-default" aria-hidden="true" />
      <FilterChip
        v-for="r in WEAPON_RARITIES"
        :key="r"
        :pressed="filters.rarity === r"
        :count="rarityCounts.get(r) ?? 0"
        :title="present.has(r) ? undefined : $t('weapons.toolbar.noneInCapture')"
        @toggle="toggleRarity(r)"
      >
        <span :class="RARITY_TEXT[r]">{{ r }}★</span>
      </FilterChip>
      <span class="my-1 w-px shrink-0 bg-border-default" aria-hidden="true" />
      <FilterChip
        :pressed="filters.refinable"
        :count="refinableCount"
        :title="$t('weapons.toolbar.refinableTitle')"
        @toggle="filters.refinable = !filters.refinable"
      >
        <ArrowUp class="size-4 text-success-text" aria-hidden="true" />
        {{ $t('weapons.toolbar.refinable') }}
      </FilterChip>
    </div>

    <div class="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:items-center">
      <label class="min-w-0 sm:w-36">
        <span class="sr-only">{{ $t('weapons.toolbar.equipped') }}</span>
        <UiSelect v-model="filters.status" :options="statusOptions" />
      </label>
      <label class="min-w-0 sm:w-32">
        <span class="sr-only">{{ $t('weapons.toolbar.lock') }}</span>
        <UiSelect v-model="filters.lock" :options="lockOptions" />
      </label>
      <label class="min-w-0 sm:w-32">
        <span class="sr-only">{{ $t('weapons.sort.level') }}</span>
        <UiSelect v-model="filters.level" :options="LEVEL_OPTIONS" />
      </label>
      <div
        v-if="filtered"
        class="col-span-3 flex items-center justify-between gap-2 sm:ml-auto sm:justify-end"
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
