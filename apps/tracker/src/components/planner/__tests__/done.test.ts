import { decodePlanner } from '@gdt/game-data'
import plannerJson from '@gdt/game-data/data/planner.json'
import type { PlannerFile } from '@gdt/game-data/format'
import {
  characterRequirement,
  createRequirementCache,
  emptyRequirement,
  type Requirement,
} from '@gdt/game-data/planner-math'
import type { Good } from '@gdt/shared'
import { describe, expect, it } from 'vitest'
import { characterParts, costChanges, doneCost, spendExp, weaponPart } from '../done'
import { characterGoalView, inWholeBooks, weaponGoalView } from '../model'

const planner = decodePlanner(plannerJson as unknown as PlannerFile)
// As the Planner costs: character EXP in whole Hero's Wit.
const cache = inWholeBooks(createRequirementCache(planner), planner)
const book = planner.expItems.character
const ore = planner.expItems.weapon
const craftMora = (key: string, tier: number) =>
  planner.materialsByKey.get(key)!.family!.craftMora[tier - 1]!

const requirement = (items: Record<string, number>, extra: Partial<Requirement> = {}) => ({
  ...emptyRequirement(),
  items: new Map(Object.entries(items)),
  ...extra,
})
const entries = (map: Map<string, number>) => Object.fromEntries([...map].sort())

describe('EXP as the items held', () => {
  const bag = (counts: Record<string, number>) => (key: string) => counts[key] ?? 0

  it('takes the largest that fit, then covers the rest with the smallest', () => {
    const held = bag({ HerosWit: 2, AdventurersExperience: 5, WanderersAdvice: 10 })
    expect(entries(spendExp(25_000, book, held).use)).toEqual({
      AdventurersExperience: 1,
      HerosWit: 1,
    })
    // 21,500 from two Wits and one Advice: the last 500 needs a whole Wit.
    const few = spendExp(21_500, book, bag({ HerosWit: 2, WanderersAdvice: 1 }))
    expect(entries(few.use)).toEqual({ HerosWit: 2, WanderersAdvice: 1 })
    expect(few.short).toBe(0)
  })

  it('says how much EXP the bag cannot cover', () => {
    const result = spendExp(
      50_000,
      book,
      bag({ HerosWit: 1, AdventurersExperience: 2, WanderersAdvice: 3 }),
    )
    expect(entries(result.use)).toEqual({
      AdventurersExperience: 2,
      HerosWit: 1,
      WanderersAdvice: 3,
    })
    expect(result.short).toBe(17_000)
  })

  it('splits weapon EXP across Mystic, Fine and plain ore', () => {
    const held = bag({ MysticEnhancementOre: 2, FineEnhancementOre: 1, EnhancementOre: 10 })
    expect(entries(spendExp(23_000, ore, held).use)).toEqual({
      EnhancementOre: 3,
      FineEnhancementOre: 1,
      MysticEnhancementOre: 2,
    })
  })
})

describe('what a Done takes out of the bag', () => {
  // Hu Tao's skill 1 -> 3: 3 Teachings, 2 Guides, 6 Whopperflower and 3 Shimmering Nectar.
  const now = { level: 80, ascension: 6, talents: { auto: 1, skill: 1, burst: 1 } }
  const skill3 = characterRequirement(
    planner,
    'HuTao',
    now,
    { ...now, talents: { auto: 1, skill: 3, burst: 1 } },
    { talentCaps: false },
  )!

  it('crafts what a tier is short of from the tier below, and takes those', () => {
    expect(entries(skill3.items)).toEqual({
      GuideToDiligence: 2,
      ShimmeringNectar: 3,
      TeachingsOfDiligence: 3,
      WhopperflowerNectar: 6,
    })
    const bag = {
      TeachingsOfDiligence: 9,
      WhopperflowerNectar: 20,
      ShimmeringNectar: 1,
      Mora: 1_000_000,
    }
    const cost = doneCost(planner, skill3, bag)
    const crafting =
      2 * craftMora('TeachingsOfDiligence', 1) + 2 * craftMora('WhopperflowerNectar', 1)
    expect(entries(cost.take)).toEqual({
      Mora: skill3.mora + crafting,
      ShimmeringNectar: 1,
      TeachingsOfDiligence: 9, // 3 for the talent, 6 crafted into the 2 Guides
      WhopperflowerNectar: 12, // 6 + 6 crafted into 2 Shimmering
    })
    expect(cost.short.size).toBe(0)
    expect(cost.steps.map((s) => (s.kind === 'craft' ? `${s.to.key} ${s.count}` : s.kind))).toEqual(
      expect.arrayContaining(['GuideToDiligence 2', 'ShimmeringNectar 2']),
    )
    expect(costChanges(cost)).toContainEqual({ key: 'TeachingsOfDiligence', add: -9 })
    expect(costChanges(cost, true)).toContainEqual({ key: 'TeachingsOfDiligence', add: 9 })
  })

  it('cascades a top-tier shortfall down two tiers, and reports what is still short', () => {
    const cost = doneCost(planner, requirement({ PhilosophiesOfDiligence: 2 }), {
      GuideToDiligence: 2,
      TeachingsOfDiligence: 9,
    })
    // One Philosophies from 3 Guides: the 2 held and one from 3 Teachings.
    expect(entries(cost.take)).toEqual({ GuideToDiligence: 2, TeachingsOfDiligence: 3 })
    const mora = craftMora('TeachingsOfDiligence', 1) + craftMora('TeachingsOfDiligence', 2)
    expect(entries(cost.short)).toEqual({ Mora: mora, PhilosophiesOfDiligence: 1 })
  })

  it('converts weekly boss materials with Dream Solvent', () => {
    const boss = planner.weeklyBosses.find((b) => b.items.length === 3 && b.solvent > 0)!
    const [wanted, spare] = boss.items
    const cost = doneCost(planner, requirement({ [wanted!.key]: 2 }), {
      [spare!.key]: 3,
      [planner.items.dreamSolvent]: 5,
    })
    expect(entries(cost.take)).toEqual(
      Object.fromEntries(
        [
          [spare!.key, 2],
          [planner.items.dreamSolvent, 2 * boss.solvent],
        ].sort(),
      ),
    )
    expect(cost.short.size).toBe(0)
  })

  it('takes EXP as books and ores, and names the missing ones', () => {
    const cost = doneCost(planner, requirement({}, { characterExp: 50_000, weaponExp: 23_000 }), {
      HerosWit: 1,
      AdventurersExperience: 2,
      WanderersAdvice: 3,
      MysticEnhancementOre: 2,
      FineEnhancementOre: 1,
      EnhancementOre: 10,
    })
    expect(entries(cost.take)).toEqual({
      AdventurersExperience: 2,
      EnhancementOre: 3,
      FineEnhancementOre: 1,
      HerosWit: 1,
      MysticEnhancementOre: 2,
      WanderersAdvice: 3,
    })
    // 17,000 EXP short: one Hero's Wit (never the smaller books).
    expect(entries(cost.short)).toEqual({ HerosWit: 1 })
  })

  it('counts ore forged from chunks before it is ever in the bag', () => {
    const cost = doneCost(
      planner,
      requirement({}, { weaponExp: 20_000 }),
      { CrystalChunk: 8, Mora: 1000 },
      { forge: true },
    )
    const recipe = planner.forge.find((r) => r.input === 'CrystalChunk')!
    expect(entries(cost.take)).toEqual({ CrystalChunk: 8, Mora: 2 * recipe.mora })
    expect(cost.short.size).toBe(0)
  })
})

describe('Done parts of a goal', () => {
  const good: Good = {
    format: 'GOOD',
    version: 3,
    source: 'test',
    characters: [
      {
        key: 'HuTao',
        level: 70,
        constellation: 0,
        ascension: 4,
        talent: { auto: 6, skill: 6, burst: 6 },
      },
    ],
    weapons: [
      { key: 'StaffOfHoma', level: 40, ascension: 1, refinement: 1, location: 'HuTao', lock: true },
    ],
    artifacts: [],
    materials: {},
  }
  const target = {
    level: 90,
    ascension: 6,
    talents: { auto: 9, skill: 9, burst: 9 },
    active: true,
  }

  it('splits a character goal into Level and Talents that add up to the whole', () => {
    const view = characterGoalView(planner, good, cache, 'HuTao', target)
    const parts = characterParts(planner, view)
    expect(parts.map((p) => p.kind)).toEqual(['level', 'talents'])
    const [level, talents] = parts
    expect(level!.next).toEqual({
      kind: 'character',
      key: 'HuTao',
      current: { level: 90, ascension: 6, talents: { auto: 6, skill: 6, burst: 6 } },
    })
    expect(talents!.next.current).toEqual({
      level: 70,
      ascension: 4,
      talents: { auto: 9, skill: 9, burst: 9 },
    })
    const whole = view.requirement!
    const sum = new Map<string, number>()
    for (const p of parts) {
      for (const [k, n] of p.requirement.items) sum.set(k, (sum.get(k) ?? 0) + n)
    }
    expect(entries(sum)).toEqual(entries(whole.items))
    expect(level!.requirement.mora + talents!.requirement.mora).toBe(whole.mora)
    expect(level!.requirement.characterExp).toBe(whole.characterExp)
  })

  it('drops a part once its current state reaches the goal (a hand-set one too)', () => {
    const view = characterGoalView(planner, good, cache, 'HuTao', target, {
      level: 90,
      ascension: 6,
      talents: { auto: 6, skill: 6, burst: 6 },
    })
    expect(view.edited).toBe(true)
    expect(characterParts(planner, view).map((p) => p.kind)).toEqual(['talents'])
  })

  it('makes a weapon goal one part, refinement included', () => {
    const sword = { level: 90, ascension: 6, refinement: 2, active: true }
    const goal = { id: 'staff01', key: 'StaffOfHoma', owner: 'HuTao', target: sword }
    const view = weaponGoalView(planner, good, cache, goal)
    const part = weaponPart(planner, view)!
    expect(part.next).toEqual({
      kind: 'weapon',
      id: 'staff01',
      key: 'StaffOfHoma',
      owner: 'HuTao',
      current: { level: 90, ascension: 6, refinement: 2 },
    })
    expect(part.requirement.weaponExp).toBeGreaterThan(0)
    const reached = weaponGoalView(planner, good, cache, goal, {
      level: 90,
      ascension: 6,
      refinement: 2,
    })
    expect(weaponPart(planner, reached)).toBeNull()
  })
})
