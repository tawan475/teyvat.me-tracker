import { describe, expect, it } from 'vitest'
import type { Good } from '@gdt/shared'
import { buildRoster } from '@/data/characters'
import { BAND_CV_ON, BAND_TIER_COLOR } from '../share-card'
import {
  bandCv,
  bandRv,
  cardPieces,
  expShare,
  ownerParts,
  substatTotals,
} from '../share-card-model'

describe('the share card’s numbers', () => {
  it('fills the EXP bars: full at a cap, none without EXP', () => {
    expect(expShare(500, 1000)).toBe(50)
    expect(expShare(5000, 1000)).toBe(100)
    expect(expShare(null, null)).toBe(100)
    expect(expShare(null, 1000)).toBeNull()
    expect(expShare(500, undefined)).toBeNull()
  })

  it('tiers the band pills on 5★ pieces only', () => {
    expect(bandCv(5, 55, false)).toEqual({ color: BAND_TIER_COLOR[6], top: true })
    expect(bandCv(5, 10, false)).toEqual({ color: BAND_CV_ON, top: false })
    expect(bandCv(4, 55, false)).toEqual({ color: BAND_CV_ON, top: false })
    expect(bandCv(5, 0, false).color).toBe(BAND_TIER_COLOR[0])
    expect(bandRv(5, 950)).toEqual({ color: BAND_TIER_COLOR[6], top: true })
    expect(bandRv(4, 950)).toEqual({ color: BAND_TIER_COLOR[0], top: false })
  })

  it('writes the owner line from what is shown', () => {
    expect(ownerParts({ name: 'player01', uid: '812345678', ar: 60 })).toEqual([
      'player01',
      'UID 812345678',
      'AR 60',
    ])
    expect(ownerParts({ name: null, uid: null, ar: null })).toEqual([])
  })

  it('keeps five slots, four lines each at most, the unactivated one last', () => {
    const good = {
      format: 'GOOD',
      version: 3,
      source: 'test',
      characters: [
        {
          key: 'Furina',
          level: 90,
          constellation: 0,
          ascension: 6,
          talent: { auto: 1, skill: 1, burst: 1 },
        },
      ],
      weapons: [],
      artifacts: [
        {
          setKey: 'GoldenTroupe',
          slotKey: 'goblet',
          level: 0,
          rarity: 5,
          mainStatKey: 'hydro_dmg_',
          location: 'Furina',
          lock: false,
          substats: [
            { key: 'critRate_', value: 3.5 },
            { key: 'hp_', value: 5.8 },
            { key: 'atk', value: 19 },
          ],
          unactivatedSubstats: [{ key: 'critDMG_', value: 7.0 }],
        },
      ],
      materials: {},
    } as unknown as Good
    const pieces = cardPieces(buildRoster(good).characters[0]!)
    expect(pieces.map((p) => p.slot)).toEqual(['flower', 'plume', 'sands', 'goblet', 'circlet'])
    expect(pieces.filter((p) => p.piece).map((p) => p.slot)).toEqual(['goblet'])
    const goblet = pieces[3]!
    expect(goblet.lines.map((l) => [l.key, l.inactive])).toEqual([
      ['critRate_', false],
      ['hp_', false],
      ['atk', false],
      ['critDMG_', true],
    ])
    expect(goblet.lines[3]!.rolls).toEqual([])
  })

  it('adds the substats up over the pieces: CRIT first, then most rolls', () => {
    const piece = (slotKey: string, substats: { key: string; value: number }[]) => ({
      setKey: 'GoldenTroupe',
      slotKey,
      level: 20,
      rarity: 5,
      mainStatKey: slotKey === 'flower' ? 'hp' : 'atk',
      location: 'Furina',
      lock: false,
      substats,
    })
    const good = {
      format: 'GOOD',
      version: 3,
      source: 'test',
      characters: [
        {
          key: 'Furina',
          level: 90,
          constellation: 0,
          ascension: 6,
          talent: { auto: 1, skill: 1, burst: 1 },
        },
      ],
      weapons: [],
      artifacts: [
        piece('flower', [
          { key: 'hp_', value: 17.5 }, // 3 × 5.83
          { key: 'critDMG_', value: 7.8 }, // 1
          { key: 'atk', value: 19 }, // 1
          { key: 'er_', value: 6.5 }, // unknown key: no rolls
        ]),
        piece('plume', [
          { key: 'hp_', value: 11.7 }, // 2 × 5.83
          { key: 'critDMG_', value: 15.5 }, // 2
          { key: 'critRate_', value: 3.9 }, // 1
          { key: 'def', value: 23 }, // 1
        ]),
      ],
      materials: {},
    } as unknown as Good
    const totals = substatTotals(buildRoster(good).characters[0]!)
    expect(totals.map((t) => [t.key, Number(t.value.toFixed(1)), t.rolls, t.crit])).toEqual([
      ['critRate_', 3.9, 1, true],
      ['critDMG_', 23.3, 3, true],
      ['hp_', 29.2, 5, false],
      ['def', 23, 1, false],
      ['atk', 19, 1, false],
      ['er_', 6.5, 0, false],
    ])
    expect(substatTotals(buildRoster({ ...good, artifacts: [] }).characters[0]!)).toEqual([])
  })
})
