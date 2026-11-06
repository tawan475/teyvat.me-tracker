import type { CatalogEntry, GoodSubstat, GoodWeapon } from '@gdt/shared'
import { describe, expect, it } from 'vitest'
import {
  gearDays,
  gearDiff,
  isLevelled,
  knownGear,
  type Capture,
  type Gear,
} from '@/data/character-gear'
import { buildRoster } from '@/data/characters'

const SLOTS = ['flower', 'plume', 'sands', 'goblet', 'circlet']

function entry(
  id: number,
  slot: number,
  opts: { set?: string; level?: number; main?: string; subs?: GoodSubstat[]; cv?: number } = {},
): CatalogEntry {
  return {
    id,
    setKey: opts.set ?? 'GoldenTroupe',
    slotKey: SLOTS[slot]!,
    level: opts.level ?? 20,
    rarity: 5,
    mainStatKey: opts.main ?? 'hp',
    substats: opts.subs ?? [
      { key: 'critRate_', value: 7 },
      { key: 'critDMG_', value: 14 },
    ],
    totalRolls: 8,
    elixirCrafted: false,
    unactivatedSubstats: [],
    cv: opts.cv ?? 28,
    rv: 600,
  }
}

const catalog = new Map<number, CatalogEntry>(
  [
    entry(1, 0),
    entry(2, 1),
    entry(3, 2),
    entry(4, 3),
    entry(5, 4),
    // Another goblet, another set.
    entry(14, 3, { set: 'TenacityOfTheMillelith', main: 'hydro_dmg_', cv: 10 }),
    // The sands at +16, then the same piece at +20 (a new catalog id).
    entry(13, 2, { level: 16, subs: [{ key: 'critRate_', value: 3.9 }] }),
    entry(23, 2, {
      level: 20,
      subs: [
        { key: 'critRate_', value: 7.8 },
        { key: 'hp_', value: 5.8 },
      ],
    }),
  ].map((e) => [e.id, e]),
)

const weapon = (key: string, level = 90, refinement = 1): GoodWeapon => ({
  key,
  level,
  ascension: 6,
  refinement,
  location: 'Furina',
  lock: false,
})

const gear = (
  pieces: (number | null)[],
  w: GoodWeapon | null = weapon('SplendorOfTranquilWaters'),
): Gear => ({
  weapon: w,
  pieces,
})

const at = (day: number, hour: number) => new Date(2026, 9, day, hour).getTime()
const capture = (id: number, time: number, g: Gear | null): Capture => ({
  snapshotId: id,
  at: time,
  capture: null,
  gear: g,
})

describe('isLevelled', () => {
  it('reads the same piece at a higher level as levelled, another piece as not', () => {
    expect(isLevelled(catalog.get(13)!, catalog.get(23)!)).toBe(true)
    expect(isLevelled(catalog.get(23)!, catalog.get(13)!)).toBe(false)
    expect(isLevelled(catalog.get(4)!, catalog.get(14)!)).toBe(false)
  })
})

describe('gearDays', () => {
  const base = [1, 2, 13, 4, 5]

  it('is empty for a character whose gear never changed, and skips the first capture', () => {
    const list = [capture(1, at(1, 10), gear(base)), capture(2, at(2, 10), gear(base))]
    expect(gearDays(list, catalog)).toEqual([])
  })

  it('folds a day of swaps into one row, newest step first, with the net change', () => {
    const list = [
      capture(1, at(26, 20), gear(base)),
      capture(2, at(27, 18), gear([1, 2, 23, 4, 5])), // sands levelled
      capture(3, at(27, 19), gear([1, 2, 23, 14, 5])), // goblet swapped
      capture(4, at(27, 21), gear([1, 2, 23, 14, 5], weapon('FleuveCendreFerryman', 90, 5))),
      capture(5, at(27, 22), gear([1, 2, 23, 14, 5], weapon('FleuveCendreFerryman', 90, 5))), // same
    ]
    const days = gearDays(list, catalog)
    expect(days).toHaveLength(1)
    const day = days[0]!
    expect(day.steps.map((s) => s.snapshotId)).toEqual([4, 3, 2])
    expect(day.at).toBe(at(27, 21))
    expect(day.slots).toEqual(['sands', 'goblet'])
    expect(day.artifacts).toBe(true)
    expect(day.weapon).toBe(true)
    expect(day.sameEnd).toBe(false)
    expect(day.steps[2]!.pieces).toEqual([{ slot: 'sands', kind: 'levelled', from: 16, to: 20 }])
    expect(day.steps[1]!.pieces).toEqual([{ slot: 'goblet', kind: 'swapped', ids: [4, 14] }])
    expect(day.steps[0]!.weapon?.kind).toBe('swapped')
    expect(day.steps[1]!.sets).toEqual([
      { setKey: 'GoldenTroupe', count: 4 },
      { setKey: 'TenacityOfTheMillelith', count: 1 },
    ])
    expect(day.cvFrom).toBe(140)
    expect(day.cvTo).toBe(122)
  })

  it('marks a day that ended where it started, and keeps days apart, newest first', () => {
    const list = [
      capture(1, at(10, 9), gear(base)),
      capture(2, at(12, 9), gear([1, 2, 13, 14, 5])),
      capture(3, at(12, 20), gear(base)),
      capture(4, at(14, 9), gear([1, 2, 13, 4, null])),
      capture(5, at(14, 10), gear([1, 2, 13, 4, null], weapon('SplendorOfTranquilWaters', 90, 2))),
    ]
    const days = gearDays(list, catalog)
    expect(days.map((d) => d.steps.length)).toEqual([2, 2])
    expect(days[1]!.sameEnd).toBe(true)
    expect(days[1]!.slots).toEqual([])
    expect(days[0]!.steps[1]!.pieces).toEqual([{ slot: 'circlet', kind: 'removed' }])
    expect(days[0]!.steps[0]!.weapon?.kind).toBe('upgraded')
    expect(days[0]!.artifacts).toBe(true)
  })

  it('skips captures without gear: no change, and the next is compared across them', () => {
    // What some world change and logout snapshots held: the character there,
    // nothing equipped on it (or on anyone).
    const none = knownGear(gear([null, null, null, null, null], null))
    const list = [
      capture(1, at(27, 9), gear(base)),
      capture(2, at(27, 10), none),
      capture(3, at(27, 11), none),
      capture(4, at(27, 12), gear(base)),
      capture(5, at(27, 13), none),
      capture(6, at(28, 9), gear([1, 2, 13, 14, 5])),
    ]
    const days = gearDays(list, catalog)
    expect(days).toHaveLength(1)
    expect(days[0]!.steps.map((s) => s.snapshotId)).toEqual([6])
    expect(days[0]!.steps[0]!.pieces).toEqual([{ slot: 'goblet', kind: 'swapped', ids: [4, 14] }])
    expect(days[0]!.steps[0]!.weapon).toBeNull()
    expect(gearDays([capture(1, at(1, 9), none), capture(2, at(1, 10), none)], catalog)).toEqual([])
  })

  it('skips a capture whose artifacts were not read, though its weapon was', () => {
    // A logout capture with the weapon worn and every artifact on the account
    // off, between two captures with them on: no change that day.
    const swapped = gear([1, 2, 13, 14, 5])
    const unread = knownGear(gear([null, null, null, null, null]), false)
    const list = [
      capture(1, at(27, 9), gear(base)),
      capture(2, at(27, 12), swapped),
      capture(3, at(27, 17), unread),
      capture(4, at(27, 18), swapped),
    ]
    const days = gearDays(list, catalog)
    expect(days).toHaveLength(1)
    expect(days[0]!.steps.map((s) => s.snapshotId)).toEqual([2])
    expect(days[0]!.sameEnd).toBe(false)
  })

  it('still shows one character taking all five off and putting them back', () => {
    const bare = knownGear(gear([null, null, null, null, null]))
    const list = [
      capture(1, at(27, 9), gear(base)),
      capture(2, at(28, 10), bare),
      capture(3, at(28, 11), gear(base)),
    ]
    const days = gearDays(list, catalog)
    expect(days).toHaveLength(1)
    expect(days[0]!.steps.map((s) => s.snapshotId)).toEqual([3, 2])
    expect(days[0]!.steps[1]!.pieces.map((p) => p.kind)).toEqual(Array(5).fill('removed'))
    expect(days[0]!.steps[1]!.cv).toBe(0)
    expect(days[0]!.sameEnd).toBe(true)
  })
})

describe('knownGear', () => {
  it('reads a capture without a weapon as one that holds no gear', () => {
    expect(knownGear(gear([1, 2, 13, 4, 5], null))).toBeNull()
    expect(knownGear(gear([null, null, null, null, null], null))).toBeNull()
  })

  it('keeps a weapon with no pieces: those were taken off', () => {
    const bare = gear([null, null, null, null, null])
    expect(knownGear(bare)).toBe(bare)
  })

  it('reads a capture whose artifacts were not read as one that holds no gear', () => {
    expect(knownGear(gear([null, null, null, null, null]), false)).toBeNull()
    expect(knownGear(gear([1, 2, 13, 4, 5]), false)).toBeNull()
  })
})

describe('gearDiff', () => {
  const view = (pieces: number[], w: GoodWeapon) =>
    buildRoster({
      characters: [
        {
          key: 'Furina',
          level: 90,
          ascension: 6,
          constellation: 2,
          talent: { auto: 9, skill: 9, burst: 10 },
        },
      ],
      weapons: [w],
      artifacts: pieces.map((id) => {
        const e = catalog.get(id)!
        return { ...e, location: 'Furina', lock: false, astralMark: false }
      }),
    }).characters[0]!

  it('names the weapon and the slots whose piece differs', () => {
    const now = view([1, 2, 23, 4, 5], weapon('SplendorOfTranquilWaters'))
    expect(gearDiff(now, now)).toEqual([])
    const past = view([1, 2, 13, 14, 5], weapon('FleuveCendreFerryman', 90, 5))
    expect(gearDiff(past, now)).toEqual(['weapon', 'sands', 'goblet'])
  })
})
