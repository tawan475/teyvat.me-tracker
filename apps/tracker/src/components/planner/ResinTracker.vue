<script setup lang="ts">
import { pushOnHere } from '@/lib/push-flag'
import type { ManualResin } from '@gdt/shared'
import { computed, ref, shallowRef, watch } from 'vue'
import { Bell, BellOff, BellRing, ChevronRight, Pencil } from 'lucide-vue-next'
import MaterialIcon from '@/components/materials-page/MaterialIcon.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import GuestLock from '@/components/guest/GuestLock.vue'
import UiPopover from '@/components/ui/UiPopover.vue'
import { useGuest } from '@/views/account/context'
import { t } from '@/i18n'
import { materialIcon } from '@/lib/assets'
import { formatDateTime, formatNumber, formatTime } from '@/lib/format'
import {
  RESIN_LIMIT,
  RESIN_MAX,
  alertAt,
  formatStep,
  fullAt,
  resinAt,
  resinMarks,
  setResin,
  stepResin,
  type ResinReading,
} from './resin'
import { readStorage, writeStorage } from '@/lib/storage'
import { materialName } from '@/utils/materials'
import {
  ALERT_AMOUNTS,
  alertSupport,
  askAlertPermission,
  scheduleResinAlert,
  type AlertSupport,
} from './resin-alerts'
import { formatSpan } from './tasks'

/**
 * Original Resin now: the newest reading (a capture's, or one set here)
 * plus regeneration (the next-40 countdown that stood here read as noise:
 * the user, 2026-11-05; the marks table has every mark, labelled). The
 * number sets it by hand, the quick buttons add or
 * spend (the regeneration clock keeps running), the bell notifies this
 * device at a chosen amount while the site is open. A hand-set value stays
 * until a capture reads resin after it. Under it, the marks table (Discord
 * users' asks, 2026-11-05): when resin reaches each amount the account
 * chose in Planner settings (`planner.resinMarks`, default 40 and 200), with
 * the time left and the clock time, a bell on each row setting the alert to
 * it. Folded by default (the user, 2026-11-07), open state kept per device
 * (`planner:resin-marks-open`); its columns pack to the left.
 */
const props = defineProps<{
  reading: ResinReading | null
  /** Condensed Resin held, and the most one can hold (0: unknown). */
  condensed: number
  condensedMax: number
  steps: readonly number[]
  /** The "when resin reaches" amounts (account setting). */
  marks: readonly number[]
  /** Original Resin spent today, per the capture, and when it said so (null: not known). */
  spent: { value: number; at: number } | null
  now: number
  accountId: number
  accountName: string
  /** The page a notification opens. */
  url: string
}>()
const emit = defineEmits<{ set: [value: ManualResin | null]; settings: [] }>()

const current = computed(() => (props.reading ? resinAt(props.reading, props.now) : null))
const marks = computed(() =>
  props.reading ? resinMarks(props.reading, props.now, props.marks) : [],
)
const full = computed(() => (props.reading ? fullAt(props.reading, props.now) : null))

const MARKS_OPEN_KEY = 'planner:resin-marks-open'
const marksOpen = ref(readStorage(MARKS_OPEN_KEY) === '1')
function toggleMarks() {
  marksOpen.value = !marksOpen.value
  writeStorage(MARKS_OPEN_KEY, marksOpen.value ? '1' : null)
}
const readingTitle = computed(() => {
  const r = props.reading
  if (!r) return t('planner.resin.unknown')
  return t('planner.resin.readingTitle', {
    now: formatNumber(current.value ?? 0),
    max: RESIN_MAX,
    value: formatNumber(r.value),
    source: t(`planner.resin.source.${r.source}`),
    at: formatDateTime(r.at),
  })
})

function canStep(step: number) {
  return (current.value ?? 0) + step >= 0 && (current.value ?? 0) + step <= RESIN_LIMIT
}
function applyStep(step: number) {
  const next = stepResin(props.reading, step, Date.now())
  if (next) emit('set', next)
}

// ------------------------------------------------------------ set by hand

const editAnchor = ref<HTMLElement | null>(null)
const editing = ref(false)
const typed = ref('')
const invalid = ref(false)

function openEdit(event: Event) {
  editAnchor.value = event.currentTarget as HTMLElement
  typed.value = current.value === null ? '' : String(current.value)
  invalid.value = false
  editing.value = true
}

function commitEdit() {
  const text = String(typed.value ?? '').trim()
  const value = Number(text)
  if (text === '' || !Number.isInteger(value) || value < 0 || value > RESIN_LIMIT) {
    invalid.value = true
    return
  }
  emit('set', setResin(props.reading, value, Date.now()))
  editing.value = false
}

function useCapture() {
  emit('set', null)
  editing.value = false
}

// ------------------------------------------------------------ alert

/** The amount this device alerts at for an account (null: off). */
function alertAmount(accountId: number): number | null {
  const raw = Number(readStorage(`planner:resin-alert:${accountId}`))
  return Number.isInteger(raw) && raw > 0 && raw <= RESIN_LIMIT ? raw : null
}
function setAlertAmount(accountId: number, value: number | null) {
  writeStorage(`planner:resin-alert:${accountId}`, value === null ? null : String(value))
}

/** Guest mode: alerts with the site closed (Web Push) are an account's. */
const guest = useGuest()
const support = shallowRef<AlertSupport>(alertSupport())
const amount = ref<number | null>(alertAmount(props.accountId))
watch(
  () => props.accountId,
  (id) => (amount.value = alertAmount(id)),
)
const alertAnchor = ref<HTMLElement | null>(null)
const alertOpen = ref(false)

function openAlert(event: Event) {
  alertAnchor.value = event.currentTarget as HTMLElement
  support.value = alertSupport()
  alertOpen.value = true
}

async function chooseAlert(value: number | null) {
  if (value !== null && support.value !== 'granted') {
    support.value = await askAlertPermission()
    if (support.value !== 'granted') return
  }
  amount.value = value
  setAlertAmount(props.accountId, value)
  alertOpen.value = false
}

const alertOn = computed(() => amount.value !== null && support.value === 'granted')
const alertWhen = computed(() =>
  alertOn.value ? alertAt(props.reading, amount.value!, props.now) : null,
)
const alertTitle = computed(() => {
  // This browser gets alerts from the server (Settings → Devices): the timer here stands down.
  if (pushOnHere()) return t('planner.resin.alertPush')
  if (support.value === 'unsupported') return t('planner.resin.alertUnsupported')
  if (!alertOn.value) return t('planner.resin.alertOff')
  const when = alertWhen.value
  return when
    ? t('planner.resin.alertOnAt', { amount: amount.value, time: formatTime(when) })
    : t('planner.resin.alertOn', { amount: amount.value })
})

// Rescheduled when the reading or the amount changes (not every clock tick).
watch(
  () =>
    [
      props.accountId,
      props.reading?.value,
      props.reading?.at,
      amount.value,
      support.value,
    ] as const,
  () => {
    const at = alertOn.value ? alertAt(props.reading, amount.value!, Date.now()) : null
    scheduleResinAlert(props.accountId, at, amount.value ?? 0, {
      name: props.accountName,
      url: props.url,
    })
  },
  { immediate: true },
)
</script>

<template>
  <section
    class="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-border-default bg-surface-raised px-3 py-2 shadow-sm"
    :aria-label="materialName('OriginalResin')"
  >
    <div class="flex w-full flex-wrap items-center gap-2 sm:w-auto">
      <span class="size-8 shrink-0">
        <MaterialIcon :src="materialIcon('OriginalResin')" :name="materialName('OriginalResin')" />
      </span>
      <button
        type="button"
        class="group tabular inline-flex items-baseline gap-1 rounded-md px-1 font-mono transition-colors hover:bg-surface-overlay"
        :title="readingTitle"
        :aria-label="$t('planner.resin.setLabel', { title: readingTitle })"
        @click="openEdit"
      >
        <span
          class="text-2xl leading-8 font-semibold"
          :class="(current ?? 0) >= RESIN_MAX ? 'text-warning-text' : ''"
          >{{ current === null ? '–' : formatNumber(current) }}</span
        >
        <span class="text-sm text-text-muted">/{{ RESIN_MAX }}</span>
        <Pencil
          class="size-3.5 self-center text-text-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          aria-hidden="true"
        />
      </button>
      <!-- Up to four buttons: on a narrow row they wrap under the count, never past the card. -->
      <span class="ml-auto flex min-w-0 flex-wrap justify-end gap-1 sm:ml-2">
        <UiButton
          v-for="step in steps"
          :key="step"
          size="sm"
          class="tabular min-w-12 font-mono"
          :disabled="!canStep(step)"
          :title="
            step < 0
              ? $t('planner.resin.spend', { n: Math.abs(step) })
              : $t('planner.resin.add', { n: Math.abs(step) })
          "
          @click="applyStep(step)"
          >{{ formatStep(step) }}</UiButton
        >
      </span>
    </div>
    <p
      class="tabular flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-secondary"
    >
      <span
        v-if="full"
        class="inline-flex gap-1.5"
        :title="$t('planner.resin.fullAt', { time: formatDateTime(full) })"
      >
        <span class="text-text-muted">{{ $t('planner.resin.fullLabel') }}</span>
        <time class="font-mono text-text-primary" :datetime="new Date(full).toISOString()">{{
          formatTime(full)
        }}</time>
        <span class="font-mono text-text-muted">· {{ formatSpan(full - now) }}</span>
      </span>
      <span v-else-if="current !== null" class="font-medium text-warning-text">{{
        $t('planner.resin.full')
      }}</span>
      <span
        v-if="spent !== null"
        class="inline-flex gap-1.5"
        :title="
          $t('planner.resin.spentTodayTitle', {
            n: formatNumber(spent.value),
            at: formatDateTime(spent.at),
          })
        "
      >
        <span class="text-text-muted">{{ $t('planner.resin.spentToday') }}</span>
        <span class="font-mono text-text-primary">{{ formatNumber(spent.value) }}</span>
      </span>
      <span
        class="inline-flex items-center gap-1 font-mono"
        :title="materialName('CondensedResin')"
      >
        <span class="size-5 shrink-0">
          <MaterialIcon
            :src="materialIcon('CondensedResin')"
            :name="materialName('CondensedResin')"
          />
        </span>
        <span
          >{{ formatNumber(condensed)
          }}<span v-if="condensedMax" class="text-text-muted">/{{ condensedMax }}</span></span
        >
        <span class="sr-only">{{ materialName('CondensedResin') }}</span>
      </span>
    </p>
    <button
      type="button"
      class="-my-1 ml-auto inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-sm transition-colors hover:bg-surface-overlay hover:text-text-primary"
      :class="alertOn ? 'text-accent-text' : 'text-text-muted'"
      :title="alertTitle"
      :aria-label="alertTitle"
      :aria-pressed="alertOn"
      @click="openAlert"
    >
      <BellRing v-if="alertOn" class="size-4" aria-hidden="true" />
      <BellOff
        v-else-if="support === 'denied' || support === 'unsupported'"
        class="size-4"
        aria-hidden="true"
      />
      <Bell v-else class="size-4" aria-hidden="true" />
      <span v-if="alertOn" class="tabular font-mono text-xs">{{ amount }}</span>
    </button>

    <!-- The marks table: amount, time left, clock time, the alert bell. Reached
         rows are muted with a tick (not colour alone). -->
    <div
      v-if="marks.length"
      class="mt-1 flex w-full items-center gap-2 border-t border-border-subtle pt-1.5"
    >
      <button
        type="button"
        class="-ml-1.5 inline-flex min-h-8 items-center gap-1 rounded-md px-1.5 text-xs text-text-muted transition-colors hover:bg-surface-overlay hover:text-text-primary"
        :aria-expanded="marksOpen"
        aria-controls="resin-marks"
        @click="toggleMarks"
      >
        <ChevronRight
          class="size-3.5 transition-transform"
          :class="marksOpen && 'rotate-90'"
          aria-hidden="true"
        />{{ $t('planner.resin.marks') }}
      </button>
      <button
        type="button"
        class="ml-auto inline-flex min-h-8 items-center gap-1 rounded-md px-1.5 text-xs text-text-muted transition-colors hover:bg-surface-overlay hover:text-text-primary"
        @click="emit('settings')"
      >
        <Pencil class="size-3" aria-hidden="true" />{{ $t('planner.resin.editMarks') }}
      </button>
    </div>
    <ul
      v-if="marks.length && marksOpen"
      id="resin-marks"
      class="grid w-full grid-cols-[repeat(4,auto)] items-center justify-start gap-x-4 pb-1 text-sm"
      :aria-label="$t('planner.resin.marks')"
    >
      <li v-for="m in marks" :key="m.amount" class="contents">
        <span
          class="tabular font-mono font-semibold"
          :class="m.reached ? 'text-text-muted' : 'text-text-primary'"
          >{{ m.amount }}</span
        >
        <span
          class="tabular font-mono"
          :class="m.reached ? 'text-text-muted' : 'text-text-secondary'"
        >
          <template v-if="m.reached">✓ {{ $t('planner.resin.reached') }}</template>
          <template v-else
            ><span class="font-sans text-text-muted">{{ $t('planner.resin.in') }}</span>
            {{ formatSpan(m.at - now) }}</template
          >
        </span>
        <time
          class="tabular font-mono"
          :class="m.reached ? 'text-text-muted' : 'text-text-secondary'"
          :datetime="new Date(m.at).toISOString()"
          :title="formatDateTime(m.at)"
          >{{ m.reached ? '' : formatTime(m.at) }}</time
        >
        <button
          type="button"
          class="inline-flex min-h-8 items-center rounded-md px-1.5 transition-colors hover:bg-surface-overlay hover:text-text-primary disabled:opacity-40 disabled:hover:bg-transparent"
          :class="alertOn && amount === m.amount ? 'text-accent-text' : 'text-text-muted'"
          :title="$t('planner.resin.notifyAtAmount', { n: m.amount })"
          :aria-label="$t('planner.resin.notifyAtAmount', { n: m.amount })"
          :aria-pressed="alertOn && amount === m.amount"
          :disabled="m.reached || support === 'unsupported'"
          @click="chooseAlert(alertOn && amount === m.amount ? null : m.amount)"
        >
          <BellRing v-if="alertOn && amount === m.amount" class="size-4" aria-hidden="true" />
          <Bell v-else class="size-4" aria-hidden="true" />
        </button>
      </li>
    </ul>

    <UiPopover
      :open="editing"
      :anchor="editAnchor"
      :label="materialName('OriginalResin')"
      @close="editing = false"
    >
      <form class="flex flex-col gap-3 p-4" @submit.prevent="commitEdit">
        <div class="flex items-center gap-2">
          <UiInput
            v-model="typed"
            type="number"
            inputmode="numeric"
            min="0"
            :max="RESIN_LIMIT"
            mono
            autofocus
            class="w-28"
            :aria-label="$t('planner.resin.now')"
            :invalid="invalid"
          />
          <span class="text-sm text-text-muted">/{{ RESIN_MAX }}</span>
          <UiButton type="submit" variant="primary" size="sm" class="ml-auto">{{
            $t('farm.panel.set')
          }}</UiButton>
        </div>
        <UiButton v-if="reading?.source === 'manual'" size="sm" variant="ghost" @click="useCapture">
          {{ $t('planner.editor.resetTitle') }}
        </UiButton>
      </form>
    </UiPopover>

    <UiPopover
      :open="alertOpen"
      :anchor="alertAnchor"
      :label="$t('planner.resin.alert')"
      @close="alertOpen = false"
    >
      <div class="flex flex-col gap-3 p-4 text-sm">
        <p v-if="support === 'unsupported'" class="text-text-secondary">
          {{ $t('planner.resin.unsupported') }}
        </p>
        <template v-else>
          <p v-if="support === 'denied'" class="text-danger-text" role="alert">
            {{ $t('planner.resin.blocked') }}
          </p>
          <div
            class="flex flex-wrap gap-1.5"
            role="group"
            :aria-label="$t('planner.resin.notifyAt')"
          >
            <UiButton
              v-for="a in ALERT_AMOUNTS"
              :key="a"
              size="sm"
              class="tabular min-w-12 font-mono"
              :variant="alertOn && amount === a ? 'primary' : 'secondary'"
              :aria-pressed="alertOn && amount === a"
              :disabled="support === 'denied'"
              @click="chooseAlert(a)"
              >{{ a }}</UiButton
            >
            <UiButton
              size="sm"
              variant="ghost"
              :aria-pressed="!alertOn"
              @click="chooseAlert(null)"
              >{{ $t('planner.resin.off') }}</UiButton
            >
          </div>
          <p class="text-xs text-text-muted">{{ $t('planner.resin.whileOpen') }}</p>
        </template>
        <GuestLock v-if="guest" kind="alerts" compact />
      </div>
    </UiPopover>
  </section>
</template>
