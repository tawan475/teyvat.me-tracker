<script setup lang="ts">
import { computed, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import type { GiStygianRecord } from '@gdt/shared'
import type { StygianSeason } from '@gdt/game-data/endgame'
import ShareActions from '@/components/share/ShareActions.vue'
import ShareMenu from '@/components/share/ShareMenu.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import { loadLatestInventory } from '@/data/account-data'
import { shareUid } from '@/data/character-build'
import { stygianBossPicture, type EndgameData } from '@/data/endgame'
import { buildProfileCard, loadProfileArt } from '@/data/profile-card'
import { recordPlayers } from '@/data/stygian-coop'
import { travelerGender } from '@/data/traveler'
import { useResource } from '@/data/use-resource'
import { t } from '@/i18n'
import { locale } from '@/i18n/locale'
import { gameIcon } from '@/lib/assets'
import { canvasPng } from '@/lib/card-canvas'
import { readJson, writeJson } from '@/lib/storage'
import { resolvedTheme } from '@/lib/theme'
import { useCardExport } from '@/lib/use-card-export'
import { useAccounts } from '@/stores/accounts'
import { useAccount } from '@/views/account/context'
import { STYGIAN_CARD, seasonVersion, stygianFileName } from './stygian-card'
import {
  drawStygianCard,
  type DrawnStygian,
  type StygianBossArt,
  type StygianCardPlayer,
  type StygianProfile,
} from './stygian-card-canvas'

/**
 * A Stygian Onslaught record's share card (one record: solo or co-op):
 * drawn on a canvas once per change, the preview is that canvas; the share
 * cards' one remembered option set (theme, name, UID) and PNG / Copy /
 * Share in the header, like the banner card. The owner's in-game profile
 * (name card, picture and frame, name, signature), the UID and the team's
 * levels and constellations come from the newest capture; the season's
 * version from the wish banners' dated versions.
 */
const props = defineProps<{
  open: boolean
  record: GiStygianRecord | null
  season: StygianSeason
  data: EndgameData
  seasonName: string
}>()
defineEmits<{ close: [] }>()

const wide = useMediaQuery('(min-width: 1024px)')
const account = useAccount()
const latest = useResource(
  () => (props.open ? account.value : null),
  (a) => (a?.latest ? loadLatestInventory(a) : Promise.resolve(null)),
)
const good = computed(() => latest.data.value?.good ?? null)
const accounts = useAccounts()
// The name cards' and profile pictures' art, and the banners' versions (both lazy, cached).
const extras = useResource(
  () => (props.open ? 'stygian-card' : null),
  async (key) => {
    if (!key) return null
    const [art, banners] = await Promise.all([
      loadProfileArt(),
      import('@/data/wish-banners.json').then(
        (m) => (m.default as unknown as { banners: unknown[][] }).banners,
      ),
    ])
    const dated = banners.map((row) => ({
      kind: String(row[0]),
      start: String(row[1]),
      version: String(row[6]),
    }))
    return { art, banners: dated }
  },
)

interface Prefs {
  theme?: 'light' | 'dark'
  name?: boolean
  uid?: boolean
}
const saved = readJson<Prefs>('share-card', {})
const theme = ref<'light' | 'dark'>(saved.theme ?? resolvedTheme.value)
const showName = ref(saved.name ?? true)
const showUid = ref(saved.uid ?? false)
watch([theme, showName, showUid], () =>
  writeJson('share-card', {
    ...readJson<object>('share-card', {}),
    theme: theme.value,
    name: showName.value,
    uid: showUid.value,
  }),
)

const profile = computed<StygianProfile>(() => {
  const player = good.value?.gi_player ?? null
  const card = buildProfileCard(
    player,
    extras.data.value?.art,
    accounts.displayName(account.value),
    travelerGender.value,
  )
  return {
    ...card,
    name: showName.value ? card.name : null,
    signature: showName.value ? card.signature : null,
    uid: showUid.value ? shareUid(account.value.uid, player?.uid ?? null) : null,
  }
})
/** A co-op record's players for the foot line; names follow the Name option. */
const players = computed<StygianCardPlayer[]>(() =>
  props.record
    ? recordPlayers(props.record).map((pl) => {
        const icon = pl.picture ? extras.data.value?.art.avatars.get(pl.picture) : undefined
        return {
          p: pl.p,
          self: pl.self,
          picture: icon ? gameIcon(icon) : '',
          name: showName.value ? pl.nickname || `${pl.p}P` : null,
        }
      })
    : [],
)
const version = computed(() =>
  extras.data.value ? seasonVersion(props.season.start, extras.data.value.banners) : null,
)
const roster = computed(
  () =>
    new Map(
      (good.value?.characters ?? []).map((c) => [
        c.key,
        { level: c.level, constellation: c.constellation },
      ]),
    ),
)
const row = computed(() =>
  props.record
    ? (props.season.difficulties.find((d) => d.difficulty === props.record!.difficulty) ?? null)
    : null,
)
const bosses = computed<(StygianBossArt | null)[]>(() =>
  (props.record?.fights ?? []).map((_, i) => {
    const id = row.value?.bosses[i]
    if (id === undefined) return null
    const boss = props.data.data.stygianBosses.get(id)
    return {
      name: props.data.text.get(`stygianBoss.${id}.name`) ?? '',
      art: boss ? gameIcon(stygianBossPicture(boss).name) : '',
    }
  }),
)
const title = computed(() => t('endgame.share.title'))

interface Drawing {
  drawn: DrawnStygian
  png: Promise<Blob> | null
}
const drawing = shallowRef<Promise<Drawing> | null>(null)
const shown = shallowRef<DrawnStygian | null>(null)
const host = useTemplateRef<HTMLElement>('host')
watch([shown, host], ([drawn, el]) => {
  if (!el || !drawn) return
  drawn.canvas.className =
    'mx-auto block h-auto w-auto max-w-full max-h-[calc(100dvh-6rem)] sm:max-h-[calc(90dvh-6rem)]'
  drawn.canvas.setAttribute('role', 'img')
  drawn.canvas.setAttribute('aria-label', title.value)
  el.replaceChildren(drawn.canvas)
})

function redraw() {
  const record = props.record
  if (!props.open || !record || latest.loading.value || extras.loading.value) return
  const promise = (async (): Promise<Drawing> => ({
    drawn: await drawStygianCard({
      record,
      seasonName: props.seasonName,
      start: props.season.start,
      end: props.season.end,
      version: version.value,
      bosses: bosses.value,
      roster: roster.value,
      theme: theme.value,
      profile: profile.value,
      players: players.value,
    }),
    png: null,
  }))()
  drawing.value = promise
  promise.then(
    (done) => {
      if (drawing.value === promise) shown.value = done.drawn
    },
    () => undefined,
  )
}
watch(
  () => [
    props.open,
    props.record,
    theme.value,
    profile.value,
    players.value,
    version.value,
    roster.value,
    locale.value,
    latest.loading.value,
    extras.loading.value,
  ],
  redraw,
  { immediate: true },
)
watch(
  () => props.record,
  () => (shown.value = null),
)

const size = `${STYGIAN_CARD.width} × ${STYGIAN_CARD.height}`
const exporter = useCardExport({
  draw: async () => {
    if (!drawing.value) redraw()
    if (!drawing.value) throw new Error('Closed')
    const done = await drawing.value
    done.png ??= canvasPng(done.drawn.canvas)
    return { blob: await done.png, missing: done.drawn.missing }
  },
  open: () => props.open && !!props.record,
  state: () => [props.record, theme.value, profile.value, roster.value, locale.value],
  filename: () => stygianFileName(props.season.start, props.record?.coop ?? false),
  title: () => title.value,
  pngLabel: () => t('share.export.downloadSized', { size }),
})
</script>

<template>
  <UiModal :open="open" :title="title" size="detail" @close="$emit('close')">
    <template #heading>
      <h2 class="mr-auto min-w-0 flex-1 truncate text-lg font-semibold">{{ title }}</h2>
      <ShareActions
        v-if="wide"
        v-model:theme="theme"
        v-model:name="showName"
        v-model:uid="showUid"
        :exporter="exporter"
      />
      <ShareMenu
        v-else
        v-model:theme="theme"
        v-model:name="showName"
        v-model:uid="showUid"
        :exporter="exporter"
        :size="$t('characters.modal.pngSize', { size })"
      />
    </template>

    <div v-show="shown" ref="host" class="w-full" />
    <UiSkeleton
      v-if="!shown"
      class="mx-auto w-full max-w-full rounded-xl"
      :style="{ aspectRatio: `${STYGIAN_CARD.width} / ${STYGIAN_CARD.height}` }"
    />
  </UiModal>
</template>
