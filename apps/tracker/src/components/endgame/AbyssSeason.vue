<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AbyssPeriod } from '@gdt/game-data/endgame'
import { Zap } from 'lucide-vue-next'
import GameText from '@/components/game/GameText.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import type { EndgameData } from '@/data/endgame'
import { gameIcon } from '@/lib/assets'
import { t } from '@/i18n'
import EnemyTile from './EnemyTile.vue'

/**
 * A Spiral Abyss period: the blessing on its art, then one floor at a time
 * (Floor 12 first, the one that matters): its Ley Line Disorders and three
 * chambers, each half's enemies with their HP at the chamber's level.
 */
const props = defineProps<{
  season: AbyssPeriod
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
const floorNo = ref(0)
watch(
  () => props.season.id,
  () => (floorNo.value = props.season.floors.at(-1)?.floor ?? 0),
  { immediate: true },
)
const floorOptions = computed(() =>
  props.season.floors.map((f) => ({
    value: f.floor,
    label: t('endgame.abyss.floor', { n: f.floor }),
    title: t('endgame.levels', {
      from: f.chambers[0]?.level ?? 0,
      to: f.chambers.at(-1)?.level ?? 0,
    }),
  })),
)
const floor = computed(() => props.season.floors.find((f) => f.floor === floorNo.value) ?? null)
const chambers = computed(() =>
  (floor.value?.chambers ?? []).map((c) => ({
    ...c,
    halves: c.halves.map((half) =>
      half.map((e) => {
        const level = e.level || c.level
        return {
          ...e,
          level,
          monster: props.data.data.monsters.get(e.monster),
          name: text.value.get(`monster.${e.monster}`),
        }
      }),
    ),
  })),
)
</script>

<template>
  <div class="flex flex-col gap-4">
    <section
      class="overflow-hidden rounded-xl border border-border-default bg-surface-raised shadow-sm"
    >
      <div class="relative h-44 bg-surface-sunken sm:h-56">
        <img :src="gameIcon(season.icon)" alt="" class="absolute inset-0 size-full object-cover" />
        <span
          class="absolute inset-0 bg-linear-to-r from-surface-base/95 via-surface-base/55 to-transparent"
        />
        <div class="absolute bottom-4 left-4 flex max-w-xl flex-col gap-1.5 sm:bottom-6 sm:left-6">
          <span class="text-xs font-semibold tracking-wide text-accent-text uppercase">{{
            $t('endgame.abyss.blessing')
          }}</span>
          <h2 class="text-2xl font-bold sm:text-3xl">{{ name }}</h2>
          <span class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span class="tabular font-mono text-text-secondary">{{ period }}</span>
            <span v-if="left > 0" class="font-semibold text-success-text">{{
              $t('endgame.activeLeft', { n: left }, left)
            }}</span>
          </span>
        </div>
      </div>
      <GameText
        :text="text.get(`abyss.${season.id}.desc`)"
        :sprites="data.data.sprites"
        :sprite-name="sprite"
        class="px-4 py-3.5 text-sm leading-relaxed text-text-secondary sm:px-6"
      />
    </section>

    <div class="scroll-hide scroll-fade-x -mx-4 min-w-0 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <UiSegmented
        v-model="floorNo"
        :options="floorOptions"
        :label="$t('endgame.abyss.floors')"
        size="md"
      />
    </div>

    <ul
      v-if="floor?.disorders.length"
      class="flex flex-col gap-2"
      :aria-label="$t('endgame.abyss.disorder')"
    >
      <li
        v-for="d in floor.disorders"
        :key="d"
        class="flex items-start gap-2.5 rounded-lg border border-accent-text/35 bg-accent/10 px-3.5 py-2.5 text-sm leading-relaxed"
      >
        <Zap class="mt-0.5 size-4 shrink-0 text-accent-text" aria-hidden="true" />
        <GameText
          :text="text.get(`disorder.${d}`)"
          :sprites="data.data.sprites"
          :sprite-name="sprite"
        />
      </li>
    </ul>

    <div class="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-3">
      <section
        v-for="chamber in chambers"
        :key="chamber.chamber"
        class="flex min-w-0 flex-col rounded-xl border border-border-default bg-surface-raised shadow-sm"
      >
        <header
          class="flex items-baseline justify-between gap-2 border-b border-border-default px-4 py-3"
        >
          <h3 class="text-base font-semibold">
            {{ $t('endgame.abyss.chamber', { n: chamber.chamber }) }}
          </h3>
          <span class="tabular font-mono text-xs text-text-muted">{{
            $t('endgame.level', { n: chamber.level })
          }}</span>
        </header>
        <div
          v-for="(half, h) in chamber.halves"
          :key="h"
          class="flex min-w-0 flex-col gap-2 px-3 py-3"
          :class="h > 0 ? 'border-t border-dashed border-border-default' : ''"
        >
          <span class="px-1 text-xs font-semibold tracking-wide text-text-muted uppercase">{{
            h ? $t('endgame.abyss.secondHalf') : $t('endgame.abyss.firstHalf')
          }}</span>
          <ul class="flex flex-wrap gap-1">
            <li v-for="(enemy, i) in half" :key="i">
              <EnemyTile
                :monster="enemy.monster"
                :name="enemy.name"
                :level="enemy.level"
                :hp="enemy.hp"
                @open="(codex, level, hp) => $emit('enemy', codex, level, hp)"
              />
            </li>
          </ul>
        </div>
      </section>
    </div>
  </div>
</template>
