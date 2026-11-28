<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, useTemplateRef, watch } from 'vue'
import { useResizeObserver } from '@vueuse/core'
import {
  ArrowDownAZ,
  Check,
  ChevronDown,
  ChevronUp,
  Eraser,
  FilePlus2,
  Maximize,
  Minimize,
  Pencil,
  Share2,
  Shuffle,
  SlidersHorizontal,
  Trash2,
} from 'lucide-vue-next'
import UiButton from '@/components/ui/UiButton.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiPopover from '@/components/ui/UiPopover.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiSwitch from '@/components/ui/UiSwitch.vue'
import {
  WHEEL_TONES,
  decodeShare,
  faceTurn,
  indexAt,
  labelAngle,
  landing,
  parseEntries,
  shuffled,
  sliceTone,
  wheelGradient,
  wheelShareUrl,
  withoutEntry,
} from '@/data/wheel'
import { t } from '@/i18n'
import { formatNumber } from '@/lib/format'
import { funStateKey } from '@/data/fun-storage'
import { writeJson } from '@/lib/storage'
import { readFunJson } from '../fun-state'
import { useFunHost } from '../host'
import { FUN_TOOLS_TARGET } from '../page-tools'
import { reducedMotion } from '../randomizer/motion'

/**
 * The wheel (docs/plans/fun.md; the owner's pick 2026-11-28: board "Wheel A",
 * the wheel beside the list, "Many colours"). The wheel spins on a click
 * anywhere on it, its SPIN hub or Ctrl + Enter, and stops under the amber
 * pointer at the right, so the winner reads level. The winner card under it
 * has Remove and Spin again. The list card beside it holds the text box (one
 * entry per line) and the results. The title row carries the list's name
 * (a named list saves itself as it is edited), My lists and Share link.
 * Options fold under the card; Full screen sizes the wheel to the screen.
 * Everything lives in this browser, one value per device.
 */
const host = useFunHost()
// One per device (data/fun-storage.ts): the public page and every account share the lists.
const storageKey = funStateKey('wheel')

const SECONDS = [3, 5, 10] as const
interface Options {
  seconds: (typeof SECONDS)[number]
  remove: boolean
  dialog: boolean
  sound: boolean
  confetti: boolean
  hide: boolean
}
interface SavedList {
  id: string
  name: string
  text: string
}
interface Saved {
  text: string
  results: string[]
  options: Options
  optionsOpen: boolean
  /** Lists kept by name, newest first. */
  lists: SavedList[]
  /** The kept list being edited; null for the working list (no name). */
  current: string | null
  /** The name typed in the title row; '' = not kept. */
  name: string
}
// The winner shows in the card under the wheel; the dialog is an option.
const DEFAULT_OPTIONS: Options = {
  seconds: 5,
  remove: false,
  dialog: false,
  sound: true,
  confetti: true,
  hide: false,
}
const MAX_RESULTS = 200
const MAX_LISTS = 30
const MAX_NAME = 40

const newId = () => Math.random().toString(36).slice(2, 10)

/** What was kept; older values (lists without ids, `name` naming a list) read too. */
function load(): Saved {
  const saved = readFunJson<Partial<Saved> & { name?: unknown }>('wheel', host.value.accountId, {})
  const options = { ...DEFAULT_OPTIONS, ...saved.options }
  const lists: SavedList[] = Array.isArray(saved.lists)
    ? saved.lists
        .filter((l) => l && typeof l.name === 'string' && typeof l.text === 'string')
        .map((l) => ({ id: typeof l.id === 'string' ? l.id : newId(), name: l.name, text: l.text }))
    : []
  const name = typeof saved.name === 'string' ? saved.name : ''
  const current =
    lists.find((l) => l.id === saved.current) ?? (name ? lists.find((l) => l.name === name) : null)
  return {
    text: typeof saved.text === 'string' ? saved.text : t('fun.wheel.sample'),
    results: Array.isArray(saved.results) ? saved.results.filter((r) => typeof r === 'string') : [],
    options: { ...options, seconds: SECONDS.includes(options.seconds) ? options.seconds : 5 },
    optionsOpen: saved.optionsOpen === true,
    lists,
    current: current?.id ?? null,
    name: current?.name ?? '',
  }
}
const winner = ref<string | null>(null)
const state = reactive<Saved>(load())
watch(state, (value) => writeJson(storageKey, value), { deep: true })

// A named list keeps itself: typing a name keeps the list under it, edits
// follow, and a cleared name makes it the working list again.
watch(
  () => [state.name, state.text] as const,
  ([raw, text]) => {
    const name = raw.trim().slice(0, MAX_NAME)
    const at = state.lists.findIndex((l) => l.id === state.current)
    if (!name) {
      if (at >= 0) state.lists.splice(at, 1)
      state.current = null
      return
    }
    if (at >= 0) {
      const list = state.lists[at]!
      if (list.name !== name || list.text !== text) state.lists[at] = { ...list, name, text }
      return
    }
    const id = newId()
    state.lists = [{ id, name, text }, ...state.lists].slice(0, MAX_LISTS)
    state.current = id
  },
)

// A shared link opens its list (the link is then cleaned, so a reload keeps edits).
function openShared() {
  const shared = decodeShare(location.hash)
  if (!shared?.length) return
  state.current = null
  state.name = ''
  state.text = shared.join('\n')
  state.results = []
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
const optionsSummary = computed(
  () =>
    `${state.options.seconds} s · ${state.options.sound ? t('fun.wheel.soundOn') : t('fun.wheel.soundOff')}`,
)

// ------------------------------------------------------------ the wheel's face

const face = computed(() => wheelGradient(entries.value.length, 'rgba(255, 255, 255, 0.85)'))

/** The drawn wheel's diameter (px): label sizes follow it. */
const wheel = useTemplateRef<HTMLElement>('wheel')
const diameter = ref(468)
useResizeObserver(wheel, (resize) => {
  const width = resize[0]?.contentRect.width
  if (width) diameter.value = width
})

/**
 * Label size: steps down with the count and never outgrows its slice; past
 * the count where it would be under 9.5px there are no labels (the slices
 * alone, and the winner card names the winner).
 */
const label = computed(() => {
  const n = entries.value.length
  const radius = diameter.value / 2
  const share = n <= 4 ? 0.085 : n <= 8 ? 0.075 : n <= 14 ? 0.065 : n <= 24 ? 0.056 : 0.05
  // The room between two labels at 62% of the radius.
  const room = (2 * Math.PI * radius * 0.62) / Math.max(1, n)
  const size = Math.min(Math.max(10, radius * share), n > 1 ? room * 0.75 : Infinity)
  return {
    shown: n > 0 && size >= 9.5,
    style: { fontSize: `${size.toFixed(1)}px`, maxWidth: `${Math.round(radius * 0.62)}px` },
  }
})
const labels = computed(() => {
  const n = entries.value.length
  if (n < 2 || !label.value.shown) return []
  return entries.value.map((text, i) => ({
    text,
    angle: labelAngle(i, n),
    ink: sliceTone(i, n).ink,
  }))
})
const hubFont = computed(() => `${Math.max(12, diameter.value * 0.045).toFixed(1)}px`)

// ------------------------------------------------------------ the spin

// The first entry starts in the middle of the pointer, not on a line.
const rotation = ref(entries.value.length ? -180 / entries.value.length : 0)
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
let confettiTimer = 0
function celebrate() {
  if (!state.options.confetti || reducedMotion()) return
  pieces.value = Array.from({ length: 36 }, (_, id) => ({
    id,
    left: `${Math.random() * 100}%`,
    delay: `${Math.random() * 0.25}s`,
    tone: WHEEL_TONES[id % WHEEL_TONES.length]!.fill,
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
  winner.value = null
  dialog.value = false
}
const winnerListed = computed(() => winner.value !== null && entries.value.includes(winner.value))
const shownWinner = computed(() => (spinning.value ? null : winner.value))

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

const listsAnchor = ref<HTMLElement | null>(null)
const listsShown = ref(false)

function newList() {
  state.current = null
  state.name = ''
  state.text = ''
  state.results = []
  winner.value = null
  listsShown.value = false
}
function openList(list: SavedList) {
  state.current = list.id
  state.name = list.name
  state.text = list.text
  state.results = []
  winner.value = null
  listsShown.value = false
}
function deleteList(id: string) {
  state.lists = state.lists.filter((l) => l.id !== id)
  // The list stays on the wheel, as the working list.
  if (state.current === id) {
    state.current = null
    state.name = ''
  }
}

const copied = ref(false)
let copiedTimer = 0
/** The link to copy by hand when this browser gives no clipboard; null when not asked. */
const handLink = ref<string | null>(null)
async function share() {
  // Always the public page (data/wheel.ts), so the link opens signed out too.
  const url = wheelShareUrl(location.origin, entries.value)
  try {
    await navigator.clipboard.writeText(url)
    copied.value = true
    window.clearTimeout(copiedTimer)
    copiedTimer = window.setTimeout(() => (copied.value = false), 2000)
  } catch {
    handLink.value = url
  }
}
function selectAll(event: Event) {
  ;(event.target as HTMLInputElement).select()
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
  <div class="min-w-0">
    <!-- The title row's tools (components/fun/page-tools.ts). -->
    <Teleport defer :to="FUN_TOOLS_TARGET">
      <label class="relative flex min-w-0 flex-[1_1_12rem] max-sm:basis-full sm:max-w-64">
        <span class="sr-only">{{ $t('fun.wheel.listName') }}</span>
        <UiInput
          v-model="state.name"
          :maxlength="MAX_NAME"
          :placeholder="$t('fun.wheel.namePlaceholder')"
          :title="$t('fun.wheel.nameHint')"
          class="truncate pr-9"
        />
        <Pencil
          class="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-text-muted"
          aria-hidden="true"
        />
      </label>
      <span ref="listsAnchor" class="inline-flex">
        <UiButton :aria-expanded="listsShown" @click="listsShown = !listsShown">
          {{ $t('fun.wheel.myLists') }}
          <ChevronDown class="size-4" aria-hidden="true" />
        </UiButton>
      </span>
      <UiButton :disabled="!entries.length" @click="share">
        <component :is="copied ? Check : Share2" class="size-4" aria-hidden="true" />
        {{ copied ? $t('fun.wheel.copied') : $t('fun.wheel.share') }}
      </UiButton>
    </Teleport>

    <UiPopover
      :open="listsShown"
      :anchor="listsAnchor"
      :label="$t('fun.wheel.myLists')"
      align="end"
      @close="listsShown = false"
    >
      <div class="flex flex-col p-1.5">
        <button
          type="button"
          class="flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-md px-3 text-left text-sm font-semibold text-accent-text hover:bg-surface-overlay"
          @click="newList"
        >
          <FilePlus2 class="size-4 shrink-0" aria-hidden="true" />
          {{ $t('fun.wheel.newList') }}
        </button>
        <div class="my-1 border-t border-border-default" />
        <ul v-if="state.lists.length" class="flex flex-col">
          <li v-for="list in state.lists" :key="list.id" class="flex w-full min-w-0 items-center">
            <button
              type="button"
              class="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-md px-3 text-left text-sm hover:bg-surface-overlay"
              :aria-current="list.id === state.current ? 'true' : undefined"
              @click="openList(list)"
            >
              <Check
                class="size-4 shrink-0"
                :class="list.id === state.current ? 'text-accent-text' : 'invisible'"
                aria-hidden="true"
              />
              <span class="min-w-0 flex-1 truncate font-medium">{{ list.name }}</span>
              <span class="tabular shrink-0 text-xs text-text-muted">{{
                formatNumber(parseEntries(list.text).length)
              }}</span>
            </button>
            <UiIconButton
              :label="$t('fun.wheel.deleteList', { name: list.name })"
              @click="deleteList(list.id)"
            >
              <Trash2 class="size-4" aria-hidden="true" />
            </UiIconButton>
          </li>
        </ul>
        <p v-else class="px-3 py-2.5 text-sm text-text-secondary">
          {{ $t('fun.wheel.noLists') }}
        </p>
      </div>
    </UiPopover>

    <div class="grid min-w-0 items-stretch gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,27.5rem)]">
      <!-- The wheel and the winner card -->
      <div
        ref="stage"
        class="wheel-stage flex min-w-0 flex-col items-center gap-5"
        :class="full ? 'is-full justify-center overflow-auto bg-surface-base px-8 pt-10 pb-6' : ''"
      >
        <div class="wheel-box relative aspect-square shrink-0">
          <!-- The rim stays put and clips; only the face inside turns, so the
               turned square never reaches past the page's edge. -->
          <div
            ref="wheel"
            class="absolute inset-0 cursor-pointer overflow-hidden rounded-full border-[6px] border-border-strong shadow-lg"
            :class="!entries.length || spinning ? 'cursor-default' : ''"
            aria-hidden="true"
            @click="spin"
          >
            <div
              class="absolute inset-0 rounded-full will-change-transform"
              :style="{ background: face, transform: `rotate(${faceTurn(rotation)}deg)` }"
            >
              <span
                v-for="(item, i) in labels"
                :key="i"
                class="absolute top-1/2 left-1/2 h-0 w-[47%] origin-left"
                :style="{ transform: `rotate(${item.angle}deg)` }"
              >
                <span
                  class="absolute right-[6%] -translate-y-1/2 truncate leading-tight font-semibold"
                  :style="{ ...label.style, color: item.ink }"
                  >{{ item.text }}</span
                >
              </span>
            </div>
          </div>
          <!-- One entry: one colour, its name level on the pointer's side. -->
          <span
            v-if="entries.length === 1 && label.shown"
            class="pointer-events-none absolute top-1/2 right-[9%] -translate-y-1/2 truncate text-right leading-tight font-semibold"
            :style="{ ...label.style, color: sliceTone(0, 1).ink }"
            aria-hidden="true"
            >{{ entries[0] }}</span
          >
          <button
            type="button"
            class="absolute top-1/2 left-1/2 grid size-[23%] -translate-1/2 place-items-center rounded-full border-4 border-border-strong bg-surface-raised font-bold tracking-[0.08em] text-text-primary uppercase shadow-md transition-colors hover:bg-surface-overlay focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:hover:bg-surface-raised"
            :style="{ fontSize: hubFont }"
            :disabled="spinning || !entries.length"
            :aria-label="$t('fun.wheel.spin')"
            :title="$t('fun.wheel.hint')"
            @click="spin"
          >
            {{ $t('fun.wheel.hub') }}
          </button>
          <svg
            class="wheel-pointer pointer-events-none absolute top-1/2 -right-3.5 z-10 h-9 w-8 -translate-y-1/2"
            viewBox="0 0 32 36"
            aria-hidden="true"
          >
            <path
              d="M2 18 30 3v30z"
              fill="var(--color-paimon)"
              stroke="var(--color-surface-base)"
              stroke-width="2.5"
              stroke-linejoin="round"
            />
          </svg>
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

        <section
          class="winner-card flex min-h-[6.5rem] max-w-full min-w-0 flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-border-default bg-surface-raised px-5 py-4 shadow-sm"
          aria-live="polite"
        >
          <template v-if="shownWinner !== null">
            <div class="min-w-0 flex-[1_1_10rem]">
              <p class="text-xs font-semibold tracking-wider text-text-secondary uppercase">
                {{ $t('fun.wheel.overline') }}
              </p>
              <p class="line-clamp-2 text-2xl leading-tight font-bold break-words">
                {{ shownWinner }}
              </p>
            </div>
            <div class="flex shrink-0 flex-wrap gap-2">
              <UiButton v-if="winnerListed" @click="removeWinner">
                {{ $t('fun.wheel.remove') }}
              </UiButton>
              <UiButton variant="primary" :disabled="!entries.length" @click="spin">
                {{ $t('fun.wheel.spinAgain') }}
              </UiButton>
            </div>
          </template>
          <p v-else class="w-full text-center text-sm text-text-secondary">
            {{
              spinning
                ? $t('fun.wheel.spinning')
                : entries.length
                  ? $t('fun.wheel.hint')
                  : $t('fun.wheel.empty')
            }}
          </p>
        </section>

        <UiButton v-if="full" variant="ghost" @click="toggleFull">
          <Minimize class="size-4" aria-hidden="true" />{{ $t('fun.wheel.exitFull') }}
        </UiButton>
      </div>

      <!-- The list -->
      <div class="flex min-w-0 flex-col gap-3.5">
        <section
          class="flex min-h-[22rem] min-w-0 flex-1 flex-col rounded-xl border border-border-default bg-surface-raised shadow-sm"
          :class="spinning && state.options.hide ? 'invisible' : ''"
        >
          <div
            class="flex min-w-0 flex-wrap items-center gap-2 border-b border-border-default px-3 py-2.5"
          >
            <UiSegmented v-model="tab" :options="tabs" :label="$t('fun.wheel.entries')" />
            <span class="ml-auto flex shrink-0 items-center">
              <template v-if="tab === 'entries'">
                <UiIconButton
                  :label="$t('fun.wheel.shuffle')"
                  class="disabled:pointer-events-none disabled:opacity-40"
                  :disabled="entries.length < 2"
                  @click="shuffleEntries"
                >
                  <Shuffle class="size-5" aria-hidden="true" />
                </UiIconButton>
                <UiIconButton
                  :label="$t('fun.wheel.sort')"
                  class="disabled:pointer-events-none disabled:opacity-40"
                  :disabled="entries.length < 2"
                  @click="sortEntries"
                >
                  <ArrowDownAZ class="size-5" aria-hidden="true" />
                </UiIconButton>
              </template>
              <template v-else>
                <UiIconButton
                  :label="$t('fun.wheel.sort')"
                  class="disabled:pointer-events-none disabled:opacity-40"
                  :disabled="state.results.length < 2"
                  @click="sortResults"
                >
                  <ArrowDownAZ class="size-5" aria-hidden="true" />
                </UiIconButton>
                <UiIconButton
                  :label="$t('fun.wheel.clearResults')"
                  class="disabled:pointer-events-none disabled:opacity-40"
                  :disabled="!state.results.length"
                  @click="state.results = []"
                >
                  <Eraser class="size-5" aria-hidden="true" />
                </UiIconButton>
              </template>
            </span>
          </div>

          <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-2.5 p-3.5">
            <template v-if="tab === 'entries'">
              <label class="sr-only" for="wheel-entries">{{ $t('fun.wheel.perLine') }}</label>
              <textarea
                id="wheel-entries"
                v-model="state.text"
                rows="10"
                spellcheck="false"
                class="min-h-64 w-full flex-1 resize-y rounded-lg border border-border-strong bg-surface-base px-3.5 py-3 text-sm leading-relaxed font-medium text-text-primary focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none"
              />
              <p class="text-xs text-text-muted">{{ $t('fun.wheel.kept') }}</p>
            </template>

            <template v-else>
              <ol
                v-if="state.results.length"
                class="flex max-h-[26rem] min-w-0 flex-col overflow-y-auto rounded-lg border border-border-default bg-surface-base"
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
              <p v-else class="py-6 text-center text-sm text-text-secondary">
                {{ $t('fun.wheel.noResults') }}
              </p>
            </template>
          </div>
        </section>

        <section
          class="min-w-0 rounded-xl border border-border-default bg-surface-raised shadow-sm"
        >
          <button
            type="button"
            class="flex min-h-13 w-full min-w-0 items-center gap-2.5 px-3.5 text-left"
            :aria-expanded="state.optionsOpen"
            @click="state.optionsOpen = !state.optionsOpen"
          >
            <SlidersHorizontal class="size-4 shrink-0" aria-hidden="true" />
            <b class="min-w-0 flex-1 truncate text-sm font-semibold">{{
              $t('fun.wheel.options')
            }}</b>
            <span class="tabular min-w-0 shrink truncate text-xs text-text-secondary">{{
              optionsSummary
            }}</span>
            <component
              :is="state.optionsOpen ? ChevronUp : ChevronDown"
              class="size-4 shrink-0"
              aria-hidden="true"
            />
          </button>
          <div
            v-if="state.optionsOpen"
            class="flex flex-col border-t border-border-default px-3.5 py-2"
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

        <UiButton variant="ghost" class="self-start" @click="toggleFull">
          <Maximize class="size-4" aria-hidden="true" />{{ $t('fun.wheel.full') }}
        </UiButton>
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

    <UiModal :open="handLink !== null" :title="$t('fun.wheel.share')" @close="handLink = null">
      <p class="text-sm text-text-secondary">{{ $t('fun.wheel.copyByHand') }}</p>
      <UiInput
        :model-value="handLink ?? ''"
        readonly
        autofocus
        class="mt-3 font-code"
        :aria-label="$t('fun.wheel.share')"
        @focus="selectAll"
        @click="selectAll"
      />
      <template #footer>
        <UiButton @click="handLink = null">{{ $t('fun.wheel.close') }}</UiButton>
      </template>
    </UiModal>
  </div>
</template>

<style scoped>
/*
 * The wheel's size: beside the list up to 26rem, never wider than its column
 * (less the pointer's reach); in full screen, from the screen's height and
 * width, leaving room for the top padding, the winner card and the exit
 * button. The winner card is as wide as the wheel, never narrower than 24rem
 * where the page allows.
 */
.wheel-stage {
  --wheel: min(26rem, calc(100% - 1.5rem));
}
.wheel-stage.is-full {
  --wheel: min(calc(100dvh - 18rem), calc(100vw - 5rem), 54rem);
  min-height: 100dvh;
}
.wheel-box {
  width: var(--wheel);
}
.winner-card {
  width: max(var(--wheel), min(24rem, 100%));
}
.wheel-pointer {
  filter: drop-shadow(0 2px 3px rgb(0 0 0 / 0.35));
}
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
