import { describe, expect, it } from 'vitest'
import { characterMeta } from '@/data/game-meta'
import { GI_CDN_BASE } from '@/lib/assets'
import {
  BAND_EMBLEM,
  CHIP_OPAQUE,
  BAND_ICON,
  BAND_ICON_RIGHT,
  BAND_WIDTH,
  EMBLEM,
  EMBLEM_URL,
  PIECE_HEIGHT,
  QUALITY_ART,
  SPLASH_BOX_SCALE,
  SPLASH_FULL,
  SPLASH_LEFT,
  SPLASH_NUDGE,
  WEAPON_EMBLEM,
  chipBackground,
  emblemBox,
  qualityArt,
  splashFull,
  splashPlace,
  totalsGridHeight,
} from '../share-card'

describe('the emblem over the header art', () => {
  it("puts its knot on the icon's centre and its foot on the box's foot", () => {
    const box = emblemBox(200, 150)
    expect(box.left + EMBLEM.knotX * box.scale).toBeCloseTo(150)
    expect(box.top + EMBLEM.knotY * box.scale).toBeCloseTo(100)
    expect(box.top + box.height).toBeCloseTo(200)
    expect(box.width / box.height).toBeCloseTo(EMBLEM.width / EMBLEM.height)
  })

  it('takes another icon centre height', () => {
    const box = emblemBox(200, 150, 80)
    expect(box.top + EMBLEM.knotY * box.scale).toBeCloseTo(80)
    expect(box.top + box.height).toBeCloseTo(200)
  })

  it("is the design's on a piece's band: a 187.2px panel, the icon centred at x 184", () => {
    expect(PIECE_HEIGHT).toBeCloseTo(187.2)
    expect(BAND_WIDTH - BAND_ICON_RIGHT - BAND_ICON / 2).toBe(184)
    expect(BAND_EMBLEM.scale).toBeCloseTo(187.2 / 232)
    expect(BAND_EMBLEM.scale).toBeCloseTo(0.807, 3)
    expect(BAND_EMBLEM.width).toBeCloseTo(413.1, 1)
    expect(BAND_EMBLEM.height).toBeCloseTo(206.6, 1)
    expect(BAND_EMBLEM.left).toBeCloseTo(-131.6, 1)
    expect(BAND_EMBLEM.top).toBeCloseTo(-19.4, 1)
  })

  it("is the design's on the weapon's 128px tile, knot on its centre", () => {
    expect(WEAPON_EMBLEM.scale).toBeCloseTo(128 / 232)
    expect(WEAPON_EMBLEM.scale).toBeCloseTo(0.552, 3)
    expect(WEAPON_EMBLEM.width).toBeCloseTo(282.5, 1)
    expect(WEAPON_EMBLEM.height).toBeCloseTo(141.2, 1)
    expect(WEAPON_EMBLEM.left).toBeCloseTo(-151.8, 1)
    expect(WEAPON_EMBLEM.top).toBeCloseTo(-13.2, 1)
  })
})

describe('rarity gradients', () => {
  it("maps rarity to the game's quality names", () => {
    expect(QUALITY_ART).toEqual({
      5: 'UI_QUALITY_ORANGE',
      4: 'UI_QUALITY_PURPLE',
      3: 'UI_QUALITY_BLUE',
      2: 'UI_QUALITY_GREEN',
      1: 'UI_QUALITY_WHITE',
    })
  })

  it('loads them and the emblem from gi-cdn, none without a rarity', () => {
    expect(qualityArt(5)).toBe(`${GI_CDN_BASE}UI_QUALITY_ORANGE.webp`)
    expect(qualityArt(4)).toBe(`${GI_CDN_BASE}UI_QUALITY_PURPLE.webp`)
    expect(qualityArt(1)).toBe(`${GI_CDN_BASE}UI_QUALITY_WHITE.webp`)
    expect(EMBLEM_URL).toBe(`${GI_CDN_BASE}UI_ImgSign_ItemTips.webp`)
    for (const none of [0, 6, null, undefined]) expect(qualityArt(none)).toBe('')
  })
})

describe('the splash art', () => {
  it("moves left by 7.5% of the character column's 700px", () => {
    expect(SPLASH_LEFT).toBeCloseTo(-712.5)
  })

  it('sits at the shared spot without a nudge', () => {
    expect(splashPlace('Bennett')).toEqual({ left: SPLASH_LEFT, top: -20 })
  })

  it("moves down in % of the card's 1080px and sideways in % of the 700px column", () => {
    expect(splashPlace('Zhongli').top).toBeCloseTo(-20 + 54)
    expect(splashPlace('Nahida').top).toBeCloseTo(-20 - 108)
    expect(splashPlace('Yanfei')).toEqual({ left: SPLASH_LEFT + 49, top: -20 + 0.08 * 1080 })
    expect(splashPlace('HuTao').left).toBeCloseTo(SPLASH_LEFT - 21)
    expect(splashPlace('Manekina').left).toBeCloseTo(SPLASH_LEFT - 28)
  })

  it('gives every Traveler the same nudge', () => {
    for (const key of ['Traveler', 'TravelerAnemo', 'TravelerHydro']) {
      expect(splashPlace(key).top).toBeCloseTo(-20 + 270)
    }
  })

  it('only names characters the game data knows', () => {
    for (const key of Object.keys(SPLASH_NUDGE)) {
      expect(characterMeta(key), key).toBeDefined()
    }
  })
})

describe('the uncut wish art', () => {
  it('only names characters the game data knows, on gi-cdn', () => {
    for (const key of Object.keys(SPLASH_FULL)) {
      expect(characterMeta(key), key).toBeDefined()
      expect(splashFull(key)?.src).toBe(`${GI_CDN_BASE}FullWish_${key}.webp`)
    }
    expect(splashFull('Bennett')).toBeNull()
  })

  it("places the art in box px: its frame scaled by the box's 2200/2048", () => {
    const k = SPLASH_BOX_SCALE
    expect(k).toBeCloseTo(2200 / 2048)
    const m = SPLASH_FULL.Mavuika!
    expect(splashFull('Mavuika')!.style).toEqual({
      left: `${m.x * k}px`,
      top: `${m.y * k}px`,
      width: `${m.width * m.scale * k}px`,
      height: `${m.height * m.scale * k}px`,
    })
    // Mavuika's full art continues below the game art's cut (its 1024px frame).
    expect(m.y + m.height * m.scale).toBeGreaterThan(1024)
  })
})

describe('the small text backing', () => {
  it("is the theme's own unless a character overrides it, never fainter", () => {
    expect(chipBackground('Bennett', 'dark')).toBeUndefined()
    expect(chipBackground('Mavuika', 'dark')).toBe('rgba(15,23,42,0.92)')
    expect(chipBackground('Mavuika', 'light')).toBe('rgba(255,255,255,0.92)')
    for (const key of Object.keys(CHIP_OPAQUE)) expect(characterMeta(key), key).toBeDefined()
  })
})

describe('the substats grid in the sets panel', () => {
  it('is two columns of 30 px rows with 4 px between', () => {
    expect(totalsGridHeight(0)).toBe(0)
    expect(totalsGridHeight(1)).toBe(30)
    expect(totalsGridHeight(2)).toBe(30)
    expect(totalsGridHeight(8)).toBe(4 * 30 + 3 * 4)
    expect(totalsGridHeight(10)).toBe(5 * 30 + 4 * 4)
  })
})
