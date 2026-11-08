import { describe, expect, it } from 'vitest'
import {
  bagLimit,
  DEFAULT_GRAPHS,
  knownGraphs,
  legacyGraphs,
  MAX_PROGRESSION_GRAPHS,
  moveGraph,
  newGraph,
  toStored,
  yBounds,
  type Graph,
} from '../graphs'

const graph = (over: Partial<Graph>): Graph => ({
  figure: 'mora',
  from: 'auto',
  to: 'auto',
  delta: true,
  ...over,
})

describe('progression graphs', () => {
  it('starts a figure with a bag limit at 0 and ends it at the limit', () => {
    expect(newGraph('artifacts')).toEqual({
      figure: 'artifacts',
      from: 'zero',
      to: 'bag',
      delta: true,
    })
    expect(newGraph('weapons').to).toBe('bag')
    expect(newGraph('wishes')).toEqual({ figure: 'wishes', from: 'auto', to: 'auto', delta: true })
  })

  it('reads stored graphs, skipping figures it does not know', () => {
    expect(knownGraphs(null)).toBeNull()
    expect(knownGraphs([])).toBeNull()
    expect(
      knownGraphs([{ figure: 'somethingNew', from: 'auto', to: 'auto', delta: true }]),
    ).toBeNull()
    expect(
      knownGraphs([
        { figure: 'somethingNew', from: 'auto', to: 'auto', delta: true },
        { figure: 'mora', from: 'zero', to: 'bag', delta: false },
        { figure: 'artifacts', from: 'zero', to: 'bag', delta: true },
      ]),
    ).toEqual([
      // Mora has no bag limit: its axis ends at the highest value.
      graph({ from: 'zero', to: 'auto', delta: false }),
      graph({ figure: 'artifacts', from: 'zero', to: 'bag' }),
    ])
    const many = Array.from({ length: MAX_PROGRESSION_GRAPHS + 3 }, () => graph({}))
    expect(knownGraphs(many)).toHaveLength(MAX_PROGRESSION_GRAPHS)
  })

  it("carries over the old card's picked figures", () => {
    expect(legacyGraphs(null)).toBeNull()
    expect(legacyGraphs('')).toBeNull()
    expect(legacyGraphs('mora,nope,artifacts')).toEqual([graph({}), graph({ figure: 'artifacts' })])
  })

  it('fixes the y axis ends the settings ask for', () => {
    expect(yBounds(graph({}))).toEqual({})
    expect(yBounds(graph({ figure: 'artifacts', from: 'zero', to: 'bag' }))).toEqual({
      min: 0,
      max: 2_700,
    })
    expect(yBounds(graph({ figure: 'weapons', to: 'bag' }))).toEqual({ max: 2_000 })
    expect(yBounds(graph({ from: 1_000, to: 50_000_000 }))).toEqual({ min: 1_000, max: 50_000_000 })
    // A top at or under the bottom leaves no room: only the bottom holds.
    expect(yBounds(graph({ from: 500, to: 100 }))).toEqual({ min: 500 })
    expect(bagLimit(graph({ figure: 'artifacts', to: 'bag' }))).toBe(2_700)
    expect(bagLimit(graph({ figure: 'artifacts', to: 3_000 }))).toBeNull()
    expect(bagLimit(graph({ to: 'bag' }))).toBeNull()
  })

  it('stores the defaults as null and anything else as the list', () => {
    expect(toStored(DEFAULT_GRAPHS)).toBeNull()
    expect(toStored([graph({})])).toEqual([graph({})])
    expect(toStored([...DEFAULT_GRAPHS].reverse())).toHaveLength(2)
  })

  it('moves a graph, clamped to the list', () => {
    expect(moveGraph(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
    expect(moveGraph(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
    expect(moveGraph(['a', 'b', 'c'], 1, 9)).toEqual(['a', 'c', 'b'])
    expect(moveGraph(['a', 'b'], 5, 0)).toEqual(['a', 'b'])
  })
})
