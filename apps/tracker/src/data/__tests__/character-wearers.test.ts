import type { ArtifactsSection, CatalogEntry } from '@gdt/shared'
import { describe, expect, it } from 'vitest'
import { wearers } from '@/data/character-gear'

const SLOTS = ['flower', 'plume', 'sands', 'goblet', 'circlet']

const catalog = new Map<number, CatalogEntry>(
  [1, 2, 3, 4, 5, 6].map((id) => [
    id,
    {
      id,
      setKey: 'GoldenTroupe',
      slotKey: SLOTS[(id - 1) % 5]!,
      level: 20,
      rarity: 5,
      mainStatKey: 'hp',
      substats: [],
      totalRolls: 8,
      elixirCrafted: false,
      unactivatedSubstats: [],
      cv: 0,
      rv: 0,
    },
  ]),
)

/** A full artifacts section: ids 1… delta-encoded, one location each. */
const section = (locations: string[]): ArtifactsSection => ({
  i: locations.map(() => 1),
  l: locations,
  f: locations.map(() => 0),
})

describe('wearers', () => {
  it('lists each wearer with its pieces by slot', () => {
    const worn = wearers(section(['Chasca', 'Chasca', '', '', '', 'Furina']), null, catalog)!
    expect([...worn.keys()]).toEqual(['Chasca', 'Furina'])
    expect(worn.get('Chasca')!.ids).toEqual([1, 2, null, null, null])
    expect(worn.get('Furina')!.ids).toEqual([6, null, null, null, null])
  })

  it('is null when the account holds artifacts but nobody wears one: not read', () => {
    expect(wearers(section(['', '', '', '', '', '']), null, catalog)).toBeNull()
  })

  it('is empty, not null, for an account without artifacts', () => {
    expect(wearers(section([]), null, catalog)).toEqual(new Map())
  })

  it('keeps one character with all five off while others wear theirs', () => {
    const worn = wearers(section(['', '', '', '', '', 'Furina']), null, catalog)!
    expect(worn.has('Chasca')).toBe(false)
    expect(worn.get('Furina')!.ids[0]).toBe(6)
  })
})
