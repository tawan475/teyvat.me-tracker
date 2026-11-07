<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { t } from '@/i18n'
import { useRoute, useRouter } from 'vue-router'
import { SearchX, Swords, Upload } from 'lucide-vue-next'
import StatStrip, { type StripItem } from '@/components/characters/StatStrip.vue'
import { useProgressive } from '@/components/planner/use-progressive'
import PageHeader from '@/components/ui/PageHeader.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import UiError from '@/components/ui/UiError.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiPager from '@/components/ui/UiPager.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import WeaponBag from '@/components/weapons/WeaponBag.vue'
import WeaponDetail from '@/components/weapons/WeaponDetail.vue'
import WeaponGroupRow from '@/components/weapons/WeaponGroupRow.vue'
import WeaponTable from '@/components/weapons/WeaponTable.vue'
import WeaponToolbar from '@/components/weapons/WeaponToolbar.vue'
import UnownedWeapons from '@/components/weapons/UnownedWeapons.vue'
import { loadLatestInventory } from '@/data/account-data'
import { useResource } from '@/data/use-resource'
import {
  NO_WEAPON_FILTERS,
  bareWeaponGroup,
  buildArmory,
  filterWeapons,
  groupWeapons,
  hasWeaponFilters,
  raritySections,
  sanitizeWeaponFilters,
  sanitizeWeaponPrefs,
  sortGroups,
  sortWeapons,
  weaponFacetCounts,
  type SortDirection,
  type WeaponFilters,
  type WeaponRow,
  type WeaponSort,
  type WeaponView,
} from '@/data/weapons'
import { readJson, writeJson } from '@/lib/storage'
import { useAccount, useAccountLink, useDemo, useReadOnly } from './context'

const LIST_PAGE = 100

const account = useAccount()
/** Staff Inspect: nothing here links to the owner's own pages. */
const readOnly = useReadOnly()
const demo = useDemo()
const accountLink = useAccountLink()
const inventory = useResource(
  () => account.value,
  (a) => loadLatestInventory(a),
)

const armory = computed(() =>
  inventory.data.value ? buildArmory(inventory.data.value.good) : null,
)

// ------------------------------------------------------------ toolbar state
// Filters per account, sort and view per device; both remembered here.

const filtersKey = (id: number) => `weapons:${id}`
const loadFilters = (id: number) => sanitizeWeaponFilters(readJson<unknown>(filtersKey(id), null))
const filters = reactive<WeaponFilters>(loadFilters(account.value.id))
watch(
  () => account.value.id,
  (id) => Object.assign(filters, loadFilters(id)),
)
watch(filters, () => writeJson(filtersKey(account.value.id), { ...filters }), { deep: true })
const filtered = computed(() => hasWeaponFilters(filters))

const prefs = sanitizeWeaponPrefs(readJson<unknown>('weapons:sort', null))
const sort = ref<WeaponSort>(prefs.sort)
const direction = ref<SortDirection>(prefs.direction)
const view = ref<WeaponView>(prefs.view)
watch([sort, direction, view], () =>
  writeJson('weapons:sort', { sort: sort.value, direction: direction.value, view: view.value }),
)

const rows = computed(() => armory.value?.rows ?? [])
const refine = computed(() => armory.value?.refine ?? new Map())
const matched = computed(() => filterWeapons(rows.value, filters, refine.value))
const matchedCopies = computed(() => matched.value.reduce((sum, r) => sum + r.count, 0))
const sortedRows = computed(() => sortWeapons(matched.value, sort.value, direction.value))
// Only the open view's shape is built.
const sections = computed(() =>
  view.value === 'bag'
    ? raritySections(sortedRows.value, sort.value === 'quality' && direction.value === 'asc')
    : [],
)
const groups = computed(() =>
  view.value === 'weapon'
    ? sortGroups(groupWeapons(matched.value, refine.value), sort.value, direction.value)
    : [],
)

const typeCounts = computed(() =>
  weaponFacetCounts(rows.value, filters, refine.value, 'type', (r) => r.type),
)
const rarityCounts = computed(() =>
  weaponFacetCounts(rows.value, filters, refine.value, 'rarity', (r) => r.rarity),
)
const presentRarities = computed(() => new Set(armory.value?.byRarity.keys() ?? []))

const strip = computed<StripItem[]>(() => {
  const a = armory.value
  if (!a) return []
  const spare5 = filters.status === 'unequipped' && filters.rarity === 5
  return [
    { key: 'total', label: t('game.weapons'), value: a.total },
    {
      key: 'kinds',
      label: t('weapons.page.kinds'),
      value: a.kinds,
      title: t('weapons.page.kindsTitle'),
    },
    { key: 'equipped', label: t('weapons.toolbar.equipped'), value: a.equipped },
    { key: 'five', label: '5★', value: a.byRarity.get(5) ?? 0 },
    { key: 'spare5', label: t('weapons.page.unused5'), value: a.spare5, pressed: spare5 },
    {
      key: 'refinable',
      label: t('weapons.toolbar.refinable'),
      value: a.refine.size,
      title: t('weapons.page.refinableTitle'),
      pressed: filters.refinable,
    },
  ]
})

function toggleStrip(key: string) {
  if (key === 'refinable') filters.refinable = !filters.refinable
  if (key === 'spare5') {
    const on = filters.status === 'unequipped' && filters.rarity === 5
    filters.status = on ? 'all' : 'unequipped'
    filters.rarity = on ? 'all' : 5
  }
}

function clearFilters() {
  Object.assign(filters, NO_WEAPON_FILTERS)
}

// ------------------------------------------------------------------ paging
// The Bag and By weapon show everything (a few hundred tiles at most: copies
// stack); the List pages.

const page = ref(1)
const pageCount = computed(() => Math.ceil(sortedRows.value.length / LIST_PAGE))
const pageRows = computed(() =>
  sortedRows.value.slice((page.value - 1) * LIST_PAGE, page.value * LIST_PAGE),
)
// A new filter, sort, view or account starts at the top; new data keeps the page.
watch([filters, sort, direction, view, () => account.value.id], () => (page.value = 1))
watch(pageCount, (count) => {
  page.value = Math.min(page.value, Math.max(1, count))
})

// By weapon rows and List rows mount a screenful first and the rest over the
// next frames when the view opens; a sort or filter then patches them in place
// (a few hundred rows at most, so a keyed reorder beats mounting again).
const chunked = computed(() =>
  view.value === 'weapon' ? groups.value.length : view.value === 'list' ? pageRows.value.length : 0,
)
const { shown: chunk, restart: restartChunks } = useProgressive(chunked, 20, 20)
watch([view, page], restartChunks)
const shownGroups = computed(() => groups.value.slice(0, chunk.value))
const shownRows = computed(() => pageRows.value.slice(0, chunk.value))

const listTop = ref<HTMLElement>()
watch(page, () => {
  if (listTop.value && listTop.value.getBoundingClientRect().top < 0) {
    listTop.value.scrollIntoView({ block: 'start' })
  }
})

// ------------------------------------------------------------------ details
// The open weapon lives in the URL (?w=Key): links work, and Back closes it.
// Which of its copies is chosen stays on this page.

const route = useRoute()
const router = useRouter()
const selectedKey = computed(() => (typeof route.query.w === 'string' ? route.query.w : null))
const selectedRow = ref<string | null>(null)
/** Every copy of the weapon, whatever the filters. */
const selected = computed(() => {
  const key = selectedKey.value
  if (!key) return null
  return (
    groupWeapons(
      rows.value.filter((r) => r.key === key),
      refine.value,
    )[0] ?? null
  )
})
// ?w= of a weapon the account doesn't own: the dialog opens bare ("Don't have", or a link).
const bare = computed(() =>
  selectedKey.value !== null && selected.value === null && armory.value
    ? bareWeaponGroup(selectedKey.value)
    : null,
)
const ownedKeys = computed(() => [...new Set(rows.value.map((r) => r.key))])
let pushed = false
watch(selectedKey, (key) => {
  if (key === null) {
    pushed = false
    selectedRow.value = null
  }
})

function open(key: string, rowId: string | null = null) {
  selectedRow.value = rowId
  const query = { ...route.query, w: key }
  if (selectedKey.value !== null) {
    void router.replace({ query })
  } else {
    pushed = true
    void router.push({ query })
  }
}

const openRow = (row: WeaponRow) => open(row.key, row.id)

function close() {
  if (pushed) {
    pushed = false
    router.back()
    return
  }
  const query = { ...route.query }
  delete query.w
  void router.replace({ query })
}
</script>

<template>
  <div>
    <PageHeader :title="$t('game.weapons')" />

    <UiError
      v-if="inventory.error.value"
      class="mb-6"
      :error="inventory.error.value"
      :title="$t('characters.detail.loadFailed')"
      @retry="inventory.reload"
    />

    <div
      v-if="!armory && inventory.loading.value"
      aria-busy="true"
      :aria-label="$t('characters.page.loading')"
    >
      <div class="mb-4 grid grid-cols-3 gap-2 sm:gap-3 md:grid-cols-6">
        <UiSkeleton v-for="n in 6" :key="n" class="h-16 sm:h-[4.5rem]" />
      </div>
      <UiSkeleton class="mb-4 h-40 w-full sm:h-36" />
      <div
        class="grid grid-cols-[repeat(auto-fill,minmax(4.25rem,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(4.75rem,1fr))] gap-2"
      >
        <UiSkeleton v-for="n in 24" :key="n" class="aspect-[4/5]" />
      </div>
    </div>

    <template v-else-if="inventory.data.value === null || (armory && armory.total === 0)">
      <UiPanel flush>
        <UiEmpty
          :title="
            inventory.data.value === null
              ? $t('characters.page.noSnapshots')
              : $t('weapons.page.empty')
          "
        >
          <template #icon><Swords aria-hidden="true" /></template>
          <UiButton v-if="!readOnly && !demo" variant="primary" :to="accountLink('account-import')">
            <Upload class="size-4" aria-hidden="true" />
            {{ $t('characters.page.import') }}
          </UiButton>
        </UiEmpty>
      </UiPanel>
      <!-- An account with no weapons yet can still read any weapon's page -->
      <UnownedWeapons
        v-if="armory"
        class="mt-4"
        :owned="ownedKeys"
        :filters="filters"
        @open="open"
      />
    </template>

    <template v-else-if="armory">
      <StatStrip class="mb-4" :items="strip" @toggle="toggleStrip" />

      <WeaponToolbar
        v-model:filters="filters"
        v-model:sort="sort"
        v-model:direction="direction"
        v-model:view="view"
        class="mb-4"
        :type-counts="typeCounts"
        :rarity-counts="rarityCounts"
        :present="presentRarities"
        :refinable-count="armory.refine.size"
        :shown="matchedCopies"
        :total="armory.total"
        :filtered="filtered"
        @clear="clearFilters"
      />

      <UiPanel v-if="matched.length === 0" flush>
        <UiEmpty :title="$t('characters.page.noMatches')">
          <template #icon><SearchX aria-hidden="true" /></template>
          <UiButton @click="clearFilters">{{ $t('characters.toolbar.clear') }}</UiButton>
        </UiEmpty>
      </UiPanel>

      <div v-else ref="listTop" class="scroll-mt-20">
        <WeaponBag
          v-if="view === 'bag'"
          :sections="sections"
          :selected="selected ? selectedRow : null"
          @open="openRow"
        />
        <ul
          v-else-if="view === 'weapon'"
          class="flex flex-col gap-2"
          :aria-label="$t('game.weapons')"
        >
          <li v-for="group in shownGroups" :key="group.key">
            <WeaponGroupRow :group="group" @open="open(group.key, $event)" />
          </li>
        </ul>
        <template v-else>
          <WeaponTable
            v-model:sort="sort"
            v-model:direction="direction"
            :rows="shownRows"
            @open="openRow"
          />
          <UiPager
            v-model="page"
            sticky
            class="mt-4"
            :page-count="pageCount"
            :total="sortedRows.length"
            :page-size="LIST_PAGE"
            :label="$t('weapons.page.pages')"
          />
        </template>
      </div>
      <UnownedWeapons class="mt-4" :owned="ownedKeys" :filters="filters" @open="open" />
    </template>

    <UiModal
      :open="selected !== null || bare !== null"
      :title="(selected ?? bare)?.name ?? ''"
      @close="close"
    >
      <WeaponDetail
        v-if="selected ?? bare"
        :group="(selected ?? bare)!"
        :selected-id="selectedRow"
        :account-id="account.id"
        :bare="selected === null"
        @select="selectedRow = $event"
      />
    </UiModal>
  </div>
</template>
