<script setup lang="ts">
import { computed, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import { TriangleAlert } from 'lucide-vue-next'
import type { AccountResponse } from '@gdt/shared'
import ShareActions from '@/components/share/ShareActions.vue'
import ShareMenu from '@/components/share/ShareMenu.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiProgress from '@/components/ui/UiProgress.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import { shareUid, talentLevels } from '@/data/character-build'
import type { CharacterView } from '@/data/characters'
import { t } from '@/i18n'
import { locale } from '@/i18n/locale'
import { formatDate } from '@/lib/format'
import { readJson, writeJson } from '@/lib/storage'
import { resolvedTheme } from '@/lib/theme'
import { useCardExport } from '@/lib/use-card-export'
import { ROSTER_SCALE, rosterColumns, rosterWidth } from './roster-card'
import { drawRoster, rosterPng, type DrawnRoster } from './roster-canvas'
import type { CardOwner } from './share-card'
import { constellationBoostsReady, useConstellationBoostTable } from './use-boosts'

/**
 * The roster share card's dialog (Characters page): the card, its options
 * (theme, name, UID; the share card's one remembered set, `share-card`) and
 * PNG / Copy / Share in the header, like the character dialog. The card is
 * drawn on a canvas (roster-canvas) once per change and the preview is that
 * canvas; the PNG is encoded from it only when an export asks (pointing at
 * the actions warms it): encoding ~6 million pixels takes about a second.
 * A phone first says the card takes a while and waits for "Make card";
 * while the pictures load a bar counts them.
 */
const props = defineProps<{
  open: boolean
  /** The roster as the page lists it (filters and sort). */
  characters: readonly CharacterView[]
  account: AccountResponse
  playerUid: number | null
  ar: number | null
}>()
defineEmits<{ close: [] }>()

const wide = useMediaQuery('(min-width: 1024px)')
/** Phones and tablets ask first (once per visit): a hundred pictures and a 6-megapixel canvas. */
const touch = useMediaQuery('(pointer: coarse)')
const agreed = ref(false)
const started = computed(() => agreed.value || !touch.value)

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
const takenAt = computed(() => props.account.latest?.takenAt ?? null)
const cardWidth = computed(() => rosterWidth(rosterColumns(props.characters.length)))

// Talents as the game shows them: C3/C5 boosts included. A drawing waits for that data
// (or its failure: base levels), so the card is drawn once, not again when it lands.
const boostTable = useConstellationBoostTable()

/** One drawing per change while open: the preview's canvas, and its PNG once asked for. */
interface Drawing {
  drawn: DrawnRoster
  png: Promise<Blob> | null
}
const drawing = shallowRef<Promise<Drawing> | null>(null)
const shown = shallowRef<DrawnRoster | null>(null)
/** The current drawing's pictures, loaded of all (null before it starts). */
const progress = ref<{ loaded: number; total: number } | null>(null)
const host = useTemplateRef<HTMLElement>('host')
watch([shown, host], ([drawn, el]) => {
  if (!el || !drawn) return
  // As big as the dialog allows, whole: width-bound, or height-bound on a short screen.
  drawn.canvas.className =
    'mx-auto block h-auto w-auto max-w-full max-h-[calc(100dvh-6rem)] sm:max-h-[calc(90dvh-6rem)]'
  drawn.canvas.setAttribute('role', 'img')
  drawn.canvas.setAttribute('aria-label', t('characters.roster.title'))
  el.replaceChildren(drawn.canvas)
})

function redraw() {
  if (!props.open || !started.value) return
  const promise = (async (): Promise<Drawing> => {
    await constellationBoostsReady()
    const boosts = boostTable.value
    const drawn = await drawRoster(
      {
        characters: props.characters,
        talents: new Map(
          props.characters.map((c) => [
            c.key,
            talentLevels(c.talent, c.constellation, boosts?.(c.key) ?? null),
          ]),
        ),
        theme: theme.value,
        owner: owner.value,
        date: takenAt.value ? formatDate(takenAt.value) : null,
        labels: {
          title: t('game.characters'),
          c6: t('characters.page.c6'),
          level90: t('characters.page.level90'),
        },
      },
      ROSTER_SCALE,
      (loaded, total) => {
        if (drawing.value === promise) progress.value = { loaded, total }
      },
    )
    return { drawn, png: null }
  })()
  drawing.value = promise
  promise.then(
    (done) => {
      if (drawing.value === promise) shown.value = done.drawn
    },
    () => undefined,
  )
}
watch(
  () => [props.open, started.value, props.characters, theme.value, owner.value, locale.value],
  redraw,
  { immediate: true },
)

const exporter = useCardExport({
  draw: async () => {
    if (!drawing.value) redraw()
    if (!drawing.value) throw new Error('Closed')
    const done = await drawing.value
    done.png ??= rosterPng(done.drawn)
    return { blob: await done.png, missing: done.drawn.missing }
  },
  open: () => props.open && started.value,
  state: () => [props.characters, theme.value, owner.value, locale.value],
  filename: () => 'characters-teyvat-me.png',
  title: () => t('game.characters'),
  pngLabel: () => t('share.export.download'),
})
const pngSize = computed(() =>
  t('characters.modal.pngSize', { size: `${Math.round(cardWidth.value * ROSTER_SCALE)} px` }),
)
</script>

<template>
  <UiModal
    :open="open"
    :title="$t('characters.roster.title')"
    size="detail"
    @close="$emit('close')"
  >
    <template #heading>
      <h2 class="mr-auto min-w-0 flex-1 truncate text-lg font-semibold">
        {{ $t('characters.roster.title') }}
      </h2>
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
        :size="pngSize"
      />
    </template>

    <!-- The card: the canvas the PNG is encoded from, scaled to fit -->
    <div v-show="shown" ref="host" class="w-full" />
    <div v-if="!shown" class="relative">
      <UiSkeleton class="aspect-[16/11] w-full rounded-xl" :class="!started && 'animate-none'" />
      <div class="absolute inset-0 flex items-center justify-center p-6">
        <div v-if="!started" class="flex max-w-xs flex-col items-center gap-3 text-center">
          <TriangleAlert class="size-6 text-warning-text" aria-hidden="true" />
          <p class="text-sm text-text-secondary">{{ $t('characters.roster.slow') }}</p>
          <UiButton variant="primary" @click="agreed = true">
            {{ $t('characters.roster.start') }}
          </UiButton>
        </div>
        <div v-else-if="progress" class="flex w-full max-w-xs flex-col items-center gap-2">
          <UiProgress
            :value="progress.loaded"
            :max="progress.total"
            :label="$t('characters.roster.title')"
          />
          <span class="tabular font-mono text-xs text-text-muted">{{
            progress.loaded < progress.total
              ? $t('characters.roster.pictures', { n: progress.loaded, total: progress.total })
              : $t('characters.roster.drawing')
          }}</span>
        </div>
      </div>
    </div>
  </UiModal>
</template>
