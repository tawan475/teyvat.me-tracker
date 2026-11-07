<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { ChevronDown, Search, SearchX, Share2 } from 'lucide-vue-next'
import { characterInfo, weaponInfo } from '@gdt/game-data/catalog'
import type { AccountResponse, UigfGachaType } from '@gdt/shared'
import FilterChip from '@/components/ui/FilterChip.vue'
import GameIcon from '@/components/ui/GameIcon.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import UiSwitch from '@/components/ui/UiSwitch.vue'
import { useResource } from '@/data/use-resource'
import { bannerTitle } from '@/data/wish-banner-names'
import { parseRunKey, runRowKey } from '@/data/wish-run-key'
import {
  bannerHistory,
  featuring,
  pulledOnly,
  type BannerHistoryRow,
} from '@/data/wish-banner-history'
import {
  eventBanners,
  runPullNumbers,
  type BannerStats,
  type EventBanner,
  type EventKind,
  type PullRow,
  type WishHistory,
} from '@/data/wish-history'
import { itemName } from '@/data/weapons'
import { characterName } from '@/i18n/game-names'
import { characterIcon, weaponIcon } from '@/lib/assets'
import { formatNumber } from '@/lib/format'
import { normalizeSearch } from '@/lib/search'
import { readStorage, writeStorage } from '@/lib/storage'
import BannerRunStats from './BannerRunStats.vue'
import BannerShareModal from './BannerShareModal.vue'
import { loadBannerFile } from './use-wish-stats'
import { OUTCOME_STYLE, outcomeLabel, runDates } from './wish-labels'
import WishTable from './WishTable.vue'

/**
 * Banner history: every event banner that has opened, by version, newest
 * first — its featured 5★ and 4★, and the account's own run on it as a
 * summary (wishes, 5★ and 4★ counts, 50/50s won and lost) that opens into
 * the run's numbers (BannerRunStats: its art, wishes, the rarity table) over
 * every pull of that run (the banner page's table, 5★/4★/3★ chips), or
 * that it was skipped; a run's row has a Share button for its card
 * (BannerShareModal; the user's placement, 2026-11-05: on the row, not in
 * the opened run).
 * Character, Weapon and Chronicled; a name search and "only banners I
 * wished on".
 */
const props = defineProps<{
  history: WishHistory
  stats: ReadonlyMap<UigfGachaType, BannerStats>
  /** For the share card's owner (none: no sharing). */
  account?: AccountResponse
  playerUid?: number | null
  ar?: number | null
  /** A run to open (data/wish-run-key.ts; the banner page's links): its kind, expanded and scrolled to. */
  openRun?: string | null
}>()

const file = useResource(() => 0, loadBannerFile)

const KINDS: readonly { kind: EventKind; banner: UigfGachaType; slug: string }[] = [
  { kind: 'character', banner: 301, slug: 'character' },
  { kind: 'weapon', banner: 302, slug: 'weapon' },
  { kind: 'chronicled', banner: 500, slug: 'chronicled' },
]
const KIND_KEY = 'wishes:history-kind'
const MINE_KEY = 'wishes:history-mine'
const stored = readStorage(KIND_KEY)
const kind = ref<EventKind>(KINDS.find((k) => k.kind === stored)?.kind ?? 'character')
watch(kind, (value) => writeStorage(KIND_KEY, value === 'character' ? null : value))
const mine = ref(readStorage(MINE_KEY) === '1')
watch(mine, (value) => writeStorage(MINE_KEY, value ? '1' : null))
const search = ref('')
const needle = computed(() => normalizeSearch(search.value).trim())

const isCharacter = (key: string) => !!characterInfo(key)
const nameOf = (key: string) => (isCharacter(key) ? characterName(key) : itemName(key))
const iconOf = (key: string) => (isCharacter(key) ? characterIcon(key) : weaponIcon(key))
const rarityOf = (key: string) => characterInfo(key)?.rarity ?? weaponInfo(key)?.rarity

const banner = computed(() => KINDS.find((k) => k.kind === kind.value)!.banner)
const now = Date.now() / 1000
const versions = computed(() => {
  const f = file.data.value
  if (!f) return null
  const list = eventBanners(f, props.history.timezone).get(kind.value) ?? []
  let out = bannerHistory(list, props.stats.get(banner.value)?.runs ?? [])
  if (mine.value) out = pulledOnly(out)
  if (needle.value)
    out = featuring(out, (key) => normalizeSearch(nameOf(key)).includes(needle.value))
  return out
})
/** Open now: its dates read "… – now · current" (no other mark). */
const isOpen = (row: BannerHistoryRow) => row.banner.start <= now && now < row.banner.end
/** Not open yet: listed with its dates and "· upcoming". */
const isUpcoming = (row: BannerHistoryRow) => now < row.banner.start

/** A banner's name: the weapons it features (the game's own name is the same each time), else its title. */
function title(row: BannerHistoryRow): string {
  const b = row.banner
  if (kind.value === 'weapon') return b.featured5.map(nameOf).join(' / ')
  const name = bannerTitle(b.name)
  return b.name400 ? `${name} / ${bannerTitle(b.name400)}` : name || b.version
}
const FEW = { five: 4, four: 5 }
const shownKeys = (keys: readonly string[], max: number) => ({
  keys: keys.slice(0, max),
  more: Math.max(keys.length - max, 0),
})
const dates = (row: BannerHistoryRow) =>
  runDates({ banner: row.banner, pulls: 0, fives: [] }, isOpen(row))

/** Each run's pulls (newest first), by the banner object its rows were counted on. */
const runRows = computed(() => {
  const out = new Map<EventBanner, PullRow[]>()
  for (const row of props.stats.get(banner.value)?.rows ?? []) {
    if (!row.on) continue
    const list = out.get(row.on)
    if (list) list.push(row)
    else out.set(row.on, [row])
  }
  return out
})
const pullsOf = (row: BannerHistoryRow) =>
  row.run ? (runRows.value.get(row.run.banner) ?? []) : []
/** Each pull's number on its run (the pull table's #). */
const rolls = computed(() => runPullNumbers(props.stats.get(banner.value)?.rows ?? []))
/** The run being shared as a card. */
// shallowRef: the row's banner objects key the run lookups (a deep ref would wrap them in proxies).
const sharing = shallowRef<BannerHistoryRow | null>(null)
const foursOf = (row: BannerHistoryRow) =>
  pullsOf(row).filter((pull) => pull.pull.item.rank === 4).length

/** Banners opened into their pulls (until the kind or filters change). */
const expanded = ref<ReadonlySet<string>>(new Set())
const rowKey = (row: BannerHistoryRow) => `${row.banner.start}:${row.banner.name}`
function toggle(row: BannerHistoryRow) {
  const next = new Set(expanded.value)
  if (!next.delete(rowKey(row))) next.add(rowKey(row))
  expanded.value = next
}
watch([kind, mine, needle], () => (expanded.value = new Set()))
const rowId = (row: BannerHistoryRow) => `run-${rowKey(row)}`
// A run asked for by the URL: switch to its kind (the filter reset above runs first), then expand it once
// the versions are there and bring its row to the top.
const wanted = ref<string | null>(null)
watch(
  () => props.openRun,
  (key) => {
    const want = parseRunKey(key)
    if (!want) return
    wanted.value = key!
    search.value = ''
    if (KINDS.some((k) => k.kind === want.kind)) kind.value = want.kind
  },
  { immediate: true },
)
watch(
  [wanted, versions],
  async ([key, list]) => {
    const want = parseRunKey(key)
    if (!want || !list || kind.value !== want.kind) return
    wanted.value = null
    const row = list.flatMap((v) => v.rows).find((r) => rowKey(r) === runRowKey(want))
    if (!row?.run?.pulls) return
    await nextTick()
    expanded.value = new Set([...expanded.value, rowKey(row)])
    await nextTick()
    document.getElementById(rowId(row))?.scrollIntoView({ block: 'start' })
  },
  { immediate: true, flush: 'post' },
)
const OUTCOMES = ['won', 'lost', 'guaranteed', 'radiance'] as const
const outcomes = (row: BannerHistoryRow) => {
  const fives = row.run?.fives ?? []
  return {
    won: fives.filter((f) => f.outcome === 'won').length,
    lost: fives.filter((f) => f.outcome === 'lost').length,
    guaranteed: fives.filter((f) => f.outcome === 'guaranteed').length,
    radiance: fives.filter((f) => f.outcome === 'radiance').length,
  }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div
      class="flex flex-wrap items-center gap-2 rounded-xl border border-border-default bg-surface-raised p-3 shadow-sm"
    >
      <div class="flex flex-wrap gap-2" role="radiogroup" :aria-label="$t('wishes.history.kind')">
        <FilterChip
          v-for="k in KINDS"
          :key="k.kind"
          radio
          :pressed="kind === k.kind"
          @toggle="kind = k.kind"
        >
          {{ $t(`wishes.banners.${k.slug}.title`) }}
        </FilterChip>
      </div>
      <label class="relative min-w-0 flex-[1_1_14rem] sm:max-w-72">
        <span class="sr-only">{{ $t('wishes.history.search') }}</span>
        <Search
          class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-muted"
          aria-hidden="true"
        />
        <UiInput
          v-model="search"
          type="search"
          class="pl-9"
          :placeholder="$t('wishes.history.search')"
          autocomplete="off"
        />
      </label>
      <UiSwitch v-model="mine" class="ml-auto" :label="$t('wishes.history.mine')" />
    </div>

    <div v-if="!versions" class="flex flex-col gap-3" aria-busy="true">
      <UiSkeleton v-for="n in 4" :key="n" class="h-24" />
    </div>
    <UiEmpty v-else-if="versions.length === 0" :title="$t('wishes.history.none')">
      <template #icon><SearchX aria-hidden="true" /></template>
    </UiEmpty>
    <section
      v-for="v in versions ?? []"
      :key="v.version"
      class="flex flex-col gap-2"
      :aria-label="$t('wishes.history.version', { version: v.version })"
    >
      <h2 class="px-1 text-xs font-semibold tracking-wide text-text-muted uppercase">
        {{ $t('wishes.history.version', { version: v.version }) }}
      </h2>
      <article
        v-for="row in v.rows"
        :id="rowId(row)"
        :key="row.banner.start + row.banner.name"
        class="scroll-mt-20 rounded-xl border border-border-default bg-surface-raised shadow-sm"
      >
        <!-- An open banner's row stays under the app bar while its pulls scroll past.
             The whole row opens it (the summary button inside is the keyboard's way in;
             its click bubbles up here). -->
        <div
          class="flex flex-wrap items-center gap-x-5 gap-y-3 bg-surface-raised px-4 py-3"
          :class="[
            expanded.has(rowKey(row))
              ? 'sticky top-16 z-[5] rounded-t-[11px] border-b border-border-default'
              : 'rounded-[11px]',
            row.run?.pulls ? 'cursor-pointer transition-colors hover:bg-surface-overlay/40' : '',
          ]"
          @click="row.run?.pulls && toggle(row)"
        >
          <div class="flex w-36 shrink-0 flex-col">
            <span class="text-sm font-medium">{{
              $t('wishes.history.phase', { n: row.phase })
            }}</span>
            <span class="tabular font-mono text-xs text-text-muted"
              >{{ dates(row)
              }}{{
                isOpen(row)
                  ? $t('wishes.runs.current')
                  : isUpcoming(row)
                    ? $t('wishes.runs.upcoming')
                    : ''
              }}</span
            >
          </div>

          <div class="flex min-w-0 flex-[1_1_18rem] items-center gap-4">
            <div class="flex shrink-0 items-center gap-1.5">
              <GameIcon
                v-for="key in shownKeys(row.banner.featured5, FEW.five).keys"
                :key="key"
                :src="iconOf(key)"
                :name="nameOf(key)"
                :rarity="rarityOf(key)"
                :title="nameOf(key)"
              />
              <span
                v-if="shownKeys(row.banner.featured5, FEW.five).more"
                class="tabular font-mono text-xs text-text-muted"
                >+{{ shownKeys(row.banner.featured5, FEW.five).more }}</span
              >
            </div>
            <div class="flex min-w-0 flex-col gap-1.5">
              <span class="truncate text-sm font-semibold" :title="title(row)">{{
                row.banner.featured5.length <= 2
                  ? row.banner.featured5.map(nameOf).join(' / ')
                  : title(row)
              }}</span>
              <span class="truncate text-xs text-text-muted">{{ title(row) }}</span>
              <div class="flex items-center gap-1" :aria-label="$t('wishes.history.fours')">
                <GameIcon
                  v-for="key in shownKeys(row.banner.featured4, FEW.four).keys"
                  :key="key"
                  :src="iconOf(key)"
                  :name="nameOf(key)"
                  :rarity="rarityOf(key)"
                  size="xs"
                  :title="nameOf(key)"
                />
                <span
                  v-if="shownKeys(row.banner.featured4, FEW.four).more"
                  class="tabular font-mono text-xs text-text-muted"
                  >+{{ shownKeys(row.banner.featured4, FEW.four).more }}</span
                >
              </div>
            </div>
          </div>

          <button
            v-if="row.run && row.run.pulls && account"
            type="button"
            class="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border border-border-default bg-surface-raised px-3 text-sm font-medium transition-colors hover:bg-surface-overlay"
            :title="$t('wishes.share.title')"
            @click.stop="sharing = row"
          >
            <Share2 class="size-4" aria-hidden="true" />
            {{ $t('wishes.share.button') }}
          </button>
          <button
            v-if="row.run && row.run.pulls"
            type="button"
            class="flex min-h-12 w-full shrink-0 items-center sm:w-[19rem] gap-3 rounded-lg border border-border-default bg-surface-sunken px-3 py-1.5 text-left transition-colors hover:bg-surface-overlay"
            :aria-expanded="expanded.has(rowKey(row))"
          >
            <!-- The wishes at full size, the split, then the 5★ / 4★ over how the 5★ went. -->
            <span class="flex shrink-0 items-baseline gap-1.5">
              <span class="tabular font-mono text-lg font-semibold">{{
                formatNumber(row.run.pulls)
              }}</span>
              <span class="text-xs text-text-muted">{{ $t('wishes.history.wishes') }}</span>
            </span>
            <span class="h-8 w-px shrink-0 bg-border-default" aria-hidden="true" />
            <span class="flex min-w-0 flex-1 flex-col gap-0.5 text-xs">
              <span class="flex min-w-0 flex-wrap items-baseline gap-x-3">
                <span class="font-semibold text-rarity-5">{{
                  $t('wishes.history.fives', { n: row.run.fives.length })
                }}</span>
                <span v-if="foursOf(row)" class="font-semibold text-rarity-4">{{
                  $t('wishes.history.fourCount', { n: foursOf(row) })
                }}</span>
              </span>
              <span
                v-if="OUTCOMES.some((o) => outcomes(row)[o])"
                class="tabular flex min-w-0 flex-wrap items-center gap-x-3 font-mono"
              >
                <template v-for="o in OUTCOMES" :key="o">
                  <span
                    v-if="outcomes(row)[o]"
                    :class="OUTCOME_STYLE[o].text"
                    :title="outcomeLabel(o)"
                    >{{ OUTCOME_STYLE[o].mark }} {{ outcomes(row)[o] }}</span
                  >
                </template>
              </span>
            </span>
            <ChevronDown
              class="size-4 shrink-0 text-text-muted transition-transform"
              :class="expanded.has(rowKey(row)) ? 'rotate-180' : ''"
              aria-hidden="true"
            />
          </button>
          <div
            v-else
            class="flex min-h-12 w-full shrink-0 items-center sm:w-[19rem] rounded-lg border border-dashed border-border-default px-3 py-1.5 text-xs text-text-muted"
          >
            {{ $t('wishes.history.skipped') }}
          </div>
        </div>

        <template v-if="row.run && expanded.has(rowKey(row))">
          <BannerRunStats
            :banner="row.banner"
            :pulls="pullsOf(row)"
            :rolls="rolls"
            class="px-4 pt-4"
          />
          <WishTable :rows="pullsOf(row)" :banner="banner" embedded class="m-3" />
        </template>
      </article>
    </section>

    <BannerShareModal
      v-if="account"
      :open="!!sharing"
      :banner="sharing?.banner ?? null"
      :type="banner"
      :phase="sharing?.phase ?? 1"
      :pulls="sharing ? pullsOf(sharing) : []"
      :rolls="rolls"
      :account="account"
      :player-uid="playerUid ?? null"
      :ar="ar ?? null"
      @close="sharing = null"
    />
  </div>
</template>
