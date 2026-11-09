<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { ChevronRight, Swords } from 'lucide-vue-next'
import ModeCards from '@/components/endgame/ModeCards.vue'
import {
  ENDGAME_MODES,
  loadEndgameData,
  seasonName,
  startedSeasons,
  type AnySeason,
  type EndgameMode,
} from '@/data/endgame'
import { useResource } from '@/data/use-resource'
import { locale } from '@/i18n/locale'
import { loadGameIcons } from '@/lib/assets'
import { pageNow, useAccount, useAccountRoute, useTravel } from '@/views/account/context'

/**
 * Overview's "Endgame now": the Endgame page's mode cards (the Abyss, the
 * Theater and the Stygian on now, days left, a preview of each), each opening
 * its mode. Game data only: no request to the tracker.
 */
const account = useAccount()
const accountRoute = useAccountRoute()
const resource = useResource(
  () => locale.value,
  async (lang) => {
    const [data] = await Promise.all([loadEndgameData(lang), loadGameIcons()])
    return data
  },
)
// Time travel: the seasons as they stood at the capture.
const travel = useTravel()
const now = ref(pageNow(travel.value))
const timer = setInterval(() => (now.value = pageNow(travel.value)), 60_000)
onBeforeUnmount(() => clearInterval(timer))

const server = computed(() => account.value.server)
const current = computed(() => {
  const data = resource.data.value
  return Object.fromEntries(
    ENDGAME_MODES.map((m) => [
      m,
      data ? (startedSeasons(data.data, m, now.value, server.value)[0] ?? null) : null,
    ]),
  ) as Record<EndgameMode, AnySeason | null>
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
const to = (m?: EndgameMode) => ({
  name: accountRoute('account-endgame'),
  params: { accountId: account.value.id, mode: m ?? '', season: '' },
})
</script>

<template>
  <section
    v-if="resource.data.value"
    class="flex flex-col gap-3"
    :aria-label="$t('shell.nav.endgame')"
  >
    <RouterLink
      :to="to()"
      class="group inline-flex items-center gap-2 self-start rounded-md text-base font-semibold focus-visible:outline-2 focus-visible:outline-accent"
    >
      <Swords class="size-4 text-accent-text" aria-hidden="true" />
      {{ $t('overview.endgameNow') }}
      <ChevronRight
        class="size-4 text-text-muted transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </RouterLink>
    <ModeCards
      :data="resource.data.value"
      :current="current"
      :now="now"
      :server="server"
      :name-of="nameOf"
      :to="(m) => to(m)"
    />
  </section>
</template>
