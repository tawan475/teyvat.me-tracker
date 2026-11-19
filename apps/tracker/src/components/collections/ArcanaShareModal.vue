<script setup lang="ts">
import { computed, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import CardLoading from '@/components/share/CardLoading.vue'
import ShareActions from '@/components/share/ShareActions.vue'
import ShareMenu from '@/components/share/ShareMenu.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import { loadLatestInventory } from '@/data/account-data'
import { shareUid } from '@/data/character-build'
import { buildProfileCard } from '@/data/profile-card'
import { travelerGender } from '@/data/traveler'
import { useResource } from '@/data/use-resource'
import { t } from '@/i18n'
import { locale } from '@/i18n/locale'
import { canvasPng } from '@/lib/card-canvas'
import { readJson, readStorage, writeJson, writeStorage } from '@/lib/storage'
import { useCardExport } from '@/lib/use-card-export'
import { useAccounts } from '@/stores/accounts'
import { useAccount } from '@/views/account/context'
import { ARCANA_CARD, arcanaFileName, type ArcanaLayout } from './arcana-card'
import { drawArcanaCard, type ArcanaDrawing, type DrawnArcana } from './arcana-card-canvas'

/**
 * The Lunar Arcana share card, as the endgame record cards
 * (RecordShareModal): drawn on a canvas once per change, the preview is that
 * canvas, the share cards' remembered name and UID options (no theme: this
 * card is always dark), PNG / Copy / Share in the header. Wide (1920×1080)
 * or tall (1080×1920), remembered per device.
 */
type Fixed = 'theme' | 'owner' | 'layout'
const props = defineProps<{
  open: boolean
  card: Omit<ArcanaDrawing, Fixed> | null
}>()
defineEmits<{ close: [] }>()

const wide = useMediaQuery('(min-width: 1024px)')
const account = useAccount()
const accounts = useAccounts()
const latest = useResource(
  () => (props.open ? account.value : null),
  (a) => (a?.latest ? loadLatestInventory(a) : Promise.resolve(null)),
)

interface Prefs {
  name?: boolean
  uid?: boolean
}
// Always the dark card (the user's call, 2026-11-18: the game's sky is a night
// sky); the shared option set's theme is left alone for the other cards.
const theme = ref<'light' | 'dark'>('dark')
const saved = readJson<Prefs>('share-card', {})
const showName = ref(saved.name ?? true)
const showUid = ref(saved.uid ?? false)
watch([showName, showUid], () =>
  writeJson('share-card', {
    ...readJson<object>('share-card', {}),
    name: showName.value,
    uid: showUid.value,
  }),
)
const LAYOUT_KEY = 'collections:arcana:card-layout'
const layout = ref<ArcanaLayout>(readStorage(LAYOUT_KEY) === 'tall' ? 'tall' : 'wide')
watch(layout, (value) => writeStorage(LAYOUT_KEY, value))
const layouts = computed(() => [
  { value: 'wide' as const, label: t('collections.arcana.layoutWide') },
  { value: 'tall' as const, label: t('collections.arcana.layoutTall') },
])

const owner = computed<ArcanaDrawing['owner']>(() => {
  const player = latest.data.value?.good.gi_player ?? null
  const card = buildProfileCard(
    player,
    null,
    accounts.displayName(account.value),
    travelerGender.value,
  )
  return {
    name: showName.value ? card.name : null,
    uid: showUid.value ? shareUid(account.value.uid, player?.uid ?? null) : null,
    ar: player?.ar ?? null,
  }
})
const title = computed(() => t('collections.tabs.lunarArcana'))
const spec = computed(() => ARCANA_CARD[layout.value])
const size = computed(() => `${spec.value.width} × ${spec.value.height}`)

interface Drawing {
  drawn: DrawnArcana
  png: Promise<Blob> | null
}
const drawing = shallowRef<Promise<Drawing> | null>(null)
const shown = shallowRef<DrawnArcana | null>(null)
const progress = ref<{ loaded: number; total: number } | null>(null)
let drawId = 0
function progressOf(): (loaded: number, total: number) => void {
  const id = ++drawId
  progress.value = null
  return (loaded, total) => {
    if (id === drawId) progress.value = { loaded, total }
  }
}
const host = useTemplateRef<HTMLElement>('host')
watch([shown, host], ([drawn, el]) => {
  if (!el || !drawn) return
  // A tall card is held to the dialog's height; a wide one to its width.
  drawn.canvas.className =
    layout.value === 'tall'
      ? 'mx-auto block h-auto w-full max-w-[min(100%,calc((100dvh-15rem)*0.5625))]'
      : 'mx-auto block h-auto w-full'
  drawn.canvas.setAttribute('role', 'img')
  drawn.canvas.setAttribute('aria-label', title.value)
  el.replaceChildren(drawn.canvas)
})

function redraw() {
  const card = props.card
  if (!props.open || !card || latest.loading.value) return
  const onProgress = progressOf()
  const input: ArcanaDrawing = {
    ...card,
    theme: theme.value,
    owner: owner.value,
    layout: layout.value,
  }
  const promise = drawArcanaCard(input, 1, onProgress).then(
    (drawn): Drawing => ({ drawn, png: null }),
  )
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
    props.card,
    theme.value,
    owner.value,
    layout.value,
    locale.value,
    latest.loading.value,
  ],
  redraw,
  { immediate: true },
)
watch([() => props.card, layout], () => (shown.value = null))

const exporter = useCardExport({
  draw: async () => {
    if (!drawing.value) redraw()
    if (!drawing.value) throw new Error('Closed')
    const done = await drawing.value
    done.png ??= canvasPng(done.drawn.canvas)
    return { blob: await done.png, missing: done.drawn.missing }
  },
  open: () => props.open && !!props.card,
  state: () => [props.card, theme.value, owner.value, layout.value, locale.value],
  filename: () => arcanaFileName(layout.value, props.card?.takenAt ?? null),
  title: () => title.value,
  pngLabel: () => t('share.export.downloadSized', { size: size.value }),
})
</script>

<template>
  <UiModal :open="open" :title="title" size="detail" @close="$emit('close')">
    <template #heading>
      <h2 class="mr-auto min-w-0 flex-1 truncate text-lg font-semibold">{{ title }}</h2>
      <!-- Wide screens: the card's shape in the header, where the theme switch sits on other cards. -->
      <UiSegmented
        v-if="wide"
        v-model="layout"
        :options="layouts"
        :label="$t('collections.arcana.layout')"
        class="shrink-0"
      />
      <ShareActions
        v-if="wide"
        v-model:theme="theme"
        v-model:name="showName"
        v-model:uid="showUid"
        :exporter="exporter"
        no-theme
      />
      <ShareMenu
        v-else
        v-model:theme="theme"
        v-model:name="showName"
        v-model:uid="showUid"
        :exporter="exporter"
        :size="$t('characters.modal.pngSize', { size })"
        no-theme
      />
    </template>

    <div class="flex flex-col gap-3">
      <UiSegmented
        v-if="!wide"
        v-model="layout"
        :options="layouts"
        :label="$t('collections.arcana.layout')"
        class="self-center"
      />
      <div v-show="shown" ref="host" class="w-full" />
      <CardLoading
        v-if="!shown"
        :aspect="`${spec.width} / ${spec.height}`"
        :progress="progress"
        :label="title"
        :class="
          layout === 'tall' ? 'mx-auto w-full max-w-[min(100%,calc((100dvh-15rem)*0.5625))]' : ''
        "
      />
    </div>
  </UiModal>
</template>
