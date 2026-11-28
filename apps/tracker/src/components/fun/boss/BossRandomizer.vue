<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { loadFarming } from '@gdt/game-data/farming'
import { Dices, SearchX, Undo2 } from 'lucide-vue-next'
import FilterChip from '@/components/ui/FilterChip.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import UiError from '@/components/ui/UiError.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import {
  BOSS_KINDS,
  BOSS_WHERES,
  bossPool,
  bossWhere,
  listsBoss,
  pickOne,
  type BossKind,
  type BossWhere,
} from '@/data/boss-randomizer'
import { loadEnemyData } from '@/data/enemies'
import { useResource } from '@/data/use-resource'
import { locale } from '@/i18n/locale'
import { gameIcon, loadGameIcons } from '@/lib/assets'
import { formatNumber } from '@/lib/format'
import { funStateKey } from '@/data/fun-storage'
import { writeJson } from '@/lib/storage'
import { readFunJson } from '../fun-state'
import { useFunHost } from '../host'
import { useBenchDrag } from '../randomizer/bench-drag'
import { play, reducedMotion } from '../randomizer/motion'
import BossTile from './BossTile.vue'

/**
 * The boss randomizer (docs/plans/fun.md; the user's pick: design C, made
 * like the team randomizer): the roll's answer on top, "Roll a boss" with
 * Undo, then the pool: kind and land / underwater filters, and every boss as
 * a tile where a click, or a drag across several, leaves bosses out. Game
 * data only, so it is the same for every account; what was last set is
 * remembered per device.
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
    return bossPool(data.enemies, data.names, english.names, farming.bosses)
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

const all = computed(() => resource.data.value ?? [])
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
/** The tile the roll is passing over. */
const lit = ref<string | null>(null)
const dice = ref<HTMLElement | null>(null)
const card = ref<HTMLElement | null>(null)
let timer = 0

const STEPS = 9
const STEP_MS = 70

function land(key: string) {
  lit.value = null
  result.value = key
  play(card.value, [{ transform: 'scale(0.97)' }, { transform: 'scale(1)' }], 180)
}

/** A click while the roll runs rolls again at once. */
function roll() {
  window.clearTimeout(timer)
  const picked = pickOne(
    pool.value.length > 1 ? pool.value.filter((b) => b.key !== result.value) : pool.value,
  )
  if (!picked) return
  history.value = [...history.value.slice(-49), result.value]
  play(dice.value, [{ transform: 'rotate(0)' }, { transform: 'rotate(360deg)' }], 420)
  if (reducedMotion() || pool.value.length < 3) return land(picked.key)
  let step = 0
  const tick = () => {
    if (step++ >= STEPS) return land(picked.key)
    lit.value = pickOne(pool.value.filter((b) => b.key !== lit.value))?.key ?? null
    timer = window.setTimeout(tick, STEP_MS + step * 8)
  }
  tick()
}
function undo() {
  if (!history.value.length) return
  window.clearTimeout(timer)
  lit.value = null
  result.value = history.value[history.value.length - 1] ?? null
  history.value = history.value.slice(0, -1)
}
onBeforeUnmount(() => window.clearTimeout(timer))

const hit = computed(() => all.value.find((b) => b.key === result.value) ?? null)
// The first roll is free: the page opens with an answer.
watch(
  () => pool.value.length > 0 && result.value === null,
  (ready) => {
    if (ready) result.value = pickOne(pool.value)?.key ?? null
  },
  { immediate: true },
)
</script>

<template>
  <UiError
    v-if="resource.error.value && !resource.data.value"
    :title="$t('fun.boss.loadFailed')"
    :error="resource.error.value"
    @retry="resource.reload()"
  />
  <div v-else-if="!resource.data.value" aria-busy="true" class="flex flex-col gap-4">
    <UiSkeleton class="h-40 w-full" />
    <UiSkeleton class="h-14 w-full" />
    <UiSkeleton class="h-96 w-full" />
  </div>

  <div v-else class="flex min-w-0 flex-col gap-4">
    <!-- The answer -->
    <section
      ref="card"
      class="flex min-h-36 min-w-0 flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border border-border-default bg-surface-raised p-4 shadow-sm"
      aria-live="polite"
      :aria-label="$t('fun.boss.rolled')"
    >
      <template v-if="hit">
        <span
          class="flex h-28 w-36 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-sunken"
          aria-hidden="true"
        >
          <img
            v-for="(icon, i) in hit.icons.slice(0, 2)"
            :key="`${hit.key}:${i}`"
            :src="gameIcon(icon)"
            alt=""
            class="h-full min-w-0 object-contain"
            :class="hit.icons.length > 1 ? 'w-1/2' : 'w-full'"
          />
        </span>
        <div class="flex min-w-0 flex-[1_1_14rem] flex-col gap-1">
          <p class="text-xs font-semibold tracking-wider text-text-secondary uppercase">
            {{ $t(`fun.boss.kind.${hit.kind}`) }} · {{ $t(`fun.boss.where.${bossWhere(hit)}`) }}
          </p>
          <p class="text-2xl leading-tight font-bold break-words">{{ hit.name }}</p>
          <p v-if="hit.subtitle" class="text-sm text-text-secondary">{{ hit.subtitle }}</p>
        </div>
      </template>
      <p v-else class="text-sm text-text-secondary">{{ $t('fun.boss.empty') }}</p>
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
      <div class="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
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
        <span class="tabular ml-auto text-sm text-text-secondary">
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

      <hr class="border-border-default" />

      <UiEmpty v-if="!shown.length" :title="$t('achievements.noMatches')">
        <template #icon><SearchX aria-hidden="true" /></template>
        <UiButton @click="clearFilters">{{ $t('achievements.clear') }}</UiButton>
      </UiEmpty>
      <div
        v-show="shown.length"
        ref="grid"
        class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,6.5rem),1fr))] gap-2 select-none [-webkit-touch-callout:none] sm:grid-cols-[repeat(auto-fill,minmax(min(100%,8rem),1fr))] sm:gap-2.5"
      >
        <BossTile
          v-for="(boss, index) in shown"
          :key="boss.key"
          :boss="boss"
          :banned="benched.has(boss.key)"
          :hit="boss.key === result && lit === null"
          :lit="boss.key === lit"
          :priority="index < 24"
          :data-bench-key="boss.key"
          :label="
            $t(
              benched.has(boss.key) ? 'fun.randomizer.pool.unbench' : 'fun.randomizer.pool.bench',
              {
                name: boss.name,
              },
            )
          "
          @toggle="toggleBench(boss.key)"
        />
      </div>
    </section>
  </div>
</template>
