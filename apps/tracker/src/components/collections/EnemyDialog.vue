<script setup lang="ts">
import { computed, ref, watch } from 'vue'
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
import { useResource } from '@/data/use-resource'
import { locale } from '@/i18n/locale'
import { formatNumber } from '@/lib/format'
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
 * it starts on that mode's version and shows the HP there (with its bonus).
 */
const props = defineProps<{
  enemy: Enemy | null
  data: EnemyData
  /** The level to open at (the chamber, act or difficulty it was clicked in); 90 without one. */
  level?: number
  /** The version to open on (an endgame mode's); the open world's without one. */
  version?: Version
  /** The HP in the fight it was opened from (`before`: before the difficulty's bonus). */
  fight?: { hp: number; before: boolean } | null
}>()
defineEmits<{ close: [] }>()

type Version = 'world' | 'abyss' | 'stygian'
const level = ref(90)
const version = ref<Version>('world')
const has = (v: Version) => v === 'world' || !!props.enemy?.[v]
watch(
  () => [props.enemy?.id, props.level, props.version] as const,
  ([id]) => {
    if (!id) return
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
  const e = props.enemy
  return (version.value !== 'world' ? e?.[version.value] : null) ?? e?.stats ?? null
})
const name = computed(() => (props.enemy ? props.data.names.name(props.enemy.id) : ''))
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
const variants = computed(() =>
  (props.enemy?.variants ?? []).map((v) => ({
    id: v.monster,
    at: props.data.enemies.statsAt(v, level.value),
  })),
)
const whole = (n: number) => formatNumber(Math.round(n))
const percent = (n: number) => `${Math.round(n * 1000) / 10}%`
const RES_LABEL = (key: (typeof RES_ELEMENTS)[number]) =>
  key === 'physical' ? t('collections.enemies.physical') : t(`game.element.${key}`)
</script>

<template>
  <UiModal :open="!!enemy" :title="name" size="wide" @close="$emit('close')">
    <div
      v-if="enemy"
      class="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]"
    >
      <section class="flex min-w-0 flex-col gap-4">
        <div
          class="relative flex aspect-[4/3] max-h-72 w-full items-center justify-center overflow-hidden rounded-xl bg-linear-to-b from-surface-overlay to-surface-sunken"
        >
          <GameIcon
            :src="gameIcon(enemy.icon)"
            :name="name"
            size="lg"
            eager
            class="!size-40 sm:!size-48"
          />
        </div>
        <p class="text-xs font-semibold tracking-wide text-accent-text uppercase">
          {{ $t(`collections.enemies.factions.${enemy.faction}`) }}
        </p>
        <GameText
          v-if="description.data.value"
          :text="description.data.value"
          class="text-sm leading-relaxed text-text-secondary"
        />
        <div v-else-if="description.loading.value" class="flex flex-col gap-2" aria-hidden="true">
          <UiSkeleton class="h-4 w-full" />
          <UiSkeleton class="h-4 w-2/3" />
        </div>
      </section>

      <section class="flex min-w-0 flex-col gap-5">
        <template v-if="stats">
          <div class="flex flex-col gap-2">
            <UiSegmented
              v-if="versions.length > 1"
              v-model="version"
              :options="versions"
              :label="$t('collections.enemies.version')"
              class="self-start"
            />
            <p
              v-if="fight?.hp"
              class="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-danger-border bg-danger-surface px-3 py-2 text-sm"
            >
              <span class="text-text-secondary">{{ $t('collections.enemies.thisFight') }}</span>
              <span class="tabular ml-auto font-mono font-semibold text-danger-text"
                >♥ {{ whole(fight.hp) }}</span
              >
              <UiBadge v-if="fight.before" :title="$t('endgame.beforeBonusTip')">{{
                $t('endgame.beforeBonus')
              }}</UiBadge>
            </p>
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
                <span class="tabular font-mono">{{ percent(current?.res[i] ?? 0) }}</span>
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

        <div v-if="enemy.drops.length" class="flex flex-col gap-2">
          <h4 class="text-sm font-semibold text-text-secondary">
            {{ $t('collections.enemies.rewards') }}
          </h4>
          <ul class="grid grid-cols-[repeat(auto-fill,minmax(3.75rem,1fr))] gap-2">
            <li v-for="key in enemy.drops" :key="key" class="min-w-0">
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
