<script setup lang="ts">
import { computed, reactive, ref, watch, type Component } from 'vue'
import {
  Ban,
  Footprints,
  Heart,
  Layers,
  Lock,
  Minus,
  Plus,
  RefreshCw,
  Repeat,
  SearchX,
  Shield,
  Sparkles,
  Sword,
  Timer,
  Undo2,
  Users,
  Utensils,
} from 'lucide-vue-next'
import FilterChip from '@/components/ui/FilterChip.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import {
  CARD_CATEGORIES,
  CHALLENGE_CARDS,
  HARDEST,
  PLAIN_LEVELS,
  PLAY_MODES,
  drawable,
  drawAround,
  drawCards,
  listsCard,
  type CardCategory,
  type CardLevel,
  type ChallengeCard,
  type PlayMode,
} from '@/data/challenge-cards'
import { t } from '@/i18n'
import { formatNumber } from '@/lib/format'
import { funStateKey } from '@/data/fun-storage'
import { writeJson } from '@/lib/storage'
import { readFunJson } from '../fun-state'
import { useFunHost } from '../host'
import { useBenchDrag } from '../randomizer/bench-drag'
import { POP, SNAP, play } from '../randomizer/motion'
import LevelMark from './LevelMark.vue'

/**
 * Challenge cards (docs/plans/fun.md; the user's pick: designs A and B in
 * one): the drawn cards large on top (a click locks a card: the next draw
 * keeps it, like a locked slot of the team randomizer), a − / + count and "Draw cards" with
 * Undo, then the whole deck: solo or co-op (each shows the cards that work
 * that way), time trials on or off, difficulty (the hardest cards, Ⓜ️, only
 * when their chip is on), and every card as a tile where a click, or a drag
 * across several, takes cards out. The deck is browsed by category (design
 * board E of https://claude.ai/artifact/Q2kqTAaBqDd5xPwhrC4eD5: a list at
 * the side from lg, a row of chips below), each with "All in" / "All out";
 * the category open only says which tiles are listed, a draw always takes
 * from every card still in the deck. What was last set is remembered per
 * device.
 */
const ICONS: Record<ChallengeCard['icon'], Component> = {
  ban: Ban,
  sword: Sword,
  heart: Heart,
  food: Utensils,
  element: Sparkles,
  walk: Footprints,
  swap: Repeat,
  shield: Shield,
  clock: Timer,
  team: Users,
}

const host = useFunHost()
// One per device (data/fun-storage.ts): the public page and every account share it.
const storageKey = funStateKey('cards')

interface Saved {
  mode: PlayMode
  timed: boolean
  levels: CardLevel[]
  hardest: boolean
  tab: Tab
  out: string[]
  count: number
}
type Tab = 'all' | CardCategory
function load(): Saved {
  const saved = readFunJson<Partial<Saved>>('cards', host.value.accountId, {})
  return {
    mode: saved.mode === 'coop' ? 'coop' : 'solo',
    timed: saved.timed !== false,
    levels: Array.isArray(saved.levels)
      ? PLAIN_LEVELS.filter((l) => saved.levels!.includes(l))
      : [],
    hardest: saved.hardest === true,
    tab: CARD_CATEGORIES.find((c) => c === saved.tab) ?? 'all',
    out: Array.isArray(saved.out) ? saved.out.filter((id) => typeof id === 'string') : [],
    count: Number.isInteger(saved.count) && saved.count! > 0 ? saved.count! : 3,
  }
}
const state = reactive<Saved>(load())
watch(state, (value) => writeJson(storageKey, value), { deep: true })

const shown = computed(() => CHALLENGE_CARDS.filter((c) => listsCard(c, state)))
const out = computed(() => new Set(state.out))
const deck = computed(() => shown.value.filter((c) => !out.value.has(c.id)))
const count = computed(() => Math.max(1, Math.min(state.count, drawable(deck.value) || 1)))

const modeOptions = computed(() =>
  PLAY_MODES.map((mode) => ({ value: mode, label: t(`fun.cards.mode.${mode}`) })),
)
const timedCount = CHALLENGE_CARDS.filter((c) => c.timed).length

/** The categories the way of playing has cards for, with what is left in. */
const categories = computed(() => {
  const playable = CHALLENGE_CARDS.filter((c) => c.mode === 'both' || c.mode === state.mode)
  const row = (id: Tab, cards: readonly ChallengeCard[]) => ({
    id,
    total: cards.length,
    left: cards.filter((c) => !out.value.has(c.id)).length,
  })
  return [
    row('all', shown.value),
    ...CARD_CATEGORIES.filter((id) => playable.some((c) => c.category === id)).map((id) =>
      row(
        id,
        shown.value.filter((c) => c.category === id),
      ),
    ),
  ]
})
/** The category open: one the way of playing has, else all. */
const tab = computed<Tab>(() =>
  categories.value.some((c) => c.id === state.tab) ? state.tab : 'all',
)
const open = computed(() => categories.value.find((c) => c.id === tab.value)!)
/** The tiles listed: the deck's cards of the category open. */
const listed = computed(() =>
  tab.value === 'all' ? shown.value : shown.value.filter((c) => c.category === tab.value),
)
function setAll(inDeck: boolean) {
  const ids = new Set(listed.value.map((c) => c.id))
  const rest = state.out.filter((id) => !ids.has(id))
  state.out = inDeck ? rest : [...rest, ...ids]
}
function toggleLevel(level: CardLevel) {
  state.levels = state.levels.includes(level)
    ? state.levels.filter((l) => l !== level)
    : [...state.levels, level]
}
function toggleOut(id: string) {
  state.out = out.value.has(id) ? state.out.filter((k) => k !== id) : [...state.out, id]
}
function clearFilters() {
  state.levels = []
  state.timed = true
  state.tab = 'all'
}

const grid = ref<HTMLElement | null>(null)
useBenchDrag(grid, {
  keys: () => listed.value.map((c) => c.id),
  benched: () => state.out,
  set: (ids) => (state.out = ids),
})

// ------------------------------------------------------------ the draw

const drawn = ref<string[]>([])
const history = ref<string[][]>([])
const table = ref<HTMLElement | null>(null)
const icon = ref<HTMLElement | null>(null)

const byId = new Map(CHALLENGE_CARDS.map((c) => [c.id, c]))
const hand = computed(() => drawn.value.map((id) => byId.get(id)).filter((c) => !!c))
const inHand = computed(() => new Set(drawn.value))
/** The cards a draw keeps (ids); only cards on the table. */
const locked = ref<ReadonlySet<string>>(new Set())
function toggleLock(id: string) {
  const next = new Set(locked.value)
  if (!next.delete(id)) next.add(id)
  locked.value = next
}

function show(ids: string[], changed: (index: number) => boolean) {
  history.value = [...history.value.slice(-49), drawn.value]
  drawn.value = ids
  requestAnimationFrame(() => {
    table.value?.querySelectorAll('[data-card]').forEach((el, i) => {
      if (changed(i)) play(el, SNAP, 220 + i * 40)
    })
  })
}
function draw() {
  play(icon.value, POP, 200)
  const before = drawn.value
  const next = drawAround(deck.value, hand.value, locked.value, count.value).map((c) => c.id)
  locked.value = new Set(next.filter((id) => locked.value.has(id)))
  show(next, (i) => next[i] !== before[i])
}
/** Another card in one place, never one already on the table. */
function redraw(index: number) {
  const rest = deck.value.filter((c) => !inHand.value.has(c.id))
  // The cards that stay: the one replaced frees its group.
  const staying = drawn.value
    .filter((_, i) => i !== index)
    .map((id) => CHALLENGE_CARDS.find((c) => c.id === id))
    .filter((c) => !!c)
  const next = drawCards(rest, 1, Math.random, staying)[0]
  if (!next) return
  show(
    drawn.value.map((id, i) => (i === index ? next.id : id)),
    (i) => i === index,
  )
}
function undo() {
  const last = history.value[history.value.length - 1]
  if (!last) return
  drawn.value = last
  history.value = history.value.slice(0, -1)
  // A lock holds only while its card is on the table.
  locked.value = new Set(last.filter((id) => locked.value.has(id)))
}
// The page opens with cards on the table.
if (deck.value.length) drawn.value = drawCards(deck.value, count.value).map((c) => c.id)

function tags(c: ChallengeCard): string[] {
  return [
    c.mode === 'solo' ? t('fun.cards.soloOnly') : c.mode === 'coop' ? t('fun.cards.coopOnly') : '',
    c.timed ? t('fun.cards.timeTrial') : '',
  ].filter(Boolean)
}
</script>

<template>
  <div class="flex min-w-0 flex-col gap-4">
    <!-- The cards drawn -->
    <div
      ref="table"
      class="grid min-h-64 grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),17rem))] justify-center gap-3 sm:gap-4"
      aria-live="polite"
    >
      <section
        v-for="(c, index) in hand"
        :key="`${index}:${c.id}`"
        data-card
        class="relative flex min-h-60 min-w-0 flex-col gap-2 rounded-2xl border-2 bg-surface-raised p-4 shadow-sm transition-[border-color,box-shadow] duration-150 hover:bg-surface-overlay motion-reduce:transition-none"
        :class="
          locked.has(c.id) ? 'border-accent-text ring-2 ring-accent-text' : 'border-border-strong'
        "
        :aria-label="$t(`fun.cards.list.${c.id}.title`)"
      >
        <!-- The whole card locks it; the redraw button sits above this. -->
        <button
          type="button"
          class="absolute inset-0 rounded-[inherit]"
          :aria-pressed="locked.has(c.id)"
          :aria-label="
            $t(locked.has(c.id) ? 'fun.randomizer.unlock' : 'fun.randomizer.lock', {
              name: $t(`fun.cards.list.${c.id}.title`),
            })
          "
          :title="
            $t(locked.has(c.id) ? 'fun.randomizer.unlock' : 'fun.randomizer.lock', {
              name: $t(`fun.cards.list.${c.id}.title`),
            })
          "
          @click="toggleLock(c.id)"
        />
        <div class="flex items-center gap-2">
          <span
            class="inline-flex min-h-6 items-center gap-1.5 text-xs font-semibold text-text-secondary"
            :title="c.level === HARDEST ? $t('fun.cards.hardestHint') : undefined"
          >
            <LevelMark :level="c.level" large />
            <template v-if="c.level !== HARDEST">{{ $t(`fun.cards.level.${c.level}`) }}</template>
            <span v-else class="sr-only">{{ $t('fun.cards.hardestHint') }}</span>
          </span>
          <span
            v-if="locked.has(c.id)"
            class="ml-auto grid size-6 place-items-center rounded bg-accent text-accent-ink"
            aria-hidden="true"
          >
            <Lock class="size-3.5" stroke-width="2.6" />
          </span>
          <UiIconButton
            class="relative -my-2 -mr-2"
            :class="locked.has(c.id) ? '' : 'ml-auto'"
            :label="$t('fun.cards.redraw')"
            :disabled="locked.has(c.id)"
            @click="redraw(index)"
          >
            <RefreshCw class="size-4" aria-hidden="true" />
          </UiIconButton>
        </div>
        <component
          :is="ICONS[c.icon]"
          class="size-12 text-text-muted"
          stroke-width="1.4"
          aria-hidden="true"
        />
        <!-- Two lines kept for the title, so the texts under it start level across the cards. -->
        <p class="mt-1 min-h-[2lh] text-xl leading-tight font-bold break-words">
          {{ $t(`fun.cards.list.${c.id}.title`) }}
        </p>
        <p class="text-sm text-text-secondary">{{ $t(`fun.cards.list.${c.id}.text`) }}</p>
        <div v-if="tags(c).length" class="flex flex-wrap gap-1.5">
          <span
            v-for="tag in tags(c)"
            :key="tag"
            class="rounded border border-border-strong px-1.5 py-px text-xs font-semibold text-text-secondary"
            >{{ tag }}</span
          >
        </div>
      </section>
      <p v-if="!hand.length" class="self-center text-center text-sm text-text-secondary">
        {{ $t('fun.cards.empty') }}
      </p>
    </div>

    <!-- Draw -->
    <div class="flex min-w-0 flex-wrap gap-3">
      <div
        class="inline-flex min-h-13 shrink-0 items-center rounded-lg border border-border-default bg-surface-raised px-1 shadow-sm"
        role="group"
        :aria-label="$t('fun.cards.count')"
      >
        <UiIconButton
          :label="$t('fun.cards.fewer')"
          :disabled="count <= 1"
          @click="state.count = count - 1"
        >
          <Minus class="size-4" aria-hidden="true" />
        </UiIconButton>
        <b class="tabular min-w-9 text-center text-base">{{ formatNumber(count) }}</b>
        <UiIconButton
          :label="$t('fun.cards.more')"
          :disabled="count >= drawable(deck)"
          @click="state.count = count + 1"
        >
          <Plus class="size-4" aria-hidden="true" />
        </UiIconButton>
      </div>
      <button
        type="button"
        class="inline-flex min-h-13 min-w-0 flex-[1_1_12rem] items-center justify-center gap-2 rounded-lg bg-accent px-6 text-base font-semibold text-accent-ink shadow-sm transition-[background-color,scale] duration-150 hover:bg-accent-hover active:scale-[0.99] disabled:opacity-50"
        :disabled="!deck.length"
        @click="draw"
      >
        <span ref="icon" class="inline-flex shrink-0" aria-hidden="true"
          ><Layers class="size-5"
        /></span>
        <span class="truncate">{{ $t('fun.cards.draw') }}</span>
      </button>
      <UiButton class="min-h-13!" :disabled="!history.length" @click="undo">
        <Undo2 class="size-4" aria-hidden="true" />
        {{ $t('achievements.undo') }}
      </UiButton>
    </div>

    <!-- The deck -->
    <section
      class="flex min-w-0 flex-col gap-3 rounded-xl border border-border-default bg-surface-raised p-3 shadow-sm sm:p-4"
      :aria-label="$t('fun.cards.deck')"
    >
      <div class="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        <UiSegmented
          v-model="state.mode"
          :options="modeOptions"
          :label="$t('fun.cards.modeTitle')"
        />
        <span class="tabular ml-auto text-sm text-text-secondary">
          <i18n-t keypath="fun.cards.deckCount" scope="global">
            <template #n
              ><b class="text-base font-semibold text-text-primary">{{
                formatNumber(deck.length)
              }}</b></template
            >
            <template #total>{{ formatNumber(shown.length) }}</template>
          </i18n-t>
        </span>
      </div>
      <div class="flex min-w-0 flex-wrap gap-2">
        <FilterChip
          :pressed="state.timed"
          :count="timedCount"
          :title="$t('fun.cards.timeTrialsHint')"
          @toggle="state.timed = !state.timed"
        >
          <Timer class="size-4" aria-hidden="true" />
          {{ $t('fun.cards.timeTrials') }}
        </FilterChip>
        <FilterChip
          v-for="level in PLAIN_LEVELS"
          :key="level"
          :pressed="state.levels.includes(level)"
          @toggle="toggleLevel(level)"
        >
          <LevelMark :level="level" />
          {{ $t(`fun.cards.level.${level}`) }}
        </FilterChip>
        <FilterChip
          :pressed="state.hardest"
          :title="$t('fun.cards.hardestHint')"
          :aria-label="$t('fun.cards.hardestHint')"
          @toggle="state.hardest = !state.hardest"
        >
          <LevelMark :level="HARDEST" />
        </FilterChip>
      </div>

      <hr class="border-border-default" />

      <div class="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:gap-4">
        <!-- Categories: a list at the side from lg, a row that scrolls sideways below. -->
        <nav
          class="scroll-hide scroll-fade-x -mx-3 flex min-w-0 gap-1.5 overflow-x-auto px-3 sm:-mx-4 sm:px-4 lg:mx-0 lg:w-52 lg:shrink-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-0"
          :aria-label="$t('fun.cards.categoryTitle')"
        >
          <button
            v-for="cat in categories"
            :key="cat.id"
            type="button"
            :aria-current="cat.id === tab ? 'true' : undefined"
            class="category inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm whitespace-nowrap transition-colors duration-150 lg:rounded-md lg:border-0 lg:text-base"
            :class="
              cat.id === tab
                ? 'border-accent-text bg-surface-overlay font-bold text-text-primary'
                : 'border-border-default text-text-secondary hover:bg-surface-overlay hover:text-text-primary'
            "
            @click="state.tab = cat.id"
          >
            <span :class="cat.total && !cat.left ? 'line-through' : ''">{{
              $t(`fun.cards.category.${cat.id}`)
            }}</span>
            <span class="tabular text-xs text-text-secondary lg:ml-auto lg:text-sm"
              >{{ formatNumber(cat.left) }} / {{ formatNumber(cat.total) }}</span
            >
          </button>
        </nav>

        <div class="flex min-w-0 flex-1 flex-col gap-2.5">
          <div class="flex min-w-0 flex-wrap items-center gap-2">
            <h3 class="hidden text-base font-bold lg:block">
              {{ $t(`fun.cards.category.${tab}`) }}
            </h3>
            <span class="tabular mr-auto text-sm text-text-secondary">{{
              $t('fun.cards.inCount', {
                n: formatNumber(open.left),
                total: formatNumber(open.total),
              })
            }}</span>
            <UiButton :disabled="open.left === open.total" @click="setAll(true)">{{
              $t('fun.cards.allIn')
            }}</UiButton>
            <UiButton :disabled="!open.left" @click="setAll(false)">{{
              $t('fun.cards.allOut')
            }}</UiButton>
          </div>
          <UiEmpty v-if="!listed.length" :title="$t('achievements.noMatches')">
            <template #icon><SearchX aria-hidden="true" /></template>
            <UiButton @click="clearFilters">{{ $t('achievements.clear') }}</UiButton>
          </UiEmpty>
          <div
            v-show="listed.length"
            ref="grid"
            class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,10.5rem),1fr))] gap-2 select-none [-webkit-touch-callout:none] sm:gap-2.5"
          >
            <button
              v-for="c in listed"
              :key="c.id"
              type="button"
              :data-bench-key="c.id"
              :aria-pressed="out.has(c.id)"
              :title="
                $t(out.has(c.id) ? 'fun.randomizer.pool.unbench' : 'fun.randomizer.pool.bench', {
                  name: $t(`fun.cards.list.${c.id}.title`),
                })
              "
              class="relative flex min-w-0 flex-col gap-1 rounded-lg border bg-surface-raised p-2.5 text-left transition-[opacity,border-color] duration-150 hover:bg-surface-overlay motion-reduce:transition-none"
              :class="[
                out.has(c.id) ? 'opacity-45' : '',
                inHand.has(c.id)
                  ? 'border-accent-text ring-2 ring-accent-text'
                  : 'border-border-default',
              ]"
              @click="toggleOut(c.id)"
            >
              <span
                class="flex min-h-4 items-center gap-1.5 text-xs font-semibold text-text-secondary"
              >
                <LevelMark :level="c.level" />
                <template v-if="c.level !== HARDEST">{{
                  $t(`fun.cards.level.${c.level}`)
                }}</template>
                <Ban
                  v-if="out.has(c.id)"
                  class="ml-auto size-4"
                  stroke-width="2.6"
                  aria-hidden="true"
                />
              </span>
              <span class="text-sm leading-tight font-semibold break-words">{{
                $t(`fun.cards.list.${c.id}.title`)
              }}</span>
              <span class="text-xs text-text-secondary">{{
                $t(`fun.cards.list.${c.id}.text`)
              }}</span>
              <span v-if="tags(c).length" class="flex flex-wrap gap-1">
                <span
                  v-for="tag in tags(c)"
                  :key="tag"
                  class="rounded border border-border-strong px-1 text-[0.6875rem] font-semibold text-text-secondary"
                  >{{ tag }}</span
                >
              </span>
            </button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* The open category's mark: under the chip on phones, at the list's edge from lg. */
.category[aria-current] {
  box-shadow: inset 0 -3px 0 var(--color-accent-text);
}
@media (min-width: 64rem) {
  .category[aria-current] {
    box-shadow: inset 3px 0 0 var(--color-accent-text);
  }
}
</style>
