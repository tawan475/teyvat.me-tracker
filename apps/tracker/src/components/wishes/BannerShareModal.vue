<script setup lang="ts">
import { computed, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import type { AccountResponse, UigfGachaType } from '@gdt/shared'
import ShareActions from '@/components/share/ShareActions.vue'
import ShareMenu from '@/components/share/ShareMenu.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import { shareUid } from '@/data/character-build'
import type { EventBanner, PullRow } from '@/data/wish-history'
import { t } from '@/i18n'
import { locale } from '@/i18n/locale'
import { canvasPng } from '@/lib/card-canvas'
import { readJson, writeJson } from '@/lib/storage'
import { resolvedTheme } from '@/lib/theme'
import { useCardExport } from '@/lib/use-card-export'
import type { CardOwner } from '../characters/share-card'
import { bannerCardLayout, bannerCardNumbers, bannerFileName } from './banner-card'
import { drawBannerCard, type DrawnBanner } from './banner-card-canvas'

/**
 * The banner share card's dialog (one banner run's pulls, from Banner
 * history): drawn on a canvas once per change and the preview is that
 * canvas, like the team card's; the options (theme, name, UID: the share
 * cards' one remembered set) and PNG / Copy / Share in the header.
 */
const props = defineProps<{
  open: boolean
  banner: EventBanner | null
  type: UigfGachaType
  phase: number
  /** The run's pulls, newest first, and their run numbers. */
  pulls: readonly PullRow[]
  rolls: ReadonlyMap<PullRow, number>
  account: AccountResponse
  playerUid: number | null
  ar: number | null
}>()
defineEmits<{ close: [] }>()

const wide = useMediaQuery('(min-width: 1024px)')

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

const owner = computed<CardOwner>(() => ({
  name: showName.value ? props.account.name : null,
  uid: showUid.value ? shareUid(props.account.uid, props.playerUid) : null,
  ar: showName.value ? props.ar : null,
}))
const numbers = computed(() => bannerCardNumbers(props.pulls, props.rolls))
const title = computed(() => t('wishes.share.title'))
const now = Date.now() / 1000
const isOpen = computed(() => !!props.banner && props.banner.start <= now && now < props.banner.end)

interface Drawing {
  drawn: DrawnBanner
  png: Promise<Blob> | null
}
const drawing = shallowRef<Promise<Drawing> | null>(null)
const shown = shallowRef<DrawnBanner | null>(null)
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
  const banner = props.banner
  if (!props.open || !banner) return
  const promise = (async (): Promise<Drawing> => ({
    drawn: await drawBannerCard({
      banner,
      type: props.type,
      phase: props.phase,
      numbers: numbers.value,
      theme: theme.value,
      owner: owner.value,
      open: isOpen.value,
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
  () => [props.open, props.banner, numbers.value, theme.value, owner.value, locale.value],
  redraw,
  { immediate: true },
)
watch(
  () => props.banner,
  () => (shown.value = null),
)

const layout = computed(() => bannerCardLayout(numbers.value.fives.length))
const size = computed(() => `${layout.value.width} × ${layout.value.height}`)
const exporter = useCardExport({
  draw: async () => {
    if (!drawing.value) redraw()
    if (!drawing.value) throw new Error('Closed')
    const done = await drawing.value
    done.png ??= canvasPng(done.drawn.canvas)
    return { blob: await done.png, missing: done.drawn.missing }
  },
  open: () => props.open && !!props.banner,
  state: () => [props.banner, numbers.value, theme.value, owner.value, locale.value],
  filename: () =>
    props.banner ? bannerFileName(props.banner, props.phase) : 'banner-teyvat-me.png',
  title: () => title.value,
  pngLabel: () => t('share.export.downloadSized', { size: size.value }),
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
      :style="{ aspectRatio: `${layout.width} / ${layout.height}` }"
    />
  </UiModal>
</template>
