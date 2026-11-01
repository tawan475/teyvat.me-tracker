<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, shallowRef, watch } from 'vue'
import { ChevronLeft, ChevronRight, X } from 'lucide-vue-next'
import type { CharacterDetail, SetDetail, WeaponDetail } from '@gdt/game-data/details'
import { gameTextLines } from '@gdt/game-data/material-details'
import { artifactPieceName } from '@/components/artifacts/piece-name'
import ElementIcon from '@/components/ui/ElementIcon.vue'
import GameIcon from '@/components/ui/GameIcon.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import { t } from '@/i18n'
import { locale } from '@/i18n/locale'
import { TALENT_LABELS, bonusSets, type TalentLevel } from '@/data/character-build'
import {
  ELEMENT_LABELS,
  SLOT_LABELS,
  SLOT_ORDER,
  WEAPON_TYPE_LABELS,
  type CharacterView,
} from '@/data/characters'
import { artifactIcon, artifactSetIcon, weaponIcon } from '@/lib/assets'
import { readStorage, writeStorage } from '@/lib/storage'
import { useUpdateHold } from '@/live/holds'
import { formatSetName } from '@/utils/artifact-stats'
import ElementDisc from './ElementDisc.vue'
import { subjectId, type TipShown } from './detail-tip'
import { constellationIcons, talentIcons } from './talent-icons'

/**
 * The tip of a character details' part (detail-tip): what the game says it
 * does, beside the part. A talent: its name, kind and level, and like the
 * game two tabs, Talent Info (its description) and Skill Attributes (each
 * value at its level; a pinned tip steps through levels 1-15; the tab picked
 * last is kept per device); a constellation: locked or not, its
 * description; the weapon: its passive at the refinement held, then its
 * lore; an artifact set, or every set the build wears: each bonus, the ones
 * it doesn't reach dimmed; a piece: its name, its set's bonuses and its
 * lore; the element: its name and the weapon type. Text from `@gdt/game-data/details` (English where the language has
 * none). A hovered tip lets the pointer through; a pinned one has a close
 * button, scrolls, and closes on Escape or a click outside any part.
 */
const props = defineProps<{
  shown: TipShown | null
  character: CharacterView
  talents: TalentLevel[]
}>()
const emit = defineEmits<{ close: [] }>()
useUpdateHold(() => props.shown?.pinned === true)

const c = computed(() => props.character)
const details = () => import('@gdt/game-data/details')

// The character's text, the weapon's and the sets', each loaded once per key and language.
const kit = shallowRef<CharacterDetail | null | undefined>()
const passive = shallowRef<WeaponDetail | null | undefined>()
const sets = shallowRef(new Map<string, SetDetail | null>())
watch(
  () => [c.value.key, locale.value] as const,
  ([key, lang]) => {
    kit.value = undefined
    void details()
      .then((m) => m.loadCharacterDetail(key, lang))
      .catch(() => undefined)
      .then((found) => c.value.key === key && (kit.value = found ?? null))
  },
  { immediate: true },
)
watch(
  () => [c.value.weapon?.key, locale.value] as const,
  ([key, lang]) => {
    passive.value = undefined
    if (!key) return
    void details()
      .then((m) => m.loadWeaponDetail(key, lang))
      .catch(() => undefined)
      .then((found) => c.value.weapon?.key === key && (passive.value = found ?? null))
  },
  { immediate: true },
)
watch(locale, () => (sets.value = new Map()))
/** The sets the shown tip needs. */
const wantedSets = computed<string[]>(() => {
  const subject = props.shown?.subject
  if (subject?.kind === 'set') return [subject.setKey]
  if (subject?.kind === 'sets') return c.value.sets.map((s) => s.setKey)
  if (subject?.kind === 'piece') {
    const piece = c.value.artifacts.find((a) => a?.slotKey === subject.slot)
    return piece ? [piece.setKey] : []
  }
  return []
})
watch(
  wantedSets,
  (keys) => {
    const lang = locale.value
    for (const key of keys) {
      if (sets.value.has(key)) continue
      void details()
        .then((m) => m.loadSetDetail(key, lang))
        .catch(() => undefined)
        .then((found) => {
          sets.value = new Map(sets.value).set(key, found ?? null)
        })
    }
  },
  { immediate: true },
)

// A talent's two tabs, like the game's; the one picked last stays picked (per device).
type TalentTab = 'info' | 'attributes'
const TAB_KEY = 'characters:tip-tab'
const talentTab = shallowRef<TalentTab>(
  readStorage(TAB_KEY) === 'attributes' ? 'attributes' : 'info',
)
watch(talentTab, (tab) => writeStorage(TAB_KEY, tab))
const tabOptions = computed(() => [
  { value: 'info' as const, label: t('characters.tip.talentInfo') },
  { value: 'attributes' as const, label: t('characters.tip.skillAttributes') },
])
const MAX_TALENT_LEVEL = 15
/** The level Skill Attributes shows: the talent's own, until a pinned tip steps away. */
const attributeLevel = shallowRef(1)
/** The shown talent's level (with its C3/C5 boost). */
const ownLevel = computed(() => {
  const subject = props.shown?.subject
  return subject?.kind === 'talent' ? props.talents[subject.index]?.level : undefined
})
watch(
  () => [props.shown?.subject, ownLevel.value] as const,
  ([, level]) => {
    if (level !== undefined) attributeLevel.value = level
  },
  { immediate: true },
)
function stepLevel(by: 1 | -1) {
  attributeLevel.value = Math.min(MAX_TALENT_LEVEL, Math.max(1, attributeLevel.value + by))
}

interface Section {
  /** A heading over this section and the ones after it (a set's name, among several). */
  group?: string
  label?: string
  text: string
  /** Not reached (a set bonus short of pieces), or lore. */
  muted?: boolean
  /** Lore: under a rule, in italics. */
  lore?: boolean
}

interface Attribute {
  label: string
  value: string
}

interface Content {
  title: string
  sub: string[]
  /** undefined while the text loads. */
  sections: Section[] | undefined
  /** A talent's Skill Attributes at `attributeLevel`; undefined: no tabs. */
  attributes?: Attribute[]
}

/** One set's bonuses, the ones `count` pieces don't reach dimmed. */
function setSections(setKey: string, count: number, group?: string): Section[] {
  return (sets.value.get(setKey)?.bonuses ?? []).map((b, i) => ({
    group: i === 0 ? group : undefined,
    label: t('share.card.pieceBonus', { n: b.pieces }),
    text: b.description,
    muted: count < b.pieces,
  }))
}

const loreSection = (text: string | undefined): Section[] =>
  text ? [{ text, muted: true, lore: true }] : []

const content = computed<Content | null>(() => {
  const subject = props.shown?.subject
  if (!subject) return null
  const ch = c.value
  switch (subject.kind) {
    case 'talent': {
      const level = props.talents[subject.index]
      if (!level) return null
      const text = kit.value?.talents[subject.index]
      const rows = kit.value?.attributes[subject.index] ?? []
      const at = attributeLevel.value
      return {
        title: text?.name ?? TALENT_LABELS[level.key],
        sub: [
          TALENT_LABELS[level.key],
          level.from ? `Lv. ${level.base} → ${level.level} (C${level.from})` : `Lv. ${level.level}`,
          ...(level.crowned ? [t('characters.crowned')] : []),
        ],
        sections: kit.value === undefined ? undefined : text ? [{ text: text.description }] : [],
        attributes: rows.length
          ? rows.map((row) => ({
              label: row.label,
              value: row.values[Math.min(at, row.values.length) - 1] ?? row.values[0] ?? '',
            }))
          : undefined,
      }
    }
    case 'constellation': {
      const n = subject.index + 1
      const text = kit.value?.constellations[subject.index]
      const unlocked = subject.index < ch.constellation
      return {
        title: text?.name ?? `C${n}`,
        sub: [
          unlocked
            ? t('characters.constellation.unlocked', { n })
            : t('characters.constellation.locked', { n }),
        ],
        sections:
          kit.value === undefined
            ? undefined
            : text
              ? [{ text: text.description, muted: !unlocked }]
              : [],
      }
    }
    case 'weapon': {
      const weapon = ch.weapon
      if (!weapon) return null
      const found = passive.value
      const refinements = found?.refinements ?? []
      const text = refinements[Math.min(weapon.refinement, refinements.length) - 1]
      return {
        title: weapon.name,
        sub: [`Lv. ${weapon.level}`, `R${weapon.refinement}`],
        sections:
          found === undefined
            ? undefined
            : [
                ...(found && text ? [{ label: found.name, text }] : []),
                ...loreSection(found?.lore),
              ],
      }
    }
    case 'set': {
      const count = ch.sets.find((s) => s.setKey === subject.setKey)?.count ?? 0
      return {
        title: formatSetName(subject.setKey),
        sub: [`×${count}`],
        sections: sets.value.has(subject.setKey) ? setSections(subject.setKey, count) : undefined,
      }
    }
    case 'sets': {
      // The bonuses reached first (a 4-piece, 2 + 2), then single pieces.
      const reached = bonusSets(ch.sets).map(({ set }) => set)
      const listed = [...reached, ...ch.sets.filter((s) => !reached.includes(s))]
      if (!listed.length) return null
      return {
        title: t('characters.sets'),
        sub: listed.map((s) => `${s.name} ×${s.count}`),
        sections: listed.every((s) => sets.value.has(s.setKey))
          ? listed.flatMap((s) => setSections(s.setKey, s.count, s.name))
          : undefined,
      }
    }
    case 'piece': {
      const piece = ch.artifacts.find((a) => a?.slotKey === subject.slot)
      if (!piece) return null
      const count = ch.sets.find((s) => s.setKey === piece.setKey)?.count ?? 0
      const slot = (SLOT_ORDER as readonly string[]).indexOf(piece.slotKey)
      return {
        title: artifactPieceName(piece.setKey, piece.slotKey) ?? formatSetName(piece.setKey),
        sub: [SLOT_LABELS[piece.slotKey], `+${piece.level}`],
        sections: sets.value.has(piece.setKey)
          ? [
              ...setSections(piece.setKey, count, formatSetName(piece.setKey)),
              ...loreSection(sets.value.get(piece.setKey)?.lore[slot]),
            ]
          : undefined,
      }
    }
    case 'element': {
      if (!ch.element) return null
      return {
        title: ELEMENT_LABELS[ch.element],
        sub: ch.weaponType ? [WEAPON_TYPE_LABELS[ch.weaponType]] : [],
        sections: [],
      }
    }
  }
  return null
})

type TipIcon =
  | { disc: string; locked: boolean }
  | { item: string; rarity: number | null | undefined }

const icon = computed<TipIcon | null>(() => {
  const subject = props.shown?.subject
  const ch = c.value
  if (!subject) return null
  switch (subject.kind) {
    case 'talent': {
      const key = props.talents[subject.index]?.key
      return key ? { disc: talentIcons(ch.key)[key], locked: false } : null
    }
    case 'constellation':
      return {
        disc: constellationIcons(ch.key)[subject.index] ?? '',
        locked: subject.index >= ch.constellation,
      }
    case 'weapon':
      return ch.weapon
        ? { item: weaponIcon(ch.weapon.key, ch.weapon.ascension), rarity: ch.weapon.rarity }
        : null
    case 'set': {
      const set = ch.sets.find((s) => s.setKey === subject.setKey)
      return { item: artifactSetIcon(subject.setKey), rarity: set?.rarity }
    }
    case 'sets': {
      const set = bonusSets(ch.sets)[0]?.set ?? ch.sets[0]
      return set ? { item: artifactSetIcon(set.setKey), rarity: set.rarity } : null
    }
    case 'piece': {
      const piece = ch.artifacts.find((a) => a?.slotKey === subject.slot)
      return piece
        ? { item: artifactIcon(piece.setKey, piece.slotKey), rarity: piece.rarity }
        : null
    }
    default:
      return null
  }
})

/** A coloured run: the game's colour mixed toward the text, so light game colours read on both themes. */
const runColor = (color: string) => `color-mix(in oklab, ${color} 60%, currentColor)`

// --- placing ---------------------------------------------------------------------------

const panel = shallowRef<HTMLElement>()
const style = shallowRef<Record<string, string>>({})
/** Where it renders: the anchor's dialog (the top layer), else the page. */
const target = shallowRef<HTMLElement | string>('body')

function place() {
  const anchor = props.shown?.anchor
  const el = panel.value
  if (!anchor || !el) return
  if (!anchor.isConnected) {
    emit('close')
    return
  }
  const margin = 8
  const gap = 8
  const box = anchor.getBoundingClientRect()
  const width = Math.min(el.offsetWidth || 352, window.innerWidth - 2 * margin)
  // Beside a part in a column (right, else left), level with its top, when it fits.
  if (props.shown?.side) {
    const right = box.right + gap + width <= window.innerWidth - margin
    const left = box.left - gap - width >= margin
    if (right || left) {
      const room = window.innerHeight - 2 * margin
      const height = Math.min(el.scrollHeight, room)
      style.value = {
        left: `${right ? box.right + gap : box.left - gap - width}px`,
        top: `${Math.min(Math.max(margin, box.top), window.innerHeight - margin - height)}px`,
        maxHeight: `${room}px`,
      }
      return
    }
  }
  const below = window.innerHeight - box.bottom - gap - margin
  const above = box.top - gap - margin
  const down = below >= Math.min(el.scrollHeight, 320) || below >= above
  const left = Math.min(
    Math.max(margin, box.left + box.width / 2 - width / 2),
    window.innerWidth - width - margin,
  )
  style.value = {
    left: `${left}px`,
    maxHeight: `${Math.max(140, down ? below : above)}px`,
    ...(down
      ? { top: `${box.bottom + gap}px` }
      : { bottom: `${window.innerHeight - box.top + gap}px` }),
  }
}

function onKey(event: Event) {
  if ((event as KeyboardEvent).key !== 'Escape' || !props.shown?.pinned) return
  // Not the dialog underneath too.
  event.preventDefault()
  event.stopPropagation()
  emit('close')
}

function onPointerDown(event: Event) {
  const node = event.target as Element | null
  if (!node || !props.shown?.pinned) return
  // A part's own click toggles it (detail-tip); the panel keeps its clicks.
  if (panel.value?.contains(node) || node.closest?.('[data-tip]')) return
  emit('close')
}

function listen(on: boolean) {
  const method = on ? 'addEventListener' : 'removeEventListener'
  window[method]('resize', place)
  window[method]('scroll', place, true)
  window[method]('keydown', onKey, true)
  document[method]('pointerdown', onPointerDown, true)
}

watch(
  () => props.shown,
  async (shown, before) => {
    if (!shown) {
      if (before) listen(false)
      return
    }
    if (!before) listen(true)
    target.value = (shown.anchor.closest('dialog[open]') as HTMLElement | null) ?? 'body'
    await nextTick()
    place()
  },
  { immediate: true },
)
// The text arriving changes the height: place again.
watch(content, () => void nextTick(place))

onBeforeUnmount(() => {
  if (props.shown) listen(false)
})

const labelId = computed(() => `detail-tip-${props.shown ? subjectId(props.shown.subject) : ''}`)
</script>

<template>
  <Teleport :to="target">
    <div
      v-if="shown && content"
      ref="panel"
      :role="shown.pinned ? 'dialog' : 'tooltip'"
      :aria-labelledby="labelId"
      class="fixed z-50 flex w-[22rem] max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-xl border border-border-default bg-surface-raised text-text-primary shadow-overlay"
      :class="shown.pinned ? '' : 'pointer-events-none'"
      :style="style"
    >
      <div class="flex shrink-0 items-center gap-3 border-b border-border-default py-2 pr-1 pl-3">
        <ElementDisc
          v-if="icon && 'disc' in icon"
          :src="icon.disc"
          :element="c.element"
          :locked="icon.locked"
          size="md"
          class="shrink-0"
        />
        <GameIcon
          v-else-if="icon && 'item' in icon"
          :src="icon.item"
          :name="content.title"
          :rarity="icon.rarity ?? undefined"
          size="sm"
          eager
        />
        <ElementIcon
          v-else-if="shown.subject.kind === 'element' && c.element"
          :element="c.element"
          size="lg"
          decorative
          list
        />
        <div class="flex min-w-0 flex-1 flex-col">
          <h2 :id="labelId" class="truncate text-base leading-snug font-semibold">
            {{ content.title }}
          </h2>
          <p v-if="content.sub.length" class="flex flex-wrap gap-x-1.5 text-xs text-text-secondary">
            <template v-for="(part, i) in content.sub" :key="i">
              <span v-if="i" aria-hidden="true">·</span>
              <span>{{ part }}</span>
            </template>
          </p>
        </div>
        <UiIconButton
          v-if="shown.pinned"
          :label="$t('ui.close')"
          class="self-start"
          @click="emit('close')"
        >
          <X class="size-5" aria-hidden="true" />
        </UiIconButton>
      </div>
      <div v-if="content.attributes" class="shrink-0 px-3 pt-2.5">
        <UiSegmented
          v-model="talentTab"
          :options="tabOptions"
          :label="content.title"
          class="w-full [&>*]:flex-1"
        />
      </div>
      <div
        v-if="content.attributes && talentTab === 'attributes'"
        class="flex min-h-0 flex-col gap-2 overflow-y-auto overscroll-contain px-3 py-2.5 text-sm"
      >
        <div v-if="shown.pinned" class="flex items-center gap-1">
          <UiIconButton
            :label="$t('ui.modal.previous')"
            :disabled="attributeLevel <= 1"
            @click="stepLevel(-1)"
          >
            <ChevronLeft class="size-5" aria-hidden="true" />
          </UiIconButton>
          <span
            class="tabular flex-1 text-center font-semibold"
            :class="attributeLevel === ownLevel ? '' : 'text-accent-text'"
            aria-live="polite"
            >Lv. {{ attributeLevel }}</span
          >
          <UiIconButton
            :label="$t('ui.modal.next')"
            :disabled="attributeLevel >= MAX_TALENT_LEVEL"
            @click="stepLevel(1)"
          >
            <ChevronRight class="size-5" aria-hidden="true" />
          </UiIconButton>
        </div>
        <dl class="flex flex-col">
          <div
            v-for="row in content.attributes"
            :key="row.label"
            class="flex items-baseline gap-3 border-b border-border-default py-1.5 last:border-b-0"
          >
            <dt class="min-w-0 flex-1 text-text-secondary">{{ row.label }}</dt>
            <dd class="tabular max-w-[55%] text-right font-semibold">{{ row.value }}</dd>
          </div>
        </dl>
      </div>
      <div
        v-else-if="content.sections === undefined || content.sections.length"
        class="flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain px-3 py-2.5 text-sm leading-relaxed"
      >
        <div v-if="content.sections === undefined" class="flex flex-col gap-2" aria-hidden="true">
          <UiSkeleton class="h-4 w-full" />
          <UiSkeleton class="h-4 w-11/12" />
          <UiSkeleton class="h-4 w-2/3" />
        </div>
        <section
          v-for="(section, i) in content.sections"
          v-else
          :key="i"
          class="flex flex-col gap-1.5"
          :class="[
            section.muted ? 'text-text-muted' : '',
            section.lore ? 'border-t border-border-default pt-2.5 italic' : '',
            section.group && i ? 'mt-1 border-t border-border-default pt-2.5' : '',
          ]"
        >
          <h3 v-if="section.group" class="text-sm font-semibold text-text-primary not-italic">
            {{ section.group }}
          </h3>
          <h3 v-if="section.label" class="text-xs font-semibold text-text-secondary">
            {{ section.label }}
          </h3>
          <p v-for="(line, j) in gameTextLines(section.text)" :key="j" class="min-h-2 break-words">
            <template v-for="(run, k) in line" :key="k">
              <span
                v-if="run.color"
                class="font-semibold"
                :style="{ color: runColor(run.color) }"
                >{{ run.text }}</span
              >
              <template v-else>{{ run.text }}</template>
            </template>
          </p>
        </section>
      </div>
    </div>
  </Teleport>
</template>
