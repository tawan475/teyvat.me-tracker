<script setup lang="ts">
import { computed } from 'vue'
import type { AbyssPeriod } from '@gdt/game-data/endgame'
import GameText from '@/components/game/GameText.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import type { EndgameData } from '@/data/endgame'
import { gameIcon } from '@/lib/assets'
import LineupEnemy from './LineupEnemy.vue'

/**
 * A Spiral Abyss period: the Blessing of the Abyssal Moon, then floors 9-12,
 * each with its Ley Line Disorders and three chambers (the level the game
 * shows, each half's enemies).
 */
const props = defineProps<{ season: AbyssPeriod; data: EndgameData }>()
defineEmits<{ enemy: [codex: number] }>()

const text = computed(() => props.data.text)
const blessing = computed(() => gameIcon(props.season.icon))
const monster = (id: number) => props.data.data.monsters.get(id)
const sprite = (id: number) => text.value.get(`sprite.${id}`)
</script>

<template>
  <div class="flex flex-col gap-4">
    <UiPanel>
      <div class="flex min-w-0 items-start gap-4">
        <img
          v-if="blessing"
          :src="blessing"
          alt=""
          class="h-12 w-auto max-w-24 shrink-0 object-contain max-sm:hidden"
        />
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <p class="text-xs font-semibold tracking-wide text-accent-text uppercase">
            {{ $t('endgame.abyss.blessing') }}
          </p>
          <h3 class="text-lg font-semibold break-words">
            {{ text.get(`abyss.${season.id}.name`) }}
          </h3>
          <GameText
            :text="text.get(`abyss.${season.id}.desc`)"
            :sprites="data.data.sprites"
            :sprite-name="sprite"
            class="text-sm leading-relaxed text-text-secondary"
          />
        </div>
      </div>
    </UiPanel>

    <UiPanel v-for="floor in season.floors" :key="floor.floor" flush>
      <template #header>
        <h3 class="text-base font-semibold">{{ $t('endgame.abyss.floor', { n: floor.floor }) }}</h3>
      </template>
      <div class="flex flex-col gap-4 p-3 sm:p-5">
        <div v-if="floor.disorders.length" class="flex flex-col gap-1.5">
          <h4 class="text-xs font-semibold text-text-muted">{{ $t('endgame.abyss.disorder') }}</h4>
          <GameText
            v-for="d in floor.disorders"
            :key="d"
            :text="text.get(`disorder.${d}`)"
            :sprites="data.data.sprites"
            :sprite-name="sprite"
            class="rounded-md bg-surface-sunken px-3 py-2 text-sm leading-relaxed"
          />
        </div>
        <section
          v-for="chamber in floor.chambers"
          :key="chamber.chamber"
          class="flex min-w-0 flex-col gap-2"
        >
          <h4 class="flex items-baseline gap-2 text-sm font-semibold">
            {{ $t('endgame.abyss.chamber', { n: chamber.chamber }) }}
            <span class="tabular font-mono text-xs font-normal text-text-muted">{{
              $t('endgame.level', { n: chamber.level })
            }}</span>
          </h4>
          <div class="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
            <div v-for="(half, h) in chamber.halves" :key="h" class="flex min-w-0 flex-col gap-1.5">
              <p class="text-xs text-text-muted">
                {{ h ? $t('endgame.abyss.secondHalf') : $t('endgame.abyss.firstHalf') }}
              </p>
              <ul class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,12rem),1fr))] gap-1.5">
                <li v-for="(enemy, i) in half" :key="i" class="flex min-w-0">
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
          </div>
        </section>
      </div>
    </UiPanel>
  </div>
</template>
