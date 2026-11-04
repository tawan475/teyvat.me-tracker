import { afterEach, describe, expect, it } from 'vitest'
import { parseWishTime } from '@gdt/shared'
import { LOCALIZED_ART_FROM, bannerArt, bannerArtFallback } from '@/components/wishes/banner-card'
import { runName } from '@/components/wishes/wish-labels'
import { locale } from '@/i18n/locale'
import type { EventBanner, PullRow } from '../wish-history'
import { bannerTitle, loadBannerNames, setBannerNamesForTest } from '../wish-banner-names'
import bannerFile from '../wish-banners.json'
import names from '../wish-banner-names.json'

const banner = (start: string, kind: EventBanner['kind'] = 'character'): EventBanner => ({
  kind,
  start: parseWishTime(start)! - 8 * 3600,
  end: 0,
  featured5: [],
  featured4: [],
  version: '7.2',
  name: 'Myriad Patterns Unfold',
  name400: 'Chanson of Many Waters',
})

describe('banner titles in the language on screen', () => {
  afterEach(() => {
    setBannerNamesForTest(null)
    locale.value = 'en'
  })

  it('answers the English title until the file is loaded, and in English always', () => {
    expect(bannerTitle('Myriad Patterns Unfold', 'th')).toBe('Myriad Patterns Unfold')
    setBannerNamesForTest({ 'Myriad Patterns Unfold': { th: 'หมื่นระเบียบงามบริบูรณ์' } })
    expect(bannerTitle('Myriad Patterns Unfold', 'en')).toBe('Myriad Patterns Unfold')
    expect(bannerTitle('Myriad Patterns Unfold', 'th')).toBe('หมื่นระเบียบงามบริบูรณ์')
  })

  it('falls back to English for a language or a title the file lacks, and keeps an empty name empty', () => {
    setBannerNamesForTest({ 'Myriad Patterns Unfold': { th: 'หมื่นระเบียบงามบริบูรณ์' } })
    expect(bannerTitle('Myriad Patterns Unfold', 'ja')).toBe('Myriad Patterns Unfold')
    expect(bannerTitle('Ballad in Goblets', 'th')).toBe('Ballad in Goblets')
    expect(bannerTitle('', 'th')).toBe('')
  })

  it('reads the language on screen by default (the pull table and tiles through runName)', () => {
    setBannerNamesForTest({ 'Chanson of Many Waters': { ja: '多水の歌' } })
    const on = banner('2026-11-04 06:00:00')
    const row = (gachaType: 301 | 400) =>
      ({ on, pull: { gachaType, item: {} } }) as unknown as PullRow
    expect(runName(row(400))).toBe('Chanson of Many Waters')
    locale.value = 'ja'
    expect(runName(row(400))).toBe('多水の歌')
    expect(runName(row(301))).toBe('Myriad Patterns Unfold')
  })

  it('ships Thai and Japanese titles for the 7.2 banners, keyed by titles the banner data has', async () => {
    await loadBannerNames()
    expect(bannerTitle('Myriad Patterns Unfold', 'th')).toBe('หมื่นระเบียบงามบริบูรณ์')
    expect(bannerTitle('Myriad Patterns Unfold', 'ja')).toBe('万物に通ずる理')
    expect(bannerTitle('Epitome Invocation', 'ja')).toBe('神鋳賦形')
    const titles = new Set(bannerFile.banners.flatMap((row) => [row[7], row[8]]).filter(Boolean))
    const table = names as Record<string, unknown>
    for (const [key, value] of Object.entries(table)) {
      if (key.startsWith('$')) continue
      expect(titles.has(key), `${key} is a banner title`).toBe(true)
      for (const [lang, title] of Object.entries(value as Record<string, string>)) {
        expect(typeof title === 'string' && title.trim().length > 0, `${key} ${lang}`).toBe(true)
      }
    }
    // Titles no post names in another language are listed, not silently dropped.
    expect(Array.isArray(table.$unmatched)).toBe(true)
  })
})

describe('banner art in the language on screen', () => {
  afterEach(() => {
    locale.value = 'en'
  })

  it('asks for the language’s art from the first translated phase on, English before', () => {
    const b = banner('2026-11-04 06:00:00')
    expect(bannerArt(b, false, 'en')).toMatch(/\/WishBanner_C_20261104\.webp$/)
    expect(bannerArt(b, false, 'th')).toMatch(/\/WishBanner_C_20261104_th\.webp$/)
    expect(bannerArt(b, true, 'zh-CN')).toMatch(/\/WishBanner_C_20261104_2_zh-CN\.webp$/)
    const old = banner('2021-03-02 18:00:00')
    expect(old.start).toBeLessThan(LOCALIZED_ART_FROM)
    expect(bannerArt(old, false, 'th')).toMatch(/\/WishBanner_C_20210302\.webp$/)
    locale.value = 'ja'
    expect(bannerArt(b)).toMatch(/_ja\.webp$/)
  })

  it('falls back to the English art from a localized URL, and from nothing else', () => {
    const b = banner('2026-11-04 06:00:00')
    expect(bannerArtFallback(bannerArt(b, true, 'zh-TW'))).toBe(bannerArt(b, true, 'en'))
    expect(bannerArtFallback(bannerArt(b, false, 'th'))).toBe(bannerArt(b, false, 'en'))
    expect(bannerArtFallback(bannerArt(b, false, 'en'))).toBeNull()
    expect(bannerArtFallback('https://example.test/UI_QualityBg_5.webp')).toBeNull()
  })
})
