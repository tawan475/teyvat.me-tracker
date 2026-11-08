<script setup lang="ts">
import { compareText } from '@/lib/search'
import type { PlannerData } from '@gdt/game-data'
import type { Good } from '@gdt/shared'
import { computed, reactive } from 'vue'
import { Check, Search } from 'lucide-vue-next'
import ElementIcon from '@/components/ui/ElementIcon.vue'
import FilterChip from '@/components/ui/FilterChip.vue'
import GameIcon from '@/components/ui/GameIcon.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import {
  ELEMENTS,
  ELEMENT_LABELS,
  WEAPON_TYPES,
  WEAPON_TYPE_LABELS,
  normalizeSearch,
} from '@/data/characters'
import { toElement, type Element } from '@/data/game-meta'
import { t } from '@/i18n'
import { characterIcon } from '@/lib/assets'
import { characterName } from './model'

/**
 * The roster to pick characters from: every character the planner knows
 * (owned first, the others dimmed; the Traveler on every element), but
 * `exclude`d ones, with search and element / weapon / rarity filters. A tap
 * toggles one in `selected` (several with `multi`, else it picks it).
 */
const props = defineProps<{
  planner: PlannerData
  good: Good
  selected: ReadonlySet<string>
  /** Character keys not offered (they have a goal). */
  exclude: ReadonlySet<string>
  multi?: boolean
}>()
const emit = defineEmits<{ toggle: [key: string] }>()

const filters = reactive({
  query: '',
  element: 'all' as Element | 'all',
  weapon: 'all' as string,
  rarity: 'all' as number | 'all',
})

const all = computed(() => {
  const owned = new Map(props.good.characters.map((c) => [c.key, c]))
  return [...props.planner.characters.values()]
    .filter((c) => !props.exclude.has(c.key) && /^[A-Z]/.test(c.key))
    .map((c) => ({
      key: c.key,
      name: characterName(c.key),
      rarity: c.rarity,
      element: toElement(c.element),
      weapon: c.weapon,
      owned: owned.has(c.key),
      level: owned.get(c.key)?.level ?? null,
    }))
    .sort((a, b) => Number(b.owned) - Number(a.owned) || compareText(a.name, b.name))
})

const shown = computed(() => {
  const words = normalizeSearch(filters.query).split(' ').filter(Boolean)
  return all.value.filter(
    (c) =>
      (filters.element === 'all' || c.element === filters.element) &&
      (filters.weapon === 'all' || c.weapon === filters.weapon) &&
      (filters.rarity === 'all' || c.rarity === filters.rarity) &&
      words.every((w) => normalizeSearch(c.name).includes(w)),
  )
})

const weaponOptions = computed(() => [
  { value: 'all', label: t('planner.hint.weapon') },
  ...WEAPON_TYPES.map((w) => ({ value: w as string, label: WEAPON_TYPE_LABELS[w] })),
])
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <label class="relative min-w-0 flex-1 basis-40">
        <span class="sr-only">{{ $t('planner.roster.search') }}</span>
        <Search
          class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-muted"
          aria-hidden="true"
        />
        <UiInput
          v-model="filters.query"
          class="pl-9"
          :placeholder="$t('planner.common.search')"
          type="search"
        />
      </label>
      <UiSelect
        v-model="filters.weapon"
        :options="weaponOptions"
        class="w-32"
        :aria-label="$t('planner.custom.weaponType')"
      />
      <span class="flex gap-1.5">
        <FilterChip
          v-for="r in [5, 4]"
          :key="r"
          :pressed="filters.rarity === r"
          @toggle="filters.rarity = filters.rarity === r ? 'all' : r"
          >{{ r }}★</FilterChip
        >
      </span>
    </div>
    <div
      class="scroll-hide scroll-fade-x -mx-1 flex gap-1.5 overflow-x-auto px-1 sm:mx-0 sm:scroll-fade-none sm:flex-wrap sm:overflow-visible sm:px-0"
      role="group"
      :aria-label="$t('planner.custom.element')"
    >
      <FilterChip
        v-for="e in ELEMENTS"
        :key="e"
        :pressed="filters.element === e"
        :title="ELEMENT_LABELS[e]"
        @toggle="filters.element = filters.element === e ? 'all' : e"
      >
        <ElementIcon :element="e" decorative size="sm" />
        <span class="sr-only sm:not-sr-only">{{ ELEMENT_LABELS[e] }}</span>
      </FilterChip>
    </div>

    <ul
      class="grid grid-cols-[repeat(auto-fill,minmax(4.75rem,1fr))] gap-1.5"
      :aria-label="multi ? $t('planner.roster.multi') : $t('planner.picker.characters')"
    >
      <li v-for="c in shown" :key="c.key">
        <button
          type="button"
          class="relative flex w-full flex-col items-center gap-1 rounded-lg border p-1.5 text-center transition-colors"
          :class="[
            selected.has(c.key)
              ? 'border-accent-text bg-surface-overlay'
              : 'border-transparent hover:bg-surface-overlay',
            c.owned ? '' : 'opacity-60',
          ]"
          :aria-pressed="multi ? selected.has(c.key) : undefined"
          :title="
            c.owned
              ? $t('planner.roster.owned', { name: c.name, level: c.level })
              : $t('planner.roster.notOwned', { name: c.name })
          "
          @click="emit('toggle', c.key)"
        >
          <GameIcon :src="characterIcon(c.key)" :name="c.name" :rarity="c.rarity" size="lg" />
          <span class="line-clamp-2 text-xs leading-tight">{{ c.name }}</span>
          <span
            v-if="selected.has(c.key)"
            class="absolute top-1 right-1 inline-flex size-5 items-center justify-center rounded-full bg-accent text-accent-ink"
            aria-hidden="true"
          >
            <Check class="size-3.5" />
          </span>
        </button>
      </li>
    </ul>
    <p v-if="shown.length === 0" class="py-6 text-center text-sm text-text-muted">
      {{ $t('planner.common.noMatches') }}
    </p>
  </div>
</template>
