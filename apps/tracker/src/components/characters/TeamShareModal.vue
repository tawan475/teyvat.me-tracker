<script setup lang="ts">
import { computed, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import { ChevronLeft } from 'lucide-vue-next'
import type { AccountResponse } from '@gdt/shared'
import CardLoading from '@/components/share/CardLoading.vue'
import ShareActions from '@/components/share/ShareActions.vue'
import ShareMenu from '@/components/share/ShareMenu.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiModal from '@/components/ui/UiModal.vue'
import { buildPanel, shareUid, talentLevels } from '@/data/character-build'
import type { CharacterView } from '@/data/characters'
import { t } from '@/i18n'
import { locale } from '@/i18n/locale'
import { canvasPng } from '@/lib/card-canvas'
import { useExpNeed } from '@/lib/exp-need'
import { readJson, writeJson } from '@/lib/storage'
import { resolvedTheme } from '@/lib/theme'
import { useCardExport } from '@/lib/use-card-export'
import type { CardOwner } from './share-card'
import { expShare } from './share-card-model'
import { TEAM_CARD_SCALE, TEAM_CARD_WIDTH, teamCardHeight, teamFileName } from './team-card'
import { drawTeamCard, type DrawnTeam } from './team-card-canvas'
import { useConstellationBoostTable, useCrownIcon } from './use-boosts'

/**
 * The team card's dialog: two to four characters, one row each (Share
 * build's picks, or a saved team with its name on top). Like the roster
 * card's dialog: the card is drawn on a canvas once per change and the
 * preview is that canvas; the options (theme, name, UID: the share card's
 * one remembered set) and PNG / Copy / Share sit in the header; Back
 * returns to the picker.
 */
const props = defineProps<{
  open: boolean
  members: readonly CharacterView[]
  /** The saved team's name, as the header of the card; null for Share build's picks. */
  teamName: string | null
  account: AccountResponse
  playerUid: number | null
  ar: number | null
}>()
defineEmits<{ close: []; back: [] }>()

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
const takenAt = computed(() => props.account.latest?.takenAt ?? null)
const title = computed(() => props.teamName || t('characters.team.title'))

// Talents as the game shows them (C3/C5 boosts), the crown, the EXP bars.
const boostTable = useConstellationBoostTable()
const crown = useCrownIcon()
const expNeed = useExpNeed()

/** One drawing per change while open: the preview's canvas, and its PNG once asked for. */
interface Drawing {
  drawn: DrawnTeam
  png: Promise<Blob> | null
}
const drawing = shallowRef<Promise<Drawing> | null>(null)
const shown = shallowRef<DrawnTeam | null>(null)
/** The drawing's pictures loaded so far, of all (CardLoading's bar). */
const progress = ref<{ loaded: number; total: number } | null>(null)
let drawId = 0
/** A progress callback for one drawing: only the newest one moves the bar. */
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
  // As big as the dialog allows, whole: width-bound, or height-bound on a short screen.
  // As wide as the dialog (a tall card scrolls; height-bound left the sides empty: the user, 2026-11-07).
  drawn.canvas.className = 'mx-auto block h-auto w-full'
  drawn.canvas.setAttribute('role', 'img')
  drawn.canvas.setAttribute('aria-label', title.value)
  el.replaceChildren(drawn.canvas)
})

function redraw() {
  if (!props.open || props.members.length === 0) return
  const boosts = boostTable.value
  const need = expNeed.value
  const onProgress = progressOf()
  const promise = (async (): Promise<Drawing> => {
    const drawn = await drawTeamCard(
      {
        members: props.members.map((c) => ({
          character: c,
          panel: buildPanel(c),
          talents: talentLevels(c.talent, c.constellation, boosts?.(c.key) ?? null),
          levelBar: expShare(c.exp, need?.character(c.level, c.ascension)),
          friendshipBar:
            c.friendship === null
              ? null
              : expShare(c.friendshipExp, need?.friendship(c.friendship)),
        })),
        teamName: props.teamName,
        theme: theme.value,
        owner: owner.value,
        takenAt: takenAt.value,
        crown: crown.value,
      },
      TEAM_CARD_SCALE,
      onProgress,
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
  () => [
    props.open,
    props.members,
    props.teamName,
    theme.value,
    owner.value,
    locale.value,
    boostTable.value,
    crown.value,
    expNeed.value,
  ],
  redraw,
  { immediate: true },
)
// A new set of members starts from the skeleton, not the last team's card.
watch(
  () => props.members,
  () => (shown.value = null),
)

const exporter = useCardExport({
  draw: async () => {
    if (!drawing.value) redraw()
    if (!drawing.value) throw new Error('Closed')
    const done = await drawing.value
    done.png ??= canvasPng(done.drawn.canvas)
    return { blob: await done.png, missing: done.drawn.missing }
  },
  open: () => props.open && props.members.length > 0,
  state: () => [
    props.members,
    props.teamName,
    theme.value,
    owner.value,
    locale.value,
    boostTable.value,
    crown.value,
    expNeed.value,
  ],
  filename: () =>
    teamFileName(
      props.teamName,
      props.members.map((c) => c.key),
    ),
  title: () => title.value,
  pngLabel: () => t('share.export.downloadSized', { size: size.value }),
})
const size = computed(
  () =>
    `${TEAM_CARD_WIDTH * TEAM_CARD_SCALE} × ${teamCardHeight(props.members.length) * TEAM_CARD_SCALE}`,
)
</script>

<template>
  <UiModal :open="open" :title="title" size="detail" @close="$emit('close')">
    <template #heading>
      <div class="mr-auto flex min-w-0 flex-1 items-center gap-1">
        <UiIconButton :label="$t('common.back')" class="-ml-2" @click="$emit('back')">
          <ChevronLeft class="size-5" aria-hidden="true" />
        </UiIconButton>
        <h2 class="min-w-0 truncate text-lg font-semibold">{{ title }}</h2>
      </div>
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

    <!-- The card: the canvas the PNG is encoded from, scaled to fit -->
    <div v-show="shown" ref="host" class="w-full" />
    <CardLoading
      v-if="!shown"
      :aspect="`${TEAM_CARD_WIDTH} / ${teamCardHeight(members.length)}`"
      :progress="progress"
      :label="title"
    />
  </UiModal>
</template>
