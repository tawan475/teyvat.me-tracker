<script setup lang="ts">
import {
  REMOVABLE_PARTS,
  REMOVE_PART_WORD,
  partNeighbours,
  type PartsResponse,
  type RemovablePart,
  type RemovePartResponse,
} from '@gdt/shared'
import { computed, ref, useId, watch } from 'vue'
import { CircleAlert, CircleCheck, EyeOff, TriangleAlert } from 'lucide-vue-next'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import { api } from '@/api'
import { ApiRequestError } from '@/api/error'
import { markPartRemoved } from '@/data/part-notes'
import { invalidateUsage } from '@/data/usage'
import { t } from '@/i18n'
import { formatBytes, formatMonthDay, formatNumber } from '@/lib/format'
import { partLabel } from './part-names'

/**
 * Remove a part from history (issue 12, item 3; the user's pick: A's
 * dialog, B's done state): one radio row per removable part with the
 * snapshots holding it and its size, those Capture leaves out first; one line
 * of what goes; no trash, so REMOVE is typed (English in every language).
 * Every way in opens it with nothing picked. All or nothing: a capture that
 * lands meanwhile makes the server refuse, and the counts are read again.
 * The guest's runs in the browser (local/server.ts), with no live sync.
 * The counts include snapshots in the trash that still hold the part (the
 * row says how many), so a part that survives only there can be removed.
 * The Teapot takes the realm currency of the Planner tasks with it, as
 * Capture's switch does: its row names it.
 */
const props = defineProps<{
  open: boolean
  accountId: number
  /** The parts Capture leaves out now: listed first, marked. */
  notShared: readonly RemovablePart[]
  guest?: boolean
}>()
const emit = defineEmits<{ close: [] }>()

type State = 'idle' | 'removing'
const picked = ref<RemovablePart | null>(null)
const typed = ref('')
const state = ref<State>('idle')
const counts = ref<PartsResponse | null>(null)
const countError = ref<unknown>(null)
const failure = ref<'changed' | 'other' | null>(null)
const done = ref<RemovePartResponse | null>(null)
const formId = useId()
let generation = 0

async function readCounts() {
  const mine = ++generation
  counts.value = null
  countError.value = null
  try {
    const value = await api.parts(props.accountId)
    if (mine === generation) counts.value = value
  } catch (error) {
    if (mine === generation) countError.value = error
  }
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    picked.value = null
    typed.value = ''
    state.value = 'idle'
    failure.value = null
    done.value = null
    void readCounts()
  },
  { immediate: true },
)

const rows = computed(() => {
  const off = new Set(props.notShared)
  return [...REMOVABLE_PARTS]
    .sort((a, b) => Number(off.has(b)) - Number(off.has(a)))
    .map((part) => ({
      part,
      off: off.has(part),
      count: counts.value?.parts.find((c) => c.part === part) ?? null,
    }))
})
const pickedCount = computed(() => counts.value?.parts.find((c) => c.part === picked.value) ?? null)
const busy = computed(() => state.value === 'removing')
const matches = computed(() => typed.value.trim() === REMOVE_PART_WORD)
const hasSomething = computed(
  () => !!pickedCount.value && pickedCount.value.snapshots + pickedCount.value.liveChanges > 0,
)
const canRemove = computed(() => !busy.value && hasSomething.value && matches.value)

/** A part's second line: what it holds (the Teapot's realm currency is stored with the tasks). */
function partSub(part: RemovablePart): string {
  const sub = t(`snapshots.parts.subs.${part}`)
  return part === 'teapot' ? `${sub}, ${t('planner.task.builtin.realm')}` : sub
}

/** Parts with hand marks of their own, which stay. */
const MARKED = new Set<RemovablePart>(['achievements', 'anecdotes', 'collections'])

const line = computed(() => {
  const count = pickedCount.value
  const part = picked.value
  if (!count || !part || !counts.value) return ''
  const name = partLabel(part)
  if (count.snapshots + count.liveChanges === 0)
    return t('snapshots.parts.dialog.nothing', { part: name })
  const values = {
    part: name,
    n: formatNumber(count.snapshots),
    total: formatNumber(counts.value.total),
    live: formatNumber(count.liveChanges),
    size: formatBytes(count.bytes),
  }
  const what = props.guest
    ? t('snapshots.parts.dialog.lineGuest', values)
    : count.liveChanges > 0
      ? t('snapshots.parts.dialog.lineLive', values)
      : t('snapshots.parts.dialog.line', values)
  const neighbours = partNeighbours(part).map(partLabel).join(', ')
  const marks = MARKED.has(part)
  const stay = neighbours
    ? t(marks ? 'snapshots.parts.dialog.stayMarksWith' : 'snapshots.parts.dialog.stayWith', {
        parts: neighbours,
      })
    : t(marks ? 'snapshots.parts.dialog.stayMarks' : 'snapshots.parts.dialog.stay')
  return `${what} ${stay}`
})

async function submit() {
  if (!canRemove.value || !picked.value || !counts.value) return
  state.value = 'removing'
  failure.value = null
  try {
    const result = await api.removePart(props.accountId, {
      part: picked.value,
      confirm: REMOVE_PART_WORD,
      guard: counts.value.guard,
    })
    markPartRemoved(props.accountId, result.part, result.removedAt)
    invalidateUsage()
    done.value = result
  } catch (error) {
    failure.value =
      error instanceof ApiRequestError && error.code === 'capture_changed' ? 'changed' : 'other'
    // All or nothing: nothing went. The counts as they are now.
    void readCounts()
  } finally {
    state.value = 'idle'
  }
}

function close() {
  if (!busy.value) emit('close')
}
</script>

<template>
  <UiModal
    :open="open"
    :title="$t('snapshots.parts.dialog.title')"
    :locked="busy"
    sheet
    @close="close"
  >
    <!-- Done: what went, and the reminder about Capture. -->
    <div
      v-if="done"
      class="flex flex-col items-center gap-2.5 px-2 pt-4 pb-2 text-center"
      role="status"
    >
      <CircleCheck class="size-8 text-success-text" aria-hidden="true" />
      <span class="text-base font-semibold">{{
        $t('snapshots.parts.dialog.doneTitle', { part: partLabel(done.part) })
      }}</span>
      <div class="grid w-full grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-2">
        <div class="fig">
          <span class="fig__label">{{ $t('snapshots.parts.dialog.snapshots') }}</span>
          <span class="fig__value">{{ formatNumber(done.snapshots) }}</span>
        </div>
        <div class="fig">
          <span class="fig__label">{{ $t('snapshots.parts.dialog.freed') }}</span>
          <span class="fig__value">{{ formatBytes(Math.max(0, done.freed)) }}</span>
        </div>
        <div v-if="!guest" class="fig">
          <span class="fig__label">{{ $t('snapshots.parts.dialog.liveRows') }}</span>
          <span class="fig__value">{{ formatNumber(done.liveChanges) }}</span>
        </div>
      </div>
      <p class="mt-1 text-sm text-text-secondary">
        {{
          $t(guest ? 'snapshots.parts.dialog.doneNoteGuest' : 'snapshots.parts.dialog.doneNote', {
            part: partLabel(done.part),
          })
        }}
      </p>
    </div>

    <form v-else :id="formId" class="flex flex-col gap-4" @submit.prevent="submit">
      <fieldset class="flex min-w-0 flex-col gap-1.5" :disabled="busy">
        <legend class="mb-1.5 flex w-full items-baseline justify-between gap-3">
          <span class="text-sm font-medium text-text-secondary">{{
            $t('snapshots.parts.dialog.part')
          }}</span>
          <span v-if="notShared.length" class="text-xs text-text-muted">{{
            $t('snapshots.parts.dialog.notSharedFirst')
          }}</span>
        </legend>
        <label
          v-for="row in rows"
          :key="row.part"
          class="part-row"
          :class="picked === row.part ? 'part-row--on' : ''"
        >
          <input
            v-model="picked"
            class="sr-only"
            type="radio"
            name="part"
            :value="row.part"
            :disabled="busy"
          />
          <span class="part-row__dot" aria-hidden="true" />
          <span class="flex min-w-0 flex-col">
            <span class="font-medium break-words">{{ partLabel(row.part) }}</span>
            <span class="text-xs break-words text-text-muted">
              <template v-if="row.off">
                <span class="inline-flex items-center gap-1 font-semibold text-text-primary">
                  <EyeOff class="size-3.5 shrink-0" aria-hidden="true" />
                  {{ $t('snapshots.parts.dialog.notSharedMark') }}
                </span>
                ·
                {{
                  row.count?.lastAt
                    ? $t('snapshots.parts.dialog.last', { date: formatMonthDay(row.count.lastAt) })
                    : partSub(row.part)
                }}
              </template>
              <template v-else>{{ partSub(row.part) }}</template>
              <template v-if="row.count?.trashed">
                ·
                {{ $t('snapshots.parts.dialog.inTrash', { n: formatNumber(row.count.trashed) }) }}
              </template>
            </span>
          </span>
          <span class="tabular text-right whitespace-nowrap text-text-secondary">
            <template v-if="row.count">
              {{ formatNumber(row.count.snapshots) }} · {{ formatBytes(row.count.bytes) }}
            </template>
            <UiSkeleton v-else-if="!countError" class="inline-block h-3 w-20 align-middle" />
          </span>
        </label>
      </fieldset>

      <div
        v-if="failure"
        class="flex flex-col gap-1 rounded-lg border border-danger-border bg-danger-surface px-3 py-2.5 text-sm"
        role="alert"
      >
        <span class="flex items-center gap-1.5 font-medium text-danger-text">
          <CircleAlert class="size-4 shrink-0" aria-hidden="true" />
          {{ $t('snapshots.parts.dialog.failed') }}
        </span>
        <span class="text-text-secondary">{{
          failure === 'changed'
            ? $t('snapshots.parts.dialog.changed')
            : $t('snapshots.parts.dialog.error')
        }}</span>
      </div>

      <p v-if="countError" class="text-sm text-danger-text" role="alert">
        {{ $t('snapshots.parts.dialog.loadFailed') }}
      </p>
      <p v-else-if="!picked" class="text-sm text-text-muted">
        {{ $t('snapshots.parts.dialog.pick') }}
      </p>
      <p v-else-if="!counts" class="flex items-center gap-2.5 text-sm" aria-live="polite">
        <UiSkeleton class="inline-block h-3.5 w-7/12" />
        <span class="text-text-muted">{{ $t('snapshots.parts.dialog.counting') }}</span>
      </p>
      <p v-else class="tabular text-sm" aria-live="polite">{{ line }}</p>

      <p class="flex items-start gap-2 text-sm text-danger-text">
        <TriangleAlert class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>{{
          $t(guest ? 'snapshots.parts.dialog.warningGuest' : 'snapshots.parts.dialog.warning')
        }}</span>
      </p>
      <label class="flex flex-col gap-1.5">
        <span class="text-sm font-medium text-text-secondary">{{
          $t('snapshots.parts.dialog.type', { word: REMOVE_PART_WORD })
        }}</span>
        <UiInput
          v-model="typed"
          :placeholder="REMOVE_PART_WORD"
          autocomplete="off"
          spellcheck="false"
          :disabled="busy"
        />
      </label>
    </form>

    <template #footer>
      <UiButton v-if="done" variant="primary" @click="emit('close')">
        {{ $t('snapshots.parts.dialog.close') }}
      </UiButton>
      <template v-else>
        <UiButton :disabled="busy" @click="close">{{
          $t('snapshots.parts.dialog.cancel')
        }}</UiButton>
        <UiButton
          variant="danger"
          type="submit"
          :form="formId"
          :disabled="!canRemove"
          :loading="busy"
        >
          {{ busy ? $t('snapshots.parts.dialog.removing') : $t('snapshots.parts.dialog.confirm') }}
        </UiButton>
      </template>
    </template>
  </UiModal>
</template>

<style scoped>
.part-row {
  display: grid;
  grid-template-columns: 1.375rem minmax(0, 1fr) minmax(0, max-content);
  align-items: center;
  gap: 0.75rem;
  min-height: 3.09rem;
  padding: 0.375rem 0.625rem;
  border: 1px solid var(--color-border-default);
  border-radius: 0.5625rem;
  font-size: 0.875rem;
  cursor: pointer;
}
.part-row:focus-within {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}
.part-row--on {
  border-color: var(--color-accent-text);
  box-shadow: 0 0 0 1px var(--color-accent-text);
  background: var(--color-surface-overlay);
}
.part-row__dot {
  width: 1.125rem;
  height: 1.125rem;
  border-radius: 9999px;
  border: 2px solid var(--color-border-strong);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.part-row--on .part-row__dot {
  border-color: var(--color-accent-text);
}
.part-row--on .part-row__dot::after {
  content: '';
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 9999px;
  background: var(--color-accent-text);
}
fieldset:disabled .part-row {
  cursor: not-allowed;
  opacity: 0.6;
}
.fig {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  min-width: 0;
  padding: 0.625rem 0.8125rem;
  border: 1px solid var(--color-border-default);
  border-radius: 0.84rem;
  background: var(--color-surface-raised);
  text-align: left;
}
.fig__label {
  overflow: hidden;
  font-size: 0.8125rem;
  color: var(--color-text-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fig__value {
  font-size: 1.125rem;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
</style>
