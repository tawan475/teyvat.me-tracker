/**
 * "Done" on a goal part (Level, Talents, a weapon), pure: what the part
 * costs from the current state (`doneParts`), and what that takes out of the
 * bag (`doneCost`), the way the planner's own totals count it:
 *
 * - craftable families cascade: a tier short of its need is crafted from
 *   three of the tier below (and that one from below it), so the lower tiers
 *   are what is taken, with the crafting Mora;
 * - Dream Solvent conversions (and Dust of Azoth, ore forging when those
 *   are on) take the materials and currency they use;
 * - EXP is taken as books (Hero's Wit, Adventurer's Experience, Wanderer's
 *   Advice) and weapon EXP as ores, largest first, the smallest that covers
 *   the rest last (`spendExp`);
 * - whatever the bag can't cover is `short`: Done still takes what there is
 *   (the count never goes below 0), so a goal levelled in game with
 *   materials the planner didn't know about can still be marked.
 */

import type { ExpItem, PlannerData } from '@gdt/game-data'
import { craftingSteps, type PlanStep } from '@gdt/game-data/planner-convert'
import {
  TALENTS,
  characterRequirement,
  expItemMix,
  isDone,
  planTotals,
  weaponRequirement,
  type PlanOptions,
  type Requirement,
} from '@gdt/game-data/planner-math'
import type { CharacterCurrent, InventoryChange, WeaponCurrent } from '@gdt/shared'
import {
  heroBook,
  roundedToBooks,
  wholeBooks,
  type CharacterGoalView,
  type WeaponGoalView,
} from './model'

type Bag = Readonly<Record<string, number>>

const held = (bag: Bag) => (key: string) => Math.max(0, Math.trunc(bag[key] ?? 0))

function add(map: Map<string, number>, key: string, n: number) {
  if (n > 0) map.set(key, (map.get(key) ?? 0) + n)
}

// ------------------------------------------------------------------- EXP

/**
 * EXP points as the items held: the largest as often as it fits without
 * going over, then the next; what is left (less than one of any item still
 * held) is covered by the smallest items first, which may go over. `items`
 * smallest first, as `planner.expItems` lists them. `short` is the EXP the
 * bag can't cover.
 */
export function spendExp(
  exp: number,
  items: readonly ExpItem[],
  have: (key: string) => number,
): { use: Map<string, number>; short: number } {
  const use = new Map<string, number>()
  let rest = Math.max(0, exp)
  for (let i = items.length - 1; i >= 0 && rest > 0; i--) {
    const item = items[i]!
    const n = Math.min(have(item.material.key), Math.floor(rest / item.exp))
    if (n > 0) {
      add(use, item.material.key, n)
      rest -= n * item.exp
    }
  }
  for (const item of items) {
    if (rest <= 0) break
    const left = have(item.material.key) - (use.get(item.material.key) ?? 0)
    const n = Math.min(left, Math.ceil(rest / item.exp))
    if (n > 0) {
      add(use, item.material.key, n)
      rest -= n * item.exp
    }
  }
  return { use, short: Math.max(0, rest) }
}

// ------------------------------------------------------------------- cost

export interface DoneCost {
  /** Taken from the bag, by GOOD key. */
  take: Map<string, number>
  /** What the bag can't cover, by GOOD key (EXP as the items to farm). */
  short: Map<string, number>
  /** Crafts, conversions and forging the cost assumes, in the order to do them. */
  steps: PlanStep[]
}

/** What a requirement takes out of `bag` (crafting, conversions, EXP items, Mora). */
export function doneCost(
  planner: PlannerData,
  requirement: Requirement,
  bag: Bag,
  options: PlanOptions = {},
): DoneCost {
  const have = held(bag)
  const totals = planTotals(planner, [{ id: 'done', requirement }], bag, options)
  const take = new Map<string, number>()
  const short = new Map<string, number>()

  for (const line of totals.lines.values()) {
    // Spent on the need, on crafting the tier above and on conversions; less
    // what crafting and conversions made of it (those never were in the bag).
    const used =
      line.need + line.spent + (line.convertedAway ?? 0) - line.crafted - (line.converted ?? 0)
    add(take, line.material.key, Math.min(line.have, Math.max(0, used)))
    add(short, line.material.key, line.missing)
  }
  if (totals.solvent) add(take, totals.solvent.key, totals.solvent.used)
  if (totals.azoth) add(take, totals.azoth.key, totals.azoth.used)

  const books = spendExp(requirement.characterExp, planner.expItems.character, have)
  for (const [key, n] of books.use) add(take, key, n)
  // What is short, as whole Hero's Wit only (model.ts `inWholeBooks`).
  const hero = heroBook(planner)
  if (hero && books.short > 0) add(short, hero.material.key, wholeBooks(planner, books.short))

  // Ore forged from chunks (when that is on) is used before it ever is in the bag.
  const forge = totals.forge
  const forged = forge?.count ?? 0
  for (const input of forge?.inputs ?? []) add(take, input.key, input.count)
  const ores = spendExp(requirement.weaponExp, planner.expItems.weapon, (key) =>
    key === forge?.ore.key ? have(key) + forged : have(key),
  )
  for (const [key, n] of ores.use) add(take, key, key === forge?.ore.key ? n - forged : n)
  for (const item of expItemMix(ores.short, planner.expItems.weapon)) {
    add(short, item.material.key, item.count)
  }

  add(take, planner.mora.key, Math.min(totals.mora.have, totals.mora.need))
  add(short, planner.mora.key, totals.mora.missing)
  return { take, short, steps: craftingSteps(planner, totals) }
}

/** The bag changes that take `cost` out (or, `undo`, put it back). */
export function costChanges(cost: Pick<DoneCost, 'take'>, undo = false): InventoryChange[] {
  return [...cost.take].map(([key, n]) => ({ key, add: undo ? n : -n }))
}

// ------------------------------------------------------------------- parts

export type DonePartKind = 'level' | 'talents' | 'weapon'

/** A Done's new current state for one goal (a full state; only what is ahead of the capture counts). */
export type DoneState =
  | { kind: 'character' | 'custom'; key: string; current: CharacterCurrent }
  | { kind: 'weapon'; id: string; key: string; owner: string; current: WeaponCurrent }

export interface DonePart {
  /** `${goal id}|${kind}` */
  id: string
  kind: DonePartKind
  /** The goal: `character:Key`, `custom:<id>` or `weapon:Key:Owner:<id>`. */
  goal: string
  requirement: Requirement
  /** The current state once done: the goal's for this part, the rest as it is. */
  next: DoneState
}

/**
 * What is left of a character goal, by part: Level (level and ascension;
 * the target already raised to what its talents need) and Talents (all
 * three). Each part costs from the current state, so doing both in either
 * order costs what the whole goal does.
 */
export function characterParts(planner: PlannerData, c: CharacterGoalView): DonePart[] {
  const parts: DonePart[] = []
  const now = c.current
  const target = c.target
  if (
    target.ascension > now.ascension ||
    (target.ascension === now.ascension && target.level > now.level)
  ) {
    const to = { level: target.level, ascension: target.ascension, talents: { ...now.talents } }
    const requirement = roundedToBooks(
      planner,
      characterRequirement(planner, c.key, now, to, { talentCaps: false }),
    )
    if (requirement && !isDone(requirement)) {
      parts.push({
        id: `${c.id}|level`,
        kind: 'level',
        goal: c.id,
        requirement,
        next: { kind: c.custom ? 'custom' : 'character', key: c.key, current: to },
      })
    }
  }
  if (TALENTS.some((t) => target.talents[t] > now.talents[t])) {
    const talents = { ...now.talents }
    for (const t of TALENTS) talents[t] = Math.max(now.talents[t], target.talents[t])
    const to = { level: now.level, ascension: now.ascension, talents }
    const requirement = roundedToBooks(
      planner,
      characterRequirement(planner, c.key, now, to, { talentCaps: false }),
    )
    if (requirement && !isDone(requirement)) {
      parts.push({
        id: `${c.id}|talents`,
        kind: 'talents',
        goal: c.id,
        requirement,
        next: { kind: c.custom ? 'custom' : 'character', key: c.key, current: to },
      })
    }
  }
  return parts
}

/** A weapon goal as one part (level, ascension and refinement); none once it is reached. */
export function weaponPart(planner: PlannerData, w: WeaponGoalView): DonePart | null {
  if (w.done) return null
  const requirement = weaponRequirement(planner, w.key, w.current, w.target)
  if (!requirement) return null
  const ahead =
    w.target.ascension > w.current.ascension ||
    (w.target.ascension === w.current.ascension && w.target.level > w.current.level)
  return {
    id: `${w.id}|weapon`,
    kind: 'weapon',
    goal: w.id,
    requirement,
    next: {
      kind: 'weapon',
      id: w.goalId,
      key: w.key,
      owner: w.owner,
      current: {
        level: ahead ? w.target.level : w.current.level,
        ascension: ahead ? w.target.ascension : w.current.ascension,
        refinement: Math.max(w.current.refinement, w.target.refinement),
      },
    },
  }
}
