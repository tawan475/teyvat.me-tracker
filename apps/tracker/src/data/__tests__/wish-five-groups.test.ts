import { describe, expect, it } from 'vitest'
import { parseWishTime, resolveWishItem, type GachaType, type WishPull } from '@gdt/shared'
import { fiveGroups } from '../wish-five-groups'
import type { BannerRun, EventBanner, PullRow } from '../wish-history'

const banner = (name: string, start: number): EventBanner => ({
  kind: 'character',
  start,
  end: start + 1_000_000,
  featured5: ['Furina'],
  featured4: [],
  version: '9.9',
  name,
  name400: '',
})
const pull = (time: string): WishPull => ({
  id: 1n,
  time: parseWishTime(time)!,
  gachaType: 301 as GachaType,
  item: resolveWishItem({ name: 'Furina' }),
})
const row = (time: string, on: EventBanner | null): PullRow => ({
  pull: pull(time),
  number: 1,
  pity: 80,
  outcome: null,
  on,
})

describe('Every 5★ groups', () => {
  it('groups by banner run, newest first, numbering every 5★ from the newest down', () => {
    const one = banner('One', 1)
    const two = banner('Two', 2)
    const fives = [
      row('2026-10-03 10:00:00', two),
      row('2026-10-01 10:00:00', two),
      row('2026-09-12 10:00:00', one),
    ]
    const runs: BannerRun[] = [
      { banner: one, pulls: 90, fives: [fives[2]!] },
      { banner: two, pulls: 160, fives: [fives[1]!, fives[0]!] },
    ]
    const groups = fiveGroups(fives, runs)
    expect(groups.map((g) => [g.banner?.name, g.run?.pulls, g.fives.map((f) => f.number)])).toEqual(
      [
        ['Two', 160, [3, 2]],
        ['One', 90, [1]],
      ],
    )
  })

  it('groups pulls without a banner run by month', () => {
    const groups = fiveGroups(
      [
        row('2026-10-03 10:00:00', null),
        row('2026-10-01 10:00:00', null),
        row('2026-08-30 10:00:00', null),
      ],
      [],
    )
    expect(groups.map((g) => [g.month, g.fives.length])).toEqual([
      ['2026-10', 2],
      ['2026-08', 1],
    ])
  })
})
