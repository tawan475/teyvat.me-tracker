<script setup lang="ts">
import { computed } from 'vue'
import { Check, ExternalLink, EyeOff, Hand, Trophy } from 'lucide-vue-next'
import type { AchievementTexts } from '@gdt/game-data'
import {
  completedOn,
  doneSource,
  entryCompletedOn,
  markThrough,
  stardbAchievementUrl,
  unmarkFrom,
  type AchievementEntry,
  type CapturedAchievements,
  type DoneSource,
  type DoneState,
} from '@/data/achievement-progress'
import { materialIcon } from '@/lib/assets'
import { wikiPage } from '@/lib/wiki'
import SyncedMark from '@/components/live/SyncedMark.vue'
import { t } from '@/i18n'
import { formatNumber } from '@/lib/format'
import { completionText } from './completion'

/**
 * One achievement, or a stage chain as one row with a dot per tier. The
 * round button marks it done by hand; captured ones (green) come from a
 * snapshot and stay done. A done row says when it was completed (a chain:
 * its highest done tier): the game's own time, the window between the
 * captures without and with it, "by" the first capture, or that it was
 * marked by hand; tooltips say where that comes from.
 */
const props = defineProps<{
  entry: AchievementEntry
  text: AchievementTexts
  /** The English names: the Fandom wiki's page titles. */
  english: AchievementTexts
  /** When a capture finished it while the page was open (lib/just-synced.ts). */
  synced?: number
  state: DoneState
  /** Where the completion dates come from: the game's own, or the snapshots. */
  capture: CapturedAchievements
}>()
const emit = defineEmits<{ mark: [ids: number[]]; unmark: [ids: number[]] }>()

const primogem = materialIcon('Primogem')

/**
 * The achievement's page on the Fandom wiki (titled by its English name;
 * the user's call, 2026-11-09: it says how to complete it, stardb doesn't).
 * stardb.gg only when the English name is missing.
 */
const guideUrl = computed(() => {
  const name = props.english.achievements.get(props.entry.id)?.title
  return name ? wikiPage(name) : stardbAchievementUrl(props.entry.tiers.at(-1)!.id)
})

const tiers = computed(() =>
  props.entry.tiers.map((tier) => ({ tier, source: doneSource(props.state, tier.id) })),
)
const doneCount = computed(() => tiers.value.filter((t) => t.source).length)
/** The captured progress on the first tier left (Capture 1.7.0), when the capture has one. */
const progressText = computed(() => {
  const left = tiers.value.find((t) => !t.source)
  const p = left ? props.capture.progress?.get(left.tier.id) : undefined
  return p ? `${formatNumber(p.progress)}/${formatNumber(p.total)}` : null
})
const complete = computed(() => doneCount.value === tiers.value.length)
const chain = computed(() => tiers.value.length > 1)
/** The tier to describe: the first one left, or the last. */
const current = computed(() => {
  const index = tiers.value.findIndex((t) => !t.source)
  return tiers.value[index < 0 ? tiers.value.length - 1 : index]!.tier
})
const words = computed(
  () =>
    props.text.achievements.get(current.value.id) ?? {
      title: `#${current.value.id}`,
      description: '',
    },
)

const state = computed<DoneSource | null>(() => {
  if (!complete.value) return null
  return tiers.value.every((t) => t.source === 'captured') ? 'captured' : 'marked'
})
const unmarkable = computed(() => unmarkFrom(props.entry, 0, props.state))
const anyMarked = computed(() => tiers.value.some((t) => t.source === 'marked'))

/** When the row was completed: its highest done tier's. */
const completed = computed(() => entryCompletedOn(props.entry, props.state, props.capture))
const completedLine = computed(() => {
  const done = completed.value
  if (!done) return null
  return {
    ...completionText(done, chain.value ? done.tier : undefined),
    kind: done.kind,
    datetime: 'at' in done ? new Date(done.at).toISOString() : null,
  }
})

function status(id: number, source: DoneSource | null): string {
  if (!source) return t('achievements.row.clickToMark')
  const done = completedOn(props.capture, id)
  if (source === 'marked')
    return t('achievements.row.clickToUnmark', {
      text: completionText(done ?? { kind: 'marked' }).text,
    })
  return t('achievements.row.staysDone', {
    text: done ? completionText(done).text : t('achievements.row.captured'),
  })
}

const mainTitle = computed(() => {
  if (!complete.value)
    return chain.value ? t('achievements.row.markEveryTier') : t('achievements.row.markDone')
  if (state.value === 'captured') return status(props.entry.tiers.at(-1)!.id, 'captured')
  return chain.value && unmarkable.value.length < tiers.value.length
    ? t('achievements.row.unmarkTiers')
    : t('achievements.row.markedClick')
})

function toggle() {
  if (!complete.value) emit('mark', markThrough(props.entry, tiers.value.length - 1, props.state))
  else if (unmarkable.value.length) emit('unmark', unmarkable.value)
}

function toggleTier(index: number) {
  const source = tiers.value[index]!.source
  if (!source) emit('mark', markThrough(props.entry, index, props.state))
  else if (source === 'marked') emit('unmark', unmarkFrom(props.entry, index, props.state))
}

function tierTitle(index: number): string {
  const { tier, source } = tiers.value[index]!
  const description = props.text.achievements.get(tier.id)?.description ?? ''
  return [
    t('achievements.row.tierTitle', { n: index + 1, primogems: tier.primogems }),
    description,
    status(tier.id, source),
  ]
    .filter(Boolean)
    .join('\n')
}

const rewardTitle = computed(() =>
  t('achievements.row.reward', {
    n: chain.value
      ? tiers.value.map((x) => x.tier.primogems).join(' + ')
      : String(props.entry.primogems),
  }),
)

const FILL: Record<DoneSource, string> = {
  captured: 'bg-success-text text-surface-raised',
  marked: 'bg-accent text-accent-ink',
}
</script>

<template>
  <li
    class="flex items-start gap-3 px-3 py-3 sm:gap-4 sm:px-5"
    :class="synced !== undefined ? 'just-synced' : ''"
  >
    <button
      type="button"
      class="group -m-0.5 flex size-11 shrink-0 items-center justify-center rounded-full"
      :aria-pressed="complete"
      :aria-disabled="complete && unmarkable.length === 0 ? 'true' : undefined"
      :aria-label="
        $t('achievements.row.aria', {
          title: words.title,
          state: $t(`achievements.row.states.${state ?? 'none'}`),
        })
      "
      :title="mainTitle"
      @click="toggle"
    >
      <span
        class="flex size-7 items-center justify-center rounded-full transition-colors"
        :class="
          state
            ? FILL[state]
            : 'border-2 border-border-strong text-transparent group-hover:border-accent group-hover:text-accent-text'
        "
      >
        <Check class="size-4" stroke-width="3" aria-hidden="true" />
      </span>
    </button>

    <div class="min-w-0 flex-1">
      <div class="flex items-start gap-3">
        <div class="min-w-0 flex-1">
          <p class="leading-snug font-medium">{{ words.title }}</p>
          <p class="mt-0.5 text-sm text-text-secondary">{{ words.description }}</p>
        </div>
        <span
          class="tabular mt-0.5 flex shrink-0 items-center gap-1 font-mono text-sm font-medium"
          :class="complete ? 'text-text-muted' : 'text-text-primary'"
          :title="rewardTitle"
        >
          <img :src="primogem" alt="" class="size-5" loading="lazy" />
          {{ formatNumber(entry.primogems) }}
          <span class="sr-only">{{ $t('achievements.row.primogems') }}</span>
        </span>
      </div>

      <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
        <span
          v-if="progressText"
          class="tabular font-mono text-text-secondary"
          :title="$t('achievements.row.progressTitle')"
          >{{ progressText }}</span
        >
        <span
          v-if="chain"
          class="-my-1 -ml-1.5 flex items-center"
          role="group"
          :aria-label="$t('achievements.row.tiers')"
        >
          <button
            v-for="(t, index) in tiers"
            :key="t.tier.id"
            type="button"
            class="flex size-7 items-center justify-center rounded-full hover:bg-surface-overlay"
            :aria-pressed="t.source !== null"
            :aria-disabled="t.source === 'captured' ? 'true' : undefined"
            :aria-label="$t('achievements.row.tier', { n: index + 1 })"
            :title="tierTitle(index)"
            @click="toggleTier(index)"
          >
            <span
              class="size-2.5 rounded-full"
              :class="
                t.source === 'captured'
                  ? 'bg-success-text'
                  : t.source === 'marked'
                    ? 'bg-accent'
                    : 'ring-1 ring-border-strong ring-inset'
              "
            />
          </button>
          <span class="tabular ml-1 font-mono">{{ doneCount }}/{{ tiers.length }}</span>
        </span>
        <SyncedMark v-if="synced !== undefined" :at="synced" />
        <span
          v-if="entry.version"
          class="tabular font-mono"
          :title="$t('achievements.row.addedIn', { version: entry.version })"
          >v{{ entry.version }}</span
        >
        <span
          v-if="entry.hidden"
          class="flex items-center gap-1"
          :title="$t('achievements.row.hiddenTitle')"
        >
          <EyeOff class="size-3.5" aria-hidden="true" />
          {{ $t('achievements.row.hidden') }}
        </span>
        <span
          v-if="anyMarked && completedLine?.kind !== 'marked'"
          class="flex items-center text-accent-text"
          :title="$t('achievements.row.markedByHand')"
        >
          <Hand class="size-3.5" aria-hidden="true" />
          <span class="sr-only">{{ $t('achievements.row.markedByHand') }}</span>
        </span>
        <span class="ml-auto flex min-w-0 items-center gap-2">
          <span
            v-if="completedLine"
            class="flex min-w-0 items-center gap-1"
            :class="completedLine.kind === 'exact' && 'text-text-secondary'"
            :title="completedLine.title"
          >
            <Trophy
              v-if="completedLine.kind === 'exact'"
              class="size-3.5 shrink-0"
              aria-hidden="true"
            />
            <Hand
              v-else-if="completedLine.kind === 'marked'"
              class="size-3.5 shrink-0 text-accent-text"
              aria-hidden="true"
            />
            <time
              v-if="completedLine.datetime"
              :datetime="completedLine.datetime"
              class="tabular sm:whitespace-nowrap"
              >{{ completedLine.text }}</time
            >
            <span v-else class="sm:whitespace-nowrap">{{ completedLine.text }}</span>
          </span>
          <a
            :href="guideUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="-my-1 inline-flex min-h-7 items-center gap-1 rounded px-1 hover:text-text-primary"
            :title="$t('achievements.row.guide')"
          >
            <ExternalLink class="size-3.5" aria-hidden="true" />
            <span class="sr-only">{{ $t('achievements.row.guide') }}</span>
          </a>
        </span>
      </div>
    </div>
  </li>
</template>
