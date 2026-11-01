<script setup lang="ts">
import { computed } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import type { AbyssPeriod, StygianSeason, TheaterSeason } from '@gdt/game-data/endgame'
import type { GenshinServer } from '@gdt/shared'
import GameIcon from '@/components/ui/GameIcon.vue'
import {
  ENDGAME_MODES,
  abyssTopEnemies,
  daysLeft,
  elapsedPercent,
  stygianTop,
  type AnySeason,
  type EndgameData,
  type EndgameMode,
} from '@/data/endgame'
import type { Element } from '@/data/game-meta'
import { characterName } from '@/i18n/game-names'
import { characterIcon, gameIcon } from '@/lib/assets'
import { t } from '@/i18n'
import ElementIcon from '@/components/ui/ElementIcon.vue'
import { MODE_BAR, MODE_CHOSEN, MODE_TEXT } from './modes'

/**
 * The three modes as cards, each with the season on now (or the latest):
 * its name, a preview (the Abyss's blessing and Floor 12 enemies, the
 * Theater's elements and Opening Characters, the Stygian bosses), days left
 * and a bar of how far it has run. The chosen mode's card is outlined; each
 * links to its mode's list. On phones they stack, without the preview row.
 */
const props = defineProps<{
  data: EndgameData
  current: Record<EndgameMode, AnySeason | null>
  mode: EndgameMode
  now: number
  server: GenshinServer | null | undefined
  nameOf: (mode: EndgameMode, season: AnySeason) => string
  to: (mode: EndgameMode) => RouteLocationRaw
}>()

const cards = computed(() =>
  ENDGAME_MODES.map((mode) => {
    const season = props.current[mode]
    const left = season ? daysLeft(season, props.now, props.server) : 0
    return {
      mode,
      season,
      name: season ? props.nameOf(mode, season) : '',
      left,
      elapsed: season ? elapsedPercent(season, props.now, props.server) : 0,
      status: left > 0 ? t('endgame.daysLeft', { n: left }) : t('endgame.status.ended'),
    }
  }),
)
const monster = (id: number) => props.data.data.monsters.get(id)
const monsterName = (id: number) => props.data.text.get(`monster.${id}`)
const abyss = (s: AnySeason | null) => s as AbyssPeriod
const theater = (s: AnySeason | null) => s as TheaterSeason
const stygianBosses = (s: AnySeason | null) =>
  (stygianTop(s as StygianSeason)?.bosses ?? []).flatMap((id) => {
    const boss = props.data.data.stygianBosses.get(id)
    return boss ? [boss] : []
  })
const element = (name: string) => name.toLowerCase() as Element
</script>

<template>
  <nav
    :aria-label="$t('endgame.modesLabel')"
    class="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3"
  >
    <RouterLink
      v-for="card in cards"
      :key="card.mode"
      :to="to(card.mode)"
      :aria-current="card.mode === mode ? 'page' : undefined"
      class="flex min-w-0 flex-col gap-1.5 rounded-xl border bg-surface-raised px-3 py-2.5 shadow-sm transition-colors hover:bg-surface-overlay sm:gap-3 sm:p-4"
      :class="card.mode === mode ? MODE_CHOSEN[card.mode] : 'border-border-default'"
    >
      <span class="flex items-baseline justify-between gap-2 text-xs">
        <span class="truncate font-semibold" :class="MODE_TEXT[card.mode]">{{
          $t(`endgame.modes.${card.mode}`)
        }}</span>
        <span
          class="tabular shrink-0 font-mono"
          :class="card.left > 0 ? 'text-success-text' : 'text-text-muted'"
          >{{ card.status }}</span
        >
      </span>
      <span class="flex h-8 min-w-0 items-center gap-3 sm:h-10">
        <img
          v-if="card.mode === 'abyss' && card.season"
          :src="gameIcon(abyss(card.season).icon)"
          alt=""
          class="h-8 w-16 shrink-0 rounded-md bg-surface-sunken object-cover sm:h-10 sm:w-20"
        />
        <span
          v-else-if="card.mode === 'theater' && card.season"
          class="flex h-8 w-16 shrink-0 items-center justify-center gap-0.5 rounded-md bg-surface-sunken sm:h-10 sm:w-20"
        >
          <ElementIcon
            v-for="e in theater(card.season).elements"
            :key="e"
            :element="element(e)"
            size="lg"
          />
        </span>
        <span class="truncate text-base font-semibold text-text-primary sm:text-lg">{{
          card.name
        }}</span>
      </span>
      <span v-if="card.season" class="flex h-8 gap-1.5 max-sm:hidden">
        <template v-if="card.mode === 'abyss'">
          <GameIcon
            v-for="id in abyssTopEnemies(abyss(card.season))"
            :key="id"
            :src="gameIcon(monster(id)?.icon ?? '')"
            :name="monsterName(id)"
            size="xs"
            :title="monsterName(id)"
          />
        </template>
        <template v-else-if="card.mode === 'theater'">
          <img
            v-for="key in theater(card.season).opening"
            :key="key"
            :src="characterIcon(key)"
            :alt="characterName(key)"
            :title="characterName(key)"
            class="size-8 rounded-full border border-border-strong bg-surface-overlay object-cover"
          />
        </template>
        <template v-else>
          <GameIcon
            v-for="boss in stygianBosses(card.season)"
            :key="boss.id"
            :src="gameIcon(boss.icon)"
            :name="data.text.get(`stygianBoss.${boss.id}.name`)"
            size="xs"
            :title="data.text.get(`stygianBoss.${boss.id}.name`)"
          />
        </template>
      </span>
      <span class="mt-auto h-1 overflow-hidden rounded-full bg-surface-sunken" aria-hidden="true">
        <span
          class="block h-full rounded-full"
          :class="MODE_BAR[card.mode]"
          :style="{ width: `${card.elapsed}%` }"
        />
      </span>
    </RouterLink>
  </nav>
</template>
