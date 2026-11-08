<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, CheckCheck, Gift, SearchX, UserCheck, Users } from 'lucide-vue-next'
import { characterInfo } from '@gdt/game-data/catalog'
import EntryGrid, { type GridEntry } from './EntryGrid.vue'
import HaveFilter, { type HaveFilterValue } from './HaveFilter.vue'
import NotCaptured from './NotCaptured.vue'
import FilterChip from '@/components/ui/FilterChip.vue'
import GameIcon from '@/components/ui/GameIcon.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiProgress from '@/components/ui/UiProgress.vue'
import UiSegmented, { type SegmentedOption } from '@/components/ui/UiSegmented.vue'
import UiStat from '@/components/ui/UiStat.vue'
import type { CapturedCollections } from '@/data/collections'
import { idLabel, nameOf, wikiGuide, type CollectionCatalog } from '@/data/collection-names'
import {
  companionCards,
  furnishingSetCards,
  ownedCompanions,
  setsWithOwnedCompanions,
} from '@/data/teapot'
import { loadLatestInventory } from '@/data/account-data'
import { useResource } from '@/data/use-resource'
import { useAccount } from '@/views/account/context'
import { t } from '@/i18n'
import { characterIcon, gameIcon } from '@/lib/assets'
import { formatNumber } from '@/lib/format'
import { readStorage, writeStorage } from '@/lib/storage'

/**
 * The Serenitea Pot: comfort per realm (Capture 1.8.0's gi_teapot),
 * furnishing blueprints (1.7.0), furnishing sets and the companions'
 * gift-set rewards (1.11.0). One panel, its view picked in the header;
 * each gift set card shows its companions, claimed or still waiting.
 */
const props = defineProps<{ captured: CapturedCollections; catalog: CollectionCatalog }>()

const learned = computed(() => props.captured.blueprints?.value ?? null)
const learnedSets = computed(() => props.captured.furnishingSets?.value ?? null)
const claimed = computed(() => props.captured.companionRewards?.value ?? null)

// ------------------------------------------------------------------ blueprints

const KEY = 'collections:blueprints-filter'
const stored = readStorage(KEY) as HaveFilterValue | null
const filter = ref<HaveFilterValue>(stored === 'missing' || stored === 'have' ? stored : 'all')
watch(filter, (value) => writeStorage(KEY, value === 'all' ? null : value))

const entries = computed(() => {
  const owned = new Set(learned.value ?? [])
  const icons = new Map(props.catalog.data.furnishings.map((f) => [f.id, f.icon]))
  const known = props.catalog.data.blueprints.map((b) => ({
    id: b.id,
    name: nameOf(props.catalog, 'blueprints', b.id),
    icon: String(icons.get(b.id) ?? ''),
    have: owned.has(b.id),
  }))
  const knownIds = new Set(known.map((b) => b.id))
  return [
    ...known,
    ...[...owned]
      .filter((id) => !knownIds.has(id))
      .map((id) => ({ id, name: idLabel(id), icon: '', have: true })),
  ]
})
const have = computed(() => entries.value.filter((e) => e.have).length)
const total = computed(() => props.catalog.data.blueprints.length)
const shown = computed<GridEntry[]>(() =>
  entries.value
    .filter((e) => filter.value === 'all' || e.have === (filter.value === 'have'))
    .map((e) => {
      // The furnishing's page ("Glug in One Go"); a blueprint shares its id.
      const href =
        wikiGuide(props.catalog, 'furnishings', e.id) ??
        wikiGuide(props.catalog, 'blueprints', e.id)
      return {
        id: e.id,
        name: e.name,
        icon: e.icon,
        missing: !e.have,
        title: href ? `${e.name} · ${t('collections.guide')}` : e.name,
        href,
      }
    }),
)

// ------------------------------------------------------------------ sets and companions

// "Owned only" (a Discord user's ask, 2026-11-09): companions the account
// doesn't have are left off the companion list and the set cards, and the
// counts follow, so the bar can reach the end. Off by default, per device.
const account = useAccount()
const inventory = useResource(
  () => (claimed.value && account.value.latest ? account.value : null),
  (a) => (a ? loadLatestInventory(a) : Promise.resolve(null)),
)
/** GOOD keys of the account's characters (newest capture + live sync); null until known. */
const ownedKeys = computed(() => {
  const characters = inventory.data.value?.good.characters
  return characters ? new Set(characters.map((c) => c.key)) : null
})
const OWNED_KEY = 'collections:teapot-owned'
const ownedOnly = ref(readStorage(OWNED_KEY) === '1')
watch(ownedOnly, (value) => writeStorage(OWNED_KEY, value ? '1' : null))
const owned = computed(() => (ownedOnly.value ? ownedKeys.value : null))

const allSetCards = computed(() =>
  furnishingSetCards(props.catalog, learnedSets.value, claimed.value),
)
const setCards = computed(() =>
  owned.value ? setsWithOwnedCompanions(allSetCards.value, owned.value) : allSetCards.value,
)
const allCompanions = computed(() => companionCards(props.catalog, claimed.value))
const companions = computed(() =>
  owned.value ? ownedCompanions(allCompanions.value, owned.value) : allCompanions.value,
)
// A gift set stays one when none of its companions is owned.
const giftIds = computed(
  () => new Set(allSetCards.value.filter((s) => s.companions.length > 0).map((s) => s.id)),
)
const giftSets = computed(() => setCards.value.filter((s) => giftIds.value.has(s.id)))
const rewardLeft = computed(() =>
  giftSets.value.filter((s) => s.learned && s.claimed < s.companions.length),
)
const setsHave = computed(() => setCards.value.filter((s) => s.learned).length)
const rewardsHave = computed(() => companions.value.reduce((sum, c) => sum + c.claimed, 0))
const rewardsTotal = computed(() => companions.value.reduce((sum, c) => sum + c.total, 0))

type SetFilter = 'gift' | 'all' | 'left'
const SET_KEY = 'collections:teapot-sets'
const storedSets = readStorage(SET_KEY) as SetFilter | null
const setFilter = ref<SetFilter>(
  storedSets === 'all' || storedSets === 'left' ? storedSets : 'gift',
)
watch(setFilter, (value) => writeStorage(SET_KEY, value === 'gift' ? null : value))
const setChips = computed(() => [
  {
    value: 'gift' as const,
    label: t('collections.blueprints.giftSets'),
    count: giftSets.value.length,
  },
  {
    value: 'all' as const,
    label: t('collections.blueprints.allSets'),
    count: setCards.value.length,
  },
  {
    value: 'left' as const,
    label: t('collections.blueprints.rewardLeft'),
    count: rewardLeft.value.length,
  },
])
const shownSets = computed(() =>
  setFilter.value === 'all'
    ? setCards.value
    : setFilter.value === 'left'
      ? rewardLeft.value
      : giftSets.value,
)
const portrait = (key: string) => (key ? characterIcon(key) : '')
const rarityOf = (key: string) => (key ? (characterInfo(key)?.rarity ?? undefined) : undefined)

// ------------------------------------------------------------------ realms

/** Comfort per realm (Capture 1.8.0's gi_teapot): the mansion's and the outdoor blocks'. */
const realms = computed(() =>
  Object.entries(props.captured.teapot?.value.comfort ?? {})
    .map(([id, r]) => ({
      id: Number(id),
      name: nameOf(props.catalog, 'realms', Number(id)),
      mansion: r.mansion,
      outdoor: r.blocks.reduce((sum, b) => sum + b, 0),
    }))
    .sort((a, b) => b.mansion + b.outdoor - (a.mansion + a.outdoor)),
)
const bestComfort = computed(() =>
  realms.value.length ? Math.max(...realms.value.map((r) => r.mansion + r.outdoor)) : null,
)

// ------------------------------------------------------------------ view

type View = 'realms' | 'blueprints' | 'sets' | 'companions'
const VIEW_KEY = 'collections:teapot-view'
const views = computed<SegmentedOption<View>[]>(() =>
  [
    realms.value.length
      ? { value: 'realms' as const, label: t('collections.blueprints.realms') }
      : null,
    { value: 'blueprints' as const, label: t('collections.blueprints.title'), count: have.value },
    learnedSets.value
      ? { value: 'sets' as const, label: t('collections.blueprints.sets'), count: setsHave.value }
      : null,
    claimed.value
      ? {
          value: 'companions' as const,
          label: t('collections.blueprints.companions'),
          count: rewardsHave.value,
        }
      : null,
  ].filter((v) => v !== null),
)
const storedView = readStorage(VIEW_KEY) as View | null
const chosen = ref<View>(storedView ?? 'blueprints')
const view = computed<View>({
  get: () => (views.value.some((v) => v.value === chosen.value) ? chosen.value : 'blueprints'),
  set: (value) => {
    chosen.value = value
    writeStorage(VIEW_KEY, value === 'blueprints' ? null : value)
  },
})
</script>

<template>
  <NotCaptured v-if="!learned" :title="$t('collections.tabs.blueprints')" />
  <div v-else class="flex flex-col gap-4">
    <ul
      class="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4"
      :aria-label="$t('collections.summary')"
    >
      <li v-if="bestComfort !== null" class="flex min-w-0">
        <UiStat
          :label="$t('collections.blueprints.comfort')"
          :value="bestComfort"
          exact
          :hint="$t('collections.blueprints.comfortHint')"
        />
      </li>
      <li
        v-for="part in [
          { key: 'learned', have: have, total: total, on: true },
          { key: 'sets', have: setsHave, total: setCards.length, on: !!learnedSets },
          { key: 'companions', have: rewardsHave, total: rewardsTotal, on: !!claimed },
        ]"
        v-show="part.on"
        :key="part.key"
        class="flex min-w-0"
      >
        <UiStat :label="$t(`collections.blueprints.${part.key}`)">
          <template #value>
            <span class="tabular truncate font-mono text-lg font-medium sm:text-xl">
              {{ formatNumber(part.have)
              }}<span class="text-sm text-text-muted"> / {{ formatNumber(part.total) }}</span>
            </span>
          </template>
          <UiProgress
            class="mt-1"
            :value="part.have"
            :max="part.total"
            :label="$t(`collections.blueprints.${part.key}`)"
          />
        </UiStat>
      </li>
    </ul>

    <UiPanel flush sticky>
      <template #header>
        <div
          class="scroll-hide scroll-fade-x -mx-3 flex max-w-full overflow-x-auto px-3 sm:mx-0 sm:px-0"
        >
          <UiSegmented v-model="view" :options="views" :label="$t('collections.blueprints.view')" />
        </div>
      </template>
      <template v-if="view === 'sets' || (view === 'companions' && ownedKeys)" #actions>
        <div class="scroll-hide scroll-fade-x flex max-w-full gap-2 overflow-x-auto">
          <div
            v-if="view === 'sets'"
            class="flex gap-2"
            role="radiogroup"
            :aria-label="$t('collections.archive.show')"
          >
            <FilterChip
              v-for="chip in setChips"
              :key="chip.value"
              radio
              :pressed="setFilter === chip.value"
              :count="chip.count"
              @toggle="setFilter = chip.value"
            >
              <Gift v-if="chip.value !== 'all'" class="size-4" aria-hidden="true" />
              {{ chip.label }}
            </FilterChip>
          </div>
          <FilterChip
            v-if="ownedKeys"
            :pressed="ownedOnly"
            :title="$t('collections.blueprints.ownedOnlyHint')"
            @toggle="ownedOnly = !ownedOnly"
          >
            <UserCheck class="size-4" aria-hidden="true" />
            {{ $t('collections.blueprints.ownedOnly') }}
          </FilterChip>
        </div>
      </template>

      <template v-if="view === 'blueprints'" #toolbar>
        <HaveFilter
          v-model="filter"
          :have="have"
          :total="total"
          :label="$t('collections.archive.show')"
        />
      </template>

      <!-- Realms: comfort of the mansion and the outdoor blocks -->
      <ul
        v-if="view === 'realms'"
        class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-2 p-3 sm:p-5"
      >
        <li
          v-for="realm in realms"
          :key="realm.id"
          class="flex min-w-0 flex-col gap-1 rounded-xl border border-border-default bg-surface-sunken p-3 text-sm"
        >
          <span class="truncate font-semibold" :title="realm.name">{{ realm.name }}</span>
          <span class="flex justify-between gap-2 text-text-secondary">
            {{ $t('collections.blueprints.mansion') }}
            <span class="tabular font-mono text-text-primary">{{
              formatNumber(realm.mansion)
            }}</span>
          </span>
          <span class="flex justify-between gap-2 text-text-secondary">
            {{ $t('collections.blueprints.outdoor') }}
            <span class="tabular font-mono text-text-primary">{{
              formatNumber(realm.outdoor)
            }}</span>
          </span>
        </li>
      </ul>

      <!-- Furnishing sets: each gift set with its companions, claimed or waiting -->
      <div v-else-if="view === 'sets'" class="p-3 sm:p-5">
        <ul
          v-if="shownSets.length"
          class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] items-start gap-3"
          :aria-label="$t('collections.blueprints.sets')"
        >
          <li
            v-for="set in shownSets"
            :key="set.id"
            class="flex min-w-0 flex-col overflow-hidden rounded-lg border [content-visibility:auto] [contain-intrinsic-size:auto_14rem]"
            :class="
              set.learned
                ? 'border-border-default bg-surface-sunken'
                : 'border-dashed border-border-strong text-text-muted'
            "
            :title="
              set.learned ? set.name : $t('collections.blueprints.setMissing', { name: set.name })
            "
          >
            <img
              v-if="set.icon"
              :src="gameIcon(set.icon)"
              alt=""
              loading="lazy"
              class="aspect-[2/1] w-full object-cover"
              :class="set.learned ? '' : 'opacity-45 grayscale'"
            />
            <span class="flex min-w-0 items-center gap-2 px-3 pt-2 text-sm">
              <span
                class="min-w-0 flex-1 truncate font-medium"
                :class="set.learned ? '' : 'text-text-muted'"
                >{{ set.name }}</span
              >
              <span
                v-if="set.companions.length"
                class="tabular flex flex-none items-center gap-1 font-mono text-xs"
                :class="
                  set.claimed === set.companions.length
                    ? 'text-success-text'
                    : 'text-text-secondary'
                "
                :title="
                  $t('collections.blueprints.setClaimed', {
                    n: set.claimed,
                    total: set.companions.length,
                  })
                "
              >
                <Users class="size-3.5" aria-hidden="true" />
                {{ set.claimed }}/{{ set.companions.length }}
              </span>
            </span>
            <ul v-if="set.companions.length" class="flex flex-wrap gap-2 px-3 pt-2 pb-3">
              <li
                v-for="c in set.companions"
                :key="c.event"
                class="relative"
                :title="
                  c.claimed
                    ? $t('collections.blueprints.rewardClaimed', { name: c.name })
                    : $t('collections.blueprints.rewardWaiting', { name: c.name })
                "
              >
                <GameIcon
                  :src="portrait(c.key)"
                  :name="c.name"
                  :rarity="rarityOf(c.key)"
                  size="sm"
                  :class="c.claimed || !set.learned ? '' : 'opacity-55 grayscale-[.6]'"
                />
                <span
                  v-if="set.learned"
                  class="absolute -right-1 -bottom-1 flex size-[1.125rem] items-center justify-center rounded-full border"
                  :class="
                    c.claimed
                      ? 'border-transparent bg-success-text text-surface-base'
                      : 'border-warning-text bg-surface-raised text-warning-text'
                  "
                  aria-hidden="true"
                >
                  <Check v-if="c.claimed" class="size-3" stroke-width="3" />
                  <Gift v-else class="size-2.5" />
                </span>
                <span class="sr-only">{{
                  c.claimed
                    ? $t('collections.blueprints.rewardClaimed', { name: c.name })
                    : $t('collections.blueprints.rewardWaiting', { name: c.name })
                }}</span>
              </li>
            </ul>
            <span v-else class="pb-2" />
          </li>
        </ul>
        <UiEmpty
          v-else-if="setFilter === 'left'"
          :title="$t('collections.blueprints.noRewardLeft')"
        >
          <template #icon><CheckCheck class="text-success-text" aria-hidden="true" /></template>
        </UiEmpty>
        <UiEmpty v-else :title="$t('collections.archive.none')">
          <template #icon><SearchX aria-hidden="true" /></template>
        </UiEmpty>
      </div>

      <!-- Companions: their gift-set rewards claimed -->
      <ul
        v-else-if="view === 'companions'"
        class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,14rem),1fr))] gap-2 p-3 sm:p-5"
        :aria-label="$t('collections.blueprints.companions')"
      >
        <li
          v-for="c in companions"
          :key="c.character"
          class="flex min-w-0 items-center gap-2 rounded-md border border-border-default bg-surface-sunken px-2 py-1.5 text-sm"
          :title="$t('collections.blueprints.setClaimed', { n: c.claimed, total: c.total })"
        >
          <GameIcon :src="portrait(c.key)" :name="c.name" :rarity="rarityOf(c.key)" size="xs" />
          <span class="flex min-w-0 flex-1 flex-col gap-1">
            <span class="flex items-center justify-between gap-2">
              <span class="truncate text-text-primary">{{ c.name }}</span>
              <span
                class="tabular flex-none font-mono"
                :class="c.claimed === c.total ? 'text-success-text' : 'text-text-secondary'"
                >{{ c.claimed }}<span class="text-text-muted">/{{ c.total }}</span></span
              >
            </span>
            <UiProgress :value="c.claimed" :max="c.total" :label="c.name" />
          </span>
        </li>
      </ul>

      <!-- Blueprints -->
      <div v-else class="flex flex-col gap-3 p-3 sm:p-5">
        <EntryGrid
          v-if="shown.length > 0"
          :entries="shown"
          :label="$t('collections.blueprints.title')"
        />
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
  </div>
</template>
