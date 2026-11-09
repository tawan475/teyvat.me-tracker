<script setup lang="ts">
import type { SnapshotResponse } from '@gdt/shared'
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useEventListener } from '@vueuse/core'
import { ChevronDown, ChevronLeft, ChevronRight, History, Lock } from 'lucide-vue-next'
import { leavePastOnNextNavigation, stepFrom, type Travel } from '@/data/time-travel'
import { formatDateTime, formatNumber } from '@/lib/format'
import TimeTravelPicker from './TimeTravelPicker.vue'

/**
 * The bar that says the page is in the past (the user's design A3,
 * 2026-11-09): amber under the app bar, a clock and "Past", Older | the
 * capture's date and time (opens the picker) | Newer, "Snapshot x / N",
 * read-only with a lock, and "Back to now". On phones one row of controls
 * with the words on a line below. Alt + ← / → step too. Said with an icon
 * and words, never the colour alone.
 */
const props = defineProps<{
  travel: Travel
  /** The account's snapshots (any order), for stepping and the picker. */
  snapshots: readonly SnapshotResponse[]
}>()

const route = useRoute()
const router = useRouter()

const older = computed(() => stepFrom(props.snapshots, props.travel.at, -1))
const newer = computed(() => stepFrom(props.snapshots, props.travel.at, 1))

function go(id: number | null) {
  if (id === null) return
  void router.replace({ query: { ...route.query, at: String(id) } })
}
function backToNow() {
  leavePastOnNextNavigation()
  const query = { ...route.query }
  delete query.at
  void router.push({ query })
}

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (!event.altKey || event.ctrlKey || event.metaKey) return
  const target = event.target as HTMLElement | null
  if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
  if (event.key === 'ArrowLeft' && older.value !== null) {
    event.preventDefault()
    go(older.value)
  } else if (event.key === 'ArrowRight' && newer.value !== null) {
    event.preventDefault()
    go(newer.value)
  }
})

const pickerAnchor = ref<HTMLElement | null>(null)
const picking = ref(false)
const counter = computed(() => ({
  index: formatNumber(props.travel.index),
  total: formatNumber(props.travel.total),
}))
</script>

<template>
  <div data-time-travel>
    <div
      role="status"
      class="flex min-h-13 items-center gap-2 bg-amber-300 px-3 py-2 text-stone-900 sm:gap-3 sm:px-8"
    >
      <History class="size-5 shrink-0" stroke-width="2.2" aria-hidden="true" />
      <span class="hidden font-bold sm:inline">{{ $t('shell.timeTravel.past') }}</span>
      <div
        class="flex h-10 min-w-0 flex-1 items-stretch overflow-hidden rounded-lg border border-stone-900/25 bg-white/55 sm:h-9 sm:flex-none"
      >
        <button
          type="button"
          class="inline-flex w-10 shrink-0 items-center justify-center border-r border-stone-900/20 enabled:hover:bg-white/60 disabled:opacity-35 sm:w-9"
          :disabled="older === null"
          :aria-label="$t('shell.timeTravel.older')"
          :title="$t('shell.timeTravel.olderTitle')"
          @click="go(older)"
        >
          <ChevronLeft class="size-4" aria-hidden="true" />
        </button>
        <button
          ref="pickerAnchor"
          type="button"
          class="tabular inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 px-3 text-sm font-semibold hover:bg-white/60 sm:text-[15px]"
          :aria-label="$t('shell.timeTravel.pickTitle', { time: formatDateTime(travel.takenAt) })"
          @click="picking = true"
        >
          <span class="truncate">{{ formatDateTime(travel.takenAt) }}</span>
          <ChevronDown class="size-3.5 shrink-0" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="inline-flex w-10 shrink-0 items-center justify-center border-l border-stone-900/20 enabled:hover:bg-white/60 disabled:opacity-35 sm:w-9"
          :disabled="newer === null"
          :aria-label="$t('shell.timeTravel.newer')"
          :title="$t('shell.timeTravel.newerTitle')"
          @click="go(newer)"
        >
          <ChevronRight class="size-4" aria-hidden="true" />
        </button>
      </div>
      <span class="tabular hidden text-sm text-stone-700 sm:inline">{{
        $t('shell.timeTravel.counter', counter)
      }}</span>
      <span class="hidden flex-1 sm:block" />
      <span class="hidden items-center gap-1.5 text-sm text-stone-700 sm:inline-flex">
        <Lock class="size-3.5" aria-hidden="true" />
        {{ $t('shell.timeTravel.readOnly') }}
      </span>
      <button
        type="button"
        class="h-10 shrink-0 rounded-lg bg-stone-900 px-3 text-sm font-semibold text-amber-300 hover:bg-stone-800 sm:h-9 sm:px-4"
        @click="backToNow"
      >
        <span class="sm:hidden">{{ $t('shell.timeTravel.now') }}</span>
        <span class="hidden sm:inline">{{ $t('shell.timeTravel.backToNow') }}</span>
      </button>
    </div>
    <p
      class="tabular border-b border-border-default bg-surface-base px-4 py-1.5 text-xs text-text-muted sm:hidden"
    >
      {{ $t('shell.timeTravel.phoneLine', counter) }}
    </p>
    <TimeTravelPicker
      :open="picking"
      :anchor="pickerAnchor"
      :snapshots="snapshots"
      :at="travel.at"
      @close="picking = false"
    />
  </div>
</template>
