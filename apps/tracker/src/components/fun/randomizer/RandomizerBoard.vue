<script setup lang="ts">
import { computed, reactive, ref, shallowRef, watch } from 'vue'
import { CHARACTER_KEYS, characterInfo } from '@gdt/game-data/catalog'
import { Dices, RefreshCw, SearchX, SlidersHorizontal, Undo2 } from 'lucide-vue-next'
import { useCollectionCatalog } from '@/components/collections/use-catalog'
import ElementIcon from '@/components/ui/ElementIcon.vue'
import FilterChip from '@/components/ui/FilterChip.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import UiError from '@/components/ui/UiError.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiPopover from '@/components/ui/UiPopover.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import UiSwitch from '@/components/ui/UiSwitch.vue'
import { ELEMENTS, ELEMENT_LABELS, WEAPON_TYPES, WEAPON_TYPE_LABELS } from '@/data/characters'
import { toElement } from '@/data/game-meta'
import { loadReleaseDates, releasedKeys } from '@/data/release-dates'
import {
  DEFAULT_RULES,
  NO_FILTERS,
  TEAM_COUNT,
  TEAM_SIZE,
  buildPool,
  emptySlots,
  fillTeams,
  hasFilters,
  passes,
  withoutSlot,
  withoutTeam,
  type CharacterFacts,
  type OwnedCharacter,
  type PoolFilters,
  type PoolMode,
  type RollFailure,
  type Rules,
  type Slots,
} from '@/data/team-randomizer'
import { useResource } from '@/data/use-resource'
import { t } from '@/i18n'
import { characterName } from '@/i18n/game-names'
import { characterIcon } from '@/lib/assets'
import { formatNumber } from '@/lib/format'
import { readJson, writeJson } from '@/lib/storage'
import CharacterTile from './CharacterTile.vue'
import { useBenchDrag } from './bench-drag'
import FilterMenu from './FilterMenu.vue'
import SlotReel from './SlotReel.vue'
import { passersBy, play, reducedMotion, spinDuration, type Spin } from './motion'

/**
 * The team randomizer (design A of docs/plans/fun.md, as the user trimmed
 * it): two teams of four on top (tap a tile to lock it, reroll one slot or
 * one team), "Roll teams" with Undo, then the pool: the account's own
 * characters or every released one, the filters, the rules, and the roster
 * as a grid where a tap leaves a character out. It only rolls characters:
 * no team count, presets or sharing. A roll spins the slots it changes
 * (SlotReel); a click while they spin rolls again at once. Everything runs in the browser; what
 * was last set is remembered per device.
 */
const props = withDefaults(
  defineProps<{
    /** The account's characters; empty where there is no account (the public page). */
    owned?: readonly OwnedCharacter[]
    /** Where what was last set is remembered on this device. */
    storageKey: string
    /** "All released" lists what is out by now (ms): time travel's capture, else the clock. */
    at: number
  }>(),
  { owned: () => [] },
)

/** The game data's facts of a character. */
function facts(key: string): CharacterFacts | undefined {
  const info = characterInfo(key)
  return info && { ...info, element: toElement(info.element) }
}

// ------------------------------------------------------------ remembered state

interface Saved {
  mode: PoolMode
  filters: PoolFilters
  rules: Rules
  benched: string[]
}
function load(): Saved {
  const saved = readJson<Partial<Saved>>(props.storageKey, {})
  return {
    mode: saved.mode === 'all' ? 'all' : 'mine',
    filters: { ...NO_FILTERS, ...saved.filters },
    rules: { ...DEFAULT_RULES, ...saved.rules },
    benched: Array.isArray(saved.benched) ? saved.benched : [],
  }
}
const state = reactive<Saved>(load())
watch(state, (value) => writeJson(props.storageKey, value), { deep: true })

// ------------------------------------------------------------ the pool

/** Without a roster there is nothing of "mine" to roll from. */
const mode = computed<PoolMode>(() => (props.owned.length ? state.mode : 'all'))
const modeOptions = computed(() => [
  { value: 'mine' as const, label: t('fun.randomizer.pool.mine') },
  { value: 'all' as const, label: t('fun.randomizer.pool.all') },
])
// The game data may know a character before its first banner opens
// (a version's second phase): only those out by `at` are in the pool.
const releases = useResource(
  () => 0,
  () => loadReleaseDates(),
)
const released = computed(() =>
  releases.data.value ? releasedKeys(CHARACTER_KEYS, releases.data.value, props.at) : [],
)
const everyone = computed(
  () =>
    new Map(
      buildPool('all', props.owned, released.value, facts, characterName).map((c) => [c.key, c]),
    ),
)
const listed = computed(() =>
  buildPool(mode.value, props.owned, released.value, facts, characterName),
)
const shown = computed(() => listed.value.filter((c) => passes(c, state.filters)))
const benched = computed(() => new Set(state.benched))
const pool = computed(() => shown.value.filter((c) => !benched.value.has(c.key)))

function toggleBench(key: string) {
  state.benched = benched.value.has(key)
    ? state.benched.filter((k) => k !== key)
    : [...state.benched, key]
}
/** Dragging across the tiles benches (or brings back) the run of them. */
const poolGrid = ref<HTMLElement | null>(null)
useBenchDrag(poolGrid, {
  keys: () => shown.value.map((c) => c.key),
  benched: () => state.benched,
  set: (keys) => (state.benched = keys),
})

// ------------------------------------------------------------ filters

const elementCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const c of listed.value) {
    if (c.element) counts.set(c.element, (counts.get(c.element) ?? 0) + 1)
  }
  return counts
})
function toggleElement(element: (typeof ELEMENTS)[number]) {
  const has = state.filters.elements.includes(element)
  state.filters.elements = has
    ? state.filters.elements.filter((e) => e !== element)
    : [...state.filters.elements, element]
}

const weaponOptions = computed(() =>
  WEAPON_TYPES.map((value) => ({ value, label: WEAPON_TYPE_LABELS[value] })),
)
const rarityOptions = [5, 4].map((value) => ({ value, label: `${value}★` }))

/** The regions' names are the game's own (the collections' world topic). */
const world = useCollectionCatalog(() => ['world'])
const regionOptions = computed(() => {
  const catalog = world.data.value
  if (!catalog) return []
  const name = (id: number) => {
    const pick = (texts: typeof catalog.text) =>
      (texts.cities.get(id) as { name?: string } | undefined)?.name ?? ''
    return pick(catalog.text) || pick(catalog.english)
  }
  const ids = [...new Set(listed.value.flatMap((c) => c.region ?? []))].sort((a, b) => a - b)
  return ids.flatMap((value) => (name(value) ? [{ value, label: name(value) }] : []))
})

/** The role tags with a message, in the game data's order; those nobody here has are left out. */
const ROLES = ['healer', 'shielder', 'mainDps', 'subDps', 'support'] as const
const roleOptions = computed(() =>
  ROLES.filter((role) => [...everyone.value.values()].some((c) => c.roles.includes(role))).map(
    (value) => ({ value: value as string, label: t(`fun.randomizer.role.${value}`) }),
  ),
)
const hasBodies = computed(() => [...everyone.value.values()].some((c) => c.body))
const bodyOptions = computed(() =>
  (['tall', 'medium', 'short'] as const).map((value) => ({
    value,
    label: t(`fun.randomizer.body.${value}`),
  })),
)
const genderOptions = computed(() =>
  (['f', 'm'] as const).map((value) => ({ value, label: t(`fun.randomizer.gender.${value}`) })),
)
const levelOptions = computed(() =>
  [90, 80, 70].map((value) => ({
    value,
    label:
      value === 90 ? t('game.levelN', { n: value }) : t('fun.randomizer.levelFrom', { n: value }),
  })),
)
const minLevel = computed({
  get: () => (state.filters.minLevel ? [state.filters.minLevel] : []),
  set: (value: number[]) => (state.filters.minLevel = value[0] ?? 0),
})
function clearFilters() {
  state.filters = { ...NO_FILTERS }
}

// ------------------------------------------------------------ rules

const rulesOpen = ref(false)
const rulesAnchor = ref<HTMLElement | null>(null)
/** The healer rule needs the role tags. */
const canHeal = computed(() => roleOptions.value.some((o) => o.value === 'healer'))
const rules = computed<Rules>(() => ({
  ...state.rules,
  healer: state.rules.healer && canHeal.value,
}))
const rulesOn = computed(() => Object.values(rules.value).filter(Boolean).length)

// ------------------------------------------------------------ the roll

const teams = shallowRef<string[][] | null>(null)
const locks = ref<Slots>(emptySlots())
const history = shallowRef<string[][][]>([])
const failure = ref<RollFailure | null>(null)
const HISTORY = 20

const seed = () => Math.floor(Math.random() * 0x7fffffff)

/** Each slot's animation. */
const spins = ref<(Spin | null)[][]>(emptySlots().map((row) => row.map(() => null)))
const reels = ref<InstanceType<typeof SlotReel>[]>([])
const dice = ref<HTMLElement | null>(null)
let spinId = 0
/** Who may run past: a share of the pool whose portraits are fetched ahead, so none is blank. */
const WARM = 24
const warm = computed(() => passersBy(pool.value, Math.min(WARM, pool.value.length)))
watch(
  warm,
  (list) => {
    if (reducedMotion()) return
    for (const character of list) new Image().src = characterIcon(character.key)
  },
  { immediate: true },
)

function settle() {
  for (const reel of reels.value) reel?.settle()
}

/** Spins (or, for Undo, snaps) the slots `which` picks, one stopping after another. */
function animate(kind: Spin['kind'], which: (team: number, slot: number) => boolean) {
  if (reducedMotion()) return
  let n = 0
  spins.value = spins.value.map((row, team) =>
    row.map((spin, slot) =>
      which(team, slot)
        ? {
            id: ++spinId,
            kind,
            through: kind === 'roll' ? passersBy(warm.value) : [],
            duration: spinDuration(n++),
          }
        : spin,
    ),
  )
}

function apply(
  result: ReturnType<typeof fillTeams>,
  spun: (team: number, slot: number) => boolean = () => false,
) {
  settle()
  if (!result.ok) {
    failure.value = result.reason
    return
  }
  failure.value = null
  const before = teams.value
  if (before && JSON.stringify(before) !== JSON.stringify(result.teams)) {
    history.value = [...history.value.slice(-(HISTORY - 1)), before]
  }
  teams.value = result.teams
  if (before) animate('roll', spun)
}

function roll() {
  // A click while the slots spin rolls again at once (`apply` ends the old spin).
  play(dice.value, [{ transform: 'rotate(0)' }, { transform: 'rotate(360deg)' }], 420)
  apply(
    fillTeams({
      pool: pool.value,
      everyone: everyone.value,
      rules: rules.value,
      kept: locks.value,
      seed: seed(),
    }),
    (team, slot) => !locks.value[team]![slot],
  )
}

function rerollSlot(team: number, slot: number) {
  if (!teams.value) return
  apply(
    fillTeams({
      pool: pool.value,
      everyone: everyone.value,
      rules: rules.value,
      kept: withoutSlot(teams.value, team, slot),
      seed: seed(),
      avoid: new Set([teams.value[team]![slot]!]),
    }),
    (t, s) => t === team && s === slot,
  )
}

function rerollTeam(team: number) {
  if (!teams.value) return
  const kept = locks.value[team]!
  apply(
    fillTeams({
      pool: pool.value,
      everyone: everyone.value,
      rules: rules.value,
      kept: withoutTeam(teams.value, team, locks.value),
      seed: seed(),
      avoid: new Set(teams.value[team]!.filter((key) => !kept.includes(key))),
    }),
    (t, s) => t === team && !locks.value[t]![s],
  )
}

function toggleLock(team: number, slot: number) {
  if (!teams.value) return
  settle()
  const next = locks.value.map((row) => [...row])
  next[team]![slot] = next[team]![slot] ? null : teams.value[team]![slot]!
  locks.value = next
}

function undo() {
  const last = history.value.at(-1)
  if (!last) return
  settle()
  const now = teams.value
  history.value = history.value.slice(0, -1)
  teams.value = last
  animate('snap', (team, slot) => now?.[team]?.[slot] !== last[team]![slot])
  failure.value = null
  // A lock holds only while its character is still in its slot.
  locks.value = locks.value.map((row, t) => row.map((key, s) => (last[t]![s] === key ? key : null)))
}

// What failed may work now that the pool or the rules changed.
watch([pool, rules, locks], () => (failure.value = null))

// The page opens on a roll (still: only a click spins), once there is a pool to roll from.
watch(
  () => releases.data.value !== undefined && pool.value.length >= TEAM_COUNT * TEAM_SIZE,
  (ready) => {
    if (ready && !teams.value) roll()
  },
  { immediate: true },
)

const slots = computed(() =>
  Array.from({ length: TEAM_COUNT }, (_, team) =>
    Array.from({ length: TEAM_SIZE }, (_, slot) => {
      const key = teams.value?.[team]?.[slot]
      const character = key ? (everyone.value.get(key) ?? null) : null
      return { character, locked: !!key && locks.value[team]![slot] === key }
    }),
  ),
)
</script>

<template>
  <UiError
    v-if="releases.error.value && !releases.data.value"
    :title="$t('fun.randomizer.loadFailed')"
    :error="releases.error.value"
    @retry="releases.reload()"
  />
  <div v-else-if="!releases.data.value" aria-busy="true" class="flex flex-col gap-4">
    <div class="grid gap-3 lg:grid-cols-2">
      <UiSkeleton v-for="n in TEAM_COUNT" :key="n" class="h-56" />
    </div>
    <UiSkeleton class="h-14 w-full" />
    <UiSkeleton class="h-96 w-full" />
  </div>

  <div v-else class="flex min-w-0 flex-col gap-4">
    <!-- The teams -->
    <div class="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[repeat(2,minmax(0,1fr))]">
      <section
        v-for="(team, t) in slots"
        :key="t"
        class="flex min-w-0 flex-col gap-2 rounded-xl border border-border-default bg-surface-raised p-3 shadow-sm"
        :aria-label="$t('characters.team.unnamed', { n: t + 1 })"
      >
        <div class="flex items-center gap-2">
          <h3 class="min-w-0 flex-1 truncate font-semibold">
            {{ $t('characters.team.unnamed', { n: t + 1 }) }}
          </h3>
          <UiIconButton
            :label="$t('fun.randomizer.rerollTeam')"
            :disabled="!teams || team.every((slot) => slot.locked)"
            class="disabled:pointer-events-none disabled:opacity-40"
            @click="rerollTeam(t)"
          >
            <RefreshCw class="size-5" aria-hidden="true" />
          </UiIconButton>
        </div>
        <div class="grid grid-cols-[repeat(4,minmax(0,1fr))] gap-2">
          <div v-for="(slot, s) in team" :key="s" class="flex min-w-0 flex-col items-center gap-1">
            <template v-if="slot.character">
              <SlotReel ref="reels" :spin="spins[t]![s]!">
                <CharacterTile
                  :character="slot.character"
                  :mark="slot.locked ? 'lock' : null"
                  :selected="slot.locked"
                  :label="
                    $t(slot.locked ? 'fun.randomizer.unlock' : 'fun.randomizer.lock', {
                      name: slot.character.name,
                    })
                  "
                  priority
                  @open="toggleLock(t, s)"
                />
              </SlotReel>
              <UiIconButton
                :label="$t('fun.randomizer.reroll', { name: slot.character.name })"
                :disabled="slot.locked"
                class="disabled:pointer-events-none disabled:opacity-40"
                @click="rerollSlot(t, s)"
              >
                <RefreshCw class="size-4" aria-hidden="true" />
              </UiIconButton>
            </template>
            <span
              v-else
              class="aspect-[80/98] w-full rounded-lg border border-dashed border-border-strong"
              aria-hidden="true"
            />
          </div>
        </div>
      </section>
    </div>

    <p
      v-if="failure"
      role="status"
      class="rounded-lg border border-border-default bg-surface-raised px-4 py-3 text-sm font-medium text-warning-text"
    >
      {{ $t(`fun.randomizer.failed.${failure}`) }}
    </p>

    <!-- Roll -->
    <div class="flex min-w-0 gap-3">
      <button
        type="button"
        class="inline-flex min-h-13 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg bg-accent px-6 text-base font-semibold text-accent-ink shadow-sm transition-[background-color,scale] duration-150 hover:bg-accent-hover active:scale-[0.99]"
        @click="roll"
      >
        <span ref="dice" class="inline-flex shrink-0" aria-hidden="true"
          ><Dices class="size-5"
        /></span>
        <span class="truncate">{{ $t('fun.randomizer.roll') }}</span>
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
        <UiSegmented
          v-if="owned.length"
          v-model="state.mode"
          :options="modeOptions"
          :label="$t('fun.randomizer.pool.label')"
        />
        <span class="tabular ml-auto text-sm text-text-secondary">
          <i18n-t keypath="fun.randomizer.pool.count" scope="global">
            <template #n
              ><b :key="pool.length" class="count text-base font-semibold text-text-primary">{{
                formatNumber(pool.length)
              }}</b></template
            >
            <template #total>{{ formatNumber(listed.length) }}</template>
          </i18n-t>
        </span>
      </div>

      <div class="flex min-w-0 flex-wrap gap-2" role="group" :aria-label="$t('game.elementTitle')">
        <FilterChip
          v-for="element in ELEMENTS"
          :key="element"
          :pressed="state.filters.elements.includes(element)"
          :count="elementCounts.get(element) ?? 0"
          :title="ELEMENT_LABELS[element]"
          :aria-label="ELEMENT_LABELS[element]"
          @toggle="toggleElement(element)"
        >
          <ElementIcon :element="element" size="lg" decorative />
        </FilterChip>
      </div>

      <div class="flex min-w-0 flex-wrap items-center gap-2">
        <FilterMenu
          v-model="state.filters.weapons"
          :label="$t('game.weaponTypeTitle')"
          :options="weaponOptions"
        />
        <FilterMenu
          v-model="state.filters.rarities"
          :label="$t('game.rarity')"
          :options="rarityOptions"
        />
        <FilterMenu
          v-if="regionOptions.length"
          v-model="state.filters.regions"
          :label="$t('collections.archive.region')"
          :options="regionOptions"
        />
        <FilterMenu
          v-if="roleOptions.length"
          v-model="state.filters.roles"
          :label="$t('fun.randomizer.filter.role')"
          :options="roleOptions"
        />
        <template v-if="hasBodies">
          <FilterMenu
            v-model="state.filters.bodies"
            :label="$t('fun.randomizer.filter.body')"
            :options="bodyOptions"
          />
          <FilterMenu
            v-model="state.filters.genders"
            :label="$t('fun.randomizer.filter.gender')"
            :options="genderOptions"
          />
        </template>
        <FilterMenu
          v-if="owned.length"
          v-model="minLevel"
          :label="$t('characters.sort.level')"
          :options="levelOptions"
          single
        />

        <span ref="rulesAnchor" class="inline-flex">
          <button
            type="button"
            class="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium whitespace-nowrap transition-colors"
            :class="
              rulesOn
                ? 'border-accent-text bg-surface-overlay text-accent-text'
                : 'border-border-default bg-surface-raised text-text-secondary hover:bg-surface-overlay hover:text-text-primary'
            "
            :aria-expanded="rulesOpen"
            aria-haspopup="dialog"
            @click="rulesOpen = !rulesOpen"
          >
            <SlidersHorizontal class="size-4" aria-hidden="true" />
            {{ $t('fun.randomizer.rules.title') }}
            <span v-if="rulesOn" class="tabular font-mono">{{ rulesOn }}</span>
          </button>
        </span>
        <UiPopover
          :open="rulesOpen"
          :anchor="rulesAnchor"
          :label="$t('fun.randomizer.rules.title')"
          @close="rulesOpen = false"
        >
          <div class="flex w-full min-w-64 flex-col px-4 py-2">
            <UiSwitch
              v-model="state.rules.noRepeats"
              :label="$t('fun.randomizer.rules.noRepeats')"
            />
            <UiSwitch
              v-if="canHeal"
              v-model="state.rules.healer"
              :label="$t('fun.randomizer.rules.healer')"
            />
            <UiSwitch v-model="state.rules.elements" :label="$t('fun.randomizer.rules.elements')" />
            <UiSwitch
              v-model="state.rules.fiveStars"
              :label="$t('fun.randomizer.rules.fiveStars')"
            />
          </div>
        </UiPopover>
      </div>

      <hr class="border-border-default" />

      <UiEmpty v-if="!shown.length" :title="$t('achievements.noMatches')">
        <template #icon><SearchX aria-hidden="true" /></template>
        <UiButton v-if="hasFilters(state.filters)" @click="clearFilters">
          {{ $t('achievements.clear') }}
        </UiButton>
      </UiEmpty>
      <div
        v-show="shown.length"
        ref="poolGrid"
        class="grid select-none [-webkit-touch-callout:none] grid-cols-[repeat(auto-fill,minmax(min(100%,4.25rem),1fr))] gap-2 sm:grid-cols-[repeat(auto-fill,minmax(min(100%,5.25rem),1fr))] sm:gap-2.5"
      >
        <CharacterTile
          v-for="(character, index) in shown"
          :key="character.key"
          class="arrive"
          :character="character"
          :mark="benched.has(character.key) ? 'ban' : null"
          :priority="index < 24"
          :data-bench-key="character.key"
          :label="
            $t(
              benched.has(character.key)
                ? 'fun.randomizer.pool.unbench'
                : 'fun.randomizer.pool.bench',
              { name: character.name },
            )
          "
          @open="toggleBench(character.key)"
        />
      </div>
    </section>
  </div>
</template>

<style scoped>
/* A filter brings tiles in, and the pool's count answers it. */
@media (prefers-reduced-motion: no-preference) {
  .arrive {
    animation: arrive 180ms ease-out;
  }
  .count {
    display: inline-block;
    animation: arrive 180ms ease-out;
  }
}
@keyframes arrive {
  from {
    opacity: 0;
    transform: scale(0.92);
  }
}
</style>
