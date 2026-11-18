import { describe, expect, it } from 'vitest'
import { addToEnd, dropKey, nudgeKey, overEmpty, overOther, overRow, removeKey } from '../sortable'

const limits = { max: 4, min: 1 }

describe('sortable lists', () => {
  it('adds a tapped page at the end, never past the maximum', () => {
    expect(addToEnd(['a', 'b'], 'c', limits)).toEqual({
      list: ['a', 'b', 'c'],
      said: { kind: 'place', key: 'c', n: 3 },
    })
    expect(addToEnd(['a', 'b', 'c', 'd'], 'e', limits)).toBeNull()
    expect(addToEnd(['a'], 'a', limits)).toBeNull()
  })

  it('removes a page, never the last one', () => {
    expect(removeKey(['a', 'b'], 'a', limits)).toEqual({
      list: ['b'],
      said: { kind: 'other', key: 'a' },
    })
    expect(removeKey(['a'], 'a', limits)).toBeNull()
  })

  it('moves a page one place or to an end with the keys', () => {
    expect(nudgeKey(['a', 'b', 'c'], 'c', -1)?.list).toEqual(['a', 'c', 'b'])
    expect(nudgeKey(['a', 'b', 'c'], 'c', -1)?.said).toEqual({ kind: 'place', key: 'c', n: 2 })
    expect(nudgeKey(['a', 'b', 'c'], 'c', 'start')?.list).toEqual(['c', 'a', 'b'])
    expect(nudgeKey(['a', 'b', 'c'], 'a', 'end')?.list).toEqual(['b', 'c', 'a'])
    expect(nudgeKey(['a', 'b', 'c'], 'a', -1)).toBeNull()
    expect(nudgeKey(['a', 'b', 'c'], 'c', 'end')).toBeNull()
  })

  it('targets the place before or after a row, not one that changes nothing', () => {
    const bar = ['a', 'b', 'c']
    expect(overRow(bar, 'x', 'other', 1, false, limits)).toEqual({ at: 1 })
    expect(overRow(bar, 'x', 'other', 1, true, limits)).toEqual({ at: 2 })
    // b's own place, above or below itself: no target.
    expect(overRow(bar, 'b', 'ordered', 1, false, limits)).toBeNull()
    expect(overRow(bar, 'b', 'ordered', 0, true, limits)).toBeNull()
    expect(overRow(bar, 'b', 'ordered', 2, true, limits)).toEqual({ at: 3 })
  })

  it('swaps with the row under a page from the other list when full', () => {
    const full = ['a', 'b', 'c', 'd']
    expect(overRow(full, 'x', 'other', 2, true, limits)).toEqual({ swap: 2 })
    expect(dropKey(full, 'x', 'other', { swap: 2 }, limits)).toEqual({
      list: ['a', 'b', 'x', 'd'],
      said: { kind: 'swap', key: 'x', n: 3, other: 'c' },
    })
    // Reordering a full list is still a place, not a swap.
    expect(overRow(full, 'a', 'ordered', 2, true, limits)).toEqual({ at: 3 })
  })

  it('targets the empty places and the other list', () => {
    expect(overEmpty(['a', 'b'], 'x', 'other', limits)).toEqual({ at: 2 })
    expect(overEmpty(['a', 'b'], 'b', 'ordered', limits)).toBeNull()
    expect(overEmpty(['a', 'b'], 'a', 'ordered', limits)).toEqual({ at: 2 })
    expect(overOther(['a', 'b'], 'ordered', limits)).toEqual({ other: true })
    expect(overOther(['a'], 'ordered', limits)).toBeNull()
    expect(overOther(['a', 'b'], 'other', limits)).toBeNull()
  })

  it('drops at a place, moving the rest along', () => {
    expect(dropKey(['a', 'b', 'c'], 'x', 'other', { at: 1 }, limits)).toEqual({
      list: ['a', 'x', 'b', 'c'],
      said: { kind: 'place', key: 'x', n: 2 },
    })
    expect(dropKey(['a', 'b', 'c', 'd'], 'd', 'ordered', { at: 1 }, limits)?.list).toEqual([
      'a',
      'd',
      'b',
      'c',
    ])
    expect(dropKey(['a', 'b', 'c', 'd'], 'a', 'ordered', { at: 3 }, limits)).toEqual({
      list: ['b', 'c', 'a', 'd'],
      said: { kind: 'place', key: 'a', n: 3 },
    })
    expect(dropKey(['a', 'b'], 'a', 'ordered', { other: true }, limits)?.list).toEqual(['b'])
    expect(dropKey(['a'], 'a', 'ordered', { other: true }, limits)).toBeNull()
    expect(dropKey(['a', 'b', 'c', 'd'], 'x', 'other', { at: 1 }, limits)).toBeNull()
  })
})
