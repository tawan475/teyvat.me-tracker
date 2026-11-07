<script setup lang="ts">
import { compareText } from '@/lib/search'
import { computed, nextTick, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { t } from '@/i18n'
import { locale } from '@/i18n/locale'
import { refDebounced, useMediaQuery } from '@vueuse/core'
import { Backpack, Gem, Layers, LayoutGrid, Rows3, SearchX, Upload } from 'lucide-vue-next'
import ArtifactBag from '@/components/artifacts/ArtifactBag.vue'
import { useProgressive } from '@/components/planner/use-progressive'
import ArtifactCard from '@/components/artifacts/ArtifactCard.vue'
import ArtifactDetail from '@/components/artifacts/ArtifactDetail.vue'
import { drawArtifactCard } from '@/components/artifacts/artifact-canvas'
import { artifactPieceName } from '@/components/artifacts/piece-name'
import { ARTIFACT_SHARE_SCALE, ARTIFACT_SHARE_WIDTH } from '@/components/artifacts/card-style'
import ShareActions from '@/components/share/ShareActions.vue'
import ShareMenu from '@/components/share/ShareMenu.vue'
import ArtifactSetBreakdown from '@/components/artifacts/ArtifactSetBreakdown.vue'
import ArtifactSetsTable from '@/components/artifacts/ArtifactSetsTable.vue'
import ArtifactTable from '@/components/artifacts/ArtifactTable.vue'
import ArtifactToolbar from '@/components/artifacts/ArtifactToolbar.vue'
import LowerRarityStrip from '@/components/artifacts/LowerRarityStrip.vue'
import { SLOT_ICONS } from '@/components/artifacts/styles'
import PageHeader from '@/components/ui/PageHeader.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import UiError from '@/components/ui/UiError.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiPager from '@/components/ui/UiPager.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiSegmented, { type SegmentedOption } from '@/components/ui/UiSegmented.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import { loadLatestInventory, loadPreviousArtifactIds } from '@/data/account-data'
import { MAIN_STAT_ORDER, formatSetName, formatSlotName } from '@/utils/artifact-stats'
import {
  SLOT_KEYS,
  SUBSTAT_KEYS,
  activeFilterCount,
  bestPerSlot,
  buildArtifactRows,
  withArtifactRows,
  clearedFilters,
  compileFilter,
  cvRank,
  defaultDescending,
  facetCounts,
  isNewPiece,
  isSpare,
  rarityGroups,
  samePiece,
  sortRows,
  summarizeSets,
  type ArtifactFilters,
  type ArtifactRow,
  type ArtifactSort,
  type ArtifactView,
  type SetOption,
  type SlotKey,
} from '@/data/artifacts'
import {
  loadFilters,
  loadFlag,
  loadView,
  saveFilters,
  saveFlag,
  saveView,
} from '@/data/artifact-prefs'
import { useResource } from '@/data/use-resource'
import { readJson, writeJson } from '@/lib/storage'
import { resolvedTheme } from '@/lib/theme'
import { useCardExport } from '@/lib/use-card-export'
import { canvasPng } from '@/lib/card-canvas'
import { formatNumber } from '@/lib/format'
import { useAccount, useAccountLink, useDemo, useReadOnly } from './context'

/** Cards are tall, rows are not: a page of each fills a few screens. The Bag fills in as it goes. */
const PAGE_SIZE: Record<ArtifactView, number> = {
  cards: 60,
  table: 100,
  bag: Infinity,
  sets: Infinity,
}
/** Icons only on a phone; the name stays in the tooltip. */
const VIEW_OPTIONS = computed<SegmentedOption<ArtifactView>[]>(() => [
  { value: 'cards', label: t('characters.toolbar.cards'), icon: LayoutGrid },
  { value: 'bag', label: t('weapons.toolbar.bag'), icon: Backpack },
  { value: 'table', label: t('artifacts.page.table'), icon: Rows3 },
  { value: 'sets', label: t('characters.sets'), icon: Layers },
])
/** Sorts that rank 5★ pieces above the rest, so lower rarities sink to the end. */
const STRIP_SORTS: readonly ArtifactSort[] = ['cv', 'rv', 'potential']

const account = useAccount()
/** Staff Inspect: nothing here links to the owner's own pages. */
const readOnly = useReadOnly()
const demo = useDemo()
const accountLink = useAccountLink()
const inventory = useResource(
  () => account.value,
  (a) => withArtifactRows(loadLatestInventory(a)),
)
/** The previous capture's catalog ids, for "New" (null: none, or not loaded yet). */
const previousIds = useResource(
  () => account.value,
  (a) => loadPreviousArtifactIds(a),
)
const previous = computed(() => previousIds.data.value ?? null)

/** Derived once per inventory (CV, RV, rolls, potential, search text); cached by the data module. */
const rows = computed<ArtifactRow[]>(() => {
  const inv = inventory.data.value
  return inv ? buildArtifactRows(inv.good.artifacts, inv.artifactIds) : []
})

// ------------------------------------------------------------- filter state
// Per account, remembered on this device. Always replaced, never mutated, so
// a plain watch sees every change.
const filters = shallowRef<ArtifactFilters>(loadFilters(account.value.id))
watch(
  () => account.value.id,
  (id) => (filters.value = loadFilters(id)),
)
watch(filters, (value) => saveFilters(account.value.id, value))

// Typing should not re-filter 2,000 artifacts on every key.
const debouncedSearch = refDebounced(
  computed(() => filters.value.search),
  150,
)
const applied = computed<ArtifactFilters>(() => ({
  ...filters.value,
  search: debouncedSearch.value,
}))

// Filtering a sorted list keeps its order, so sorting only reruns on a sort change.
const sorted = computed(() => sortRows(rows.value, filters.value.sort, filters.value.descending))
const matches = computed(() =>
  sorted.value.filter(compileFilter(applied.value, undefined, previous.value)),
)
/** What the list shows: the matches, or with "Best" their top pieces per slot. */
const results = computed(() => (applied.value.best ? bestPerSlot(matches.value) : matches.value))

// ------------------------------------------------------------------ counts
const presetCounts = computed(() => {
  let feedable = 0
  let spare = 0
  let maxed = 0
  let zero = 0
  let fresh = 0
  for (const row of rows.value) {
    if (row.feedable) feedable++
    if (isSpare(row)) {
      spare++
      if (row.artifact.level === 0) zero++
    }
    if (row.artifact.level >= 20) maxed++
    if (isNewPiece(row, previous.value)) fresh++
  }
  return { feedable, spare, maxed, zero, fresh: previous.value ? fresh : null }
})

const facet = <K,>(name: Parameters<typeof facetCounts>[2], key: (row: ArtifactRow) => K) =>
  facetCounts(rows.value, applied.value, name, key, previous.value)

const inventorySets = computed(() => {
  const keys = new Set<string>()
  for (const row of rows.value) keys.add(row.artifact.setKey)
  return keys
})
const setOptions = computed<SetOption[]>(() => {
  const counts = facet('sets', (r) => r.artifact.setKey)
  const keys = new Set([...inventorySets.value, ...filters.value.sets])
  return [...keys].map((key) => ({ key, name: formatSetName(key), count: counts.get(key) ?? 0 }))
})
const ownerOptions = computed<SetOption[]>(() => {
  const counts = facet('owners', (r) => r.artifact.location)
  const names = new Map<string, string>()
  for (const row of rows.value) if (row.equipped) names.set(row.artifact.location, row.ownerName)
  for (const key of filters.value.owners) if (!names.has(key)) names.set(key, key)
  return [...names].map(([key, name]) => ({ key, name, count: counts.get(key) ?? 0 }))
})
const slotCounts = computed(() => facet('slots', (r) => r.artifact.slotKey))
const rarityCounts = computed(() => facet('rarities', (r) => r.artifact.rarity))
const presentRarities = computed(() => {
  const present = new Set<number>()
  for (const row of rows.value) present.add(row.artifact.rarity)
  return present
})
const lineCounts = computed(() => facet('lines', (r) => r.lines))
/** Per substat: matches if it were added to the substats already picked. */
const substatCounts = computed(() => {
  const pass = compileFilter(applied.value, 'substats', previous.value)
  const wanted = applied.value.substats
  const counts = new Map<string, number>()
  for (const row of rows.value) {
    if (!pass(row)) continue
    let hasWanted = true
    for (const key of wanted) {
      if (!(row.subMask & (1 << SUBSTAT_KEYS.indexOf(key as (typeof SUBSTAT_KEYS)[number])))) {
        hasWanted = false
        break
      }
    }
    if (!hasWanted) continue
    SUBSTAT_KEYS.forEach((key, bit) => {
      if (row.subMask & (1 << bit)) counts.set(key, (counts.get(key) ?? 0) + 1)
    })
  }
  return counts
})
const mainStats = computed(() => {
  const counts = facet('mainStat', (r) => r.artifact.mainStatKey)
  const keys = new Set<string>()
  for (const row of rows.value) keys.add(row.artifact.mainStatKey)
  if (filters.value.mainStat) keys.add(filters.value.mainStat)
  const rank = (key: string) => {
    const index = MAIN_STAT_ORDER.indexOf(key)
    return index === -1 ? MAIN_STAT_ORDER.length : index
  }
  return [...keys]
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((key) => ({ key, count: counts.get(key) ?? 0 }))
})

/** Sets among the current matches, biggest first. */
const matchSets = computed<SetOption[]>(() => {
  const counts = new Map<string, number>()
  for (const row of matches.value) {
    counts.set(row.artifact.setKey, (counts.get(row.artifact.setKey) ?? 0) + 1)
  }
  return [...counts]
    .map(([key, count]) => ({ key, name: formatSetName(key), count }))
    .sort((a, b) => b.count - a.count || compareText(a.name, b.name))
})

const filtering = computed(() => activeFilterCount(applied.value) > 0)

function toggleSet(key: string) {
  const sets = filters.value.sets
  filters.value = {
    ...filters.value,
    sets: sets.includes(key) ? sets.filter((k) => k !== key) : [...sets, key],
  }
}

function clearFilters() {
  filters.value = clearedFilters(filters.value)
}

// -------------------------------------------------------------------- views
const view = ref<ArtifactView>(loadView())
watch(view, saveView)

/** Table headers: the active column flips direction, another starts in its natural one. */
function sortBy(sort: ArtifactSort) {
  const f = filters.value
  filters.value =
    f.sort === sort
      ? { ...f, descending: !f.descending }
      : { ...f, sort, descending: defaultDescending(sort) }
}

/** Only built while the Sets view is open. */
const setSummaries = computed(() => (view.value === 'sets' ? summarizeSets(matches.value) : []))

/** From the Sets view: that set (and slot) in the Bag. */
function pickSet(setKey: string, slot?: SlotKey) {
  filters.value = { ...filters.value, sets: [setKey], slots: slot ? [slot] : [] }
  view.value = 'bag'
}

// ---------------------------------------------------------------- the Bag
/** Rarity groups, only while the Bag is open. */
const bagGroups = computed(() => (view.value === 'bag' ? rarityGroups(results.value) : []))
/**
 * Open groups, per device. By default only 5★ (lower rarities fold away when
 * there are 5★); a lone group is always open.
 */
const bagOpenSaved = ref<number[] | null>(readJson<number[] | null>('artifacts:bag-open', null))
const bagOpen = computed<ReadonlySet<number>>(() => {
  const groups = bagGroups.value
  const open = new Set<number>(
    Array.isArray(bagOpenSaved.value)
      ? bagOpenSaved.value
      : groups.some((g) => g.rarity === 5)
        ? [5]
        : groups.map((g) => g.rarity),
  )
  if (groups.length === 1) open.add(groups[0]!.rarity)
  return open
})
function toggleBagGroup(rarity: number) {
  const open = new Set(bagOpen.value)
  if (open.has(rarity)) open.delete(rarity)
  else open.add(rarity)
  bagOpenSaved.value = [...open]
  writeJson('artifacts:bag-open', bagOpenSaved.value)
}

// ---------------------------------------------------- lower-rarity strip
/** Below-5★ matches, while a CV/RV/Potential sort sinks them and no rarity is picked. */
const lowerRows = computed(() => {
  const f = applied.value
  if (view.value === 'bag' || view.value === 'sets') return []
  if (f.rarities.length || f.best || !STRIP_SORTS.includes(f.sort)) return []
  return matches.value.filter((row) => row.artifact.rarity < 5)
})
const stripOpen = ref(loadFlag('lower-open', false))
watch(stripOpen, (open) => saveFlag('lower-open', open))

// --------------------------------------------------------------- pagination
const page = ref(1)
const pageSize = computed(() => PAGE_SIZE[view.value])
const pageCount = computed(() => Math.max(1, Math.ceil(results.value.length / pageSize.value)))
// A new filter, view or account starts at the top; new data keeps the page.
watch([applied, view, () => account.value.id], () => (page.value = 1))
watch(pageCount, (count) => (page.value = Math.min(page.value, count)))
const pageRows = computed(() =>
  Number.isFinite(pageSize.value)
    ? results.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value)
    : results.value,
)

// A page of cards or table rows mounts a screenful first and the rest over
// the next frames, so a filter or view change paints at once.
const pageLength = computed(() =>
  view.value === 'cards' || view.value === 'table' ? pageRows.value.length : 0,
)
const { shown: pageShown, restart: restartPage } = useProgressive(pageLength, 16, 16)
watch(pageRows, restartPage)
const shownRows = computed(() =>
  pageShown.value >= pageRows.value.length
    ? pageRows.value
    : pageRows.value.slice(0, pageShown.value),
)

const resultsTop = useTemplateRef<HTMLElement>('resultsTop')
async function goToPage(n: number) {
  page.value = n
  await nextTick()
  const top = resultsTop.value
  if (top && top.getBoundingClientRect().top < 0) top.scrollIntoView({ block: 'start' })
}

/** Cards, split by slot while "Best" groups them. */
const cardGroups = computed(() => {
  if (!applied.value.best) return [{ slot: '', rows: shownRows.value }]
  const groups = new Map<string, ArtifactRow[]>()
  for (const row of shownRows.value) {
    const list = groups.get(row.artifact.slotKey)
    if (list) list.push(row)
    else groups.set(row.artifact.slotKey, [row])
  }
  return [...groups].map(([slot, list]) => ({ slot, rows: list }))
})

// ------------------------------------------------------------------- detail
const openId = ref<number | null>(null)
/** Opened from the lower-rarity strip: stepping then walks the strip. */
const fromStrip = ref(false)
// A live update re-reads the rows: the open piece stays open on its new row
// (a levelled piece too), and closes only when it is gone or the account changed.
watch([rows, () => account.value.id], ([now, id], [before, was]) => {
  const open = openId.value === null || id !== was ? undefined : before?.[openId.value]
  openId.value = open ? (samePiece(now, open)?.id ?? null) : null
})
const openRow = computed(() => (openId.value === null ? null : (rows.value[openId.value] ?? null)))
function openPiece(id: number, strip = false) {
  fromStrip.value = strip
  openId.value = id
}
/** Stepping follows what is on screen: the Bag's groups, the strip, or the list. */
const stepList = computed<ArtifactRow[]>(() => {
  if (view.value === 'bag') return bagGroups.value.flatMap((g) => g.rows)
  if (fromStrip.value && lowerRows.value.length) return lowerRows.value
  return results.value
})
const openIndex = computed(() => (openRow.value ? stepList.value.indexOf(openRow.value) : -1))
const openRank = computed(() => (openRow.value ? cvRank(rows.value, openRow.value) : undefined))

// ----------------------------------------------------------------- share
// The open artifact's share picture (artifact-canvas: the card alone), with
// the share card's theme (one remembered set, `share-card`) and its export
// (lib/use-card-export): PNG / Copy / Share in the dialog's header.

const sharePrefs = readJson<{ theme?: 'light' | 'dark' }>('share-card', {})
const shareTheme = ref<'light' | 'dark'>(sharePrefs.theme ?? resolvedTheme.value)
watch(shareTheme, (theme) =>
  writeJson('share-card', { ...readJson<object>('share-card', {}), theme }),
)
const wide = useMediaQuery('(min-width: 1024px)')
const artifactExport = useCardExport({
  draw: async () => {
    if (!openRow.value) throw new Error('Closed')
    const drawn = await drawArtifactCard(openRow.value, shareTheme.value, ARTIFACT_SHARE_SCALE)
    return { blob: await canvasPng(drawn.canvas), missing: drawn.missing }
  },
  open: () => openRow.value !== null,
  state: () => [openRow.value, shareTheme.value, locale.value],
  filename: () =>
    openRow.value
      ? `${openRow.value.artifact.setKey}-${openRow.value.artifact.slotKey}-teyvat-me.png`
      : 'artifact-teyvat-me.png',
  title: () => openRow.value?.setName ?? t('share.export.artifactTitle'),
  pngLabel: () => t('share.export.download'),
})
/** The dialog's title: the piece's own name, else its set's. */
const openTitle = computed(() =>
  openRow.value
    ? (artifactPieceName(openRow.value.artifact.setKey, openRow.value.artifact.slotKey) ??
      openRow.value.setName)
    : '',
)

function step(delta: number) {
  const index = openIndex.value + delta
  const next = stepList.value[index]
  if (!next) return
  openId.value = next.id
  // Keep the piece on the page behind the dialog.
  if (stepList.value === results.value && Number.isFinite(pageSize.value)) {
    page.value = Math.floor(index / pageSize.value) + 1
  }
}

const GRID =
  'grid grid-cols-1 gap-3 @xl:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-4 @7xl:grid-cols-5'
</script>

<template>
  <PageHeader :title="$t('game.artifacts')" />

  <UiPanel v-if="!account.latest" flush>
    <UiEmpty :title="$t('characters.page.noSnapshots')">
      <template #icon><Gem aria-hidden="true" /></template>
      <UiButton v-if="!readOnly && !demo" variant="primary" :to="accountLink('account-import')">
        <Upload class="size-4" aria-hidden="true" />
        {{ $t('characters.page.import') }}
      </UiButton>
    </UiEmpty>
  </UiPanel>

  <UiError
    v-else-if="inventory.error.value && !inventory.data.value"
    :title="$t('artifacts.page.loadFailed')"
    :error="inventory.error.value"
    @retry="inventory.reload()"
  />

  <div v-else-if="!inventory.data.value" class="flex flex-col gap-4" aria-busy="true">
    <span class="sr-only" role="status">{{ $t('artifacts.page.loading') }}</span>
    <UiSkeleton class="h-28" />
    <UiSkeleton class="h-11 w-64" />
    <div class="@container">
      <div :class="GRID">
        <div
          v-for="n in 8"
          :key="n"
          class="flex flex-col gap-3 rounded-xl border border-border-default bg-surface-raised p-3"
        >
          <div class="flex gap-3">
            <UiSkeleton class="size-12 shrink-0" />
            <div class="flex flex-1 flex-col gap-2">
              <UiSkeleton class="h-5 w-2/3" />
              <UiSkeleton class="h-4 w-1/2" />
            </div>
          </div>
          <UiSkeleton v-for="line in 4" :key="line" class="h-4" />
          <UiSkeleton class="h-9" />
        </div>
      </div>
    </div>
  </div>

  <UiPanel v-else-if="rows.length === 0" flush>
    <UiEmpty :title="$t('characters.detail.noArtifacts')">
      <template #icon><Gem aria-hidden="true" /></template>
      <UiButton v-if="!readOnly && !demo" variant="primary" :to="accountLink('account-import')">
        <Upload class="size-4" aria-hidden="true" />
        {{ $t('characters.page.import') }}
      </UiButton>
    </UiEmpty>
  </UiPanel>

  <div v-else class="flex flex-col gap-4">
    <UiError
      v-if="inventory.error.value"
      :title="$t('artifacts.page.refreshFailed')"
      :error="inventory.error.value"
      @retry="inventory.reload()"
    />

    <ArtifactToolbar
      v-model="filters"
      :sets="setOptions"
      :owners="ownerOptions"
      :slot-counts="slotCounts"
      :rarity-counts="rarityCounts"
      :present="presentRarities"
      :main-stats="mainStats"
      :substat-counts="substatCounts"
      :line-counts="lineCounts"
      :feedable-count="presetCounts.feedable"
      :spare-count="presetCounts.spare"
      :maxed-count="presetCounts.maxed"
      :zero-count="presetCounts.zero"
      :new-count="presetCounts.fresh"
    />

    <div ref="resultsTop" class="flex min-w-0 scroll-mt-20 items-center gap-3">
      <p
        class="tabular shrink-0 font-mono text-lg"
        role="status"
        :title="filtering ? $t('artifacts.page.shownTitle') : $t('game.artifacts')"
      >
        <template v-if="filtering">
          {{ formatNumber(view === 'sets' ? matches.length : results.length)
          }}<span class="text-text-muted"> / {{ formatNumber(rows.length) }}</span>
        </template>
        <template v-else>{{ formatNumber(rows.length) }}</template>
        <span class="sr-only">{{ $t('artifacts.page.countSuffix') }}</span>
      </p>
      <ArtifactSetBreakdown
        v-if="view !== 'sets' && (matchSets.length > 1 || filters.sets.length)"
        class="flex-1"
        :sets="matchSets"
        :selected="filters.sets"
        @toggle="toggleSet"
      />
      <UiSegmented
        v-model="view"
        :options="VIEW_OPTIONS"
        :label="$t('characters.toolbar.view')"
        compact
        class="ml-auto"
      />
    </div>

    <LowerRarityStrip
      v-if="lowerRows.length"
      v-model:open="stripOpen"
      :rows="lowerRows"
      :previous="previous"
      @pick="openPiece($event, true)"
    />

    <UiPanel v-if="results.length === 0" flush>
      <UiEmpty :title="$t('characters.page.noMatches')">
        <template #icon><SearchX aria-hidden="true" /></template>
        <UiButton @click="clearFilters">{{ $t('characters.toolbar.clear') }}</UiButton>
      </UiEmpty>
    </UiPanel>

    <ArtifactSetsTable v-else-if="view === 'sets'" :sets="setSummaries" @pick="pickSet" />

    <ArtifactBag
      v-else-if="view === 'bag'"
      :groups="bagGroups"
      :open="bagOpen"
      :previous="previous"
      @open="openPiece($event)"
      @toggle="toggleBagGroup"
    />

    <template v-else>
      <ArtifactTable
        v-if="view === 'table'"
        :rows="shownRows"
        :sort="filters.sort"
        :descending="filters.descending"
        @open="openPiece($event)"
        @sort="sortBy"
      />

      <div v-else class="@container flex flex-col gap-4">
        <section
          v-for="group in cardGroups"
          :key="group.slot"
          class="flex flex-col gap-2"
          :aria-label="group.slot ? formatSlotName(group.slot) : undefined"
        >
          <h2
            v-if="group.slot"
            class="flex items-center gap-2 text-sm font-medium text-text-secondary"
          >
            <component
              :is="SLOT_ICONS[group.slot as SlotKey]"
              v-if="SLOT_KEYS.includes(group.slot as SlotKey)"
              class="size-4"
              aria-hidden="true"
            />
            {{ formatSlotName(group.slot) }}
          </h2>
          <ul :class="GRID">
            <li v-for="row in group.rows" :key="row.id" class="flex">
              <ArtifactCard
                :row="row"
                :is-new="isNewPiece(row, previous)"
                class="flex-1"
                @open="openPiece($event)"
              />
            </li>
          </ul>
        </section>
      </div>

      <UiPager
        sticky
        :model-value="page"
        :page-count="pageCount"
        :page-size="pageSize"
        :total="results.length"
        @update:model-value="goToPage"
      />
    </template>
  </div>

  <UiModal
    :open="openRow !== null"
    :title="openTitle"
    size="wide"
    :index="openIndex >= 0 ? openIndex : undefined"
    :total="stepList.length"
    @close="openId = null"
    @step="step"
  >
    <template #heading>
      <h2 class="mr-auto min-w-0 flex-1 truncate text-lg font-semibold" :title="openTitle">
        {{ openTitle }}
      </h2>
      <template v-if="openRow">
        <ShareActions
          v-if="wide"
          v-model:theme="shareTheme"
          :exporter="artifactExport"
          theme-only
        />
        <ShareMenu
          v-else
          v-model:theme="shareTheme"
          :exporter="artifactExport"
          :size="$t('artifacts.page.pngSize', { px: ARTIFACT_SHARE_WIDTH * ARTIFACT_SHARE_SCALE })"
          theme-only
        />
      </template>
    </template>
    <!-- The card as the PNG draws it (in the share theme), the details beside it -->
    <div v-if="openRow" class="grid gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <div :data-theme="shareTheme" class="self-start">
        <ArtifactCard :row="openRow" :is-new="isNewPiece(openRow, previous)" still />
      </div>
      <ArtifactDetail
        :row="openRow"
        :rank="openRank"
        :is-new="isNewPiece(openRow, previous)"
        with-card
      />
    </div>
  </UiModal>
</template>
