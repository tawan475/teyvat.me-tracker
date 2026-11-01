<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { StygianSeason } from '@gdt/game-data/endgame'
import GameText from '@/components/game/GameText.vue'
import GameIcon from '@/components/ui/GameIcon.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import type { EndgameData } from '@/data/endgame'
import { gameIcon } from '@/lib/assets'

/**
 * A Stygian Onslaught season: per difficulty the monster
 * level and its three opponents (picture, name, description, mechanics and
 * the characters the game recommends).
 */
const props = defineProps<{ season: StygianSeason; data: EndgameData }>()
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
    label: text.value.get(`stygianDifficulty.${d.difficulty}`) || String(d.difficulty),
  })),
)
const chosen = computed(
  () => props.season.difficulties.find((d) => d.difficulty === difficulty.value) ?? null,
)
const bosses = computed(() =>
  (chosen.value?.bosses ?? []).flatMap((id) => {
    const boss = props.data.data.stygianBosses.get(id)
    return boss ? [boss] : []
  }),
)
const codexOf = (monster: number) => props.data.data.monsters.get(monster)?.codex ?? 0
const sprite = (id: number) => text.value.get(`sprite.${id}`)
const range = (n: number) => Array.from({ length: n }, (_, i) => i)
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- The season's own text ("The following characters will have…") is left out: the
         data has no list of those characters, so it would point at nothing. -->

    <div class="flex flex-wrap items-center gap-3">
      <span class="text-sm font-semibold text-text-secondary">{{
        $t('endgame.stygian.difficulty')
      }}</span>
      <div class="scroll-hide scroll-fade-x -mx-4 min-w-0 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <UiSegmented
          v-model="difficulty"
          :options="options"
          :label="$t('endgame.stygian.difficulty')"
        />
      </div>
      <span v-if="chosen" class="tabular font-mono text-sm text-text-muted">{{
        $t('endgame.level', { n: chosen.level })
      }}</span>
    </div>

    <div class="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-3">
      <UiPanel v-for="boss in bosses" :key="boss.id">
        <div class="flex min-w-0 flex-col gap-3">
          <component
            :is="codexOf(boss.monster) ? 'button' : 'div'"
            :type="codexOf(boss.monster) ? 'button' : undefined"
            class="flex min-w-0 items-center gap-3 rounded-lg text-left"
            :class="
              codexOf(boss.monster) &&
              'transition-colors hover:bg-surface-overlay focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none'
            "
            @click="codexOf(boss.monster) && $emit('enemy', codexOf(boss.monster))"
          >
            <GameIcon
              :src="gameIcon(boss.icon)"
              :name="text.get(`stygianBoss.${boss.id}.name`)"
              size="lg"
              class="shrink-0"
            />
            <h3 class="min-w-0 flex-1 text-base font-semibold break-words">
              {{ text.get(`stygianBoss.${boss.id}.name`) }}
            </h3>
          </component>
          <GameText
            v-if="text.get(`stygianBoss.${boss.id}.desc`)"
            :text="text.get(`stygianBoss.${boss.id}.desc`)"
            class="text-sm leading-relaxed text-text-secondary"
          />
          <div v-if="boss.mechanics" class="flex flex-col gap-2">
            <h4 class="text-xs font-semibold text-text-muted">
              {{ $t('endgame.stygian.mechanics') }}
            </h4>
            <div
              v-for="i in range(boss.mechanics)"
              :key="i"
              class="flex flex-col gap-1 rounded-md bg-surface-sunken px-3 py-2 text-sm"
            >
              <p class="font-semibold">
                {{ text.get(`stygianBoss.${boss.id}.mechanic.${i}.name`) }}
              </p>
              <GameText
                :text="text.get(`stygianBoss.${boss.id}.mechanic.${i}.text`)"
                :sprites="data.data.sprites"
                :sprite-name="sprite"
                class="leading-relaxed text-text-secondary"
              />
            </div>
          </div>
          <div v-if="boss.recommendations" class="flex flex-col gap-1.5">
            <h4 class="text-xs font-semibold text-text-muted">
              {{ $t('endgame.stygian.recommended') }}
            </h4>
            <GameText
              v-for="i in range(boss.recommendations)"
              :key="i"
              :text="text.get(`stygianBoss.${boss.id}.recommend.${i}`)"
              :sprites="data.data.sprites"
              :sprite-name="sprite"
              class="text-sm"
            />
          </div>
        </div>
      </UiPanel>
    </div>
  </div>
</template>
