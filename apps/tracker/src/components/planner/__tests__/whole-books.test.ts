import { decodePlanner } from '@gdt/game-data'
import plannerJson from '@gdt/game-data/data/planner.json'
import type { PlannerFile } from '@gdt/game-data/format'
import { characterRequirement, createRequirementCache } from '@gdt/game-data/planner-math'
import type { Good } from '@gdt/shared'
import { describe, expect, it } from 'vitest'
import { characterGoalView, inWholeBooks, roundedToBooks } from '../model'

const planner = decodePlanner(plannerJson as unknown as PlannerFile)
const talents = { auto: 1, skill: 6, burst: 6 }
const goal = { level: 90, ascension: 6, talents, active: true }

/** A synthetic capture: Valeriy at Lv. 71, 6,825 EXP into the level. */
const good = {
  format: 'GOOD',
  version: 2,
  source: 'test',
  characters: [{ key: 'Valeriy', level: 71, constellation: 0, ascension: 5, talent: talents }],
  weapons: [],
  artifacts: [],
  materials: {},
  gi_characters: { Valeriy: { exp: 6825 } },
} as unknown as Good

describe("character EXP in whole Hero's Wit", () => {
  it('rounds the EXP up to whole books and charges the Mora for those books', () => {
    const exact = characterRequirement(
      planner,
      'Valeriy',
      { level: 71, ascension: 5, talents },
      goal,
    )!
    const rounded = roundedToBooks(planner, exact)!
    expect(exact.characterExp % 20_000).not.toBe(0)
    expect(rounded.characterExp).toBe(Math.ceil(exact.characterExp / 20_000) * 20_000)
    // Mora: 1 per 5 EXP fed, so 4,000 a book.
    expect(rounded.mora - exact.mora).toBe((rounded.characterExp - exact.characterExp) / 5)
    expect(roundedToBooks(planner, rounded)).toBe(rounded)
  })

  it("counts from the capture's level and its EXP into it, not the phase's button", () => {
    const cache = inWholeBooks(createRequirementCache(planner), planner)
    const view = characterGoalView(planner, good, cache, 'Valeriy', goal)
    expect(view.current).toMatchObject({ level: 71, ascension: 5, exp: 6825 })
    // 71 -> 90 is 4,896,825 EXP; 6,825 held: 4,890,000 = 244.5 -> 245 Hero's Wit.
    expect(view.requirement!.characterExp).toBe(245 * 20_000)
    const from70 = characterGoalView(
      planner,
      { ...good, characters: [{ ...good.characters[0]!, level: 70 }], gi_characters: {} },
      cache,
      'Valeriy',
      goal,
    )
    expect(from70.requirement!.characterExp).toBe(252 * 20_000)
  })
})
