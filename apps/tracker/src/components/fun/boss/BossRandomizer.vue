<script setup lang="ts">
import { computed, defineAsyncComponent, reactive, ref, watch } from 'vue'
import { loadFarming } from '@gdt/game-data/farming'
import { localLegendLevel } from '@gdt/game-data/enemies'
import { Ban, Dices, Info, SearchX, Undo2 } from 'lucide-vue-next'
import FilterChip from '@/components/ui/FilterChip.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import UiError from '@/components/ui/UiError.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import {
  BOSS_KINDS,
  BOSS_REEL_MS,
  BOSS_WHERES,
  bossPool,
  bossWhere,
  listsBoss,
  pickOne,
  reelOf,
  type BossEntry,
  type BossKind,
  type BossWhere,
} from '@/data/boss-randomizer'
import { loadEnemyData } from '@/data/enemies'
import type { LegendView } from '@/data/local-legends'
import { useResource } from '@/data/use-resource'
import { locale } from '@/i18n/locale'
import { loadGameIcons } from '@/lib/assets'
import { formatNumber } from '@/lib/format'
import { funStateKey } from '@/data/fun-storage'
import { writeJson } from '@/lib/storage'
import { readFunJson } from '../fun-state'
import { useFunHost } from '../host'
import { useBenchDrag } from '../randomizer/bench-drag'
import { play, reducedMotion } from '../randomizer/motion'
import BossStage, { type BossSpin } from './BossStage.vue'
import BossTile from './BossTile.vue'

const EnemyDialog = defineAsyncComponent(() => import('@/components/collections/EnemyDialog.vue'))

/**
 * The boss randomizer (docs/plans/fun.md; the user's pick: design B, "one
 * slot, like the team randomizer"): on top the rolled boss as one big tile a
 * roll runs a reel of pictures through (BossStage), its kind, name and
 * subtitle beside it with "Leave it out" and "Enemy details" (the site's
 * enemy dialog, from game data alone); "Roll a boss" with Undo; then the
 * pool: kind and land / underwater filters, and every boss as a tile where a
 * click, or a drag across several, leaves bosses out. Game data only, so it
 * is the same for every account; what was last set is remembered per device.
 */
const host = useFunHost()
// One per device (data/fun-storage.ts): the public page and every account share it.
const storageKey = funStateKey('boss')

const resource = useResource(
  () => locale.value,
  async (lang) => {
    const [data, english, farming] = await Promise.all([
      loadEnemyData(lang),
      loadEnemyData('en'),
      loadFarming(),
      loadGameIcons(),
    ])
    return { data, pool: bossPool(data.enemies, data.names, english.names, farming.bosses) }
  },
)

interface Saved {
  kinds: BossKind[]
  wheres: BossWhere[]
  benched: string[]
}
function load(): Saved {
  const saved = readFunJson<Partial<Saved>>('boss', host.value.accountId, {})
  const list = <T extends string>(value: unknown, all: readonly T[]) =>
    Array.isArray(value) ? all.filter((v) => value.includes(v)) : []
  return {
    kinds: list(saved.kinds, BOSS_KINDS),
    wheres: list(saved.wheres, BOSS_WHERES),
    benched: Array.isArray(saved.benched) ? saved.benched.filter((k) => typeof k === 'string') : [],
  }
}
const state = reactive<Saved>(load())
watch(state, (value) => writeJson(storageKey, value), { deep: true })

const all = computed(() => resource.data.value?.pool ?? [])
const shown = computed(() => all.value.filter((b) => listsBoss(b, state.kinds, state.wheres)))
const benched = computed(() => new Set(state.benched))
const pool = computed(() => shown.value.filter((b) => !benched.value.has(b.key)))

const kindCounts = computed(() =>
  BOSS_KINDS.map((kind) => ({ kind, n: all.value.filter((b) => b.kind === kind).length })),
)
/** Land / underwater counts follow the kinds picked, as that is what they narrow. */
const whereCounts = computed(() =>
  BOSS_WHERES.map((where) => ({
    where,
    n: all.value.filter((b) => listsBoss(b, state.kinds, []) && bossWhere(b) === where).length,
  })),
)
function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}
function toggleBench(key: string) {
  state.benched = toggle(state.benched, key)
}
function clearFilters() {
  state.kinds = []
  state.wheres = []
}

const grid = ref<HTMLElement | null>(null)
useBenchDrag(grid, {
  keys: () => shown.value.map((b) => b.key),
  benched: () => state.benched,
  set: (keys) => (state.benched = keys),
})

// ------------------------------------------------------------ the roll

const result = ref<string | null>(null)
const history = ref<(string | null)[]>([])
const dice = ref<HTMLElement | null>(null)
const spin = ref<BossSpin | null>(null)
/** While the reel runs: the text, the buttons and the pool's ring wait for it to stop. */
const spinning = ref(false)
let spinId = 0

/** A click while the reel runs rolls again at once (the stage ends the old reel). */
function roll() {
  const picked = pickOne(
    pool.value.length > 1 ? pool.value.filter((b) => b.key !== result.value) : pool.value,
  )
  if (!picked) return
  history.value = [...history.value.slice(-49), result.value]
  result.value = picked.key
  play(dice.value, [{ transform: 'rotate(0)' }, { transform: 'rotate(360deg)' }], 420)
  const through = reducedMotion() ? [] : reelOf(pool.value, picked.key)
  spinning.value = through.length > 0
  spin.value = { id: ++spinId, kind: 'roll', through, duration: BOSS_REEL_MS }
}
function undo() {
  if (!history.value.length) return
  result.value = history.value[history.value.length - 1] ?? null
  history.value = history.value.slice(0, -1)
  spinning.value = false
  spin.value = { id: ++spinId, kind: 'snap', through: [], duration: 0 }
}

const hit = computed(() => all.value.find((b) => b.key === result.value) ?? null)
// The first roll is free and still: the page opens with an answer.
watch(
  () => pool.value.length > 0 && result.value === null,
  (ready) => {
    if (ready) result.value = pickOne(pool.value)?.key ?? null
  },
  { immediate: true },
)

function leaveOut() {
  const key = result.value
  if (key && !benched.value.has(key)) state.benched = [...state.benched, key]
}

// ------------------------------------------------------------ enemy details

/** The site's enemy dialog, opened on the rolled boss (game data only). */
const details = ref<BossEntry | null>(null)
const detailEnemy = computed(() => {
  const boss = details.value
  const data = resource.data.value?.data
  if (!boss || !data || boss.codex == null) return null
  return data.enemies.enemies.find((e) => e.id === boss.codex) ?? null
})
const detailLegend = computed<LegendView | null>(() => {
  const boss = details.value
  const data = resource.data.value?.data
  if (!boss || !data || boss.kind !== 'legend') return null
  const id = Number(boss.key.slice(2))
  const legend = data.enemies.legends.find((l) => l.id === id)
  if (!legend) return null
  const text = data.names.legend(id)
  return {
    id,
    name: text.name || boss.name,
    subtitle: text.subtitle,
    description: text.description,
    members: legend.monsters.map((stats, i) => ({ icon: legend.icons[i] ?? '', stats })),
  }
})
/** A legend fights at the top World Level's level (Lv. 103 at World Level 9); the rest at 90. */
const detailLevel = computed(() => {
  const levels = resource.data.value?.data.enemies.worldLevels ?? []
  return detailLegend.value && levels.length ? localLegendLevel(levels.length, levels) : 90
})
const hasDetails = (boss: BossEntry) => boss.codex != null || boss.kind === 'legend'
</script>

<template>
  <UiError
    v-if="resource.error.value && !resource.data.value"
    :title="$t('fun.boss.loadFailed')"
    :error="resource.error.value"
    @retry="resource.reload()"
  />
  <div v-else-if="!resource.data.value" aria-busy="true" class="flex flex-col gap-4">
    <UiSkeleton class="h-56 w-full" />
    <UiSkeleton class="h-14 w-full" />
    <UiSkeleton class="h-96 w-full" />
  </div>

  <div v-else class="flex min-w-0 flex-col gap-4">
    <!-- The answer -->
    <section
      class="flex min-w-0 flex-col items-center gap-5 rounded-xl border border-border-default bg-surface-raised p-4 shadow-sm sm:flex-row sm:items-center sm:gap-6 sm:p-5"
      :aria-label="$t('fun.boss.rolled')"
    >
      <template v-if="hit">
        <div class="w-[min(12.5rem,70%)] shrink-0 sm:w-[12.5rem]">
          <BossStage :boss="hit" :spin="spin" @start="spinning = true" @end="spinning = false" />
        </div>
        <div
          class="flex w-full min-w-0 flex-1 flex-col items-center gap-2 text-center sm:items-start sm:text-left"
        >
          <!-- Hidden (keeping its height) while the reel runs: the text would give it away. -->
          <div
            class="flex min-w-0 flex-col gap-1 transition-opacity duration-150 motion-reduce:transition-none"
            :class="spinning ? 'opacity-0' : ''"
            :aria-hidden="spinning || undefined"
          >
            <p class="text-xs font-semibold tracking-wider text-text-secondary uppercase">
              {{ $t(`fun.boss.kind.${hit.kind}`) }} · {{ $t(`fun.boss.where.${bossWhere(hit)}`) }}
            </p>
            <p class="text-2xl leading-tight font-bold break-words sm:text-4xl">{{ hit.name }}</p>
            <p v-if="hit.subtitle" class="text-sm text-text-secondary">{{ hit.subtitle }}</p>
          </div>
          <div class="mt-2 flex flex-wrap justify-center gap-2 sm:justify-start">
            <UiButton v-if="hasDetails(hit)" :disabled="spinning" @click="details = hit">
              <Info class="size-4" aria-hidden="true" />
              {{ $t('fun.boss.details') }}
            </UiButton>
            <UiButton
              variant="ghost"
              :disabled="spinning || benched.has(hit.key)"
              @click="leaveOut"
            >
              <Ban class="size-4" aria-hidden="true" />
              {{ $t('fun.boss.leaveOut') }}
            </UiButton>
          </div>
        </div>
      </template>
      <p v-else class="py-10 text-sm text-text-secondary">{{ $t('fun.boss.empty') }}</p>
      <!-- Said once the reel stops. -->
      <p class="sr-only" aria-live="polite">
        {{ hit && !spinning ? $t('fun.boss.announce', { name: hit.name }) : '' }}
      </p>
    </section>

    <!-- Roll -->
    <div class="flex min-w-0 gap-3">
      <button
        type="button"
        class="inline-flex min-h-13 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg bg-accent px-6 text-base font-semibold text-accent-ink shadow-sm transition-[background-color,scale] duration-150 hover:bg-accent-hover active:scale-[0.99] disabled:opacity-50"
        :disabled="!pool.length"
        @click="roll"
      >
        <span ref="dice" class="inline-flex shrink-0" aria-hidden="true"
          ><Dices class="size-5"
        /></span>
        <span class="truncate">{{ $t('fun.boss.roll') }}</span>
      </button>
      <UiButton class="min-h-13!" :disabled="!history.length" @click="undo">
        <Undo2 class="size-4" aria-hidden="true" />
        {{ $t('achievements.undo') }}
      </UiButton>
    </div>

    <!-- The pool -->
    <section
      class="flex min-w-0 flex-col gap-3 rounded-xl border border-border-default bg-surface-raised p-3 shadow-sm sm:p-4"
      :aria-label="$t('fun.randomizer.pool.label')"
    >
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        <div
          class="flex min-w-0 flex-wrap gap-2"
          role="group"
          :aria-label="$t('fun.boss.kindTitle')"
        >
          <FilterChip
            v-for="{ kind, n } in kindCounts"
            :key="kind"
            :pressed="state.kinds.includes(kind)"
            :count="n"
            @toggle="state.kinds = toggle(state.kinds, kind)"
          >
            {{ $t(`fun.boss.kind.${kind}`) }}
          </FilterChip>
        </div>
        <span class="mx-1 h-6 w-px shrink-0 bg-border-strong" aria-hidden="true" />
        <div
          class="flex min-w-0 flex-wrap gap-2"
          role="group"
          :aria-label="$t('fun.boss.whereTitle')"
        >
          <FilterChip
            v-for="{ where, n } in whereCounts"
            :key="where"
            :pressed="state.wheres.includes(where)"
            :count="n"
            @toggle="state.wheres = toggle(state.wheres, where)"
          >
            {{ $t(`fun.boss.where.${where}`) }}
          </FilterChip>
        </div>
        <span class="tabular ml-auto pl-2 text-sm text-text-secondary">
          <i18n-t keypath="fun.randomizer.pool.count" scope="global">
            <template #n
              ><b class="text-base font-semibold text-text-primary">{{
                formatNumber(pool.length)
              }}</b></template
            >
            <template #total>{{ formatNumber(shown.length) }}</template>
          </i18n-t>
        </span>
      </div>

      <UiEmpty v-if="!shown.length" :title="$t('achievements.noMatches')">
        <template #icon><SearchX aria-hidden="true" /></template>
        <UiButton @click="clearFilters">{{ $t('achievements.clear') }}</UiButton>
      </UiEmpty>
      <div
        v-show="shown.length"
        ref="grid"
        class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,5.5rem),1fr))] gap-2 select-none [-webkit-touch-callout:none] sm:grid-cols-[repeat(auto-fill,minmax(min(100%,7.5rem),1fr))] sm:gap-2.5"
      >
        <BossTile
          v-for="(boss, index) in shown"
          :key="boss.key"
          :boss="boss"
          :banned="benched.has(boss.key)"
          :hit="boss.key === result && !spinning"
          :priority="index < 24"
          :data-bench-key="boss.key"
          :label="
            $t(
              benched.has(boss.key) ? 'fun.randomizer.pool.unbench' : 'fun.randomizer.pool.bench',
              { name: boss.name },
            )
          "
          @toggle="toggleBench(boss.key)"
        />
      </div>
      <p v-if="shown.length" class="text-xs text-text-muted">{{ $t('fun.boss.hint') }}</p>
    </section>

    <EnemyDialog
      v-if="details && (detailEnemy || detailLegend)"
      :enemy="detailEnemy"
      :legend="detailLegend"
      :data="resource.data.value.data"
      :level="detailLevel"
      @close="details = null"
    />
  </div>
</template>
