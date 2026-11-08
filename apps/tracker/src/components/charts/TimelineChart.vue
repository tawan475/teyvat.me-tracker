<script setup lang="ts">
import {
  CategoryScale,
  Chart,
  Filler,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  type ChartConfiguration,
} from 'chart.js'
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useMutationObserver } from '@vueuse/core'
import { axisFormat, axisTick, axisTicks } from '@/data/chart-range'
import { useAfterPaint } from '@/lib/after-paint'
import { CHART_FONT } from '@/lib/chart-defaults'
import { t } from '@/i18n'
import { clock24, formatCompactTick, formatDateTime, formatNumber, tickStep } from '@/lib/format'

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Filler,
)

export interface TimelineSeries {
  label: string
  /** A chart token: 1–6 (see --chart-N in main.css). */
  color: 1 | 2 | 3 | 4 | 5 | 6
  points: { x: number; y: number }[]
}

/**
 * A line chart over time (x in epoch ms). Colours come from the design
 * tokens and are re-read when the theme flips. Series with very different
 * scales belong in separate charts: there is one y axis. The x axis ticks
 * fall on round local times, labelled by the span shown (see axisFormat):
 * times of day up to a day, day and time up to a week, dates beyond.
 */
const props = withDefaults(
  defineProps<{
    series: TimelineSeries[]
    label: string
    height?: number
    /** Formats y values on the axis. Defaults to compact numbers as precise as the ticks need. */
    format?: (value: number) => string
    stepped?: boolean
    fill?: boolean
    /** Least width of the y axis (px), to line the plot up with a chart below. */
    yAxisWidth?: number
    /** Room after the plot (px). */
    padRight?: number
    /** Fixed ends of the y axis (undefined: fitted to the values). */
    yMin?: number
    yMax?: number
  }>(),
  { height: 260, fill: undefined, yAxisWidth: 0, padRight: 0, yMin: undefined, yMax: undefined },
)

/** The y axis's own width after each layout, for charts that line up with this one. */
const emit = defineEmits<{ yAxisFit: [width: number] }>()

const canvas = ref<HTMLCanvasElement>()
const chart = shallowRef<Chart<'line'>>()

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function config(): ChartConfiguration<'line'> {
  const format = props.format
  const grid = token('--chart-grid')
  const muted = token('--text-muted')
  const xs = props.series.flatMap((s) => s.points.map((p) => p.x))
  const span = xs.length ? Math.max(...xs) - Math.min(...xs) : 0
  const axis = axisFormat(span)
  const hour12 = !clock24()
  return {
    type: 'line',
    data: {
      datasets: props.series.map((s) => {
        const color = token(`--chart-${s.color}`)
        return {
          label: s.label,
          data: s.points,
          borderColor: color,
          backgroundColor: `${color}22`,
          fill: props.fill ?? props.series.length === 1,
          stepped: props.stepped ? 'before' : false,
          borderWidth: 2,
          pointRadius: s.points.length > 60 ? 0 : 2,
          pointHoverRadius: 4,
          tension: 0,
        }
      }),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      parsing: false,
      normalized: true,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      layout: { padding: { right: props.padRight } },
      scales: {
        x: {
          type: 'linear',
          bounds: 'data',
          grid: { color: grid },
          border: { color: grid },
          ticks: {
            color: muted,
            maxTicksLimit: 6,
            maxRotation: 0,
            callback: (value) => axisTick(Number(value), axis, hour12),
          },
          // Round local times (every 15 minutes, 3 hours, day…), as many as fit the width.
          afterBuildTicks: (scale) => {
            scale.ticks = axisTicks(scale.min, scale.max, scale.width, axis).map((value) => ({
              value,
            }))
          },
        },
        y: {
          min: props.yMin,
          max: props.yMax,
          // A fixed end (a bag limit) gets its own tick: drop a round one too close to it.
          afterBuildTicks: (scale) => {
            const ticks = scale.ticks
            if (ticks.length < 3) return
            const step = Math.abs(ticks[1]!.value - ticks[0]!.value)
            const near = (a: number, b: number) => a !== b && Math.abs(a - b) < step * 0.6
            scale.ticks = ticks.filter(
              (tick) =>
                !(props.yMax !== undefined && near(tick.value, props.yMax)) &&
                !(props.yMin !== undefined && near(tick.value, props.yMin)),
            )
          },
          grid: { color: grid },
          border: { display: false },
          ticks: {
            color: muted,
            callback: (value, _, ticks) =>
              format ? format(Number(value)) : formatCompactTick(Number(value), tickStep(ticks)),
          },
          afterFit: (scale) => {
            emit('yAxisFit', scale.width)
            scale.width = Math.max(scale.width, props.yAxisWidth)
          },
        },
      },
      plugins: {
        tooltip: {
          backgroundColor: token('--surface-raised'),
          borderColor: token('--border-default'),
          borderWidth: 1,
          titleColor: token('--text-primary'),
          bodyColor: token('--text-secondary'),
          titleFont: { family: CHART_FONT, size: 14 },
          bodyFont: { family: CHART_FONT, size: 14 },
          padding: 10,
          callbacks: {
            title: (items) => (items[0] ? formatDateTime(Number(items[0].parsed.x)) : ''),
            label: (item) =>
              t('progression.tooltip', {
                name: item.dataset.label ?? '',
                value: formatNumber(Number(item.parsed.y)),
              }),
          },
        },
      },
    },
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
watch(
  () => [props.series, props.stepped, props.fill, props.padRight, props.yMin, props.yMax],
  render,
  { deep: true },
)
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
