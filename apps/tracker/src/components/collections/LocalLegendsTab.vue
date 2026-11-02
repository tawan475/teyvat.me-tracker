<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Check, Search } from 'lucide-vue-next'
import { localLegendLevel } from '@gdt/game-data/enemies'
import EnemyDialog from './EnemyDialog.vue'
import LegendCard from './LegendCard.vue'
import { useCollectionCatalog } from './use-catalog'
import { useAchievementMarks } from '@/components/achievements/use-achievement-marks'
import FilterChip from '@/components/ui/FilterChip.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import UiError from '@/components/ui/UiError.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import UiStat from '@/components/ui/UiStat.vue'
import UiToolbar from '@/components/ui/UiToolbar.vue'
import { NO_CAPTURED_ACHIEVEMENTS, loadCapturedAchievements } from '@/data/achievement-capture'
import { isDone } from '@/data/achievement-progress'
import { loadAccountPlayer } from '@/data/account-data'
import { nameOf } from '@/data/collection-names'
import { loadEnemyData } from '@/data/enemies'
import { legendSections, matchesLegend, type LegendView } from '@/data/local-legends'
import { useResource } from '@/data/use-resource'
import { locale } from '@/i18n/locale'
import { formatNumber } from '@/lib/format'
import { loadGameIcons } from '@/lib/assets'
import { readStorage, writeStorage } from '@/lib/storage'
import { useAccount } from '@/views/account/context'
import { t } from '@/i18n'

/**
 * Local Legends: every released one by region (the wiki's order), each with
 * its picture(s), name, subtitle and HP where it fights. They fight at the
 * World Level's monster level + 3 (Lv. 103 at World Level 9), so the HP
 * follows the account's World Level from its captures (World Level 9 without
 * one); the picker tries the others. Defeated (and the Natlan ones' extra
 * goals) come from the defeat achievements: captured or marked by hand. A
 * card opens the enemy dialog at that level (`?legend=<id>`).
 */
const route = useRoute()
const router = useRouter()
const account = useAccount()

const resource = useResource(
  () => locale.value,
  async (lang) => {
    const [data] = await Promise.all([loadEnemyData(lang), loadGameIcons()])
    return data
  },
)
const catalog = useCollectionCatalog(() => ['world'])
const player = useResource(
  () => account.value,
  (a) => loadAccountPlayer(a),
)
const achievements = useResource(
  () => account.value,
  async (a) => ({
    accountId: a.id,
    captured: a.latest ? await loadCapturedAchievements(a) : NO_CAPTURED_ACHIEVEMENTS,
  }),
)
const marks = useAchievementMarks(() => account.value.id)
const done = (id: number) => {
  const value = achievements.data.value
  if (!value || value.accountId !== account.value.id) return false
  return isDone({ captured: value.captured.ids, marked: marks.marked.value }, id)
}

/** The highest World Level (WorldLevel's rows; 9 at 7.1). */
const MAX_WL = computed(() => resource.data.value?.enemies.worldLevels.length || 9)
/** The account's World Level (null: no capture says); the picker starts on it. */
const accountWl = computed(() => {
  const wl = player.data.value?.wl
  return wl == null ? null : Math.min(Math.max(wl, 1), MAX_WL.value)
})
const picked = ref<number | null>(null)
watch(
  () => account.value.id,
  () => (picked.value = null),
)
const wl = computed({
  get: () => picked.value ?? accountWl.value ?? MAX_WL.value,
  set: (value) => (picked.value = value),
})
const level = computed(() =>
  localLegendLevel(wl.value, resource.data.value?.enemies.worldLevels ?? []),
)
const wlOptions = computed(() =>
  Array.from({ length: MAX_WL.value }, (_, i) => {
    const n = MAX_WL.value - i
    return {
      value: n,
      label:
        n === accountWl.value
          ? t('collections.legends.wlYours', { n })
          : t('collections.legends.wlN', { n }),
    }
  }),
)

const HIDE_KEY = 'collections:legends:hide-defeated'
const hideDefeated = ref(readStorage(HIDE_KEY) === '1')
watch(hideDefeated, (value) => writeStorage(HIDE_KEY, value ? '1' : null))
const query = ref('')
/** The region chip: every region (headed sections) or one. */
const region = ref<number | 'all'>('all')

const sections = computed(() => {
  const data = resource.data.value
  if (!data) return []
  return legendSections(data.enemies.legends, data.names, data.enemies.statsAt, level.value, done)
})
const rows = computed(() => sections.value.flatMap((s) => s.rows))
const shown = computed(() =>
  sections.value
    .filter((s) => region.value === 'all' || s.region === region.value)
    .map((s) => ({
      ...s,
      rows: s.rows.filter(
        (r) => matchesLegend(r, query.value) && !(hideDefeated.value && r.defeated),
      ),
    }))
    .filter((s) => s.rows.length),
)
/** A section's defeated count of those with a defeat achievement (null when none has one). */
const sectionTally = (rows: { defeated: boolean | null }[]) => {
  const tracked = rows.filter((r) => r.defeated !== null)
  return tracked.length ? `${tracked.filter((r) => r.defeated).length}/${tracked.length}` : null
}
const tally = computed(() => {
  const tracked = rows.value.filter((r) => r.defeated !== null)
  return { defeated: tracked.filter((r) => r.defeated).length, tracked: tracked.length }
})
/** A region's name; 0 (a Local Legend the data doesn't place yet) reads as Other. */
const regionName = (city: number) => {
  if (city === 0) return t('collections.archive.otherRegion')
  const value = catalog.data.value
  const name = value ? nameOf(value, 'cities', city) : ''
  return name && !name.startsWith('#') ? name : ''
}

const openId = computed(() => Number(route.query.legend) || 0)
const open = computed<LegendView | null>(() => {
  const row = rows.value.find((r) => r.legend.id === openId.value)
  if (!row) return null
  return {
    id: row.legend.id,
    name: row.name,
    subtitle: row.subtitle,
    description: row.description,
    members: row.legend.monsters.map((stats, i) => ({ icon: row.legend.icons[i]!, stats })),
  }
})
function show(id: number | null) {
  const next = { ...route.query }
  if (id) next.legend = String(id)
  else delete next.legend
  void router.replace({ query: next })
}
const fight = computed(() => {
  const row = rows.value.find((r) => r.legend.id === openId.value)
  return row
    ? {
        hp: row.hp[0]!,
        before: false,
        where: t('collections.legends.wlN', { n: wl.value }),
      }
    : null
})
const hpTip = computed(() =>
  t('collections.legends.hpTip', { n: level.value, wl: wl.value, base: level.value - 3 }),
)
const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))] gap-2 sm:gap-3'
</script>

<template>
  <div class="flex flex-col gap-4">
    <ul
      class="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4"
      :aria-label="$t('collections.summary')"
    >
      <li class="flex min-w-0">
        <UiStat :label="$t('collections.tabs.localLegends')" :value="rows.length" exact />
      </li>
      <li class="flex min-w-0">
        <UiStat
          :label="$t('collections.legends.defeated')"
          :value="`${formatNumber(tally.defeated)} / ${formatNumber(tally.tracked)}`"
          :hint="$t('collections.legends.defeatedHint')"
        />
      </li>
      <li class="flex min-w-0">
        <UiStat
          :label="$t('collections.legends.level')"
          :value="$t('endgame.level', { n: level })"
          :hint="hpTip"
        />
      </li>
    </ul>

    <UiToolbar :label="$t('collections.legends.search')">
      <div class="flex flex-wrap items-center gap-2">
        <label class="relative block min-w-0 flex-[1_1_12rem]">
          <Search
            class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-muted"
            aria-hidden="true"
          />
          <UiInput
            v-model="query"
            type="search"
            class="pl-9"
            :placeholder="$t('collections.legends.searchPlaceholder')"
            :aria-label="$t('collections.legends.search')"
          />
        </label>
        <UiSelect
          v-model="wl"
          :options="wlOptions"
          class="w-44"
          :aria-label="$t('collections.legends.worldLevel')"
          :title="hpTip"
        />
        <FilterChip :pressed="hideDefeated" @toggle="hideDefeated = !hideDefeated">
          {{ $t('collections.legends.hideDefeated') }}
        </FilterChip>
      </div>
      <div
        v-if="sections.length > 1"
        class="scroll-hide scroll-fade-x -mx-3 flex items-center gap-2 overflow-x-auto px-3 sm:mx-0 sm:scroll-fade-none sm:flex-wrap sm:overflow-visible sm:px-0"
        role="radiogroup"
        :aria-label="$t('collections.archive.region')"
      >
        <FilterChip radio :pressed="region === 'all'" :count="rows.length" @toggle="region = 'all'">
          {{ $t('collections.enemies.all') }}
        </FilterChip>
        <FilterChip
          v-for="s in sections"
          :key="s.region"
          radio
          :pressed="region === s.region"
          :count="s.rows.length"
          @toggle="region = s.region"
        >
          {{ regionName(s.region) }}
        </FilterChip>
      </div>
    </UiToolbar>

    <UiError
      v-if="resource.error.value && !resource.data.value"
      :title="$t('collections.enemies.loadFailed')"
      :error="resource.error.value"
      @retry="resource.reload"
    />
    <div v-else-if="!resource.data.value" :class="GRID" aria-busy="true">
      <UiSkeleton v-for="n in 12" :key="n" class="h-28 sm:h-32" />
    </div>
    <UiEmpty v-else-if="!shown.length" :title="$t('collections.enemies.noMatch')" />
    <div v-else class="flex flex-col gap-6">
      <section
        v-for="section in shown"
        :key="section.region"
        :aria-label="regionName(section.region) || undefined"
      >
        <h3 class="mb-2 flex items-center gap-2 text-sm font-medium">
          <span class="truncate">{{ regionName(section.region) }}</span>
          <span class="tabular font-mono text-text-muted">{{
            formatNumber(section.rows.length)
          }}</span>
          <span
            v-if="sectionTally(section.rows)"
            class="tabular inline-flex items-center gap-1 font-mono text-xs text-success-text"
            :title="$t('collections.legends.defeatedHint')"
            ><Check class="size-3.5" aria-hidden="true" />{{ sectionTally(section.rows) }}</span
          >
          <span class="h-px min-w-4 flex-1 bg-border-default" aria-hidden="true" />
        </h3>
        <ul :class="GRID">
          <li
            v-for="(row, i) in section.rows"
            :key="row.legend.id"
            class="rise-in flex min-w-0"
            :style="{ animationDelay: `${Math.min(i, 12) * 30}ms` }"
          >
            <LegendCard :row="row" :hp-tip="hpTip" :priority="i < 8" @open="show(row.legend.id)" />
          </li>
        </ul>
      </section>
    </div>

    <EnemyDialog
      v-if="resource.data.value"
      :enemy="null"
      :legend="open"
      :data="resource.data.value"
      :level="level"
      :fight="fight"
      @close="show(null)"
    />
  </div>
</template>
