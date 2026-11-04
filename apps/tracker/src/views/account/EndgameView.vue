<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import ModeCards from '@/components/endgame/ModeCards.vue'
import SeasonArchive from '@/components/endgame/SeasonArchive.vue'
import SeasonHero from '@/components/endgame/SeasonHero.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import UiError from '@/components/ui/UiError.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import type { AbyssPeriod } from '@gdt/game-data/endgame'
import {
  ENDGAME_MODES,
  abyssRunFor,
  daysLeft,
  isEndgameMode,
  loadEndgameData,
  seasonName,
  seasonTime,
  startedSeasons,
  type AnySeason,
  type EndgameMode,
} from '@/data/endgame'
import { loadCapturedEndgame, NO_CAPTURED_ENDGAME } from '@/data/endgame-capture'
import { loadEnemyData } from '@/data/enemies'
import { useResource } from '@/data/use-resource'
import { locale } from '@/i18n/locale'
import { loadGameIcons } from '@/lib/assets'
import { formatMonthDay } from '@/lib/format'
import { t } from '@/i18n'
import { useAccount, useAccountRoute } from './context'

/**
 * Endgame: the Spiral Abyss, Imaginarium Theater and Stygian Onslaught.
 * The three modes are cards on top of every page (`/endgame/<mode>`); a
 * mode's page leads with its newest season as a picture card, then its
 * earlier seasons a year at a time; `/<id>` is one season, with older/newer
 * steps. Game data only, the same for every account; dates are read on the
 * account's server, and seasons not started yet are left out. An enemy opens
 * its Living Beings entry at the level it was clicked at (`?enemy=<id>&lv=`).
 * The account's own runs (Capture 1.17.12's gi_endgame, every capture's
 * extras section) mark the seasons they cover: the Theater run and the
 * Stygian records of a season on its page, a line on the cards.
 */
const route = useRoute()
const router = useRouter()
const account = useAccount()
const accountRoute = useAccountRoute()

const AbyssSeason = defineAsyncComponent(() => import('@/components/endgame/AbyssSeason.vue'))
const TheaterSeason = defineAsyncComponent(() => import('@/components/endgame/TheaterSeason.vue'))
const StygianSeason = defineAsyncComponent(() => import('@/components/endgame/StygianSeason.vue'))
const EnemyDialog = defineAsyncComponent(() => import('@/components/collections/EnemyDialog.vue'))
const SEASON_VIEW = { abyss: AbyssSeason, theater: TheaterSeason, stygian: StygianSeason }

const mode = computed<EndgameMode>(() =>
  isEndgameMode(route.params.mode) ? route.params.mode : 'abyss',
)
const seasonId = computed(() => Number(route.params.season) || 0)
const resource = useResource(
  () => locale.value,
  async (lang) => {
    const [data] = await Promise.all([loadEndgameData(lang), loadGameIcons()])
    return data
  },
)

// The account's own runs; nothing to read without a capture.
const captured = useResource(
  () => account.value,
  (a) => (a.latest ? loadCapturedEndgame(a) : Promise.resolve(NO_CAPTURED_ENDGAME)),
)
const yours = computed(() => captured.data.value ?? NO_CAPTURED_ENDGAME)

// The clock the statuses read: once a minute, so "days left" moves on while the page is open.
const now = ref(Date.now())
const timer = setInterval(() => (now.value = Date.now()), 60_000)
onBeforeUnmount(() => clearInterval(timer))
const server = computed(() => account.value.server)

const to = (m: EndgameMode, season?: number) => ({
  name: accountRoute('account-endgame'),
  params: { accountId: account.value.id, mode: m, season: season ? String(season) : '' },
})

const monthFormat = computed(
  () => new Intl.DateTimeFormat(locale.value, { year: 'numeric', month: 'long' }),
)
function nameOf(m: EndgameMode, season: AnySeason): string {
  const data = resource.data.value
  const name = data ? seasonName(m, season, data.text) : ''
  if (name) return name
  const [y, mo] = season.start.split('-').map(Number) as [number, number]
  return monthFormat.value.format(new Date(Date.UTC(y, mo - 1, 15)))
}
const periodOf = (s: AnySeason) =>
  t('endgame.period', {
    start: formatMonthDay(seasonTime(s.start, server.value)),
    end: formatMonthDay(seasonTime(s.end, server.value)),
  })

const listed = (m: EndgameMode) =>
  resource.data.value ? startedSeasons(resource.data.value.data, m, now.value, server.value) : []
const seasons = computed(() => listed(mode.value))
const current = computed(
  () =>
    Object.fromEntries(ENDGAME_MODES.map((m) => [m, listed(m)[0] ?? null])) as Record<
      EndgameMode,
      AnySeason | null
    >,
)
const index = computed(() => seasons.value.findIndex((s) => s.id === seasonId.value))
const season = computed(() => seasons.value[index.value] ?? null)
const older = computed(() => seasons.value[index.value + 1] ?? null)
const newer = computed(() => (index.value > 0 ? seasons.value[index.value - 1]! : null))
/** What the season page gets of the account's runs: its mode's part for that season. */
const seasonCapture = computed(() => {
  const s = season.value
  if (!s) return {}
  if (mode.value === 'abyss') {
    return { run: abyssRunFor(s as AbyssPeriod, yours.value, server.value) }
  }
  if (mode.value === 'theater') return { run: yours.value.theater.get(s.id) ?? null }
  if (mode.value === 'stygian') return { records: yours.value.stygian.get(s.id) ?? null }
  return {}
})

// Enemies open their Living Beings entry, loaded the first time one is asked for.
const enemyId = computed(() => Number(route.query.enemy) || 0)
const enemyLevel = computed(() => Number(route.query.lv) || undefined)
const enemies = useResource(
  () => (enemyId.value ? locale.value : null),
  (lang) => (lang ? loadEnemyData(lang) : Promise.resolve(null)),
)
const openEnemy = computed(() => enemies.data.value?.enemies.byId.get(enemyId.value) ?? null)
/**
 * The fight an enemy was opened from: its HP there (with the mode's bonus) and the version the
 * mode spawns (the Abyss's for the Abyss and the Theater, the Stygian's); not kept in the URL.
 */
const fight = ref<{ hp: number; before: boolean; where: string } | null>(null)
const version = computed(() => (mode.value === 'stygian' ? 'stygian' : 'abyss'))
function showEnemy(id: number | null, level?: number, hp = 0, before = false) {
  const query = { ...route.query }
  delete query.lv
  fight.value = id && hp ? { hp, before, where: t(`endgame.modes.${mode.value}`) } : null
  if (id) {
    query.enemy = String(id)
    if (level) query.lv = String(level)
  } else delete query.enemy
  void router.replace({ query })
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <PageHeader :title="$t('endgame.title')" />

    <UiError
      v-if="resource.error.value && !resource.data.value"
      :title="$t('endgame.loadFailed')"
      :error="resource.error.value"
      @retry="resource.reload"
    />
    <div v-else-if="!resource.data.value" class="flex flex-col gap-4" aria-busy="true">
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <UiSkeleton v-for="n in 3" :key="n" class="h-36" />
      </div>
      <UiSkeleton class="h-72 w-full" />
    </div>

    <template v-else>
      <ModeCards
        :data="resource.data.value"
        :current="current"
        :mode="mode"
        :now="now"
        :server="server"
        :name-of="nameOf"
        :to="(m) => to(m)"
      />

      <template v-if="seasonId && season">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <RouterLink
            :to="to(mode)"
            class="inline-flex items-center gap-1 rounded-md text-sm text-accent-text hover:underline"
          >
            <ChevronLeft class="size-4" aria-hidden="true" />{{ $t(`endgame.modes.${mode}`) }}
          </RouterLink>
          <div class="flex min-w-0 gap-2">
            <UiButton
              v-if="older"
              variant="secondary"
              size="sm"
              :to="to(mode, older.id)"
              :title="$t('endgame.olderSeason')"
              class="min-w-0"
            >
              <ChevronLeft class="size-4 shrink-0" aria-hidden="true" /><span class="truncate">{{
                nameOf(mode, older)
              }}</span>
            </UiButton>
            <UiButton
              v-if="newer"
              variant="secondary"
              size="sm"
              :to="to(mode, newer.id)"
              :title="$t('endgame.newerSeason')"
              class="min-w-0"
            >
              <span class="truncate">{{ nameOf(mode, newer) }}</span
              ><ChevronRight class="size-4 shrink-0" aria-hidden="true" />
            </UiButton>
          </div>
        </div>
        <component
          :is="SEASON_VIEW[mode]"
          :key="`${mode}-${season.id}`"
          :season="season as never"
          :data="resource.data.value"
          :name="nameOf(mode, season)"
          :period="periodOf(season)"
          :left="daysLeft(season, now, server)"
          v-bind="seasonCapture"
          @enemy="showEnemy"
        />
      </template>

      <UiEmpty v-else-if="!seasons.length" :title="$t('endgame.empty')" />
      <template v-else>
        <SeasonHero
          :key="`${mode}-${seasons[0]!.id}`"
          :mode="mode"
          :season="seasons[0]!"
          :data="resource.data.value"
          :name="nameOf(mode, seasons[0]!)"
          :period="periodOf(seasons[0]!)"
          :left="daysLeft(seasons[0]!, now, server)"
          :to="to(mode, seasons[0]!.id)"
          :captured="yours"
          :server="server"
          @enemy="showEnemy"
        />
        <SeasonArchive
          v-if="seasons.length > 1"
          :mode="mode"
          :seasons="seasons.slice(1)"
          :data="resource.data.value"
          :name-of="(s) => nameOf(mode, s)"
          :period-of="periodOf"
          :to="(s) => to(mode, s.id)"
          :captured="yours"
          :server="server"
        />
      </template>
    </template>

    <EnemyDialog
      v-if="enemies.data.value"
      :enemy="openEnemy"
      :data="enemies.data.value"
      :level="enemyLevel"
      :version="version"
      :fight="fight"
      @close="showEnemy(null)"
    />
  </div>
</template>
