import type { LiveJournalResponse } from '@gdt/shared'
import { describe, expect, it } from 'vitest'
import { withLiveCollections } from '@/data/collections'
import { withLiveParts } from '@/data/live-now'
import { withLiveMaterials, type MaterialsHistory } from '@/data/materials-history'

const journal = (changes: unknown[], snapshotId = 7): LiveJournalResponse =>
  ({
    open: true,
    base: { snapshotId, takenAt: 1_000 },
    updatedAt: 5_000,
    changes,
  }) as unknown as LiveJournalResponse

const history = (): MaterialsHistory => ({
  times: [1_000, 2_000],
  ids: [6, 7],
  lastSeenAt: 2_500,
  series: new Map([
    ['Mora', { at: [0, 1], value: [100, 200] }],
    ['MysticEnhancementOre', { at: [0], value: [5] }],
  ]),
  latest: new Map([
    ['Mora', 200],
    ['MysticEnhancementOre', 5],
  ]),
})

describe('withLiveMaterials', () => {
  it('adds the journal as a point after the newest snapshot', () => {
    const now = withLiveMaterials(
      history(),
      journal([
        ['set', ['materials', 'Mora'], 350],
        ['del', ['materials', 'MysticEnhancementOre']],
        ['set', ['materials', 'Primogem'], 160],
        ['set', ['gi_player', 'resin'], 120],
      ]),
    )
    expect(now.times).toEqual([1_000, 2_000, 5_000])
    expect(now.ids).toEqual([6, 7, -1])
    expect(now.lastSeenAt).toBe(5_000)
    expect([...now.latest]).toEqual([
      ['Mora', 350],
      ['Primogem', 160],
    ])
    expect(now.series.get('Mora')).toEqual({ at: [0, 1, 2], value: [100, 200, 350] })
    expect(now.series.get('MysticEnhancementOre')).toEqual({ at: [0, 2], value: [5, 0] })
    expect(now.series.get('Primogem')).toEqual({ at: [2], value: [160] })
  })

  it('ignores a journal on another snapshot, a closed one and one without materials', () => {
    const base = history()
    const mora = [['set', ['materials', 'Mora'], 1]]
    expect(withLiveMaterials(base, journal(mora, 6))).toBe(base)
    expect(withLiveMaterials(base, { ...journal(mora), open: false })).toBe(base)
    expect(withLiveMaterials(base, journal([['set', ['gi_player', 'ar'], 60]]))).toBe(base)
    expect(withLiveMaterials(base, null)).toBe(base)
  })
})

describe('withLiveParts', () => {
  it('applies only the named sections', () => {
    const now = withLiveParts(
      { gi_characters: { Furina: { friendship: 9 } } },
      journal([
        ['set', ['gi_characters', 'Furina', 'friendship'], 10],
        ['set', ['anecdotes', '100001'], { state: 3, finishCount: 1 }],
      ]),
      7,
      ['gi_characters'],
    )
    expect(now.gi_characters).toEqual({ Furina: { friendship: 10 } })
    expect(now.gi_anecdotes).toBeUndefined()
  })

  it('builds an anecdote book the snapshot lacked', () => {
    const now = withLiveParts(
      {},
      journal([['set', ['anecdotes', '100001'], { state: 3, finishCount: 1 }]]),
      7,
      ['anecdotes', 'gi_anecdotes'],
    )
    expect(now.gi_anecdotes?.anecdotes).toEqual({ '100001': { state: 3, finishCount: 1 } })
  })

  it('leaves the parts alone for a journal on another snapshot', () => {
    const parts = { gi_characters: { Furina: { friendship: 9 } } }
    const live = journal([['set', ['gi_characters', 'Furina', 'friendship'], 10]], 6)
    expect(withLiveParts(parts, live, 7, ['gi_characters'])).toBe(parts)
  })
})

describe('withLiveCollections', () => {
  const captured = {
    wardrobe: { value: { teams: { '1': { name: 'A', characters: ['Furina'] } } }, takenAt: 2_000 },
  }

  it('takes saved teams from the journal', () => {
    const teams = { '1': { name: 'B', characters: ['Furina', 'Nahida'] } }
    const now = withLiveCollections(
      captured,
      journal([
        ['set', ['gi_wardrobe', 'teams'], teams],
        ['set', ['gi_wardrobe', 'currentTeam'], 1],
      ]),
      7,
    )
    expect(now.wardrobe).toEqual({ value: { teams, currentTeam: 1 }, takenAt: 5_000 })
  })

  it('returns the captured parts when nothing they hold moved', () => {
    expect(withLiveCollections(captured, journal([['set', ['materials', 'Mora'], 1]]), 7)).toBe(
      captured,
    )
  })
})
