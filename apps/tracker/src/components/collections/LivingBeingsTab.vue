<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ChevronDown, ChevronsDownUp, ChevronsUpDown, Search } from 'lucide-vue-next'
import EnemyDialog from './EnemyDialog.vue'
import FilterChip from '@/components/ui/FilterChip.vue'
import GameIcon from '@/components/ui/GameIcon.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import UiError from '@/components/ui/UiError.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import UiStat from '@/components/ui/UiStat.vue'
import UiToolbar from '@/components/ui/UiToolbar.vue'
import type { CapturedCollections } from '@/data/collections'
import {
  ENEMY_FACTIONS,
  ENEMY_GROUPS,
  ENEMY_SORTS,
  enemySections,
  factionCounts,
  filterEnemies,
  loadEnemyData,
  type EnemyFaction,
  type EnemyGroup,
  type EnemySort,
} from '@/data/enemies'
import { useResource } from '@/data/use-resource'
import { locale } from '@/i18n/locale'
import { gameIcon, loadGameIcons } from '@/lib/assets'
import { formatNumber, formatShort } from '@/lib/format'
import { readStorage, writeStorage } from '@/lib/storage'
import { t } from '@/i18n'

/**
 * Living Beings: the game's archive as an enemy encyclopedia (every entry by
 * category, searchable; an entry opens with its stats, `?enemy=<id>`), with
 * the capture's defeat and capture counts on the entries that have them.
 * Small tiles (name and defeats only), so most of the archive fits on a
 * screen; grouped by the game's categories (each folds, like the Materials
 * bag) or one list, in the game's order or most defeated first. The grouping,
 * the sort and the folded categories are kept per device.
 */
const props = defineProps<{ captured: CapturedCollections }>()

const route = useRoute()
const router = useRouter()
const resource = useResource(
  () => locale.value,
  async (lang) => {
    const [data] = await Promise.all([loadEnemyData(lang), loadGameIcons()])
    return data
  },
)

const defeats = computed(() => props.captured.defeats?.value ?? {})
const totals = computed(() => {
  const rows = Object.values(defeats.value)
  return {
    kinds: rows.length,
    defeated: rows.reduce((sum, d) => sum + d.defeated, 0),
    captured: rows.reduce((sum, d) => sum + (d.captured ?? 0), 0),
    capturedKinds: rows.filter((d) => (d.captured ?? 0) > 0).length,
  }
})

const GROUP_KEY = 'collections:enemies:group'
const SORT_KEY = 'collections:enemies:sort'
const FOLDED_KEY = 'collections:enemies:folded'
function stored<T extends string>(key: string, values: readonly T[]): T {
  const value = readStorage(key) as T | null
  return value && values.includes(value) ? value : values[0]!
}
const group = ref<EnemyGroup>(stored(GROUP_KEY, ENEMY_GROUPS))
watch(group, (value) => writeStorage(GROUP_KEY, value))
const sortChoice = ref<EnemySort>(stored(SORT_KEY, ENEMY_SORTS))
watch(sortChoice, (value) => writeStorage(SORT_KEY, value))
/** Without a capture's defeat counts Defeated is off, and the game's order is used. */
const hasDefeats = computed(() => Object.keys(defeats.value).length > 0)
const sort = computed<EnemySort>(() => (hasDefeats.value ? sortChoice.value : 'order'))
const groupOptions = computed(() =>
  ENEMY_GROUPS.map((value) => ({ value, label: t(`collections.enemies.groups.${value}`) })),
)
const sortOptions = computed(() =>
  ENEMY_SORTS.map((value) => {
    const off = value === 'defeated' && !hasDefeats.value
    return {
      value,
      label: t(`collections.enemies.sorts.${value}`),
      disabled: off,
      title: off ? t('collections.enemies.noDefeats') : undefined,
    }
  }),
)

/** Categories folded to their heading (per device). */
const folded = ref(
  new Set(
    (readStorage(FOLDED_KEY) ?? '')
      .split(',')
      .filter((f): f is EnemyFaction => (ENEMY_FACTIONS as readonly string[]).includes(f)),
  ),
)
function saveFolded(next: Set<EnemyFaction>) {
  folded.value = next
  writeStorage(FOLDED_KEY, next.size ? [...next].join(',') : null)
}
function toggleFold(f: EnemyFaction) {
  const next = new Set(folded.value)
  if (!next.delete(f)) next.add(f)
  saveFolded(next)
}

const faction = ref<EnemyFaction | 'all'>('all')
const query = ref('')
const all = computed(() => resource.data.value?.enemies.enemies ?? [])
const counts = computed(() => factionCounts(all.value))
const shown = computed(() => {
  const data = resource.data.value
  return data ? filterEnemies(all.value, data.names, faction.value, query.value) : []
})

const defeatedOf = (id: number) => defeats.value[id]?.defeated ?? 0
const sections = computed(() =>
  enemySections(shown.value, group.value, sort.value, defeatedOf).map((section) => ({
    ...section,
    open: !section.faction || !folded.value.has(section.faction),
  })),
)
const headed = computed(() => sections.value.filter((s) => s.faction))
const allFolded = computed(() => headed.value.every((s) => !s.open))
function foldAll() {
  saveFolded(allFolded.value ? new Set() : new Set(headed.value.map((s) => s.faction!)))
}
/** The first screenful of tiles loads its pictures first. */
const first = computed(() => {
  const ids = new Set<number>()
  for (const section of sections.value) {
    if (!section.open) continue
    for (const e of section.enemies) {
      if (ids.size >= 48) return ids
      ids.add(e.id)
    }
  }
  return ids
})

const openId = computed(() => Number(route.query.enemy) || 0)
const open = computed(() => resource.data.value?.enemies.byId.get(openId.value) ?? null)
function show(id: number | null) {
  const query = { ...route.query }
  if (id) query.enemy = String(id)
  else delete query.enemy
  void router.replace({ query })
}
/** A tile's defeat count, compact (12.3K) to fit the corner; the tooltip has it exact. */
const figure = (id: number) => {
  const d = defeats.value[id]
  return d ? formatShort(d.defeated) : ''
}
const exact = (id: number) => formatNumber(defeats.value[id]?.defeated ?? 0)
const GRID =
  'grid grid-cols-[repeat(auto-fill,minmax(3.5rem,1fr))] gap-1.5 sm:grid-cols-[repeat(auto-fill,minmax(4rem,1fr))] sm:gap-2'
</script>

<template>
  <div class="flex flex-col gap-4">
    <ul
      v-if="captured.defeats"
      class="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4"
      :aria-label="$t('collections.summary')"
    >
      <li class="flex min-w-0">
        <UiStat
          :label="$t('collections.defeats.kinds')"
          :value="totals.kinds"
          exact
          :hint="$t('collections.defeats.kindsHint')"
        />
      </li>
      <li class="flex min-w-0">
        <UiStat :label="$t('collections.defeats.defeated')" :value="totals.defeated" />
      </li>
      <li class="flex min-w-0">
        <UiStat
          :label="$t('collections.defeats.captured')"
          :value="totals.captured"
          exact
          :hint="$t('collections.defeats.capturedHint', { n: formatNumber(totals.capturedKinds) })"
        />
      </li>
      <li v-if="captured.monstersSeen" class="flex min-w-0">
        <UiStat
          :label="$t('collections.defeats.seen')"
          :value="captured.monstersSeen.value.length"
          exact
          :hint="$t('collections.defeats.seenHint')"
        />
      </li>
    </ul>

    <UiToolbar :label="$t('collections.enemies.search')" sticky>
      <!-- Phones: search and fold-all on one row, the two switches below; wider: one row. -->
      <div class="flex flex-wrap items-center gap-2">
        <label class="relative order-1 block min-w-0 flex-[1_1_12rem]">
          <Search
            class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-muted"
            aria-hidden="true"
          />
          <UiInput
            v-model="query"
            type="search"
            class="pl-9"
            :placeholder="$t('collections.enemies.searchPlaceholder')"
            :aria-label="$t('collections.enemies.search')"
          />
        </label>
        <div class="order-3 flex flex-wrap items-center gap-2 sm:order-2">
          <UiSegmented
            v-model="group"
            :options="groupOptions"
            :label="$t('collections.enemies.groupBy')"
            :title="$t('collections.enemies.groupBy')"
          />
          <UiSegmented
            v-model="sortChoice"
            :options="sortOptions"
            :label="$t('collections.enemies.sort')"
            :title="$t('collections.enemies.sort')"
          />
        </div>
        <UiIconButton
          v-if="group === 'type' && headed.length > 1"
          class="order-2 sm:order-3"
          :label="
            allFolded ? $t('collections.enemies.unfoldAll') : $t('collections.enemies.foldAll')
          "
          @click="foldAll"
        >
          <ChevronsUpDown v-if="allFolded" class="size-5" aria-hidden="true" />
          <ChevronsDownUp v-else class="size-5" aria-hidden="true" />
        </UiIconButton>
      </div>
      <div
        class="scroll-hide scroll-fade-x -mx-3 flex items-center gap-2 overflow-x-auto px-3 sm:mx-0 sm:scroll-fade-none sm:flex-wrap sm:overflow-visible sm:px-0"
        role="radiogroup"
        :aria-label="$t('collections.enemies.faction')"
      >
        <FilterChip
          radio
          :pressed="faction === 'all'"
          :count="all.length"
          @toggle="faction = 'all'"
        >
          {{ $t('collections.enemies.all') }}
        </FilterChip>
        <FilterChip
          v-for="f in ENEMY_FACTIONS"
          :key="f"
          radio
          :pressed="faction === f"
          :count="counts[f]"
          @toggle="faction = f"
        >
          {{ $t(`collections.enemies.factions.${f}`) }}
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
      <UiSkeleton v-for="n in 36" :key="n" class="aspect-[4/5]" />
    </div>
    <UiEmpty v-else-if="!shown.length" :title="$t('collections.enemies.noMatch')" />
    <div v-else class="flex flex-col gap-1">
      <section
        v-for="section in sections"
        :key="section.faction ?? 'all'"
        :aria-label="
          section.faction
            ? $t(`collections.enemies.factions.${section.faction}`)
            : $t('collections.tabs.livingBeings')
        "
        :class="section.open && section.faction ? 'pb-4' : ''"
      >
        <h3 v-if="section.faction" class="text-sm font-medium" :class="section.open ? 'mb-2' : ''">
          <button
            type="button"
            class="-mx-1 flex min-h-8 w-[calc(100%+0.5rem)] items-center gap-2 rounded-md px-1 text-left transition-colors hover:bg-surface-overlay"
            :aria-expanded="section.open"
            @click="toggleFold(section.faction)"
          >
            <ChevronDown
              class="size-4 shrink-0 text-text-muted transition-transform"
              :class="section.open ? '' : '-rotate-90'"
              aria-hidden="true"
            />
            <span class="truncate">{{
              $t(`collections.enemies.factions.${section.faction}`)
            }}</span>
            <span class="tabular font-mono text-text-muted">{{
              formatNumber(section.enemies.length)
            }}</span>
            <span class="h-px min-w-4 flex-1 bg-border-default" aria-hidden="true" />
          </button>
        </h3>
        <!-- A folded category shows only its heading. -->
        <ul v-if="section.open" :class="GRID">
          <li
            v-for="enemy in section.enemies"
            :key="enemy.id"
            class="flex min-w-0 [content-visibility:auto] [contain-intrinsic-size:auto_7rem]"
          >
            <button
              type="button"
              class="flex w-full min-w-0 flex-col overflow-hidden rounded-lg border border-border-default bg-surface-raised shadow-sm transition-colors hover:border-border-strong hover:bg-surface-overlay focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
              :title="resource.data.value.names.name(enemy.id)"
              :aria-label="
                $t('collections.enemies.open', { name: resource.data.value.names.name(enemy.id) })
              "
              @click="show(enemy.id)"
            >
              <span
                class="relative flex aspect-square w-full items-center justify-center bg-linear-to-b from-surface-overlay to-surface-sunken"
              >
                <GameIcon
                  :src="gameIcon(enemy.icon)"
                  :name="resource.data.value.names.name(enemy.id)"
                  size="md"
                  :priority="first.has(enemy.id) ? 'high' : undefined"
                  class="!size-[82%]"
                />
                <span
                  v-if="figure(enemy.id)"
                  class="tabular absolute top-0.5 right-0.5 rounded bg-surface-base/85 px-1 font-mono text-[0.625rem] leading-4 text-text-secondary"
                  :title="t('collections.defeats.defeatedN', { n: exact(enemy.id) })"
                  >{{ figure(enemy.id) }}</span
                >
              </span>
              <span
                class="mx-1 my-1 line-clamp-2 min-h-[2lh] text-center text-[0.7rem] leading-tight break-words text-text-primary"
                >{{ resource.data.value.names.name(enemy.id) }}</span
              >
            </button>
          </li>
        </ul>
      </section>
    </div>

    <EnemyDialog
      v-if="resource.data.value"
      :enemy="open"
      :data="resource.data.value"
      @close="show(null)"
    />
  </div>
</template>
