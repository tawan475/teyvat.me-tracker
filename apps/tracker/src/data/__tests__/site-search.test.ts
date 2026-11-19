import { describe, expect, it } from 'vitest'
import {
  RECENT_MAX,
  addRecent,
  matchScore,
  readRecent,
  searchNeedle,
  searchSite,
  searchWords,
  withoutItems,
  type SearchEntry,
} from '../site-search'
import { offBagKeys } from '@gdt/shared/off'

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

// Issue 12: Original Resin is covered by Capture's Account numbers switch,
// Realm Currency by its Serenitea Pot switch. While the account's newest
// capture has the switch off, the count is not shared.
describe('counts the newest capture did not share', () => {
  const keyed = (kind: SearchEntry['kind'], key: string, name: string): SearchEntry => ({
    ...entry(kind, name),
    key,
  })
  const entries = [
    keyed('item', 'OriginalResin', 'Original Resin'),
    keyed('item', 'FragileResin', 'Fragile Resin'),
    keyed('item', 'RealmCurrency', 'Realm Currency'),
    // Another kind under the same key is no count.
    keyed('achievement', 'OriginalResin', 'Original Resin'),
    keyed('page', 'account-planner', 'Planner'),
  ]
  const ids = (list: readonly SearchEntry[]) => list.map((e) => `${e.kind}:${e.key}`)
  const found = (list: readonly SearchEntry[], query: string) =>
    searchSite(list, query).flatMap((g) => ids(g.entries))

  it('are every item while all is shared, the same list', () => {
    expect(withoutItems(entries, [])).toBe(entries)
    expect(withoutItems(entries, offBagKeys(undefined))).toBe(entries)
    expect(withoutItems(entries, offBagKeys([]))).toBe(entries)
    // Switches that cover no bag count leave every item.
    expect(ids(withoutItems(entries, offBagKeys(['materials', 'gi_player.profile'])))).toEqual(
      ids(entries),
    )
    expect(found(entries, 'resin')).toEqual([
      'item:FragileResin',
      'item:OriginalResin',
      'achievement:OriginalResin',
    ])
  })

  it('are not offered: no match for Original Resin with Account numbers off', () => {
    const left = withoutItems(entries, offBagKeys(['gi_player.numbers']))
    expect(found(left, 'resin')).toEqual(['item:FragileResin', 'achievement:OriginalResin'])
    expect(found(left, 'original resin')).toEqual(['achievement:OriginalResin'])
    // The other count is shared and stays.
    expect(found(left, 'realm')).toEqual(['item:RealmCurrency'])
    expect(entries).toHaveLength(5)
  })

  it('nor Realm Currency with Serenitea Pot off, nor either with both off', () => {
    const teapot = withoutItems(entries, offBagKeys(['gi_teapot']))
    expect(found(teapot, 'realm')).toEqual([])
    expect(found(teapot, 'original')).toEqual(['item:OriginalResin', 'achievement:OriginalResin'])
    const both = withoutItems(entries, offBagKeys(['gi_teapot', 'gi_player.numbers']))
    expect(ids(both)).toEqual([
      'item:FragileResin',
      'achievement:OriginalResin',
      'page:account-planner',
    ])
  })

  it('nor as a recent pick, which is looked up among the entries left', () => {
    const recent = addRecent([{ kind: 'page', key: 'account-planner' }], {
      kind: 'item',
      key: 'OriginalResin',
    })
    const picks = (list: readonly SearchEntry[]) => {
      const byId = new Map(list.map((e) => [`${e.kind}:${e.key}`, e]))
      return recent.flatMap((pick) => byId.get(`${pick.kind}:${pick.key}`)?.name ?? [])
    }
    expect(picks(entries)).toEqual(['Original Resin', 'Planner'])
    expect(picks(withoutItems(entries, ['OriginalResin']))).toEqual(['Planner'])
    // Shared again by a newer capture: the pick is back, it was never dropped.
    expect(picks(withoutItems(entries, offBagKeys([])))).toEqual(['Original Resin', 'Planner'])
  })
})
