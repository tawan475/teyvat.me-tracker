<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { TheaterAct, TheaterSeason } from '@gdt/game-data/endgame'
import GameText from '@/components/game/GameText.vue'
import ElementIcon from '@/components/ui/ElementIcon.vue'
import type { EndgameData } from '@/data/endgame'
import type { Element } from '@/data/game-meta'
import { characterName } from '@/i18n/game-names'
import { characterBanner, characterIcon } from '@/lib/assets'
import { t } from '@/i18n'
import EnemyTile from './EnemyTile.vue'

/**
 * An Imaginarium Theater season: a column that stays in view (the namecard,
 * elements, Opening Characters, Special Guest Stars and the difficulties),
 * beside the chosen difficulty's acts, one row each: a boss act shows its
 * boss and what it does; any other its lineups side by side (a run meets one
 * of them); then the hardest difficulty's extra bouts.
 */
const props = defineProps<{
  season: TheaterSeason
  data: EndgameData
  name: string
  period: string
  left: number
}>()
defineEmits<{
  /** An enemy to open, at its level, with its HP in this fight (0 unknown; `before`: before the bonus). */
  enemy: [codex: number, level: number, hp: number, before?: boolean]
}>()

const text = computed(() => props.data.text)
const sprite = (id: number) => text.value.get(`sprite.${id}`)
const element = (name: string) => name.toLowerCase() as Element
const difficulty = ref(0)
watch(
  () => props.season.id,
  () => (difficulty.value = props.season.difficulties.at(-1)?.difficulty ?? 0),
  { immediate: true },
)
const difficulties = computed(() =>
  props.season.difficulties.map((d) => ({
    value: d.difficulty,
    label:
      text.value.get(`theaterDifficulty.${d.difficulty}`) ||
      t('endgame.theater.difficultyN', { n: d.difficulty }),
    acts: d.acts.length + d.extra.length,
  })),
)
const chosen = computed(
  () => props.season.difficulties.find((d) => d.difficulty === difficulty.value) ?? null,
)

/** A lineup's enemies; `hp` is the act's HP of that lineup (the hardest difficulty only). */
const lineup = (level: number, actLevel: number, hp: number[] = []) =>
  (props.data.data.theaterLevels.get(level) ?? []).map((e, k) => {
    const at = e.level || actLevel
    return {
      ...e,
      level: at,
      hp: hp[k] ?? 0,
      monster: props.data.data.monsters.get(e.monster),
      name: text.value.get(`monster.${e.monster}`),
    }
  })
const row = (act: TheaterAct, extra: boolean) => {
  const named = act.levels.length === 1 && !!text.value.get(`theater.${act.levels[0]}.name`)
  return {
    key: `${extra ? 'x' : ''}${act.act}-${act.levels.join(',')}`,
    act: act.act,
    level: act.level,
    extra,
    named,
    title: named ? text.value.get(`theater.${act.levels[0]}.name`) : '',
    desc: named ? text.value.get(`theater.${act.levels[0]}.desc`) : '',
    lineups: act.levels.map((l, j) => lineup(l, act.level, act.hp[j])),
  }
}
const acts = computed(() =>
  chosen.value
    ? [
        ...chosen.value.acts.map((a) => row(a, false)),
        ...chosen.value.extra.map((a) => row(a, true)),
      ]
    : [],
)
const firstExtra = computed(() => acts.value.findIndex((a) => a.extra))
</script>

<template>
  <div class="flex flex-wrap items-start gap-4">
    <aside
      class="flex max-w-full min-w-0 flex-[1_1_18rem] flex-col gap-3 lg:sticky lg:top-24 lg:max-w-[20rem]"
    >
      <section
        class="overflow-hidden rounded-xl border border-border-default bg-surface-raised shadow-sm"
      >
        <div class="relative h-28 bg-surface-sunken">
          <img
            :src="characterBanner(season.opening[0] ?? '')"
            alt=""
            class="size-full object-cover"
          />
          <span class="absolute inset-0 bg-linear-to-b from-transparent to-surface-raised" />
        </div>
        <div class="relative -mt-8 flex flex-col gap-1.5 px-4 pb-4">
          <h2 class="text-2xl font-bold">{{ name }}</h2>
          <span class="flex flex-wrap gap-x-3 text-sm">
            <span class="tabular font-mono text-text-muted">{{ period }}</span>
            <span v-if="left > 0" class="font-semibold text-success-text">{{
              $t('endgame.activeLeft', { n: left }, left)
            }}</span>
          </span>
          <ul class="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
            <li v-for="e in season.elements" :key="e" class="flex items-center gap-1.5 text-sm">
              <ElementIcon :element="element(e)" size="lg" decorative />
              {{ $t(`game.element.${element(e)}`) }}
            </li>
          </ul>
        </div>
      </section>

      <section
        class="flex flex-col gap-3 rounded-xl border border-border-default bg-surface-raised p-4 shadow-sm"
      >
        <template v-for="group in ['opening', 'guests'] as const" :key="group">
          <h3
            class="text-xs font-semibold tracking-wide uppercase"
            :class="group === 'guests' ? 'text-warning-text' : 'text-text-muted'"
          >
            {{ $t(`endgame.theater.${group}`) }}
          </h3>
          <ul
            class="grid gap-x-1.5 gap-y-2"
            :class="group === 'guests' ? 'grid-cols-4' : 'grid-cols-3'"
          >
            <li
              v-for="key in season[group]"
              :key="key"
              class="flex min-w-0 flex-col items-center gap-1"
            >
              <img
                :src="characterIcon(key)"
                :alt="characterName(key)"
                class="size-13 rounded-full border-2 bg-surface-overlay object-cover"
                :class="group === 'guests' ? 'border-warning-text' : 'border-border-strong'"
              />
              <span class="w-full truncate text-center text-xs text-text-secondary">{{
                characterName(key)
              }}</span>
            </li>
          </ul>
        </template>
      </section>

      <section
        class="flex flex-col gap-0.5 rounded-xl border border-border-default bg-surface-raised p-2 shadow-sm"
        role="radiogroup"
        :aria-label="$t('endgame.theater.difficulty')"
      >
        <h3 class="px-3 pt-1 pb-1.5 text-xs font-semibold tracking-wide text-text-muted uppercase">
          {{ $t('endgame.theater.difficulty') }}
        </h3>
        <button
          v-for="d in difficulties"
          :key="d.value"
          type="button"
          role="radio"
          :aria-checked="d.value === difficulty"
          class="flex min-h-10 items-center justify-between gap-3 rounded-md px-3 text-left text-sm transition-colors"
          :class="
            d.value === difficulty
              ? 'bg-surface-overlay font-semibold text-text-primary ring-1 ring-warning-text ring-inset'
              : 'text-text-secondary hover:bg-surface-overlay'
          "
          @click="difficulty = d.value"
        >
          <span class="truncate">{{ d.label }}</span>
          <span class="tabular shrink-0 font-mono text-xs text-text-muted">{{
            $t('endgame.theater.acts', { n: d.acts })
          }}</span>
        </button>
      </section>
    </aside>

    <ol class="flex min-w-0 flex-[999_1_32rem] flex-col gap-3">
      <li v-for="(a, i) in acts" :key="a.key" class="flex flex-col gap-3">
        <h3
          v-if="i === firstExtra"
          class="mt-2 text-xs font-semibold tracking-wide text-warning-text uppercase"
        >
          {{ $t('endgame.theater.extra') }}
        </h3>
        <section
          class="flex min-w-0 flex-col rounded-xl border bg-surface-raised shadow-sm"
          :class="a.named ? 'border-warning-text/55' : 'border-border-default'"
        >
          <header
            class="flex items-baseline justify-between gap-3 border-b border-border-default px-4 py-2.5"
          >
            <h4
              class="min-w-0 truncate text-sm font-semibold"
              :class="a.named && 'text-warning-text'"
            >
              {{ a.extra ? '' : $t('endgame.theater.act', { n: a.act })
              }}{{ a.named && !a.extra ? ' · ' : '' }}{{ a.title }}
            </h4>
            <span class="tabular shrink-0 font-mono text-xs text-text-muted">{{
              $t('endgame.level', { n: a.level })
            }}</span>
          </header>
          <div v-if="a.named" class="flex min-w-0 items-start gap-4 p-3 sm:px-4">
            <EnemyTile
              v-for="(e, j) in a.lineups[0]?.slice(0, 1)"
              :key="j"
              :monster="e.monster"
              :name="e.name"
              :level="e.level"
              :hp="e.hp"
              size="lg"
              class="shrink-0"
              @open="(codex, level, hp) => $emit('enemy', codex, level, hp)"
            />
            <GameText
              :text="a.desc"
              :sprites="data.data.sprites"
              :sprite-name="sprite"
              class="min-w-0 pt-1 text-sm leading-relaxed text-text-secondary"
            />
          </div>
          <div
            v-else
            class="grid min-w-0 gap-px overflow-hidden rounded-b-xl bg-border-default"
            :class="a.lineups.length > 1 ? 'md:grid-cols-2' : ''"
            :title="a.lineups.length > 1 ? $t('endgame.theater.oneOf') : undefined"
          >
            <!-- One cell per lineup a run can draw, divided by hairlines; each after the first
                 starts with "or", inside the card at any width. -->
            <ul
              v-for="(enemies, j) in a.lineups"
              :key="j"
              class="flex min-w-0 flex-wrap content-start items-center gap-1 bg-surface-raised p-2.5"
              :class="
                j === a.lineups.length - 1 && a.lineups.length % 2 === 1 && j > 0
                  ? 'md:col-span-2'
                  : ''
              "
            >
              <li
                v-if="j > 0"
                class="rounded-full bg-surface-overlay px-2 py-0.5 text-xs font-medium text-text-muted"
              >
                {{ $t('endgame.or') }}
              </li>
              <li v-for="(e, k) in enemies" :key="k">
                <EnemyTile
                  :monster="e.monster"
                  :name="e.name"
                  :level="e.level"
                  :hp="e.hp"
                  @open="(codex, level, hp) => $emit('enemy', codex, level, hp)"
                />
              </li>
            </ul>
          </div>
        </section>
      </li>
    </ol>
  </div>
</template>
