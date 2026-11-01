<script setup lang="ts">
import type { PlannerData } from '@gdt/game-data'
import type { DropRates } from '@gdt/game-data/drops'
import type { FarmingData } from '@gdt/game-data/farming'
import { goalEstimate } from '@gdt/game-data/planner-estimate'
import {
  TALENTS,
  constellationBoosts,
  type CharacterState,
  type PlanGoal,
  type PlanOptions,
  type Requirement,
  type TalentName,
  type WeaponState,
} from '@gdt/game-data/planner-math'
import type {
  ArtifactGoal,
  CharacterTarget,
  CustomCharacter,
  CustomWeapon,
  Good,
  WeaponTarget,
} from '@gdt/shared'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  CircleAlert,
  Copy,
  Download,
  Eye,
  EyeOff,
  NotebookPen,
  PencilLine,
  Plus,
  Replace,
  RotateCcw,
  Star,
  Trash2,
} from 'lucide-vue-next'
import { RARITY_TEXT } from '@/components/characters/tokens'
import ElementIcon from '@/components/ui/ElementIcon.vue'
import FilterChip from '@/components/ui/FilterChip.vue'
import GameIcon from '@/components/ui/GameIcon.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import { characterIcon, weaponIcon } from '@/lib/assets'
import { t } from '@/i18n'
import { formatCompact, formatNumber } from '@/lib/format'
import { downloadBlob } from '@/lib/share-image'
import { readStorage, writeStorage } from '@/lib/storage'
import { useFeedback } from '@/stores/feedback'
import ArtifactGoalBlock from './ArtifactGoalBlock.vue'
import CostList from './CostList.vue'
import { plannerWeaponIcon } from './custom-registry'
import CustomForm from './CustomForm.vue'
import { makePreset, presetText } from './custom-preset'
import CustomWeaponForm from './CustomWeaponForm.vue'
import { daysText, weeksText } from './farm-format'
import { resinDays } from './farm-today'
import LevelGrid from './LevelGrid.vue'
import { goalAtLeast, talentGap, type LevelStep } from './level-grid'
import {
  characterName,
  levelLabel,
  mergeRequirements,
  withoutPassives,
  wornByCharacter,
  type GoalEntry,
  type WeaponGoalView,
} from './model'
import NumberStepper from './NumberStepper.vue'
import { PRESETS, applyPreset, type Preset } from './presets'
import RosterGrid from './RosterGrid.vue'
import WeaponChooser from './WeaponChooser.vue'
import WeaponGoalBlock from './WeaponGoalBlock.vue'

/**
 * One goal card's editor, Seelie-style, saving as you go (no Save button):
 * a character's Level (now and goal as level buttons), Talents (− / +
 * steppers, C3/C5 marked, a warning when the goal level's ascension doesn't
 * allow them) and Weapon goals (any weapon of its type, owned or not, the
 * same one twice if wanted), Artifacts (sets, main stats and ticks, ticked
 * from the capture too: ArtifactGoalBlock); a custom character also has its
 * profile and "Replace with" a real one. Presets set the whole goal in one click. A
 * weapon on its own card gets its editor alone. The cost of the card is
 * beside it (below on phones), each tile coloured by what the bag covers.
 * The header has the favourite, counted and delete (with Undo, from the
 * page); the note folds away.
 *
 * Every change is emitted as it happens; the page writes it (optimistic,
 * sent after a short pause) and hands the new state back down.
 */
const props = defineProps<{
  open: boolean
  entry: GoalEntry | null
  /** The planner data with custom characters in it. */
  planner: PlannerData
  /** The game's alone (the roster "Replace with" picks from). */
  basePlanner: PlannerData
  /** The capture's characters and weapons, with the planner's bag as `materials`. */
  good: Good
  /** Every goal but this card's, for the cost colours. */
  others: readonly PlanGoal[]
  options: PlanOptions
  drops: DropRates | null
  ar: number | null
  wl: number | null
  refreshes: number
  /** Character keys with a goal (not offered by "Replace with"). */
  taken: ReadonlySet<string>
  /** Custom characters' names by id. */
  names: ReadonlyMap<string, string>
  /** Artifact domains and the rest (null: not loaded). */
  farming: FarmingData | null
  /** The tab to open on (a card's Artifacts row); null: the last one used. */
  startTab?: string | null
}>()
const emit = defineEmits<{
  close: []
  /** The card's character goal (custom ones keep their profile in it). */
  character: [target: CharacterTarget & { custom?: CustomCharacter }]
  /** The character's current state set by hand (null: the capture's). */
  characterNow: [state: CharacterState | null]
  weapon: [weapon: WeaponGoalView, target: WeaponTarget]
  weaponNow: [weapon: WeaponGoalView, state: WeaponState | null]
  addWeapon: [key: string]
  /** A custom weapon for this card's character (named "Custom weapon" until renamed). */
  addCustomWeapon: []
  removeWeapon: [weapon: WeaponGoalView]
  toggle: []
  favorite: []
  remove: []
  replace: [real: string]
}>()

const feedback = useFeedback()
const c = computed(() => props.entry?.character ?? null)
const lone = computed(() => (c.value ? null : (props.entry?.weapons[0] ?? null)))
/** The card's custom weapon goals (custom-weapon.ts). */
const customWeapons = computed(() => props.entry?.weapons.filter((w) => w.target.custom) ?? [])
const stored = computed(() => c.value?.stored ?? null)
const phases = computed(() =>
  c.value ? (props.planner.characters.get(c.value.key)?.ascension ?? null) : null,
)

type Tab = 'level' | 'talents' | 'weapon' | 'artifacts' | 'custom'
const TABS_SAVED: readonly string[] = ['talents', 'weapon', 'artifacts']
const saved = readStorage('planner:goal-tab')
const tab = ref<Tab>(saved && TABS_SAVED.includes(saved) ? (saved as Tab) : 'level')
watch(tab, (value) => writeStorage('planner:goal-tab', value))
const tabs = computed(() => {
  const list: { value: Tab; label: string; count?: number }[] = [
    { value: 'level', label: t('planner.card.level') },
    { value: 'talents', label: t('planner.card.talents') },
    {
      value: 'weapon',
      label: t('planner.hint.weapon'),
      count: props.entry?.weapons.length || undefined,
    },
    { value: 'artifacts', label: t('planner.artifacts.title') },
  ]
  if (c.value?.custom || customWeapons.value.length) {
    list.push({ value: 'custom', label: t('planner.card.custom') })
  }
  return list
})

const adding = ref(false)
const replacing = ref(false)
const replaceWith = ref<string | null>(null)
const noteOpen = ref(false)
const note = ref('')
watch(
  () => [props.open, props.entry?.id] as const,
  ([open], before) => {
    if (!open) return
    if (before?.[1] !== props.entry?.id || !before?.[0]) {
      adding.value = false
      replacing.value = false
      replaceWith.value = null
      noteOpen.value = !!props.entry?.note
      note.value = props.entry?.note ?? ''
      if (props.startTab && TABS_SAVED.includes(props.startTab)) tab.value = props.startTab as Tab
      if (tab.value === 'custom' && !c.value?.custom && !customWeapons.value.length) {
        tab.value = 'level'
      }
    }
  },
  { immediate: true },
)

// ------------------------------------------------------------- character

/** A goal part set by hand ends a Custom goal's `unset` mark (presets.ts). */
function setCharacter(next: CharacterTarget & { custom?: CustomCharacter }) {
  const was = stored.value
  if (next.unset && was && goalChanged(was, next)) {
    const { unset: _unset, ...rest } = next
    next = rest
  }
  emit('character', next)
}
const goalChanged = (a: CharacterTarget, b: CharacterTarget) =>
  a.level !== b.level ||
  a.ascension !== b.ascension ||
  a.talents.auto !== b.talents.auto ||
  a.talents.skill !== b.talents.skill ||
  a.talents.burst !== b.talents.burst ||
  JSON.stringify(a.artifacts ?? null) !== JSON.stringify(b.artifacts ?? null)

function setNow(next: CharacterState) {
  emit('characterNow', next)
  const goal = stored.value
  if (!goal) return
  const raised = goalAtLeast(goal, next)
  // Raised along with now: still nothing asked, so an `unset` mark stays.
  if (JSON.stringify(raised) !== JSON.stringify(goal)) emit('character', raised)
}

function pickNow(step: LevelStep) {
  const ch = c.value
  if (ch)
    setNow({ level: step.level, ascension: step.ascension, talents: { ...ch.current.talents } })
}

function pickGoal(step: LevelStep) {
  if (stored.value) setCharacter({ ...stored.value, level: step.level, ascension: step.ascension })
}

function setNowTalent(t: TalentName, value: number) {
  const ch = c.value
  if (ch) setNow({ ...ch.current, talents: { ...ch.current.talents, [t]: value } })
}

function setGoalTalent(t: TalentName, value: number) {
  if (stored.value)
    setCharacter({ ...stored.value, talents: { ...stored.value.talents, [t]: value } })
}

const gap = computed(() =>
  phases.value && stored.value
    ? talentGap(phases.value, stored.value, props.planner.talentAscension)
    : null,
)
const gapLabel = computed(() => {
  const g = gap.value
  const ch = c.value
  return g && ch
    ? levelLabel(props.planner, 'character', ch.key, g.level.level, g.level.ascension)
    : ''
})
function fixGap() {
  const g = gap.value
  if (g && stored.value) setCharacter({ ...stored.value, ...g.level })
}

const talentLabel = (name: TalentName) => t(`planner.editor.talent.${name}`)
const boosts = computed(() =>
  c.value ? constellationBoosts(props.planner, c.value.key) : { c3: null, c5: null },
)
/** "C3" / "C5" for the talent a constellation raises by 3, and whether it is reached. */
function boostOf(t: TalentName) {
  const b = boosts.value
  const at = b.c3 === t ? 3 : b.c5 === t ? 5 : 0
  return at ? { at, on: (c.value?.constellation ?? 0) >= at } : null
}

function setConstellation(value: number) {
  const ch = c.value
  if (!ch || !stored.value) return
  const constellation = value > ch.capturedConstellation ? value : undefined
  setCharacter({ ...stored.value, constellation })
}

const presetOn = (p: Preset) => {
  const ch = c.value
  const goal = stored.value
  if (!ch || !goal) return false
  const made = applyPreset(p, ch.current, goal, phases.value ?? undefined)
  return (
    made.level === goal.level &&
    made.ascension === goal.ascension &&
    TALENTS.every((t) => made.talents[t] === goal.talents[t])
  )
}
function usePreset(p: Preset) {
  const ch = c.value
  if (ch && stored.value)
    setCharacter(applyPreset(p, ch.current, stored.value, phases.value ?? undefined))
}

const capturedText = computed(() => {
  const ch = c.value
  if (!ch) return ''
  if (!ch.owned) return ch.custom ? t('planner.card.custom') : t('planner.editor.notOwned')
  const s = ch.captured
  return `${levelLabel(props.planner, 'character', ch.key, s.level, s.ascension)} · ${s.talents.auto}/${s.talents.skill}/${s.talents.burst}`
})
const levelEdited = computed(() => {
  const ch = c.value
  return (
    !!ch &&
    ch.edited &&
    (ch.current.level !== ch.captured.level || ch.current.ascension !== ch.captured.ascension)
  )
})
const talentsEdited = computed(() => {
  const ch = c.value
  return !!ch && ch.edited && TALENTS.some((t) => ch.current.talents[t] !== ch.captured.talents[t])
})
/** What the character wears (nothing for a custom one). */
const worn = computed(() =>
  c.value && !c.value.custom ? wornByCharacter(props.good, c.value.key) : new Map(),
)
function setArtifacts(artifacts: ArtifactGoal | undefined) {
  if (stored.value) setCharacter({ ...stored.value, artifacts })
}

const arNeed = computed(() => {
  const need = c.value?.requirement?.ar ?? 0
  return props.ar !== null && need > props.ar ? need : 0
})

// ------------------------------------------------------------------ note

let noteTimer: ReturnType<typeof setTimeout> | undefined
function saveNote() {
  clearTimeout(noteTimer)
  const text = note.value.trim() || undefined
  if ((props.entry?.note || undefined) === text) return
  if (stored.value) setCharacter({ ...stored.value, note: text })
  else if (lone.value) emit('weapon', lone.value, { ...lone.value.target, note: text })
}
function onNote() {
  clearTimeout(noteTimer)
  noteTimer = setTimeout(saveNote, 800)
}
watch(
  () => props.open,
  (open) => {
    if (!open) saveNote()
  },
)
onBeforeUnmount(saveNote)

// ------------------------------------------------------------------ cost

const requirements = computed<Requirement[]>(() => {
  const e = props.entry
  if (!e) return []
  return [e.character, ...e.weapons].flatMap((x) => (x?.requirement ? [x.requirement] : []))
})

/** This card on its own: resin and days (domains, bosses, ley lines), weekly weeks. */
const estimate = computed(() => {
  if (requirements.value.length === 0) return null
  const owned = props.options.passives ? new Set<string>(props.options.passives) : null
  const requirement = mergeRequirements(props.planner, requirements.value, owned)
  const plan = goalEstimate(
    props.planner,
    { id: 'self', requirement },
    props.good.materials,
    props.drops,
    { ...withoutPassives(props.options), ar: props.ar, wl: props.wl },
  )
  const total = plan.total
  const weeks = plan.weeklyTotal.weeks
  if (total.resin === 0 && weeks === 0) return null
  const days = resinDays(total.resin, props.refreshes)
  const resin = `${formatCompact(total.resin)}${total.partial ? '+' : ''}`
  const parts = [`${t('planner.editor.estimateResin', { resin })} · ${daysText(days)}`]
  if (weeks > 0) parts.push(weeksText(weeks))
  const title = [
    t('planner.editor.estimateTitle', {
      runs: formatNumber(total.runs),
      resin: formatNumber(total.resin),
      condensed: formatNumber(total.condensed),
      days: formatNumber(days),
    }),
    weeks > 0 ? t('planner.editor.estimateWeekly', { weeks: formatNumber(weeks) }) : '',
    total.partial ? t('farm.panel.partial') : '',
    plan.assumed.ar || plan.assumed.wl ? t('farm.panel.assumed') : '',
  ]
  return { text: parts.join(' · '), title: title.filter(Boolean).join(' · ') }
})

// --------------------------------------------------------------- chrome

const title = computed(() => props.entry?.name ?? '')
const portrait = computed(() => {
  const ch = c.value
  if (ch)
    return { src: ch.custom ? (ch.custom.image ?? '') : characterIcon(ch.key), rarity: ch.rarity }
  const w = lone.value
  return w
    ? { src: plannerWeaponIcon(w.key, w.target.ascension), rarity: w.rarity }
    : { src: '', rarity: null }
})
const holderName = (key: string) => props.names.get(key) ?? characterName(key)

function pickWeapon(key: string) {
  adding.value = false
  emit('addWeapon', key)
}

function pickCustomWeapon() {
  adding.value = false
  emit('addCustomWeapon')
}

function setCustomWeapon(w: WeaponGoalView, custom: CustomWeapon) {
  emit('weapon', w, { ...w.target, custom })
}

/** The card's custom character and weapons as a preset (custom-preset.ts). */
function cardPreset() {
  const ch = c.value
  return makePreset(
    ch?.custom ? [{ key: ch.key, custom: ch.custom }] : [],
    customWeapons.value.map((w) => ({ owner: w.owner, custom: w.target.custom! })),
  )
}

/** The preset as a file, named after its first entry. */
function savePreset() {
  const preset = cardPreset()
  const name = (preset.characters[0]?.name ?? preset.weapons[0]?.name ?? 'preset')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
  const blob = new Blob([presetText(preset)], { type: 'application/json' })
  downloadBlob(blob, `${name || 'preset'}.teyvatme.json`)
}

/** The preset onto the clipboard. */
async function copyPreset() {
  try {
    await navigator.clipboard.writeText(presetText(cardPreset()))
    feedback.toast({ tone: 'success', title: t('planner.custom.share.copied') })
  } catch (cause) {
    feedback.error(t('planner.custom.share.copyFailed'), cause)
  }
}

function confirmReplace() {
  if (replaceWith.value) emit('replace', replaceWith.value)
  cancelReplace()
}
function cancelReplace() {
  replacing.value = false
  replaceWith.value = null
}
const replaceSelected = computed<ReadonlySet<string>>(
  () => new Set(replaceWith.value ? [replaceWith.value] : []),
)
</script>

<template>
  <UiModal :open="open && !!entry" :title="title" size="detail" @close="emit('close')">
    <template #heading>
      <div class="mr-auto flex min-w-0 flex-1 items-center gap-2.5">
        <GameIcon
          :src="portrait.src"
          :name="title"
          :rarity="portrait.rarity ?? undefined"
          size="sm"
        />
        <ElementIcon v-if="c?.element" :element="c.element" />
        <h2 class="min-w-0 truncate text-lg font-semibold">{{ title }}</h2>
        <span
          v-if="c?.rarity"
          class="hidden shrink-0 text-sm sm:inline"
          :class="RARITY_TEXT[c.rarity]"
          aria-hidden="true"
          >{{ '★'.repeat(c.rarity) }}</span
        >
      </div>
      <button
        v-if="c && entry"
        type="button"
        class="inline-flex size-10 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-surface-overlay"
        :class="entry.favorite ? 'text-rarity-5' : 'text-text-muted hover:text-text-primary'"
        :aria-pressed="entry.favorite"
        :aria-label="$t('planner.card.favoriteLabel', { name: title })"
        :title="entry.favorite ? $t('planner.card.favorite') : $t('planner.card.notFavorite')"
        @click="emit('favorite')"
      >
        <Star class="size-5" :fill="entry.favorite ? 'currentColor' : 'none'" aria-hidden="true" />
      </button>
      <button
        v-if="entry"
        type="button"
        class="inline-flex size-10 shrink-0 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-overlay hover:text-text-primary"
        :aria-pressed="entry.active"
        :aria-label="
          entry.active
            ? $t('planner.editor.countedLabel', { name: title })
            : $t('planner.editor.notCountedLabel', { name: title })
        "
        :title="entry.active ? $t('planner.common.counted') : $t('planner.common.notCounted')"
        @click="emit('toggle')"
      >
        <Eye v-if="entry.active" class="size-5" aria-hidden="true" />
        <EyeOff v-else class="size-5" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="inline-flex size-10 shrink-0 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-overlay hover:text-danger-text"
        :aria-label="$t('planner.common.removeName', { name: title })"
        :title="$t('planner.common.removeName', { name: title })"
        @click="emit('remove')"
      >
        <Trash2 class="size-5" aria-hidden="true" />
      </button>
    </template>

    <div v-if="entry" class="mx-auto grid max-w-5xl gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
      <div class="flex min-w-0 flex-col gap-4">
        <!-- Presets, constellation, note -->
        <div v-if="c && stored" class="flex flex-wrap items-center gap-2">
          <div
            class="scroll-hide scroll-fade-x -mx-1 flex min-w-0 flex-1 basis-full gap-1.5 overflow-x-auto px-1 sm:basis-auto"
            role="group"
            :aria-label="$t('planner.editor.presets')"
          >
            <FilterChip
              v-for="p in PRESETS"
              :key="p.id"
              :pressed="presetOn(p)"
              :title="p.title"
              @toggle="usePreset(p)"
              >{{ p.label }}</FilterChip
            >
          </div>
          <span
            class="inline-flex items-center gap-1.5"
            :title="$t('planner.editor.constellationTitle')"
          >
            <span class="text-sm text-text-muted">C</span>
            <NumberStepper
              :model-value="c.constellation"
              :min="c.capturedConstellation"
              :max="6"
              :label="$t('planner.editor.constellation')"
              @update:model-value="setConstellation"
            />
          </span>
          <UiButton
            variant="ghost"
            size="sm"
            :aria-expanded="noteOpen"
            :title="noteOpen ? $t('planner.editor.hideNote') : $t('planner.editor.note')"
            @click="noteOpen = !noteOpen"
          >
            <NotebookPen class="size-4" aria-hidden="true" />
            {{ $t('planner.editor.note') }}
          </UiButton>
        </div>
        <div v-else class="flex justify-end">
          <UiButton
            variant="ghost"
            size="sm"
            :aria-expanded="noteOpen"
            @click="noteOpen = !noteOpen"
          >
            <NotebookPen class="size-4" aria-hidden="true" />
            {{ $t('planner.editor.note') }}
          </UiButton>
        </div>
        <textarea
          v-if="noteOpen"
          v-model="note"
          rows="2"
          maxlength="1000"
          :aria-label="$t('planner.editor.note')"
          :placeholder="$t('planner.editor.note')"
          class="min-h-10 w-full resize-y rounded-md border border-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary shadow-sm transition-colors placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none"
          @input="onNote"
          @blur="saveNote"
        />

        <!-- A weapon on its own card -->
        <WeaponGoalBlock
          v-if="lone"
          :planner="planner"
          :weapon="lone"
          :ar="ar"
          :holder="lone.owner ? holderName(lone.owner) : undefined"
          @target="emit('weapon', lone, $event)"
          @now="emit('weaponNow', lone, $event)"
        />
        <section
          v-if="lone?.target.custom"
          class="flex flex-col gap-4 border-t border-border-subtle pt-3"
          :aria-label="$t('planner.custom.weapon')"
        >
          <CustomWeaponForm
            :planner="basePlanner"
            :profile="lone.target.custom"
            @change="(custom) => setCustomWeapon(lone!, custom)"
          />
          <div class="flex flex-wrap gap-2">
            <UiButton @click="copyPreset">
              <Copy class="size-4" aria-hidden="true" />
              {{ $t('planner.custom.share.copy') }}
            </UiButton>
            <UiButton @click="savePreset">
              <Download class="size-4" aria-hidden="true" />
              {{ $t('planner.custom.share.save') }}
            </UiButton>
          </div>
        </section>

        <template v-if="c && stored && phases">
          <UiSegmented
            v-model="tab"
            :options="tabs"
            :label="$t('planner.editor.part')"
            class="self-start"
          />

          <!-- Level -->
          <section
            v-if="tab === 'level'"
            class="flex flex-col gap-3"
            :aria-label="$t('planner.card.level')"
          >
            <div class="flex flex-col gap-1.5">
              <span class="flex items-center gap-2 text-xs font-medium text-text-muted">
                {{ $t('planner.editor.now') }}
                <span v-if="levelEdited" class="inline-flex items-center gap-1 text-accent-text">
                  <PencilLine
                    class="size-3.5"
                    :aria-label="$t('planner.card.setByHand')"
                    role="img"
                  />
                </span>
              </span>
              <LevelGrid
                :phases="phases"
                :level="c.current.level"
                :ascension="c.current.ascension"
                :min="c.captured"
                :label="$t('planner.editor.levelNow')"
                @pick="pickNow"
              />
            </div>
            <div class="flex flex-col gap-1.5">
              <span class="flex items-center gap-2 text-xs font-medium text-text-muted">
                {{ $t('planner.editor.goal') }}
                <span
                  v-if="arNeed"
                  class="text-warning-text"
                  :title="$t('planner.card.needsAr', { ar: arNeed })"
                  >{{ $t('farm.lock.ar', { ar: arNeed }) }}</span
                >
              </span>
              <LevelGrid
                :phases="phases"
                :level="stored.level"
                :ascension="stored.ascension"
                :from="c.current"
                :label="$t('planner.editor.levelGoal')"
                @pick="pickGoal"
              />
            </div>
          </section>

          <!-- Talents -->
          <section
            v-else-if="tab === 'talents'"
            class="flex flex-col gap-2"
            :aria-label="$t('planner.card.talents')"
          >
            <div
              class="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-2 sm:grid-cols-[8rem_auto_auto_minmax(0,1fr)]"
            >
              <span />
              <span class="text-xs font-medium text-text-muted">
                {{ $t('planner.editor.now') }}
                <PencilLine
                  v-if="talentsEdited"
                  class="inline size-3.5 text-accent-text"
                  :aria-label="$t('planner.card.setByHand')"
                  role="img"
                />
              </span>
              <span class="text-xs font-medium text-text-muted">{{
                $t('planner.editor.goal')
              }}</span>
              <span class="hidden sm:block" />
              <template v-for="tn in TALENTS" :key="tn">
                <span class="flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm">
                  {{ talentLabel(tn) }}
                  <span
                    v-if="boostOf(tn)"
                    class="rounded px-1 font-mono text-[0.6875rem] font-medium"
                    :class="boostOf(tn)!.on ? 'bg-accent/15 text-accent-text' : 'text-text-muted'"
                    :title="
                      boostOf(tn)!.on
                        ? $t('planner.editor.boostOn', {
                            at: boostOf(tn)!.at,
                            from: c.boosted.current[tn],
                            to: c.boosted.target[tn],
                          })
                        : $t('planner.editor.boost', { at: boostOf(tn)!.at })
                    "
                    >C{{ boostOf(tn)!.at }}</span
                  >
                </span>
                <NumberStepper
                  :model-value="c.current.talents[tn]"
                  :min="c.captured.talents[tn]"
                  :label="$t('planner.editor.talentNow', { talent: talentLabel(tn) })"
                  @update:model-value="setNowTalent(tn, $event)"
                />
                <NumberStepper
                  :model-value="stored.talents[tn]"
                  :min="c.current.talents[tn]"
                  :label="$t('planner.editor.talentGoal', { talent: talentLabel(tn) })"
                  @update:model-value="setGoalTalent(tn, $event)"
                />
                <span
                  class="tabular col-span-3 -mt-1 font-mono text-xs text-text-muted sm:col-span-1 sm:mt-0"
                  :class="boostOf(tn)?.on ? '' : 'hidden sm:block'"
                  ><template v-if="boostOf(tn)?.on">{{
                    $t('planner.editor.inGame', {
                      from: c.boosted.current[tn],
                      to: c.boosted.target[tn],
                    })
                  }}</template></span
                >
              </template>
            </div>
          </section>

          <!-- Weapon -->
          <section
            v-else-if="tab === 'weapon'"
            class="flex flex-col gap-3"
            :aria-label="$t('planner.hint.weapon')"
          >
            <WeaponGoalBlock
              v-for="w in entry.weapons"
              :key="w.goalId"
              :planner="planner"
              :weapon="w"
              :ar="ar"
              removable
              @target="emit('weapon', w, $event)"
              @now="emit('weaponNow', w, $event)"
              @remove="emit('removeWeapon', w)"
            />
            <WeaponChooser
              v-if="adding"
              :planner="planner"
              :good="good"
              :type="c.weapon"
              :holder="c.key"
              :names="names"
              custom
              @pick="pickWeapon"
              @custom="pickCustomWeapon"
            />
            <div class="flex gap-2">
              <UiButton v-if="!adding" @click="adding = true">
                <Plus class="size-4" aria-hidden="true" />
                {{ $t('planner.hint.weapon') }}
              </UiButton>
              <UiButton v-else variant="ghost" @click="adding = false">{{
                $t('planner.common.cancel')
              }}</UiButton>
            </div>
          </section>

          <!-- Artifacts -->
          <ArtifactGoalBlock
            v-else-if="tab === 'artifacts'"
            :goal="stored.artifacts"
            :worn="worn"
            :farming="farming"
            @change="setArtifacts"
          />

          <!-- Custom -->
          <section
            v-else-if="tab === 'custom' && (c.custom || customWeapons.length)"
            class="flex flex-col gap-4"
            :aria-label="$t('planner.editor.customCharacter')"
          >
            <CustomForm
              v-if="c.custom"
              :planner="basePlanner"
              :profile="c.custom"
              @change="(custom) => setCharacter({ ...stored!, custom })"
            />
            <section
              v-for="w in customWeapons"
              :key="w.goalId"
              class="flex flex-col gap-3"
              :class="c.custom ? 'border-t border-border-subtle pt-3' : ''"
              :aria-label="w.name"
            >
              <h3 class="text-sm font-semibold">{{ w.name }}</h3>
              <CustomWeaponForm
                :planner="basePlanner"
                :profile="w.target.custom!"
                @change="(custom) => setCustomWeapon(w, custom)"
              />
            </section>
            <div class="flex flex-wrap gap-2">
              <UiButton @click="copyPreset">
                <Copy class="size-4" aria-hidden="true" />
                {{ $t('planner.custom.share.copy') }}
              </UiButton>
              <UiButton @click="savePreset">
                <Download class="size-4" aria-hidden="true" />
                {{ $t('planner.custom.share.save') }}
              </UiButton>
            </div>
            <div v-if="c.custom" class="flex flex-col gap-3 border-t border-border-subtle pt-3">
              <div class="flex flex-wrap items-center gap-2">
                <UiButton v-if="!replacing" @click="replacing = true">
                  <Replace class="size-4" aria-hidden="true" />
                  {{ $t('planner.editor.replaceWithEllipsis') }}
                </UiButton>
                <template v-else>
                  <UiButton variant="primary" :disabled="!replaceWith" @click="confirmReplace">
                    <Replace class="size-4" aria-hidden="true" />
                    {{
                      replaceWith
                        ? $t('planner.editor.replaceWith', { name: characterName(replaceWith) })
                        : $t('planner.editor.replace')
                    }}
                  </UiButton>
                  <UiButton variant="ghost" @click="cancelReplace">{{
                    $t('planner.common.cancel')
                  }}</UiButton>
                </template>
              </div>
              <RosterGrid
                v-if="replacing"
                :planner="basePlanner"
                :good="good"
                :selected="replaceSelected"
                :exclude="taken"
                @toggle="(key) => (replaceWith = replaceWith === key ? null : key)"
              />
            </div>
          </section>

          <p
            v-if="gap"
            class="flex flex-wrap items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-warning-text"
            role="status"
          >
            <CircleAlert class="size-4 shrink-0" aria-hidden="true" />
            <span class="min-w-0 flex-1"
              >{{
                $t('planner.editor.gapNeed', {
                  talents: gap.talents.map(talentLabel).join($t('farm.craft.listSeparator')),
                })
              }}
              <span class="font-mono">{{ gapLabel }}</span></span
            >
            <UiButton size="sm" @click="fixGap">{{
              $t('planner.editor.setLevel', { level: gapLabel })
            }}</UiButton>
          </p>

          <p
            class="tabular flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-text-muted"
          >
            <span v-if="!c.custom" :title="$t('planner.editor.captureTitle')">{{
              $t('planner.editor.capture', { text: capturedText })
            }}</span>
            <span v-if="c.edited" class="inline-flex items-center gap-1 text-accent-text">
              <PencilLine class="size-3.5" aria-hidden="true" />
              {{ $t('planner.card.setByHand') }}
              <button
                type="button"
                class="inline-flex min-h-6 items-center gap-1 rounded px-1 hover:bg-surface-overlay"
                :title="$t('planner.editor.resetTitle')"
                @click="emit('characterNow', null)"
              >
                <RotateCcw class="size-3.5" aria-hidden="true" />
                {{ $t('planner.editor.reset') }}
              </button>
            </span>
          </p>
        </template>
      </div>

      <aside
        class="flex min-w-0 flex-col gap-3 lg:border-l lg:border-border-subtle lg:pl-5"
        :aria-label="$t('planner.editor.cost')"
      >
        <h3 class="text-sm font-semibold text-text-secondary">{{ $t('planner.editor.cost') }}</h3>
        <CostList
          :planner="planner"
          :requirements="requirements"
          :others="others"
          :inventory="good.materials"
          :options="options"
          :label="title"
          legend
        />
        <p
          v-if="estimate"
          class="tabular font-mono text-sm text-text-secondary"
          :title="estimate.title"
        >
          {{ estimate.text }}<span class="sr-only"> ({{ estimate.title }})</span>
        </p>
      </aside>
    </div>
  </UiModal>
</template>
