<script setup lang="ts">
import { computed } from 'vue'
import { runPullNumbers, type BannerStats } from '@/data/wish-history'
import { fiveGroups, type FiveGroup } from '@/data/wish-five-groups'
import { itemName } from '@/data/weapons'
import { t } from '@/i18n'
import { formatNumber } from '@/lib/format'
import WishFiveTile from './WishFiveTile.vue'
import { useRunLink } from './run-link'
import { OUTCOME_STYLE, runDates, wishMonth } from './wish-labels'

/**
 * Every 5★ of a banner, newest first, in a box that scrolls (its height from
 * `boxClass`): grouped by the banner run it came from (by month where the
 * banner has no runs) under a heading that stays at the box's top, each tile
 * numbered by its pull in the run (the pull table's #) so the order reads at
 * a glance (the user's pick, design E). The 50/50 legend where the banner has one; `dated` adds
 * each one's day (the banner page).
 */
const props = defineProps<{ stats: BannerStats; boxClass?: string; dated?: boolean }>()
const runLink = useRunLink()

const LEGEND = [
  { key: 'won' },
  { key: 'lost' },
  { key: 'guaranteed' },
  { key: 'radiance' },
] as const
const legendLabel = (key: (typeof LEGEND)[number]['key']) => t(`wishes.legend.${key}`)

const groups = computed(() =>
  fiveGroups(props.stats.fives, props.stats.runs, runPullNumbers(props.stats.rows)),
)
const now = Date.now() / 1000

/** A run's banner by name: the weapons it features (one name for every run), else its title(s). */
function title(group: FiveGroup): string {
  const b = group.banner
  if (!b) return group.month ? wishMonth(group.month) : ''
  if (b.kind === 'weapon') return b.featured5.map(itemName).join(' / ')
  return b.name400 ? `${b.name} / ${b.name400}` : b.name
}
const dates = (group: FiveGroup) =>
  group.run ? runDates(group.run, group.run.banner.start <= now && now < group.run.banner.end) : ''
const summary = (group: FiveGroup) =>
  [
    group.run ? `${formatNumber(group.run.pulls)} ${t('wishes.history.wishes')}` : '',
    t('wishes.history.fives', { n: group.fives.length }),
  ]
    .filter(Boolean)
    .join(' · ')
</script>

<template>
  <div class="flex min-w-0 flex-col gap-2.5">
    <div class="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
      <span class="font-semibold text-rarity-5">{{ $t('wishes.five.every') }}</span>
      <span class="tabular font-mono text-text-muted">{{
        $t('wishes.five.newestFirst', { n: formatNumber(stats.fives.length) })
      }}</span>
      <span
        v-if="stats.rate5"
        class="ml-auto inline-flex flex-wrap gap-x-3 gap-y-1 text-text-muted"
      >
        <span v-for="l in LEGEND" :key="l.key" class="inline-flex items-center gap-1.5"
          ><span class="text-xs font-bold" :class="OUTCOME_STYLE[l.key].text" aria-hidden="true">{{
            OUTCOME_STYLE[l.key].mark
          }}</span
          >{{ legendLabel(l.key) }}</span
        >
      </span>
    </div>
    <p v-if="!stats.fives.length" class="py-6 text-center text-xs text-text-muted">
      {{ $t('wishes.five.none') }}
    </p>
    <div v-else class="flex flex-col gap-3 overflow-y-auto pr-1" :class="boxClass">
      <section
        v-for="group in groups"
        :key="group.key"
        class="flex min-w-0 flex-col gap-2"
        :aria-label="title(group)"
      >
        <h3
          class="sticky top-0 z-[1] flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5 border-b border-border-default bg-surface-raised pt-0.5 pb-1.5"
        >
          <span
            v-if="group.banner"
            class="shrink-0 text-[0.6875rem] font-semibold tracking-wide text-text-muted uppercase"
            >{{ $t('wishes.history.version', { version: group.banner.version }) }}</span
          >
          <RouterLink
            v-if="group.banner"
            :to="runLink(group.banner)"
            class="min-w-0 truncate text-sm font-semibold hover:text-accent-text hover:underline"
            :title="title(group)"
            >{{ title(group) }}</RouterLink
          >
          <span v-else class="min-w-0 truncate text-sm font-semibold" :title="title(group)">{{
            title(group)
          }}</span>
          <span v-if="dates(group)" class="tabular shrink-0 font-mono text-xs text-text-muted">{{
            dates(group)
          }}</span>
          <span class="tabular ml-auto shrink-0 font-mono text-xs text-text-muted">{{
            summary(group)
          }}</span>
        </h3>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,12.5rem),1fr))] gap-2">
          <WishFiveTile
            v-for="five in group.fives"
            :key="five.row.pull.id.toString()"
            :row="five.row"
            :number="five.number"
            :banner="stats.banner"
            :dated="dated"
          />
        </div>
      </section>
    </div>
  </div>
</template>
