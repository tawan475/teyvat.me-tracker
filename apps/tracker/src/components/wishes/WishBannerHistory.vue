<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Search, SearchX } from 'lucide-vue-next'
import { characterInfo, weaponInfo } from '@gdt/game-data/catalog'
import type { UigfGachaType } from '@gdt/shared'
import FilterChip from '@/components/ui/FilterChip.vue'
import GameIcon from '@/components/ui/GameIcon.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import UiSwitch from '@/components/ui/UiSwitch.vue'
import { useResource } from '@/data/use-resource'
import {
  bannerHistory,
  featuring,
  pulledOnly,
  type BannerHistoryRow,
} from '@/data/wish-banner-history'
import {
  eventBanners,
  pityBand,
  type BannerStats,
  type EventKind,
  type PullRow,
  type WishHistory,
} from '@/data/wish-history'
import { itemName } from '@/data/weapons'
import { characterName } from '@/i18n/game-names'
import { t } from '@/i18n'
import { characterIcon, weaponIcon } from '@/lib/assets'
import { formatNumber } from '@/lib/format'
import { normalizeSearch } from '@/lib/search'
import { readStorage, writeStorage } from '@/lib/storage'
import { wishItemName } from './item-name'
import { loadBannerFile } from './use-wish-stats'
import WishItemIcon from './WishItemIcon.vue'
import { BAND_COLOR, outcomeLabel, runDates } from './wish-labels'

/**
 * Banner history: every event banner that has opened, by version, newest
 * first — its featured 5★ and 4★, and the account's own run on it (wishes,
 * each 5★ with its pity and 50/50) or that it was skipped. Character, Weapon
 * and Chronicled; a name search and "only banners I wished on".
 */
const props = defineProps<{
  history: WishHistory
  stats: ReadonlyMap<UigfGachaType, BannerStats>
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
  let out = bannerHistory(list, props.stats.get(banner.value)?.runs ?? [], now)
  if (mine.value) out = pulledOnly(out)
  if (needle.value)
    out = featuring(out, (key) => normalizeSearch(nameOf(key)).includes(needle.value))
  return out
})
/** Open now: marked like the banner page's current run. */
const isOpen = (row: BannerHistoryRow) => row.banner.start <= now && now < row.banner.end

/** A banner's name: the weapons it features (the game's own name is the same each time), else its title. */
function title(row: BannerHistoryRow): string {
  const b = row.banner
  if (kind.value === 'weapon') return b.featured5.map(nameOf).join(' / ')
  return b.name400 ? `${b.name} / ${b.name400}` : b.name || b.version
}
const FEW = { five: 4, four: 5 }
const shownKeys = (keys: readonly string[], max: number) => ({
  keys: keys.slice(0, max),
  more: Math.max(keys.length - max, 0),
})
const dates = (row: BannerHistoryRow) =>
  runDates({ banner: row.banner, pulls: 0, fives: [] }, isOpen(row))

const chipTitle = (row: PullRow) =>
  [
    t('wishes.five.pity', { name: wishItemName(row.pull.item), pity: row.pity }),
    row.outcome ? outcomeLabel(row.outcome) : '',
  ]
    .filter(Boolean)
    .join('\n')
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
        :key="row.banner.start + row.banner.name"
        class="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border bg-surface-raised px-4 py-3 shadow-sm"
        :class="
          isOpen(row)
            ? 'border-accent-text shadow-[inset_3px_0_0_var(--accent)]'
            : 'border-border-default'
        "
      >
        <div class="flex w-36 shrink-0 flex-col">
          <span class="text-sm font-medium">{{
            $t('wishes.history.phase', { n: row.phase })
          }}</span>
          <span class="tabular font-mono text-xs text-text-muted"
            >{{ dates(row) }}{{ isOpen(row) ? $t('wishes.runs.current') : '' }}</span
          >
        </div>

        <div class="flex min-w-0 flex-[999_1_22rem] items-center gap-4">
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

        <div
          class="flex min-h-14 min-w-0 flex-[1_1_18rem] items-center gap-3 rounded-lg px-3 py-2"
          :class="
            row.run && row.run.pulls
              ? 'border border-border-default bg-surface-sunken'
              : 'border border-dashed border-border-default'
          "
        >
          <template v-if="row.run && row.run.pulls">
            <div class="flex shrink-0 flex-col">
              <span class="tabular font-mono text-lg font-semibold">{{
                formatNumber(row.run.pulls)
              }}</span>
              <span class="text-xs text-text-muted">{{ $t('wishes.history.wishes') }}</span>
            </div>
            <div class="h-8 w-px shrink-0 bg-border-default" />
            <div class="flex min-w-0 flex-wrap gap-1.5">
              <span
                v-for="five in [...row.run.fives].reverse()"
                :key="five.pull.id.toString()"
                class="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-lg bg-surface-raised py-0.5 pr-2 pl-0.5 text-xs"
                :title="chipTitle(five)"
              >
                <WishItemIcon :item="five.pull.item" :outcome="five.outcome" size="sm" />
                <span class="truncate">{{ wishItemName(five.pull.item) }}</span>
                <span
                  class="tabular shrink-0 font-mono font-bold"
                  :style="{ color: BAND_COLOR[pityBand(five.pity, banner)] }"
                  >{{ five.pity }}</span
                >
              </span>
              <span v-if="!row.run.fives.length" class="text-xs text-text-muted">{{
                $t('wishes.runs.no5')
              }}</span>
            </div>
          </template>
          <span v-else class="text-xs text-text-muted">{{ $t('wishes.history.skipped') }}</span>
        </div>
      </article>
    </section>
  </div>
</template>
