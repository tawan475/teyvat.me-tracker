<script setup lang="ts">
import { computed } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import type { AbyssPeriod, StygianSeason, TheaterSeason } from '@gdt/game-data/endgame'
import GameText from '@/components/game/GameText.vue'
import ElementIcon from '@/components/ui/ElementIcon.vue'
import GameIcon from '@/components/ui/GameIcon.vue'
import BossPicture from './BossPicture.vue'
import {
  abyssTopEnemies,
  stygianBossPicture,
  stygianTop,
  type AnySeason,
  type EndgameData,
  type EndgameMode,
} from '@/data/endgame'
import type { Element } from '@/data/game-meta'
import { characterName } from '@/i18n/game-names'
import { formatNumber, formatShort } from '@/lib/format'
import { characterBanner, characterIcon, gameIcon } from '@/lib/assets'
import { t } from '@/i18n'
import { STYGIAN_GROUND } from './modes'

/**
 * The newest season of a mode as one card: its art on the left (the Abyss
 * blessing, the first Opening Character's namecard, the three Stygian
 * bosses), then its name, dates and what it holds (the blessing and Floor 12,
 * the cast, the bosses with their HP at the hardest difficulty). Enemies open
 * their Living Beings entry (`enemy`); the rest of the card opens the season (`to`).
 */
const props = defineProps<{
  mode: EndgameMode
  season: AnySeason
  data: EndgameData
  name: string
  period: string
  left: number
  to: RouteLocationRaw
}>()
defineEmits<{ enemy: [codex: number, level: number] }>()

const text = computed(() => props.data.text)
const sprite = (id: number) => text.value.get(`sprite.${id}`)
const element = (name: string) => name.toLowerCase() as Element
const monster = (id: number) => props.data.data.monsters.get(id)

const abyss = computed(() => (props.mode === 'abyss' ? (props.season as AbyssPeriod) : null))
const theater = computed(() => (props.mode === 'theater' ? (props.season as TheaterSeason) : null))
const stygian = computed(() => (props.mode === 'stygian' ? (props.season as StygianSeason) : null))

/** Floor 12's enemies, each at the level of the first chamber it appears in. */
const topEnemies = computed(() => {
  const season = abyss.value
  if (!season) return []
  const floor = season.floors.at(-1)
  return abyssTopEnemies(season).map((id) => {
    const chamber = floor?.chambers.find((c) => c.halves.flat().some((e) => e.monster === id))
    return {
      id,
      monster: monster(id),
      name: text.value.get(`monster.${id}`),
      level: chamber?.level ?? 0,
    }
  })
})

/** The bosses at the hardest difficulty, with their HP there (1 player). */
const bosses = computed(() => {
  const season = stygian.value
  const top = season && stygianTop(season)
  if (!top) return []
  return top.bosses.flatMap((id, i) => {
    const boss = props.data.data.stygianBosses.get(id)
    if (!boss) return []
    const full = text.value.get(`stygianBoss.${id}.name`)
    const hp = top.hp[i] ?? 0
    return [
      {
        boss,
        full,
        short: full.split(':')[0]!.trim(),
        codex: monster(boss.monster)?.codex ?? 0,
        level: top.level,
        hp,
        hpTip: hp ? `${t('endgame.hpAt', { n: top.level })}: ${formatNumber(hp)}` : '',
      },
    ]
  })
})
const art = computed(() => {
  if (abyss.value) return gameIcon(abyss.value.icon)
  if (theater.value) return characterBanner(theater.value.opening[0] ?? '')
  return ''
})
</script>

<template>
  <section
    class="relative grid min-w-0 overflow-hidden rounded-xl border border-border-default bg-surface-raised shadow-sm transition-colors hover:border-border-strong lg:grid-cols-[minmax(0,620px)_minmax(0,1fr)]"
  >
    <div
      class="relative isolate min-h-52 overflow-hidden bg-surface-sunken sm:min-h-72"
      :class="stygian && STYGIAN_GROUND"
    >
      <img v-if="art" :src="art" alt="" class="absolute inset-0 size-full object-cover" />
      <!-- The bosses side by side, a little overlapped like the game's lineup. -->
      <div
        v-if="stygian"
        class="absolute inset-0 flex items-center justify-center overflow-hidden px-2"
      >
        <BossPicture
          v-for="(b, i) in bosses"
          :key="b.boss.id"
          :src="gameIcon(stygianBossPicture(b.boss).name)"
          :art="stygianBossPicture(b.boss).art"
          :zoom="1.25"
          :name="b.full"
          class="aspect-square w-[42%] max-w-72"
          :class="[i > 0 && '-ml-[9%]', i === 1 && 'z-10']"
        />
      </div>
      <span
        v-if="theater"
        class="absolute right-3 bottom-3 flex gap-1 rounded-full bg-surface-base/80 px-2 py-1"
      >
        <ElementIcon v-for="e in theater.elements" :key="e" :element="element(e)" size="lg" />
      </span>
      <span
        class="absolute bottom-3 left-3 z-20 rounded-full px-2.5 py-0.5 text-xs font-semibold"
        :class="
          left > 0
            ? 'bg-surface-base/85 text-success-text'
            : 'bg-surface-base/85 text-text-secondary'
        "
        >{{
          left > 0 ? $t('endgame.activeLeft', { n: left }, left) : $t('endgame.status.ended')
        }}</span
      >
    </div>

    <div class="flex min-w-0 flex-col gap-3.5 p-4 sm:p-6">
      <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 class="min-w-0 text-2xl font-bold break-words">{{ name }}</h2>
        <span class="tabular font-mono text-xs text-text-muted">{{ period }}</span>
      </div>

      <template v-if="abyss">
        <GameText
          :text="text.get(`abyss.${abyss.id}.desc`)"
          :sprites="data.data.sprites"
          :sprite-name="sprite"
          class="line-clamp-3 text-sm leading-relaxed text-text-secondary"
        />
        <div class="flex flex-col gap-2">
          <span class="text-xs font-semibold tracking-wide text-text-muted uppercase">{{
            $t('endgame.abyss.floor', { n: abyss.floors.at(-1)?.floor ?? 12 })
          }}</span>
          <div class="flex flex-wrap gap-1.5">
            <component
              :is="e.monster?.codex ? 'button' : 'span'"
              v-for="e in topEnemies"
              :key="e.id"
              :type="e.monster?.codex ? 'button' : undefined"
              :title="e.name"
              class="relative z-20 rounded-lg"
              @click="e.monster?.codex && $emit('enemy', e.monster.codex, e.level)"
            >
              <GameIcon :src="gameIcon(e.monster?.icon ?? '')" :name="e.name" size="md" />
            </component>
          </div>
        </div>
      </template>

      <template v-else-if="theater">
        <div
          v-for="group in ['opening', 'guests'] as const"
          :key="group"
          class="flex flex-col gap-2"
        >
          <span
            class="text-xs font-semibold tracking-wide uppercase"
            :class="group === 'guests' ? 'text-warning-text' : 'text-text-muted'"
            >{{ $t(`endgame.theater.${group}`) }}</span
          >
          <ul class="flex flex-wrap gap-1">
            <li
              v-for="key in theater[group]"
              :key="key"
              class="flex w-12 flex-col items-center gap-1"
            >
              <img
                :src="characterIcon(key)"
                :alt="characterName(key)"
                class="size-11 rounded-full border-2 bg-surface-overlay object-cover"
                :class="group === 'guests' ? 'border-warning-text' : 'border-border-strong'"
              />
              <span class="w-full truncate text-center text-xs text-text-secondary">{{
                characterName(key)
              }}</span>
            </li>
          </ul>
        </div>
      </template>

      <ul v-else class="flex flex-col gap-1">
        <li v-for="b in bosses" :key="b.boss.id">
          <component
            :is="b.codex ? 'button' : 'div'"
            :type="b.codex ? 'button' : undefined"
            class="relative z-20 flex w-full min-w-0 items-center gap-3 rounded-lg p-1 text-left"
            :class="b.codex && 'transition-colors hover:bg-surface-overlay'"
            :title="b.full"
            @click="b.codex && $emit('enemy', b.codex, b.level)"
          >
            <GameIcon :src="gameIcon(b.boss.icon)" :name="b.full" size="sm" />
            <span class="min-w-0 flex-1 truncate text-sm font-semibold">{{ b.short }}</span>
            <span
              class="tabular shrink-0 font-mono text-sm font-semibold"
              :class="b.hp ? 'text-danger-text' : 'text-text-muted'"
              :title="b.hpTip"
              >♥ {{ b.hp ? formatShort(b.hp) : '—' }}</span
            >
          </component>
        </li>
      </ul>
    </div>
    <!-- The whole card opens the season; the enemies above it open their entry. -->
    <RouterLink
      :to="to"
      :aria-label="name"
      class="absolute inset-0 z-10 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    />
  </section>
</template>
