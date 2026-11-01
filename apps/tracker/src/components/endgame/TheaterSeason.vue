<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { TheaterAct, TheaterSeason } from '@gdt/game-data/endgame'
import GameText from '@/components/game/GameText.vue'
import ElementIcon from '@/components/ui/ElementIcon.vue'
import GameIcon from '@/components/ui/GameIcon.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import type { EndgameData } from '@/data/endgame'
import type { Element } from '@/data/game-meta'
import { characterName } from '@/i18n/game-names'
import { characterIcon } from '@/lib/assets'
import { t } from '@/i18n'
import LineupEnemy from './LineupEnemy.vue'

/**
 * An Imaginarium Theater season: its elements, Opening Characters and Special
 * Guest Stars; per difficulty, each act's level and the lineups a run can
 * meet there (a named boss act shows its title and what it does), then the
 * hardest difficulty's extra bouts.
 */
const props = defineProps<{ season: TheaterSeason; data: EndgameData }>()
defineEmits<{ enemy: [codex: number] }>()

const text = computed(() => props.data.text)
const difficulty = ref(0)
watch(
  () => props.season.id,
  () => (difficulty.value = props.season.difficulties.at(-1)?.difficulty ?? 0),
  { immediate: true },
)
const options = computed(() =>
  props.season.difficulties.map((d) => ({
    value: d.difficulty,
    label: t('endgame.theater.difficultyN', { n: d.difficulty }),
    title: t('endgame.theater.acts', { n: d.acts.length + d.extra.length }),
  })),
)
const chosen = computed(
  () => props.season.difficulties.find((d) => d.difficulty === difficulty.value) ?? null,
)
const element = (name: string) => name.toLowerCase() as Element
const lineup = (level: number) => props.data.data.theaterLevels.get(level) ?? []
const monster = (id: number) => props.data.data.monsters.get(id)
const sprite = (id: number) => text.value.get(`sprite.${id}`)
const cast = computed(() => [
  { key: 'opening', label: t('endgame.theater.opening'), list: props.season.opening },
  { key: 'guests', label: t('endgame.theater.guests'), list: props.season.guests },
])
const sections = computed(() =>
  chosen.value
    ? [
        { key: 'acts', title: '', acts: chosen.value.acts },
        { key: 'extra', title: t('endgame.theater.extra'), acts: chosen.value.extra },
      ].filter((s) => s.acts.length)
    : [],
)
const actKey = (act: TheaterAct) => `${act.act}-${act.levels.join(',')}`
</script>

<template>
  <div class="flex flex-col gap-4">
    <UiPanel>
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-1.5">
          <h3 class="text-xs font-semibold text-text-muted">
            {{ $t('endgame.theater.elements') }}
          </h3>
          <ul class="flex flex-wrap gap-3">
            <li v-for="e in season.elements" :key="e" class="flex items-center gap-1.5 text-sm">
              <ElementIcon :element="element(e)" size="lg" decorative />
              {{ $t(`game.element.${element(e)}`) }}
            </li>
          </ul>
        </div>
        <div v-for="group in cast" :key="group.key" class="flex flex-col gap-1.5">
          <h3 class="text-xs font-semibold text-text-muted">{{ group.label }}</h3>
          <ul class="flex flex-wrap gap-2">
            <li v-for="key in group.list" :key="key" :title="characterName(key)">
              <GameIcon :src="characterIcon(key)" :name="characterName(key)" size="md" />
            </li>
          </ul>
        </div>
      </div>
    </UiPanel>

    <div class="flex flex-wrap items-center gap-3">
      <span class="text-sm font-semibold text-text-secondary">{{
        $t('endgame.theater.difficulty')
      }}</span>
      <UiSegmented
        v-model="difficulty"
        :options="options"
        :label="$t('endgame.theater.difficulty')"
      />
    </div>

    <UiPanel v-for="section in sections" :key="section.key" flush>
      <template v-if="section.title" #header>
        <h3 class="text-base font-semibold">{{ section.title }}</h3>
      </template>
      <ol class="flex flex-col divide-y divide-border-default">
        <li
          v-for="act in section.acts"
          :key="actKey(act)"
          class="flex min-w-0 flex-col gap-2 p-3 sm:p-4"
        >
          <h4 class="flex items-baseline gap-2 text-sm font-semibold">
            {{ $t('endgame.theater.act', { n: act.act }) }}
            <span class="tabular font-mono text-xs font-normal text-text-muted">{{
              $t('endgame.level', { n: act.level })
            }}</span>
          </h4>
          <p v-if="act.levels.length > 1" class="text-xs text-text-muted">
            {{ $t('endgame.theater.oneOf') }}
          </p>
          <div
            v-for="level in act.levels"
            :key="level"
            class="flex min-w-0 flex-col gap-1.5"
            :class="
              act.levels.length > 1 && 'rounded-lg border border-dashed border-border-default p-2'
            "
          >
            <template v-if="text.get(`theater.${level}.name`)">
              <p class="font-semibold">{{ text.get(`theater.${level}.name`) }}</p>
              <GameText
                :text="text.get(`theater.${level}.desc`)"
                :sprites="data.data.sprites"
                :sprite-name="sprite"
                class="text-sm leading-relaxed text-text-secondary"
              />
            </template>
            <ul class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,12rem),1fr))] gap-1.5">
              <li v-for="(enemy, i) in lineup(level)" :key="i" class="flex min-w-0">
                <LineupEnemy
                  class="w-full"
                  :monster="monster(enemy.monster)"
                  :name="text.get(`monster.${enemy.monster}`)"
                  :level="enemy.level"
                  @open="$emit('enemy', $event)"
                />
              </li>
            </ul>
          </div>
        </li>
      </ol>
    </UiPanel>
  </div>
</template>
