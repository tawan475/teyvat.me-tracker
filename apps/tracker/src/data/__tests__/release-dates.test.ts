import { describe, expect, it } from 'vitest'
import file from '../wish-banners.json'
import { releaseDates, releasedKeys } from '../release-dates'
import type { BannerFile } from '../wish-history'

// Time travel's "released by then" (src/data/release-dates.ts), on the real
// banner file.

describe('release dates', () => {
  const dates = releaseDates(file as unknown as BannerFile)
  const ms = (text: string) => Date.parse(`${text}+08:00`)

  it('dates a character and a weapon by their first banner', () => {
    expect(dates.get('Venti')).toBe(ms('2020-09-28T00:00:00'))
    // A 4★ dates from the first banner it was featured on.
    expect(dates.get('Bennett')).toBeLessThan(ms('2021-01-01T00:00:00'))
    expect(dates.get('Mitya')).toBeGreaterThan(ms('2026-10-31T00:00:00'))
  })

  it('keeps what was out by then, and what was never on a banner', () => {
    const at = ms('2026-10-13T23:52:00')
    expect(releasedKeys(['Venti', 'Mitya', 'Diluc', 'NoBannerEver'], dates, at)).toEqual([
      'Venti',
      'Diluc',
      'NoBannerEver',
    ])
  })
})
