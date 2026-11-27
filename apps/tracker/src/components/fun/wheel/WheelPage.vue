<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  ArrowDownAZ,
  Check,
  ChevronDown,
  ChevronUp,
  FilePlus2,
  FolderOpen,
  Maximize,
  Minimize,
  Save,
  Share2,
  Shuffle,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-vue-next'
import UiButton from '@/components/ui/UiButton.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiPopover from '@/components/ui/UiPopover.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiSwitch from '@/components/ui/UiSwitch.vue'
import {
  decodeShare,
  encodeShare,
  indexAt,
  labelAngle,
  landing,
  parseEntries,
  shuffled,
  wheelGradient,
  withoutEntry,
} from '@/data/wheel'
import { t } from '@/i18n'
import { formatNumber } from '@/lib/format'
import { readJson, writeJson } from '@/lib/storage'
import { useAccount } from '@/views/account/context'
import { reducedMotion } from '../randomizer/motion'

/**
 * The wheel (docs/plans/fun.md; the user's pick: design A's look, with what
 * people know from name-wheel sites): a wheel that spins on a click (or
 * Ctrl + Enter) beside a text box, one entry per line. The winner shows in a
 * dialog with Remove; results are kept in a second tab; the list can be
 * shuffled, sorted, saved by name, opened again and shared as a link. The
 * options (spin time, remove the winner, dialog, sound, confetti, hide the
 * entries while spinning) sit in one folded row. All of it lives on this
 * device.
 */
const account = useAccount()
const storageKey = computed(() => `fun:wheel:${account.value.id}`)

const SECONDS = [3, 5, 10] as const
interface Options {
  seconds: (typeof SECONDS)[number]
  remove: boolean
  dialog: boolean
  sound: boolean
  confetti: boolean
  hide: boolean
}
interface Saved {
  text: string
  results: string[]
  options: Options
  optionsOpen: boolean
  /** Lists saved by name, newest first. */
  lists: { name: string; text: string }[]
  /** The saved list being edited; null for one never saved. */
  name: string | null
}
const DEFAULT_OPTIONS: Options = {
  seconds: 5,
  remove: false,
  dialog: true,
  sound: true,
  confetti: true,
  hide: false,
}
const MAX_RESULTS = 200
const MAX_LISTS = 30

function load(): Saved {
  const saved = readJson<Partial<Saved>>(storageKey.value, {})
  const options = { ...DEFAULT_OPTIONS, ...saved.options }
  return {
    text: typeof saved.text === 'string' ? saved.text : t('fun.wheel.sample'),
    results: Array.isArray(saved.results) ? saved.results.filter((r) => typeof r === 'string') : [],
    options: { ...options, seconds: SECONDS.includes(options.seconds) ? options.seconds : 5 },
    optionsOpen: saved.optionsOpen === true,
    lists: Array.isArray(saved.lists)
      ? saved.lists.filter((l) => l && typeof l.name === 'string' && typeof l.text === 'string')
      : [],
    name: typeof saved.name === 'string' ? saved.name : null,
  }
}
const winner = ref<string | null>(null)
const state = reactive<Saved>(load())
watch(state, (value) => writeJson(storageKey.value, value), { deep: true })

// A shared link opens its list (the link is then cleaned, so a reload keeps edits).
function openShared() {
  const shared = decodeShare(location.hash)
  if (!shared?.length) return
  state.text = shared.join(String.fromCharCode(10))
  state.results = []
  state.name = null
  winner.value = null
  history.replaceState(history.state, '', location.pathname + location.search)
}

openShared()

const entries = computed(() => parseEntries(state.text))
const tab = ref<'entries' | 'results'>('entries')
const tabs = computed(() => [
  { value: 'entries' as const, label: t('fun.wheel.entries'), count: entries.value.length },
  { value: 'results' as const, label: t('fun.wheel.results'), count: state.results.length },
])
const secondOptions = SECONDS.map((value) => ({ value, label: `${value} s` }))

// ------------------------------------------------------------ the wheel's face

const TONES = [
  'var(--color-surface-overlay)',
  'var(--color-surface-raised)',
  'var(--color-surface-base)',
]
const face = computed(() =>
  wheelGradient(entries.value.length, TONES, 'var(--color-border-strong)'),
)
/** Past this many the slices are too thin to read. */
const MAX_LABELS = 80
const labels = computed(() => {
  const n = entries.value.length
  if (n > MAX_LABELS) return []
  return entries.value.map((text, i) => ({ text, angle: labelAngle(i, n) }))
})
const labelSize = computed(() => {
  const n = entries.value.length
  return n <= 12 ? '0.875rem' : n <= 24 ? '0.75rem' : n <= 40 ? '0.625rem' : '0.5rem'
})

// ------------------------------------------------------------ the spin

const rotation = ref(0)
const spinning = ref(false)
const dialog = ref(false)
let frame = 0

let audio: AudioContext | null = null
function beep(frequency: number, ms: number, volume = 0.05, delay = 0) {
  if (!state.options.sound) return
  try {
    audio ??= new AudioContext()
    const at = audio.currentTime + delay
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.type = 'triangle'
    osc.frequency.value = frequency
    gain.gain.setValueAtTime(volume, at)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + ms / 1000)
    osc.connect(gain).connect(audio.destination)
    osc.start(at)
    osc.stop(at + ms / 1000)
  } catch {
    // No audio on this device: the wheel still spins.
  }
}

interface Piece {
  id: number
  left: string
  delay: string
  tone: string
  turn: string
}
const pieces = ref<Piece[]>([])
const CONFETTI = ['var(--color-accent)', 'var(--paimon, #f59e0b)', 'var(--color-text-primary)']
let confettiTimer = 0
function celebrate() {
  if (!state.options.confetti || reducedMotion()) return
  pieces.value = Array.from({ length: 36 }, (_, id) => ({
    id,
    left: `${Math.random() * 100}%`,
    delay: `${Math.random() * 0.25}s`,
    tone: CONFETTI[id % CONFETTI.length]!,
    turn: `${Math.round(Math.random() * 720 - 360)}deg`,
  }))
  window.clearTimeout(confettiTimer)
  confettiTimer = window.setTimeout(() => (pieces.value = []), 1900)
}

function finish(index: number, list: readonly string[]) {
  spinning.value = false
  rotation.value %= 360
  const won = list[index]
  if (won === undefined) return
  winner.value = won
  state.results = [...state.results, won].slice(-MAX_RESULTS)
  beep(660, 120, 0.06)
  beep(880, 220, 0.06, 0.12)
  celebrate()
  if (state.options.remove) state.text = withoutEntry(state.text, won)
  else if (state.options.dialog) dialog.value = true
}

function spin() {
  const list = entries.value
  if (spinning.value || !list.length) return
  dialog.value = false
  const n = list.length
  const index = Math.floor(Math.random() * n)
  const from = rotation.value
  const seconds = state.options.seconds
  const to = landing(from, index, n, Math.round(seconds * 1.5) + 2, 0.15 + Math.random() * 0.7)
  if (reducedMotion() || n === 1) {
    rotation.value = to
    return finish(index, list)
  }
  spinning.value = true
  winner.value = null
  const start = performance.now()
  let last = indexAt(from, n)
  const step = (now: number) => {
    const p = Math.min(1, (now - start) / (seconds * 1000))
    rotation.value = from + (to - from) * (1 - (1 - p) ** 4)
    const under = indexAt(rotation.value, n)
    if (under !== last) {
      last = under
      beep(1200, 18, 0.03)
    }
    if (p < 1) frame = requestAnimationFrame(step)
    else finish(index, list)
  }
  frame = requestAnimationFrame(step)
}

function removeWinner() {
  if (winner.value !== null) state.text = withoutEntry(state.text, winner.value)
  dialog.value = false
}
const winnerListed = computed(() => winner.value !== null && entries.value.includes(winner.value))

function onKey(event: KeyboardEvent) {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    spin()
  }
}
onMounted(() => {
  window.addEventListener('keydown', onKey)
  window.addEventListener('hashchange', openShared)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('hashchange', openShared)
  cancelAnimationFrame(frame)
  window.clearTimeout(confettiTimer)
  window.clearTimeout(copiedTimer)
  document.removeEventListener('fullscreenchange', onFull)
  void audio?.close()
})

// ------------------------------------------------------------ the list

function shuffleEntries() {
  state.text = shuffled(entries.value).join('\n')
}
function sortEntries() {
  state.text = [...entries.value].sort((a, b) => a.localeCompare(b)).join('\n')
}
function sortResults() {
  state.results = [...state.results].sort((a, b) => a.localeCompare(b))
}

const openAnchor = ref<HTMLElement | null>(null)
const openShown = ref(false)
const saveAnchor = ref<HTMLElement | null>(null)
const saveShown = ref(false)
const saveName = ref('')

function newList() {
  state.text = ''
  state.results = []
  state.name = null
  winner.value = null
}
function openList(list: { name: string; text: string }) {
  state.text = list.text
  state.results = []
  state.name = list.name
  winner.value = null
  openShown.value = false
}
function deleteList(name: string) {
  state.lists = state.lists.filter((l) => l.name !== name)
  if (state.name === name) state.name = null
}
function startSave() {
  saveName.value = state.name ?? ''
  saveShown.value = true
}
function saveList() {
  const name = saveName.value.trim().slice(0, 40)
  if (!name) return
  state.lists = [{ name, text: state.text }, ...state.lists.filter((l) => l.name !== name)].slice(
    0,
    MAX_LISTS,
  )
  state.name = name
  saveShown.value = false
}

const copied = ref(false)
let copiedTimer = 0
async function share() {
  const url = `${location.origin}${location.pathname}#w=${encodeShare(entries.value)}`
  try {
    await navigator.clipboard.writeText(url)
    copied.value = true
    window.clearTimeout(copiedTimer)
    copiedTimer = window.setTimeout(() => (copied.value = false), 2000)
  } catch {
    // No clipboard: the link is put in the address bar to copy by hand.
    location.hash = `w=${encodeShare(entries.value)}`
  }
}

const stage = ref<HTMLElement | null>(null)
const full = ref(false)
function onFull() {
  full.value = document.fullscreenElement === stage.value
}
document.addEventListener('fullscreenchange', onFull)
function toggleFull() {
  if (document.fullscreenElement) void document.exitFullscreen()
  else void stage.value?.requestFullscreen?.()
}
</script>

<template>
  <div class="flex min-w-0 flex-col gap-4">
    <div class="flex min-w-0 flex-wrap items-center gap-2">
      <span class="min-w-0 flex-1 truncate text-sm text-text-secondary">{{
        state.name ?? $t('fun.wheel.unsaved')
      }}</span>
      <UiButton variant="ghost" @click="newList">
        <FilePlus2 class="size-4" aria-hidden="true" />{{ $t('fun.wheel.new') }}
      </UiButton>
      <span ref="openAnchor" class="inline-flex">
        <UiButton variant="ghost" :disabled="!state.lists.length" @click="openShown = !openShown">
          <FolderOpen class="size-4" aria-hidden="true" />{{ $t('fun.wheel.open') }}
        </UiButton>
      </span>
      <span ref="saveAnchor" class="inline-flex">
        <UiButton variant="ghost" :disabled="!entries.length" @click="startSave">
          <Save class="size-4" aria-hidden="true" />{{ $t('fun.wheel.save') }}
        </UiButton>
      </span>
      <UiButton :disabled="!entries.length" @click="share">
        <component :is="copied ? Check : Share2" class="size-4" aria-hidden="true" />
        {{ copied ? $t('fun.wheel.copied') : $t('fun.wheel.share') }}
      </UiButton>
    </div>

    <UiPopover
      :open="openShown"
      :anchor="openAnchor"
      :label="$t('fun.wheel.open')"
      @close="openShown = false"
    >
      <ul class="flex max-h-80 w-64 max-w-full flex-col overflow-y-auto p-1">
        <li v-for="list in state.lists" :key="list.name" class="flex min-w-0 items-center">
          <button
            type="button"
            class="min-h-10 min-w-0 flex-1 truncate rounded-md px-3 text-left text-sm font-medium hover:bg-surface-overlay"
            @click="openList(list)"
          >
            {{ list.name }}
          </button>
          <UiIconButton
            :label="$t('fun.wheel.deleteList', { name: list.name })"
            @click="deleteList(list.name)"
          >
            <Trash2 class="size-4" aria-hidden="true" />
          </UiIconButton>
        </li>
      </ul>
    </UiPopover>
    <UiPopover
      :open="saveShown"
      :anchor="saveAnchor"
      :label="$t('fun.wheel.save')"
      @close="saveShown = false"
    >
      <form class="flex w-64 max-w-full flex-col gap-2 p-3" @submit.prevent="saveList">
        <label class="text-sm font-medium" for="wheel-save-name">{{
          $t('fun.wheel.listName')
        }}</label>
        <input
          id="wheel-save-name"
          v-model="saveName"
          autofocus
          maxlength="40"
          class="min-h-10 rounded-md border border-border-strong bg-surface-raised px-3 text-sm"
        />
        <UiButton variant="primary" type="submit" :disabled="!saveName.trim()">
          {{ $t('fun.wheel.save') }}
        </UiButton>
      </form>
    </UiPopover>

    <div class="flex min-w-0 flex-wrap items-start gap-5">
      <!-- The wheel -->
      <div
        ref="stage"
        class="relative flex min-w-0 flex-[1_1_22rem] flex-col items-center gap-3"
        :class="full ? 'justify-center bg-surface-base p-8' : ''"
      >
        <div
          class="relative aspect-square max-w-full"
          :class="full ? 'w-[min(78vh,90vw)]' : 'w-[26rem]'"
        >
          <span
            class="absolute -top-2 left-1/2 z-10 size-0 -translate-x-1/2 border-x-[0.8rem] border-t-[1.5rem] border-x-transparent border-t-accent-text"
            aria-hidden="true"
          />
          <button
            type="button"
            class="absolute inset-0 overflow-hidden rounded-full border-[6px] border-border-strong will-change-transform disabled:cursor-default"
            :style="{ background: face, transform: `rotate(${rotation}deg)` }"
            :disabled="spinning || !entries.length"
            :aria-label="$t('fun.wheel.spin')"
            @click="spin"
          >
            <span
              v-for="(label, i) in labels"
              :key="i"
              class="absolute top-1/2 left-1/2 h-0 w-[46%] origin-left"
              :style="{ transform: `rotate(${label.angle}deg)` }"
              aria-hidden="true"
            >
              <span
                class="absolute right-2 max-w-[78%] -translate-y-1/2 truncate font-semibold"
                :style="{ fontSize: labelSize }"
                >{{ label.text }}</span
              >
            </span>
          </button>
          <span
            class="pointer-events-none absolute top-1/2 left-1/2 size-[14%] -translate-1/2 rounded-full border-4 border-border-strong bg-surface-raised"
            aria-hidden="true"
          />
          <span
            v-for="piece in pieces"
            :key="piece.id"
            class="confetti pointer-events-none absolute top-0 z-20 h-3 w-2 rounded-[1px]"
            :style="{
              left: piece.left,
              background: piece.tone,
              animationDelay: piece.delay,
              '--turn': piece.turn,
            }"
            aria-hidden="true"
          />
        </div>

        <p class="text-sm text-text-secondary">
          {{ entries.length ? $t('fun.wheel.hint') : $t('fun.wheel.empty') }}
        </p>

        <section
          class="flex min-h-24 w-[26rem] max-w-full flex-col items-center justify-center gap-2 rounded-xl border border-border-default bg-surface-raised p-3 text-center shadow-sm"
          aria-live="polite"
        >
          <template v-if="winner !== null && !spinning">
            <p class="text-xs font-semibold tracking-wider text-text-secondary uppercase">
              {{ $t('fun.wheel.winner') }}
            </p>
            <p class="max-w-full text-2xl leading-tight font-bold break-words">{{ winner }}</p>
            <UiButton v-if="winnerListed" size="sm" @click="removeWinner">
              <X class="size-4" aria-hidden="true" />{{ $t('fun.wheel.remove') }}
            </UiButton>
          </template>
          <p v-else class="text-sm text-text-muted">
            {{ spinning ? $t('fun.wheel.spinning') : $t('fun.wheel.notSpun') }}
          </p>
        </section>

        <UiButton variant="ghost" @click="toggleFull">
          <component :is="full ? Minimize : Maximize" class="size-4" aria-hidden="true" />
          {{ full ? $t('fun.wheel.exitFull') : $t('fun.wheel.full') }}
        </UiButton>
      </div>

      <!-- The list -->
      <div
        class="flex min-w-0 flex-[1_1_18rem] flex-col gap-3"
        :class="spinning && state.options.hide ? 'invisible' : ''"
      >
        <UiSegmented v-model="tab" :options="tabs" :label="$t('fun.wheel.entries')" fill />

        <template v-if="tab === 'entries'">
          <div class="flex flex-wrap gap-2">
            <UiButton :disabled="entries.length < 2" @click="shuffleEntries">
              <Shuffle class="size-4" aria-hidden="true" />{{ $t('fun.wheel.shuffle') }}
            </UiButton>
            <UiButton :disabled="entries.length < 2" @click="sortEntries">
              <ArrowDownAZ class="size-4" aria-hidden="true" />{{ $t('fun.wheel.sort') }}
            </UiButton>
          </div>
          <label
            class="text-xs font-semibold tracking-wider text-text-secondary uppercase"
            for="wheel-entries"
          >
            {{ $t('fun.wheel.perLine') }}
          </label>
          <textarea
            id="wheel-entries"
            v-model="state.text"
            rows="10"
            spellcheck="false"
            class="min-h-56 w-full resize-y rounded-lg border border-border-strong bg-surface-raised px-3 py-2 text-sm leading-relaxed"
          />
        </template>

        <template v-else>
          <div class="flex flex-wrap gap-2">
            <UiButton :disabled="state.results.length < 2" @click="sortResults">
              <ArrowDownAZ class="size-4" aria-hidden="true" />{{ $t('fun.wheel.sort') }}
            </UiButton>
            <UiButton variant="ghost" :disabled="!state.results.length" @click="state.results = []">
              {{ $t('fun.wheel.clearResults') }}
            </UiButton>
          </div>
          <ol
            v-if="state.results.length"
            class="flex max-h-96 flex-col overflow-y-auto rounded-lg border border-border-default bg-surface-raised"
          >
            <li
              v-for="(result, i) in state.results"
              :key="i"
              class="flex min-w-0 items-center gap-3 border-t border-border-default px-3 py-2 first:border-t-0"
            >
              <span class="tabular w-7 shrink-0 text-right text-sm text-text-secondary">{{
                formatNumber(i + 1)
              }}</span>
              <b class="min-w-0 flex-1 truncate text-sm">{{ result }}</b>
            </li>
          </ol>
          <p v-else class="text-sm text-text-secondary">{{ $t('fun.wheel.noResults') }}</p>
        </template>

        <section class="rounded-xl border border-border-default bg-surface-raised shadow-sm">
          <button
            type="button"
            class="flex min-h-12 w-full min-w-0 items-center gap-2 px-3 text-left"
            :aria-expanded="state.optionsOpen"
            @click="state.optionsOpen = !state.optionsOpen"
          >
            <SlidersHorizontal class="size-4 shrink-0" aria-hidden="true" />
            <b class="min-w-0 flex-1 truncate text-sm">{{ $t('fun.wheel.options') }}</b>
            <span class="tabular shrink-0 text-xs text-text-secondary"
              >{{ state.options.seconds }} s</span
            >
            <component
              :is="state.optionsOpen ? ChevronUp : ChevronDown"
              class="size-4 shrink-0"
              aria-hidden="true"
            />
          </button>
          <div
            v-if="state.optionsOpen"
            class="flex flex-col border-t border-border-default px-3 py-2"
          >
            <div class="flex min-w-0 flex-wrap items-center justify-between gap-2 py-2">
              <span class="text-sm font-medium">{{ $t('fun.wheel.option.seconds') }}</span>
              <UiSegmented
                v-model="state.options.seconds"
                :options="secondOptions"
                :label="$t('fun.wheel.option.seconds')"
              />
            </div>
            <UiSwitch v-model="state.options.remove" :label="$t('fun.wheel.option.remove')" />
            <UiSwitch v-model="state.options.dialog" :label="$t('fun.wheel.option.dialog')" />
            <UiSwitch v-model="state.options.sound" :label="$t('fun.wheel.option.sound')" />
            <UiSwitch v-model="state.options.confetti" :label="$t('fun.wheel.option.confetti')" />
            <UiSwitch v-model="state.options.hide" :label="$t('fun.wheel.option.hide')" />
          </div>
        </section>
      </div>
    </div>

    <UiModal :open="dialog" :title="$t('fun.wheel.winner')" @close="dialog = false">
      <p class="py-4 text-center text-3xl leading-tight font-bold break-words">{{ winner }}</p>
      <template #footer>
        <UiButton @click="dialog = false">{{ $t('fun.wheel.close') }}</UiButton>
        <UiButton v-if="winnerListed" variant="primary" @click="removeWinner">
          {{ $t('fun.wheel.remove') }}
        </UiButton>
      </template>
    </UiModal>
  </div>
</template>

<style scoped>
.confetti {
  animation: confetti 1.5s ease-in forwards;
}
@keyframes confetti {
  from {
    transform: translateY(-1rem) rotate(0);
    opacity: 1;
  }
  to {
    transform: translateY(26rem) rotate(var(--turn));
    opacity: 0;
  }
}
</style>
