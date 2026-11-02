<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useTemplateRef, watch } from 'vue'
import type { MonthCount } from '@/data/wish-history'
import { t } from '@/i18n'
import { formatNumber } from '@/lib/format'
import { monthName } from './wish-labels'

/**
 * Pulls per month of every banner, stacked by rarity (3★, 4★, 5★), every
 * month from the first pull on, labelled each January and July. The columns
 * keep a minimum width, so years of history scroll sideways; it opens on
 * the newest month. Hovering (or tapping) a month lifts its column, dims the
 * rest and shows its counts in a bubble above it.
 */
const props = defineProps<{ months: MonthCount[] }>()

const peak = computed(() => Math.max(1, ...props.months.map((m) => m.total)))
const pct = (n: number) => `${(n / peak.value) * 100}%`
const labels = computed(() =>
  props.months.map((m) => (m.month.endsWith('-01') || m.month.endsWith('-07') ? m.month : '')),
)
const hover = ref<number | null>(null)
const tip = computed(() => {
  const i = hover.value
  const m = i === null ? undefined : props.months[i]
  if (i === null || !m) return null
  const at = (i + 0.5) / props.months.length
  return {
    m,
    left: `${at * 100}%`,
    // Near an edge the bubble opens inward instead of past the chart.
    align: at < 0.12 ? '' : at > 0.88 ? '-translate-x-full' : '-translate-x-1/2',
  }
})

const box = useTemplateRef<HTMLElement>('box')
const toNewest = () => void nextTick(() => box.value?.scrollTo({ left: box.value.scrollWidth }))
onMounted(toNewest)
watch(() => props.months.length, toNewest)

const SERIES = [
  { label: '3★', swatch: 'bg-rarity-3' },
  { label: '4★', swatch: 'bg-rarity-4' },
  { label: '5★', swatch: 'bg-rarity-5' },
]
</script>

<template>
  <section
    :aria-label="$t('wishes.chart.title')"
    class="flex min-w-0 flex-col gap-2.5 rounded-xl border border-border-default bg-surface-raised px-4 pt-4 pb-3.5 shadow-sm sm:px-5"
  >
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
      <h2 class="text-base font-semibold">{{ $t('wishes.chart.title') }}</h2>
      <span class="ml-auto inline-flex gap-x-3 text-xs text-text-secondary" aria-hidden="true">
        <span v-for="s in SERIES" :key="s.label" class="inline-flex items-center gap-1.5"
          ><span class="size-2.5 rounded-[3px]" :class="s.swatch" />{{ s.label }}</span
        >
      </span>
    </div>
    <div ref="box" class="overflow-x-auto">
      <div
        class="flex w-full min-w-max flex-col gap-1.5"
        role="img"
        :aria-label="$t('wishes.chart.label', { n: months.length })"
      >
        <div
          class="relative flex h-[13.5rem] items-end gap-[3px] border-b border-border-default pt-12"
          @pointerleave="hover = null"
        >
          <div
            v-if="tip"
            class="pointer-events-none absolute top-0 z-10 rounded-lg border border-border-default bg-surface-overlay px-2.5 py-1.5 text-xs whitespace-nowrap shadow-lg"
            :class="tip.align"
            :style="{ left: tip.left }"
          >
            <p class="font-semibold text-text-primary">
              {{
                t('wishes.chart.month', {
                  month: monthName(tip.m.month),
                  n: formatNumber(tip.m.total),
                })
              }}
            </p>
            <p class="tabular flex gap-2 font-mono text-text-secondary">
              <span class="text-rarity-5">{{ formatNumber(tip.m.five) }} 5★</span>
              <span class="text-rarity-4">{{ formatNumber(tip.m.four) }} 4★</span>
              <span>{{ formatNumber(tip.m.total - tip.m.five - tip.m.four) }} 3★</span>
            </p>
          </div>
          <div
            v-for="(m, i) in months"
            :key="m.month"
            class="flex h-full flex-[1_0_7px] flex-col-reverse gap-px rounded-t-[3px] transition-[opacity,background-color] duration-150"
            :class="hover === null ? '' : hover === i ? 'bg-surface-overlay' : 'opacity-45'"
            @pointerenter="hover = i"
          >
            <div
              v-if="m.total - m.five - m.four"
              class="rounded-[2px] bg-rarity-3"
              :style="{ height: pct(m.total - m.five - m.four) }"
            />
            <div v-if="m.four" class="rounded-[2px] bg-rarity-4" :style="{ height: pct(m.four) }" />
            <div
              v-if="m.five"
              class="rounded-t-[2px] bg-rarity-5"
              :style="{ height: pct(m.five) }"
            />
          </div>
        </div>
        <div class="flex gap-[3px] text-xs text-text-muted" aria-hidden="true">
          <span
            v-for="(label, i) in labels"
            :key="months[i]!.month"
            class="tabular w-0 flex-[1_0_7px] overflow-visible font-mono whitespace-nowrap"
            >{{ label }}</span
          >
        </div>
      </div>
    </div>
  </section>
</template>
