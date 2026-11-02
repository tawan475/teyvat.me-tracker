<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Search } from 'lucide-vue-next'
import { localLegendLevel } from '@gdt/game-data/enemies'
import EnemyDialog from './EnemyDialog.vue'
import { useCollectionCatalog } from './use-catalog'
import GameIcon from '@/components/ui/GameIcon.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import UiError from '@/components/ui/UiError.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import UiToolbar from '@/components/ui/UiToolbar.vue'
import { loadAccountPlayer } from '@/data/account-data'
import { nameOf } from '@/data/collection-names'
import { loadEnemyData } from '@/data/enemies'
import { legendSections, matchesLegend, type LegendView } from '@/data/local-legends'
import { useResource } from '@/data/use-resource'
import { locale } from '@/i18n/locale'
import { formatNumber, formatShort } from '@/lib/format'
import { gameIcon, loadGameIcons } from '@/lib/assets'
import { useAccount } from '@/views/account/context'
import { t } from '@/i18n'

/**
 * Local Legends: every released one by region (the wiki's order), each with
 * its picture(s), name, subtitle and HP where it fights. They fight at the
 * World Level's monster level + 3 (Lv. 103 at World Level 9), so the HP
 * follows the account's World Level from its captures (World Level 9 without
 * one); the picker tries the others. A card opens the enemy dialog at that level (`?legend=<id>`).
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

const query = ref('')

const sections = computed(() => {
  const data = resource.data.value
  if (!data) return []
  return legendSections(data.enemies.legends, data.names, data.enemies.statsAt, level.value)
})
const rows = computed(() => sections.value.flatMap((s) => s.rows))
const shown = computed(() =>
  sections.value
    .map((s) => ({
      ...s,
      rows: s.rows.filter((r) => matchesLegend(r, query.value)),
    }))
    .filter((s) => s.rows.length),
)
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
/** Two columns on phones, cards of at least 16rem from `sm`. */
const GRID = 'grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] sm:gap-3'
</script>

<template>
  <div class="flex flex-col gap-4">
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
      </div>
    </UiToolbar>

    <UiError
      v-if="resource.error.value && !resource.data.value"
      :title="$t('collections.enemies.loadFailed')"
      :error="resource.error.value"
      @retry="resource.reload"
    />
    <div v-else-if="!resource.data.value" :class="GRID" aria-busy="true">
      <UiSkeleton v-for="n in 12" :key="n" class="h-56" />
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
          <span class="h-px min-w-4 flex-1 bg-border-default" aria-hidden="true" />
        </h3>
        <ul :class="GRID">
          <li
            v-for="(row, i) in section.rows"
            :key="row.legend.id"
            class="rise-in flex min-w-0"
            :style="{ animationDelay: `${Math.min(i, 12) * 30}ms` }"
          >
            <button
              type="button"
              class="group relative flex w-full min-w-0 flex-col items-center gap-1 overflow-hidden rounded-xl border border-border-default bg-surface-raised px-2 pt-2 pb-3 text-center shadow-sm sm:px-3 sm:pt-3 sm:pb-3.5 transition-colors hover:border-border-strong hover:bg-surface-overlay focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
              :aria-label="$t('collections.enemies.open', { name: row.name })"
              @click="show(row.legend.id)"
            >
              <span
                class="flex h-20 w-full items-end sm:h-24 justify-center gap-1 rounded-lg bg-linear-to-b from-surface-overlay to-surface-sunken"
              >
                <GameIcon
                  v-for="(icon, i) in row.legend.icons"
                  :key="i"
                  :src="gameIcon(icon)"
                  :name="row.name"
                  size="lg"
                  :class="
                    row.legend.icons.length > 1 ? '!size-12 sm:!size-16' : '!size-20 sm:!size-24'
                  "
                  class="transition-transform group-hover:scale-[1.04]"
                />
              </span>
              <span class="mt-1.5 line-clamp-2 text-sm leading-snug font-semibold sm:text-base">{{
                row.name
              }}</span>
              <span v-if="row.subtitle" class="line-clamp-2 text-xs text-warning-text sm:text-sm">{{
                row.subtitle
              }}</span>
              <span
                class="tabular mt-1 flex flex-wrap justify-center gap-x-2 font-mono text-sm font-semibold text-danger-text"
                :title="`${hpTip}\n${row.hp.map((n) => formatNumber(n)).join(' · ')}`"
              >
                <span v-for="(hp, i) in row.hp" :key="i">♥ {{ formatShort(hp) }}</span>
              </span>
            </button>
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
