<script setup lang="ts">
import { computed } from 'vue'
import { EXPECTED_PITY, type BannerStats, type RateLine } from '@/data/wish-history'
import { t } from '@/i18n'
import { formatNumber } from '@/lib/format'
import WishSplitBar from './WishSplitBar.vue'
import { OUTCOME_STYLE, formatPercent, formatPity, oddsOf } from './wish-labels'

/**
 * A banner's numbers, as paimon.moe counts them: 5★ and 4★ (count, share
 * of all pulls, average pity), the 50/50s (75/25 for the weapon banner's
 * 5★) won and lost as a split bar, and the 4★ split into characters and
 * weapons. `compact` (the overview) stacks the two counts over the bars;
 * otherwise (the banner page) they sit in a grid with the expected pity,
 * the streaks and the 4★ rate-ups.
 */
const props = defineProps<{ stats: BannerStats; compact?: boolean }>()

const s = computed(() => props.stats)
const expected = computed(() => EXPECTED_PITY[props.stats.banner])
const diff = computed(() => Math.round((s.value.five.avgPity - expected.value) * 10) / 10)
const avg = (n: number) => formatPity(Math.round(n * 100) / 100)

/** "1.6% · avg pity 62.3" ("—" for the average without any). */
const avgLine = (line: { count: number; share: number; avgPity: number }) =>
  t('wishes.numbers.avgPity', {
    share: formatPercent(line.share),
    avg: line.count ? avg(line.avgPity) : '—',
  })

const decided = (r: RateLine) => r.won + r.lost
const share = (r: RateLine) =>
  r.rate === null ? '' : formatPercent(Math.round(r.rate * 1000) / 1000)

const flip = computed(() => {
  const r = s.value.rate5
  if (!r) return null
  return {
    label: `5★ ${oddsOf(s.value.banner)}`,
    left: {
      count: r.won,
      label: `${OUTCOME_STYLE.won.mark} ${t('wishes.legend.won')}`,
      text: OUTCOME_STYLE.won.text,
      bar: OUTCOME_STYLE.won.bar,
    },
    right: {
      count: r.lost,
      label: `${OUTCOME_STYLE.lost.mark} ${t('wishes.legend.lost')}`,
      text: OUTCOME_STYLE.lost.text,
      bar: OUTCOME_STYLE.lost.bar,
    },
    rate: share(r),
    note: t('wishes.numbers.streak', {
      current: r.winStreak
        ? t('wishes.numbers.streakWon', { n: r.winStreak })
        : r.loseStreak
          ? t('wishes.numbers.streakLost', { n: r.loseStreak })
          : 0,
      best: r.maxWinStreak,
      worst: r.maxLoseStreak,
    }),
    title: t('wishes.numbers.flipTitle', { odds: oddsOf(s.value.banner) }),
  }
})
const split = computed(() => {
  const r = s.value.rate4
  return {
    label: t('wishes.numbers.split'),
    left: {
      count: s.value.fourCharacter.count,
      label: props.compact ? t('wishes.numbers.character') : t('wishes.numbers.char'),
      text: 'text-rarity-4',
      bar: 'bg-rarity-4',
    },
    right: {
      count: s.value.fourWeapon.count,
      label: t('wishes.numbers.weapon'),
      text: 'text-rarity-3',
      bar: 'bg-rarity-3',
    },
    note:
      r && decided(r)
        ? t('wishes.numbers.rateUp', {
            won: formatNumber(r.won),
            total: formatNumber(decided(r)),
            share: share(r),
          })
        : '',
  }
})
</script>

<template>
  <div
    v-if="compact"
    class="flex min-w-0 flex-col gap-4"
    :title="$t('wishes.numbers.expected', { n: expected })"
  >
    <div class="grid grid-cols-2 gap-3">
      <div class="flex min-w-0 flex-col gap-0.5">
        <span class="text-xs font-semibold text-rarity-5">5★</span>
        <span class="tabular font-mono text-2xl font-bold">{{ formatNumber(s.five.count) }}</span>
        <span class="tabular truncate font-mono text-xs text-text-muted">{{
          avgLine(s.five)
        }}</span>
      </div>
      <div class="flex min-w-0 flex-col gap-0.5">
        <span class="text-xs font-semibold text-rarity-4">4★</span>
        <span class="tabular font-mono text-2xl font-bold">{{ formatNumber(s.four.count) }}</span>
        <span class="tabular truncate font-mono text-xs text-text-muted">{{
          avgLine(s.four)
        }}</span>
      </div>
    </div>
    <WishSplitBar
      v-if="flip"
      :label="flip.label"
      :left="flip.left"
      :right="flip.right"
      :rate="flip.rate"
      :title="flip.title"
    />
    <WishSplitBar
      :label="split.label"
      :left="split.left"
      :right="split.right"
      :title="$t('wishes.numbers.splitTitle')"
    />
  </div>

  <section
    v-else
    :aria-label="$t('wishes.numbers.label')"
    class="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,26rem),1fr))] gap-x-7 gap-y-4 rounded-xl border border-border-default bg-surface-raised px-4 py-4 shadow-sm sm:px-5"
  >
    <!-- Each rarity: its count beside its split bar, wrapping under it when narrow. -->
    <div class="flex min-w-0 flex-wrap gap-x-6 gap-y-3">
      <div class="flex min-w-0 flex-[1_1_9rem] flex-col gap-0.5">
        <span class="text-xs font-semibold text-rarity-5">5★</span>
        <span class="tabular font-mono text-2xl font-bold">{{ formatNumber(s.five.count) }}</span>
        <span class="tabular font-mono text-xs text-text-muted"
          >{{ avgLine(s.five)
          }}<span
            v-if="s.five.count"
            :class="diff > 0 ? 'text-warning-text' : diff < 0 ? 'text-accent-text' : ''"
            :title="$t('wishes.numbers.expectedAbout', { n: expected })"
          >
            ({{ diff > 0 ? '+' : diff < 0 ? '−' : '±' }}{{ formatPity(Math.abs(diff)) }})</span
          ></span
        >
      </div>
      <WishSplitBar
        v-if="flip"
        class="flex-[999_1_14rem]"
        :label="flip.label"
        :left="flip.left"
        :right="flip.right"
        :rate="flip.rate"
        :note="flip.note"
        :title="flip.title"
      />
    </div>
    <div class="flex min-w-0 flex-wrap gap-x-6 gap-y-3">
      <div class="flex min-w-0 flex-[1_1_9rem] flex-col gap-0.5">
        <span class="text-xs font-semibold text-rarity-4">4★</span>
        <span class="tabular font-mono text-2xl font-bold">{{ formatNumber(s.four.count) }}</span>
        <span class="tabular font-mono text-xs text-text-muted">{{ avgLine(s.four) }}</span>
      </div>
      <WishSplitBar
        class="flex-[999_1_14rem]"
        :label="split.label"
        :left="split.left"
        :right="split.right"
        :note="split.note"
        :title="$t('wishes.numbers.splitTitleFull')"
      />
    </div>
  </section>
</template>
