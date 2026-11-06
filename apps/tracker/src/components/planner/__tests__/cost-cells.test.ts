import { decodePlanner } from '@gdt/game-data'
import plannerJson from '@gdt/game-data/data/planner.json'
import type { PlannerFile } from '@gdt/game-data/format'
import { emptyRequirement, type PlanGoal } from '@gdt/game-data/planner-math'
import { describe, expect, it } from 'vitest'
import { costCells, stockCounts } from '../cost-cells'

const planner = decodePlanner(plannerJson as unknown as PlannerFile)

const requirement = (items: Record<string, number>, extra = {}) => ({
  ...emptyRequirement(),
  items: new Map(Object.entries(items)),
  ...extra,
})

describe('the cost legend', () => {
  it('counts the tiles of each colour', () => {
    const others: PlanGoal[] = [{ id: 'other', requirement: requirement({ Valberry: 5 }) }]
    const cells = costCells({
      planner,
      // Wolfhook: plenty; Valberry: enough alone, not with the other goal; Cecilia: short.
      requirements: [requirement({ Wolfhook: 5, Valberry: 5, Cecilia: 5 }, { mora: 1000 })],
      others,
      inventory: { Wolfhook: 100, Valberry: 7, Cecilia: 2, Mora: 0 },
      options: {},
    })
    expect(cells.map((c) => [c.key, c.status])).toEqual([
      ['Cecilia', 'short'],
      ['Valberry', 'alone'],
      ['Wolfhook', 'all'],
      ['Mora', 'short'],
    ])
    expect(stockCounts(cells)).toEqual({ all: 1, alone: 1, short: 2 })
  })

  it('is all zeros for nothing to spend', () => {
    expect(stockCounts([])).toEqual({ all: 0, alone: 0, short: 0 })
    const cells = costCells({
      planner,
      requirements: [requirement({})],
      others: [],
      inventory: {},
      options: {},
    })
    expect(cells).toEqual([])
  })
})

describe('character EXP in the cost', () => {
  it("is whole Hero's Wit only, every book held counting as Hero's Wit", () => {
    const cells = costCells({
      planner,
      // 4,890,000 EXP: 244.5 Hero's Wit.
      requirements: [requirement({}, { characterExp: 4_890_000 })],
      others: [],
      inventory: { HerosWit: 10, AdventurersExperience: 9, WanderersAdvice: 7 },
      options: {},
    })
    expect(cells.map((c) => c.key)).toEqual(['HerosWit'])
    // 200,000 + 45,000 + 7,000 EXP held = 12 Hero's Wit.
    expect(cells[0]).toMatchObject({ count: 245, have: 12, status: 'short' })
  })
})
