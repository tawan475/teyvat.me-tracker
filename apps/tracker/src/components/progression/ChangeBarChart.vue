<script setup lang="ts">
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  LinearScale,
  Tooltip,
  type ChartConfiguration,
  type ScaleOptions,
} from 'chart.js'
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useMutationObserver } from '@vueuse/core'
import { axisFormat, axisTick, axisTicks } from '@/data/chart-range'
import { formatSignedExact } from '@/data/overview'
import { t } from '@/i18n'
import { useAfterPaint } from '@/lib/after-paint'
import { CHART_FONT as FONT } from '@/lib/chart-defaults'
import { clock24, formatSignedTick, tickStep } from '@/lib/format'
import { snapshotBarWidth } from './progression-series'

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip)

export interface ChangeBar {
  /** Axis label (one column per bar). */
  tick?: string
  /** Place on the time axis (epoch ms), with `domain`. */
  x?: number
  /** Tooltip title. */
  title: string
  value: number
  /** Extra tooltip lines (muted). */
  detail?: string[]
}

/**
 * Change per period as columns from a zero line: gains in blue, losses in
 * amber (the sign in the tooltip carries the meaning too). Same tokens and
 * tooltip as TimelineChart, re-read when the theme flips.
 *
 * With `domain`, the bars stand at their `x` on a time axis ticked like
 * TimelineChart's over the same window, thinner as they crowd: with the
 * same `yAxisWidth` and `padRight` as a TimelineChart above, each bar sits
 * under that chart's point at the same time.
 */
const props = withDefaults(
  defineProps<{
    bars: ChangeBar[]
    /** Series name in the tooltip ("Mora"). */
    name: string
    /** Accessible name of the chart. */
    label: string
    height?: number
    /** A time axis from `domain[0]` to `domain[1]` (epoch ms) instead of one column per bar. */
    domain?: [number, number]
    /** Least width of the y axis (px), to line the plot up with another chart's. */
    yAxisWidth?: number
    /** Room after the plot (px). */
    padRight?: number
  }>(),
  { height: 150, domain: undefined, yAxisWidth: 0, padRight: 0 },
)

/** The y axis's own width after each layout, for the widest-of-both sync. */
const emit = defineEmits<{ yAxisFit: [width: number] }>()

/** A column's value, or a bar at a time. */
type Datum = number | { x: number; y: number }

const canvas = ref<HTMLCanvasElement>()
const chart = shallowRef<Chart<'bar', Datum[]>>()

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/** The time axis: TimelineChart's ticks and labels over `domain`, with its grid. */
function timeScale(domain: [number, number], grid: string, muted: string): ScaleOptions<'linear'> {
  const axis = axisFormat(domain[1] - domain[0])
  const hour12 = !clock24()
  return {
    type: 'linear',
    // A single capture has no width to span; Chart.js then pads the axis itself.
    ...(domain[1] > domain[0] ? { min: domain[0], max: domain[1] } : {}),
    bounds: 'data',
    // Bar charts pad half a column at each end; a time axis must match the line's.
    offset: false,
    grid: { color: grid, offset: false },
    border: { color: grid },
    ticks: {
      color: muted,
      maxTicksLimit: 6,
      maxRotation: 0,
      callback: (value) => axisTick(Number(value), axis, hour12),
    },
    afterBuildTicks: (scale) => {
      scale.ticks = axisTicks(scale.min, scale.max, scale.width, axis).map((value) => ({ value }))
    },
  }
}

function config(): ChartConfiguration<'bar', Datum[]> {
  const bars = props.bars
  const domain = props.domain
  const grid = token('--chart-grid')
  const zero = token('--border-strong')
  const muted = token('--text-muted')
  // Blue up, amber down: never red against green (the site's colour-blind rule).
  const gain = token('--chart-4')
  const loss = token('--chart-2')
  return {
    type: 'bar',
    data: {
      labels: domain ? undefined : bars.map((b) => b.tick ?? ''),
      datasets: [
        {
          label: props.name,
          data: domain
            ? bars.map((b) => ({ x: b.x ?? domain[0], y: b.value }))
            : bars.map((b) => b.value),
          backgroundColor: bars.map((b) => (b.value >= 0 ? gain : loss)),
          hoverBackgroundColor: bars.map((b) => (b.value >= 0 ? gain : loss)),
          borderRadius: domain ? 2 : 4,
          borderSkipped: 'start',
          maxBarThickness: 24,
          barPercentage: 0.8,
          categoryPercentage: 1,
          // Every snapshot bar is a change (unchanged captures have none): keep tiny ones visible.
          minBarLength: domain ? 2 : 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      layout: { padding: { right: props.padRight } },
      interaction: domain
        ? { mode: 'nearest', axis: 'x', intersect: false }
        : { mode: 'index', intersect: false },
      scales: {
        x: domain
          ? timeScale(domain, grid, muted)
          : {
              grid: { display: false },
              border: { color: grid },
              ticks: {
                color: muted,
                maxTicksLimit: 6,
                maxRotation: 0,
                autoSkip: true,
                autoSkipPadding: 16,
                // Label widths are measured on a sample: hourly ranges have thousands.
                sampleSize: 24,
              },
            },
        y: {
          grid: { color: (ctx) => (ctx.tick?.value === 0 ? zero : grid) },
          border: { display: false },
          ticks: {
            color: muted,
            maxTicksLimit: 5,
            callback: (v, _, ticks) => formatSignedTick(Number(v), tickStep(ticks)),
          },
          afterFit: (scale) => {
            emit('yAxisFit', scale.width)
            scale.width = Math.max(scale.width, props.yAxisWidth)
          },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: token('--surface-raised'),
          borderColor: token('--border-default'),
          borderWidth: 1,
          titleColor: token('--text-primary'),
          bodyColor: token('--text-secondary'),
          footerColor: muted,
          titleFont: { family: FONT, size: 14, weight: 'bold' },
          bodyFont: { family: FONT, size: 14 },
          footerFont: { family: FONT, size: 13, weight: 'normal' },
          padding: 10,
          displayColors: true,
          boxPadding: 4,
          callbacks: {
            title: (items) => bars[items[0]?.dataIndex ?? -1]?.title ?? '',
            label: (item) =>
              t('progression.tooltip', {
                name: props.name,
                value: formatSignedExact(Number(item.parsed.y)),
              }),
            footer: (items) => bars[items[0]?.dataIndex ?? -1]?.detail ?? [],
          },
        },
      },
    },
    plugins: domain
      ? [
          {
            // Sized to the plot once it is laid out, before the bars are placed.
            id: 'snapshotBarWidth',
            afterLayout: (c) => {
              const dataset = c.data.datasets[0]
              if (dataset) dataset.barThickness = snapshotBarWidth(bars.length, c.chartArea.width)
            },
          },
        ]
      : [],
  }
}

function render() {
  if (!canvas.value) return
  chart.value?.destroy()
  chart.value = new Chart(canvas.value, config())
}

// Drawn after the page's first paint (measuring the canvas lays the page out).
const later = useAfterPaint()
onMounted(() => later(() => chart.value ?? render()))
onBeforeUnmount(() => chart.value?.destroy())
watch(() => [props.bars, props.name, props.domain, props.padRight], render)
// A wider y axis only moves the plot: lay it out again.
watch(
  () => props.yAxisWidth,
  () => chart.value?.update('none'),
)
// Re-read the tokens when the theme flips.
useMutationObserver(
  () => document.documentElement,
  () => render(),
  { attributes: true, attributeFilter: ['data-theme'] },
)
</script>

<template>
  <div class="relative w-full" :style="{ height: `${height}px` }">
    <canvas ref="canvas" role="img" :aria-label="label" />
  </div>
</template>
