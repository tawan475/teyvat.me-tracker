import { decodePlanner } from '@gdt/game-data'
import plannerJson from '@gdt/game-data/data/planner.json'
import type { PlannerFile } from '@gdt/game-data/format'
import {
  NEW_CHARACTER,
  characterRequirement,
  createRequirementCache,
} from '@gdt/game-data/planner-math'
import type { CustomCharacter, Good, PlannerTarget } from '@gdt/shared'
import { customKeySchema } from '@gdt/shared'
import { describe, expect, it } from 'vitest'
import {
  customChoices,
  familyName,
  gemFamily,
  isCustomKey,
  newCustomKey,
  releasedCharacter,
  releasedSwaps,
  replaceCustom,
  withCustomCharacters,
} from '../custom-character'
import { buildBoard } from '../model'

const planner = decodePlanner(plannerJson as unknown as PlannerFile)

/** Hu Tao's materials, as a custom character. */
const likeHuTao: CustomCharacter = {
  name: 'Nova',
  rarity: 5,
  element: 'Pyro',
  weapon: 'polearm',
  book: 'TeachingsOfDiligence',
  common: 'WhopperflowerNectar',
  boss: 'JuvenileJade',
  local: 'SilkFlower',
  weekly: 'ShardOfAFoulLegacy',
}
const max = { level: 90, ascension: 6, talents: { auto: 10, skill: 10, burst: 10 } }
const sorted = (items: Map<string, number>) => [...items].sort(([a], [b]) => a.localeCompare(b))

describe('custom characters', () => {
  it('get ids that are never GOOD keys', () => {
    const key = newCustomKey()
    expect(customKeySchema.safeParse(key).success).toBe(true)
    expect(isCustomKey(key)).toBe(true)
    expect(isCustomKey('HuTao')).toBe(false)
  })

  it('cost what a real character with the same materials does', () => {
    const p = withCustomCharacters(planner, [['cnova0001', likeHuTao]])
    expect(p.characters.get('cnova0001')).toMatchObject({
      rarity: 5,
      element: 'Pyro',
      weapon: 'polearm',
    })
    const mine = characterRequirement(p, 'cnova0001', NEW_CHARACTER, max)!
    const real = characterRequirement(planner, 'HuTao', NEW_CHARACTER, max)!
    expect(sorted(mine.items)).toEqual(sorted(real.items))
    expect(mine.mora).toBe(real.mora)
    expect(mine.characterExp).toBe(real.characterExp)
    expect(mine.ar).toBe(real.ar)
  })

  it('leave materials not chosen yet out of the cost', () => {
    const unknown: CustomCharacter = { name: 'Soon', rarity: 4, element: 'Hydro', weapon: 'bow' }
    const p = withCustomCharacters(planner, [['csoon0001', unknown]])
    const r = characterRequirement(p, 'csoon0001', NEW_CHARACTER, max)!
    const kinds = new Set([...r.items.keys()].map((k) => planner.materialsByKey.get(k)!.kind))
    // The element's gems and the crown are known; books, drops and specialties are not.
    expect([...kinds].sort()).toEqual(['crown', 'gem'])
    expect([...r.items.keys()].some((k) => k.startsWith('VarunadaLazurite'))).toBe(true)
    expect(r.mora).toBeGreaterThan(0)
  })

  it('leave the planner data as it is when there are none', () => {
    expect(withCustomCharacters(planner, [])).toBe(planner)
    expect(planner.characters.has('cnova0001')).toBe(false)
  })

  it('choose materials from the game lists', () => {
    const choices = customChoices(planner)
    expect(choices.books.length).toBeGreaterThan(10)
    expect(choices.books.every((f) => f.kind === 'book')).toBe(true)
    expect(choices.commons.some((f) => f.key === 'WhopperflowerNectar')).toBe(true)
    expect(choices.bosses.some((m) => m.key === 'JuvenileJade')).toBe(true)
    expect(choices.locals.some((m) => m.key === 'SilkFlower')).toBe(true)
    expect(choices.weeklies.some((m) => m.key === 'ShardOfAFoulLegacy')).toBe(true)
    // Newest first.
    expect(choices.bosses[0]!.id).toBeGreaterThan(choices.bosses.at(-1)!.id)
    const freedom = choices.books.find((f) => f.key === 'TeachingsOfFreedom')!
    expect(familyName(freedom)).toBe('Freedom')
    expect(gemFamily(planner, 'Pyro')?.key).toBe('AgnidusAgateSliver')
  })

  it('show on the board with their name and the weapon goals made for them', () => {
    const target = { ...max, active: true, custom: likeHuTao }
    const targets: PlannerTarget[] = [
      { kind: 'custom', key: 'cnova0001', owner: '', target, updatedAt: 1 },
      {
        kind: 'weapon',
        id: 'spear01',
        key: 'StaffOfHoma',
        owner: 'cnova0001',
        target: { level: 90, ascension: 6, refinement: 1, active: true },
        updatedAt: 1,
      },
    ]
    const good: Good = {
      format: 'GOOD',
      version: 3,
      source: 't',
      characters: [],
      weapons: [],
      artifacts: [],
      materials: {},
    }
    const p = withCustomCharacters(planner, [['cnova0001', likeHuTao]])
    const board = buildBoard(p, good, {}, targets, createRequirementCache(p))
    expect(board.entries).toHaveLength(1)
    const [entry] = board.entries
    expect(entry).toMatchObject({
      id: 'custom:cnova0001',
      name: 'Nova',
      element: 'pyro',
      rarity: 5,
    })
    expect(entry!.character!.custom).toEqual(likeHuTao)
    expect(entry!.weapons.map((w) => w.key)).toEqual(['StaffOfHoma'])
    expect(board.goals.map((g) => g.id)).toEqual([
      'custom:cnova0001',
      'weapon:StaffOfHoma:cnova0001:spear01',
    ])
  })

  it('are replaced by the real character, goals and weapon goals kept', () => {
    const target = { ...max, active: false, note: 'leaks', priority: 2, custom: likeHuTao }
    const now = { level: 20, ascension: 1, talents: { auto: 1, skill: 2, burst: 1 } }
    const sword = { level: 90, ascension: 6, refinement: 1, active: true }
    const result = replaceCustom(
      'cnova0001',
      target,
      'Arlecchino',
      [{ goalId: 'spear01', key: 'StaffOfHoma', target: sword }],
      now,
    )
    expect(result).toEqual({
      remove: [{ kind: 'custom', key: 'cnova0001' }],
      upsert: [
        {
          kind: 'character',
          key: 'Arlecchino',
          target: { ...max, active: false, note: 'leaks', priority: 2 },
        },
        { kind: 'weapon', id: 'spear01', key: 'StaffOfHoma', owner: 'Arlecchino', target: sword },
      ],
      current: [{ kind: 'character', key: 'Arlecchino', current: now }],
    })
    expect(replaceCustom('cnova0001', target, 'Arlecchino', [], null).current).toEqual([])
  })
})

describe('released custom characters', () => {
  /** A pre-release preset of Valeriy (some materials not known yet). */
  const valeriy: CustomCharacter = {
    name: 'Valeriy',
    rarity: 4,
    element: 'Electro',
    weapon: 'sword',
    book: 'TeachingsOfGlory',
  }

  it('are found by name, rarity, element and weapon type', () => {
    expect(releasedCharacter(planner, valeriy)).toBe('Valeriy')
    expect(releasedCharacter(planner, { ...valeriy, name: '  valeriy ' })).toBe('Valeriy')
    expect(releasedCharacter(planner, { ...likeHuTao, name: 'Hu Tao' })).toBe('HuTao')
    expect(releasedCharacter(planner, { ...valeriy, element: 'Cryo' })).toBeNull()
    expect(releasedCharacter(planner, { ...valeriy, rarity: 5 })).toBeNull()
    expect(releasedCharacter(planner, { ...valeriy, weapon: 'bow' })).toBeNull()
    expect(releasedCharacter(planner, likeHuTao)).toBeNull()
  })

  it('are found by the name the site shows too', () => {
    const shown = (key: string) => (key === 'Valeriy' ? 'Валерий' : key)
    expect(releasedCharacter(planner, { ...valeriy, name: 'Валерий' }, shown)).toBe('Valeriy')
    expect(releasedCharacter(planner, { ...valeriy, name: 'Валерий' })).toBeNull()
  })

  it('swap for the real one once the capture has it, unless it is a goal already', () => {
    const customs = [['cvaleriy001', valeriy] as const]
    const owned = new Set(['Valeriy'])
    expect(releasedSwaps(planner, customs, owned, new Set())).toEqual([
      { key: 'cvaleriy001', real: 'Valeriy' },
    ])
    expect(releasedSwaps(planner, customs, new Set(), new Set())).toEqual([])
    expect(releasedSwaps(planner, customs, owned, new Set(['Valeriy']))).toEqual([])
    const twice = [...customs, ['cvaleriy002', valeriy] as const]
    expect(releasedSwaps(planner, twice, owned, new Set())).toHaveLength(1)
  })

  it('start from the capture once swapped (was Lv. 1 while custom)', () => {
    const good = {
      format: 'GOOD',
      version: 2,
      source: 'test',
      characters: [
        {
          key: 'Valeriy',
          level: 71,
          constellation: 0,
          ascension: 5,
          talent: { auto: 1, skill: 6, burst: 6 },
        },
      ],
      weapons: [],
      artifacts: [],
      materials: {},
    } as unknown as Good
    const goal = { ...max, talents: { auto: 9, skill: 9, burst: 9 }, active: true }
    const p = withCustomCharacters(planner, [['cvaleriy001', valeriy]])
    const before = buildBoard(
      p,
      good,
      {},
      [
        { kind: 'custom', key: 'cvaleriy001', target: { ...goal, custom: valeriy } },
      ] as PlannerTarget[],
      createRequirementCache(p),
    )
    expect(before.characterGoals.get('cvaleriy001')?.current.level).toBe(1)
    const [swap] = releasedSwaps(p, [['cvaleriy001', valeriy]], new Set(['Valeriy']), new Set())
    const r = replaceCustom('cvaleriy001', { ...goal, custom: valeriy }, swap!.real, [], null)
    const after = buildBoard(
      planner,
      good,
      {},
      r.upsert as PlannerTarget[],
      createRequirementCache(planner),
    )
    expect(after.characterGoals.get('Valeriy')?.current).toMatchObject({ level: 71, ascension: 5 })
  })
})
