<script setup lang="ts">
import type { CustomTask, DomainEventWindow, GameNotice, PlannerTask } from '@gdt/shared'
import { computed, ref, shallowRef, watch } from 'vue'
import {
  AlarmClock,
  CalendarDays,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  GripVertical,
  ListChecks,
  Moon,
  Plus,
  Radar,
  StickyNote,
} from 'lucide-vue-next'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiPopover from '@/components/ui/UiPopover.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiSwitch from '@/components/ui/UiSwitch.vue'
import { t } from '@/i18n'
import { IMAGE_BASE, giCdnArt } from '@/lib/assets'
import { formatDateTime, formatNumber } from '@/lib/format'
import { readStorage, writeStorage } from '@/lib/storage'
import { useFeedback } from '@/stores/feedback'
import { daysText, weekdayShort } from './farm-format'
import TaskEditor from './TaskEditor.vue'
import {
  CUSTOM_SNOOZES,
  dayStart,
  dayText,
  doneInput,
  formatSpan,
  gameDay,
  listedBuiltins,
  snoozeChoices,
  snoozedInput,
  taskInput,
  taskRows,
  undoneInput,
  weekdayOf,
  type CapturedTasks,
  type TaskIcon,
  type TaskRow,
} from './tasks'
import { moveBy, moveTo } from './allocation'
import { newGoalId } from './goal-ids'
import { useDragOrder } from './use-drag-order'
import { removeTask, upsertTask, type TaskOp } from './use-planner-tasks'

/**
 * The planner's tasks (Seelie's): the built-in dailies and weeklies whose
 * resets the game keeps (tasks.ts), and the player's own recurring ones.
 * Each row: Done (with Undo), a snooze to a later day, and how long until
 * its reset (red when that is close and it isn't done). Done and snoozed
 * ones rest out of the list until they are due again ("show all" shows
 * them, ticked; a tick takes it back). Custom tasks open their editor and
 * reorder by their handle in the Custom tab. Collapsible; the choice and
 * the tab are this device's.
 */
const props = defineProps<{
  tasks: readonly PlannerTask[]
  now: number
  server: string | null
  /** Domain event windows (the tracker's): running ones are daily tasks, soon ones rest. */
  events?: readonly DomainEventWindow[]
  /** The notice board's events: one-time tasks while they run. */
  notices?: readonly GameNotice[]
  /** The newest capture's `gi_tasks`: ticks commissions and the Abyss, adds a few rows. */
  capture?: CapturedTasks | null
}>()
const emit = defineEmits<{ change: [ops: TaskOp[]] }>()
const feedback = useFeedback()

type Tab = 'all' | 'builtin' | 'event' | 'custom'
const open = ref(readStorage('planner:tasks') !== 'closed')
watch(open, (value) => writeStorage('planner:tasks', value ? null : 'closed'))
const tab = ref<Tab>(
  (['builtin', 'event', 'custom'] as const).find((x) => x === readStorage('planner:tasks-tab')) ??
    'all',
)
watch(tab, (value) => writeStorage('planner:tasks-tab', value === 'all' ? null : value))
const showAll = ref(false)

const today = computed(() => gameDay(props.now, props.server))
const rows = computed(() =>
  taskRows(
    props.tasks,
    props.now,
    props.server,
    props.events ?? [],
    props.notices ?? [],
    props.capture ?? null,
  ),
)
const builtins = computed(() => listedBuiltins(props.capture))

const iconUrl = (icon: TaskIcon) =>
  icon.from === 'cdn' ? giCdnArt(icon.name) : `${IMAGE_BASE}${icon.name}.webp`
/** A white glyph as a mask over the text colour (gi-cdn and nanoka both answer CORS). */
const glyphStyle = (icon: TaskIcon) => {
  const mask = `url("${iconUrl(icon)}") center / contain no-repeat`
  return { mask, WebkitMask: mask }
}

/** "4 of 4 done · From the capture of 14:02": what a captured row's figure means. */
function captureTitle(row: TaskRow): string {
  const c = row.capture
  return c ? `${c.title} · ${t('planner.tasks.capture.from', { time: formatDateTime(c.at) })}` : ''
}
const dueRows = computed(() => rows.value.filter((r) => r.due))
const dueCount = (kind?: TaskRow['kind']) =>
  dueRows.value.filter((r) => !kind || r.kind === kind).length
const TABS = computed(() => [
  { value: 'all' as const, label: t('planner.toolbar.status.all'), count: dueCount() },
  { value: 'builtin' as const, label: t('planner.tasks.permanent'), count: dueCount('builtin') },
  { value: 'event' as const, label: t('planner.tasks.events'), count: dueCount('event') },
  { value: 'custom' as const, label: t('planner.card.custom'), count: dueCount('custom') },
])
const shown = computed(() =>
  rows.value.filter(
    (r) =>
      (tab.value === 'all' || r.kind === tab.value) &&
      (r.due || showAll.value || (tab.value === 'custom' && r.kind === 'custom')),
  ),
)
const resting = computed(
  () => rows.value.filter((r) => !r.due && (tab.value === 'all' || r.kind === tab.value)).length,
)
/** Seelie-like tag pills, one tint per kind. */
const TAG_TONE = {
  daily: 'bg-amber-500/15 text-warning-text',
  checkin: 'bg-accent/15 text-accent-text',
  exploration: 'bg-emerald-500/15 text-success-text',
  quest: 'bg-sky-500/15 text-sky-600 dark:text-sky-300',
} as const
const soon = computed(() => dueRows.value.filter((r) => r.tone === 'soon'))

// ------------------------------------------------------------ labels

function when(row: TaskRow): { text: string; title: string } {
  if (row.notice) {
    const n = row.notice
    if (n.start > props.now) {
      return {
        text: t('planner.tasks.startsIn', { time: formatSpan(n.start - props.now) }),
        title: t('planner.tasks.eventStarts', { time: formatDateTime(n.start) }),
      }
    }
    if (n.end === null) return { text: '∞', title: t('planner.tasks.noEnd') }
    const ends = t('planner.tasks.eventEnds', { time: formatDateTime(n.end) })
    return { text: formatSpan(n.end - props.now), title: ends }
  }
  if (row.event) {
    const e = row.event
    if (e.start > props.now) {
      return {
        text: t('planner.tasks.startsIn', { time: formatSpan(e.start - props.now) }),
        title: t('planner.tasks.eventStarts', { time: formatDateTime(e.start) }),
      }
    }
    const ends = t('planner.tasks.eventEnds', { time: formatDateTime(e.end) })
    if (row.due) {
      return {
        text: formatSpan(row.resets! - props.now),
        title: `${t('planner.tasks.resets', { time: formatDateTime(row.resets!) })} · ${ends}`,
      }
    }
    return {
      text: formatSpan(row.back! - props.now),
      title: `${t('planner.tasks.doneBack', { time: formatDateTime(row.back!) })} · ${ends}`,
    }
  }
  if (row.kind === 'builtin') {
    // A row only a capture makes: its figure, due or resting without a
    // time (the jar not yet full).
    if (row.capture && (row.due ? row.builtin?.capture : row.back === null)) {
      return { text: row.capture.text, title: captureTitle(row) }
    }
    if (row.due) {
      return row.resets === null
        ? { text: t('planner.tasks.ready'), title: t('planner.tasks.readyTitle') }
        : {
            text: formatSpan(row.resets - props.now),
            title: t('planner.tasks.resets', { time: formatDateTime(row.resets) }),
          }
    }
    return {
      text: formatSpan(row.back! - props.now),
      title: t(row.snoozed ? 'planner.tasks.snoozedBack' : 'planner.tasks.doneBack', {
        time: formatDateTime(row.back!),
      }),
    }
  }
  const c = row.custom!
  const every =
    c.task.every === 1
      ? t('planner.tasks.everyDay')
      : t('planner.tasks.everyDays', { n: c.task.every })
  const from =
    c.task.mode === 'completed' ? t('planner.tasks.fromDone') : t('planner.tasks.fromStart')
  const title = t('planner.tasks.dueTitle', { date: dayText(c.due), every, from })
  if (row.late > 0) {
    return {
      text: row.late === 1 ? t('planner.tasks.overdue') : t('planner.tasks.late', { n: row.late }),
      title,
    }
  }
  if (row.late === 0) return { text: t('planner.tasks.today'), title }
  if (row.late === -1) return { text: t('planner.tasks.tomorrow'), title }
  if (row.late >= -6) return { text: weekdayShort(weekdayOf(c.due)), title }
  return { text: t('farm.time.d', { d: -row.late }), title }
}

/** The time's tooltip, saying so when a capture decided the row. */
function timeTitle(row: TaskRow): string {
  const base = when(row).title
  if (!row.capture?.rules) return base
  const from = t('planner.tasks.capture.from', { time: formatDateTime(row.capture.at) })
  return base.endsWith(from) ? base : `${base} · ${from}`
}

const TONE: Record<TaskRow['tone'], string> = {
  soon: 'font-medium text-danger-text',
  today: 'font-medium text-accent-text',
  due: 'text-text-secondary',
  rest: 'text-text-muted',
}

// ------------------------------------------------------------ actions

function change(ops: TaskOp[]) {
  emit('change', ops)
}

function withUndo(title: string, row: TaskRow, ops: TaskOp[]) {
  const before = taskInput(row)
  change(ops)
  feedback.toast({
    tone: 'info',
    title,
    action: { label: t('planner.common.undo'), run: () => change([upsertTask(before)]) },
  })
}

function tick(row: TaskRow) {
  if (!row.due) {
    change([upsertTask(undoneInput(row))])
    return
  }
  withUndo(t('planner.tasks.doneToast', { name: row.name }), row, [
    upsertTask(doneInput(row, Date.now(), props.server)),
  ])
}

const snoozeRow = shallowRef<TaskRow | null>(null)
const snoozeAnchor = ref<HTMLElement | null>(null)
const snoozeOpen = ref(false)
function openSnooze(row: TaskRow, event: Event) {
  snoozeRow.value = row
  snoozeAnchor.value = event.currentTarget as HTMLElement
  snoozeOpen.value = true
}
const snoozes = computed(() => {
  const row = snoozeRow.value
  if (!row) return []
  const now = props.now
  if (row.builtin) return snoozeChoices(row.builtin, now, props.server)
  return CUSTOM_SNOOZES.map((days) => ({
    days,
    until: dayStart(today.value + days, props.server),
    last: false,
  }))
})
const canSnooze = (row: TaskRow) =>
  row.due &&
  row.kind !== 'event' &&
  (!row.builtin || snoozeChoices(row.builtin, props.now, props.server).length > 0)
function snooze(days: number) {
  const row = snoozeRow.value
  snoozeOpen.value = false
  if (!row) return
  const ops = [upsertTask(snoozedInput(row, days, Date.now(), props.server))]
  const day = weekdayShort(weekdayOf(today.value + days))
  withUndo(t('planner.tasks.backToast', { name: row.name, day }), row, ops)
}

// ------------------------------------------------------------ built-ins on/off

const listAnchor = ref<HTMLElement | null>(null)
const listOpen = ref(false)
function openList(event: Event) {
  listAnchor.value = event.currentTarget as HTMLElement
  listOpen.value = true
}
const stored = computed(() => new Map(props.tasks.map((x) => [`${x.kind}:${x.id}`, x])))
const hidden = (id: string) => {
  const task = stored.value.get(`builtin:${id}`)
  return task?.kind === 'builtin' && !!task.hidden
}
function setShown(id: string, on: boolean) {
  const task = stored.value.get(`builtin:${id}`)
  const next =
    task?.kind === 'builtin' && task.next !== undefined && task.next !== null
      ? { next: task.next }
      : {}
  change([upsertTask({ kind: 'builtin', id, ...next, ...(on ? {} : { hidden: true }) })])
}

// ------------------------------------------------------------ custom tasks

const editorOpen = ref(false)
const editing = shallowRef<TaskRow | null>(null)
function add() {
  editing.value = null
  editorOpen.value = true
}
function edit(row: TaskRow) {
  editing.value = row
  editorOpen.value = true
}
const customRows = computed(() => rows.value.filter((r) => r.kind === 'custom'))
function save(task: CustomTask, due: number) {
  const row = editing.value
  editorOpen.value = false
  if (row?.custom) {
    const input = taskInput(row)
    change([upsertTask({ ...input, kind: 'custom', id: row.id, task, due: dayText(due) })])
    return
  }
  const last = customRows.value.at(-1)?.custom?.position ?? 0
  change([
    upsertTask({
      kind: 'custom',
      id: newGoalId(),
      task,
      due: dayText(due),
      position: customRows.value.length ? last + 1 : 1,
    }),
  ])
  tab.value = tab.value === 'builtin' ? 'all' : tab.value
}
function removeEditing() {
  const row = editing.value
  editorOpen.value = false
  if (!row) return
  const before = taskInput(row)
  change([removeTask({ kind: 'custom', id: row.id })])
  feedback.toast({
    tone: 'info',
    title: t('planner.tasks.deleted', { name: row.name }),
    action: { label: t('planner.common.undo'), run: () => change([upsertTask(before)]) },
  })
}

/** Stores the custom tasks' order as positions 1…n (only those that change). */
function reorder(ids: string[]) {
  const byId = new Map(customRows.value.map((r) => [r.id, r]))
  const ops = ids.flatMap((id, i) => {
    const row = byId.get(id)
    if (!row) return []
    const input = taskInput(row)
    if (input.kind !== 'custom' || input.position === i + 1) return []
    return [upsertTask({ ...input, position: i + 1 })]
  })
  if (ops.length) change(ops)
}
const order = () => customRows.value.map((r) => r.id)
/** Handles and rows carry `task:<id>` (the goal cards' drag helper names its targets so). */
const plain = (id: string) => id.replace(/^task:/, '')
const drag = useDragOrder({
  move: (id, to) => reorder(moveTo(order(), plain(id), plain(to))),
  step: (id, by) => {
    const list = order()
    if (by === 'start' || by === 'end') {
      const rest = list.filter((x) => x !== plain(id))
      reorder(by === 'start' ? [plain(id), ...rest] : [...rest, plain(id)])
    } else reorder(moveBy(list, plain(id), by))
  },
})
const sorting = computed(() => tab.value === 'custom' && customRows.value.length > 1)

const summary = computed(() => {
  const n = dueRows.value.length
  const first = soon.value[0]
  return { n, first: first ? `${first.name} ${when(first).text}` : '' }
})
</script>

<template>
  <section
    class="flex flex-col rounded-xl border border-border-default bg-surface-raised shadow-sm"
    :aria-label="$t('planner.tasks.title')"
  >
    <header class="flex flex-wrap items-center gap-x-2 gap-y-1.5 py-1.5 pr-1.5 pl-2">
      <button
        type="button"
        class="inline-flex min-h-9 items-center gap-1.5 rounded-md px-1.5 text-sm font-semibold transition-colors hover:bg-surface-overlay"
        :aria-expanded="open"
        @click="open = !open"
      >
        <ChevronDown
          class="size-4 text-text-muted transition-transform"
          :class="open ? '' : '-rotate-90'"
          aria-hidden="true"
        />
        {{ $t('planner.tasks.title') }}
        <span
          class="tabular rounded-md px-1.5 font-mono text-xs"
          :class="
            soon.length
              ? 'bg-danger-surface text-danger-text'
              : 'bg-surface-overlay text-text-secondary'
          "
          :title="$t('planner.tasks.toDo', { n: formatNumber(summary.n) })"
          >{{ formatNumber(summary.n)
          }}<span class="sr-only"> {{ $t('planner.tasks.toDoSr') }}</span></span
        >
      </button>
      <span
        v-if="!open && summary.first"
        class="min-w-0 flex-1 truncate text-sm text-danger-text"
        :title="summary.first"
        >{{ summary.first }}</span
      >
      <template v-if="open">
        <!-- Four tabs outgrow a phone: they scroll sideways there. -->
        <div
          class="scroll-hide scroll-fade-x order-last max-w-full min-w-0 basis-full overflow-x-auto whitespace-nowrap sm:order-none sm:basis-auto"
        >
          <UiSegmented v-model="tab" :options="TABS" :label="$t('planner.tasks.shown')" />
        </div>
        <span class="ml-auto flex items-center">
          <UiIconButton
            :label="
              showAll ? $t('planner.tasks.hideDone') : $t('planner.tasks.showDone', { n: resting })
            "
            :active="showAll"
            :aria-pressed="showAll"
            @click="showAll = !showAll"
          >
            <EyeOff v-if="showAll" class="size-4" aria-hidden="true" />
            <Eye v-else class="size-4" aria-hidden="true" />
          </UiIconButton>
          <UiIconButton :label="$t('planner.tasks.permanentShown')" @click="openList">
            <ListChecks class="size-4" aria-hidden="true" />
          </UiIconButton>
          <UiIconButton :label="$t('planner.tasks.add')" @click="add">
            <Plus class="size-5" aria-hidden="true" />
          </UiIconButton>
        </span>
      </template>
    </header>

    <ul
      v-if="open"
      class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,22rem),1fr))] gap-x-2 border-t border-border-subtle py-1"
      :aria-label="$t('planner.tasks.title')"
    >
      <li v-if="shown.length === 0" class="px-3 py-2 text-sm text-text-muted sm:col-span-full">
        {{ tab === 'custom' ? $t('planner.tasks.noCustom') : $t('planner.tasks.allDone') }}
      </li>
      <li
        v-for="row in shown"
        :key="row.key"
        class="flex min-h-10 min-w-0 items-center gap-1.5 border-l-2 pr-1 pl-1.5"
        :class="[
          row.tone === 'soon' ? 'border-danger' : 'border-transparent',
          drag.over.value === `task:${row.id}` && drag.dragging.value !== `task:${row.id}`
            ? 'bg-surface-overlay'
            : '',
        ]"
        :data-goal-card="sorting && row.kind === 'custom' ? `task:${row.id}` : undefined"
      >
        <button
          v-if="sorting && row.kind === 'custom'"
          type="button"
          class="inline-flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-text-muted hover:bg-surface-overlay hover:text-text-primary active:cursor-grabbing"
          :data-goal-handle="`task:${row.id}`"
          :aria-label="$t('planner.tasks.move', { name: row.name })"
          :title="$t('planner.tasks.dragTitle')"
          @pointerdown="drag.start(`task:${row.id}`, $event)"
          @keydown="drag.key(`task:${row.id}`, $event)"
        >
          <GripVertical class="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="inline-flex size-8 shrink-0 items-center justify-center rounded-full transition-colors"
          :class="
            row.due
              ? 'group/tick text-transparent hover:text-success-text'
              : 'text-success-text hover:text-text-muted'
          "
          :aria-label="
            row.due
              ? $t('planner.tasks.doneLabel', { name: row.name })
              : $t('planner.tasks.notDoneLabel', { name: row.name })
          "
          :title="row.due ? $t('planner.done.confirm') : $t('planner.tasks.takeBack')"
          @click="tick(row)"
        >
          <span
            class="inline-flex size-5 items-center justify-center rounded-full border-2"
            :class="row.due ? 'border-border-strong' : 'border-current bg-surface-overlay'"
          >
            <Check class="size-3.5" stroke-width="3" aria-hidden="true" />
          </span>
        </button>
        <component
          :is="row.kind === 'custom' ? 'button' : 'span'"
          :type="row.kind === 'custom' ? 'button' : undefined"
          class="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm"
          :class="[
            row.due ? 'text-text-primary' : 'text-text-muted',
            row.kind === 'custom' ? 'rounded-md hover:text-accent-text' : '',
          ]"
          :title="row.note ? `${row.name} · ${row.note}` : row.name"
          @click="row.kind === 'custom' ? edit(row) : undefined"
        >
          <!-- The game's icon for a built-in task; a glyph takes the text colour -->
          <span class="inline-flex size-6 shrink-0 items-center justify-center" aria-hidden="true">
            <span
              v-if="row.builtin?.icon.glyph"
              class="size-5 bg-current"
              :style="glyphStyle(row.builtin.icon)"
            />
            <img
              v-else-if="row.builtin"
              :src="iconUrl(row.builtin.icon)"
              alt=""
              class="size-6 object-contain"
              loading="lazy"
              decoding="async"
            />
            <CalendarDays v-else-if="row.kind === 'event'" class="size-4 text-text-muted" />
            <ListChecks v-else class="size-4 text-text-muted" />
          </span>
          <span
            v-if="row.tag"
            class="shrink-0 rounded px-1.5 py-px text-[0.6875rem] font-medium"
            :class="TAG_TONE[row.tag]"
            >{{ $t(`planner.tasks.tags.${row.tag}`) }}</span
          >
          <span class="truncate">{{ row.name }}</span>
          <span
            v-if="row.capture && (row.due ? !row.builtin?.capture : row.back !== null)"
            class="tabular shrink-0 font-mono text-xs text-text-muted"
            :title="captureTitle(row)"
            >{{ row.capture.text }}</span
          >
          <StickyNote
            v-if="row.note && row.kind !== 'event'"
            class="size-3.5 shrink-0 text-text-muted"
            aria-hidden="true"
          />
        </component>
        <span
          class="tabular inline-flex shrink-0 items-center gap-1 font-mono text-xs"
          :class="TONE[row.tone]"
          :title="timeTitle(row)"
        >
          <Moon v-if="row.snoozed" class="size-3.5" aria-hidden="true" />
          <Radar
            v-else-if="row.capture?.rules"
            class="size-3.5 text-text-muted"
            aria-hidden="true"
          />
          {{ when(row).text }}
          <span class="sr-only">: {{ timeTitle(row) }}</span>
        </span>
        <button
          type="button"
          class="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-overlay hover:text-text-primary disabled:invisible"
          :disabled="!canSnooze(row)"
          :aria-label="$t('planner.tasks.snoozeName', { name: row.name })"
          :title="$t('planner.tasks.snooze')"
          @click="openSnooze(row, $event)"
        >
          <AlarmClock class="size-4" aria-hidden="true" />
        </button>
      </li>
    </ul>

    <UiPopover
      :open="snoozeOpen"
      :anchor="snoozeAnchor"
      :label="$t('planner.tasks.snoozeName', { name: snoozeRow?.name ?? '' })"
      @close="snoozeOpen = false"
    >
      <ul class="flex flex-col p-1.5">
        <li v-for="c in snoozes" :key="c.days">
          <button
            type="button"
            class="flex min-h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm hover:bg-surface-overlay"
            @click="snooze(c.days)"
          >
            <span class="font-medium">{{ weekdayShort(weekdayOf(today + c.days)) }}</span>
            <span class="tabular font-mono text-text-secondary">{{ daysText(c.days) }}</span>
            <span v-if="c.last" class="ml-auto text-xs text-text-muted">{{
              $t('planner.tasks.lastDay')
            }}</span>
          </button>
        </li>
      </ul>
    </UiPopover>

    <UiPopover
      :open="listOpen"
      :anchor="listAnchor"
      :label="$t('planner.tasks.permanentTasks')"
      @close="listOpen = false"
    >
      <div class="flex flex-col px-4 py-2">
        <UiSwitch
          v-for="b in builtins"
          :key="b.id"
          :model-value="!hidden(b.id)"
          :label="b.name"
          @update:model-value="setShown(b.id, $event)"
        />
      </div>
    </UiPopover>

    <TaskEditor
      :open="editorOpen"
      :task="editing?.custom?.task ?? null"
      :due="editing?.custom?.due ?? null"
      :today="today"
      @close="editorOpen = false"
      @save="save"
      @remove="removeEditing"
    />
  </section>
</template>
