<script setup lang="ts">
import { materialName } from '@/utils/materials'
import type { PlannerData } from '@gdt/game-data'
import { boostedTalents, type PlanGoal } from '@gdt/game-data/planner-math'
import { computed } from 'vue'
import {
  ArrowRight,
  Check,
  ChevronUp,
  CircleArrowUp,
  Eye,
  EyeOff,
  GripVertical,
  PencilLine,
  Star,
} from 'lucide-vue-next'
import NamecardBackdrop from '@/components/characters/NamecardBackdrop.vue'
import GameIcon from '@/components/ui/GameIcon.vue'
import MaterialIcon from '@/components/materials-page/MaterialIcon.vue'
import {
  artifactSetIcon,
  characterBanner,
  characterIcon,
  gameIcon,
  materialIcon,
  weaponIcon,
} from '@/lib/assets'
import { t } from '@/i18n'
import { formatCompact, formatNumber } from '@/lib/format'
import { formatSetName } from '@/utils/artifact-stats'
import { plannerWeaponIcon } from './custom-registry'
import { characterParts, weaponPart, type DonePart } from './done'
import { ARTIFACTS_LEFT, GOAL_UNSET, READINESS } from './farm-format'
import GoalPortrait from './GoalPortrait.vue'
import { fromTouch, useItemPopover } from './item-popover'
import { expName, type FocusChip } from './material-filter'
import { materialSoft } from './material-soft'
import { levelLabel, type GoalEntry, type NextHint, type WeaponGoalView } from './model'
import type { GoalNeeds, NeedChip } from './needs'
import type { PartReady } from './upgrade'

/**
 * One goal on the Goals tab: a character (Level, Talents) with its weapon
 * goals, or a weapon on its own. The header leads with a large portrait
 * (GoalPortrait: rarity, element, constellation) over the character's
 * namecard, then the name and the card's readiness: ready with every goal,
 * ready on its own, or short. Each part reads current → goal and has a
 * Done (it spends the materials, see DoneDialog); a part set by hand shows
 * the pencil, and one the bag can level now a mark (upgrade.ts: the whole
 * part, or its next step). Under them, what the goal is still short of as
 * tappable chips (the inventory editor). While the Goals tab shows the
 * goals using a material (`focus`), its chips lead, ringed, with what this
 * goal needs of it and how short it is. An artifact goal is a row of its
 * own (sets still farmed, slots done; it opens the editor's Artifacts tab).
 * The header opens the editor; the star marks a favorite, the eye counts
 * it in the totals or not.
 *
 * In priority order (`order`) a handle with the card's place leads the
 * header: drag it (mouse, finger) or use the arrow keys on it. While
 * selecting (`selecting`), the header picks the card instead of opening it.
 */
const props = defineProps<{
  entry: GoalEntry
  planner: PlannerData
  /** The account's Adventure Rank, when set. */
  ar: number | null
  /** What can be levelled now, when only part of the goal can. */
  hint: NextHint | null
  /** The parts the bag can level now, by Done part id (null: none). */
  parts?: ReadonlyMap<string, PartReady> | null
  /** Readiness and missing materials (null for a done goal). */
  needs: GoalNeeds | null
  /** The card's cost as one goal, for the inventory editor's "Goal" counts. */
  goal: PlanGoal | null
  /** The material filter's chips: what this goal needs of it (null: no filter). */
  focus?: readonly FocusChip[] | null
  /** Its place in priority order, while the list is in that order (it can be dragged). */
  order?: { rank: number; dragging: boolean; over: boolean } | null
  /** Picking cards for a bulk change. */
  selecting?: boolean
  selected?: boolean
}>()
const emit = defineEmits<{
  /** Open the editor (on a tab: the Artifacts row). */
  open: [tab?: 'artifacts']
  select: []
  grab: [event: PointerEvent]
  nudge: [event: KeyboardEvent]
  toggle: []
  favorite: []
  /** A part's Done, with how the card reads it ("Talents", "6/8/8", "9/9/9"). */
  done: [part: DonePart, text: { label: string; from: string; to: string }]
}>()
const openItem = useItemPopover()

const c = computed(() => props.entry.character)

/** "AR 50" when a pending ascension needs more than the account has. */
const arShort = computed(() =>
  props.ar !== null && props.entry.ar > props.ar ? props.entry.ar : 0,
)

const level = (
  kind: 'character' | 'weapon',
  key: string,
  s: { level: number; ascension: number },
) => levelLabel(props.planner, kind, key, s.level, s.ascension)
const talentText = (n: { auto: number; skill: number; burst: number }) =>
  `${n.auto}/${n.skill}/${n.burst}`

interface Row {
  id: string
  kind: 'level' | 'talents' | 'weapon'
  label: string
  /** Weapon rows: the weapon. */
  weapon?: WeaponGoalView
  from: string
  to: string | null
  title: string
  edited: boolean
  part: DonePart | null
  /** The bag can level it now: all of it, or its next step. */
  ready: PartReady | null
}

const rows = computed<Row[]>(() => {
  const list: Row[] = []
  const ch = c.value
  if (ch) {
    const parts = characterParts(props.planner, ch)
    const levelPart = parts.find((p) => p.kind === 'level') ?? null
    const talentPart = parts.find((p) => p.kind === 'talents') ?? null
    const now = ch.owned || ch.edited ? level('character', ch.key, ch.current) : '–'
    list.push({
      id: `${ch.id}|level`,
      kind: 'level',
      label: t('planner.card.level'),
      from: now,
      to: levelPart ? level('character', ch.key, ch.target) : null,
      title: t('planner.card.levelTitle', {
        from: ch.current.level,
        fromAscension: ch.current.ascension,
        to: ch.target.level,
        toAscension: ch.target.ascension,
      }),
      edited: ch.edited && pairDiffers(ch.current, ch.captured),
      part: levelPart,
      ready: readyOf(levelPart),
    })
    // As the game shows them: C3/C5's +3 included (the levels bought stay in the tooltip).
    const boosted = talentText(ch.boosted.current) !== talentText(ch.current.talents)
    const next = talentPart ? (talentPart.next.current as typeof ch.current).talents : null
    list.push({
      id: `${ch.id}|talents`,
      kind: 'talents',
      label: t('planner.card.talents'),
      from: talentText(ch.boosted.current),
      to: next ? talentText(boostedTalents(props.planner, ch.key, next, ch.constellation)) : null,
      title: boosted
        ? `${t('planner.card.talentsTitle')} · ${t('planner.card.boosted', {
            talents: talentText(ch.current.talents),
            constellation: ch.constellation,
          })}`
        : t('planner.card.talentsTitle'),
      edited:
        ch.edited &&
        (['auto', 'skill', 'burst'] as const).some(
          (k) => ch.current.talents[k] !== ch.captured.talents[k],
        ),
      part: talentPart,
      ready: readyOf(talentPart),
    })
  }
  for (const w of props.entry.weapons) {
    const part = weaponPart(props.planner, w)
    const refine = w.target.refinement > w.current.refinement
    const lv = w.target.level > w.current.level || w.target.ascension > w.current.ascension
    const now = w.owned || w.edited ? level('weapon', w.key, w.current) : '–'
    list.push({
      id: w.id,
      kind: 'weapon',
      label: w.name,
      weapon: w,
      from: `${now} · R${w.current.refinement}`,
      to: part
        ? `${lv ? level('weapon', w.key, w.target) : now} · R${refine ? w.target.refinement : w.current.refinement}`
        : null,
      title: t('planner.card.weaponTitle', {
        name: w.name,
        from: w.current.level,
        fromAscension: w.current.ascension,
        to: w.target.level,
        toAscension: w.target.ascension,
        fromRefinement: w.current.refinement,
        toRefinement: w.target.refinement,
      }),
      edited: w.edited,
      part,
      ready: readyOf(part),
    })
  }
  return list
})

function readyOf(part: DonePart | null): PartReady | null {
  return (part && props.parts?.get(part.id)) ?? null
}

const readyTitle = (ready: PartReady) =>
  ready === 'full' ? t('planner.card.readyFull') : t('planner.card.readyStep')

function pairDiffers(
  a: { level: number; ascension: number },
  b: { level: number; ascension: number },
) {
  return a.level !== b.level || a.ascension !== b.ascension
}

const portrait = computed(() => {
  const ch = c.value
  if (ch)
    return {
      src: ch.custom ? (ch.custom.image ?? '') : characterIcon(ch.key),
      name: ch.name,
      rarity: ch.rarity,
      element: ch.element,
      tag: ch.owned || ch.constellation ? `C${ch.constellation}` : '',
      tagTitle: t('planner.card.constellation', { n: ch.constellation }),
      banner: ch.custom ? (ch.custom.banner ?? '') : characterBanner(ch.key),
    }
  const w = props.entry.weapons[0]!
  return {
    src: plannerWeaponIcon(w.key, w.target.ascension),
    name: w.name,
    rarity: w.rarity,
    element: null,
    tag: `R${w.current.refinement}`,
    tagTitle: t('planner.card.refinement', { n: w.current.refinement }),
    banner: '',
  }
})

const status = computed(() => {
  const e = props.entry
  // A Custom goal that asks nothing yet (else its readiness as usual).
  if (e.character?.target.unset && e.materialsDone && !e.artifacts) return GOAL_UNSET
  if (e.done) return READINESS.done
  if (e.materialsDone && e.artifacts) return ARTIFACTS_LEFT
  return props.needs ? READINESS[props.needs.status] : null
})

/** The artifact row: the sets still farmed (else all), slots done. */
const artifacts = computed(() => {
  const a = props.entry.artifacts
  if (!a) return null
  const sets = a.open.length ? a.open : a.sets.map((s) => s.key)
  const names = sets.map(formatSetName)
  return {
    sets: sets.slice(0, 3),
    done: a.done,
    complete: a.complete,
    title: [t('planner.card.artifactsTitle', { done: a.done }), names.join(', ')]
      .filter(Boolean)
      .join(' · '),
  }
})

const chipIcon = (chip: NeedChip) =>
  chip.key === props.planner.mora.key ? materialIcon('Mora') : gameIcon(chip.material.icon)
const chipTitle = (chip: NeedChip) => {
  const name = chip.exp
    ? t('planner.card.expSuffix', { name: materialName(chip.material.key) })
    : materialName(chip.material.key)
  return t('planner.card.amount', { name, n: shortText(chip.count, chip.status === 'alone') })
}
const shortText = (n: number, after: boolean) =>
  after
    ? t('planner.card.shortAfter', { n: formatNumber(n) })
    : t('planner.card.short', { n: formatNumber(n) })

/** The missing chips the focus chips don't already show. */
const chips = computed(() => {
  const list = props.needs?.chips ?? []
  const focus = props.focus
  if (!focus?.length) return list
  const shown = new Set(focus.map((f) => `${f.material.key}|${f.exp ?? ''}`))
  return list.filter((c) => !shown.has(`${c.key}|${c.exp ?? ''}`))
})

function focusTitle(f: FocusChip): string {
  const amount = f.exp
    ? t('planner.card.expAmount', {
        exp: expName(f.exp),
        points: formatNumber(f.points ?? 0),
        item: t('farm.craft.item', {
          count: formatNumber(f.count),
          name: materialName(f.material.key),
        }),
      })
    : t('planner.card.amount', { name: materialName(f.material.key), n: formatNumber(f.count) })
  const state =
    f.status === 'all' ? t('planner.card.enoughAfter') : shortText(f.short, f.status === 'alone')
  return `${amount} · ${state}`
}

function openChip(chip: Pick<NeedChip, 'key'>, event: MouseEvent) {
  openItem?.({
    key: chip.key,
    anchor: event.currentTarget as HTMLElement,
    touch: fromTouch(event),
    context: props.goal ? { label: props.entry.name, requirement: props.goal.requirement } : null,
  })
}

const activeLabel = computed(() =>
  props.entry.active ? t('planner.common.counted') : t('planner.common.notCounted'),
)
</script>

<template>
  <!-- content-visibility: cards off screen skip layout and paint (100 goals on a phone). -->
  <article
    class="flex w-full flex-col rounded-xl border bg-surface-raised shadow-sm transition-[color,border-color,opacity] [contain-intrinsic-size:auto_18rem] [content-visibility:auto]"
    :class="[
      order?.over && !order.dragging
        ? 'border-accent-text ring-2 ring-accent/30'
        : selected
          ? 'border-accent-text'
          : 'border-border-default hover:border-border-strong',
      order?.dragging ? 'opacity-50' : '',
    ]"
    :data-goal-card="entry.id"
  >
    <div class="relative overflow-hidden rounded-t-xl">
      <NamecardBackdrop
        v-if="portrait.banner"
        :src="portrait.banner"
        lazy
        class="absolute inset-y-0 right-0 h-full w-4/5 opacity-30 [mask-image:linear-gradient(to_left,black_30%,transparent_95%)] dark:opacity-20"
      />
      <div class="relative flex items-stretch gap-1 p-3 pr-1.5" :class="order ? 'pl-1' : ''">
        <button
          v-if="order"
          type="button"
          class="-my-1 inline-flex w-8 shrink-0 cursor-grab touch-none flex-col items-center justify-center gap-0.5 self-stretch rounded-md text-text-muted transition-colors select-none hover:bg-surface-overlay hover:text-text-primary active:cursor-grabbing"
          :data-goal-handle="entry.id"
          :aria-label="$t('planner.card.handleLabel', { name: entry.name, rank: order.rank })"
          :title="$t('planner.card.handleTitle', { rank: order.rank })"
          @pointerdown="emit('grab', $event)"
          @keydown="emit('nudge', $event)"
        >
          <span class="tabular font-mono text-xs">{{ order.rank }}</span>
          <GripVertical class="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          :aria-haspopup="selecting ? undefined : 'dialog'"
          :aria-pressed="selecting ? selected : undefined"
          class="flex min-w-0 flex-1 items-center gap-3 text-left"
          :class="entry.active ? '' : 'opacity-50'"
          @click="selecting ? emit('select') : emit('open')"
        >
          <GoalPortrait
            :src="portrait.src"
            :name="portrait.name"
            :rarity="portrait.rarity"
            :element="portrait.element"
            :tag="portrait.tag"
            :tag-title="portrait.tagTitle"
            :custom="!!c?.custom"
            :picked="selecting ? !!selected : null"
          />
          <span class="flex min-w-0 flex-1 flex-col items-start gap-1.5">
            <span
              class="line-clamp-2 font-display text-lg leading-tight font-semibold break-words"
              >{{ entry.name }}</span
            >
            <span class="flex flex-wrap items-center gap-1.5">
              <span
                v-if="status"
                class="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs font-medium"
                :class="status.badge"
                :title="status.meaning"
              >
                <span class="size-2 rounded-full" :class="status.dot" aria-hidden="true" />
                {{ status.label }}
              </span>
              <span
                v-if="c?.custom"
                class="text-xs text-text-muted"
                :title="$t('planner.card.customTitle')"
                >{{ $t('planner.card.custom') }}</span
              >
            </span>
          </span>
        </button>
        <div class="flex shrink-0 flex-col items-center justify-center gap-0.5">
          <button
            v-if="c"
            type="button"
            class="inline-flex size-9 items-center justify-center rounded-md transition-colors hover:bg-surface-overlay"
            :class="entry.favorite ? 'text-rarity-5' : 'text-text-muted hover:text-text-primary'"
            :aria-pressed="entry.favorite"
            :aria-label="$t('planner.card.favoriteLabel', { name: entry.name })"
            :title="entry.favorite ? $t('planner.card.favorite') : $t('planner.card.notFavorite')"
            @click="emit('favorite')"
          >
            <Star
              class="size-5"
              :fill="entry.favorite ? 'currentColor' : 'none'"
              aria-hidden="true"
            />
          </button>
          <button
            type="button"
            class="inline-flex size-9 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-overlay hover:text-text-primary"
            :aria-pressed="entry.active"
            :aria-label="$t('planner.common.nameState', { name: entry.name, state: activeLabel })"
            :title="activeLabel"
            @click="emit('toggle')"
          >
            <Eye v-if="entry.active" class="size-5" aria-hidden="true" />
            <EyeOff v-else class="size-5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>

    <ul
      class="flex flex-col border-t border-border-subtle"
      :class="entry.active ? '' : 'opacity-60'"
    >
      <li
        v-for="row in rows"
        :key="row.id"
        class="flex min-h-11 items-center gap-2 px-3 py-1"
        :title="row.title"
      >
        <GameIcon
          v-if="row.weapon"
          :src="plannerWeaponIcon(row.weapon.key, Math.max(row.weapon.current.ascension, 2))"
          :name="row.weapon.name"
          :rarity="row.weapon.rarity ?? undefined"
          size="xs"
        />
        <span v-else class="w-16 shrink-0 text-sm text-text-muted">{{ row.label }}</span>
        <span class="flex min-w-0 flex-1 flex-col">
          <span v-if="row.weapon" class="truncate text-sm text-text-secondary">{{
            row.weapon.name
          }}</span>
          <span class="tabular flex min-w-0 flex-wrap items-center gap-x-1 font-mono text-sm">
            <span :class="row.to ? 'text-text-secondary' : ''">{{ row.from }}</span>
            <PencilLine
              v-if="row.edited"
              class="size-3.5 text-accent-text"
              :aria-label="$t('planner.card.setByHand')"
              role="img"
            />
            <template v-if="row.to">
              <ArrowRight class="size-3.5 text-text-muted" aria-hidden="true" />
              <span class="font-semibold">{{ row.to }}</span>
            </template>
            <span
              v-if="row.kind === 'level' && row.to && arShort"
              class="ml-1 text-xs text-warning-text"
              :title="$t('planner.card.needsAr', { ar: arShort })"
              >{{ $t('farm.lock.ar', { ar: arShort }) }}</span
            >
          </span>
        </span>
        <button
          v-if="row.part"
          type="button"
          class="relative ml-auto inline-flex min-h-9 shrink-0 items-center gap-1 rounded-lg border border-border-strong px-2.5 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-overlay hover:text-text-primary"
          :aria-label="
            row.ready
              ? $t('planner.card.doneReadyLabel', {
                  name: entry.name,
                  label: row.label,
                  ready: readyTitle(row.ready),
                })
              : $t('planner.card.doneLabel', { name: entry.name, label: row.label })
          "
          :title="row.ready ? readyTitle(row.ready) : undefined"
          @click="emit('done', row.part, { label: row.label, from: row.from, to: row.to ?? '' })"
        >
          <Check class="size-4" aria-hidden="true" />
          {{ $t('planner.done.confirm') }}
          <span
            v-if="row.ready"
            class="absolute -top-2 -right-2 inline-flex rounded-full bg-surface-raised text-success-text shadow-sm ring-1 ring-border-default"
            aria-hidden="true"
          >
            <CircleArrowUp v-if="row.ready === 'full'" class="size-4" />
            <ChevronUp v-else class="size-4" />
          </span>
        </button>
        <Check
          v-else
          class="ml-auto size-4 shrink-0 text-success-text"
          :aria-label="$t('farm.readiness.done.meaning')"
          role="img"
        />
      </li>
      <li v-if="artifacts" class="flex">
        <button
          type="button"
          class="flex min-h-11 w-full items-center gap-2 px-3 py-1 text-left transition-colors hover:bg-surface-overlay"
          :title="artifacts.title"
          :aria-label="$t('planner.common.nameState', { name: entry.name, state: artifacts.title })"
          @click="emit('open', 'artifacts')"
        >
          <span class="w-16 shrink-0 text-sm text-text-muted">{{
            $t('planner.artifacts.title')
          }}</span>
          <span class="flex min-w-0 flex-1 items-center gap-1">
            <GameIcon
              v-for="set in artifacts.sets"
              :key="set"
              :src="artifactSetIcon(set)"
              :name="formatSetName(set)"
              :rarity="5"
              size="xs"
            />
          </span>
          <span
            class="tabular font-mono text-sm"
            :class="artifacts.complete ? 'text-success-text' : 'text-text-secondary'"
            >{{ artifacts.done }}/5</span
          >
          <Check
            v-if="artifacts.complete"
            class="size-4 shrink-0 text-success-text"
            aria-hidden="true"
          />
        </button>
      </li>
    </ul>

    <div
      v-if="(focus && focus.length) || chips.length"
      class="border-t border-border-subtle px-3 py-2.5"
    >
      <ul
        class="flex flex-wrap gap-1.5"
        :aria-label="$t('planner.card.missing', { name: entry.name })"
      >
        <li v-for="f in focus ?? []" :key="`focus:${f.material.key}`">
          <component
            :is="openItem ? 'button' : 'span'"
            :type="openItem ? 'button' : undefined"
            class="flex items-center gap-1 rounded-lg border border-accent-text py-0.5 pr-1.5 pl-0.5 ring-2 ring-accent/25"
            :class="openItem ? 'transition-colors hover:bg-surface-overlay' : ''"
            :title="focusTitle(f)"
            :aria-haspopup="openItem ? 'dialog' : undefined"
            data-focus-chip
            @click="openChip({ key: f.material.key }, $event)"
          >
            <span
              class="size-8 overflow-hidden rounded-md text-[0.625rem]"
              :class="materialSoft(f.material.key, f.material.rarity)"
            >
              <MaterialIcon :src="gameIcon(f.material.icon)" :name="materialName(f.material.key)" />
            </span>
            <span class="tabular font-mono text-sm font-semibold text-text-primary">{{
              formatCompact(f.count)
            }}</span>
            <span
              v-if="f.status !== 'all'"
              class="tabular font-mono text-xs font-semibold"
              :class="f.status === 'short' ? 'text-danger-text' : 'text-warning-text'"
              aria-hidden="true"
              >−{{ formatCompact(f.short) }}</span
            >
            <Check v-else class="size-3.5 text-success-text" aria-hidden="true" />
            <span class="sr-only">{{ focusTitle(f) }}</span>
          </component>
        </li>
        <li v-for="chip in chips" :key="chip.key">
          <component
            :is="openItem ? 'button' : 'span'"
            :type="openItem ? 'button' : undefined"
            class="flex items-center gap-1 rounded-lg border py-0.5 pr-1.5 pl-0.5"
            :class="[
              chip.status === 'short' ? 'border-danger-border' : 'border-amber-500/40',
              openItem ? 'transition-colors hover:bg-surface-overlay' : '',
            ]"
            :title="chipTitle(chip)"
            :aria-haspopup="openItem ? 'dialog' : undefined"
            @click="openChip(chip, $event)"
          >
            <span
              class="size-8 overflow-hidden rounded-md text-[0.625rem]"
              :class="materialSoft(chip.material.key, chip.material.rarity)"
            >
              <MaterialIcon :src="chipIcon(chip)" :name="materialName(chip.material.key)" />
            </span>
            <span
              class="tabular font-mono text-sm font-semibold"
              :class="chip.status === 'short' ? 'text-danger-text' : 'text-warning-text'"
              >{{ formatCompact(chip.count) }}</span
            >
            <span class="sr-only">{{ chipTitle(chip) }}</span>
          </component>
        </li>
      </ul>
    </div>

    <p
      v-if="hint"
      class="flex items-center gap-1.5 border-t border-border-subtle px-3 py-2 text-xs text-success-text"
      :title="hint.title"
    >
      <CircleArrowUp class="size-3.5 shrink-0" aria-hidden="true" />
      <span class="truncate">{{ $t('planner.card.canDoNow', { text: hint.text }) }}</span>
      <span class="sr-only">({{ hint.title }})</span>
    </p>

    <p
      v-if="entry.note"
      class="line-clamp-2 border-t border-border-subtle px-3 py-2 text-xs break-words text-text-muted"
    >
      {{ entry.note }}
    </p>
  </article>
</template>
