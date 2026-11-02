import { describe, expect, it } from 'vitest'
import {
  RECENT_MAX,
  addRecent,
  matchScore,
  readRecent,
  searchNeedle,
  searchSite,
  searchWords,
  type SearchEntry,
} from '../site-search'

const entry = (kind: SearchEntry['kind'], name: string, english?: string): SearchEntry => ({
  kind,
  key: name,
  name,
  words: searchWords(name, english),
  rarity: 0,
  icon: '',
})

describe('site search', () => {
  it('scores a name start over a word start over anywhere', () => {
    const needle = searchNeedle('fur')
    expect(matchScore(searchWords('Furina'), needle)).toBe(0)
    expect(matchScore(searchWords('Lady Furina'), needle)).toBe(1)
    expect(matchScore(searchWords('Sulfurous'), needle)).toBe(2)
    expect(matchScore(searchWords('Nahida'), needle)).toBe(-1)
  })

  it('needs every word, in any order, ignoring case and accents', () => {
    const words = searchWords('Sautéed Matsutake')
    expect(matchScore(words, searchNeedle('matsutake SAUTEED'))).toBe(1)
    expect(matchScore(words, searchNeedle('sauteed apple'))).toBe(-1)
  })

  it('finds a name by its English name too', () => {
    const groups = searchSite([entry('character', '芙宁娜', 'Furina')], 'furina')
    expect(groups.map((g) => g.entries[0]?.name)).toEqual(['芙宁娜'])
  })

  it('groups by kind in a fixed order, best match first, capped per kind', () => {
    const entries = [
      entry('page', 'Furnishings'),
      entry('item', 'Sulfurous Clay'),
      entry('item', 'Fur Coat'),
      entry('character', 'Lady Furina'),
      entry('character', 'Furina'),
      ...Array.from({ length: 8 }, (_, i) => entry('enemy', `Furry Beast ${i}`)),
    ]
    const groups = searchSite(entries, 'fur', { perKind: 3 })
    expect(groups.map((g) => g.kind)).toEqual(['character', 'item', 'enemy', 'page'])
    expect(groups[0]!.entries.map((e) => e.name)).toEqual(['Furina', 'Lady Furina'])
    expect(groups[1]!.entries.map((e) => e.name)).toEqual(['Fur Coat', 'Sulfurous Clay'])
    expect(groups[2]!.entries).toHaveLength(3)
    expect(groups[2]!.more).toBe(5)
  })

  it('lists one kind alone when scoped', () => {
    const entries = [entry('item', 'Fur Coat'), entry('character', 'Furina')]
    expect(searchSite(entries, 'fur', { kind: 'item' }).map((g) => g.kind)).toEqual(['item'])
  })

  it('finds nothing for an empty query', () => {
    expect(searchSite([entry('item', 'Fur Coat')], '   ')).toEqual([])
  })

  it('keeps recent picks newest first, unique and capped', () => {
    let list = readRecent(null)
    for (let i = 0; i < RECENT_MAX + 2; i++) list = addRecent(list, { kind: 'item', key: `k${i}` })
    list = addRecent(list, { kind: 'item', key: 'k3' })
    expect(list[0]).toEqual({ kind: 'item', key: 'k3' })
    expect(list).toHaveLength(RECENT_MAX)
    expect(list.filter((p) => p.key === 'k3')).toHaveLength(1)
    expect(readRecent([{ kind: 'nope', key: 'x' }, { kind: 'page', key: 'home' }, 4])).toEqual([
      { kind: 'page', key: 'home' },
    ])
  })
})
