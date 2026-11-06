import { decodePlanner } from '@gdt/game-data'
import plannerJson from '@gdt/game-data/data/planner.json'
import type { PlannerFile } from '@gdt/game-data/format'
import { describe, expect, it } from 'vitest'
import {
  clampTalent,
  goalAtLeast,
  levelGrid,
  shownSteps,
  stepIndex,
  talentGap,
  weaponGoalAtLeast,
} from '../level-grid'
import { levelLabel } from '../model'

const planner = decodePlanner(plannerJson as unknown as PlannerFile)
const huTao = planner.characters.get('HuTao')!.ascension
const table = planner.talentAscension

describe('level grid', () => {
  it('has the 14 buttons a character levels through, ascended ones starred', () => {
    const grid = levelGrid(huTao)
    expect(grid.map((s) => s.label)).toEqual([
      '1',
      '20',
      '20✦',
      '40',
      '40✦',
      '50',
      '50✦',
      '60',
      '60✦',
      '70',
      '70✦',
      '80',
      '80✦',
      '90',
    ])
    // 20✦ is level 20 ascended once (ready for 40); 90 is the last phase.
    expect(grid[2]).toEqual({ level: 20, ascension: 1, ascended: true, label: '20✦' })
    expect(grid[1]).toEqual({ level: 20, ascension: 0, ascended: false, label: '20' })
    expect(grid.at(-1)).toMatchObject({ level: 90, ascension: 6 })
  })

  it('stops at 70 for 1-2★ weapons', () => {
    const grid = levelGrid(planner.weapons.get('SilverSword')!.ascension)
    expect(grid.at(-1)!.label).toBe('70')
    expect(grid.map((s) => s.label)).not.toContain('80')
    expect(levelGrid(planner.weapons.get('StaffOfHoma')!.ascension)).toHaveLength(14)
  })

  it('finds the button for a pair, a pair between buttons on the one below it', () => {
    const grid = levelGrid(huTao)
    expect(grid[stepIndex(grid, { level: 80, ascension: 6 })]!.label).toBe('80✦')
    expect(grid[stepIndex(grid, { level: 80, ascension: 5 })]!.label).toBe('80')
    expect(grid[stepIndex(grid, { level: 85, ascension: 6 })]!.label).toBe('80✦')
    expect(grid[stepIndex(grid, { level: 1, ascension: 0 })]!.label).toBe('1')
  })

  it('labels levels the same way on the cards', () => {
    expect(levelLabel(planner, 'character', 'HuTao', 80, 6)).toBe('80✦')
    expect(levelLabel(planner, 'character', 'HuTao', 80, 5)).toBe('80')
    expect(levelLabel(planner, 'character', 'HuTao', 90, 6)).toBe('90')
  })
})

describe('now past the goal moves the goal', () => {
  const goal = { level: 80, ascension: 5, talents: { auto: 6, skill: 9, burst: 9 }, active: true }

  it('raises the level pair and each talent to now, keeping the rest', () => {
    const now = { level: 80, ascension: 6, talents: { auto: 8, skill: 6, burst: 9 } }
    expect(goalAtLeast(goal, now)).toEqual({
      level: 80,
      ascension: 6,
      talents: { auto: 8, skill: 9, burst: 9 },
      active: true,
    })
    const below = { level: 40, ascension: 1, talents: { auto: 1, skill: 1, burst: 1 } }
    expect(goalAtLeast(goal, below)).toEqual(goal)
  })

  it('does the same for a weapon, refinement included', () => {
    const sword = { level: 70, ascension: 4, refinement: 1, active: false }
    expect(weaponGoalAtLeast(sword, { level: 70, ascension: 5, refinement: 3 })).toEqual({
      level: 70,
      ascension: 5,
      refinement: 3,
      active: false,
    })
  })
})

describe('talents and ascension', () => {
  it('says which talents need more ascension than the goal level, and the level that allows them', () => {
    const goal = { level: 70, ascension: 4, talents: { auto: 6, skill: 9, burst: 7 } }
    expect(talentGap(huTao, goal, table)).toEqual({
      ascension: 6,
      talents: ['skill', 'burst'],
      level: { level: 80, ascension: 6 },
    })
    expect(
      talentGap(huTao, { ...goal, talents: { auto: 6, skill: 6, burst: 6 } }, table),
    ).toBeNull()
    // Talent 2 already needs A2 (20✦ is A1): the game's table, not the caps.
    const low = { level: 20, ascension: 1, talents: { auto: 2, skill: 1, burst: 1 } }
    expect(talentGap(huTao, low, table)).toMatchObject({
      ascension: 2,
      level: { level: 40, ascension: 2 },
    })
  })

  it('keeps typed talent levels within 1-10', () => {
    expect(clampTalent(0)).toBe(1)
    expect(clampTalent(11)).toBe(10)
    expect(clampTalent(7.6)).toBe(7)
    expect(clampTalent(Number.NaN)).toBe(1)
  })
})

describe('the now grid', () => {
  it('shows a level between two buttons as it is (71, not 70✦)', () => {
    const grid = levelGrid(huTao)
    const shown = shownSteps(grid, { level: 71, ascension: 5 })
    const at = stepIndex(grid, { level: 71, ascension: 5 })
    expect(grid[at]!.label).toBe('70✦')
    expect(shown[at]).toMatchObject({ level: 71, ascension: 5, label: '71', ascended: false })
    // Only that button changes; a level on a button shows as the button.
    expect(shown.filter((s, i) => s !== grid[i])).toHaveLength(1)
    expect(shownSteps(grid, { level: 70, ascension: 5 })).toEqual(grid)
  })
})
