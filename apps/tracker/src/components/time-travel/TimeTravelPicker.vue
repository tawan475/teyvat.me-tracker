<script setup lang="ts">
import type { SnapshotResponse } from '@gdt/shared'
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ChevronLeft, ChevronRight, History } from 'lucide-vue-next'
import UiPopover from '@/components/ui/UiPopover.vue'
import { dayKey } from '@/data/overview'
import { leavePastOnNextNavigation } from '@/data/time-travel'
import { dateLocale, formatNumber, formatTime } from '@/lib/format'

/**
 * Time travel's capture picker (the user's design A3, 2026-11-09): a month
 * calendar whose days with captures are marked (underline and bold, not
 * colour alone), then the chosen day's captures, newest first. Picking one
 * goes there (`?at=`); "Now" leaves the past. Opened from the bar's date and
 * from the top bar's clock.
 */
const props = defineProps<{
  open: boolean
  anchor: HTMLElement | null
  /** The account's snapshots (any order). */
  snapshots: readonly SnapshotResponse[]
  /** The snapshot travelled to, or null when viewing now. */
  at: number | null
}>()
const emit = defineEmits<{ close: [] }>()

const route = useRoute()
const router = useRouter()

/** Snapshots by local day (YYYY-MM-DD), newest first within a day. */
const byDay = computed(() => {
  const map = new Map<string, SnapshotResponse[]>()
  for (const s of [...props.snapshots].sort((a, b) => b.takenAt - a.takenAt || b.id - a.id)) {
    const key = dayKey(s.takenAt)
    const list = map.get(key)
    if (list) list.push(s)
    else map.set(key, [s])
  }
  return map
})

const current = computed(() => props.snapshots.find((s) => s.id === props.at) ?? null)
const newest = computed(() =>
  props.snapshots.reduce<SnapshotResponse | null>(
    (best, s) => (!best || s.takenAt > best.takenAt ? s : best),
    null,
  ),
)

const shown = ref(new Date())
const picked = ref('')
watch(
  () => props.open,
  (open) => {
    if (!open) return
    const start = current.value ?? newest.value
    const date = start ? new Date(start.takenAt) : new Date()
    shown.value = new Date(date.getFullYear(), date.getMonth(), 1)
    picked.value = dayKey(date.getTime())
  },
  { immediate: true },
)

const monthLabel = computed(() =>
  shown.value.toLocaleDateString(dateLocale(), { month: 'long', year: 'numeric' }),
)
const weekdays = computed(() => {
  // Monday first; names from the locale.
  const monday = new Date(2024, 0, 1)
  return Array.from({ length: 7 }, (_, i) =>
    new Date(monday.getFullYear(), 0, 1 + i).toLocaleDateString(dateLocale(), {
      weekday: 'narrow',
    }),
  )
})
const days = computed(() => {
  const year = shown.value.getFullYear()
  const month = shown.value.getMonth()
  const lead = (new Date(year, month, 1).getDay() + 6) % 7
  const count = new Date(year, month + 1, 0).getDate()
  const cells: ({ key: string; day: number; captures: number } | null)[] = []
  for (let i = 0; i < lead; i++) cells.push(null)
  for (let day = 1; day <= count; day++) {
    const key = dayKey(new Date(year, month, day).getTime())
    cells.push({ key, day, captures: byDay.value.get(key)?.length ?? 0 })
  }
  return cells
})
function step(months: number) {
  const month = new Date(shown.value.getFullYear(), shown.value.getMonth() + months, 1)
  shown.value = month
  // The list follows the calendar: that month's latest day with captures.
  const prefix = dayKey(month.getTime()).slice(0, 8)
  picked.value =
    [...byDay.value.keys()]
      .filter((k) => k.startsWith(prefix))
      .sort()
      .at(-1) ?? ''
}
const pickedCaptures = computed(() => byDay.value.get(picked.value) ?? [])
const pickedLabel = computed(() => {
  if (!picked.value) return ''
  const [y, m, d] = picked.value.split('-').map(Number)
  return new Date(y!, m! - 1, d!).toLocaleDateString(dateLocale(), {
    day: 'numeric',
    month: 'long',
  })
})

function go(id: number) {
  emit('close')
  if (id === newest.value?.id && props.at === null) return
  void router.push({ query: { ...route.query, at: String(id) } })
}
function now() {
  emit('close')
  if (props.at === null) return
  leavePastOnNextNavigation()
  const query = { ...route.query }
  delete query.at
  void router.push({ query })
}
</script>

<template>
  <UiPopover
    :open="open"
    :anchor="anchor"
    :label="$t('shell.timeTravel.pick')"
    @close="emit('close')"
  >
    <template #heading>
      <h2 class="flex min-w-0 flex-1 items-center gap-2 truncate text-base font-semibold">
        <History class="size-4 shrink-0 text-warning-text" aria-hidden="true" />
        {{ $t('shell.timeTravel.pick') }}
      </h2>
    </template>
    <div class="flex flex-col gap-3 p-4">
      <div class="flex items-center justify-between">
        <button
          type="button"
          class="inline-flex size-9 items-center justify-center rounded-lg border border-border-default hover:bg-surface-overlay"
          :aria-label="$t('shell.timeTravel.previousMonth')"
          @click="step(-1)"
        >
          <ChevronLeft class="size-4" aria-hidden="true" />
        </button>
        <span class="font-semibold capitalize">{{ monthLabel }}</span>
        <button
          type="button"
          class="inline-flex size-9 items-center justify-center rounded-lg border border-border-default hover:bg-surface-overlay"
          :aria-label="$t('shell.timeTravel.nextMonth')"
          @click="step(1)"
        >
          <ChevronRight class="size-4" aria-hidden="true" />
        </button>
      </div>
      <div class="grid grid-cols-7 gap-1 text-center text-sm" role="grid">
        <span v-for="(w, i) in weekdays" :key="i" class="py-1 text-xs text-text-muted">{{
          w
        }}</span>
        <template v-for="(cell, i) in days" :key="cell?.key ?? `lead-${i}`">
          <span v-if="!cell" />
          <button
            v-else
            type="button"
            class="flex h-9 items-center justify-center rounded-lg transition-colors"
            :class="[
              cell.key === picked
                ? 'bg-amber-300 font-bold text-stone-900'
                : cell.captures
                  ? 'font-semibold text-text-primary underline decoration-amber-400 decoration-dotted decoration-2 underline-offset-4 hover:bg-surface-overlay'
                  : 'cursor-default text-text-muted',
            ]"
            :disabled="!cell.captures"
            :aria-pressed="cell.key === picked"
            :aria-label="
              cell.captures
                ? $t(
                    'shell.timeTravel.dayCaptures',
                    { n: formatNumber(cell.captures) },
                    cell.captures,
                  ) + ` · ${cell.key}`
                : cell.key
            "
            @click="picked = cell.key"
          >
            {{ cell.day }}
          </button>
        </template>
      </div>
      <div
        v-if="pickedCaptures.length"
        class="flex flex-col gap-2 border-t border-border-default pt-3"
      >
        <span class="text-xs font-medium text-text-secondary">{{
          $t(
            'shell.timeTravel.dayHeading',
            { day: pickedLabel, n: formatNumber(pickedCaptures.length) },
            pickedCaptures.length,
          )
        }}</span>
        <div class="grid grid-cols-3 gap-1.5">
          <button
            v-for="s in pickedCaptures"
            :key="s.id"
            type="button"
            class="flex min-h-11 flex-col items-center justify-center rounded-lg border px-2 py-1 transition-colors"
            :class="
              s.id === at
                ? 'border-amber-400 bg-amber-300 text-stone-900'
                : 'border-border-default hover:bg-surface-overlay'
            "
            :aria-current="s.id === at ? 'true' : undefined"
            :title="
              $t('shell.timeTravel.captureLine', {
                id: s.id,
                characters: formatNumber(s.summary.characters),
              })
            "
            @click="go(s.id)"
          >
            <span class="tabular font-mono text-sm font-semibold">{{ formatTime(s.takenAt) }}</span>
            <span
              class="tabular text-[11px]"
              :class="s.id === at ? 'text-stone-700' : 'text-text-muted'"
              >#{{ s.id }}</span
            >
          </button>
        </div>
      </div>
      <button
        v-if="at !== null"
        type="button"
        class="min-h-10 rounded-lg bg-stone-900 px-3 text-sm font-semibold text-amber-300 dark:bg-stone-800"
        @click="now"
      >
        {{ $t('shell.timeTravel.backToNow') }}
      </button>
    </div>
  </UiPopover>
</template>
