<script setup lang="ts">
import { computed, ref } from 'vue'
import { t } from '@/i18n'
import { FlaskConical, Lock, Sparkle } from 'lucide-vue-next'
import GameStars from '@/components/characters/GameStars.vue'
import CritValue from '@/components/ui/CritValue.vue'
import RollValue from '@/components/ui/RollValue.vue'
import { artifactLabel, type ArtifactRow } from '@/data/artifacts'
import { mainStatValue } from '@/data/characters'
import { artifactIcon, characterIcon, characterSideIcon } from '@/lib/assets'
import { isCritCirclet } from '@/lib/crit-tiers'
import { EMBLEM_URL, RARITY_GRADIENT, qualityArt } from '@/lib/item-art'
import { ROLL_QUALITY_BG, ROLL_QUALITY_FILL, maxLevel } from '@/utils/artifact-rolls'
import {
  formatRollValue,
  formatSlotFullName,
  formatStatName,
  formatStatShort,
  formatStatValue,
} from '@/utils/artifact-stats'
import {
  BAND_CHIP,
  BAND_EMBLEM_STYLE,
  BAND_HEIGHT,
  BAND_ICON,
  BAND_ICON_RIGHT,
  BAND_TEXT,
  CARD_BODY,
  CARD_FOOT,
  CARD_MUTED,
  CARD_SET,
} from './card-style'
import { artifactPieceName } from './piece-name'

/**
 * One artifact in the grid, after the game's artifact detail panel (the
 * user's pick of the designs): the art band (the rarity's header art with the
 * emblem behind the piece) carries its name, slot and stars, the main stat
 * in bold, and +20 / CV / RV (tier colours for 5★; plain below, as the tiers
 * are 5★ scales) with the CV it should reach at max; then the substats with
 * their roll bars beside the values, the set in the game's green and the
 * game's "Equipped" bar with the wearer's side portrait, the lock, astral
 * mark and elixir (a piece no one wears has no bar: its marks end the set's
 * line). The body is the game's cream on the light theme and deep
 * slate on the dark. Words live in tooltips and the detail dialog. A
 * transparent button covers the card, so the whole card is one click target
 * and its focus ring outlines the card.
 */
const props = defineProps<{
  row: ArtifactRow
  isNew?: boolean
  /** A picture, not a control (the dialog's preview, the share PNG): no click target. */
  still?: boolean
}>()
const emit = defineEmits<{ open: [id: number] }>()

const artifact = computed(() => props.row.artifact)
const inactive = computed(() => artifact.value.unactivatedSubstats ?? [])
const plain = computed(() => artifact.value.rarity < 5)
const label = computed(() => artifactLabel(props.row, props.isNew))
const crit = computed(() => isCritCirclet(artifact.value.slotKey, artifact.value.mainStatKey))
const potential = computed(() => props.row.potential)
const potentialTitle = computed(() =>
  t('artifacts.card.potentialTitle', {
    max: maxLevel(artifact.value.rarity),
    best: potential.value.bestCv.toFixed(1),
  }),
)
const name = computed(
  () => artifactPieceName(artifact.value.setKey, artifact.value.slotKey) ?? props.row.setName,
)
const mainValue = computed(() => {
  const value = mainStatValue(artifact.value)
  return value === null ? '—' : formatStatValue(artifact.value.mainStatKey, value)
})
/** The bars' slot fits this piece's most-rolled substat, so no empty slot pads the right. */
const barsWidth = computed(() => {
  const most = Math.max(1, ...props.row.rolls.map((r) => r.length))
  return `${most * 0.375 + (most - 1) * 0.125}rem`
})
/** A substat's tooltip: its value, then each roll on its own line (7.77%, 7.77%, 5.44%). */
function breakdown(index: number): string {
  const substat = artifact.value.substats[index]!
  const rolls = props.row.rolls[index] ?? []
  return [
    `${formatStatShort(substat.key)} ${formatStatValue(substat.key, substat.value)}`,
    ...rolls.map((roll) => formatRollValue(substat.key, roll.value)),
  ].join('\n')
}
function open() {
  if (!props.still) emit('open', props.row.id)
}
/** The side portrait; the round one where the data has no side art (or it fails). */
const sideFailed = ref(false)
const wearer = computed(() => {
  const key = artifact.value.location
  if (!key) return ''
  const side = sideFailed.value ? '' : characterSideIcon(key)
  return side || characterIcon(key)
})
</script>

<template>
  <article
    class="relative flex min-w-0 flex-col overflow-hidden rounded-xl shadow-sm ring-1 ring-(--artifact-ring)"
    :class="CARD_BODY"
  >
    <!-- The art band -->
    <div
      class="relative shrink-0 overflow-hidden"
      :style="{
        height: `${BAND_HEIGHT}px`,
        background: RARITY_GRADIENT[artifact.rarity] ?? '#72778b',
      }"
      aria-hidden="true"
    >
      <img
        v-if="qualityArt(artifact.rarity)"
        :src="qualityArt(artifact.rarity)"
        alt=""
        class="absolute inset-0 size-full"
      />
      <img
        :src="EMBLEM_URL"
        alt=""
        class="absolute max-w-none opacity-60"
        data-skeleton="off"
        :style="BAND_EMBLEM_STYLE"
      />
      <img
        :src="artifactIcon(artifact.setKey, artifact.slotKey)"
        alt=""
        class="absolute top-1/2 -translate-y-1/2 [filter:drop-shadow(0_3px_6px_rgba(70,36,6,0.35))]"
        :style="{
          right: `${BAND_ICON_RIGHT}px`,
          width: `${BAND_ICON}px`,
          height: `${BAND_ICON}px`,
        }"
      />
      <div class="relative flex h-full flex-col justify-center gap-0.5 px-3" :class="BAND_TEXT">
        <p class="truncate text-[0.9375rem] leading-tight font-semibold">{{ name }}</p>
        <p class="flex items-center gap-2 text-xs text-(--artifact-band-ink)/90">
          <span class="truncate">{{ formatSlotFullName(artifact.slotKey) }}</span>
          <GameStars :rarity="artifact.rarity" :px="11" :gap="0" class="shrink-0" />
        </p>
        <p class="flex max-w-[calc(100%-5rem)] items-baseline gap-2 leading-tight">
          <span class="truncate text-[0.9375rem] font-bold">{{
            formatStatName(artifact.mainStatKey)
          }}</span>
          <span class="tabular text-xl font-bold">{{ mainValue }}</span>
        </p>
        <!-- Above the card's button, so the numbers' tooltips show; a click still opens it. -->
        <p
          data-theme="dark"
          class="relative z-10 mt-0.5 flex cursor-pointer items-center gap-1.5 font-mono text-xs font-semibold [text-shadow:none]"
          @click="open"
        >
          <span :class="BAND_CHIP" class="text-(--artifact-band-ink)">+{{ artifact.level }}</span>
          <span :class="BAND_CHIP"
            ><span class="font-sans text-(--artifact-band-ink)/70">CV </span
            ><CritValue :value="row.cv" :crit-circlet="crit" :plain="plain"
          /></span>
          <span :class="BAND_CHIP"
            ><span class="font-sans text-(--artifact-band-ink)/70">RV </span
            ><RollValue :value="row.rv" :plain="plain"
          /></span>
          <span
            v-if="potential.left > 0 && potential.expectedCv > row.cv"
            :class="BAND_CHIP"
            class="text-(--artifact-band-ink)/80"
            :title="potentialTitle"
            >→ ~{{ Math.round(potential.expectedCv) }}</span
          >
          <span
            v-if="isNew"
            class="rounded-[4px] bg-accent px-1.5 font-sans leading-5 text-accent-ink"
            :title="$t('artifacts.detail.newTitle')"
            >{{ $t('artifacts.label.new') }}</span
          >
        </p>
      </div>
    </div>

    <!-- The substats: the value beside its roll bars -->
    <!-- Above the card's button (z-10): each row's roll breakdown shows on hover; a click still opens it -->
    <ul
      class="flex flex-1 flex-col py-1.5 pr-2.5 pl-3 text-sm leading-6 font-semibold"
      aria-hidden="true"
    >
      <li
        v-for="(substat, index) in artifact.substats"
        :key="substat.key"
        class="relative z-10 flex items-center gap-2"
        :class="still ? '' : 'cursor-pointer'"
        :title="breakdown(index)"
        @click="open"
      >
        <span :class="CARD_MUTED">·</span>
        <span class="min-w-0 flex-1 truncate">{{ formatStatShort(substat.key) }}</span>
        <span class="tabular font-mono">{{ formatStatValue(substat.key, substat.value) }}</span>
        <span class="flex h-4 shrink-0 items-stretch gap-0.5" :style="{ width: barsWidth }">
          <span
            v-for="(roll, k) in row.rolls[index] ?? []"
            :key="k"
            class="relative w-1.5 overflow-hidden rounded-[2px] bg-(--artifact-track)"
          >
            <span
              class="absolute inset-x-0 bottom-0 rounded-[2px]"
              :class="ROLL_QUALITY_BG[roll.quality]"
              :style="{ height: ROLL_QUALITY_FILL[roll.quality] }"
            />
          </span>
        </span>
      </li>
      <li
        v-for="substat in inactive"
        :key="`inactive-${substat.key}`"
        class="flex items-center gap-2 opacity-55"
        :title="$t('characters.piece.activatesAt4')"
      >
        <span :class="CARD_MUTED">·</span>
        <span class="min-w-0 flex-1 truncate">{{ formatStatShort(substat.key) }}</span>
        <span class="tabular font-mono">{{ formatStatValue(substat.key, substat.value) }}</span>
        <span
          class="h-4 shrink-0 rounded-[2px] border border-dashed border-current"
          :style="{ width: barsWidth }"
        />
      </li>
    </ul>

    <!-- The set; the marks end its line when no one wears the piece (no empty bar) -->
    <p class="flex items-center gap-2 px-3 pb-1.5 text-sm font-semibold" aria-hidden="true">
      <span class="min-w-0 flex-1 truncate" :class="CARD_SET">{{ row.setName }}</span>
      <span v-if="!row.ownerName" class="flex shrink-0 items-center gap-1.5">
        <FlaskConical v-if="artifact.elixirCrafted" class="size-4" :class="CARD_MUTED" />
        <Sparkle v-if="artifact.astralMark" class="size-4 fill-current text-[#e0a417]" />
        <Lock v-if="artifact.lock" class="size-4 text-[#e8704a]" stroke-width="2.6" />
      </span>
    </p>

    <!-- The game's "Equipped" bar: the wearer's side portrait pokes out of it -->
    <div
      v-if="row.ownerName"
      class="relative flex h-9 shrink-0 items-center gap-2 pr-3 pl-15 text-sm font-semibold"
      :class="CARD_FOOT"
      aria-hidden="true"
    >
      <img
        v-if="wearer"
        :src="wearer"
        alt=""
        class="absolute bottom-0 left-1.5 size-13 object-contain object-bottom [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.25))]"
        @error="sideFailed = true"
      />
      <span class="min-w-0 truncate">{{
        $t('artifacts.card.equipped', { name: row.ownerName })
      }}</span>
      <span class="ml-auto flex shrink-0 items-center gap-1.5">
        <FlaskConical v-if="artifact.elixirCrafted" class="size-4" :class="CARD_MUTED" />
        <Sparkle v-if="artifact.astralMark" class="size-4 fill-current text-[#e0a417]" />
        <Lock v-if="artifact.lock" class="size-4 text-[#e8704a]" stroke-width="2.6" />
      </span>
    </div>

    <button
      v-if="!still"
      type="button"
      class="absolute inset-0 rounded-xl"
      :title="
        row.ownerName ? `${name} · ${row.setName} · ${row.ownerName}` : `${name} · ${row.setName}`
      "
      :aria-label="label"
      aria-haspopup="dialog"
      @click="emit('open', row.id)"
    />
  </article>
</template>
