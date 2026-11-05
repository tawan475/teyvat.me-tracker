<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronRight, Minus, Plus, X } from 'lucide-vue-next'
import { loadEnemyDescription, RES_ELEMENTS, MAX_ENEMY_LEVEL } from '@gdt/game-data/enemies'
import GameText from '@/components/game/GameText.vue'
import ElementIcon from '@/components/ui/ElementIcon.vue'
import GameIcon from '@/components/ui/GameIcon.vue'
import ItemTile from '@/components/ui/ItemTile.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import EnemyExtras from './EnemyExtras.vue'
import type { EnemyData, Enemy } from '@/data/enemies'
import type { LegendView } from '@/data/local-legends'
import { useResource } from '@/data/use-resource'
import { locale } from '@/i18n/locale'
import { formatNumber } from '@/lib/format'
import { readStorage, writeStorage } from '@/lib/storage'
import { gameIcon, loadMaterialIcons, materialIcon } from '@/lib/assets'
import { materialName, materialRarity } from '@/utils/materials'
import { t } from '@/i18n'

/**
 * One Living Beings entry as the game's archive and a monster guide show it:
 * picture, category, name and archive text; the monster's stats at a level
 * (1-200: HP with 1-4 players, ATK, DEF, EM), its RES, special names, what
 * the Adventurer Handbook says it drops, and its variants at the same level.
 * Its versions switch the stats: the open world's, what the Spiral Abyss (and
 * the Theater) and the Stygian Onslaught spawn. Opened from an endgame fight,
 * it starts on that mode's version and shows the HP there: the mode and level,
 * the HP, and how it is made (the version's HP at that level × the bonus),
 * while that version is the one shown (its figures belong to it). Scaling
 * (folded, per device) shows how each stat is made at the level: base × the
 * growth curve's multiplier, and the co-op bonuses.
 * A Local Legend (`legend`) shows its own name, subtitle and text, and the
 * stats of the monster picked among those fought (a pair or trio has a picker).
 *
 * Laid out like the game's item panel (the material dialog's): the picture,
 * name and text on the left, the numbers on the right. HP is one figure with
 * a 1-4 players switch; Scaling writes each stat as base × the level's
 * multiplier = value (then the fight's bonus and co-op), each part linked to
 * the wiki's section on it. RES other than 10% carries an arrow and an
 * outline, not only a colour (the site is colour-blind friendly).
 */
const props = defineProps<{
  enemy: Enemy | null
  data: EnemyData
  /** The level to open at (the chamber, act or difficulty it was clicked in); 90 without one. */
  level?: number
  /** The version to open on (an endgame mode's); the open world's without one. */
  version?: Version
  /** The fight it was opened from: its mode's name and HP (`before`: before the difficulty's bonus). */
  fight?: { hp: number; before: boolean; where: string } | null
  /** A Local Legend in place of an archive entry (`enemy` then stays null). */
  legend?: LegendView | null
}>()
defineEmits<{ close: [] }>()

type Version = 'world' | 'abyss' | 'stygian'
const level = ref(90)
const version = ref<Version>('world')
const has = (v: Version) => v === 'world' || !!props.enemy?.[v]
const member = ref(0)
/** Players in the world (0 = alone): which HP the figures show. */
const players = ref(0)
watch(
  () => [props.enemy?.id ?? props.legend?.id, props.level, props.version] as const,
  ([id]) => {
    if (!id) return
    member.value = 0
    players.value = 0
    level.value = Math.min(Math.max(props.level ?? 90, 1), MAX_ENEMY_LEVEL)
    version.value = props.version && has(props.version) ? props.version : 'world'
  },
  { immediate: true },
)
const versions = computed(() =>
  (['world', 'abyss', 'stygian'] as const).filter(has).map((value) => ({
    value,
    label: value === 'world' ? t('collections.enemies.openWorld') : t(`endgame.modes.${value}`),
    title:
      value === 'abyss' ? `${t('endgame.modes.abyss')} · ${t('endgame.modes.theater')}` : undefined,
  })),
)
/** The chosen version's stats (the open world's when the entry has no such version). */
const current = computed(() => {
  if (props.legend) return props.legend.members[member.value]?.stats ?? null
  const e = props.enemy
  return (version.value !== 'world' ? e?.[version.value] : null) ?? e?.stats ?? null
})
const name = computed(
  () => props.legend?.name ?? (props.enemy ? props.data.names.name(props.enemy.id) : ''),
)
const special = computed(() => (props.enemy ? props.data.names.special(props.enemy.id) : []))
const description = useResource(
  () => (props.enemy ? `${locale.value}|${props.enemy.id}` : ''),
  async (key) => {
    if (!key) return ''
    const [lang, id] = key.split('|') as [typeof locale.value, string]
    return loadEnemyDescription(Number(id), lang)
  },
)
const icons = ref(false)
watch(
  () => props.enemy?.drops.length,
  (n) => {
    if (n && !icons.value) void loadMaterialIcons().then(() => (icons.value = true))
  },
  { immediate: true },
)

const stats = computed(() => {
  const s = current.value
  return s ? props.data.enemies.statsAt(s, level.value) : null
})
/** The version the fight spawns (what it opened on). */
const fightVersion = computed<Version>(() =>
  props.version && has(props.version) ? props.version : 'world',
)
/** The fight's level, the opened version's HP there and the bonus the fight adds on top. */
const fightAt = computed(() => {
  const f = props.fight
  const e = props.enemy
  if (!f?.hp || (!e && !props.legend)) return null
  if (!props.legend && version.value !== fightVersion.value) return null
  const at = Math.min(Math.max(props.level ?? 90, 1), MAX_ENEMY_LEVEL)
  const s = props.legend
    ? current.value
    : ((props.version && props.version !== 'world' ? e![props.version] : null) ?? e!.stats)
  const base = s ? props.data.enemies.statsAt(s, at).hp[0]! : 0
  // A Local Legend's HP is its picked monster's there.
  const hp = props.legend ? base : f.hp
  const bonus = base ? Math.round((hp / base) * 100) / 100 : 0
  return { level: at, base, hp, bonus: !f.before && bonus > 1 ? bonus : 0 }
})
const variants = computed(() =>
  (props.enemy?.variants ?? []).map((v) => {
    const at = props.data.enemies.statsAt(v, level.value)
    return { id: v.monster, hp: whole(at.hp[0]!), atk: whole(at.atk[0]!), def: whole(at.def) }
  }),
)
/** With no archive text, the special names and variants fill the picture's side. */
const loreless = computed(() =>
  props.legend ? !props.legend.description : !description.loading.value && !description.data.value,
)

const playerOptions = computed(() =>
  (stats.value?.hp ?? []).map((_, i) => ({
    value: i,
    label: t('collections.enemies.playersN', { n: i + 1 }),
  })),
)
/** HP with the picked number of players: in the open world, and in the fight. */
const hpNow = computed(() => stats.value?.hp[players.value] ?? stats.value?.hp[0] ?? 0)
const fightHp = computed(() => {
  const f = fightAt.value
  const hp = stats.value?.hp
  if (!f || !hp?.[0]) return 0
  return f.hp * ((hp[players.value] ?? hp[0]) / hp[0])
})
function stepLevel(by: number) {
  level.value = Math.min(Math.max((Number(level.value) || 1) + by, 1), MAX_ENEMY_LEVEL)
}

/** The wiki's page on enemy stats (Fandom), and its sections per part of a sum. */
const WIKI = 'https://genshin-impact.fandom.com/wiki/Enemy/Level_Scaling'
const WIKI_PARTS = {
  hp: ['#Base_HP', '#HP_Level_Multiplier'],
  atk: ['#Base_ATK', '#ATK_Level_Multiplier'],
  def: ['#Base_DEF', '#DEF_Level_Scaling'],
} as const
const times = (n: number) => `×${formatNumber(Math.round(n * 100) / 100)}`
/** How each stat is made at the level: base × its curve's multiplier, and the co-op bonuses. */
const scaling = computed(() => {
  const s = current.value
  const at = stats.value
  if (!s || !at) return null
  const multiplier = (value: number, base: number) => (base ? value / base : 1)
  const coop = (values: number[]) => values.slice(1).map((v) => v / values[0]! - 1)
  return {
    monster: s.monster,
    rows: [
      {
        key: 'hp' as const,
        base: s.hp,
        curve: s.hpCurve,
        by: multiplier(at.hp[0]!, s.hp),
        value: at.hp[0]!,
      },
      {
        key: 'atk' as const,
        base: s.atk,
        curve: s.atkCurve,
        by: multiplier(at.atk[0]!, s.atk),
        value: at.atk[0]!,
      },
      {
        key: 'def' as const,
        base: s.def,
        curve: s.defCurve,
        by: multiplier(at.def, s.def),
        value: at.def,
      },
    ],
    coopHp: coop(at.hp),
    coopAtk: coop(at.atk),
  }
})
const SCALING_KEY = 'collections:enemies:scaling'
const scalingOpen = ref(readStorage(SCALING_KEY) === '1')
function toggleScaling(event: Event) {
  scalingOpen.value = (event.target as HTMLDetailsElement).open
  writeStorage(SCALING_KEY, scalingOpen.value ? '1' : null)
}
const decimal = (n: number) => formatNumber(Math.round(n * 1000) / 1000)

/** Cut to a whole number like the game (Local Legends' HP then reads as the guides give it). */
const whole = (n: number) => formatNumber(Math.floor(n + 1e-6))
const percent = (n: number) => `${Math.round(n * 1000) / 10}%`
/** Most enemies resist everything 10%: higher reads as a resistance, lower as a weak spot. */
const resKind = (n: number) => {
  const p = Math.round(n * 1000)
  return p > 100 ? 'high' : p < 100 ? 'low' : null
}
/** Orange against blue (never red against green), each with its arrow and an outline. */
const RES_LOOK = {
  high: { cell: 'ring-1 ring-warning-text/70', text: 'font-bold text-warning-text', mark: '▲' },
  low: { cell: 'ring-1 ring-accent-text/70', text: 'font-bold text-accent-text', mark: '▼' },
}
const resLook = (n = 0.1) => {
  const k = resKind(n)
  return k ? RES_LOOK[k] : null
}
const resTip = (n = 0.1) => {
  const k = resKind(n)
  return k
    ? t(k === 'high' ? 'collections.enemies.resHigh' : 'collections.enemies.resLow')
    : undefined
}
const RES_LABEL = (key: (typeof RES_ELEMENTS)[number]) =>
  key === 'physical' ? t('collections.enemies.physical') : t(`game.element.${key}`)
/** The tiles beside the HP figure: the base HP joins them when the figure is a fight's. */
const tiles = computed(() => {
  const at = stats.value
  if (!at) return []
  return [
    ...(fightAt.value ? [{ label: t('collections.enemies.hp'), value: hpNow.value }] : []),
    { label: t('collections.enemies.atk'), value: at.atk[0]! },
    { label: t('collections.enemies.def'), value: at.def },
    { label: t('collections.enemies.em'), value: at.em },
  ]
})
/** Co-op as the wiki writes it: each player count's multiplier ("HP 2P ×1.5"). */
const coopChips = computed(() => {
  const s = scaling.value
  if (!s) return []
  const chips = (key: 'hp' | 'atk', bonuses: number[]) =>
    bonuses.some((n) => n > 0)
      ? bonuses.map(
          (n, i) =>
            `${t(`collections.enemies.${key}`)} ${t('collections.enemies.coopX', { n: i + 2, x: times(1 + n).slice(1) })}`,
        )
      : []
  return [...chips('hp', s.coopHp), ...chips('atk', s.coopAtk)]
})
/** One sum's row: stat | base | × | multiplier | = | value. */
const SUM_ROW =
  'grid grid-cols-[2rem_minmax(0,1fr)_0.5rem_minmax(0,1fr)_0.5rem_4.25rem] items-center gap-1 sm:grid-cols-[2.25rem_minmax(0,1fr)_0.75rem_minmax(0,1.3fr)_0.75rem_minmax(0,1fr)] sm:gap-1.5'
</script>

<template>
  <UiModal :open="!!enemy || !!legend" :title="name" size="detail" bare @close="$emit('close')">
    <div v-if="enemy || legend" class="grid lg:grid-cols-[22rem_minmax(0,1fr)]">
      <!-- The game's item panel: picture, name, category, text. From lg the numbers' side
           sets the height and a long text scrolls inside the panel. The numbers' side is never shorter
           than the picture, the name and a few lines of text (wildlife has no numbers). -->
      <div class="lg:relative">
        <aside
          class="flex flex-col border-border-default bg-surface-sunken lg:absolute lg:inset-0 lg:border-r"
        >
          <div
            class="flex h-52 shrink-0 items-center justify-center gap-2 bg-radial-[at_50%_45%] from-accent/25 via-surface-overlay/50 to-surface-sunken sm:h-60 sm:gap-4"
          >
            <template v-if="legend">
              <GameIcon
                v-for="(m, i) in legend.members"
                :key="i"
                :src="gameIcon(m.icon)"
                :name="name"
                size="lg"
                eager
                class="rounded-2xl shadow-lg ring-1 ring-white/15"
                :class="
                  legend.members.length > 2
                    ? '!size-20 sm:!size-24'
                    : legend.members.length > 1
                      ? '!size-24 sm:!size-32'
                      : '!size-36 sm:!size-44'
                "
              />
            </template>
            <GameIcon
              v-else-if="enemy"
              :src="gameIcon(enemy.icon)"
              :name="name"
              size="lg"
              eager
              class="!size-36 rounded-2xl shadow-lg ring-1 ring-white/15 sm:!size-44"
            />
          </div>
          <div
            class="flex shrink-0 items-start gap-2 border-y border-border-default bg-surface-base py-3 pr-2 pl-5"
          >
            <div class="flex min-w-0 flex-1 flex-col gap-1">
              <h2 class="text-xl leading-tight font-bold sm:text-2xl">{{ name }}</h2>
              <p class="text-xs font-semibold tracking-wide text-accent-text uppercase">
                {{
                  legend
                    ? $t('collections.legends.mark')
                    : $t(`collections.enemies.factions.${enemy!.faction}`)
                }}
              </p>
              <p v-if="legend?.subtitle" class="text-sm text-warning-text">
                {{ legend.subtitle }}
              </p>
            </div>
            <UiIconButton :label="$t('ui.close')" class="lg:hidden" @click="$emit('close')">
              <X class="size-5" aria-hidden="true" />
            </UiIconButton>
          </div>
          <div class="flex min-h-0 flex-1 flex-col gap-5 px-5 py-4 lg:overflow-y-auto">
            <GameText
              v-if="legend?.description"
              :text="legend.description"
              class="text-sm leading-relaxed text-text-secondary"
            />
            <GameText
              v-else-if="!legend && description.data.value"
              :text="description.data.value"
              class="text-sm leading-relaxed text-text-secondary"
            />
            <div
              v-else-if="!legend && description.loading.value"
              class="flex flex-col gap-2"
              aria-hidden="true"
            >
              <UiSkeleton class="h-4 w-full" />
              <UiSkeleton class="h-4 w-2/3" />
            </div>
            <EnemyExtras
              v-if="loreless"
              :special="special"
              :variants="variants"
              :shown="current?.monster ?? null"
              :level="level"
            />
          </div>
        </aside>
      </div>

      <section class="flex min-w-0 flex-col gap-4 p-4 sm:p-5 lg:min-h-[30rem] lg:pt-4">
        <!-- Which monster: a Local Legend's member, or the entry's version; close (wide screens) -->
        <div class="flex items-center gap-3">
          <div
            v-if="legend && legend.members.length > 1"
            role="radiogroup"
            :aria-label="$t('collections.legends.member')"
            class="flex flex-wrap gap-1.5"
          >
            <button
              v-for="(m, i) in legend.members"
              :key="i"
              type="button"
              role="radio"
              :aria-checked="member === i"
              :aria-label="$t('collections.legends.memberN', { n: i + 1 })"
              class="flex size-12 items-center justify-center rounded-lg border transition-colors"
              :class="
                member === i
                  ? 'border-accent bg-surface-overlay ring-1 ring-accent'
                  : 'border-border-default bg-surface-raised hover:bg-surface-overlay'
              "
              @click="member = i"
            >
              <GameIcon :src="gameIcon(m.icon)" :name="name" size="md" />
            </button>
          </div>
          <UiSegmented
            v-else-if="!legend && versions.length > 1"
            v-model="version"
            :options="versions"
            :label="$t('collections.enemies.version')"
          />
          <UiIconButton
            :label="$t('ui.close')"
            class="ml-auto self-start max-lg:hidden"
            @click="$emit('close')"
          >
            <X class="size-5" aria-hidden="true" />
          </UiIconButton>
        </div>

        <template v-if="stats">
          <!-- HP: the fight's when opened from one (the base HP then joins the tiles), else this level's -->
          <div
            class="flex flex-col gap-2 rounded-xl border px-4 py-3"
            :class="
              fightAt
                ? 'border-danger-border bg-danger-surface'
                : 'border-border-default bg-surface-sunken'
            "
          >
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="min-w-0 truncate text-sm text-text-secondary">{{
                fightAt
                  ? `${fight!.where} · ${$t('endgame.level', { n: fightAt.level })}`
                  : $t('collections.enemies.hp')
              }}</span>
              <UiSegmented
                v-if="playerOptions.length > 1"
                v-model="players"
                :options="playerOptions"
                :label="$t('collections.enemies.players')"
                compact
              />
            </div>
            <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span
                class="tabular font-mono text-3xl leading-none font-bold text-danger-text sm:text-4xl"
                >♥ {{ whole(fightAt ? fightHp : hpNow) }}</span
              >
              <span
                v-if="fightAt?.bonus"
                class="tabular font-mono text-sm text-text-muted"
                :title="$t('collections.enemies.fightBonusTip', { n: fightAt.level })"
                >{{ whole(fightAt.base) }} × {{ fightAt.bonus }}</span
              >
              <UiBadge v-if="fightAt && fight!.before" :title="$t('endgame.beforeBonusTip')">{{
                $t('endgame.beforeBonus')
              }}</UiBadge>
            </div>
          </div>

          <div class="flex items-center gap-3">
            <label class="flex shrink-0 items-center gap-2 text-sm text-text-secondary">
              {{ $t('collections.enemies.level') }}
              <span class="inline-flex overflow-hidden rounded-lg border border-border-strong">
                <button
                  type="button"
                  class="flex size-9 items-center justify-center bg-surface-overlay text-text-primary hover:bg-surface-raised disabled:opacity-40"
                  :aria-label="$t('collections.enemies.levelDown')"
                  :disabled="level <= 1"
                  @click="stepLevel(-1)"
                >
                  <Minus class="size-4" aria-hidden="true" />
                </button>
                <input
                  v-model.number="level"
                  type="number"
                  :min="1"
                  :max="MAX_ENEMY_LEVEL"
                  class="tabular w-14 bg-surface-raised text-center font-mono font-semibold text-text-primary"
                />
                <button
                  type="button"
                  class="flex size-9 items-center justify-center bg-surface-overlay text-text-primary hover:bg-surface-raised disabled:opacity-40"
                  :aria-label="$t('collections.enemies.levelUp')"
                  :disabled="level >= MAX_ENEMY_LEVEL"
                  @click="stepLevel(1)"
                >
                  <Plus class="size-4" aria-hidden="true" />
                </button>
              </span>
            </label>
            <input
              v-model.number="level"
              type="range"
              :min="1"
              :max="MAX_ENEMY_LEVEL"
              class="min-w-0 flex-1 accent-accent"
              :aria-label="$t('collections.enemies.level')"
            />
          </div>

          <dl class="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(7rem,1fr))]">
            <div
              v-for="tile in tiles"
              :key="tile.label"
              class="flex flex-col gap-0.5 rounded-lg border border-border-default px-3 py-2"
            >
              <dt class="text-xs text-text-muted">{{ tile.label }}</dt>
              <dd class="tabular font-mono text-lg font-semibold">{{ whole(tile.value) }}</dd>
            </div>
          </dl>

          <div class="flex flex-col gap-2">
            <h4 class="text-sm font-semibold text-text-muted">
              {{ $t('collections.enemies.res') }}
            </h4>
            <ul class="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
              <li
                v-for="(key, i) in RES_ELEMENTS"
                :key="key"
                class="flex flex-col items-center gap-1 rounded-lg bg-surface-sunken pt-2 pb-1.5"
                :class="resLook(current?.res[i])?.cell"
                :title="[RES_LABEL(key), resTip(current?.res[i])].filter(Boolean).join('\n')"
              >
                <ElementIcon v-if="key !== 'physical'" :element="key" size="md" decorative />
                <span v-else class="flex h-5 items-center text-[0.6rem] font-bold text-text-muted"
                  >PHY</span
                >
                <span class="sr-only">{{ RES_LABEL(key) }}</span>
                <span
                  class="tabular font-mono text-sm"
                  :class="resLook(current?.res[i])?.text ?? 'text-text-secondary'"
                  ><span v-if="resLook(current?.res[i])" aria-hidden="true">{{
                    resLook(current?.res[i])!.mark
                  }}</span
                  >{{ percent(current?.res[i] ?? 0) }}</span
                >
              </li>
            </ul>
          </div>

          <!-- Scaling: each stat as base × the level's multiplier = value, then the fight and co-op -->
          <details
            v-if="scaling"
            :open="scalingOpen"
            class="group rounded-xl border border-border-default text-sm"
            @toggle="toggleScaling"
          >
            <summary
              class="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-text-secondary hover:text-text-primary"
            >
              <ChevronRight
                class="size-4 shrink-0 transition-transform group-open:rotate-90"
                aria-hidden="true"
              />
              <span class="font-semibold">{{ $t('collections.enemies.scaling') }}</span>
              <span class="tabular ml-auto font-mono text-xs text-text-muted">{{
                $t('collections.enemies.monsterId', { id: scaling.monster })
              }}</span>
            </summary>
            <div class="flex flex-col gap-2.5 border-t border-border-default px-3 py-3 sm:px-4">
              <a
                :href="WIKI"
                target="_blank"
                rel="noopener noreferrer"
                class="self-end text-xs text-accent-text hover:underline"
                >{{ $t('collections.enemies.scalingWiki') }} ↗</a
              >
              <div v-for="row in scaling.rows" :key="row.key" :class="SUM_ROW">
                <span class="text-xs font-semibold text-text-secondary sm:text-sm">{{
                  $t(`collections.enemies.${row.key}`)
                }}</span>
                <span
                  class="flex min-w-0 flex-col rounded-lg bg-surface-sunken px-1.5 py-1.5 sm:px-2"
                >
                  <span class="tabular font-mono text-xs whitespace-nowrap sm:text-sm">{{
                    decimal(row.base)
                  }}</span>
                  <a
                    :href="WIKI + WIKI_PARTS[row.key][0]"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="truncate text-[0.7rem] text-accent-text hover:underline"
                    >{{ $t('collections.enemies.baseLink') }} ↗</a
                  >
                </span>
                <span class="text-center text-text-muted" aria-hidden="true">×</span>
                <span
                  class="flex min-w-0 flex-col rounded-lg bg-surface-sunken px-1.5 py-1.5 sm:px-2"
                >
                  <span class="tabular font-mono text-xs whitespace-nowrap sm:text-sm">{{
                    decimal(row.by)
                  }}</span>
                  <a
                    :href="WIKI + WIKI_PARTS[row.key][1]"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="truncate text-[0.7rem] text-accent-text hover:underline"
                    :title="row.curve || undefined"
                    >{{ $t('collections.enemies.curveLink', { n: level }) }} ↗</a
                  >
                </span>
                <span class="text-center text-text-muted" aria-hidden="true">=</span>
                <span
                  class="tabular text-right font-mono text-xs font-bold whitespace-nowrap sm:text-base"
                  >{{ whole(row.value) }}</span
                >
              </div>
              <div
                v-if="fightAt?.bonus"
                class="border-t border-dashed border-border-default pt-2.5"
                :class="SUM_ROW"
              >
                <span class="text-xs font-semibold text-danger-text sm:text-sm">{{
                  $t('collections.enemies.fight')
                }}</span>
                <span
                  class="flex min-w-0 flex-col rounded-lg bg-surface-sunken px-1.5 py-1.5 sm:px-2"
                >
                  <span class="tabular font-mono text-xs whitespace-nowrap sm:text-sm">{{
                    whole(fightAt.base)
                  }}</span>
                  <span class="truncate text-[0.7rem] text-text-muted">{{
                    $t('collections.enemies.hpAbove')
                  }}</span>
                </span>
                <span class="text-center text-text-muted" aria-hidden="true">×</span>
                <span
                  class="flex min-w-0 flex-col rounded-lg bg-danger-surface px-1.5 py-1.5 sm:px-2"
                >
                  <span class="tabular font-mono text-xs whitespace-nowrap sm:text-sm">{{
                    fightAt.bonus
                  }}</span>
                  <a
                    :href="`${WIKI}#HP_Multipliers`"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="truncate text-[0.7rem] text-accent-text hover:underline"
                    >{{ $t('collections.enemies.fightLink', { where: fight!.where }) }} ↗</a
                  >
                </span>
                <span class="text-center text-text-muted" aria-hidden="true">=</span>
                <span
                  class="tabular text-right font-mono text-xs font-bold whitespace-nowrap text-danger-text sm:text-base"
                  >{{ whole(fightAt.hp) }}</span
                >
              </div>
              <div
                v-if="coopChips.length"
                class="flex flex-wrap items-center gap-1.5 border-t border-dashed border-border-default pt-2.5"
              >
                <span class="mr-1 text-xs font-semibold text-text-secondary sm:text-sm">{{
                  $t('collections.enemies.coop')
                }}</span>
                <span
                  v-for="chip in coopChips"
                  :key="chip"
                  class="tabular rounded-full bg-surface-sunken px-2.5 py-0.5 font-mono text-xs"
                  >{{ chip }}</span
                >
                <a
                  :href="`${WIKI}#HP_Multipliers`"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="ml-auto text-xs text-accent-text hover:underline"
                  >{{ $t('collections.enemies.hpMultipliers') }} ↗</a
                >
              </div>
            </div>
          </details>
        </template>
        <p v-else class="text-sm text-text-muted">{{ $t('collections.enemies.wildlife') }}</p>

        <div v-if="enemy?.drops.length" class="flex flex-col gap-2">
          <h4 class="text-sm font-semibold text-text-muted">
            {{ $t('collections.enemies.rewards') }}
          </h4>
          <ul class="grid grid-cols-[repeat(auto-fill,minmax(4.25rem,1fr))] gap-2">
            <li v-for="key in enemy!.drops" :key="key" class="flex min-w-0 flex-col gap-1">
              <ItemTile
                :src="icons ? materialIcon(key) : ''"
                :name="materialName(key)"
                :rarity="materialRarity(key)"
                :label="materialName(key)"
              />
              <span
                class="line-clamp-2 text-center text-[0.7rem] leading-tight text-text-secondary"
                >{{ materialName(key) }}</span
              >
            </li>
          </ul>
        </div>

        <EnemyExtras
          v-if="!loreless"
          :special="special"
          :variants="variants"
          :shown="current?.monster ?? null"
          :level="level"
        />
      </section>
    </div>
  </UiModal>
</template>
