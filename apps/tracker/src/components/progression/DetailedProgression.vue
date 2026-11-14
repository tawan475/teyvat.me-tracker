<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, useTemplateRef, watch } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import ChartRangeSelect from '@/components/charts/ChartRangeSelect.vue'
import { useChartRange } from '@/components/charts/use-chart-range'
import { Settings, TrendingUp } from 'lucide-vue-next'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiSegmented, { type SegmentedOption } from '@/components/ui/UiSegmented.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import type { TimelineSeries } from '@/components/charts/TimelineChart.vue'
import { axisFormat, fitGroupBy, formatWindow, groupFits } from '@/data/chart-range'
import { loadArtifactRarityHistory } from '@/data/artifact-rarity'
import { loadMaterialsHistory } from '@/data/materials'
import type { Capture, Point } from '@/data/overview'
import { GROUP_BY_OPTIONS, nextPeriod } from '@/data/progression'
import { useResource } from '@/data/use-resource'
import { t } from '@/i18n'
import { clock24, formatDateTime, formatNumber } from '@/lib/format'
import { readStorage, writeStorage } from '@/lib/storage'
import { pageNow, useAccount, useTravel } from '@/views/account/context'
import type { ChangeBar } from './ChangeBarChart.vue'
import { bagLimit, yBounds, type Graph } from './graphs'
import ProgressionGraphsDialog from './ProgressionGraphsDialog.vue'
import ProgressionGraphView, { type GraphView } from './ProgressionGraphView.vue'
import {
  buildProgression,
  buildSnapshotProgression,
  defaultGroup,
  MAX_PERIODS,
  periodTick,
  periodTitle,
  periodTotals,
  SNAPSHOT_BAR_WIDTH,
  snapshotTotals,
  withMaterialFigures,
  withArtifactFigures,
  ARTIFACT_RARITY_FIGURES,
  LINE_SHAPES,
  MATERIAL_FIGURES,
  type FigureKey,
  type LineShape,
  type PeriodTotals,
  type ProgressionGroup,
} from './progression-series'
import { useProgressionGraphs } from './use-progression-graphs'

/**
 * A report card of graphs (mora, primogems, wishes, character EXP,
 * artifacts, 5★ … 1★ artifacts, characters, weapons): each figure's value as
 * a line, stepped or straight from capture to capture (the button left of the
 * grouping), and its delta graph under it (gains and losses as columns, per
 * snapshot, each under its step on the same time axis, or per period).
 * Wishes and character EXP come from the materials history, loaded only
 * while a graph needs them. The cog opens the Graphs dialog: which graphs, in
 * what order, each one's y axis (from the lowest value / 0 / a number, to the
 * highest / the bag limit / a number) and delta graph, saved in the user's
 * settings (useProgressionGraphs). Line shape, group-by and range are
 * remembered on this device per card (`storage`); until a grouping is picked,
 * ranges up to a week show snapshots and longer ones days. A period too
 * coarse for the range is greyed out and the next finer one shown (6h is per
 * hour), the choice coming back with a longer range. `captures` is undefined
 * while the history loads.
 */
const props = withDefaults(
  defineProps<{
    captures: Capture[] | undefined
    title?: string
    /** Storage key prefix for this card's choices on this device (line, group-by, range). */
    storage?: string
    /** The grouping until one is picked (else per snapshot up to a week, per day beyond). */
    defaultGroup?: ProgressionGroup
  }>(),
  {
    title: undefined,
    storage: 'progression',
    defaultGroup: undefined,
  },
)

const COLORS: Record<FigureKey, TimelineSeries['color']> = {
  mora: 2,
  primogem: 4,
  wishes: 6,
  characterExp: 1,
  artifacts: 5,
  // Rarities in the list's order, each a step lighter or darker than the next.
  artifact5: 2,
  artifact4: 6,
  artifact3: 3,
  artifact2: 1,
  artifact1: 4,
  characters: 1,
  weapons: 3,
}
/** A figure's name in the language on screen. */
const figureTitle = (key: FigureKey) => t(`overview.figure.${key}`)

/** The card's graphs (the user's settings, see useProgressionGraphs). */
const saved = useProgressionGraphs()
/** While the Graphs dialog is open: its graphs, shown on the card as they change. */
const editing = ref<Graph[] | null>(null)
const graphs = computed<readonly Graph[]>(() => editing.value ?? saved.graphs.value)
const dialogOpen = ref(false)
function openGraphs() {
  editing.value = [...saved.graphs.value]
  dialogOpen.value = true
}
const saveGraphs = useDebounceFn((next: Graph[]) => saved.save(next).catch(() => undefined), 600)
function graphsChanged(next: Graph[]) {
  editing.value = next
  void saveGraphs(next)
}
function closeGraphs() {
  dialogOpen.value = false
  const last = editing.value
  editing.value = null
  // Saved at once on close (the debounced save may not have run yet).
  if (last) void saved.save(last).catch(() => undefined)
}

/** Stepped (the default) or straight lines, remembered per device. */
const LINE_KEY = `${props.storage}-line`
const storedLine = readStorage(LINE_KEY)
const line = ref<LineShape>(LINE_SHAPES.find((shape) => shape === storedLine) ?? 'stepped')
function toggleLine() {
  line.value = line.value === 'straight' ? 'stepped' : 'straight'
  writeStorage(LINE_KEY, line.value)
}

// Wishes and character EXP: read from each capture's materials, loaded while a graph shows one.
const account = useAccount()
const wantsMaterials = computed(() =>
  graphs.value.some((graph) => MATERIAL_FIGURES.includes(graph.figure)),
)
const books = useResource(
  () => (wantsMaterials.value && account.value.latest ? account.value : null),
  (a) => (a ? loadMaterialsHistory(a) : Promise.resolve(null)),
)
// 5★ / 2★ / 1★ artifacts: counted from each snapshot's artifact rows, loaded while a graph shows one.
const wantsRarities = computed(() =>
  graphs.value.some((graph) => ARTIFACT_RARITY_FIGURES.includes(graph.figure)),
)
const rarities = useResource(
  () => (wantsRarities.value && account.value.latest ? account.value : null),
  (a) => (a ? loadArtifactRarityHistory(a) : Promise.resolve(null)),
)
/**
 * The captures the series read: with the materials' and the artifact
 * rarities' figures once loaded, undefined while they load.
 */
const seriesCaptures = computed(() => {
  let all: readonly Capture[] | undefined = props.captures
  if (!all) return all
  if (wantsRarities.value && !rarities.error.value) {
    if (rarities.loading.value) return undefined
    const history = rarities.data.value
    if (history) all = withArtifactFigures(all, history)
  }
  if (!wantsMaterials.value || books.error.value) return all
  if (books.loading.value) return undefined
  const history = books.data.value
  return history ? withMaterialFigures(all, history) : all
})
/** Without the materials (none captured, or they failed to load) their figures have no graph. */
const hasMaterials = computed(() => !books.error.value && !!books.data.value)
/** Likewise the counted artifact rarities. */
const hasRarities = computed(() => !rarities.error.value && !!rarities.data.value)

const GROUPS: SegmentedOption<ProgressionGroup>[] = [
  {
    value: 'snapshot',
    get label() {
      return t('progression.group.snapshot')
    },
  },
  ...GROUP_BY_OPTIONS,
]

/** Room after both plots for half the widest snapshot bar, at the newest capture. */
const PAD_RIGHT = SNAPSHOT_BAR_WIDTH.max / 2

const GROUP_KEY = `${props.storage}-group-by`
const storedGroup = readStorage(GROUP_KEY)
/** The grouping picked on this device; none until the control is used. */
const chosenGroup = ref<ProgressionGroup | null>(
  GROUPS.find((o) => o.value === storedGroup)?.value ?? props.defaultGroup ?? null,
)
watch(chosenGroup, (value) => value && writeStorage(GROUP_KEY, value))
const range = useChartRange(`${props.storage}-range`)

/** The grouping in use: the choice (or default), or a finer period when the range is too short for it. */
const groupBy = computed<ProgressionGroup>({
  get: () => {
    const choice = chosenGroup.value ?? defaultGroup(range.value)
    return choice === 'snapshot' ? choice : fitGroupBy(range.value, choice)
  },
  set: (value) => (chosenGroup.value = value),
})
const groupOptions = computed<SegmentedOption<ProgressionGroup>[]>(() =>
  GROUPS.map((option) =>
    option.value === 'snapshot' || groupFits(range.value, option.value)
      ? option
      : { ...option, disabled: true, title: t('progression.longerThanRange') },
  ),
)

const groupRow = useTemplateRef<HTMLElement>('groupRow')
/** On a phone the five options scroll sideways: keep the one in use in view. */
function revealGroup() {
  const row = groupRow.value
  const chosen = row?.querySelector('[aria-checked="true"]')
  if (!row || !chosen) return
  const bounds = row.getBoundingClientRect()
  const option = chosen.getBoundingClientRect()
  if (option.right > bounds.right) row.scrollLeft += option.right - bounds.right
  else if (option.left < bounds.left) row.scrollLeft -= bounds.left - option.left
}
onMounted(revealGroup)
watch(groupBy, revealGroup, { flush: 'post' })

// The right edge is now: a minute clock moves it (and an hour range) on while the page is open.
// In the past (time travel) the edge is the capture's time and stays there.
const travel = useTravel()
const now = ref(pageNow(travel.value))
const clock = setInterval(() => (now.value = pageNow(travel.value)), 60_000)
onBeforeUnmount(() => clearInterval(clock))

const periodic = computed(() => {
  const group = groupBy.value
  const all = seriesCaptures.value
  return all && group !== 'snapshot'
    ? buildProgression(all, group, range.value, now.value, line.value)
    : null
})
const perSnapshot = computed(() =>
  seriesCaptures.value && groupBy.value === 'snapshot'
    ? buildSnapshotProgression(seriesCaptures.value, range.value, now.value, line.value)
    : null,
)

/** Whichever grouping is in use, or null without currency data. */
const shown = computed<{ lines: Record<FigureKey, Point[]>; truncated: boolean } | null>(
  () => perSnapshot.value ?? periodic.value,
)

// Labels for the periods are shared by both charts.
const periodLabels = computed(() => {
  const p = periodic.value
  const group = groupBy.value
  if (!p || group === 'snapshot') return []
  const hour12 = !clock24()
  const first = p.periods[0]
  const last = p.periods[p.periods.length - 1]
  const axis = first && last ? axisFormat(nextPeriod(last.start, group) - first.start) : 'date'
  return p.periods.map((period) => ({
    tick: periodTick(period.start, group, hour12, axis),
    title: periodTitle(period.start, group, hour12),
    captures:
      period.captures === 0
        ? t('progression.noCaptures')
        : t('progression.captures', { n: formatNumber(period.captures) }, period.captures),
  }))
})

/** The window both charts cover, for the range tooltip and the charts' accessible names. */
const span = computed(() => {
  const line = shown.value?.lines[graphs.value[0]?.figure ?? 'mora']
  const first = line?.[0]
  const last = line?.[line.length - 1]
  return first && last ? formatWindow(first.x, last.x, !clock24()) : ''
})

/** "Per day", in the language on screen. */
const perLabel = computed(() => t(`progression.per.${groupBy.value}`))

/** Tooltip on the "Per day" label; says so when older bars were left out. */
const perDetail = computed(() => {
  const detail = t(`progression.against.${groupBy.value}`)
  return shown.value?.truncated
    ? `${detail} · ${t(`progression.newest.${groupBy.value}`, { n: formatNumber(MAX_PERIODS) })}`
    : detail
})

/** The bars and totals of one figure, per period or per snapshot. */
function barsOf(key: FigureKey): { bars: ChangeBar[]; totals: PeriodTotals } | null {
  const s = perSnapshot.value
  if (s) {
    return {
      totals: snapshotTotals(s, key),
      bars: s.changes[key].map((c) => ({
        x: c.at,
        title: formatDateTime(c.at),
        value: c.change,
        detail: [t('progression.total', { n: formatNumber(c.value) })],
      })),
    }
  }
  const p = periodic.value
  if (!p) return null
  const labels = periodLabels.value
  return {
    totals: periodTotals(p, key),
    bars: p.periods.map((period, i) => ({
      tick: labels[i]!.tick,
      title: labels[i]!.title,
      value: period.change[key],
      detail: [t('progression.total', { n: formatNumber(period.close[key]) }), labels[i]!.captures],
    })),
  }
}

/** How a computed figure is counted, for its title's tooltip. */
const spareHint = () => t('overview.lowRarity.hint')
const FIGURE_HINTS: Partial<Record<FigureKey, () => string>> = {
  wishes: () => t('progression.graphs.wishesHint'),
  artifact5: spareHint,
  artifact4: spareHint,
  artifact3: spareHint,
  artifact2: spareHint,
  artifact1: spareHint,
}

/** A graph as the card draws it (null while its figure has no data). */
function viewOf(graph: Graph, id: string): GraphView | null {
  const lines = shown.value?.lines
  if (!lines) return null
  if (MATERIAL_FIGURES.includes(graph.figure) && !hasMaterials.value) return null
  if (ARTIFACT_RARITY_FIGURES.includes(graph.figure) && !hasRarities.value) return null
  const figure = barsOf(graph.figure)
  if (!figure) return null
  const { bars, totals } = figure
  const title = figureTitle(graph.figure)
  const value = formatNumber(totals.last)
  const { min, max } = yBounds(graph)
  return {
    id,
    title,
    hint: FIGURE_HINTS[graph.figure]?.(),
    last: totals.last,
    net: totals.net,
    gained: totals.gained,
    spent: totals.spent,
    series: [{ label: title, color: COLORS[graph.figure], points: lines[graph.figure] }],
    lineLabel: t('progression.lineLabel', { figure: title, span: span.value, value }),
    bars,
    domain: perSnapshot.value?.domain,
    barsLabel: t('progression.barsLabel', {
      figure: title,
      per: perLabel.value.toLowerCase(),
      span: span.value,
      gained: formatNumber(totals.gained),
      spent: formatNumber(totals.spent),
    }),
    bag: bagLimit(graph),
    yMin: min,
    yMax: max,
    delta: graph.delta,
  }
}

/** The Graphs dialog's picked graph, drawn in its Preview (a computed: a new view each render would redraw it). */
const previewGraph = ref<Graph | null>(null)
const previewView = computed(() =>
  previewGraph.value ? viewOf(previewGraph.value, 'preview') : null,
)

const charts = computed<GraphView[]>(() =>
  graphs.value.flatMap((graph, i) => viewOf(graph, `g${i}`) ?? []),
)

/** A figure's values along its line (at most ~25), for the dialog's sparklines. */
function spark(figure: FigureKey): readonly number[] | null {
  const points = shown.value?.lines[figure]
  if (!points || points.length < 2) return null
  const step = Math.max(1, Math.floor(points.length / 24))
  return points.filter((_, i) => i % step === 0 || i === points.length - 1).map((p) => p.y)
}
const colorOf = (figure: FigureKey) => COLORS[figure]

/**
 * Each graph's own y-axis width, by graph and chart: the line and its bars
 * both take the wider, so their plots start and end at the same x and the
 * snapshot bars stand under their steps.
 */
const axisFits = reactive<Record<string, number>>({})
const yAxisWidth = (id: string) =>
  Math.max(axisFits[`${id}-line`] ?? 0, axisFits[`${id}-bars`] ?? 0)
function fitAxis(id: string, width: number) {
  if (axisFits[id] !== width) axisFits[id] = width
}
</script>

<template>
  <UiPanel :title="title ?? $t('progression.title')">
    <template #actions>
      <UiIconButton :label="$t('progression.graphs.open')" @click="openGraphs">
        <Settings class="size-5" aria-hidden="true" />
      </UiIconButton>
      <UiIconButton
        :label="$t('progression.straight')"
        :active="line === 'straight'"
        :aria-pressed="line === 'straight'"
        @click="toggleLine"
      >
        <TrendingUp class="size-5" aria-hidden="true" />
      </UiIconButton>
      <div
        ref="groupRow"
        class="scroll-hide scroll-fade-x max-w-full min-w-0 overflow-x-auto sm:scroll-fade-none sm:overflow-visible"
      >
        <UiSegmented v-model="groupBy" :options="groupOptions" :label="$t('progression.groupBy')" />
      </div>
      <ChartRangeSelect v-model="range" :detail="span || undefined" />
    </template>

    <div v-if="!seriesCaptures" class="grid gap-8 lg:grid-cols-2" role="status">
      <span class="sr-only">{{ $t('progression.loading') }}</span>
      <div v-for="n in 2" :key="n" class="flex flex-col gap-3">
        <div class="flex justify-between gap-4">
          <UiSkeleton class="h-6 w-24" />
          <UiSkeleton class="h-6 w-32" />
        </div>
        <UiSkeleton class="h-[220px] w-full" />
        <UiSkeleton class="mt-2 h-[150px] w-full" />
      </div>
    </div>

    <p v-else-if="!shown" class="py-6 text-center text-text-secondary">
      {{ $t('progression.noData') }}
    </p>

    <div v-else class="grid gap-8 lg:grid-cols-2">
      <ProgressionGraphView
        v-for="view in charts"
        :key="view.id"
        :view="view"
        :stepped="line === 'stepped'"
        :per-label="perLabel"
        :per-detail="perDetail"
        :y-axis-width="yAxisWidth(view.id)"
        :pad-right="PAD_RIGHT"
        @fit="(part, width) => fitAxis(`${view.id}-${part}`, width)"
      />
    </div>

    <ProgressionGraphsDialog
      :open="dialogOpen"
      :graphs="graphs"
      :signed-in="saved.signedIn.value"
      :spark="spark"
      :color-of="colorOf"
      @change="graphsChanged"
      @close="closeGraphs"
      @preview="(graph) => (previewGraph = graph)"
    >
      <template #preview>
        <ProgressionGraphView
          v-if="previewView"
          :view="previewView"
          compact
          :stepped="line === 'stepped'"
          :per-label="perLabel"
          :per-detail="perDetail"
          :y-axis-width="yAxisWidth('preview')"
          :pad-right="PAD_RIGHT"
          @fit="(part, width) => fitAxis(`preview-${part}`, width)"
        />
        <p v-else class="py-6 text-center text-sm text-text-muted">
          {{ $t('progression.noData') }}
        </p>
      </template>
    </ProgressionGraphsDialog>
  </UiPanel>
</template>
