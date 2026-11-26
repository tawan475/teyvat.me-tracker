import { describe, expect, it } from 'vitest'
import { loadPlanner, type PlannerData } from '@gdt/game-data'
import { WISH_ITEMS, resolveWishItem, type WishPull } from '@gdt/shared'
import { wishItemIds } from '../wish-item-ids'

const pull = (name: string, itemType?: string): WishPull => ({
  id: 10n ** 18n,
  time: 0,
  gachaType: 301,
  item: resolveWishItem({ name, itemType }),
})

describe('wishItemIds', () => {
  // Made-up game data: one character and one weapon the wish table lacks.
  const planner = {
    characters: new Map([['MadeUpHero', { id: 10000999 }]]),
    weapons: new Map([['MadeUpBlade', { id: 11599 }]]),
  } as unknown as Pick<PlannerData, 'characters' | 'weapons'>
  const lookup = wishItemIds(planner)

  it('finds an item by its English name', () => {
    expect(lookup(pull('Made Up Hero', 'Character'))).toBe(10000999)
    expect(lookup(pull('Made Up Blade', 'Weapon'))).toBe(11599)
    expect(lookup(pull('Made Up Blade'))).toBe(11599)
  })

  it('does not take a weapon for a character of the same name', () => {
    expect(lookup(pull('Made Up Blade', 'Character'))).toBeUndefined()
  })

  it('gives nothing for a name the data lacks', () => {
    expect(lookup(pull('Nobody Here', 'Character'))).toBeUndefined()
  })

  it('agrees with the wish table on every item it knows (real data)', async () => {
    const real = wishItemIds(await loadPlanner())
    for (const info of WISH_ITEMS) {
      const p: WishPull = {
        id: 10n ** 18n,
        time: 0,
        gachaType: 301,
        item: { ...resolveWishItem({ name: info.name }), itemId: 0 },
      }
      expect(real(p), info.key).toBe(info.itemId)
    }
  })
})
