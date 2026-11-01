import { describe, expect, it } from 'vitest'
import type { Enemy } from '@gdt/game-data/enemies'
import { enemySections } from '../enemies'

const enemy = (id: number, faction: Enemy['faction']) => ({ id, faction }) as Enemy
// Game order: a hilichurl, an elemental, two more hilichurls.
const list = [
  enemy(1, 'hilichurl'),
  enemy(2, 'elemental'),
  enemy(3, 'hilichurl'),
  enemy(4, 'hilichurl'),
]
const counts: Record<number, number> = { 3: 50, 2: 7, 4: 50 }
const defeated = (id: number) => counts[id] ?? 0
const ids = (sections: ReturnType<typeof enemySections>) =>
  sections.map((s) => [s.faction, s.enemies.map((e) => e.id)])

describe('enemySections', () => {
  it('groups by the game categories in the game order', () => {
    expect(ids(enemySections(list, 'type', 'order', defeated))).toEqual([
      ['elemental', [2]],
      ['hilichurl', [1, 3, 4]],
    ])
  })
  it('sorts each category by defeats, ties in game order', () => {
    expect(ids(enemySections(list, 'type', 'defeated', defeated))).toEqual([
      ['elemental', [2]],
      ['hilichurl', [3, 4, 1]],
    ])
  })
  it('lists everything once without grouping', () => {
    expect(ids(enemySections(list, 'none', 'order', defeated))).toEqual([[null, [1, 2, 3, 4]]])
    expect(ids(enemySections(list, 'none', 'defeated', defeated))).toEqual([[null, [3, 4, 2, 1]]])
  })
  it('gives nothing for an empty list', () => {
    expect(enemySections([], 'none', 'order', defeated)).toEqual([])
    expect(enemySections([], 'type', 'order', defeated)).toEqual([])
  })
})
