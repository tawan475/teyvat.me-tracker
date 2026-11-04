<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import type { AbyssPeriod, StygianSeason, TheaterSeason } from '@gdt/game-data/endgame'
import ElementIcon from '@/components/ui/ElementIcon.vue'
import FilterChip from '@/components/ui/FilterChip.vue'
import GameIcon from '@/components/ui/GameIcon.vue'
import BossPicture from './BossPicture.vue'
import {
  abyssRunFor,
  abyssRunLine,
  abyssTopEnemies,
  seasonYear,
  soloFirst,
  stygianBossPicture,
  stygianRecordLine,
  stygianTop,
  theaterRunLine,
  type AnySeason,
  type EndgameData,
  type EndgameMode,
} from '@/data/endgame'
import type { CapturedEndgame } from '@/data/endgame-capture'
import type { GenshinServer } from '@gdt/shared'
import { t } from '@/i18n'
import type { Element } from '@/data/game-meta'
import { characterName } from '@/i18n/game-names'
import { abyssArt, abyssArtFailed, characterBanner, characterIcon, gameIcon } from '@/lib/assets'
import { STYGIAN_GROUND } from './modes'

/**
 * A mode's earlier seasons as picture cards, one year at a time (year chips,
 * newest first): the Abyss's blessing art with Floor 12's enemies, the
 * Theater's namecard with its elements and Opening Characters, the Stygian
 * season's three bosses side by side. Each opens its season page. The
 * account's own run of a season (`captured`, Capture 1.17.12) is one line
 * under the name.
 */
const props = defineProps<{
  mode: EndgameMode
  seasons: readonly AnySeason[]
  data: EndgameData
  nameOf: (season: AnySeason) => string
  periodOf: (season: AnySeason) => string
  to: (season: AnySeason) => RouteLocationRaw
  captured?: CapturedEndgame | null
  /** The account's server: where the Abyss periods' dates are read. */
  server?: GenshinServer | null
}>()

const years = computed(() => [...new Set(props.seasons.map(seasonYear))])
const year = ref('')
watch(
  [() => props.mode, years],
  () => {
    if (!years.value.includes(year.value)) year.value = years.value[0] ?? ''
  },
  { immediate: true },
)
const shown = computed(() => props.seasons.filter((s) => seasonYear(s) === year.value))

const monster = (id: number) => props.data.data.monsters.get(id)
const monsterName = (id: number) => props.data.text.get(`monster.${id}`)
const element = (name: string) => name.toLowerCase() as Element
const abyss = (s: AnySeason) => s as AbyssPeriod
const theater = (s: AnySeason) => s as TheaterSeason
const bosses = (s: AnySeason) =>
  (stygianTop(s as StygianSeason)?.bosses ?? []).flatMap((id) => {
    const boss = props.data.data.stygianBosses.get(id)
    return boss ? [{ boss, name: props.data.text.get(`stygianBoss.${id}.name`) }] : []
  })
const shortName = (name: string) => name.split(':')[0]!.trim()

/** The account's own run of a season in a line ('' without one): the Theater's, or each Stygian record's. */
function yours(s: AnySeason): string {
  const c = props.captured
  if (!c) return ''
  if (props.mode === 'abyss') {
    const run = abyssRunFor(abyss(s), c, props.server)
    return run ? abyssRunLine(run.run).text : ''
  }
  if (props.mode === 'theater') {
    const run = c.theater.get(s.id)?.run
    return run ? theaterRunLine(run, theater(s), props.data.text).text : ''
  }
  if (props.mode === 'stygian') {
    return soloFirst(c.stygian.get(s.id)?.records ?? [])
      .map((r) => {
        const kind = r.coop ? t('endgame.captured.coop') : t('endgame.captured.solo')
        return `${kind} ${stygianRecordLine(r, props.data.text).text}`
      })
      .join(' / ')
  }
  return ''
}
</script>

<template>
  <section class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-base font-semibold">{{ $t('endgame.earlier') }}</h2>
      <div
        v-if="years.length > 1"
        role="radiogroup"
        :aria-label="$t('endgame.earlier')"
        class="scroll-hide scroll-fade-x flex min-w-0 gap-1.5 overflow-x-auto"
      >
        <FilterChip v-for="y in years" :key="y" radio :pressed="y === year" @toggle="year = y">{{
          y
        }}</FilterChip>
      </div>
    </div>

    <ul
      class="grid min-w-0 gap-3"
      :class="
        mode === 'stygian'
          ? 'grid-cols-1 md:grid-cols-2'
          : 'grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))]'
      "
    >
      <li v-for="s in shown" :key="s.id" class="min-w-0">
        <RouterLink
          :to="to(s)"
          class="flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-border-default bg-surface-raised shadow-sm transition-colors hover:border-border-strong hover:bg-surface-overlay"
        >
          <span
            class="relative block overflow-hidden bg-surface-sunken"
            :class="[
              mode === 'stygian'
                ? `aspect-[3/1] ${STYGIAN_GROUND}`
                : mode === 'theater'
                  ? 'aspect-[21/10]'
                  : 'aspect-[2/1]',
            ]"
          >
            <img
              v-if="mode === 'abyss'"
              :src="abyssArt(abyss(s).icon)"
              alt=""
              loading="lazy"
              class="size-full object-cover"
              @error="abyssArtFailed"
            />
            <img
              v-else-if="mode === 'theater'"
              :src="characterBanner(theater(s).opening[0] ?? '')"
              alt=""
              loading="lazy"
              class="size-full object-cover"
            />
            <span v-else class="grid size-full grid-cols-3">
              <BossPicture
                v-for="b in bosses(s)"
                :key="b.boss.id"
                :src="gameIcon(stygianBossPicture(b.boss).name)"
                :art="stygianBossPicture(b.boss).art"
                :name="b.name"
                :title="b.name"
                class="size-full"
              />
            </span>
            <span
              class="absolute inset-x-0 bottom-0 h-1/2 bg-linear-to-t from-surface-base/90 to-transparent"
            />
            <span class="tabular absolute bottom-2 left-3 font-mono text-xs text-text-secondary">{{
              periodOf(s)
            }}</span>
            <span v-if="mode === 'theater'" class="absolute right-2 bottom-1.5 flex gap-0.5">
              <ElementIcon
                v-for="e in theater(s).elements"
                :key="e"
                :element="element(e)"
                size="lg"
              />
            </span>
          </span>
          <span class="flex min-w-0 flex-col gap-2 p-3">
            <span class="truncate font-semibold">{{ nameOf(s) }}</span>
            <span
              v-if="yours(s)"
              class="truncate text-xs text-text-secondary"
              :title="`${$t('endgame.captured.run')}: ${yours(s)}`"
              >{{ yours(s) }}</span
            >
            <span v-if="mode === 'abyss'" class="flex gap-1">
              <GameIcon
                v-for="id in abyssTopEnemies(abyss(s), 5)"
                :key="id"
                :src="gameIcon(monster(id)?.icon ?? '')"
                :name="monsterName(id)"
                :title="monsterName(id)"
                size="xs"
              />
            </span>
            <span v-else-if="mode === 'theater'" class="flex gap-1">
              <img
                v-for="key in theater(s).opening"
                :key="key"
                :src="characterIcon(key)"
                :alt="characterName(key)"
                :title="characterName(key)"
                loading="lazy"
                class="size-7 rounded-full border border-border-strong bg-surface-overlay object-cover"
              />
            </span>
            <span v-else class="truncate text-xs text-text-muted">{{
              bosses(s)
                .map((b) => shortName(b.name))
                .join(' · ')
            }}</span>
          </span>
        </RouterLink>
      </li>
    </ul>
  </section>
</template>
