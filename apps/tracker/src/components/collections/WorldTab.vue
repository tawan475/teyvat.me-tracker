<script setup lang="ts">
import { pageNow, useTravel } from '@/views/account/context'
import { computed, reactive, ref, watch } from 'vue'
import {
  CheckCheck,
  ChevronDown,
  Compass,
  Eye,
  Flame,
  Landmark,
  MapPin,
  ScrollText,
  SearchX,
  Sparkles,
  Swords,
  Timer,
  Users,
} from 'lucide-vue-next'
import { loadFarming } from '@gdt/game-data/farming'
import EntryGrid, { type GridEntry } from './EntryGrid.vue'
import HaveFilter, { type HaveFilterValue } from './HaveFilter.vue'
import NotCaptured from './NotCaptured.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiProgress from '@/components/ui/UiProgress.vue'
import UiSegmented, { type SegmentedOption } from '@/components/ui/UiSegmented.vue'
import UiStat from '@/components/ui/UiStat.vue'
import type { CapturedCollections } from '@/data/collections'
import { idLabel, type CollectionCatalog } from '@/data/collection-names'
import { respawnRows } from '@/data/respawns'
import { useResource } from '@/data/use-resource'
import {
  explorationPercent,
  npcRows,
  tribalRows,
  worldModel,
  type DomainRow,
  type Progress,
} from '@/data/world'
import { localizeFarming } from '@/i18n/localize-farming'
import { formatNumber, formatRelative, formatDateTime } from '@/lib/format'
import { readStorage, writeStorage } from '@/lib/storage'
import { t } from '@/i18n'

/**
 * The World (Capture 1.6.0's `gi_exploration`): each scene's map (Teleport
 * Waypoints, domains, areas revealed), the Statues of The Seven, reputation,
 * offerings and exploration per region. Exploration shows raw points until
 * the game data carries each area's total. Bosses' and elites' respawns
 * (Capture 1.7.0) come from the newest capture's `gi_tasks`. The domain,
 * Trounce Domain and NPC stats open their list in one panel (a view switch
 * in its header), entries had and missing.
 */
const props = defineProps<{ captured: CapturedCollections; catalog: CollectionCatalog }>()

const exploration = computed(() => props.captured.exploration?.value ?? null)
/** Time travel: respawns counted from the capture's time. */
const travel = useTravel()
const farming = useResource(
  () => 0,
  () => loadFarming().catch(() => null),
)
const respawns = computed(() => {
  const value = props.captured.respawns?.value
  if (!value) return []
  const data = farming.data.value
  return respawnRows(value, data ? localizeFarming(data) : null, pageNow(travel.value))
})
const waiting = computed(() => respawns.value.filter((r) => r.next !== null))

const world = computed(() =>
  exploration.value ? worldModel(exploration.value, props.catalog) : null,
)
/** Capture 1.11.0: Trounce Domains cleared once, NPCs met, Natlan's tribal chapters. */
const npcList = computed(() => {
  const met = props.captured.npcsMet?.value
  return met ? npcRows(met, props.catalog) : null
})
const counted = (rows: readonly { have: boolean }[] | null | undefined) =>
  rows ? { have: rows.filter((r) => r.have).length, total: rows.length } : null
const cleared = computed(() => counted(world.value?.cleared))
const npcs = computed(() => counted(npcList.value))
const tribes = computed(() =>
  exploration.value?.tribalChapters
    ? tribalRows(exploration.value.tribalChapters, props.catalog)
    : [],
)

// The lists behind the stats: domains on the map, Trounce Domains cleared. (Teleport
// Waypoints, NPCs met, the statue levels of unreleased regions and the bosses'
// respawns are captured but not shown: the user found them unverifiable.)
type ListView = 'domains' | 'cleared'
const VIEW_KEY = 'collections:world-list'
const FILTER_KEY = 'collections:world-filter'
const storedView = readStorage(VIEW_KEY)
const view = ref<ListView>(storedView === 'cleared' ? 'cleared' : 'domains')
watch(view, (value) => writeStorage(VIEW_KEY, value === 'domains' ? null : value))
const storedFilter = readStorage(FILTER_KEY) as HaveFilterValue | null
const filter = ref<HaveFilterValue>(
  storedFilter === 'missing' || storedFilter === 'have' ? storedFilter : 'all',
)
watch(filter, (value) => writeStorage(FILTER_KEY, value === 'all' ? null : value))

const domainNote = (row: DomainRow) =>
  [row.region, row.kind === 'other' ? '' : t(`collections.world.domainKinds.${row.kind}`)]
    .filter(Boolean)
    .join(' · ')
const lists = computed(() => {
  const toEntry = (row: DomainRow): GridEntry & { have: boolean } => ({
    id: row.id,
    name: row.name,
    note: domainNote(row),
    missing: !row.have,
    have: row.have,
  })
  return [
    {
      view: 'domains' as const,
      label: t('collections.world.domains'),
      icon: Swords,
      entries: world.value?.domains.length ? world.value.domains.map(toEntry) : null,
    },
    {
      view: 'cleared' as const,
      label: t('collections.world.trounce'),
      icon: Swords,
      entries: world.value?.cleared?.map(toEntry) ?? null,
    },
  ].flatMap((list) => (list.entries ? [{ ...list, entries: list.entries }] : []))
})
const current = computed(
  () => lists.value.find((l) => l.view === view.value) ?? lists.value[0] ?? null,
)
const currentHave = computed(() => current.value?.entries.filter((e) => e.have).length ?? 0)
const shown = computed<GridEntry[]>(() =>
  (current.value?.entries ?? []).filter(
    (e) => filter.value === 'all' || e.have === (filter.value === 'have'),
  ),
)
const viewOptions = computed<SegmentedOption<ListView>[]>(() =>
  lists.value.map((l) => ({
    value: l.view,
    label: l.label,
    icon: l.icon,
    count: l.entries.filter((e) => e.have).length,
  })),
)
const listModel = computed({
  get: () => current.value?.view ?? 'domains',
  set: (value: ListView) => (view.value = value),
})
/** A stat opens its list. */
function openList(value: ListView) {
  view.value = value
  open.lists = true
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  document
    .getElementById('world-lists')
    ?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
}
const hasList = (value: ListView) => lists.value.some((l) => l.view === value)
const teyvat = computed(() => world.value?.maps.find((m) => m.name === null) ?? null)
const reputationTotal = computed(() =>
  (world.value?.reputation ?? []).reduce(
    (sum, r) => ({ have: sum.have + Math.min(r.level, r.max), total: sum.total + r.max }),
    { have: 0, total: 0 },
  ),
)

/**
 * Below the stats and the map, panels start folded (the user's call); which
 * are open is remembered per device.
 */
const OPEN_KEY = 'collections:world-open'
// Statues and Reputation share one row and fold together (`statues`).
const PANELS = ['lists', 'statues', 'offerings', 'exploration', 'tribes'] as const
const open = reactive(
  Object.fromEntries(PANELS.map((id) => [id, false])) as Record<(typeof PANELS)[number], boolean>,
)
try {
  for (const id of JSON.parse(readStorage(OPEN_KEY) ?? '[]') as string[]) {
    if ((PANELS as readonly string[]).includes(id)) open[id as (typeof PANELS)[number]] = true
  }
} catch {
  // A bad stored value: everything folded.
}
watch(open, (value) => {
  const ids = PANELS.filter((id) => value[id])
  writeStorage(OPEN_KEY, ids.length ? JSON.stringify(ids) : null)
})

/** Exploration's regions fold one by one (all folded at first), remembered per device. */
const CITIES_KEY = 'collections:world-cities'
const openCities = ref<Set<number>>(new Set())
try {
  openCities.value = new Set(JSON.parse(readStorage(CITIES_KEY) ?? '[]') as number[])
} catch {
  // A bad stored value: all folded.
}
function toggleCity(city: number) {
  const next = new Set(openCities.value)
  if (next.has(city)) next.delete(city)
  else next.add(city)
  openCities.value = next
  writeStorage(CITIES_KEY, next.size ? JSON.stringify([...next]) : null)
}

/** The open list's domains per region, had of total ("Mondstadt 12 / 14"). */
const regionCounts = computed(() => {
  const rows = current.value?.view === 'cleared' ? world.value?.cleared : world.value?.domains
  const byRegion = new Map<string, Progress>()
  for (const row of rows ?? []) {
    const key = row.region || t('collections.world.otherAreas')
    const sum = byRegion.get(key) ?? { have: 0, total: 0 }
    byRegion.set(key, { have: sum.have + (row.have ? 1 : 0), total: sum.total + 1 })
  }
  return [...byRegion].map(([region, p]) => ({ region, ...p }))
})

/** A share with one decimal (floored, so 100% means all of it); null without a total. */
const share = (have: number, total: number): number | null =>
  total > 0 ? Math.floor((have / total) * 1000) / 10 : null
const sumOf = <T,>(rows: readonly T[], f: (row: T) => number) =>
  rows.reduce((sum, row) => sum + f(row), 0)
/** Each panel's figure in its header (the user's call, like the regions'). */
const percents = computed(() => {
  const w = world.value
  const capped = (rows: readonly { level: number; max: number }[]) =>
    share(
      sumOf(rows, (r) => Math.min(r.level, r.max)),
      sumOf(rows, (r) => r.max),
    )
  return {
    map: w
      ? share(
          sumOf(w.maps, (m) => m.domains.have + m.areas.have),
          sumOf(w.maps, (m) => m.domains.total + m.areas.total),
        )
      : null,
    lists: current.value ? share(currentHave.value, current.value.entries.length) : null,
    statues: w ? capped(w.statues) : null,
    reputation: share(reputationTotal.value.have, reputationTotal.value.total),
    offerings: w ? capped(w.offerings.filter((o) => o.max > 0)) : null,
    exploration: w ? explorationPercent(w) : null,
    tribes: share(
      sumOf(tribes.value, (t) => t.finished),
      sumOf(tribes.value, (t) => t.chapters.length),
    ),
  }
})

/** A region's average exploration of the areas with a known total; null without any. */
function cityAverage(areas: readonly { percent: number | null }[]): number | null {
  const known = areas.flatMap((a) => (a.percent === null ? [] : [a.percent]))
  if (!known.length) return null
  return Math.floor((known.reduce((sum, p) => sum + p, 0) / known.length) * 10) / 10
}

const sceneName = (name: string | null) => name ?? t('collections.world.teyvat')
const offeringName = (id: number, name: string) =>
  name || t('collections.world.offering', { n: id })
const fraction = (p: Progress) => `${formatNumber(p.have)} / ${formatNumber(p.total)}`
const MAP_PARTS = [
  { key: 'domains', icon: Swords, label: 'collections.world.domains' },
  { key: 'areas', icon: Eye, label: 'collections.world.areas' },
] as const
</script>

<template>
  <NotCaptured v-if="!exploration || !world" :title="$t('collections.tabs.world')" />
  <div v-else class="flex flex-col gap-4">
    <ul
      class="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4"
      :aria-label="$t('collections.summary')"
    >
      <li v-for="part in MAP_PARTS" :key="part.key" class="flex min-w-0">
        <UiStat
          :label="$t(part.label)"
          :hint="$t('collections.world.inTeyvat', { what: $t(part.label) })"
          :button="part.key === 'domains' && hasList('domains')"
          @click="part.key === 'domains' && hasList('domains') && openList('domains')"
        >
          <template #icon
            ><component :is="part.icon" class="size-3.5" aria-hidden="true"
          /></template>
          <template #value>
            <span class="tabular truncate font-mono text-lg font-medium sm:text-xl">
              {{ formatNumber(teyvat?.[part.key].have ?? 0)
              }}<span class="text-sm text-text-muted">
                / {{ formatNumber(teyvat?.[part.key].total ?? 0) }}</span
              >
            </span>
          </template>
          <UiProgress
            class="mt-1"
            :value="teyvat?.[part.key].have ?? 0"
            :max="teyvat?.[part.key].total ?? 0"
            :label="$t(part.label)"
          />
        </UiStat>
      </li>
      <li v-if="cleared" class="flex min-w-0">
        <UiStat
          :label="$t('collections.world.trounce')"
          :hint="$t('collections.world.trounceHint')"
          button
          @click="openList('cleared')"
        >
          <template #icon><Swords class="size-3.5" aria-hidden="true" /></template>
          <template #value>
            <span class="tabular truncate font-mono text-lg font-medium sm:text-xl">
              {{ formatNumber(cleared.have)
              }}<span class="text-sm text-text-muted"> / {{ formatNumber(cleared.total) }}</span>
            </span>
          </template>
          <UiProgress
            class="mt-1"
            :value="cleared.have"
            :max="cleared.total"
            :label="$t('collections.world.trounce')"
          />
        </UiStat>
      </li>
      <li class="flex min-w-0">
        <UiStat :label="$t('collections.world.reputation')">
          <template #icon><ScrollText class="size-3.5" aria-hidden="true" /></template>
          <template #value>
            <span class="tabular truncate font-mono text-lg font-medium sm:text-xl">
              {{ formatNumber(reputationTotal.have)
              }}<span class="text-sm text-text-muted">
                / {{ formatNumber(reputationTotal.total) }}</span
              >
            </span>
          </template>
          <UiProgress
            class="mt-1"
            :value="reputationTotal.have"
            :max="reputationTotal.total"
            :label="$t('collections.world.reputation')"
          />
        </UiStat>
      </li>
    </ul>

    <UiPanel v-if="world.maps.length" :title="$t('collections.world.map')" flush>
      <template #actions>
        <span
          v-if="percents.map !== null"
          class="tabular font-mono text-sm"
          :class="percents.map >= 100 ? 'text-success-text' : 'text-accent-text'"
          >{{ percents.map }}%</span
        >
      </template>
      <ul class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))] gap-3 p-3 sm:p-5">
        <li
          v-for="map in world.maps"
          :key="map.scene"
          class="flex min-w-0 flex-col gap-2.5 rounded-xl border border-border-default bg-surface-sunken p-3"
        >
          <div class="flex min-w-0 items-center gap-2">
            <Compass class="size-4 shrink-0 text-accent-text" aria-hidden="true" />
            <h3 class="min-w-0 truncate font-semibold" :title="sceneName(map.name)">
              {{ sceneName(map.name) }}
            </h3>
          </div>
          <dl class="flex flex-col gap-2">
            <template v-for="part in MAP_PARTS" :key="part.key">
              <div v-if="map[part.key].total > 0" class="flex flex-col gap-1">
                <div class="flex items-baseline justify-between gap-2 text-sm">
                  <dt class="flex min-w-0 items-center gap-1.5 text-text-secondary">
                    <component :is="part.icon" class="size-3.5 shrink-0" aria-hidden="true" />
                    <span class="truncate">{{ $t(part.label) }}</span>
                  </dt>
                  <dd class="tabular shrink-0 font-mono">{{ fraction(map[part.key]) }}</dd>
                </div>
                <UiProgress
                  :value="map[part.key].have"
                  :max="map[part.key].total"
                  :label="`${sceneName(map.name)} · ${$t(part.label)}`"
                />
              </div>
            </template>
          </dl>
        </li>
      </ul>
    </UiPanel>

    <UiPanel
      v-if="current"
      id="world-lists"
      v-model:open="open.lists"
      class="scroll-mt-20"
      :title="current.label"
      collapsible
      flush
    >
      <template #actions>
        <span
          v-if="percents.lists !== null"
          class="tabular font-mono text-sm"
          :class="percents.lists >= 100 ? 'text-success-text' : 'text-accent-text'"
          >{{ percents.lists }}%</span
        >
      </template>
      <template #header>
        <div
          class="scroll-hide scroll-fade-x -mx-5 flex max-w-full overflow-x-auto px-5 sm:mx-0 sm:px-0"
        >
          <UiSegmented
            v-model="listModel"
            :options="viewOptions"
            :label="$t('collections.world.lists')"
          />
        </div>
      </template>
      <div class="flex flex-col gap-3 p-3 sm:p-5">
        <ul v-if="regionCounts.length > 1" class="flex flex-wrap gap-1.5">
          <li
            v-for="r in regionCounts"
            :key="r.region"
            class="tabular rounded-md border border-border-default bg-surface-sunken px-2 py-1 text-xs"
            :class="r.have >= r.total ? 'text-success-text' : 'text-text-secondary'"
          >
            {{ r.region }} <span class="font-mono">{{ r.have }}/{{ r.total }}</span>
          </li>
        </ul>
        <HaveFilter
          v-model="filter"
          :have="currentHave"
          :total="current.entries.length"
          :label="$t('collections.archive.show')"
        />
        <EntryGrid v-if="shown.length > 0" :entries="shown" :label="current.label" />
        <UiEmpty
          v-else-if="filter === 'missing'"
          :title="$t('collections.spincrystals.allCollected')"
        >
          <template #icon><CheckCheck class="text-success-text" aria-hidden="true" /></template>
        </UiEmpty>
        <UiEmpty v-else :title="$t('collections.archive.none')">
          <template #icon><SearchX aria-hidden="true" /></template>
        </UiEmpty>
      </div>
    </UiPanel>

    <div class="flex flex-wrap gap-4">
      <UiPanel
        v-if="world.statues.length"
        v-model:open="open.statues"
        class="min-w-0 flex-[999_1_28rem]"
        :title="$t('collections.world.statues')"
        collapsible
        flush
      >
        <template #actions>
          <span
            v-if="percents.statues !== null"
            class="tabular font-mono text-sm"
            :class="percents.statues >= 100 ? 'text-success-text' : 'text-accent-text'"
            >{{ percents.statues }}%</span
          >
        </template>
        <ul class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,12rem),1fr))] gap-2 p-3 sm:p-5">
          <li
            v-for="statue in world.statues"
            :key="statue.city"
            class="flex min-w-0 items-center gap-3 rounded-xl border border-border-default bg-surface-sunken p-2.5"
            :title="statue.statue"
          >
            <span
              class="tabular grid size-10 shrink-0 place-items-center rounded-full font-mono font-semibold"
              :class="
                statue.level >= statue.max
                  ? 'bg-success-text/15 text-success-text'
                  : 'bg-accent/15 text-accent-text'
              "
              >{{ statue.level }}</span
            >
            <span class="flex min-w-0 flex-col">
              <span class="truncate text-sm font-medium">{{ statue.name }}</span>
              <span class="truncate text-xs text-text-secondary">
                {{ $t('collections.world.level', { n: statue.level }) }} / {{ statue.max }}
                <template v-if="statue.oculi">
                  · {{ $t('collections.world.oculi', { n: formatNumber(statue.oculi) }) }}</template
                >
              </span>
            </span>
          </li>
        </ul>
      </UiPanel>

      <UiPanel
        v-if="world.reputation.length"
        v-model:open="open.statues"
        class="min-w-0 flex-[999_1_20rem]"
        :title="$t('collections.world.reputation')"
        collapsible
        flush
      >
        <template #actions>
          <span
            v-if="percents.reputation !== null"
            class="tabular font-mono text-sm"
            :class="percents.reputation >= 100 ? 'text-success-text' : 'text-accent-text'"
            >{{ percents.reputation }}%</span
          >
        </template>
        <ul class="flex flex-col gap-3 p-3 sm:p-5">
          <li v-for="rep in world.reputation" :key="rep.city" class="flex flex-col gap-1">
            <div class="flex items-baseline justify-between gap-2 text-sm">
              <span class="min-w-0 truncate font-medium">{{ rep.name }}</span>
              <span class="tabular shrink-0 font-mono"
                >{{ rep.level }}<span class="text-text-muted"> / {{ rep.max }}</span></span
              >
            </div>
            <UiProgress :value="rep.level" :max="rep.max" :label="rep.name" />
          </li>
        </ul>
      </UiPanel>
    </div>

    <UiPanel
      v-if="world.offerings.length"
      v-model:open="open.offerings"
      :title="$t('collections.world.offerings')"
      collapsible
      flush
    >
      <template #actions>
        <span
          v-if="percents.offerings !== null"
          class="tabular font-mono text-sm"
          :class="percents.offerings >= 100 ? 'text-success-text' : 'text-accent-text'"
          >{{ percents.offerings }}%</span
        >
      </template>
      <ul class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-2 p-3 sm:p-5">
        <li
          v-for="offering in world.offerings"
          :key="offering.id"
          class="flex min-w-0 flex-col gap-1.5 rounded-xl border p-2.5"
          :class="
            offering.max > 0 && offering.level >= offering.max
              ? 'border-success-text/40 bg-success-text/10'
              : 'border-border-default bg-surface-sunken'
          "
        >
          <div class="flex min-w-0 items-center gap-2">
            <Flame class="size-3.5 shrink-0 text-text-muted" aria-hidden="true" />
            <span
              class="min-w-0 flex-1 truncate text-sm font-medium"
              :title="offeringName(offering.id, offering.name)"
              >{{ offeringName(offering.id, offering.name) }}</span
            >
            <span class="tabular shrink-0 font-mono text-sm"
              >{{ offering.level
              }}<span v-if="offering.max" class="text-text-muted"> / {{ offering.max }}</span></span
            >
          </div>
          <UiProgress
            v-if="offering.max"
            :value="offering.level"
            :max="offering.max"
            :label="offeringName(offering.id, offering.name)"
          />
        </li>
      </ul>
    </UiPanel>

    <UiPanel
      v-if="world.exploration.length"
      v-model:open="open.exploration"
      :title="$t('collections.world.exploration')"
      collapsible
      flush
    >
      <template #actions>
        <span
          v-if="percents.exploration !== null"
          class="tabular font-mono text-sm"
          :class="percents.exploration >= 100 ? 'text-success-text' : 'text-accent-text'"
          >{{ percents.exploration }}%</span
        >
        <span
          v-if="world.exploration.some((c) => c.areas.some((a) => a.percent === null))"
          class="flex items-center gap-1 text-xs text-text-muted"
          :title="$t('collections.world.pointsHint')"
        >
          <Sparkles class="size-3.5" aria-hidden="true" />{{ $t('collections.world.pointsOnly') }}
        </span>
      </template>
      <div
        class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] items-start gap-x-4 gap-y-2 p-3 sm:p-5"
      >
        <section v-for="city in world.exploration" :key="city.city" class="min-w-0">
          <h3 class="min-w-0 text-sm font-semibold">
            <button
              type="button"
              class="flex w-full min-w-0 items-center gap-1.5 rounded-md py-1 text-left hover:bg-surface-overlay/50"
              :aria-expanded="openCities.has(city.city)"
              @click="toggleCity(city.city)"
            >
              <ChevronDown
                class="size-3.5 shrink-0 text-text-muted transition-transform"
                :class="openCities.has(city.city) ? '' : '-rotate-90'"
                aria-hidden="true"
              />
              <Landmark class="size-3.5 shrink-0 text-text-muted" aria-hidden="true" />
              <span class="min-w-0 flex-1 truncate">{{
                city.name || $t('collections.world.otherAreas')
              }}</span>
              <span
                v-if="cityAverage(city.areas) !== null"
                class="tabular shrink-0 font-mono"
                :class="cityAverage(city.areas)! >= 100 ? 'text-success-text' : 'text-accent-text'"
                :title="$t('collections.world.regionAverage')"
                >{{ cityAverage(city.areas) }}%</span
              >
            </button>
          </h3>
          <ul
            v-show="openCities.has(city.city)"
            class="mt-1 flex flex-col divide-y divide-border-default"
          >
            <li
              v-for="area in city.areas"
              :key="area.area"
              class="flex min-w-0 items-center gap-2 py-1.5 text-sm"
            >
              <span class="min-w-0 flex-1 truncate" :title="area.name">{{
                area.name || idLabel(area.area)
              }}</span>
              <span
                v-if="area.percent !== null"
                class="tabular shrink-0 font-mono"
                :class="area.percent >= 100 ? 'text-success-text' : ''"
                >{{ area.percent }}%</span
              >
              <span
                v-else
                class="tabular shrink-0 font-mono text-text-secondary"
                :title="$t('collections.world.pointsHint')"
                >{{ $t('collections.world.points', { n: formatNumber(area.points) }) }}</span
              >
            </li>
          </ul>
        </section>
      </div>
    </UiPanel>

    <UiPanel
      v-if="tribes.length"
      v-model:open="open.tribes"
      :title="$t('collections.world.tribes')"
      collapsible
      flush
    >
      <template #actions>
        <span
          v-if="percents.tribes !== null"
          class="tabular font-mono text-sm"
          :class="percents.tribes >= 100 ? 'text-success-text' : 'text-accent-text'"
          >{{ percents.tribes }}%</span
        >
      </template>
      <div class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-3 p-3 sm:p-5">
        <section
          v-for="tribe in tribes"
          :key="tribe.tribe"
          class="min-w-0 rounded-xl border border-border-default bg-surface-sunken p-3"
        >
          <h3 class="mb-2 flex items-center justify-between gap-2 text-sm font-semibold">
            <span class="truncate">{{ tribe.name }}</span>
            <span class="tabular shrink-0 font-mono font-normal text-text-secondary"
              >{{ tribe.finished }}/{{ tribe.chapters.length }}</span
            >
          </h3>
          <ul class="flex flex-col gap-1.5">
            <li
              v-for="chapter in tribe.chapters"
              :key="chapter.id"
              class="flex min-w-0 items-start gap-2 text-sm"
              :title="`${chapter.number} · ${$t(`collections.world.tribalStates.${chapter.state}`)}`"
            >
              <span
                class="mt-1.5 size-2 shrink-0 rounded-full"
                :class="
                  chapter.state === 'finished'
                    ? 'bg-success-text'
                    : chapter.state === 'open'
                      ? 'bg-accent'
                      : 'ring-1 ring-border-strong ring-inset'
                "
              />
              <span class="flex min-w-0 flex-col">
                <span
                  class="truncate"
                  :class="chapter.state === 'finished' ? '' : 'text-text-secondary'"
                  >{{ chapter.name }}</span
                >
                <span class="truncate text-xs text-text-muted">{{ chapter.number }}</span>
              </span>
            </li>
          </ul>
        </section>
      </div>
    </UiPanel>
  </div>
</template>
