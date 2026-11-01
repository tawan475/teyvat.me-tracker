<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Search } from 'lucide-vue-next'
import EnemyDialog from './EnemyDialog.vue'
import FilterChip from '@/components/ui/FilterChip.vue'
import GameIcon from '@/components/ui/GameIcon.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import UiError from '@/components/ui/UiError.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import UiStat from '@/components/ui/UiStat.vue'
import UiToolbar from '@/components/ui/UiToolbar.vue'
import type { CapturedCollections } from '@/data/collections'
import {
  ENEMY_FACTIONS,
  factionCounts,
  filterEnemies,
  loadEnemyData,
  type EnemyFaction,
} from '@/data/enemies'
import { useResource } from '@/data/use-resource'
import { locale } from '@/i18n/locale'
import { gameIcon, loadGameIcons } from '@/lib/assets'
import { formatNumber } from '@/lib/format'
import { t } from '@/i18n'

/**
 * Living Beings: the game's archive as an enemy encyclopedia (every entry by
 * category, searchable; an entry opens with its stats, `?enemy=<id>`), with
 * the capture's defeat and capture counts on the entries that have them.
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

const faction = ref<EnemyFaction | 'all'>('all')
const query = ref('')
const all = computed(() => resource.data.value?.enemies.enemies ?? [])
const counts = computed(() => factionCounts(all.value))
const shown = computed(() => {
  const data = resource.data.value
  return data ? filterEnemies(all.value, data.names, faction.value, query.value) : []
})

const openId = computed(() => Number(route.query.enemy) || 0)
const open = computed(() => resource.data.value?.enemies.byId.get(openId.value) ?? null)
function show(id: number | null) {
  const query = { ...route.query }
  if (id) query.enemy = String(id)
  else delete query.enemy
  void router.replace({ query })
}
const figure = (id: number) => {
  const d = defeats.value[id]
  return d ? formatNumber(d.defeated) : ''
}
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

    <UiToolbar :label="$t('collections.enemies.search')">
      <label class="relative block">
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
    <div
      v-else-if="!resource.data.value"
      class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,8.5rem),1fr))] gap-2 sm:gap-3"
      aria-busy="true"
    >
      <UiSkeleton v-for="n in 16" :key="n" class="aspect-[4/5]" />
    </div>
    <UiEmpty v-else-if="!shown.length" :title="$t('collections.enemies.noMatch')" />
    <ul
      v-else
      class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,8.5rem),1fr))] gap-2 sm:gap-3"
      :aria-label="$t('collections.tabs.livingBeings')"
    >
      <li
        v-for="(enemy, i) in shown"
        :key="enemy.id"
        class="flex min-w-0 [content-visibility:auto] [contain-intrinsic-size:auto_12rem]"
      >
        <button
          type="button"
          class="group flex w-full min-w-0 flex-col overflow-hidden rounded-xl border border-border-default bg-surface-raised text-left shadow-sm transition-colors hover:border-border-strong hover:bg-surface-overlay focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
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
              size="lg"
              :priority="i < 12 ? 'high' : undefined"
              class="!size-[78%]"
            />
            <span
              v-if="figure(enemy.id)"
              class="tabular absolute top-1.5 right-1.5 rounded bg-surface-base/80 px-1.5 py-0.5 font-mono text-[0.7rem] text-text-secondary"
              :title="t('collections.defeats.defeatedN', { n: figure(enemy.id) })"
              >{{ figure(enemy.id) }}</span
            >
          </span>
          <span class="flex min-w-0 flex-col gap-0.5 px-2.5 py-2">
            <span class="truncate text-sm font-semibold text-text-primary">{{
              resource.data.value.names.name(enemy.id)
            }}</span>
            <span class="truncate text-xs text-accent-text">{{
              $t(`collections.enemies.factions.${enemy.faction}`)
            }}</span>
          </span>
        </button>
      </li>
    </ul>

    <EnemyDialog
      v-if="resource.data.value"
      :enemy="open"
      :data="resource.data.value"
      @close="show(null)"
    />
  </div>
</template>
