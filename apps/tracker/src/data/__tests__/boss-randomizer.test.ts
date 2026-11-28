import { describe, expect, it } from 'vitest'
import { loadEnemies, loadEnemyNames } from '@gdt/game-data/enemies'
import { loadFarming } from '@gdt/game-data/farming'
import {
  BOSS_KINDS,
  BOSS_REEL,
  SOLO_ONLY,
  UNDERWATER,
  bossPool,
  listsBoss,
  otherIcons,
  pickOne,
  reelOf,
} from '../boss-randomizer'

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

  it('marks exactly the Local Legends fought alone only', async () => {
    const solo = (await pool()).filter((b) => b.solo)
    expect(solo.every((b) => b.kind === 'legend')).toBe(true)
    expect(solo).toHaveLength(SOLO_ONLY.length)
    for (const part of SOLO_ONLY) {
      expect(
        solo.some((b) => b.name.includes(part)),
        part,
      ).toBe(true)
    }
  })

  it('filters by co-op or single player', async () => {
    const list = await pool()
    const solo = list.filter((b) => listsBoss(b, [], [], ['solo']))
    const coop = list.filter((b) => listsBoss(b, [], [], ['coop']))
    expect(solo).toHaveLength(SOLO_ONLY.length)
    expect(solo.length + coop.length).toBe(list.length)
    expect(list.filter((b) => listsBoss(b, [], [], ['coop', 'solo']))).toHaveLength(list.length)
    expect(list.filter((b) => listsBoss(b, ['weekly'], [], ['solo']))).toHaveLength(0)
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

  it('shows the different monsters of a fight small', async () => {
    expect(otherIcons({ icons: ['a', 'a'] })).toEqual([])
    expect(otherIcons({ icons: ['a', 'b', 'b'] })).toEqual(['b'])
    expect(otherIcons({ icons: ['a'] })).toEqual([])
    const list = await pool()
    expect(list.some((b) => b.icons.length === 3)).toBe(true)
  })

  it('runs the reel past pictured bosses, never one twice in a row or the result last', () => {
    const pool = ['a', 'b', 'c', 'd'].map((key) => ({ key, icons: [key] }))
    for (let seed = 0; seed < 50; seed++) {
      let n = seed
      const random = () => (n = (n * 9301 + 49297) % 233280) / 233280
      const reel = reelOf([...pool, { key: 'bare', icons: [] }], 'a', BOSS_REEL, random)
      expect(reel).toHaveLength(BOSS_REEL)
      expect(reel.every((b) => b.icons.length)).toBe(true)
      for (let i = 1; i < reel.length; i++) expect(reel[i]!.key).not.toBe(reel[i - 1]!.key)
      expect(reel.at(-1)!.key).not.toBe('a')
    }
    expect(reelOf(pool.slice(0, 1), 'a')).toEqual([])
  })
})
