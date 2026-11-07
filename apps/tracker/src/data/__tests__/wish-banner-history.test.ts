import { describe, expect, it } from 'vitest'
import { bannerHistory, featuring, pulledOnly } from '../wish-banner-history'
import type { BannerRun, EventBanner } from '../wish-history'

const banner = (version: string, start: number, five: string, name = five): EventBanner => ({
  kind: 'character',
  start,
  end: start + 100,
  featured5: [five],
  featured4: ['Bennett'],
  version,
  name,
  name400: '',
})

describe('banner history', () => {
  const banners = [
    banner('1.0', 10, 'Venti'),
    banner('1.0', 20, 'Klee'),
    banner('1.1', 30, 'Tartaglia'),
    banner('1.1', 30, 'Zhongli', 'Second'),
    banner('1.1', 40, 'Albedo'),
    banner('9.9', 999, 'Future'),
  ]
  const runs: BannerRun[] = [{ banner: banners[1]!, pulls: 12, fives: [] }]

  it('groups by version newest first, numbers phases by start, lists banners not out yet', () => {
    const out = bannerHistory(banners, runs)
    expect(out.map((v) => v.version)).toEqual(['9.9', '1.1', '1.0'])
    expect(out.shift()!.rows.map((r) => r.banner.name)).toEqual(['Future'])
    expect(out[0]!.rows.map((r) => [r.banner.name, r.phase])).toEqual([
      ['Albedo', 2],
      ['Second', 1],
      ['Tartaglia', 1],
    ])
    expect(out[1]!.rows.map((r) => [r.banner.name, r.phase, r.run?.pulls ?? 0])).toEqual([
      ['Klee', 2, 12],
      ['Venti', 1, 0],
    ])
  })

  it('keeps only pulled banners, or banners featuring a match', () => {
    const out = bannerHistory(banners, runs)
    expect(pulledOnly(out).flatMap((v) => v.rows.map((r) => r.banner.name))).toEqual(['Klee'])
    expect(
      featuring(out, (key) => key.startsWith('Zh')).flatMap((v) =>
        v.rows.map((r) => r.banner.name),
      ),
    ).toEqual(['Second'])
  })
})
