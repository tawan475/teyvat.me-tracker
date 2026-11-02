<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronRight } from 'lucide-vue-next'
import { loadEnemyDescription, RES_ELEMENTS, MAX_ENEMY_LEVEL } from '@gdt/game-data/enemies'
import GameText from '@/components/game/GameText.vue'
import ElementIcon from '@/components/ui/ElementIcon.vue'
import GameIcon from '@/components/ui/GameIcon.vue'
import ItemTile from '@/components/ui/ItemTile.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
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
watch(
  () => [props.enemy?.id ?? props.legend?.id, props.level, props.version] as const,
  ([id]) => {
    if (!id) return
    member.value = 0
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
  (props.enemy?.variants ?? []).map((v) => ({
    id: v.monster,
    at: props.data.enemies.statsAt(v, level.value),
  })),
)
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
        key: 'hp',
        base: s.hp,
        curve: s.hpCurve,
        by: multiplier(at.hp[0]!, s.hp),
        value: at.hp[0]!,
      },
      {
        key: 'atk',
        base: s.atk,
        curve: s.atkCurve,
        by: multiplier(at.atk[0]!, s.atk),
        value: at.atk[0]!,
      },
      { key: 'def', base: s.def, curve: s.defCurve, by: multiplier(at.def, s.def), value: at.def },
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
const bonus = (n: number) => `+${Math.round(n * 1000) / 10}%`

/** Cut to a whole number like the game (Local Legends' HP then reads as the guides give it). */
const whole = (n: number) => formatNumber(Math.floor(n + 1e-6))
const percent = (n: number) => `${Math.round(n * 1000) / 10}%`
/** Most enemies resist everything 10%: higher reads as a resistance, lower as a weak spot. */
const resKind = (n: number) => {
  const p = Math.round(n * 1000)
  return p > 100 ? 'high' : p < 100 ? 'low' : null
}
const RES_TONE = { high: 'font-semibold text-danger-text', low: 'font-semibold text-success-text' }
const resTone = (n = 0.1) => {
  const k = resKind(n)
  return k ? RES_TONE[k] : ''
}
const resTip = (n = 0.1) => {
  const k = resKind(n)
  return k
    ? t(k === 'high' ? 'collections.enemies.resHigh' : 'collections.enemies.resLow')
    : undefined
}
const RES_LABEL = (key: (typeof RES_ELEMENTS)[number]) =>
  key === 'physical' ? t('collections.enemies.physical') : t(`game.element.${key}`)
</script>

<template>
  <UiModal :open="!!enemy || !!legend" :title="name" size="wide" @close="$emit('close')">
    <div
      v-if="enemy || legend"
      class="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]"
    >
      <section class="flex min-w-0 flex-col gap-4">
        <div
          class="relative flex aspect-[4/3] max-h-72 w-full items-center justify-center overflow-hidden rounded-xl bg-linear-to-b from-surface-overlay to-surface-sunken"
        >
          <div v-if="legend" class="flex items-center justify-center gap-2 sm:gap-4">
            <GameIcon
              v-for="(m, i) in legend.members"
              :key="i"
              :src="gameIcon(m.icon)"
              :name="name"
              size="lg"
              eager
              :class="
                legend.members.length > 2
                  ? '!size-20 sm:!size-24'
                  : legend.members.length > 1
                    ? '!size-24 sm:!size-32'
                    : '!size-40 sm:!size-48'
              "
            />
          </div>
          <GameIcon
            v-else-if="enemy"
            :src="gameIcon(enemy.icon)"
            :name="name"
            size="lg"
            eager
            class="!size-40 sm:!size-48"
          />
        </div>
        <div class="flex flex-col gap-1">
          <p class="text-xs font-semibold tracking-wide text-accent-text uppercase">
            {{
              legend
                ? $t('collections.legends.mark')
                : $t(`collections.enemies.factions.${enemy!.faction}`)
            }}
          </p>
          <p v-if="legend?.subtitle" class="text-sm text-warning-text">{{ legend.subtitle }}</p>
        </div>
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
      </section>

      <section class="flex min-w-0 flex-col gap-5">
        <template v-if="stats">
          <div class="flex flex-col gap-2">
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
              class="self-start"
            />
            <div
              v-if="fight?.hp && fightAt"
              class="flex items-center gap-3 rounded-lg border border-danger-border bg-danger-surface px-3 py-2 text-sm"
            >
              <span class="flex min-w-0 flex-col">
                <span class="truncate text-text-secondary"
                  >{{ fight.where }} · {{ $t('endgame.level', { n: fightAt.level }) }}</span
                >
                <span
                  v-if="fightAt.bonus"
                  class="tabular font-mono text-xs text-text-muted"
                  :title="$t('collections.enemies.fightBonusTip', { n: fightAt.level })"
                  >{{ whole(fightAt.base) }} × {{ fightAt.bonus }}</span
                >
              </span>
              <span class="tabular ml-auto font-mono font-semibold text-danger-text"
                >♥ {{ whole(fightAt.hp) }}</span
              >
              <UiBadge v-if="fight.before" :title="$t('endgame.beforeBonusTip')">{{
                $t('endgame.beforeBonus')
              }}</UiBadge>
            </div>
            <div class="flex items-center justify-between gap-3">
              <h4 class="text-base font-semibold">{{ $t('collections.enemies.baseStats') }}</h4>
              <label class="flex items-center gap-2 text-sm text-text-secondary">
                {{ $t('collections.enemies.level') }}
                <input
                  v-model.number="level"
                  type="number"
                  :min="1"
                  :max="MAX_ENEMY_LEVEL"
                  class="tabular w-16 rounded-md border border-border-strong bg-surface-raised px-2 py-1 text-right font-mono text-text-primary"
                />
              </label>
            </div>
            <input
              v-model.number="level"
              type="range"
              :min="1"
              :max="MAX_ENEMY_LEVEL"
              class="w-full accent-accent"
              :aria-label="$t('collections.enemies.level')"
            />
            <dl
              class="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-border-default p-3 text-sm"
            >
              <template v-for="(hp, i) in stats.hp" :key="i">
                <dt class="text-text-secondary">
                  {{
                    i
                      ? $t('collections.enemies.hpPlayers', { n: i + 1 })
                      : $t('collections.enemies.hp')
                  }}
                </dt>
                <dd class="tabular text-right font-mono">{{ whole(hp) }}</dd>
              </template>
              <dt class="text-text-secondary">{{ $t('collections.enemies.atk') }}</dt>
              <dd class="tabular text-right font-mono">{{ whole(stats.atk[0]!) }}</dd>
              <dt class="text-text-secondary">{{ $t('collections.enemies.def') }}</dt>
              <dd class="tabular text-right font-mono">{{ whole(stats.def) }}</dd>
              <dt class="text-text-secondary">{{ $t('collections.enemies.em') }}</dt>
              <dd class="tabular text-right font-mono">{{ whole(stats.em) }}</dd>
            </dl>
            <details
              v-if="scaling"
              :open="scalingOpen"
              class="group rounded-lg border border-border-default text-sm"
              @toggle="toggleScaling"
            >
              <summary
                class="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-text-secondary hover:text-text-primary"
              >
                <ChevronRight
                  class="size-4 shrink-0 transition-transform group-open:rotate-90"
                  aria-hidden="true"
                />
                <span class="font-medium">{{ $t('collections.enemies.scaling') }}</span>
                <span class="tabular ml-auto font-mono text-xs text-text-muted">{{
                  $t('collections.enemies.monsterId', { id: scaling.monster })
                }}</span>
              </summary>
              <div class="flex flex-col gap-2 border-t border-border-default px-3 py-2">
                <div class="overflow-x-auto">
                  <table class="w-full min-w-[22rem] text-xs">
                    <thead class="text-text-muted">
                      <tr>
                        <th class="py-1 pr-2 text-left font-medium" />
                        <th class="py-1 pr-2 text-right font-medium">
                          {{ $t('collections.enemies.scalingBase') }}
                        </th>
                        <th class="py-1 pr-2 text-left font-medium">
                          {{ $t('collections.enemies.scalingCurve', { n: level }) }}
                        </th>
                        <th class="py-1 text-right font-medium">
                          {{ $t('collections.enemies.scalingValue') }}
                        </th>
                      </tr>
                    </thead>
                    <tbody class="tabular font-mono">
                      <tr v-for="row in scaling.rows" :key="row.key">
                        <td class="py-1 pr-2 font-sans text-text-secondary">
                          {{ $t(`collections.enemies.${row.key}`) }}
                        </td>
                        <td class="py-1 pr-2 text-right">{{ decimal(row.base) }}</td>
                        <td class="py-1 pr-2" :title="row.curve || undefined">
                          × {{ decimal(row.by) }}
                          <span class="text-text-muted">{{ row.curve }}</span>
                        </td>
                        <td class="py-1 text-right">{{ whole(row.value) }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div
                  v-if="scaling.coopHp.some((n) => n > 0)"
                  class="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-text-secondary"
                >
                  <span class="w-full">{{ $t('collections.enemies.scalingCoop') }}</span>
                  <span class="tabular font-mono text-text-primary"
                    >{{ $t('collections.enemies.hp') }}
                    {{ scaling.coopHp.map(bonus).join(' / ') }}</span
                  >
                  <span
                    v-if="scaling.coopAtk.some((n) => n > 0)"
                    class="tabular font-mono text-text-primary"
                    >{{ $t('collections.enemies.atk') }}
                    {{ scaling.coopAtk.map(bonus).join(' / ') }}</span
                  >
                </div>
              </div>
            </details>
          </div>
          <div class="flex flex-col gap-2">
            <h4 class="text-sm font-semibold text-text-secondary">
              {{ $t('collections.enemies.res') }}
            </h4>
            <ul
              class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,8.5rem),1fr))] gap-x-4 gap-y-1 text-sm"
            >
              <li
                v-for="(key, i) in RES_ELEMENTS"
                :key="key"
                class="flex min-w-0 items-center gap-1.5"
              >
                <ElementIcon v-if="key !== 'physical'" :element="key" size="sm" decorative />
                <span v-else class="w-3.5 text-center text-[0.6rem] font-bold text-text-muted"
                  >PHY</span
                >
                <span class="min-w-0 flex-1 truncate">{{ RES_LABEL(key) }}</span>
                <span
                  class="tabular font-mono"
                  :class="resTone(current?.res[i])"
                  :title="resTip(current?.res[i])"
                  >{{ percent(current?.res[i] ?? 0) }}</span
                >
              </li>
            </ul>
          </div>
        </template>
        <p v-else class="text-sm text-text-muted">{{ $t('collections.enemies.wildlife') }}</p>

        <div v-if="special.length" class="flex flex-col gap-2">
          <h4 class="text-sm font-semibold text-text-secondary">
            {{ $t('collections.enemies.specialNames') }}
          </h4>
          <div class="flex flex-wrap gap-1.5">
            <UiBadge v-for="s in special" :key="s">{{ s }}</UiBadge>
          </div>
        </div>

        <div v-if="enemy?.drops.length" class="flex flex-col gap-2">
          <h4 class="text-sm font-semibold text-text-secondary">
            {{ $t('collections.enemies.rewards') }}
          </h4>
          <ul class="grid grid-cols-[repeat(auto-fill,minmax(3.75rem,1fr))] gap-2">
            <li v-for="key in enemy!.drops" :key="key" class="min-w-0">
              <ItemTile
                :src="icons ? materialIcon(key) : ''"
                :name="materialName(key)"
                :rarity="materialRarity(key)"
                :label="materialName(key)"
              />
            </li>
          </ul>
        </div>

        <div v-if="variants.length" class="flex flex-col gap-2">
          <h4 class="text-sm font-semibold text-text-secondary">
            {{ $t('collections.enemies.variants') }}
          </h4>
          <div class="overflow-x-auto rounded-lg border border-border-default">
            <table class="w-full min-w-[22rem] text-sm">
              <thead class="text-xs text-text-muted">
                <tr>
                  <th class="px-3 py-1.5 text-left font-medium">ID</th>
                  <th class="px-3 py-1.5 text-right font-medium">
                    {{ $t('collections.enemies.hp') }}
                  </th>
                  <th class="px-3 py-1.5 text-right font-medium">
                    {{ $t('collections.enemies.atk') }}
                  </th>
                  <th class="px-3 py-1.5 text-right font-medium">
                    {{ $t('collections.enemies.def') }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="v in variants" :key="v.id" class="border-t border-border-default">
                  <td class="tabular px-3 py-1.5 font-mono text-text-secondary">{{ v.id }}</td>
                  <td class="tabular px-3 py-1.5 text-right font-mono">{{ whole(v.at.hp[0]!) }}</td>
                  <td class="tabular px-3 py-1.5 text-right font-mono">
                    {{ whole(v.at.atk[0]!) }}
                  </td>
                  <td class="tabular px-3 py-1.5 text-right font-mono">{{ whole(v.at.def) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  </UiModal>
</template>
