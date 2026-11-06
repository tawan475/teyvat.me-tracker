/**
 * The Planner page's model: stored targets joined with the newest snapshot
 * (current levels, talents, weapons; a state set by hand where it is ahead,
 * see hand-edits.ts) and the planner data, each goal's cost memoised
 * (`createRequirementCache`). Costs, totals, conversions and
 * estimates come from `@gdt/game-data` (planner-math, planner-goals,
 * planner-estimate); this file only shapes them for the page. Pure
 * functions; the view keeps them in computed()s.
 *
 * Goal ids: `character:Key`, `custom:<id>` (a custom character, see
 * custom-character.ts), `weapon:Key:Owner:<id>` (each weapon goal has its
 * own id, so a weapon can have several) and `item:Key`.
 *
 * A character goal may also want artifacts (artifact-goals.ts): no cost,
 * ticked from what the capture shows it wearing; a card is done when its
 * levels, talents and weapons are and its artifacts too.
 */

import type { PlannerData, PlannerMaterial, WeaponType } from '@gdt/game-data'
import {
  nextCharacterStep,
  nextWeaponStep,
  raiseForTalents,
  type NextStep,
} from '@gdt/game-data/planner-goals'
import {
  boostedTalents,
  createRequirementCache,
  emptyRequirement,
  findCharacterState,
  findWeaponState,
  isDone,
  itemGoal,
  passiveDiscount,
  planTotals,
  type CharacterState,
  type PlanGoal,
  type PlanOptions,
  type Requirement,
  type Talents,
  type WeaponState,
} from '@gdt/game-data/planner-math'
import type {
  CharacterCurrent,
  CharacterTarget,
  CustomCharacter,
  Good,
  GoodArtifact,
  ItemTarget,
  PlannerTarget,
  WeaponCurrent,
  WeaponTarget,
  plannerTargetInput,
  plannerTargetsPatch,
} from '@gdt/shared'
import type { z } from 'zod'
import { toElement, type Element } from '@/data/game-meta'
import { itemName } from '@/data/weapons'
import { t } from '@/i18n'
import { formatNumber } from '@/lib/format'
import { characterName as gameCharacterName } from '@/i18n/game-names'
import { materialName } from '@/utils/materials'
import {
  artifactProgress,
  hasArtifactGoal,
  wornBy,
  type ArtifactProgress,
  type ArtifactSlot,
} from './artifact-goals'
import { characterGoalId, customGoalId, itemGoalId, targetId, weaponGoalId } from './goal-ids'
import { characterNow, weaponNow } from './hand-edits'
import { assignWeaponCopies, type WeaponCopy } from './weapon-copies'
import { compareText } from '@/lib/search'
import { customProfile } from './custom-registry'

export type TargetInput = z.input<typeof plannerTargetInput>
export type TargetsPatch = z.input<typeof plannerTargetsPatch>
export type TargetRef = NonNullable<TargetsPatch['remove']>[number]

/** What the editor dialog is open on (`?goal=` in the URL). */
export type EditorSubject =
  | { kind: 'character'; key: string }
  | { kind: 'custom'; key: string }
  | { kind: 'weapon'; id: string }
  | { kind: 'item'; key: string }

export {
  characterGoalId,
  customGoalId,
  itemGoalId,
  newGoalId,
  parseGoalId,
  targetId,
  weaponGoalId,
} from './goal-ids'

/** A stored target as a removal. */
export function refOf(t: PlannerTarget): TargetRef {
  if (t.kind === 'weapon') return { kind: 'weapon', key: t.key, owner: t.owner, id: t.id }
  return { kind: t.kind, key: t.key }
}

/** A stored target as an upsert (to put it back). */
export function inputOf(t: PlannerTarget): TargetInput {
  if (t.kind === 'character') return { kind: 'character', key: t.key, target: t.target }
  if (t.kind === 'custom') return { kind: 'custom', key: t.key, target: t.target }
  if (t.kind === 'item') return { kind: 'item', key: t.key, target: t.target }
  return { kind: 'weapon', id: t.id, key: t.key, owner: t.owner, target: t.target }
}

export type RequirementCache = ReturnType<typeof createRequirementCache>

// ------------------------------------------------------------ goal views

export interface WeaponGoalView {
  /** `weapon:Key:Owner:<goalId>` */
  id: string
  /** The goal's own id (several goals can be one weapon). */
  goalId: string
  key: string
  owner: string
  name: string
  rarity: number | null
  type: WeaponType | null
  /** Whether a copy is in the inventory (else it starts at level 1). */
  owned: boolean
  /** The capture's state, with a hand-set one where that is ahead (`edited`). */
  current: WeaponState
  /** The capture's state alone (level 1 when not owned). */
  captured: WeaponState
  edited: boolean
  target: WeaponTarget
  requirement: Requirement | null
  /** Level, ascension and refinement reached. */
  done: boolean
}

export interface CharacterGoalView {
  /** `character:Key`, or `custom:<id>` for a custom character (`key` is then its id). */
  id: string
  key: string
  /** What a custom character is (null for a real one). */
  custom: CustomCharacter | null
  name: string
  rarity: number | null
  element: Element | null
  weapon: WeaponType | null
  owned: boolean
  /** The capture's state, with a hand-set one where that is ahead (`edited`). */
  current: CharacterState
  /** The capture's state alone (level 1 when not owned). */
  captured: CharacterState
  edited: boolean
  /** Constellation now: the capture's, or the one set by hand when higher (0 when not owned). */
  constellation: number
  /** The capture's constellation. */
  capturedConstellation: number
  /** Talent levels as the game shows them with C3/C5 (current and target). */
  boosted: { current: Talents; target: Talents }
  /** The stored target, made valid (`raiseForTalents`). */
  target: CharacterTarget
  /** The stored target as it is (the goal editor edits this one). */
  stored: CharacterTarget
  /** Ascension the stored target was raised to for its talents, else null. */
  raised: number | null
  requirement: Requirement | null
  /** Level, ascension and talents reached (artifacts aside). */
  done: boolean
  /** The artifact goal's ticks; null when it has none. */
  artifacts: ArtifactProgress | null
}

/** An extra need for one material (Seelie's custom items). */
export interface ItemGoalView {
  id: string
  key: string
  /** Null for a key the planner data doesn't know. */
  material: PlannerMaterial | null
  name: string
  target: ItemTarget
  have: number
}

/** One card on the Goals tab: a character with its weapon goals, or a weapon on its own. */
export interface GoalEntry {
  /** The character's goal id (`character:Key`, `custom:<id>`), or the weapon's on its own. */
  id: string
  character: CharacterGoalView | null
  weapons: WeaponGoalView[]
  /** Character key for the portrait (the weapon's owner on a weapon-only card). */
  owner: string
  name: string
  active: boolean
  /** Everything reached: levels, talents, weapons and artifacts. */
  done: boolean
  /** Levels, talents and weapons reached (nothing left to spend on). */
  materialsDone: boolean
  /** The character's artifact goal; null when it has none. */
  artifacts: ArtifactProgress | null
  /** The character's, or the weapon's on a weapon-only card. */
  note: string
  favorite: boolean
  /** The character's priority, or the weapon's on a weapon-only card (see `allocationOrder`). */
  priority: number | null
  element: Element | null
  weaponType: WeaponType | null
  rarity: number | null
  /** Highest AR a pending ascension of this goal needs (0 when none). */
  ar: number
}

export interface Board {
  entries: GoalEntry[]
  /** Extra item needs, by name. */
  items: ItemGoalView[]
  /** Every goal, for the totals (item needs included). */
  goals: PlanGoal[]
  characterGoals: Map<string, CharacterGoalView>
  weaponGoals: Map<string, WeaponGoalView>
}

/** A character's name (a custom one's own, custom-registry.ts). */
export function characterName(key: string): string {
  return customProfile(key)?.name ?? gameCharacterName(key)
}

/** A weapon's name (a custom one's own, custom-registry.ts). */
export function weaponName(key: string): string {
  return customProfile(key)?.name ?? itemName(key)
}

interface WornIndex {
  byLocation: Map<string, GoodArtifact[]>
  worn: Map<string, ReadonlyMap<ArtifactSlot, GoodArtifact>>
}
const wornIndexes = new WeakMap<readonly GoodArtifact[], WornIndex>()

/** What a character wears (artifact-goals.ts `wornBy`), indexed once per capture. */
export function wornByCharacter(good: Good, key: string): ReadonlyMap<ArtifactSlot, GoodArtifact> {
  let index = wornIndexes.get(good.artifacts)
  if (!index) {
    const byLocation = new Map<string, GoodArtifact[]>()
    for (const a of good.artifacts) {
      if (!a.location) continue
      const list = byLocation.get(a.location)
      if (list) list.push(a)
      else byLocation.set(a.location, [a])
    }
    index = { byLocation, worn: new Map() }
    wornIndexes.set(good.artifacts, index)
  }
  let worn = index.worn.get(key)
  if (!worn) {
    const own = index.byLocation.get(key) ?? []
    const traveler = key.startsWith('Traveler') ? (index.byLocation.get('Traveler') ?? []) : []
    worn = wornBy([...own, ...traveler], key)
    index.worn.set(key, worn)
  }
  return worn
}

/** The capture's EXP into the current level (`gi_characters`), on an owned character's state. */
function withCapturedExp(
  found: { state: CharacterState; owned: boolean },
  good: Good,
  key: string,
): { state: CharacterState; owned: boolean } {
  if (!found.owned) return found
  const extras = good.gi_characters ?? {}
  // findCharacterState stands any captured Traveler in for a Traveler goal.
  const exp = key.startsWith('Traveler')
    ? Object.entries(extras).find(([k]) => k.startsWith('Traveler'))?.[1].exp
    : extras[key]?.exp
  return exp ? { ...found, state: { ...found.state, exp } } : found
}

/**
 * A character goal as the page shows it. `planner` must know the character:
 * a custom one (`custom`) is in it through `withCustomCharacters`.
 */
export function characterGoalView(
  planner: PlannerData,
  good: Good,
  cache: RequirementCache,
  key: string,
  stored: CharacterTarget,
  override?: CharacterCurrent | null,
  custom: CustomCharacter | null = null,
): CharacterGoalView {
  const data = planner.characters.get(key)
  const found = withCapturedExp(findCharacterState(good.characters, key), good, key)
  const { state, edited } = characterNow(found.state, override)
  const owned = found.owned
  const { target, raised } = data
    ? raiseForTalents(data.ascension, stored, planner.talentAscension)
    : { target: stored, raised: null }
  const requirement = cache.character(key, state, target)
  const capturedConstellation = good.characters.find((c) => c.key === key)?.constellation ?? 0
  const constellation = Math.max(capturedConstellation, stored.constellation ?? 0)
  return {
    id: custom ? customGoalId(key) : characterGoalId(key),
    key,
    custom,
    name: custom?.name ?? characterName(key),
    rarity: data?.rarity ?? null,
    element: toElement(data?.element),
    weapon: data?.weapon ?? null,
    owned,
    current: state,
    captured: found.state,
    edited,
    constellation,
    capturedConstellation,
    boosted: {
      current: boostedTalents(planner, key, state.talents, constellation),
      target: boostedTalents(planner, key, target.talents, constellation),
    },
    target,
    stored,
    raised,
    requirement,
    done: requirement ? isDone(requirement) : false,
    artifacts: hasArtifactGoal(stored.artifacts)
      ? artifactProgress(stored.artifacts, custom ? new Map() : wornByCharacter(good, key))
      : null,
  }
}

/**
 * A weapon goal as the page shows it. `found` is the copy in the capture it
 * starts from (`assignWeaponCopies`, so two goals of a weapon don't share
 * one); without it, the one `findWeaponState` picks.
 */
export function weaponGoalView(
  planner: PlannerData,
  good: Good,
  cache: RequirementCache,
  goal: { id: string; key: string; owner: string; target: WeaponTarget },
  override?: WeaponCurrent | null,
  found: WeaponCopy = findWeaponState(good.weapons, goal.key, goal.owner),
): WeaponGoalView {
  const { key, owner, target } = goal
  const data = planner.weapons.get(key)
  const { state, edited } = weaponNow(found.state, override)
  const owned = found.owned
  const requirement = cache.weapon(key, state, target)
  return {
    id: weaponGoalId(key, owner, goal.id),
    goalId: goal.id,
    key,
    owner,
    name: weaponName(key),
    rarity: data?.rarity ?? null,
    type: data?.type ?? null,
    owned,
    current: state,
    captured: found.state,
    edited,
    target,
    requirement,
    done: (requirement ? isDone(requirement) : false) && state.refinement >= target.refinement,
  }
}

/** Hand-set current states by goal id (`character:Key`, `custom:<id>`, `weapon:Key:Owner:<id>`). */
export type Overrides = ReadonlyMap<string, CharacterCurrent | WeaponCurrent>

/**
 * Joins the targets with the capture (`good`, its characters and weapons),
 * the hand-set current states and the bag (`bag`: the capture's materials
 * with the hand edits); characters by name, done ones last. Custom
 * characters must be in `planner` (`withCustomCharacters`). `characterGoals`
 * is by character key (a custom one's id), `weaponGoals` by goal id.
 */
export function buildBoard(
  planner: PlannerData,
  good: Good,
  bag: Readonly<Record<string, number>>,
  targets: readonly PlannerTarget[],
  cache: RequirementCache,
  overrides: Overrides = new Map(),
): Board {
  const characterGoals = new Map<string, CharacterGoalView>()
  const weaponGoals = new Map<string, WeaponGoalView>()
  const items: ItemGoalView[] = []
  const weaponTargets = targets.filter(
    (t): t is Extract<PlannerTarget, { kind: 'weapon' }> => t.kind === 'weapon',
  )
  const copies = assignWeaponCopies(good.weapons, weaponTargets)
  for (const t of targets) {
    if (t.kind === 'character' || t.kind === 'custom') {
      const id = t.kind === 'custom' ? customGoalId(t.key) : characterGoalId(t.key)
      const override = overrides.get(id) as CharacterCurrent | undefined
      const custom = t.kind === 'custom' ? t.target.custom : null
      characterGoals.set(
        t.key,
        characterGoalView(planner, good, cache, t.key, t.target, override, custom),
      )
    } else if (t.kind === 'weapon') {
      const override = overrides.get(targetId(t)) as WeaponCurrent | undefined
      const view = weaponGoalView(planner, good, cache, t, override, copies.get(t.id))
      weaponGoals.set(view.id, view)
    } else {
      const material = planner.materialsByKey.get(t.key) ?? null
      items.push({
        id: itemGoalId(t.key),
        key: t.key,
        material,
        name: material?.name ?? materialName(t.key),
        target: t.target,
        have: Math.max(0, Math.trunc(bag[t.key] ?? 0)),
      })
    }
  }
  items.sort((a, b) => compareText(a.name, b.name))

  const pendingAr = (x: { done: boolean; requirement: Requirement | null }) =>
    x.done ? 0 : (x.requirement?.ar ?? 0)
  const entries: GoalEntry[] = []
  const byOwner = new Map<string, WeaponGoalView[]>()
  for (const w of weaponGoals.values()) {
    if (w.owner && characterGoals.has(w.owner)) {
      const list = byOwner.get(w.owner)
      if (list) list.push(w)
      else byOwner.set(w.owner, [w])
    } else {
      entries.push({
        id: w.id,
        character: null,
        weapons: [w],
        owner: w.owner,
        name: w.name,
        active: w.target.active,
        done: w.done,
        materialsDone: w.done,
        artifacts: null,
        note: w.target.note ?? '',
        favorite: false,
        priority: w.target.priority ?? null,
        element: null,
        weaponType: w.type,
        rarity: w.rarity,
        ar: pendingAr(w),
      })
    }
  }
  for (const c of characterGoals.values()) {
    const weapons = byOwner.get(c.key) ?? []
    const materialsDone = c.done && weapons.every((w) => w.done)
    entries.push({
      id: c.id,
      character: c,
      weapons,
      owner: c.key,
      name: c.name,
      active: c.target.active || weapons.some((w) => w.target.active),
      done: materialsDone && (c.artifacts?.complete ?? true) && !c.target.unset,
      materialsDone,
      artifacts: c.artifacts,
      note: c.target.note ?? '',
      favorite: c.target.favorite ?? false,
      priority: c.target.priority ?? null,
      element: c.element,
      weaponType: c.weapon,
      rarity: c.rarity,
      ar: Math.max(pendingAr(c), ...weapons.map(pendingAr)),
    })
  }
  entries.sort(
    (a, b) =>
      Number(a.done) - Number(b.done) ||
      Number(a.character === null) - Number(b.character === null) ||
      compareText(a.name, b.name),
  )

  const goals: PlanGoal[] = []
  for (const c of characterGoals.values()) {
    if (c.requirement) goals.push({ id: c.id, requirement: c.requirement, active: c.target.active })
  }
  for (const w of weaponGoals.values()) {
    if (w.requirement) goals.push({ id: w.id, requirement: w.requirement, active: w.target.active })
  }
  for (const i of items) goals.push(itemGoal(planner, i.key, i.target))
  return { entries, items, goals, characterGoals, weaponGoals }
}

/**
 * The order materials are handed out in (higher first): by priority, unset
 * ones last, then as the board lists them. Done cards keep their place.
 */
export function allocationOrder<E extends Pick<GoalEntry, 'priority'>>(entries: readonly E[]): E[] {
  const at = new Map(entries.map((e, i) => [e, i]))
  return [...entries].sort(
    (a, b) =>
      (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER) ||
      at.get(a)! - at.get(b)!,
  )
}

// ------------------------------------------------------------ whole subjects

/**
 * Several requirements as one (a character with its weapons): summed, with
 * each weapon's Mora passive already taken off (`owned`: the characters
 * whose passives apply), since the merged one has no weapon type.
 */
export function mergeRequirements(
  planner: PlannerData,
  list: readonly Requirement[],
  owned: ReadonlySet<string> | null,
): Requirement {
  const merged = emptyRequirement()
  merged.ar = 0
  for (const r of list) {
    for (const [key, count] of r.items) merged.items.set(key, (merged.items.get(key) ?? 0) + count)
    merged.mora += r.mora - (owned ? passiveDiscount(planner, r, owned).mora : 0)
    merged.characterExp += r.characterExp
    merged.weaponExp += r.weaponExp
    merged.ar = Math.max(merged.ar, r.ar ?? 0)
  }
  return merged
}

/** Planner options without the passives (for a merged requirement, see mergeRequirements). */
export function withoutPassives(options: PlanOptions): PlanOptions {
  return { ...options, passives: null }
}

/** A goal card's requirements as one goal (id = the entry's). */
export function entryGoal(
  planner: PlannerData,
  entry: GoalEntry,
  owned: ReadonlySet<string> | null,
): PlanGoal | null {
  const list = [entry.character, ...entry.weapons].flatMap((x) =>
    x?.requirement ? [x.requirement] : [],
  )
  if (list.length === 0) return null
  return { id: entry.id, requirement: mergeRequirements(planner, list, owned) }
}

/**
 * How many things (materials, EXP, Mora) the stock is short of for one goal
 * on its own, crafting and conversions included: 0 means it can be done now.
 */
export function shortCount(
  planner: PlannerData,
  goal: PlanGoal,
  inventory: Readonly<Record<string, number>>,
  options: PlanOptions,
): number {
  const alone = planTotals(planner, [{ ...goal, active: true }], inventory, options)
  let short = [...alone.lines.values()].filter((l) => l.missing > 0 && l.need > 0).length
  if (alone.mora.missing > 0) short++
  if (alone.characterExp.missing > 0) short++
  if (alone.weaponExp.missing > 0) short++
  return short
}

// ------------------------------------------------------------ next step

export interface NextHint {
  /** "Lv 70+ · talents 6/8/8", "Lv 80" */
  text: string
  title: string
}

/**
 * What a goal card can level right now (`nextCharacterStep` /
 * `nextWeaponStep`), when that is part of the goal but not all of it; null
 * when nothing is affordable yet or all of it is (the card shows "In stock").
 */
export function nextHint(
  planner: PlannerData,
  entry: GoalEntry,
  inventory: Readonly<Record<string, number>>,
  options: PlanOptions & { ar?: number | null },
): NextHint | null {
  if (entry.materialsDone) return null
  const parts: string[] = []
  const details: string[] = []
  const stops = new Set<'stock' | 'ar'>()
  let full = true
  const note = <S>(step: NextStep<S> | null) => {
    if (!step) {
      full = false
      return false
    }
    if (!step.full) full = false
    if (step.stop) stops.add(step.stop)
    return true
  }

  const c = entry.character
  if (c && !c.done) {
    const step = nextCharacterStep(planner, c.key, c.current, c.target, inventory, options)
    if (note(step) && step) {
      const s = step.state
      const levelUp = s.level > c.current.level || s.ascension > c.current.ascension
      const talentsUp = (['auto', 'skill', 'burst'] as const).some(
        (t) => s.talents[t] > c.current.talents[t],
      )
      // As the game shows them (C3/C5's +3 included), like the card's talent row.
      const shown = boostedTalents(planner, c.key, s.talents, c.constellation)
      const talents = `${shown.auto}/${shown.skill}/${shown.burst}`
      if (levelUp) {
        const label = levelLabel(planner, 'character', c.key, s.level, s.ascension)
        parts.push(t('planner.hint.level', { level: label }))
      }
      if (talentsUp) parts.push(t('planner.hint.talents', { talents }))
      details.push(
        t('planner.hint.characterDetail', {
          name: c.name,
          level: s.level,
          ascension: s.ascension,
          talents,
        }),
      )
    }
  }
  for (const w of entry.weapons) {
    if (w.done) continue
    const step = nextWeaponStep(planner, w.key, w.current, w.target, inventory, options)
    if (note(step) && step) {
      const label = levelLabel(planner, 'weapon', w.key, step.state.level, step.state.ascension)
      if (!c) parts.push(t('planner.hint.level', { level: label }))
      details.push(
        t('planner.hint.weaponDetail', {
          name: w.name,
          level: step.state.level,
          ascension: step.state.ascension,
        }),
      )
    }
  }
  if (details.length === 0 || full) return null
  const then = stops.has('ar')
    ? t('planner.hint.thenAr', { ar: formatNumber(entry.ar) })
    : stops.has('stock')
      ? t('planner.hint.thenShort')
      : ''
  return {
    text: parts.length ? parts.join(' · ') : t('planner.hint.weapon'),
    title: [t('planner.hint.canLevel'), ...details, then].filter(Boolean).join(' · '),
  }
}

// ------------------------------------------------------------ defaults

/** Default goal for a character: 90/6 and talents at least 9. */
export function defaultCharacterTarget(current: CharacterState): CharacterTarget {
  return {
    level: 90,
    ascension: 6,
    talents: {
      auto: Math.max(9, current.talents.auto),
      skill: Math.max(9, current.talents.skill),
      burst: Math.max(9, current.talents.burst),
    },
    active: true,
  }
}

/** Default goal for a weapon: its top level, the current refinement. */
export function defaultWeaponTarget(planner: PlannerData, key: string, current: WeaponState) {
  const weapon = planner.weapons.get(key)
  const top = (weapon?.ascension.length ?? 7) - 1
  return {
    level: weapon?.maxLevel ?? 90,
    ascension: top,
    refinement: current.refinement,
    active: true,
  } satisfies WeaponTarget
}

/** "80" or "80✦" (ascended at the cap, ready for the next band), as the game marks it. */
export function levelLabel(
  planner: PlannerData,
  kind: 'character' | 'weapon',
  key: string,
  level: number,
  ascension: number,
): string {
  const phases =
    kind === 'character'
      ? planner.characters.get(key)?.ascension
      : planner.weapons.get(key)?.ascension
  const capBelow = ascension > 0 ? phases?.[ascension - 1]?.cap : undefined
  const ascended = capBelow === level && phases?.[ascension]?.cap !== level
  return `${level}${ascended ? '✦' : ''}`
}

// ------------------------------------------------------------ writes

/** A character goal (a custom one keeps its profile) as an upsert. */
export function characterInput(
  c: Pick<CharacterGoalView, 'key' | 'custom'>,
  target: CharacterTarget & { custom?: CustomCharacter },
): TargetInput {
  const { custom: _, ...rest } = target
  return c.custom
    ? { kind: 'custom', key: c.key, target: { ...rest, custom: target.custom ?? c.custom } }
    : { kind: 'character', key: c.key, target: rest }
}

/** A weapon goal as an upsert (its own id; `owner` moves it to another character). */
export function weaponInput(
  w: Pick<WeaponGoalView, 'goalId' | 'key' | 'owner'>,
  target: WeaponTarget,
  owner = w.owner,
): TargetInput {
  return { kind: 'weapon', id: w.goalId, key: w.key, owner, target }
}

/** Every goal on a card, as removals. */
export function entryRefs(entry: GoalEntry): TargetRef[] {
  const refs: TargetRef[] = []
  const c = entry.character
  if (c) refs.push(c.custom ? { kind: 'custom', key: c.key } : { kind: 'character', key: c.key })
  for (const w of entry.weapons) {
    refs.push({ kind: 'weapon', key: w.key, owner: w.owner, id: w.goalId })
  }
  return refs
}

/** Every goal on a card with `patch` applied to its stored target (active, priority…). */
export function entryInputs(
  entry: GoalEntry,
  patch: { active?: boolean; priority?: number },
): TargetInput[] {
  const list: TargetInput[] = []
  const c = entry.character
  if (c) list.push(characterInput(c, { ...c.stored, ...patch }))
  for (const w of entry.weapons) {
    // On a character's card the card's order is the character's.
    const own = c ? { ...patch, priority: w.target.priority } : patch
    list.push(weaponInput(w, { ...w.target, ...own }))
  }
  return list
}

/** Mora for `exp` character EXP points (planner-math's rounding: up, after 3 decimals). */
const expMora = (exp: number, rate: number) => Math.ceil(Math.round(exp * rate * 1000) / 1000)

/** The largest character EXP book (Hero's Wit), null when the data has none. */
export function heroBook(planner: PlannerData) {
  return planner.expItems.character.at(-1) ?? null
}

/** Character EXP points as whole largest books (Hero's Wit), rounded up. */
export function wholeBooks(planner: PlannerData, exp: number): number {
  const book = heroBook(planner)
  return book && exp > 0 ? Math.ceil(exp / book.exp) : 0
}

/**
 * `requirement` with its character EXP rounded up to whole Hero's Wit and
 * the Mora for those books (user's rule, 2026-11-07: the Planner never
 * lists Adventurer's Experience or Wanderer's Advice for a remainder).
 */
export function roundedToBooks<R extends Requirement | null>(
  planner: PlannerData,
  requirement: R,
): R {
  const book = heroBook(planner)
  if (!book || !requirement || requirement.characterExp % book.exp === 0) return requirement
  const rate = planner.moraPerExp.character
  const exp = wholeBooks(planner, requirement.characterExp) * book.exp
  const mora = requirement.mora - expMora(requirement.characterExp, rate) + expMora(exp, rate)
  return { ...requirement, characterExp: exp, mora }
}

/**
 * The requirement cache with each character goal's EXP in whole Hero's Wit
 * (`roundedToBooks`). Each requirement maps to one rounded object.
 */
export function inWholeBooks(cache: RequirementCache, planner: PlannerData): RequirementCache {
  const rounded = new WeakMap<Requirement, Requirement>()
  const round = (requirement: Requirement | null) => {
    if (!requirement) return requirement
    let out = rounded.get(requirement)
    if (!out) {
      out = roundedToBooks(planner, requirement)
      rounded.set(requirement, out)
    }
    return out
  }
  return {
    character: (key, current, target) => round(cache.character(key, current, target)),
    weapon: (key, current, target) => cache.weapon(key, current, target),
  }
}

/**
 * The requirement cache with ascension gemstones left out of every cost (the
 * Planner setting "Gemstones" off). Each requirement maps to one stripped
 * object, so a card whose cost did not change keeps its object.
 */
export function withoutGems(cache: RequirementCache, planner: PlannerData): RequirementCache {
  const isGem = (key: string) => planner.materialsByKey.get(key)?.kind === 'gem'
  const stripped = new WeakMap<Requirement, Requirement>()
  const strip = (requirement: Requirement | null) => {
    if (!requirement || ![...requirement.items.keys()].some(isGem)) return requirement
    let out = stripped.get(requirement)
    if (!out) {
      out = {
        ...requirement,
        items: new Map([...requirement.items].filter(([key]) => !isGem(key))),
      }
      stripped.set(requirement, out)
    }
    return out
  }
  return {
    character: (key, current, target) => strip(cache.character(key, current, target)),
    weapon: (key, current, target) => strip(cache.weapon(key, current, target)),
  }
}
