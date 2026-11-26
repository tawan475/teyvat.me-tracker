import { describe, expect, it } from 'vitest'
import { rangeBench } from '../bench-range'

const keys = ['a', 'b', 'c', 'd', 'e']

describe('rangeBench', () => {
  it('benches the run from the first tile to the one under the pointer', () => {
    expect(rangeBench([], keys, 1, 3, true)).toEqual(['b', 'c', 'd'])
    expect(rangeBench([], keys, 3, 1, true)).toEqual(['b', 'c', 'd'])
  })

  it('keeps what was benched before, once', () => {
    expect(rangeBench(['e', 'c'], keys, 1, 3, true)).toEqual(['e', 'c', 'b', 'd'])
  })

  it('brings a run back when the drag began on a benched tile', () => {
    expect(rangeBench(['a', 'b', 'c', 'e'], keys, 1, 2, false)).toEqual(['a', 'e'])
  })

  it('gives tiles their old state when the drag goes back', () => {
    const before = ['d']
    expect(rangeBench(before, keys, 0, 3, true)).toEqual(['d', 'a', 'b', 'c'])
    expect(rangeBench(before, keys, 0, 1, true)).toEqual(['d', 'a', 'b'])
    expect(rangeBench(['d'], keys, 3, 3, false)).toEqual([])
    expect(rangeBench(['d'], keys, 3, 4, false)).toEqual([])
  })
})
