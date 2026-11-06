<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ClipboardList,
  Flower2,
  Languages,
  Share,
  Sparkles,
  Swords,
  Trophy,
  UserPlus,
  Users,
} from 'lucide-vue-next'
import { t } from '@/i18n'
import { formatCompact, formatNumber } from '@/lib/format'

/**
 * The tracker's section: a sample overview (figures, a Mora and Primogem
 * chart per snapshot or per month) and what the tracker has.
 */
type Group = 'snapshot' | 'month'
const group = ref<Group>('snapshot')

/** Sample chart shapes in the 1100×180 box: stepped lines and the Primogem change bars. */
const CHARTS: Record<Group, { mora: string; primogem: string; bars: number[][] }> = {
  snapshot: {
    mora: '0,150 140,150 140,138 280,138 280,132 420,132 420,116 560,116 560,108 700,108 700,90 840,90 840,72 980,72 980,52 1100,52',
    primogem:
      '0,120 140,120 140,104 280,104 280,112 420,112 420,94 560,94 560,70 700,70 700,82 840,82 840,60 980,60 980,44 1100,44',
    bars: [
      [96, 23],
      [236, 31],
      [376, 19],
      [516, 39],
      [656, 27],
      [796, 43],
      [936, 29],
    ],
  },
  month: {
    mora: '0,156 220,156 220,128 440,128 440,104 660,104 660,86 880,86 880,58 1100,58',
    primogem: '0,132 220,132 220,98 440,98 440,108 660,108 660,72 880,72 880,48 1100,48',
    bars: [
      [181, 34],
      [401, 26],
      [621, 44],
      [841, 38],
      [1061, 30],
    ],
  },
}
const chart = computed(() => CHARTS[group.value])
const groups = computed(() => [
  { value: 'snapshot' as const, label: t('progression.per.snapshot') },
  { value: 'month' as const, label: t('progression.per.month') },
])

const stats = computed(() => [
  { label: t('game.characters'), value: formatNumber(92), change: '+1' },
  { label: t('game.artifacts'), value: formatNumber(1684), change: `+${formatNumber(38)}` },
  {
    label: t('overview.figure.primogem'),
    value: formatNumber(14320),
    change: `+${formatNumber(1600)}`,
  },
  {
    label: t('game.mora'),
    value: formatCompact(72164464),
    title: formatNumber(72164464),
    change: `+${formatCompact(2_800_000)}`,
  },
])

/**
 * What the tracker has: one short section per feature, real sentences (what a
 * visitor and a search engine read), then two smaller notes.
 */
const FEATURES = [
  { key: 'characters', icon: Users },
  { key: 'artifacts', icon: Flower2 },
  { key: 'planner', icon: ClipboardList },
  { key: 'achievements', icon: Trophy },
  { key: 'wishes', icon: Sparkles },
  { key: 'endgame', icon: Swords },
  { key: 'share', icon: Share },
] as const

const extras = computed(() => [
  { icon: UserPlus, title: t('landing.tracker.sharing'), note: t('landing.tracker.sharingNote') },
  {
    icon: Languages,
    title: t('landing.tracker.anywhere'),
    note: t('landing.tracker.anywhereNote'),
  },
])
</script>

<template>
  <section id="tracker" class="sec" aria-labelledby="trk-t">
    <div class="wrap">
      <div class="sec-h">
        <div class="ov">{{ $t('landing.tracker.overline') }}</div>
        <h2 id="trk-t" class="h2">{{ $t('landing.tracker.title') }}</h2>
        <p class="lead">{{ $t('landing.tracker.lead') }}</p>
      </div>

      <div class="glass dash" role="group" :aria-label="$t('landing.tracker.sample')">
        <div class="dash-top">
          <div class="av" aria-hidden="true">Tr</div>
          <div class="dash-who">
            <b>{{ $t('game.traveler') }}</b>
            <span class="muted">{{ $t('game.ar') }} 60 · {{ $t('accounts.server.ASIA') }}</span>
          </div>
          <div class="seg" role="group" :aria-label="$t('progression.groupBy')">
            <button
              v-for="option in groups"
              :key="option.value"
              type="button"
              :class="{ on: group === option.value }"
              :aria-pressed="group === option.value"
              @click="group = option.value"
            >
              {{ option.label }}
            </button>
          </div>
        </div>
        <div class="stats4">
          <div v-for="stat in stats" :key="stat.label" class="tile-g stat">
            <span>{{ stat.label }}</span
            ><b :title="stat.title">{{ stat.value }}</b
            ><i class="up">{{ stat.change }}</i>
          </div>
        </div>
        <div class="tile-g chartbox">
          <div class="legend" aria-hidden="true">
            <span><i style="background: #a5b4fc" />{{ $t('game.mora') }}</span>
            <span><i style="background: #fbbf24" />{{ $t('overview.figure.primogem') }}</span>
          </div>
          <svg
            viewBox="0 0 1100 180"
            preserveAspectRatio="none"
            role="img"
            :aria-label="
              $t('landing.tracker.chart', {
                per:
                  group === 'snapshot'
                    ? $t('progression.per.snapshot')
                    : $t('progression.per.month'),
              })
            "
          >
            <g stroke="rgba(148,163,184,.15)" stroke-width="1">
              <line x1="0" y1="30" x2="1100" y2="30" />
              <line x1="0" y1="80" x2="1100" y2="80" />
              <line x1="0" y1="130" x2="1100" y2="130" />
              <line x1="0" y1="179" x2="1100" y2="179" />
            </g>
            <g fill="rgba(251,191,36,.28)">
              <rect
                v-for="[x, h] in chart.bars"
                :key="x"
                :x="x"
                :y="179 - h!"
                width="18"
                :height="h"
                rx="3"
              />
            </g>
            <polyline
              :points="chart.mora"
              fill="none"
              stroke="#a5b4fc"
              stroke-width="2.5"
              vector-effect="non-scaling-stroke"
            />
            <polyline
              :points="chart.primogem"
              fill="none"
              stroke="#fbbf24"
              stroke-width="2.5"
              vector-effect="non-scaling-stroke"
            />
          </svg>
        </div>
      </div>

      <div class="feat">
        <article v-for="feature in FEATURES" :key="feature.key" class="tile-g ft">
          <div class="ft-ic"><component :is="feature.icon" class="ic l" aria-hidden="true" /></div>
          <h3 class="ft-t">{{ $t(`landing.tracker.features.${feature.key}.title`) }}</h3>
          <p>{{ $t(`landing.tracker.features.${feature.key}.text`) }}</p>
        </article>
      </div>
      <ul class="feat-x">
        <li v-for="extra in extras" :key="extra.title">
          <component :is="extra.icon" class="ic" aria-hidden="true" />
          <b>{{ extra.title }}</b
          ><span>{{ extra.note }}</span>
        </li>
      </ul>
    </div>
  </section>
</template>
