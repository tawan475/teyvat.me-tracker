<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  shallowRef,
  watch,
} from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { CheckCheck, FileUp, Info, SearchX } from 'lucide-vue-next'
import { achievementText, loadAchievements } from '@gdt/game-data'
import {
  DEFAULT_ACHIEVEMENT_FILTERS,
  NO_ACHIEVEMENT_FILTERS,
  achievementVersions,
  countAchievements,
  filterAchievements,
  groupAchievements,
  hasAchievementFilters,
  idsToMark,
  idsToUnmark,
  matchesCompletion,
  restoreFilters,
  storedFilters,
  summarizeAchievements,
  type AchievementEntry,
  type AchievementFilters,
  type DoneState,
  type ProgressCount,
} from '@/data/achievement-progress'
import AchievementCategories, {
  type CategoryItem,
} from '@/components/achievements/AchievementCategories.vue'
import AchievementGroup from '@/components/achievements/AchievementGroup.vue'
import JustSyncedBar from '@/components/live/JustSyncedBar.vue'
import { useJustSynced } from '@/lib/just-synced'
import AchievementImportDialog from '@/components/achievements/AchievementImportDialog.vue'
import AchievementSummary from '@/components/achievements/AchievementSummary.vue'
import AchievementToolbar from '@/components/achievements/AchievementToolbar.vue'
import { useAchievementMarks } from '@/components/achievements/use-achievement-marks'
import PageHeader from '@/components/ui/PageHeader.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import UiError from '@/components/ui/UiError.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import { NO_CAPTURED_ACHIEVEMENTS, loadCapturedAchievements } from '@/data/achievement-capture'
import { useResource } from '@/data/use-resource'
import { gameIcon, loadGameIcons } from '@/lib/assets'
import { formatNumber } from '@/lib/format'
import { readJson, writeJson } from '@/lib/storage'
import { t } from '@/i18n'
import { locale } from '@/i18n/locale'
import { useFeedback } from '@/stores/feedback'
import { useAccount, useReadOnly } from './context'

/**
 * Achievements: done = the newest snapshot that has achievements (irminsul
 * sees them when the in-game menu is opened) plus the ones marked by hand.
 * Categories beside (a select on small screens), filters on top, rows
 * rendered a page at a time as the list scrolls.
 */
const account = useAccount()
const feedback = useFeedback()

const game = useResource(
  () => locale.value,
  async (lang) => {
    const [data, text, english] = await Promise.all([
      loadAchievements(),
      achievementText(lang),
      // The guide links go to the Fandom wiki, whose pages are titled in English.
      lang === 'en' ? null : achievementText('en'),
      loadGameIcons(),
    ])
    return { data, text, english: english ?? text, entries: groupAchievements(data) }
  },
)

// Tagged with the account, so a switch shows a skeleton, not the last account's data.
const capture = useResource(
  () => account.value,
  async (a) => ({
    accountId: a.id,
    captured: a.latest ? await loadCapturedAchievements(a) : NO_CAPTURED_ACHIEVEMENTS,
  }),
)
const captured = computed(() => {
  const value = capture.data.value
  return value && value.accountId === account.value.id ? value.captured : null
})

const marks = useAchievementMarks(() => account.value.id)

const state = computed<DoneState>(() => ({
  captured: captured.value?.ids ?? NO_CAPTURED_ACHIEVEMENTS.ids,
  marked: marks.marked.value,
}))
const ready = computed(
  () => !!game.data.value && !!captured.value && marks.loadedFor.value === account.value.id,
)
const loadError = computed(() => game.error.value ?? capture.error.value ?? marks.error.value)
function retry() {
  if (game.error.value) void game.reload()
  if (capture.error.value) void capture.reload()
  if (marks.error.value) void marks.reload()
}

const entries = computed(() => game.data.value?.entries ?? [])
const summary = computed(() =>
  game.data.value
    ? summarizeAchievements(entries.value, state.value, game.data.value.data.byId)
    : null,
)

const ZERO: ProgressCount = { done: 0, total: 0, primogems: 0, primogemsTotal: 0 }
const categories = computed<CategoryItem[]>(() => {
  const g = game.data.value
  const s = summary.value
  if (!g || !s) return []
  return g.data.goals
    .filter((goal) => s.byGoal.has(goal.id))
    .map((goal) => ({
      id: goal.id,
      name: g.text.goals.get(goal.id) ?? `#${goal.id}`,
      icon: gameIcon(goal.icon),
      count: s.byGoal.get(goal.id) ?? ZERO,
    }))
})
const categoryById = computed(() => new Map(categories.value.map((c) => [c.id, c])))

// --------------------------------------------------------- completed series

const SHOW_DONE_KEY = 'gdt:achievements:show-done-series'
function readShowDone(): boolean {
  try {
    return localStorage.getItem(SHOW_DONE_KEY) === '1'
  } catch {
    return false
  }
}
/** Completed series are out of the way unless the viewer asks for them. */
const showDoneSeries = ref(readShowDone())
watch(showDoneSeries, (show) => {
  try {
    if (show) localStorage.setItem(SHOW_DONE_KEY, '1')
    else localStorage.removeItem(SHOW_DONE_KEY)
  } catch {
    // Private mode: the choice lasts for this visit.
  }
})
/** Series finished while on the page stay until the filters change. */
const keptSeries = shallowRef<ReadonlySet<number>>(new Set())
const doneSeries = computed(
  () =>
    new Set(
      categories.value
        .filter((c) => c.count.total > 0 && c.count.done >= c.count.total)
        .map((c) => c.id),
    ),
)
const hiddenSeries = computed(() => {
  if (showDoneSeries.value) return new Set<number | null>()
  const hidden = new Set<number | null>()
  for (const id of doneSeries.value)
    if (id !== filters.goal && !keptSeries.value.has(id as number) && !syncedGoals.value.has(id))
      hidden.add(id)
  return hidden
})
/** The rail and the category select. */
const listedCategories = computed(() =>
  categories.value.filter((c) => !hiddenSeries.value.has(c.id)),
)
const versions = computed(() => achievementVersions(entries.value))

/** When the account last synced is in the top bar; here only that it never was. */
const notCaptured = computed(() => captured.value?.takenAt == null)

// ------------------------------------------------------------------ filters

/**
 * The page opens on the filters last used on this device (the search
 * aside); first time on what is left ("Missing" is the default, not a
 * filter).
 */
const FILTERS_KEY = 'achievements:filters'
const filters = reactive<AchievementFilters>(restoreFilters(readJson(FILTERS_KEY, null)))
watch(
  () => storedFilters(filters),
  (stored) => writeJson(FILTERS_KEY, stored),
  { deep: true },
)
/** A stored category or version the game data doesn't have (any more) is dropped. */
watch(
  () => game.data.value,
  (g) => {
    if (!g) return
    const known = restoreFilters(storedFilters(filters), {
      goals: new Set(g.data.goals.map((goal) => goal.id)),
      versions: new Set(achievementVersions(g.entries)),
    })
    if (known.goal !== filters.goal) filters.goal = known.goal
    if (known.version !== filters.version) filters.version = known.version
  },
  { immediate: true },
)
// `?q=<title>` (the site search): that search over every category and state, then the URL lets go.
const route = useRoute()
const router = useRouter()
watch(
  () => route.query.q,
  (q) => {
    if (typeof q !== 'string' || !q) return
    Object.assign(filters, NO_ACHIEVEMENT_FILTERS, { query: q })
    const query = { ...route.query }
    delete query.q
    void router.replace({ query })
  },
  { immediate: true },
)
const filtered = computed(() => hasAchievementFilters(filters))
/** A search or the Done filter is looking for done ones: don't hide them. */
const hideSeriesEntries = computed(
  () => filters.query.trim() === '' && filters.completion !== 'done',
)

/**
 * Entries toggled since the filters last changed stay in view, so marking
 * one done under "Missing" does not make it vanish under the pointer.
 */
const kept = shallowRef<ReadonlySet<number>>(new Set())
const entryOfTier = computed(() => {
  const map = new Map<number, number>()
  for (const entry of entries.value) for (const tier of entry.tiers) map.set(tier.id, entry.id)
  return map
})
function keep(ids: number[]) {
  const series = new Set(keptSeries.value)
  const goalOf = new Map(entries.value.map((e) => [e.id, e.goal]))
  for (const id of ids) {
    const goal = goalOf.get(entryOfTier.value.get(id) ?? -1)
    if (goal !== undefined) series.add(goal)
  }
  keptSeries.value = series
  if (filters.completion === 'all') return
  const next = new Set(kept.value)
  for (const id of ids) {
    const entry = entryOfTier.value.get(id)
    if (entry !== undefined) next.add(entry)
  }
  kept.value = next
}

/**
 * Entries a capture finished while the page is open (a live sync batch or a
 * snapshot; the user's ask): they stay in view, marked, until the filters
 * change, Hide, or the page is left (lib/just-synced.ts).
 */
const justSynced = useJustSynced(
  () => captured.value?.ids ?? null,
  () => [JSON.stringify(filters), account.value.id],
)
/** Entry id → when its newest synced tier came in. */
const syncedEntries = computed(() => {
  const map = new Map<number, number>()
  for (const [tier, at] of justSynced.synced.value) {
    const entry = entryOfTier.value.get(tier)
    if (entry !== undefined) map.set(entry, Math.max(at, map.get(entry) ?? 0))
  }
  return map
})
const syncedGoals = computed(() => {
  const goalOf = new Map(entries.value.map((e) => [e.id, e.goal]))
  return new Set<number | null>([...syncedEntries.value.keys()].map((id) => goalOf.get(id) ?? null))
})

/** Entries matching every filter but completion. */
const matching = computed<AchievementEntry[]>(() => {
  const g = game.data.value
  if (!g) return []
  return filterAchievements(entries.value, { ...filters, completion: 'all' }, state.value, g.text)
})
const shown = computed<AchievementEntry[]>(() =>
  matching.value.filter(
    (entry) =>
      (kept.value.has(entry.id) ||
        syncedEntries.value.has(entry.id) ||
        matchesCompletion(entry, filters.completion, state.value)) &&
      (!hideSeriesEntries.value ||
        !hiddenSeries.value.has(entry.goal) ||
        syncedGoals.value.has(entry.goal)),
  ),
)
/**
 * Why nothing shows: nothing matches, or everything that does is done
 * (under "Missing", or in completed series) or none of it is (under "Done").
 */
const empty = computed<'none' | 'allDone' | 'noneDone' | null>(() => {
  if (shown.value.length > 0) return null
  if (matching.value.length === 0) return 'none'
  return filters.completion === 'done' ? 'noneDone' : 'allDone'
})

function clearFilters() {
  Object.assign(filters, DEFAULT_ACHIEVEMENT_FILTERS)
}
/** Counted in achievements (tiers), like the summary. */
const shownCount = computed(() => countAchievements(shown.value, filters.completion, state.value))

// Picking a category far down the list starts it from its top.
const listTop = ref<HTMLElement>()
watch(
  () => filters.goal,
  () => {
    const top = listTop.value
    if (top && top.getBoundingClientRect().top < 0) top.scrollIntoView({ block: 'start' })
  },
)

function toggleMissing() {
  filters.completion = filters.completion === 'missing' ? 'all' : 'missing'
}

// ---------------------------------------------------------- lazy rendering

const PAGE = 60
const limit = ref(PAGE)
watch([filters, () => account.value.id], () => {
  limit.value = PAGE
  kept.value = new Set()
  keptSeries.value = new Set()
})

const groups = computed(() => {
  const list: { category: CategoryItem; entries: AchievementEntry[] }[] = []
  for (const entry of shown.value.slice(0, limit.value)) {
    let group = list.at(-1)
    if (!group || group.category.id !== entry.goal) {
      const category = categoryById.value.get(entry.goal)
      if (!category) continue
      list.push((group = { category, entries: [] }))
    }
    group.entries.push(entry)
  }
  return list
})

const sentinel = ref<HTMLElement>()
let observer: IntersectionObserver | null = null

function more() {
  if (limit.value >= shown.value.length) return
  limit.value += PAGE
  // Observing again reports whether the sentinel is still in view.
  void nextTick(() => {
    if (!observer || !sentinel.value) return
    observer.unobserve(sentinel.value)
    observer.observe(sentinel.value)
  })
}

onMounted(() => {
  if (typeof IntersectionObserver === 'undefined') return
  observer = new IntersectionObserver(
    (records) => records.some((r) => r.isIntersecting) && more(),
    {
      rootMargin: '0px 0px 800px 0px',
    },
  )
  if (sentinel.value) observer.observe(sentinel.value)
})
watch(sentinel, (element, previous) => {
  if (previous) observer?.unobserve(previous)
  if (element) observer?.observe(element)
})
onBeforeUnmount(() => observer?.disconnect())

// ------------------------------------------------------------------ marking

function undoAction(done: number[], undone: number[]) {
  return { label: t('achievements.undo'), run: () => void marks.change(done, undone) }
}

/** Staff Inspect and viewers: the marks show, nothing is marked. */
const readOnly = useReadOnly()

function mark(ids: number[]) {
  if (readOnly) return
  keep(ids)
  void marks.change(ids)
}
function unmark(ids: number[]) {
  if (readOnly) return
  keep(ids)
  void marks.change([], ids)
}

const toMark = computed(() => idsToMark(shown.value, state.value))
const toUnmark = computed(() => idsToUnmark(shown.value, state.value))

async function markAll() {
  const ids = toMark.value
  if (!ids.length) return
  const n = formatNumber(ids.length)
  const ok = await feedback.confirm({
    title: t('achievements.confirmMark.title', { n }),
    detail: filtered.value
      ? t('achievements.confirmMark.filtered', { n })
      : t('achievements.confirmMark.all', { n }),
    confirmLabel: t('achievements.confirmMark.confirm'),
  })
  if (ok && (await marks.change(ids)))
    feedback.toast({
      tone: 'success',
      title: t('achievements.markedDone', { n }),
      action: undoAction([], ids),
    })
}

async function unmarkAll() {
  const ids = toUnmark.value
  if (!ids.length) return
  const n = formatNumber(ids.length)
  const ok = await feedback.confirm({
    title: t('achievements.confirmUnmark.title', { n }),
    detail: t('achievements.confirmUnmark.detail', { n }),
    confirmLabel: t('achievements.confirmUnmark.confirm'),
    tone: 'danger',
  })
  if (ok && (await marks.change([], ids)))
    feedback.toast({
      tone: 'success',
      title: t('achievements.unmarked', { n }),
      action: undoAction(ids, []),
    })
}

// ------------------------------------------------------------------ import

const importOpen = ref(false)
async function importIds(ids: number[]): Promise<boolean> {
  const ok = await marks.change(ids)
  if (ok)
    feedback.toast({
      tone: 'success',
      title: t('achievements.added', { n: formatNumber(ids.length) }),
      action: undoAction([], ids),
    })
  return ok
}
</script>

<template>
  <div>
    <PageHeader :title="$t('achievements.title')" bare>
      <template v-if="ready && captured && notCaptured" #meta>
        <p
          class="flex items-center gap-1.5 text-text-secondary"
          :title="$t('achievements.notCapturedTitle')"
        >
          <Info class="size-4 shrink-0" aria-hidden="true" />
          {{ $t('achievements.notCaptured') }}
        </p>
      </template>
      <template v-if="!readOnly" #actions>
        <UiButton
          :disabled="!ready"
          :title="$t('achievements.importTitle')"
          @click="importOpen = true"
        >
          <FileUp class="size-4" aria-hidden="true" />
          Seelie / paimon / stardb
        </UiButton>
      </template>
    </PageHeader>

    <UiError
      v-if="loadError && !ready"
      :title="$t('achievements.loadFailed')"
      :error="loadError"
      @retry="retry"
    />

    <template v-else-if="ready && summary && game.data.value && captured">
      <AchievementSummary
        class="mb-4 lg:mb-6"
        :summary="summary"
        :missing-only="filters.completion === 'missing'"
        @toggle-missing="toggleMissing"
      />

      <div class="lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-6">
        <aside class="hidden lg:block">
          <div
            class="sticky top-[4.5rem] max-h-[calc(100dvh-5.5rem)] overflow-y-auto rounded-xl border border-border-default bg-surface-raised p-2 shadow-sm"
          >
            <AchievementCategories
              v-model="filters.goal"
              v-model:show-done="showDoneSeries"
              :categories="listedCategories"
              :total="summary"
              :done-count="doneSeries.size"
            />
          </div>
        </aside>

        <div ref="listTop" class="flex min-w-0 scroll-mt-20 flex-col gap-4">
          <AchievementToolbar
            v-model:filters="filters"
            v-model:show-done-series="showDoneSeries"
            :categories="listedCategories"
            :done-series="doneSeries.size"
            :versions="versions"
            :shown="shownCount"
            :total="summary.total"
            :filtered="filtered"
            :to-mark="readOnly ? 0 : toMark.length"
            :to-unmark="readOnly ? 0 : toUnmark.length"
            @clear="clearFilters"
            @mark-all="markAll"
            @unmark-all="unmarkAll"
          />

          <JustSyncedBar :count="syncedEntries.size" @hide="justSynced.hide" />

          <UiPanel v-if="empty" flush>
            <UiEmpty v-if="empty === 'allDone'" :title="$t('achievements.allDone')">
              <template #icon><CheckCheck class="text-success-text" aria-hidden="true" /></template>
              <UiButton @click="filters.completion = 'done'">{{
                $t('achievements.showDone')
              }}</UiButton>
            </UiEmpty>
            <UiEmpty v-else-if="empty === 'noneDone'" :title="$t('achievements.noneDone')">
              <template #icon><SearchX aria-hidden="true" /></template>
              <UiButton @click="filters.completion = 'missing'">{{
                $t('achievements.showMissing')
              }}</UiButton>
            </UiEmpty>
            <UiEmpty v-else :title="$t('achievements.noMatches')">
              <template #icon><SearchX aria-hidden="true" /></template>
              <UiButton @click="clearFilters">{{ $t('achievements.clear') }}</UiButton>
            </UiEmpty>
          </UiPanel>

          <AchievementGroup
            v-for="group in groups"
            :key="group.category.id ?? 'all'"
            :category="group.category"
            :entries="group.entries"
            :text="game.data.value.text"
            :english="game.data.value.english"
            :synced="syncedEntries"
            :state="state"
            :capture="captured"
            @mark="mark"
            @unmark="unmark"
          />

          <div v-if="limit < shown.length" ref="sentinel" class="flex justify-center">
            <UiButton variant="ghost" @click="more">
              {{ $t('achievements.more') }}
              <span class="tabular font-mono text-text-muted">{{
                formatNumber(shown.length - limit)
              }}</span>
            </UiButton>
          </div>
        </div>
      </div>

      <AchievementImportDialog
        :open="importOpen"
        :uid="account.uid"
        :state="state"
        :known="game.data.value.data.byId"
        :save="importIds"
        @close="importOpen = false"
      />
    </template>

    <div v-else aria-busy="true" :aria-label="$t('achievements.loading')">
      <div class="mb-4 grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4 lg:mb-6">
        <UiSkeleton v-for="n in 4" :key="n" class="h-16 sm:h-[4.5rem]" />
      </div>
      <div class="lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-6">
        <UiSkeleton class="hidden h-[28rem] lg:block" />
        <div class="flex flex-col gap-4">
          <UiSkeleton class="h-28 w-full" />
          <div class="rounded-xl border border-border-default bg-surface-raised p-4">
            <div v-for="n in 6" :key="n" class="flex items-start gap-3 py-3">
              <UiSkeleton class="size-7 rounded-full" />
              <div class="flex flex-1 flex-col gap-2">
                <UiSkeleton class="h-4 w-48" />
                <UiSkeleton class="h-4 w-full" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
