import { describe, expect, it } from 'vitest'
import { loadEnemies, loadEnemyNames } from '@gdt/game-data/enemies'
import { loadFarming } from '@gdt/game-data/farming'
import { BOSS_KINDS, UNDERWATER, bossPool, listsBoss, pickOne } from '../boss-randomizer'

async function pool() {
  const [enemies, names, farming] = await Promise.all([
    loadEnemies(),
    loadEnemyNames('en'),
    loadFarming(),
  ])
  return bossPool(enemies, names, names, farming.bosses)
}

describe('the boss randomizer', () => {
  it('lists weekly bosses, 40-resin bosses and Local Legends, each once', async () => {
    const list = await pool()
    for (const kind of BOSS_KINDS) expect(list.some((b) => b.kind === kind)).toBe(true)
    expect(new Set(list.map((b) => b.key)).size).toBe(list.length)
    expect(list.every((b) => b.name)).toBe(true)
  })

  it('finds a picture for nearly every boss', async () => {
    const list = await pool()
    const bare = list.filter((b) => !b.icons.length).map((b) => b.name)
    expect(bare.length, bare.join(', ')).toBeLessThanOrEqual(3)
  })

  it('marks exactly the underwater Local Legends', async () => {
    const water = (await pool()).filter((b) => b.water)
    expect(water.every((b) => b.kind === 'legend')).toBe(true)
    // Every hand-kept name is still a legend of the data (a rename would drop one silently).
    for (const part of UNDERWATER) {
      expect(
        water.some((b) => b.name.includes(part)),
        part,
      ).toBe(true)
    }
  })

  it('filters by kind and by where; an empty filter lists all', async () => {
    const list = await pool()
    expect(list.filter((b) => listsBoss(b, [], []))).toHaveLength(list.length)
    expect(list.filter((b) => listsBoss(b, ['weekly'], [])).every((b) => b.kind === 'weekly')).toBe(
      true,
    )
    expect(list.filter((b) => listsBoss(b, [], ['water'])).every((b) => b.water)).toBe(true)
    expect(list.filter((b) => listsBoss(b, ['weekly'], ['water']))).toHaveLength(0)
  })

  it('picks one of the list', () => {
    expect(pickOne([])).toBeNull()
    expect(pickOne(['a', 'b'], () => 0)).toBe('a')
    expect(pickOne(['a', 'b'], () => 0.9999999)).toBe('b')
    expect(pickOne(['a', 'b'], () => 1)).toBe('b')
  })
})
