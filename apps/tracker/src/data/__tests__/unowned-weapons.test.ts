import { describe, expect, it } from 'vitest'
import { unownedWeapons } from '../unowned-weapons'
import { NO_WEAPON_FILTERS, bareWeaponGroup } from '../weapons'

const name = (key: string) => key.replace(/([a-z])([A-Z])/g, '$1 $2')
const KEYS = ['StaffOfHoma', 'FavoniusSword', 'DullBlade', 'Rust', 'MistsplitterReforged']

describe("Weapons' Don't have", () => {
  it('lists weapons not owned, 5★ first then by name', () => {
    const list = unownedWeapons(new Set(['Rust']), NO_WEAPON_FILTERS, name, KEYS)
    expect(list.map((w) => w.key)).toEqual([
      'MistsplitterReforged',
      'StaffOfHoma',
      'FavoniusSword',
      'DullBlade',
    ])
  })

  it('follows the search, type and rarity filters, and goes empty under the owned-only ones', () => {
    const run = (over: Partial<typeof NO_WEAPON_FILTERS>) =>
      unownedWeapons(new Set(), { ...NO_WEAPON_FILTERS, ...over }, name, KEYS).map((w) => w.key)
    expect(run({ query: 'homa' })).toEqual(['StaffOfHoma'])
    expect(run({ type: 'bow' })).toEqual(['Rust'])
    expect(run({ rarity: 1 })).toEqual(['DullBlade'])
    expect(run({ status: 'equipped' })).toEqual([])
    expect(run({ lock: 'locked' })).toEqual([])
    expect(run({ level: 'max' })).toEqual([])
    expect(run({ refinable: true })).toEqual([])
  })

  it('imagines one copy of an unowned weapon at its level cap, R1, held by no one', () => {
    const homa = bareWeaponGroup('StaffOfHoma')!
    expect(homa.rows).toEqual([])
    expect(homa.count).toBe(0)
    expect(homa.best).toMatchObject({
      key: 'StaffOfHoma',
      rarity: 5,
      type: 'polearm',
      level: 90,
      ascension: 6,
      refinement: 1,
      location: '',
      count: 0,
    })
    expect(bareWeaponGroup('DullBlade')!.best).toMatchObject({ level: 70, ascension: 4 })
    expect(bareWeaponGroup('NoSuchWeapon')).toBeNull()
  })
})
