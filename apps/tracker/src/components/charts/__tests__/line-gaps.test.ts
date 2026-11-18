import { describe, expect, it } from 'vitest'
import { lonePoints } from '../line-gaps'

describe('a line with breaks', () => {
  it('finds the points no segment reaches', () => {
    const y = (values: (number | null)[]) => values.map((value) => ({ y: value }))
    // 5 stands between two breaks, 9 after the last one: both would draw nothing.
    expect([...lonePoints(y([1, 2, null, 5, null, null, 9]))]).toEqual([3, 6])
    expect([...lonePoints(y([1, 2, 3]))]).toEqual([])
    expect([...lonePoints(y([null, null]))]).toEqual([])
    expect([...lonePoints(y([7]))]).toEqual([0])
  })
})
