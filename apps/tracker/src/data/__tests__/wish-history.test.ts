import { describe, expect, it } from 'vitest'
import {
  parseWishTime,
  resolveWishItem,
  type GachaType,
  type UigfGachaType,
  type WishPull,
} from '@gdt/shared'
import bannerFile from '../wish-banners.json'
import {
  bannerAt,
  bannerStats,
  currentRun,
  eventBanners,
  monthlyPulls,
  pityBand,
  pityHistogram,
  runPullNumbers,
  type BannerFile,
  type EventBanner,
  type EventKind,
} from '../wish-history'

const T0 = parseWishTime('2026-03-01 12:00:00')!

/** Pulls from names; `400` marks a pull on the second character banner. */
function history(banner: UigfGachaType, names: (string | [string, 400])[], start = T0): WishPull[] {
  return names.map((entry, i) => {
    const [name, type] = Array.isArray(entry) ? entry : [entry, banner]
    return {
      id: 1_780_000_000_000_000_000n + BigInt(i),
      time: start + i * 60,
      gachaType: type as GachaType,
      item: resolveWishItem({ name }),
    }
  })
}

const filler = (n: number, name = 'Slingshot') => Array.from({ length: n }, () => name)

function banners(
  kind: EventKind,
  featured5: string[],
  featured4: string[] = ['Bennett', 'Xingqiu', 'Diona'],
): Map<EventKind, EventBanner[]> {
  return new Map([
    [
      kind,
      [
        {
          kind,
          start: 0,
          end: 4e9,
          featured5,
          featured4,
          version: '9.9',
          name: 'Test',
          name400: '',
        },
      ],
    ],
  ])
}

describe('wish pity', () => {
  it('counts 301 and 400 together, and a 5★ leaves the 4★ count running', () => {
    const pulls = history(301, [
      ...filler(40),
      ...filler(39).map((n) => [n, 400] as [string, 400]),
      ['Furina', 400],
      ...filler(5),
      'Bennett',
      ...filler(3),
    ])
    const stats = bannerStats(301, pulls, { timezone: 8, banners: null })
    expect(stats.total).toBe(89)
    expect(stats.fives.map((r) => [r.pull.item.key, r.pity, r.number])).toEqual([
      ['Furina', 80, 80],
    ])
    expect(stats.fours[0]!.pity).toBe(86)
    expect(stats.pity5).toBe(9)
    expect(stats.pity4).toBe(3)
    // No banner data: no 50/50.
    expect(stats.guaranteed5).toBeNull()
    expect(stats.fives[0]!.outcome).toBeNull()
  })

  it('tells 50/50s won, lost and guaranteed on the character banner', () => {
    const pulls = history(301, [
      ...filler(10),
      'Diluc', // lost
      ...filler(10),
      'Furina', // guaranteed
      ...filler(10),
      'Furina', // won
      ...filler(10),
      'Qiqi', // lost
      'Jean', // lost (while guaranteed: the data says otherwise; counted lost)
    ])
    const stats = bannerStats(301, pulls, {
      timezone: 8,
      banners: banners('character', ['Furina']),
    })
    expect(stats.fives.map((r) => r.outcome).reverse()).toEqual([
      'lost',
      'guaranteed',
      'won',
      'lost',
      'lost',
    ])
    expect(stats.guaranteed5).toBe(true)
    expect(stats.rate5).toMatchObject({
      won: 1,
      lost: 3,
      rate: 0.25,
      winStreak: 0,
      loseStreak: 2,
      maxWinStreak: 1,
      maxLoseStreak: 2,
    })
    // paimon.moe's table: 5★ count, share of all pulls, average pity.
    expect(stats.five.count).toBe(5)
    expect(stats.five.share).toBeCloseTo(5 / pulls.length)
    expect(stats.five.avgPity).toBeCloseTo((11 + 11 + 11 + 11 + 1) / 5)
    expect(stats.runs).toMatchObject([{ pulls: pulls.length }])
    expect(stats.runs[0]!.fives.length).toBe(5)
  })

  it('marks the 50/50 after two losses since 5.0 as Capturing Radiance', () => {
    const fifty = (name: string) => [...filler(5), name]
    const pulls = history(301, [
      ...fifty('Diluc'), // lost: 1 → 2
      ...fifty('Furina'), // guaranteed
      ...fifty('Qiqi'), // lost: 2 → 3
      ...fifty('Furina'), // guaranteed
      ...fifty('Furina'), // radiance: 3 → 1
      ...fifty('Furina'), // won: 1 → 0
      ...fifty('Furina'), // won: stays 0
      ...fifty('Mona'), // lost: 0 → 1
      ...fifty('Furina'), // guaranteed
      ...fifty('Furina'), // won: 1 → 0, never radiance
    ])
    const stats = bannerStats(301, pulls, {
      timezone: 8,
      banners: banners('character', ['Furina']),
    })
    expect(stats.fives.map((r) => r.outcome).reverse()).toEqual([
      'lost',
      'guaranteed',
      'lost',
      'guaranteed',
      'radiance',
      'won',
      'won',
      'lost',
      'guaranteed',
      'won',
    ])
    expect(stats.rate5).toMatchObject({ won: 4, lost: 3, radiance: 1 })
  })

  it('leaves Capturing Radiance out before 5.0 and on other banners', () => {
    const names = ['Diluc', 'Furina', 'Qiqi', 'Furina', 'Furina'].flatMap((n) => [...filler(5), n])
    const before = bannerStats(301, history(301, names, parseWishTime('2023-01-01 12:00:00')!), {
      timezone: 8,
      banners: banners('character', ['Furina']),
    })
    expect(before.fives.map((r) => r.outcome)).not.toContain('radiance')
    const weapon = bannerStats(
      302,
      history(
        302,
        names.map((n) => (n === 'Furina' ? 'Absolution' : n === 'Slingshot' ? n : 'Skyward Harp')),
      ),
      { timezone: 8, banners: banners('weapon', ['Absolution'], []) },
    )
    expect(weapon.fives.map((r) => r.outcome)).not.toContain('radiance')
  })

  it('tracks the 4★ guarantee from the featured three', () => {
    const pulls = history(301, [
      ...filler(9),
      'Fischl',
      ...filler(9),
      'Bennett',
      ...filler(2),
      'Barbara',
    ])
    const stats = bannerStats(301, pulls, {
      timezone: 8,
      banners: banners('character', ['Furina']),
    })
    expect(stats.fours.map((r) => r.outcome).reverse()).toEqual(['lost', 'guaranteed', 'lost'])
    expect(stats.guaranteed4).toBe(true)
    expect(stats.rate4).toMatchObject({ won: 0, lost: 2 })
    expect(stats.fourCharacter.count).toBe(3)
    expect(stats.fourWeapon.count).toBe(0)
  })

  it('reads the weapon banner as 75/25 between its two and the standard ones', () => {
    const pulls = history(302, [
      ...filler(60),
      'Skyward Harp',
      ...filler(10),
      'Splendor of Tranquil Waters',
    ])
    const stats = bannerStats(302, pulls, {
      timezone: 8,
      banners: banners('weapon', ['SplendorOfTranquilWaters', 'Absolution'], []),
    })
    expect(stats.fives.map((r) => [r.pity, r.outcome]).reverse()).toEqual([
      [61, 'lost'],
      [11, 'guaranteed'],
    ])
    expect(stats.guaranteed5).toBe(false)
  })

  it('stops guessing after a pull outside the banner data', () => {
    const outside: Map<EventKind, EventBanner[]> = new Map([
      [
        'character',
        [
          {
            kind: 'character',
            start: 0,
            end: 1,
            featured5: [],
            featured4: [],
            version: '',
            name: '',
            name400: '',
          },
        ],
      ],
    ])
    const stats = bannerStats(301, history(301, [...filler(5), 'Diluc']), {
      timezone: 8,
      banners: outside,
    })
    expect(stats.fives[0]!.outcome).toBeNull()
    expect(stats.guaranteed5).toBeNull()
  })

  it('keeps standard, beginners and chronicled to pity', () => {
    const stats = bannerStats(200, history(200, [...filler(3), 'Diluc']), {
      timezone: 8,
      banners: banners('character', ['Diluc']),
    })
    expect(stats.fives[0]).toMatchObject({ pity: 4, outcome: null })
    expect(stats.guaranteed5).toBeNull()
  })
})

describe('wish charts', () => {
  it('counts pulls per month without gaps, and 5★ per pity', () => {
    const jan = parseWishTime('2026-01-31 23:00:00')!
    const pulls = history(200, [...filler(3), 'Diluc'], jan)
    const apr = history(200, ['Bennett'], parseWishTime('2026-04-02 10:00:00')!)
    const stats = bannerStats(200, [...pulls, { ...apr[0]!, id: 1_790_000_000_000_000_000n }], {
      timezone: 8,
      banners: null,
    })
    expect(monthlyPulls([stats])).toEqual([
      { month: '2026-01', total: 4, five: 1, four: 0 },
      { month: '2026-02', total: 0, five: 0, four: 0 },
      { month: '2026-03', total: 0, five: 0, four: 0 },
      { month: '2026-04', total: 1, five: 0, four: 1 },
    ])
    const hist = pityHistogram(stats.fives, 90)
    expect(hist.length).toBe(90)
    expect(hist[3]).toBe(1)
    expect(hist.reduce((a, b) => a + b, 0)).toBe(1)
  })
  it("numbers pulls within their banner run (paimon.moe's #Roll)", () => {
    const first: EventBanner = {
      kind: 'character',
      start: 0,
      end: T0 + 120,
      featured5: ['Diluc'],
      featured4: [],
      version: '9.8',
      name: 'One',
      name400: '',
    }
    const second: EventBanner = { ...first, start: T0 + 121, end: 4e9, version: '9.9', name: 'Two' }
    const events = new Map<EventKind, EventBanner[]>([['character', [first, second]]])
    // Three pulls on the first run (T0, +60, +120), two on the second.
    const stats = bannerStats(301, history(301, filler(5)), { timezone: 0, banners: events })
    const rolls = runPullNumbers(stats.rows)
    expect(stats.rows.map((r) => rolls.get(r))).toEqual([2, 1, 3, 2, 1])
    const standard = bannerStats(200, history(200, filler(3)), { timezone: 0, banners: null })
    const plain = runPullNumbers(standard.rows)
    expect(standard.rows.map((r) => plain.get(r))).toEqual([3, 2, 1])
  })
})

describe('wish overview figures', () => {
  it('keeps win streaks through guaranteed pulls, and the longest win and loss runs', () => {
    // won, won, lost, guaranteed, won, won, won, lost, lost(while guaranteed), won
    const names = ['Furina', 'Furina', 'Diluc', 'Furina', 'Furina', 'Furina', 'Furina']
    const pulls = history(301, [
      ...names.flatMap((n) => [...filler(5), n]),
      ...filler(5),
      'Qiqi',
      ...filler(5),
      'Jean',
      ...filler(5),
      'Furina',
    ])
    const stats = bannerStats(301, pulls, {
      timezone: 8,
      banners: banners('character', ['Furina']),
    })
    expect(stats.fives.map((r) => r.outcome).reverse()).toEqual([
      'won',
      'won',
      'lost',
      'guaranteed',
      'won',
      'won',
      'won',
      'lost',
      'lost',
      'guaranteed',
    ])
    expect(stats.rate5).toMatchObject({
      won: 5,
      lost: 3,
      winStreak: 0,
      maxWinStreak: 3,
      loseStreak: 2,
      maxLoseStreak: 2,
    })
  })

  it('reads a 5★ pity as early, before soft pity, soft or late, per banner', () => {
    expect([1, 50, 51, 73, 74, 79, 80, 90].map((p) => pityBand(p, 301))).toEqual([
      'early',
      'early',
      'mid',
      'mid',
      'soft',
      'soft',
      'late',
      'late',
    ])
    expect([43, 44, 62, 63, 68, 69, 80].map((p) => pityBand(p, 302))).toEqual([
      'early',
      'mid',
      'mid',
      'soft',
      'soft',
      'late',
      'late',
    ])
  })

  it('finds the run open now, if the account pulled on it', () => {
    const first: EventBanner = {
      kind: 'character',
      start: 0,
      end: T0 + 120,
      featured5: ['Diluc'],
      featured4: [],
      version: '9.8',
      name: 'One',
      name400: '',
    }
    const second: EventBanner = { ...first, start: T0 + 121, end: T0 + 9999, name: 'Two' }
    const events = new Map<EventKind, EventBanner[]>([['character', [first, second]]])
    const stats = bannerStats(301, history(301, filler(5)), { timezone: 0, banners: events })
    expect(currentRun(stats.runs, T0 + 500)?.banner.name).toBe('Two')
    expect(currentRun(stats.runs, T0 + 60)?.banner.name).toBe('One')
    expect(currentRun(stats.runs, T0 + 10_000)).toBeNull()
    // Pulled only on the first: the second being open is not a run of the account's.
    const old = bannerStats(301, history(301, filler(2)), { timezone: 0, banners: events })
    expect(currentRun(old.runs, T0 + 500)).toBeNull()
  })
})

describe('banner data', () => {
  const file = bannerFile as unknown as BannerFile

  it('finds the featured character of a dual phase, on every server clock', () => {
    for (const tz of [8, 1, -5]) {
      const list = eventBanners(file, tz).get('character')!
      // 2026-09-30 noon on that server's clock.
      const at = parseWishTime('2026-09-30 12:00:00')! - tz * 3600
      const on = bannerAt(list, at)
      expect(on?.featured5).toContain('Vesna')
      expect(on?.name).toBe('When Warm Winds Cavort')
      expect(on?.name400).toBe('Surging Ballad')
    }
  })

  it('lists banners with known featured keys, oldest first', () => {
    const map = eventBanners(file, 8)
    for (const [, list] of map) {
      for (let i = 1; i < list.length; i++)
        expect(list[i]!.start).toBeGreaterThanOrEqual(list[i - 1]!.start)
      for (const b of list) expect(b.featured5.length).toBeGreaterThan(0)
    }
    expect(map.get('weapon')!.length).toBeGreaterThan(100)
  })
})
