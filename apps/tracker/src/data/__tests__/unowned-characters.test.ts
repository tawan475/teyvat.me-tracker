import { describe, expect, it } from 'vitest'
import { NO_CHARACTER_FILTERS } from '../characters'
import { unownedCharacters } from '../unowned-characters'

const name = (key: string) => key.replace(/([a-z])([A-Z])/g, '$1 $2')
const KEYS = [
  'Furina',
  'Wriothesley',
  'Bennett',
  'TravelerHydro',
  'Traveler',
  'Manekin',
  'Neuvillette',
]

describe("Characters' Don't have", () => {
  it('lists released characters not owned, 5★ first, without the Traveler or the Manekins', () => {
    const list = unownedCharacters(new Set(['Furina']), NO_CHARACTER_FILTERS, name, KEYS)
    expect(list.map((c) => c.key)).toEqual(['Neuvillette', 'Wriothesley', 'Bennett'])
  })

  it('follows the search, element, rarity and weapon filters', () => {
    const owned = new Set<string>()
    const run = (over: Partial<typeof NO_CHARACTER_FILTERS>) =>
      unownedCharacters(owned, { ...NO_CHARACTER_FILTERS, ...over }, name, KEYS).map((c) => c.key)
    expect(run({ query: 'wri' })).toEqual(['Wriothesley'])
    expect(run({ element: 'pyro' })).toEqual(['Bennett'])
    expect(run({ rarity: 4 })).toEqual(['Bennett'])
    expect(run({ weaponType: 'catalyst' })).toEqual(['Neuvillette', 'Wriothesley'])
    expect(run({ build: 'ready' })).toEqual([])
    expect(run({ favorites: true })).toEqual([])
  })
})
