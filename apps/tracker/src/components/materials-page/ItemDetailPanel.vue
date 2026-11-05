<script setup lang="ts">
import { computed } from 'vue'
import { gameTextLines, type MaterialDetail } from '@gdt/game-data/material-details'
import { CARD_BODY, CARD_MUTED } from '@/components/artifacts/card-style'
import GameStars from '@/components/characters/GameStars.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import { EMBLEM_URL, RARITY_GRADIENT, emblemFromRight, qualityArt } from '@/lib/item-art'
import MaterialIcon from './MaterialIcon.vue'

/**
 * The game's item detail panel for a material: the rarity's header art
 * (gradient and emblem) with the name on its darker bar, the type line, gold
 * stars and the icon; then the description and the "Source" lines on the
 * artifact card's body (cream on light, deep slate on dark). Text comes from
 * the game data (utils/materials `loadMaterialDetail`); `detail` undefined
 * with `loading` shows placeholder lines, without it only the header.
 * Slot `close`: the dialog's close button, on the name bar.
 */
const props = defineProps<{
  name: string
  rarity: number | null
  icon: string
  detail: MaterialDetail | undefined
  loading: boolean
}>()

/** The header: 176px, the name bar 46px, the 116px icon 16px from the right, centred below the bar. */
const BAND = 176
const BAR = 46
const ICON = 116
const ICON_RIGHT = 16
const ICON_CENTRE = BAR + (BAND - BAR) / 2
const EMBLEM_STYLE = emblemFromRight(BAND, ICON_RIGHT, ICON, ICON_CENTRE)

const lines = computed(() => gameTextLines(props.detail?.description ?? ''))

/**
 * A coloured run (places, key terms): the game's colour mixed toward the
 * body's ink, so the light game colours stay readable on cream and on slate.
 */
const runColor = (color: string) => `color-mix(in oklab, ${color} 55%, var(--artifact-ink))`
</script>

<template>
  <section :aria-label="name" class="flex min-w-0 flex-col" :class="CARD_BODY">
    <div
      class="relative shrink-0 overflow-hidden"
      :style="{ height: `${BAND}px`, background: (rarity && RARITY_GRADIENT[rarity]) || '#72778b' }"
    >
      <img
        v-if="qualityArt(rarity)"
        :src="qualityArt(rarity)"
        alt=""
        class="absolute inset-0 size-full"
        aria-hidden="true"
      />
      <img
        :src="EMBLEM_URL"
        alt=""
        class="absolute max-w-none opacity-70"
        data-skeleton="off"
        :style="EMBLEM_STYLE"
        aria-hidden="true"
      />
      <span
        class="absolute [filter:drop-shadow(0_3px_6px_rgba(40,20,4,0.35))]"
        :style="{
          right: `${ICON_RIGHT}px`,
          top: `${ICON_CENTRE - ICON / 2}px`,
          width: `${ICON}px`,
          height: `${ICON}px`,
        }"
        aria-hidden="true"
      >
        <MaterialIcon :src="icon" :name="name" />
      </span>
      <div
        class="relative flex items-center gap-2 bg-black/20 pr-1 pl-4 sm:pl-5"
        :style="{ height: `${BAR}px` }"
      >
        <h2
          class="min-w-0 flex-1 truncate text-lg font-semibold text-(--artifact-band-ink) [text-shadow:0_1px_2px_rgba(40,20,4,0.6)]"
        >
          {{ name }}
        </h2>
        <slot name="close" />
      </div>
      <div
        class="relative flex flex-col gap-1 pt-2 pl-4 text-(--artifact-band-ink) [text-shadow:0_1px_2px_rgba(40,20,4,0.6)] sm:pl-5"
        :style="{ maxWidth: `calc(100% - ${ICON + ICON_RIGHT + 8}px)` }"
      >
        <p v-if="detail?.type" class="text-sm leading-snug">{{ detail.type }}</p>
        <UiSkeleton v-else-if="loading" class="h-4 w-40 opacity-40" />
      </div>
      <GameStars
        v-if="rarity"
        :rarity="rarity"
        :px="20"
        :gap="1"
        class="absolute bottom-3 left-3.5 sm:left-4.5"
      />
    </div>

    <div
      v-if="detail?.description || detail?.sources.length || loading"
      class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 pt-4 pb-5 text-[0.9375rem] leading-relaxed sm:px-5"
    >
      <div v-if="detail?.description" class="flex flex-col gap-2">
        <p v-for="(line, i) in lines" :key="i" class="min-h-2 break-words">
          <template v-for="(run, j) in line" :key="j">
            <span v-if="run.color" class="font-semibold" :style="{ color: runColor(run.color) }">{{
              run.text
            }}</span>
            <template v-else>{{ run.text }}</template>
          </template>
        </p>
      </div>
      <div v-else-if="loading" class="flex flex-col gap-2" aria-hidden="true">
        <UiSkeleton class="h-4 w-full opacity-60" />
        <UiSkeleton class="h-4 w-11/12 opacity-60" />
        <UiSkeleton class="h-4 w-2/3 opacity-60" />
      </div>
      <div v-if="detail?.sources.length" class="flex flex-col gap-1.5">
        <h3 class="text-xs font-semibold" :class="CARD_MUTED">
          {{ $t('materials.detail.source') }}
        </h3>
        <p
          v-for="source in detail.sources"
          :key="source"
          class="rounded-md bg-(--artifact-ink)/8 px-3 py-2 text-sm"
        >
          {{ source }}
        </p>
      </div>
    </div>
  </section>
</template>
