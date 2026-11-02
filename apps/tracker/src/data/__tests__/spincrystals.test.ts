import materialsJson from '@gdt/game-data/data/materials.json'
import { describe, expect, it } from 'vitest'
import { loadSpincrystals as loadSongs } from '@gdt/game-data/collections'
import {
  filterSpincrystals,
  spincrystalGuide,
  spincrystalProgress,
  spincrystalsOf,
  withKeys,
  type Spincrystal,
} from '../spincrystals'

const all = spincrystalsOf(materialsJson.materials)

describe('spincrystalsOf', () => {
  it("finds the game data's Radiant Spincrystals by their icon, and nothing else", () => {
    // 7.1: 206, ids 141001-141306 (the range also holds foods, which are not).
    expect(all.length).toBeGreaterThanOrEqual(206)
    expect(all[0]).toEqual({ id: 141_001, key: 'RadiantSpincrystal1', number: 1 })
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length)
    expect(all.every((s) => s.key.startsWith('RadiantSpincrystal'))).toBe(true)
    expect(all.some((s) => s.key === 'FragrantSteak')).toBe(false)
    const named = all.filter((s) => s.number === null)
    expect(named.map((s) => s.key)).toContain('RadiantSpincrystalTheLongWayHomePartI')
    expect(all.find((s) => s.key === 'RadiantSpincrystal100')?.number).toBe(100)
  })
})

describe('spincrystalProgress', () => {
  // Songs as the collections data gives them: region, number, unlocking item, starting song.
  const song = (
    id: number,
    city: number,
    number: number | null,
    item: number | null,
    isDefault = false,
  ) => ({
    id,
    city,
    number,
    item,
    isDefault,
    order: 0,
  })
  const sample: Spincrystal[] = withKeys(
    [
      song(105, 1, null, null, true),
      song(101, 1, 1, 141_001),
      song(102, 1, 2, 141_002),
      song(233, 2, null, 141_257),
      song(502, 5, 100, 141_200),
    ],
    all,
  )

  it('carries each item key, and a starting song has none', () => {
    expect(sample.map((s) => s.key)).toEqual([
      null,
      'RadiantSpincrystal1',
      'RadiantSpincrystal2',
      'RadiantSpincrystalTheLongWayHomePartI',
      'RadiantSpincrystal100',
    ])
  })

  it('marks what the capture has by item; starting songs always count; unknown ids apart', () => {
    const p = spincrystalProgress(sample, [141_002, 141_257, 141_999])
    expect(p.rows.map((r) => [r.id, r.have])).toEqual([
      [105, true],
      [101, false],
      [102, true],
      [233, true],
      [502, false],
    ])
    expect([p.have, p.total, p.unknown]).toEqual([3, 5, [141_999]])
  })

  it('filters All / Missing / Have', () => {
    const { rows } = spincrystalProgress(sample, [141_002])
    expect(filterSpincrystals(rows, 'all')).toHaveLength(5)
    expect(filterSpincrystals(rows, 'have').map((r) => r.id)).toEqual([105, 102])
    expect(filterSpincrystals(rows, 'missing').map((r) => r.id)).toEqual([101, 233, 502])
  })

  it('takes the real list: every item a song unlocks is a known Spincrystal', async () => {
    const songs = await loadSongs()
    const keyed = withKeys(songs, all)
    expect(keyed.filter((s) => s.item !== null).every((s) => s.key !== null)).toBe(true)
    const owned = all.filter((_, i) => i % 7 < 4).map((s) => s.id)
    const p = spincrystalProgress(keyed, owned)
    expect(p.have).toBe(owned.length + keyed.filter((s) => s.isDefault).length)
    expect(p.unknown).toEqual([])
  })
})

describe('spincrystalGuide', () => {
  it('links each to its wiki page, by number or by its English name', () => {
    expect(spincrystalGuide({ number: 55 }, 'Radiant Spincrystal 55')).toBe(
      'https://genshin-impact.fandom.com/wiki/Radiant_Spincrystal_55',
    )
    expect(
      spincrystalGuide({ number: null }, 'Radiant Spincrystal "The Long Way Home: Part I"'),
    ).toBe(
      'https://genshin-impact.fandom.com/wiki/Radiant_Spincrystal_%22The_Long_Way_Home:_Part_I%22',
    )
  })
})
