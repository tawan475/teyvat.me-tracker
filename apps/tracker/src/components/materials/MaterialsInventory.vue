<script setup lang="ts">
import { compareText } from '@/lib/search'
import { computed, ref, watch } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from 'lucide-vue-next'
import GameIcon from '@/components/ui/GameIcon.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiSwitch from '@/components/ui/UiSwitch.vue'
import { indexAtOrBefore, valueAt, type MaterialsHistory } from '@/data/materials'
import { formatDate, formatNumber, formatSigned } from '@/lib/format'
import { isPlayerProperty, materialMatcher, materialName } from '@/utils/materials'

/**
 * The newest snapshot's materials: icon, name, count, and the change against
 * the snapshot about 7 or 30 days older. Searchable, sortable, paged.
 */
const props = defineProps<{
  history: MaterialsHistory
  icon: (key: string) => string
  /** Where "Import" goes when the newest snapshot has no materials. */
  importTo: RouteLocationRaw
}>()
/** Also list player properties older Irminsul builds stored as materials. */
const includeProperties = defineModel<boolean>('includeProperties', { required: true })

const DAY = 86_400_000
const PAGE_SIZE = 50

type Period = 7 | 30
const period = ref<Period>(7)
const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
]
const show = ref<'all' | 'changed'>('all')
const SHOW_OPTIONS = [
  { value: 'all' as const, label: 'All' },
  { value: 'changed' as const, label: 'Changed' },
]

/** The snapshot the change column compares against (null: history too short). */
const reference = computed(() => {
  const { times } = props.history
  const index = indexAtOrBefore(times, (times.at(-1) ?? 0) - period.value * DAY)
  return index >= 0 ? { index, takenAt: times[index]! } : null
})

const propertyCount = computed(() => {
  let n = 0
  for (const key of props.history.latest.keys()) if (isPlayerProperty(key)) n++
  return n
})

interface Row {
  key: string
  name: string
  count: number
  change: number | null
}

const rows = computed<Row[]>(() => {
  const base = reference.value
  const rows: Row[] = []
  for (const [key, count] of props.history.latest) {
    if (!includeProperties.value && isPlayerProperty(key)) continue
    rows.push({
      key,
      name: materialName(key),
      count,
      change: base ? count - valueAt(props.history.series.get(key), base.index) : null,
    })
  }
  return rows
})

// ------------------------------------------------------------------ controls

type SortKey = 'name' | 'count' | 'change'
const sortKey = ref<SortKey>('count')
const descending = ref(true)
const query = ref('')
const page = ref(1)

/** Narrow screens fold the columns, so the sort is a control there. */
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'count', label: 'Count' },
  { value: 'name', label: 'Name' },
  { value: 'change', label: 'Change' },
]
const sortSelect = computed({
  get: () => sortKey.value,
  set: (key: SortKey) => {
    sortKey.value = key
    descending.value = key !== 'name'
  },
})
function sortBy(key: SortKey) {
  if (sortKey.value === key) descending.value = !descending.value
  else sortSelect.value = key
}
const ariaSort = (key: SortKey) =>
  sortKey.value === key ? (descending.value ? 'descending' : 'ascending') : undefined

watch([query, show, period, sortKey, descending, includeProperties], () => (page.value = 1))

const filtered = computed(() => {
  const match = materialMatcher(query.value)
  let list = rows.value
  if (show.value === 'changed') list = list.filter((r) => r.change !== null && r.change !== 0)
  if (match) list = list.filter((r) => match(r.name) || match(r.key))

  const sign = descending.value ? -1 : 1
  const key = sortKey.value
  const byName = (a: Row, b: Row) => compareText(a.name, b.name)
  return [...list].sort((a, b) => {
    if (key === 'name') return sign * byName(a, b)
    const av = a[key]
    const bv = b[key]
    // No comparison (history too short) always sinks.
    if (av === null || bv === null) return av === bv ? byName(a, b) : av === null ? 1 : -1
    return sign * (av - bv) || byName(a, b)
  })
})

const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / PAGE_SIZE)))
watch(pages, (n) => {
  if (page.value > n) page.value = n
})
const pageRows = computed(() =>
  filtered.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE),
)
const firstShown = computed(() => (filtered.value.length ? (page.value - 1) * PAGE_SIZE + 1 : 0))
const lastShown = computed(() => Math.min(page.value * PAGE_SIZE, filtered.value.length))

const table = ref<HTMLTableElement>()
function goTo(next: number) {
  page.value = next
  table.value?.scrollIntoView({ block: 'start' })
}

function clearFilters() {
  query.value = ''
  show.value = 'all'
}

const deltaClass = (value: number | null) =>
  value === null || value === 0
    ? 'text-text-muted'
    : value > 0
      ? 'text-success-text'
      : 'text-danger-text'
const showDelta = (value: number | null) => (value === null ? '—' : formatSigned(value))
const deltaTitle = (value: number | null) =>
  value === null
    ? `No snapshot ${period.value} days older yet`
    : `${value > 0 ? '+' : ''}${formatNumber(value)} in ${period.value} days`

const changeTitle = computed(() =>
  reference.value
    ? `Newest snapshot vs ${formatDate(reference.value.takenAt)}`
    : `History is shorter than ${period.value} days`,
)
</script>

<template>
  <UiPanel flush>
    <template #header>
      <h2 class="font-display text-xl font-bold">Inventory</h2>
      <span class="tabular font-mono text-sm text-text-muted" title="Kinds of material">{{
        formatNumber(rows.length)
      }}</span>
    </template>

    <div class="flex flex-wrap items-center gap-3 border-b border-border-subtle px-5 py-4">
      <UiInput
        v-model="query"
        type="search"
        autocomplete="off"
        placeholder="Search"
        aria-label="Search materials"
        class="min-w-0 flex-1 basis-48"
      />
      <div class="flex flex-wrap items-center gap-2">
        <UiSegmented v-model="show" :options="SHOW_OPTIONS" label="Show" />
        <UiSegmented v-model="period" :options="PERIOD_OPTIONS" label="Change over" />
        <UiSegmented
          v-model="sortSelect"
          :options="SORT_OPTIONS"
          label="Sort by"
          class="sm:hidden"
        />
      </div>
      <UiSwitch
        v-if="propertyCount > 0"
        v-model="includeProperties"
        label="Player stats"
        title="Account stats (world level, stamina, Property IDs) that older capture app builds saved as materials. Not items."
        class="w-full"
      />
    </div>

    <div v-if="rows.length === 0" class="flex flex-col items-center gap-3 px-5 py-12">
      <p class="text-text-secondary">No materials</p>
      <UiButton :to="importTo">Import</UiButton>
    </div>

    <div v-else-if="filtered.length === 0" class="flex flex-col items-center gap-3 px-5 py-12">
      <p class="text-text-secondary">No matches</p>
      <UiButton @click="clearFilters">Clear filters</UiButton>
    </div>

    <template v-else>
      <table ref="table" class="w-full scroll-mt-20 table-fixed text-left">
        <caption class="sr-only">
          Materials in the newest snapshot
        </caption>
        <thead class="border-b border-border-subtle text-sm text-text-secondary">
          <tr>
            <th scope="col" class="py-1 pl-5" :aria-sort="ariaSort('name')">
              <button
                type="button"
                class="inline-flex min-h-11 items-center gap-1 font-medium hover:text-text-primary"
                @click="sortBy('name')"
              >
                Material
                <component
                  :is="descending ? ArrowDown : ArrowUp"
                  v-if="sortKey === 'name'"
                  class="size-4"
                  aria-hidden="true"
                />
              </button>
            </th>
            <th
              scope="col"
              class="hidden w-36 py-1 text-right sm:table-cell"
              :aria-sort="ariaSort('count')"
            >
              <button
                type="button"
                class="inline-flex min-h-11 items-center gap-1 font-medium hover:text-text-primary"
                @click="sortBy('count')"
              >
                <component
                  :is="descending ? ArrowDown : ArrowUp"
                  v-if="sortKey === 'count'"
                  class="size-4"
                  aria-hidden="true"
                />
                Count
              </button>
            </th>
            <th
              scope="col"
              class="hidden w-32 py-1 pr-5 text-right sm:table-cell"
              :aria-sort="ariaSort('change')"
            >
              <button
                type="button"
                class="inline-flex min-h-11 items-center gap-1 font-medium hover:text-text-primary"
                :title="changeTitle"
                @click="sortBy('change')"
              >
                <component
                  :is="descending ? ArrowDown : ArrowUp"
                  v-if="sortKey === 'change'"
                  class="size-4"
                  aria-hidden="true"
                />
                Change
              </button>
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border-subtle">
          <tr v-for="row in pageRows" :key="row.key">
            <td class="py-2 pr-5 pl-5 sm:pr-2">
              <div class="flex min-w-0 items-center gap-3">
                <GameIcon :src="icon(row.key)" :name="row.name" size="sm" />
                <div class="min-w-0 flex-1">
                  <div class="line-clamp-2 break-words" :title="row.name">{{ row.name }}</div>
                  <!-- Narrow screens: count and change fold under the name. -->
                  <div class="tabular flex flex-wrap gap-x-3 font-mono text-sm sm:hidden">
                    <span>{{ formatNumber(row.count) }}</span>
                    <span :class="deltaClass(row.change)" :title="deltaTitle(row.change)">{{
                      showDelta(row.change)
                    }}</span>
                  </div>
                </div>
              </div>
            </td>
            <td class="tabular hidden py-2 text-right font-mono sm:table-cell">
              {{ formatNumber(row.count) }}
            </td>
            <td
              class="tabular hidden py-2 pr-5 text-right font-mono sm:table-cell"
              :class="deltaClass(row.change)"
              :title="deltaTitle(row.change)"
            >
              {{ showDelta(row.change) }}
            </td>
          </tr>
        </tbody>
      </table>

      <nav
        class="flex items-center justify-between gap-3 border-t border-border-subtle px-5 py-2"
        aria-label="Inventory pages"
      >
        <span class="tabular font-mono text-sm text-text-secondary"
          >{{ formatNumber(firstShown) }}–{{ formatNumber(lastShown) }} /
          {{ formatNumber(filtered.length) }}</span
        >
        <div v-if="pages > 1" class="flex items-center gap-1">
          <UiIconButton
            label="Previous page"
            :disabled="page <= 1"
            class="disabled:opacity-40"
            @click="goTo(page - 1)"
          >
            <ChevronLeft class="size-5" aria-hidden="true" />
          </UiIconButton>
          <span class="tabular px-1 font-mono text-sm text-text-secondary"
            >{{ page }}/{{ pages }}</span
          >
          <UiIconButton
            label="Next page"
            :disabled="page >= pages"
            class="disabled:opacity-40"
            @click="goTo(page + 1)"
          >
            <ChevronRight class="size-5" aria-hidden="true" />
          </UiIconButton>
        </div>
      </nav>
    </template>
  </UiPanel>
</template>
