<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { ChevronRight, Search } from 'lucide-vue-next'
import ElementIcon from '@/components/ui/ElementIcon.vue'
import FilterChip from '@/components/ui/FilterChip.vue'
import GameIcon from '@/components/ui/GameIcon.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import {
  ELEMENTS,
  ELEMENT_LABELS,
  NO_CHARACTER_FILTERS,
  WEAPON_TYPES,
  WEAPON_TYPE_LABELS,
  filterCharacters,
  type CharacterView,
  type Element,
  type WeaponType,
} from '@/data/characters'
import { t } from '@/i18n'
import { characterIcon } from '@/lib/assets'
import { CARD_HEIGHT, CARD_WIDTH } from './share-card'
import { MAX_PICKS, teamCardHeight, TEAM_CARD_WIDTH, togglePick } from './team-card'

/**
 * Share build's picker: the roster (in the page's sort) with Add goal's
 * search and filters, 1 to 4 characters picked in order. The number on a
 * portrait is its row on the card, the footer's tray the same order; at
 * four the others dim and wait. Next opens the build card (one) or the
 * team card.
 */
const props = defineProps<{
  open: boolean
  characters: readonly CharacterView[]
}>()
const picks = defineModel<string[]>('picks', { required: true })
const emit = defineEmits<{ close: []; next: [] }>()

const filters = reactive({
  query: '',
  element: 'all' as Element | 'all',
  rarity: 'all' as 'all' | 5 | 4,
  weaponType: 'all' as WeaponType | 'all',
})
watch(
  () => props.open,
  (open) => {
    if (open)
      Object.assign(filters, { query: '', element: 'all', rarity: 'all', weaponType: 'all' })
  },
)

const shown = computed(() =>
  filterCharacters(props.characters, { ...NO_CHARACTER_FILTERS, ...filters }),
)
const byKey = computed(() => new Map(props.characters.map((c) => [c.key, c])))
const picked = computed(() =>
  picks.value.map((key) => byKey.value.get(key)).filter((c): c is CharacterView => !!c),
)
const full = computed(() => picks.value.length >= MAX_PICKS)

const weaponOptions = computed(() => [
  { value: 'all' as const, label: t('characters.toolbar.weapon') },
  ...WEAPON_TYPES.map((w) => ({ value: w, label: WEAPON_TYPE_LABELS[w] })),
])

/** What Next makes: "Build card · 1920 × 1080", "Team card · 1920 × 1542". */
const outcome = computed(() => {
  const n = picks.value.length
  if (n === 0) return ''
  return n === 1
    ? t('characters.buildPicker.buildCard', { size: `${CARD_WIDTH} × ${CARD_HEIGHT}` })
    : t('characters.buildPicker.teamCard', { size: `${TEAM_CARD_WIDTH} × ${teamCardHeight(n)}` })
})

function toggle(key: string) {
  picks.value = togglePick(picks.value, key)
}
</script>

<template>
  <UiModal :open="open" :title="$t('characters.team.share')" size="wide" @close="emit('close')">
    <div class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <label class="relative min-w-0 flex-1 basis-40">
          <span class="sr-only">{{ $t('characters.toolbar.search') }}</span>
          <Search
            class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-muted"
            aria-hidden="true"
          />
          <UiInput
            v-model="filters.query"
            class="pl-9"
            :placeholder="$t('characters.toolbar.search')"
            type="search"
            autocomplete="off"
          />
        </label>
        <UiSelect
          v-model="filters.weaponType"
          :options="weaponOptions"
          class="w-32"
          :aria-label="$t('game.weaponTypeTitle')"
        />
        <span class="flex gap-1.5">
          <FilterChip
            v-for="r in [5, 4] as const"
            :key="r"
            :pressed="filters.rarity === r"
            @toggle="filters.rarity = filters.rarity === r ? 'all' : r"
          >
            <span :class="r === 5 ? 'text-rarity-5' : 'text-rarity-4'">{{ r }}★</span>
          </FilterChip>
        </span>
      </div>
      <div
        class="scroll-hide scroll-fade-x -mx-1 flex gap-1.5 overflow-x-auto px-1"
        role="group"
        :aria-label="$t('characters.toolbar.chips')"
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
        :aria-label="$t('characters.buildPicker.label')"
      >
        <li v-for="c in shown" :key="c.key">
          <button
            type="button"
            class="relative flex w-full flex-col items-center gap-1 rounded-lg border p-1.5 text-center transition-colors"
            :class="
              picks.includes(c.key)
                ? 'border-accent-text bg-surface-overlay'
                : full
                  ? 'cursor-default border-transparent opacity-40'
                  : 'border-transparent hover:bg-surface-overlay'
            "
            :aria-pressed="picks.includes(c.key)"
            :aria-disabled="!picks.includes(c.key) && full ? true : undefined"
            :title="
              !picks.includes(c.key) && full
                ? $t('characters.buildPicker.full', { n: MAX_PICKS })
                : c.name
            "
            @click="toggle(c.key)"
          >
            <GameIcon
              :src="characterIcon(c.key)"
              :name="c.name"
              :rarity="c.rarity ?? undefined"
              size="lg"
            />
            <span class="line-clamp-2 text-xs leading-tight">{{ c.name }}</span>
            <span
              v-if="picks.includes(c.key)"
              class="tabular absolute top-1 right-1 inline-flex size-5 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-ink"
              aria-hidden="true"
              >{{ picks.indexOf(c.key) + 1 }}</span
            >
          </button>
        </li>
      </ul>
      <p v-if="shown.length === 0" class="py-6 text-center text-sm text-text-muted">
        {{ $t('characters.page.noMatches') }}
      </p>
    </div>

    <template #footer>
      <ol
        class="mr-auto flex min-w-0 items-center gap-1.5"
        :aria-label="$t('characters.buildPicker.picked')"
      >
        <li v-for="(c, i) in picked" :key="c.key">
          <button
            type="button"
            class="relative block rounded-lg"
            :title="$t('characters.buildPicker.remove', { name: c.name })"
            :aria-label="$t('characters.buildPicker.remove', { name: c.name })"
            @click="toggle(c.key)"
          >
            <GameIcon
              :src="characterIcon(c.key)"
              :name="c.name"
              :rarity="c.rarity ?? undefined"
              size="sm"
            />
            <span
              class="tabular absolute -top-1.5 -left-1.5 inline-flex size-4.5 items-center justify-center rounded-full bg-accent text-[0.6875rem] font-bold text-accent-ink"
              aria-hidden="true"
              >{{ i + 1 }}</span
            >
          </button>
        </li>
        <li v-if="outcome" class="ml-1 truncate text-sm text-text-muted max-sm:hidden">
          {{ outcome }}
        </li>
      </ol>
      <UiButton class="max-sm:hidden!" @click="emit('close')">{{ $t('common.cancel') }}</UiButton>
      <UiButton
        variant="primary"
        :disabled="picks.length === 0"
        :title="outcome || undefined"
        @click="emit('next')"
      >
        {{ $t('ui.modal.next') }}
        <ChevronRight class="size-4" aria-hidden="true" />
      </UiButton>
    </template>
  </UiModal>
</template>
