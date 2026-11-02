<script setup lang="ts">
import { firstScreen } from '@/lib/first-screen'
import { compareText } from '@/lib/search'
import { computed, nextTick, onMounted, ref, useTemplateRef, watch } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import { useIntersectionObserver } from '@vueuse/core'
import type { BagTabInfo } from '@gdt/game-data/bag'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  LayoutGrid,
  List,
  Package,
  Search,
  SearchX,
  Upload,
} from 'lucide-vue-next'
import { useProgressive } from '@/components/planner/use-progressive'
import ItemArt from '@/components/ui/ItemArt.vue'
import FilterChip from '@/components/ui/FilterChip.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiSegmented, { type SegmentedOption } from '@/components/ui/UiSegmented.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { t } from '@/i18n'
import { formatNumber } from '@/lib/format'
import { readStorage, writeStorage } from '@/lib/storage'
import { materialMatcher, matchRank } from '@/utils/materials'
import DeltaText from './DeltaText.vue'
import MaterialIcon from './MaterialIcon.vue'
import MaterialTile from './MaterialTile.vue'
import { bagSections, parseFolded } from './bag-sections'
import { tabDisplay } from './bag-tabs'
import type { MaterialItem } from './material-items'
import { compareInGame, tabsHolding, type TabKey } from './material-meta'

/**
 * The bag, as the in-game Inventory shows it: an All tab, then the game's
 * tabs that hold something (Weapons for enhancement ores, Artifacts for
 * Sanctifying items, Character Development Items, Food, Materials…, Other
 * for what the Inventory doesn't show), each in the game's order by default.
 * Tiles like the game's (or a named list), filtered by what moved and by
 * name. Renders in pages as it scrolls, so 1,400 materials cost what 150 do.
 */
const props = defineProps<{
  /** Every material held in any snapshot. */
  items: MaterialItem[]
  /** The Inventory's tabs, left to right (from the game data). */
  tabs: readonly BagTabInfo[]
  changes: Map<string, number>
  /** False when there is nothing to compare with (a single snapshot). */
  compared: boolean
  /** Tooltip end for the changes ("since Jul 12, 2026"). */
  hint: string
  tracked: string[]
  icon: (key: string) => string
  importTo: RouteLocationRaw
  /** Counts set by hand on the Planner (where they differ from the capture's). */
  edited?: ReadonlyMap<string, number>
}>()
/** A tile was opened: the tile, and whether by touch (for the inventory editor). */
const emit = defineEmits<{ open: [key: string, anchor: HTMLElement, touch: boolean] }>()

function open(key: string, event: MouseEvent) {
  emit(
    'open',
    key,
    event.currentTarget as HTMLElement,
    (event as PointerEvent).pointerType === 'touch',
  )
}

// ------------------------------------------------------------------ controls

type Show = 'owned' | 'gained' | 'spent'
type Sort = 'order' | 'count' | 'change' | 'name'
type View = 'grid' | 'list'
type Tab = TabKey | 'all'

const SORTS: Sort[] = ['order', 'count', 'change', 'name']
const sortOptions = computed(() =>
  SORTS.map((value) => ({ value, label: t(`materials.bag.sorts.${value}`) })),
)
const SORT_KEY = 'materials:sort'
const VIEW_KEY = 'materials:view'
const TAB_KEY = 'materials:tab'
const FOLDED_KEY = 'materials:folded'

const storedSort = readStorage(SORT_KEY)
const sort = ref<Sort>(SORTS.includes(storedSort as Sort) ? (storedSort as Sort) : 'order')
watch(sort, (value) => writeStorage(SORT_KEY, value))
const view = ref<View>(readStorage(VIEW_KEY) === 'list' ? 'list' : 'grid')
watch(view, (value) => writeStorage(VIEW_KEY, value))
/** The chosen tab; one this account has nothing in shows All (and stays chosen). */
const tab = ref<Tab>((readStorage(TAB_KEY) as Tab | null) ?? 'all')
function pickTab(value: Tab) {
  tab.value = value
  writeStorage(TAB_KEY, value)
}

// On phones the tab row scrolls sideways: bring a remembered tab's chip into it.
const tabRow = useTemplateRef<HTMLElement>('tabRow')
onMounted(async () => {
  await nextTick()
  const row = tabRow.value
  const chip = row?.querySelector<HTMLElement>('[aria-checked="true"]')
  if (!row || !chip) return
  const box = row.getBoundingClientRect()
  const at = chip.getBoundingClientRect()
  if (at.left < box.left || at.right > box.right) row.scrollLeft += at.left - box.left - 16
})

/** Tabs folded to their heading on All (per device). */
const folded = ref(parseFolded(readStorage(FOLDED_KEY)))
function saveFolded(next: Set<TabKey>) {
  folded.value = next
  writeStorage(FOLDED_KEY, next.size ? [...next].join(',') : null)
}
function toggleFold(key: TabKey) {
  const next = new Set(folded.value)
  if (!next.delete(key)) next.add(key)
  saveFolded(next)
}

const query = ref('')
const show = ref<Show>('owned')

// Nothing to compare with (one snapshot): gained / spent are off.
watch(
  () => props.compared,
  (compared) => {
    if (!compared) show.value = 'owned'
  },
)

const trackedSet = computed(() => new Set(props.tracked))
const changeOf = (key: string) => props.changes.get(key) ?? 0

// ------------------------------------------------------------------ filtering

/** Owned, gained or spent: the pool before the name and tab filters. */
const pools = computed(() => {
  const owned: MaterialItem[] = []
  const gained: MaterialItem[] = []
  const spent: MaterialItem[] = []
  for (const item of props.items) {
    if (item.count > 0) owned.push(item)
    const change = props.changes.get(item.key) ?? 0
    if (change > 0) gained.push(item)
    else if (change < 0) spent.push(item)
  }
  return { owned, gained, spent }
})

/** After the name search, which also finds materials now at 0. */
const searched = computed(() => {
  const match = materialMatcher(query.value)
  if (!match) return pools.value[show.value]
  const pool =
    show.value === 'owned'
      ? props.items
      : props.items.filter((item) => (show.value === 'gained' ? 1 : -1) * changeOf(item.key) > 0)
  return pool.filter((item) => match(item.name) || match(item.key))
})

/** Tabs that hold anything this account ever had, in the game's order (Other last). */
const tabKeys = computed(() => tabsHolding(props.tabs, props.items))
const activeTab = computed<Tab>(() =>
  tab.value !== 'all' && tabKeys.value.includes(tab.value) ? tab.value : 'all',
)

const tabCounts = computed(() => {
  const counts = new Map<TabKey, number>()
  for (const item of searched.value) counts.set(item.tab, (counts.get(item.tab) ?? 0) + 1)
  return counts
})

const tabChips = computed(() => [
  {
    key: 'all' as Tab,
    label: t('materials.bag.all'),
    title: t('materials.bag.allTitle'),
    icon: null,
    count: searched.value.length,
  },
  ...tabKeys.value.map((key) => {
    const display = tabDisplay(key)
    return {
      key: key as Tab,
      label: display.label,
      title: display.title,
      icon: display.icon,
      count: tabCounts.value.get(key) ?? 0,
    }
  }),
])

/** Gained and spent always list the biggest moves first. */
const sortBy = computed<Sort>(() => (show.value === 'owned' ? sort.value : 'change'))

const filtered = computed(() => {
  const list =
    activeTab.value === 'all'
      ? searched.value
      : searched.value.filter((i) => i.tab === activeTab.value)
  const q = query.value.trim()
  const by = sortBy.value
  const compare = (a: MaterialItem, b: MaterialItem): number => {
    if (by === 'count') return b.count - a.count
    if (by === 'change') return Math.abs(changeOf(b.key)) - Math.abs(changeOf(a.key))
    if (by === 'name') return compareText(a.name, b.name)
    return 0
  }
  return [...list].sort(
    (a, b) =>
      (q ? matchRank(a.name, q) - matchRank(b.name, q) : 0) || compare(a, b) || compareInGame(a, b),
  )
})

// ------------------------------------------------------------------ paging

const PAGE = { grid: 168, list: 90 }
const limit = ref(PAGE[view.value])
watch([query, show, activeTab, sort, view], () => (limit.value = PAGE[view.value]))

/**
 * All, in the game's order: a heading per tab, as the game's tabs follow
 * one another, each foldable. Any other sort, a search or one tab: one run.
 */
const grouped = computed(
  () => activeTab.value === 'all' && sortBy.value === 'order' && !query.value.trim(),
)
// A page of tiles mounts a few rows first and the rest over the next frames.
const { shown: mounted } = useProgressive(limit, 36, 36)
const paged = computed(() => {
  const upTo = Math.min(limit.value, mounted.value)
  if (grouped.value) return bagSections(filtered.value, folded.value, upTo)
  const items = filtered.value.slice(0, upTo)
  return {
    sections: [{ tab: null, total: filtered.value.length, items, open: true }],
    more: filtered.value.length - items.length,
  }
})
const sections = computed(() => paged.value.sections)
/** The tiles a wide screen shows first: their pictures load first. */
const first = computed(() =>
  firstScreen(
    sections.value.map((s) => (s.open ? s.items : [])),
    (item) => item.key,
  ),
)
/** What a "more" adds; nothing while the page is still mounting. */
const more = computed(() => (mounted.value >= limit.value ? paged.value.more : 0))

/** The tabs shown on All, for folding or unfolding them all at once. */
const allFolded = computed(() => tabKeys.value.every((key) => folded.value.has(key)))
function foldAll() {
  saveFolded(allFolded.value ? new Set() : new Set(tabKeys.value))
}

const NEAR_PX = 600
const sentinel = useTemplateRef<HTMLElement>('sentinel')

/** Adds a page while the end of the list is near the viewport (checked after layout). */
async function fillIfNear() {
  await nextTick()
  const el = sentinel.value
  if (!el || more.value <= 0) return
  if (el.getBoundingClientRect().top < window.innerHeight + NEAR_PX) {
    limit.value += PAGE[view.value]
  }
}
useIntersectionObserver(
  sentinel,
  ([entry]) => {
    if (entry?.isIntersecting) void fillIfNear()
  },
  { rootMargin: `${NEAR_PX}px 0px` },
)
watch([limit, folded, more], () => void fillIfNear())

function clearFilters() {
  query.value = ''
  show.value = 'owned'
  pickTab('all')
}

// ------------------------------------------------------------------ display

const heading = computed(() =>
  activeTab.value === 'all' ? null : tabDisplay(activeTab.value as TabKey),
)

const showTabs = computed<SegmentedOption<Show>[]>(() => [
  {
    value: 'owned',
    label: t('materials.bag.owned'),
    title: t('materials.bag.ownedTitle'),
    count: pools.value.owned.length,
  },
  {
    value: 'gained',
    label: t('materials.bag.gained'),
    title: t('materials.bag.gainedTitle', { hint: props.hint }),
    count: pools.value.gained.length,
    icon: ArrowUp,
    iconClass: 'text-success-text',
    disabled: !props.compared,
  },
  {
    value: 'spent',
    label: t('materials.bag.spent'),
    title: t('materials.bag.spentTitle', { hint: props.hint }),
    count: pools.value.spent.length,
    icon: ArrowDown,
    iconClass: 'text-danger-text',
    disabled: !props.compared,
  },
])

/** The count shown: the hand-set one where the Planner has one. */
const countOf = (item: MaterialItem) => props.edited?.get(item.key) ?? item.count

function tileTitle(item: MaterialItem): string {
  const change = changeOf(item.key)
  const delta = change ? ` (${change > 0 ? '+' : '−'}${formatNumber(Math.abs(change))})` : ''
  const hand = props.edited?.get(item.key)
  const edit =
    hand === undefined
      ? ''
      : t('materials.bag.handSet', {
          hand: formatNumber(hand),
          capture: formatNumber(item.count),
        })
  return `${t('materials.bag.tile', { name: item.name, count: formatNumber(item.count) })}${delta}${edit}`
}
const viewOptions = computed<SegmentedOption<View>[]>(() => [
  { value: 'grid', label: t('materials.bag.views.grid'), icon: LayoutGrid },
  { value: 'list', label: t('materials.bag.views.list'), icon: List },
])
</script>

<template>
  <UiPanel flush sticky>
    <template #header>
      <h2 class="flex min-w-0 items-center gap-2 text-base font-semibold">
        <template v-if="heading">
          <component
            :is="heading.icon"
            class="size-4 shrink-0 text-text-muted"
            aria-hidden="true"
          />
          <span class="truncate" :title="heading.title">{{ heading.name }}</span>
        </template>
        <template v-else>{{ $t('materials.bag.title') }}</template>
      </h2>
      <div class="flex flex-wrap items-center gap-2">
        <UiSegmented v-model="show" :options="showTabs" :label="$t('materials.bag.show')" compact />
        <UiSegmented
          v-model="view"
          :options="viewOptions"
          :label="$t('materials.bag.view')"
          icon-only
        />
      </div>
    </template>

    <div class="flex flex-col gap-3 border-b border-border-default px-4 py-3 sm:px-5">
      <div
        ref="tabRow"
        class="scroll-hide scroll-fade-x -mx-4 flex scroll-px-4 gap-2 overflow-x-auto px-4 sm:mx-0 sm:scroll-fade-none sm:flex-wrap sm:px-0"
        role="radiogroup"
        :aria-label="$t('materials.bag.tabRow')"
      >
        <FilterChip
          v-for="chip in tabChips"
          :key="chip.key"
          radio
          :pressed="activeTab === chip.key"
          :count="chip.count"
          :title="chip.title"
          @toggle="pickTab(chip.key)"
        >
          <component :is="chip.icon" v-if="chip.icon" class="size-4" aria-hidden="true" />
          {{ chip.label }}
        </FilterChip>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <div class="relative min-w-0 flex-1 basis-20 sm:basis-32">
          <Search
            class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-muted"
            aria-hidden="true"
          />
          <UiInput
            v-model="query"
            type="search"
            autocomplete="off"
            spellcheck="false"
            :placeholder="$t('materials.search')"
            :aria-label="$t('materials.searchLabel')"
            class="pl-9"
          />
        </div>
        <UiSelect
          v-if="show === 'owned'"
          v-model="sort"
          :options="sortOptions"
          :aria-label="$t('materials.bag.sort')"
          :title="$t('materials.bag.sort')"
          class="w-28 sm:w-36"
        />
        <UiIconButton
          v-if="grouped && tabKeys.length > 1"
          :label="allFolded ? $t('materials.bag.unfoldAll') : $t('materials.bag.foldAll')"
          @click="foldAll"
        >
          <ChevronsUpDown v-if="allFolded" class="size-5" aria-hidden="true" />
          <ChevronsDownUp v-else class="size-5" aria-hidden="true" />
        </UiIconButton>
      </div>
    </div>

    <div class="p-3 sm:p-5">
      <UiEmpty v-if="items.length === 0" :title="$t('materials.noMaterials')">
        <template #icon><Package aria-hidden="true" /></template>
        <UiButton variant="primary" :to="importTo">
          <Upload class="size-4" aria-hidden="true" />
          {{ $t('materials.import') }}
        </UiButton>
      </UiEmpty>

      <UiEmpty v-else-if="filtered.length === 0" :title="$t('materials.noMatches')">
        <template #icon><SearchX aria-hidden="true" /></template>
        <UiButton @click="clearFilters">{{ $t('materials.clear') }}</UiButton>
      </UiEmpty>

      <div v-else class="flex flex-col gap-1">
        <section
          v-for="section in sections"
          :key="section.tab ?? 'all'"
          :aria-label="section.tab ? tabDisplay(section.tab).name : undefined"
          :class="section.open && section.tab ? 'pb-4' : ''"
        >
          <h3 v-if="section.tab" class="text-sm font-medium" :class="section.open ? 'mb-2' : ''">
            <button
              type="button"
              class="-mx-1 flex min-h-8 w-[calc(100%+0.5rem)] items-center gap-2 rounded-md px-1 text-left transition-colors hover:bg-surface-overlay"
              :title="tabDisplay(section.tab).title"
              :aria-expanded="section.open"
              @click="toggleFold(section.tab)"
            >
              <ChevronDown
                class="size-4 shrink-0 text-text-muted transition-transform"
                :class="section.open ? '' : '-rotate-90'"
                aria-hidden="true"
              />
              <component
                :is="tabDisplay(section.tab).icon"
                class="size-4 shrink-0 text-text-muted"
                aria-hidden="true"
              />
              <span class="truncate">{{ tabDisplay(section.tab).name }}</span>
              <span class="tabular font-mono text-text-muted">{{
                formatNumber(section.total)
              }}</span>
              <span class="h-px min-w-4 flex-1 bg-border-default" aria-hidden="true" />
            </button>
          </h3>

          <!-- A folded tab shows only its heading -->
          <template v-if="section.open">
            <!-- Icons: the in-game bag -->
            <ul
              v-if="view === 'grid'"
              class="grid grid-cols-[repeat(auto-fill,minmax(3.25rem,1fr))] gap-2 sm:grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] sm:gap-3"
            >
              <li v-for="item in section.items" :key="item.key" class="flex">
                <MaterialTile
                  :name="item.name"
                  :priority="first.has(item.key)"
                  :src="icon(item.key)"
                  :rarity="item.rarity"
                  :count="countOf(item)"
                  :change="changeOf(item.key)"
                  :tracked="trackedSet.has(item.key)"
                  :edited="edited?.has(item.key) ?? false"
                  :label="tileTitle(item)"
                  @open="open(item.key, $event)"
                />
              </li>
            </ul>

            <!-- List: names, counts and changes -->
            <ul v-else class="grid gap-x-6 sm:grid-cols-2 xl:grid-cols-3">
              <li v-for="item in section.items" :key="item.key" class="min-w-0">
                <button
                  type="button"
                  class="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-overlay"
                  :title="tileTitle(item)"
                  @click="open(item.key, $event)"
                >
                  <span
                    class="relative size-10 shrink-0 rounded-lg bg-surface-overlay p-0.5 text-xs"
                    :class="item.count === 0 ? 'opacity-40 grayscale' : ''"
                  >
                    <span class="absolute inset-0 overflow-hidden rounded-lg">
                      <ItemArt :rarity="item.rarity" small />
                    </span>
                    <MaterialIcon :src="icon(item.key)" :name="item.name" />
                    <span
                      v-if="trackedSet.has(item.key)"
                      class="absolute -top-0.5 -left-0.5 size-2 rounded-full bg-accent ring-2 ring-surface-raised"
                      aria-hidden="true"
                    />
                  </span>
                  <span class="min-w-0 flex-1 truncate text-sm">{{ item.name }}</span>
                  <span class="flex shrink-0 flex-col items-end">
                    <span
                      class="tabular font-mono text-sm font-semibold"
                      :class="edited?.has(item.key) ? 'text-accent-text' : ''"
                      >{{ formatNumber(countOf(item)) }}</span
                    >
                    <DeltaText :value="changeOf(item.key) || null" :hint="hint" class="text-xs" />
                  </span>
                </button>
              </li>
            </ul>
          </template>
        </section>

        <div v-if="more > 0" ref="sentinel" class="flex justify-center">
          <UiButton size="sm" @click="limit += PAGE[view]">
            {{ $t('materials.more', { n: formatNumber(more) }) }}
          </UiButton>
        </div>
      </div>
    </div>
  </UiPanel>
</template>
