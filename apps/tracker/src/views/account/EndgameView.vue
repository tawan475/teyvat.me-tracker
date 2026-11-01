<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft } from 'lucide-vue-next'
import SeasonList from '@/components/endgame/SeasonList.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import UiError from '@/components/ui/UiError.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import {
  ENDGAME_MODES,
  dateOf,
  isEndgameMode,
  loadEndgameData,
  seasonName,
  seasonStatus,
  startedSeasons,
  type AnySeason,
  type EndgameMode,
  type SeasonRow,
} from '@/data/endgame'
import { loadEnemyData } from '@/data/enemies'
import { useResource } from '@/data/use-resource'
import { locale } from '@/i18n/locale'
import { loadGameIcons } from '@/lib/assets'
import { t } from '@/i18n'
import { useAccount, useAccountRoute } from './context'

/**
 * Endgame: the Spiral Abyss, Imaginarium Theater and Stygian Onslaught as the
 * game lists them (`/endgame/<mode>`: seasons newest first; `/<id>`: one
 * season). Game data only, the same for every account; dates are read on the
 * account's server. An enemy opens its Living Beings entry (`?enemy=<id>`).
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

// The clock the statuses read: once a minute, so "Active" moves on while the page is open.
const now = ref(Date.now())
const timer = setInterval(() => (now.value = Date.now()), 60_000)
onBeforeUnmount(() => clearInterval(timer))

const to = (m: EndgameMode, season?: number) => ({
  name: accountRoute('account-endgame'),
  params: { accountId: account.value.id, mode: m, season: season ? String(season) : '' },
})
const modeOptions = computed(() =>
  ENDGAME_MODES.map((m) => ({ value: m, label: t(`endgame.modes.${m}`) })),
)
const chosenMode = computed({
  get: () => mode.value,
  set: (m: EndgameMode) => void router.replace(to(m)),
})

const monthFormat = computed(
  () => new Intl.DateTimeFormat(locale.value, { year: 'numeric', month: 'long' }),
)
function nameOf(season: AnySeason): string {
  const data = resource.data.value
  const name = data ? seasonName(mode.value, season, data.text) : ''
  if (name) return name
  const [y, m] = season.start.split('-').map(Number) as [number, number]
  return monthFormat.value.format(new Date(Date.UTC(y, m - 1, 15)))
}
const period = (s: AnySeason) => t('endgame.period', { start: dateOf(s.start), end: dateOf(s.end) })

const seasons = computed(() =>
  resource.data.value
    ? startedSeasons(resource.data.value.data, mode.value, now.value, account.value.server)
    : [],
)
const rows = computed<SeasonRow[]>(() =>
  seasons.value.map((s) => ({
    id: s.id,
    name: nameOf(s),
    status: seasonStatus(s, now.value, account.value.server) === 'active' ? 'active' : 'ended',
    period: period(s),
    to: to(mode.value, s.id),
  })),
)
const season = computed(() => seasons.value.find((s) => s.id === seasonId.value) ?? null)

// Enemies open their Living Beings entry, loaded the first time one is asked for.
const enemyId = computed(() => Number(route.query.enemy) || 0)
const enemies = useResource(
  () => (enemyId.value ? locale.value : null),
  (lang) => (lang ? loadEnemyData(lang) : Promise.resolve(null)),
)
const openEnemy = computed(() => enemies.data.value?.enemies.byId.get(enemyId.value) ?? null)
function showEnemy(id: number | null) {
  const query = { ...route.query }
  if (id) query.enemy = String(id)
  else delete query.enemy
  void router.replace({ query })
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <PageHeader :title="$t('endgame.title')" />

    <UiSegmented
      v-model="chosenMode"
      :options="modeOptions"
      :label="$t('endgame.modesLabel')"
      size="md"
      class="self-start max-sm:w-full"
    />

    <UiError
      v-if="resource.error.value && !resource.data.value"
      :title="$t('endgame.loadFailed')"
      :error="resource.error.value"
      @retry="resource.reload"
    />
    <div v-else-if="!resource.data.value" class="flex flex-col gap-2" aria-busy="true">
      <UiSkeleton v-for="n in 8" :key="n" class="h-16 w-full" />
    </div>

    <template v-else-if="seasonId && season">
      <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <UiIconButton :label="$t('endgame.allSeasons')" :to="to(mode)">
          <ArrowLeft class="size-5" aria-hidden="true" />
        </UiIconButton>
        <div class="flex min-w-0 flex-1 flex-col">
          <h2 class="truncate text-lg font-semibold">{{ nameOf(season) }}</h2>
          <p class="tabular truncate font-mono text-xs text-text-muted">
            {{ $t('endgame.id', { id: season.id }) }} · {{ period(season) }}
          </p>
        </div>
        <UiBadge
          :tone="seasonStatus(season, now, account.server) === 'active' ? 'success' : 'neutral'"
          >{{
            $t(
              `endgame.status.${seasonStatus(season, now, account.server) === 'active' ? 'active' : 'ended'}`,
            )
          }}</UiBadge
        >
      </div>
      <component
        :is="SEASON_VIEW[mode]"
        :key="`${mode}-${season.id}`"
        :season="season as never"
        :data="resource.data.value"
        @enemy="showEnemy"
      />
    </template>

    <UiEmpty v-else-if="!rows.length" :title="$t('endgame.empty')" />
    <SeasonList v-else :rows="rows" :label="$t('endgame.seasons')" />

    <EnemyDialog
      v-if="enemies.data.value"
      :enemy="openEnemy"
      :data="enemies.data.value"
      @close="showEnemy(null)"
    />
  </div>
</template>
