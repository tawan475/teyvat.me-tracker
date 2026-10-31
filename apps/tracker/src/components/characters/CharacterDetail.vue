<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { useElementSize } from '@vueuse/core'
import { Wrench } from 'lucide-vue-next'
import ConstellationStars from '@/components/ui/ConstellationStars.vue'
import CritValue from '@/components/ui/CritValue.vue'
import RollValue from '@/components/ui/RollValue.vue'
import ElementIcon from '@/components/ui/ElementIcon.vue'
import ExpProgress from '@/components/ui/ExpProgress.vue'
import LevelText from '@/components/ui/LevelText.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiError from '@/components/ui/UiError.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import type { GiCapture } from '@gdt/shared'
import type { AccountRef } from '@/data/account-data'
import { buildPanel, buildRv, talentLevels } from '@/data/character-build'
import type { BuildIndex } from '@/data/character-builds'
import { gearDiff } from '@/data/character-gear'
import { guidesFor } from '@/data/character-guides'
import {
  ELEMENT_LABELS,
  SLOT_ORDER,
  TARGET_LEVEL,
  WEAPON_TYPE_LABELS,
  type CharacterView,
} from '@/data/characters'
import { loadCharacterHistory } from '@/data/characters-history'
import { useResource } from '@/data/use-resource'
import { characterBanner } from '@/lib/assets'
import { useExpNeed } from '@/lib/exp-need'
import { formatDate, formatFullDateTime } from '@/lib/format'
import ArtifactPiece from './ArtifactPiece.vue'
import BuildStats from './BuildStats.vue'
import CharacterTimeline from './CharacterTimeline.vue'
import ConstellationIcons from './ConstellationIcons.vue'
import DetailTipPanel from './DetailTipPanel.vue'
import FriendshipBadge from './FriendshipBadge.vue'
import GuidesDialog from './GuidesDialog.vue'
import GuidesSection from './GuidesSection.vue'
import GameStars from './GameStars.vue'
import NamecardBackdrop from './NamecardBackdrop.vue'
import PastBuildStrip from './PastBuildStrip.vue'
import SetBonuses from './SetBonuses.vue'
import ShareCard from './ShareCard.vue'
import SplashArt from './SplashArt.vue'
import TalentLevels from './TalentLevels.vue'
import WeaponBlock from './WeaponBlock.vue'
import { CARD_HEIGHT, CARD_WIDTH, type CardOwner } from './share-card'
import { createDetailTip, provideDetailTip } from './detail-tip'
import { ELEMENT_GLOW } from './tokens'
import { useConstellationBoosts } from './use-boosts'

/**
 * Everything about one character. Wide (`showcase`): the share card itself
 * (ShareCard, Enka-style), scaled to the width, as the page shows it and
 * the PNG export draws it; then what is left to do and the history.
 * Narrow: the same build stacked to read on a phone (splash art with the
 * constellations, level, talents with C3/C5, weapon, the in-game stats,
 * sets, the five pieces). The export draws its own copy of the card
 * (CharacterModal, on a canvas: share-card-canvas), whatever this shows.
 * History's View shows a past capture's build in place of now (`past`),
 * with a strip on top to step through the history or come back. Talents,
 * constellations, the weapon, the artifact sets and the element show what
 * they do on hover, pinned by a click (detail-tip).
 */
const props = defineProps<{
  /** The build on screen: now, or the past capture's while viewing one. */
  character: CharacterView
  /** The build now (what a past one is compared with). */
  now: CharacterView
  account: AccountRef
  showcase: boolean
  cardTheme: 'light' | 'dark'
  owner: CardOwner
  takenAt: number | null
  /** Every capture's builds; null while loading. */
  builds: BuildIndex | null
  /** The past capture on screen, null for now. */
  viewing: number | null
  past: { at: number; capture: GiCapture | null } | null
}>()
const emit = defineEmits<{ view: [snapshotId: number | null] }>()

const frame = useTemplateRef<HTMLElement>('frame')
const { width: frameWidth } = useElementSize(frame)
const scale = computed(() => (frameWidth.value ? frameWidth.value / CARD_WIDTH : 0))

const c = computed(() => props.character)

const boosts = useConstellationBoosts(() => c.value.key)
const expNeed = useExpNeed()
const levelNeed = computed(() => expNeed.value?.character(c.value.level, c.value.ascension) ?? null)
const talents = computed(() => talentLevels(c.value.talent, c.value.constellation, boosts.value))
const panel = computed(() => buildPanel(c.value))

// The namecard art behind the build (gone at once when stepping to the next character).
const banner = computed(() => characterBanner(c.value.key))
const glow = computed(() =>
  c.value.element ? ELEMENT_GLOW[c.value.element] : 'from-border-default',
)
const kind = computed(() =>
  [
    c.value.element ? ELEMENT_LABELS[c.value.element] : null,
    c.value.weaponType ? WEAPON_TYPE_LABELS[c.value.weaponType] : null,
  ]
    .filter(Boolean)
    .join(' · '),
)

const history = useResource(
  () => props.account,
  (account) => loadCharacterHistory(account),
)
const changes = computed(() => history.data.value?.get(c.value.key) ?? [])
const days = computed(() => props.builds?.days(c.value.key) ?? null)
const canView = computed(() => {
  const builds = props.builds
  const key = c.value.key
  return builds ? (snapshotId: number) => builds.viewable(snapshotId, key) : null
})

// Older / Newer step through every viewable entry of the History, oldest first.
const points = computed(() => {
  const at = new Map<number, number>()
  for (const change of changes.value) {
    if (canView.value?.(change.snapshotId)) at.set(change.snapshotId, change.at)
  }
  for (const day of days.value ?? []) for (const step of day.steps) at.set(step.snapshotId, step.at)
  return [...at].sort((a, b) => a[1] - b[1]).map(([id]) => id)
})
const position = computed(() => (props.viewing === null ? -1 : points.value.indexOf(props.viewing)))
const diff = computed(() => (props.past ? gearDiff(c.value, props.now) : []))

const root = useTemplateRef<HTMLElement>('root')
function view(snapshotId: number | null) {
  emit('view', snapshotId)
  // The build is at the top: bring it into view from the History below.
  if (snapshotId !== null) void nextTick(() => root.value?.scrollIntoView({ block: 'start' }))
}
function step(delta: -1 | 1) {
  const next = points.value[position.value + delta]
  view(next ?? null)
}

// Guides: the Guides section's Videos chip opens the dialog.
const guides = computed(() => guidesFor(c.value.key))
const guidesOpen = ref(false)

const tip = createDetailTip()
provideDetailTip(tip)
const tipShown = computed(() => tip.hover.value ?? tip.pinned.value)
watch(
  () => [c.value.key, props.showcase, props.viewing] as const,
  () => {
    guidesOpen.value = false
    tip.close()
  },
)
</script>

<template>
  <div ref="root" class="flex scroll-mt-4 flex-col gap-5">
    <PastBuildStrip
      v-if="past"
      :at="past.at"
      :capture="past.capture"
      :diff="diff"
      :older="position > 0"
      :newer="position >= 0"
      @older="step(-1)"
      @newer="step(1)"
      @now="view(null)"
    />
    <template v-if="showcase">
      <div
        ref="frame"
        class="relative w-full overflow-hidden rounded-xl border border-border-default bg-surface-sunken"
        :style="{ aspectRatio: `${CARD_WIDTH} / ${CARD_HEIGHT}` }"
      >
        <div
          class="absolute top-0 left-0 origin-top-left"
          :style="{ transform: `scale(${scale})` }"
        >
          <ShareCard
            :character="c"
            :panel="panel"
            :talents="talents"
            :theme="cardTheme"
            :owner="owner"
            :taken-at="takenAt"
            :past="past !== null"
          />
        </div>
      </div>
      <div v-if="c.gaps.length" class="flex flex-wrap items-center gap-1.5">
        <Wrench class="size-4 text-warning-text" aria-hidden="true" />
        <span class="sr-only">{{ $t('characters.detail.toDo') }}</span>
        <UiBadge v-for="gap in c.gaps" :key="gap.kind" tone="warning">{{ gap.text }}</UiBadge>
      </div>
      <GuidesSection :guides="guides" @videos="guidesOpen = true" />
    </template>

    <template v-else>
      <section
        class="relative overflow-hidden rounded-xl border border-border-default bg-surface-base"
        :aria-label="$t('characters.detail.build')"
      >
        <!-- The namecard blurred into atmosphere (it is small), a light scrim, the element's tint -->
        <NamecardBackdrop
          :src="banner"
          class="absolute inset-0 size-full scale-110 blur-[10px] saturate-[1.15]"
        />
        <div class="pointer-events-none absolute inset-0 bg-surface-base/55" />
        <div
          class="pointer-events-none absolute inset-0 bg-linear-to-br via-transparent to-transparent"
          :class="glow"
        />

        <div class="relative grid md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <!-- Splash art, constellations down its right edge -->
          <div class="relative h-72 min-[480px]:h-80 md:row-span-2 md:h-auto md:min-h-[26rem]">
            <SplashArt
              :character-key="c.key"
              :name="c.name"
              :rarity="c.rarity"
              class="absolute inset-0 [mask-image:linear-gradient(to_bottom,black_75%,transparent)] md:[mask-image:linear-gradient(to_right,black_80%,transparent)]"
              img-class="scale-[1.15] object-[50%_30%]"
            />
            <ConstellationIcons
              :character-key="c.key"
              :value="c.constellation"
              :element="c.element"
              class="absolute top-1/2 right-3 -translate-y-1/2 md:right-1"
            />
          </div>

          <!-- Who: name, level, friendship, constellation; talents; weapon -->
          <div class="flex min-w-0 flex-col gap-4 p-4 sm:p-5 md:pl-3">
            <header class="flex min-w-0 flex-col gap-1.5">
              <p class="flex min-w-0 items-center gap-2">
                <span
                  v-if="c.element"
                  class="inline-flex rounded-full"
                  v-bind="tip.bind({ kind: 'element' })"
                >
                  <ElementIcon :element="c.element" size="lg" list decorative />
                  <span class="sr-only">{{ ELEMENT_LABELS[c.element] }}</span>
                </span>
                <span
                  class="min-w-0 truncate font-display text-2xl font-semibold sm:text-3xl"
                  :title="kind"
                  >{{ c.name }}</span
                >
              </p>
              <p class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-secondary">
                <GameStars v-if="c.rarity" :rarity="c.rarity" />
                <span v-if="c.weaponType">{{ WEAPON_TYPE_LABELS[c.weaponType] }}</span>
                <time
                  v-if="c.obtainedAt !== null"
                  :datetime="new Date(c.obtainedAt).toISOString()"
                  :title="
                    $t('characters.detail.obtainedAt', { date: formatFullDateTime(c.obtainedAt) })
                  "
                  >{{ formatDate(c.obtainedAt) }}</time
                >
              </p>
              <p class="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span class="inline-flex items-center gap-2">
                  <LevelText
                    :level="c.level"
                    :ascension="c.ascension"
                    :target="TARGET_LEVEL"
                    class="text-lg font-medium"
                  />
                  <ExpProgress v-if="c.exp !== null && levelNeed" :exp="c.exp" :need="levelNeed" />
                </span>
                <FriendshipBadge
                  v-if="c.friendship !== null"
                  :level="c.friendship"
                  :exp="c.friendshipExp"
                  :need="expNeed?.friendship(c.friendship)"
                  class="text-sm text-text-secondary"
                />
                <ConstellationStars :value="c.constellation" :element="c.element" />
              </p>
            </header>
            <TalentLevels :character-key="c.key" :levels="talents" :element="c.element" />
            <WeaponBlock :weapon="c.weapon" :account-id="account.id" />
          </div>

          <!-- The in-game stat panel -->
          <div class="min-w-0 px-4 pb-4 sm:px-5 sm:pb-5 md:col-start-2 md:pl-3">
            <BuildStats :panel="panel" />
          </div>
        </div>

        <!-- What is left to do (the "needs work" badges) -->
        <div
          v-if="c.gaps.length"
          class="relative flex min-h-12 flex-wrap items-center gap-1.5 border-t border-border-default bg-surface-base/80 py-2 pr-3 pl-4 sm:pl-5"
        >
          <Wrench class="size-4 text-warning-text" aria-hidden="true" />
          <span class="sr-only">{{ $t('characters.detail.toDo') }}</span>
          <UiBadge v-for="gap in c.gaps" :key="gap.kind" tone="warning">{{ gap.text }}</UiBadge>
        </div>
      </section>

      <section class="min-w-0" aria-labelledby="detail-artifacts">
        <div class="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <h3 id="detail-artifacts" class="sr-only">{{ $t('game.artifacts') }}</h3>
          <SetBonuses v-if="c.artifactCount" :sets="c.sets" />
          <span v-else class="text-sm text-text-muted">{{
            $t('characters.detail.noArtifacts')
          }}</span>
          <span
            v-if="c.artifactCount"
            class="ml-auto flex items-baseline gap-3 text-sm [&>span>span:last-child]:font-bold"
          >
            <RollValue :value="buildRv(c.artifacts)" scope="build" label />
            <CritValue
              :value="c.cv"
              scope="build"
              label
              :detail="$t('characters.card.critDetail', { rate: c.critRate, dmg: c.critDmg })"
            />
          </span>
        </div>
        <div class="grid grid-cols-1 gap-3 min-[520px]:grid-cols-2 md:grid-cols-3">
          <ArtifactPiece
            v-for="(slot, index) in SLOT_ORDER"
            :key="slot"
            :slot-key="slot"
            :piece="c.artifacts[index] ?? null"
          />
        </div>
      </section>

      <GuidesSection :guides="guides" @videos="guidesOpen = true" />
    </template>

    <section aria-labelledby="detail-changes">
      <h3 id="detail-changes" class="mb-3 text-sm font-semibold text-text-secondary">
        {{ $t('characters.detail.history') }}
      </h3>
      <UiError
        v-if="history.error.value"
        :error="history.error.value"
        :title="$t('characters.detail.loadFailed')"
        @retry="history.reload"
      />
      <div v-else-if="!history.data.value" class="flex flex-col gap-3" aria-busy="true">
        <UiSkeleton v-for="n in 3" :key="n" class="h-6 w-full max-w-md" />
      </div>
      <p v-else-if="changes.length === 0" class="text-sm text-text-muted">
        {{ $t('characters.detail.none') }}
      </p>
      <CharacterTimeline
        v-else
        :changes="changes"
        :days="days"
        :reset-key="c.key"
        :viewing="viewing"
        :piece="builds ? builds.piece : null"
        :can-view="canView"
        @view="view"
      />
    </section>

    <DetailTipPanel :shown="tipShown" :character="c" :talents="talents" @close="tip.close()" />
    <GuidesDialog
      :open="guidesOpen"
      :character-key="c.key"
      :name="c.name"
      :guides="guides"
      @close="guidesOpen = false"
    />
  </div>
</template>
