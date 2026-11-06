/**
 * The goal editor's level and talent rules, pure:
 *
 * - `levelGrid`: the one-click level buttons, a level and ascension each,
 *   as the game marks them: 1, 20, 20✦, 40, 40✦ … 90, where 20✦ is level
 *   20 ascended (ready for 40). A character has 14; a 1-2★ weapon stops at
 *   70;
 * - `goalAtLeast` / `weaponGoalAtLeast`: Seelie's rule that setting "now"
 *   past the goal moves the goal up with it;
 * - `talentGap`: the goal's talents need an ascension its level doesn't
 *   have (talent level L needs `planner.talentAscension[L-1]`: 2 needs A2,
 *   3-4 A3, 5-6 A4, 7-8 A5, 9-10 A6), and the level button that allows it.
 */

import type { AscensionPhase } from '@gdt/game-data'
import {
  ascensionForTalent,
  levelMilestones,
  normalizeLevel,
  TALENTS,
  type CharacterState,
  type TalentName,
  type WeaponState,
} from '@gdt/game-data/planner-math'

export interface LevelStep {
  level: number
  ascension: number
  /** "20", "20✦" */
  label: string
  /** Ascended at this level's cap (the ✦). */
  ascended: boolean
}

type Pair = { level: number; ascension: number }

/** The level buttons for an ascension table (from `levelMilestones`). */
export function levelGrid(phases: readonly AscensionPhase[]): LevelStep[] {
  return levelMilestones(phases).map((m) => {
    const ascended = m.ascension > 0 && phases[m.ascension - 1]?.cap === m.level
    return { ...m, ascended, label: `${m.level}${ascended ? '✦' : ''}` }
  })
}

/** The button a pair is (a pair between buttons counts as the one below it). */
export function stepIndex(grid: readonly LevelStep[], pair: Pair): number {
  let found = -1
  grid.forEach((s, i) => {
    if (!pairAbove(s, pair)) found = i
  })
  return found
}

/**
 * The buttons as `pair` really is: a level between two buttons (a capture's
 * 71) shows on the one below it as 71, not as its 70✦ (picking it still
 * picks that button's step).
 */
export function shownSteps(grid: readonly LevelStep[], pair: Pair): LevelStep[] {
  const chosen = stepIndex(grid, pair)
  return grid.map((step, index) =>
    index === chosen && pair.level !== step.level
      ? { level: pair.level, ascension: pair.ascension, ascended: false, label: `${pair.level}` }
      : step,
  )
}

/** Whether `a` is past `b`: a higher phase, or the same phase at a higher level. */
export function pairAbove(a: Pair, b: Pair): boolean {
  return a.ascension > b.ascension || (a.ascension === b.ascension && a.level > b.level)
}

/** A character goal raised to "now" where now is past it (level pair, each talent). */
export function goalAtLeast<T extends CharacterState>(target: T, now: CharacterState): T {
  const pair = pairAbove(now, target) ? now : target
  const talents = { ...target.talents }
  for (const t of TALENTS) talents[t] = Math.max(talents[t], now.talents[t])
  return { ...target, level: pair.level, ascension: pair.ascension, talents }
}

/** A weapon goal raised to "now" where now is past it (level pair, refinement). */
export function weaponGoalAtLeast<T extends WeaponState>(target: T, now: WeaponState): T {
  const pair = pairAbove(now, target) ? now : target
  return {
    ...target,
    level: pair.level,
    ascension: pair.ascension,
    refinement: Math.max(target.refinement, now.refinement),
  }
}

export interface TalentGap {
  /** The ascension the talents need. */
  ascension: number
  /** The talents that need it. */
  talents: TalentName[]
  /** The lowest level pair with that ascension, from the goal's level (the fix). */
  level: Pair
}

/** Talents set past what the level's ascension allows (null when they fit). */
export function talentGap(
  phases: readonly AscensionPhase[],
  target: CharacterState,
  table: readonly number[],
): TalentGap | null {
  const top = phases.length - 1
  const need = (t: TalentName) => Math.min(top, ascensionForTalent(target.talents[t], table))
  const ascension = Math.max(...TALENTS.map(need))
  if (ascension <= target.ascension) return null
  return {
    ascension,
    talents: TALENTS.filter((t) => need(t) > target.ascension),
    level: normalizeLevel(phases, target.level, ascension),
  }
}

/** A talent level stepped by `delta` (or typed), kept within 1-10. */
export function clampTalent(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.min(10, Math.trunc(value))) : 1
}
