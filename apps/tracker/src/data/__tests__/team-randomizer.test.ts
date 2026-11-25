import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RULES,
  MAX_FIVE_STARS,
  NO_FILTERS,
  TEAM_COUNT,
  TEAM_SIZE,
  buildPool,
  emptySlots,
  fillTeams,
  hasFilters,
  passes,
  withoutSlot,
  withoutTeam,
  type CharacterFacts,
  type PoolCharacter,
  type Rules,
} from '../team-randomizer'
import type { Element } from '../game-meta'

const ELEMENTS: Element[] = ['pyro', 'hydro', 'anemo', 'electro', 'dendro', 'cryo', 'geo']

/** `n` made-up characters: every third a 5★, elements in turn, every fifth a healer. */
function cast(
  n: number,
  change: (c: PoolCharacter, i: number) => void = () => {},
): PoolCharacter[] {
  return Array.from({ length: n }, (_, i) => {
    const c: PoolCharacter = {
      key: `C${i}`,
      name: `Character ${i}`,
      rarity: i % 3 === 0 ? 5 : 4,
      element: ELEMENTS[i % ELEMENTS.length]!,
      weapon: 'sword',
      region: (i % 8) + 1,
      body: (['tall', 'medium', 'short'] as const)[i % 3]!,
      gender: i % 2 ? 'm' : 'f',
      roles: i % 5 === 0 ? ['healer'] : [],
      level: 90 - (i % 4) * 10,
    }
    change(c, i)
    return c
  })
}

const input = (pool: PoolCharacter[], rules: Partial<Rules> = {}, seed = 1) => ({
  pool,
  everyone: new Map(pool.map((c) => [c.key, c])),
  rules: { ...DEFAULT_RULES, ...rules },
  kept: emptySlots(),
  seed,
})

const teamsOf = (result: ReturnType<typeof fillTeams>) => {
  if (!result.ok) throw new Error(`roll failed: ${result.reason}`)
  return result.teams
}

describe('fillTeams', () => {
  it('gives two teams of four, the same for the same seed and another for another', () => {
    const pool = cast(40)
    const first = teamsOf(fillTeams(input(pool, {}, 7)))
    expect(first).toHaveLength(TEAM_COUNT)
    for (const team of first) expect(team).toHaveLength(TEAM_SIZE)
    expect(teamsOf(fillTeams(input(pool, {}, 7)))).toEqual(first)
    expect(teamsOf(fillTeams(input(pool, {}, 8)))).not.toEqual(first)
  })

  it('never repeats a character across teams while the rule is on', () => {
    const pool = cast(9)
    for (let seed = 0; seed < 50; seed++) {
      const all = teamsOf(fillTeams(input(pool, {}, seed))).flat()
      expect(new Set(all).size).toBe(all.length)
    }
  })

  it('may repeat across teams with the rule off, never inside a team', () => {
    const pool = cast(4)
    expect(fillTeams(input(pool))).toEqual({ ok: false, reason: 'pool' })
    const teams = teamsOf(fillTeams(input(pool, { noRepeats: false })))
    for (const team of teams) expect(new Set(team).size).toBe(TEAM_SIZE)
  })

  it('keeps the locked slots where they are', () => {
    const pool = cast(30)
    const base = input(pool, {}, 3)
    const kept = emptySlots()
    kept[0]![2] = 'C11'
    kept[1]![0] = 'C4'
    const teams = teamsOf(fillTeams({ ...base, kept }))
    expect(teams[0]![2]).toBe('C11')
    expect(teams[1]![0]).toBe('C4')
    expect(new Set(teams.flat()).size).toBe(8)
  })

  it('puts a healer in every team, in no fixed slot', () => {
    const pool = cast(40)
    const healers = new Set(pool.filter((c) => c.roles.includes('healer')).map((c) => c.key))
    const slots = new Set<number>()
    for (let seed = 0; seed < 60; seed++) {
      for (const team of teamsOf(fillTeams(input(pool, { healer: true }, seed)))) {
        expect(team.some((key) => healers.has(key))).toBe(true)
        team.forEach((key, slot) => healers.has(key) && slots.add(slot))
      }
    }
    expect(slots.size).toBe(TEAM_SIZE)
  })

  it('keeps a team to different elements, and to the 5★ limit', () => {
    const pool = cast(40)
    const of = new Map(pool.map((c) => [c.key, c]))
    for (let seed = 0; seed < 40; seed++) {
      const teams = teamsOf(fillTeams(input(pool, { elements: true, fiveStars: true }, seed)))
      for (const team of teams) {
        const members = team.map((key) => of.get(key)!)
        expect(new Set(members.map((m) => m.element)).size).toBe(TEAM_SIZE)
        expect(members.filter((m) => m.rarity >= 5).length).toBeLessThanOrEqual(MAX_FIVE_STARS)
      }
    }
  })

  it('finds the only way when the pool has just enough', () => {
    const twoHealers = cast(13, (c, i) => (c.roles = i === 3 || i === 9 ? ['healer'] : []))
    const twoHealersBig = cast(120, (c, i) => (c.roles = i === 3 || i === 9 ? ['healer'] : []))
    // Four 5★ at most in both teams together, out of many: the rest must be 4★.
    const fourFours = cast(60, (c, i) => (c.rarity = i % 15 === 0 ? 4 : 5))
    for (let seed = 0; seed < 300; seed++) {
      for (const pool of [twoHealers, twoHealersBig]) {
        const teams = teamsOf(fillTeams(input(pool, { healer: true }, seed)))
        for (const team of teams) expect(team.some((k) => k === 'C3' || k === 'C9')).toBe(true)
      }
      teamsOf(fillTeams(input(fourFours, { fiveStars: true }, seed)))
    }
  })

  it('lets the element-less Traveler sit beside any element', () => {
    const pool = cast(8, (c, i) => {
      c.element = i === 0 ? null : ELEMENTS[i % 4]!
    })
    // Four elements over seven characters: a team of four different ones needs the Traveler.
    const teams = teamsOf(fillTeams(input(pool, { elements: true })))
    expect(teams.flat()).toContain('C0')
  })

  it('names the rule that cannot be met', () => {
    const noHealers = cast(20, (c) => (c.roles = []))
    expect(fillTeams(input(noHealers, { healer: true }))).toEqual({ ok: false, reason: 'healer' })
    const oneHealer = cast(20, (c, i) => (c.roles = i === 0 ? ['healer'] : []))
    expect(fillTeams(input(oneHealer, { healer: true }))).toEqual({ ok: false, reason: 'healer' })
    const pyro = cast(20, (c) => (c.element = 'pyro'))
    expect(fillTeams(input(pyro, { elements: true }))).toEqual({ ok: false, reason: 'elements' })
    const stars = cast(20, (c) => (c.rarity = 5))
    expect(fillTeams(input(stars, { fiveStars: true }))).toEqual({ ok: false, reason: 'fiveStars' })
    expect(fillTeams(input(cast(7)))).toEqual({ ok: false, reason: 'pool' })
  })

  it('says when the locks themselves break a rule', () => {
    const pool = cast(30, (c, i) => {
      if (i < 2) c.element = 'pyro'
    })
    const kept = emptySlots()
    kept[0]![0] = 'C0'
    kept[0]![1] = 'C1'
    expect(fillTeams({ ...input(pool, { elements: true }), kept })).toEqual({
      ok: false,
      reason: 'locks',
    })
    const twice = emptySlots()
    twice[0]![0] = 'C5'
    twice[1]![0] = 'C5'
    expect(fillTeams({ ...input(pool), kept: twice })).toEqual({ ok: false, reason: 'locks' })
    expect(fillTeams({ ...input(pool, { noRepeats: false }), kept: twice }).ok).toBe(true)
  })

  it('still knows a locked character that left the pool', () => {
    const everyone = cast(30, (c, i) => {
      if (i === 0) c.element = 'geo'
    })
    const pool = everyone.slice(1)
    const kept = emptySlots()
    kept[0]![0] = 'C0'
    for (let seed = 0; seed < 20; seed++) {
      const teams = teamsOf(
        fillTeams({
          pool,
          everyone: new Map(everyone.map((c) => [c.key, c])),
          rules: { ...DEFAULT_RULES, elements: true },
          kept,
          seed,
        }),
      )
      const geo = teams[0]!.filter((key) => everyone.find((c) => c.key === key)!.element === 'geo')
      expect(geo).toEqual(['C0'])
    }
  })
})

describe('rerolls', () => {
  it('changes one slot and gives someone new', () => {
    const pool = cast(30)
    const base = input(pool, {}, 5)
    const teams = teamsOf(fillTeams(base))
    for (let seed = 0; seed < 20; seed++) {
      const next = teamsOf(
        fillTeams({
          ...base,
          seed,
          kept: withoutSlot(teams, 1, 2),
          avoid: new Set([teams[1]![2]!]),
        }),
      )
      expect(next[1]![2]).not.toBe(teams[1]![2])
      expect(withoutSlot(next, 1, 2)).toEqual(withoutSlot(teams, 1, 2))
    }
  })

  it('gives the same one back only when nobody else fits', () => {
    const pool = cast(8)
    const base = input(pool)
    const teams = teamsOf(fillTeams(base))
    const next = teamsOf(
      fillTeams({ ...base, kept: withoutSlot(teams, 0, 0), avoid: new Set([teams[0]![0]!]) }),
    )
    expect(next).toEqual(teams)
  })

  it('rerolls a team around its locks, leaving the other team alone', () => {
    const pool = cast(30)
    const base = input(pool, {}, 2)
    const teams = teamsOf(fillTeams(base))
    const locks = emptySlots()
    locks[0]![1] = teams[0]![1]!
    const next = teamsOf(
      fillTeams({
        ...base,
        seed: 9,
        kept: withoutTeam(teams, 0, locks),
        avoid: new Set(teams[0]),
      }),
    )
    expect(next[1]).toEqual(teams[1])
    expect(next[0]![1]).toBe(teams[0]![1])
    const fresh = next[0]!.filter((_, slot) => slot !== 1)
    for (const key of fresh) expect(teams[0]).not.toContain(key)
  })
})

describe('the pool', () => {
  const facts = (key: string): CharacterFacts | undefined =>
    key === 'Unknown'
      ? undefined
      : {
          rarity: key === 'Amber' ? 4 : 5,
          element: key === 'Traveler' ? null : 'pyro',
          weapon: 'sword',
          region: null,
          body: null,
          gender: null,
          roles: [],
        }
  const name = (key: string) => key
  const owned = [
    { key: 'Amber', level: 80 },
    { key: 'TravelerHydro', level: 90 },
    { key: 'Manekin', level: 1 },
  ]
  const released = [
    'Amber',
    'Diluc',
    'Manekina',
    'Traveler',
    'TravelerHydro',
    'TravelerPyro',
    'Unknown',
  ]

  it("is the account's own characters, without the Manekin pair", () => {
    const pool = buildPool('mine', owned, released, facts, name)
    expect(pool.map((c) => c.key)).toEqual(['TravelerHydro', 'Amber'])
    expect(pool[1]).toMatchObject({ level: 80 })
  })

  it('is every released character, the Traveler once', () => {
    const pool = buildPool('all', owned, released, facts, name)
    expect(pool.map((c) => c.key)).toEqual(['Diluc', 'TravelerHydro', 'Amber'])
    expect(pool[0]).toMatchObject({ level: null })
    expect(buildPool('all', [], released, facts, name).map((c) => c.key)).toEqual([
      'Diluc',
      'Traveler',
      'Amber',
    ])
  })
})

describe('filters', () => {
  const [c] = cast(1) as [PoolCharacter]

  it('passes everything with none set', () => {
    expect(hasFilters(NO_FILTERS)).toBe(false)
    expect(passes(c, NO_FILTERS)).toBe(true)
  })

  it('takes any pick within a group, and every group with a pick', () => {
    expect(passes(c, { ...NO_FILTERS, elements: ['hydro', 'pyro'] })).toBe(true)
    expect(passes(c, { ...NO_FILTERS, elements: ['hydro'] })).toBe(false)
    expect(passes(c, { ...NO_FILTERS, elements: ['pyro'], rarities: [4] })).toBe(false)
    expect(passes(c, { ...NO_FILTERS, roles: ['shielder', 'healer'], bodies: ['tall'] })).toBe(true)
    expect(passes(c, { ...NO_FILTERS, regions: [2] })).toBe(false)
    expect(hasFilters({ ...NO_FILTERS, minLevel: 80 })).toBe(true)
  })

  it('leaves out what the account does not own once a level is asked for', () => {
    expect(passes(c, { ...NO_FILTERS, minLevel: 90 })).toBe(true)
    expect(passes({ ...c, level: 80 }, { ...NO_FILTERS, minLevel: 90 })).toBe(false)
    expect(passes({ ...c, level: null }, { ...NO_FILTERS, minLevel: 20 })).toBe(false)
  })

  it('lets the Traveler through any gender, and nobody without a body through a body pick', () => {
    expect(passes({ ...c, gender: null }, { ...NO_FILTERS, genders: ['m'] })).toBe(true)
    expect(passes({ ...c, body: null }, { ...NO_FILTERS, bodies: ['tall'] })).toBe(false)
  })
})
