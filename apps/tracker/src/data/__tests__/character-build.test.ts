import { decodePlanner } from '@gdt/game-data'
import plannerJson from '@gdt/game-data/data/planner.json'
import type { PlannerFile } from '@gdt/game-data/format'
import { constellationBoosts } from '@gdt/game-data/planner-math'
import { computeStats, type PanelStats } from '@gdt/game-data/stats'
import { describe, expect, it } from 'vitest'
import {
  bonusSets,
  buildPanel,
  buildRv,
  damageBonuses,
  formatPanelValue,
  panelRows,
  setBonusLines,
  setBonusTitle,
  shareUid,
  talentLevels,
  talentTitle,
  weaponLines,
} from '@/data/character-build'

const planner = decodePlanner(plannerJson as unknown as PlannerFile)

function panel(overrides: Partial<PanelStats> = {}): PanelStats {
  return {
    hp: 18663,
    atk: 715,
    def: 876,
    em: 0,
    critRate: 5,
    critDmg: 154.6,
    er: 100,
    elementalDmg: { anemo: 0, geo: 0, electro: 0, dendro: 0, hydro: 0, pyro: 0, cryo: 0 },
    physicalDmg: 0,
    healing: 0,
    base: { hp: 15552, atk: 715, def: 876 },
    other: {},
    ...overrides,
  }
}

const homa = { key: 'StaffOfHoma', level: 90, ascension: 6, refinement: 1 }

const NO_DMG = { anemo: 0, geo: 0, electro: 0, dendro: 0, hydro: 0, pyro: 0, cryo: 0 }

describe('panelRows', () => {
  it("lists the Attributes screen in the game order, with the build's DMG bonus", () => {
    const rows = panelRows(panel({ elementalDmg: { ...NO_DMG, pyro: 61.6 } }))
    expect(rows.map((r) => r.key)).toEqual([
      'hp',
      'atk',
      'def',
      'eleMas',
      'critRate_',
      'critDMG_',
      'enerRech_',
      'pyro_dmg_',
    ])
    expect(rows.map((r) => r.label)).toEqual([
      'Max HP',
      'ATK',
      'DEF',
      'Elemental Mastery',
      'CRIT Rate',
      'CRIT DMG',
      'Energy Recharge',
      'Pyro DMG Bonus',
    ])
    expect(rows.at(-1)).toMatchObject({ value: 61.6, text: '61.6%', damage: 'pyro' })
  })

  it('splits HP, ATK and DEF into base and bonus', () => {
    const [hp] = panelRows(panel())
    expect(hp).toMatchObject({ text: '18,663', base: 15552, bonus: 3111 })
  })

  it('adds Healing Bonus before Energy Recharge', () => {
    const rows = panelRows(panel({ healing: 15.4 }))
    expect(rows.map((r) => r.key).slice(6)).toEqual(['heal_', 'enerRech_'])
  })

  it('has no DMG bonus row when every bonus is 0', () => {
    expect(panelRows(panel()).some((r) => r.damage)).toBe(false)
  })

  it('formats like the game', () => {
    expect(formatPanelValue('hp', 18662.7)).toBe('18,663')
    expect(formatPanelValue('eleMas', 0)).toBe('0')
    expect(formatPanelValue('critRate_', 62.2)).toBe('62.2%')
    expect(formatPanelValue('enerRech_', 100)).toBe('100.0%')
  })
})

describe('damageBonuses', () => {
  it("picks the bonus the build has, not the character's element (Diluc with a Cryo goblet)", () => {
    // Crimson Witch 2-piece (Pyro 15%) plus a Cryo goblet and Blizzard Strayer 2-piece.
    const diluc = panel({ elementalDmg: { ...NO_DMG, pyro: 15, cryo: 61.6 } })
    expect(damageBonuses(diluc)).toEqual([{ kind: 'cryo', value: 61.6 }])
    expect(
      panelRows(diluc)
        .filter((r) => r.damage)
        .map((r) => r.label),
    ).toEqual(['Cryo DMG Bonus'])
  })

  it('picks physical', () => {
    const eula = panel({ physicalDmg: 83.3, elementalDmg: { ...NO_DMG, cryo: 15 } })
    expect(damageBonuses(eula)).toEqual([{ kind: 'physical', value: 83.3 }])
    expect(panelRows(eula).at(-1)).toMatchObject({
      key: 'physical_dmg_',
      label: 'Physical DMG Bonus',
      text: '83.3%',
    })
  })

  it("lists ties in the game's order", () => {
    const tied = panel({ physicalDmg: 46.6, elementalDmg: { ...NO_DMG, electro: 46.6, hydro: 15 } })
    expect(damageBonuses(tied).map((b) => b.kind)).toEqual(['electro', 'physical'])
  })

  it('is empty when every bonus is 0 (an EM goblet)', () => {
    expect(damageBonuses(panel())).toEqual([])
  })
})

describe('shareUid', () => {
  it("is the account's UID", () => {
    expect(shareUid('812345678', 700000001)).toBe('812345678')
  })

  it("falls back to the newest capture's gi_player.uid", () => {
    expect(shareUid(null, 812345679)).toBe('812345679')
    expect(shareUid('  ', 812345679)).toBe('812345679')
    expect(shareUid(undefined, 1812345679)).toBe('1812345679')
  })

  it('is null when neither knows it', () => {
    expect(shareUid(null, undefined)).toBeNull()
    expect(shareUid(null, 0)).toBeNull()
  })
})

describe('buildPanel', () => {
  const huTao = {
    key: 'HuTao',
    level: 90,
    ascension: 6,
    weapon: homa,
    artifacts: [null, null, null, null, null],
  }

  it('is the game panel (computeStats) with rows', () => {
    const built = buildPanel(huTao)!
    expect(built.stats).toEqual(computeStats(huTao, homa, []))
    // The values the game data's own docs give for Hu Tao with Homa R1.
    expect(built.stats).toMatchObject({ hp: 18663, atk: 715, critDmg: 154.6 })
    expect(built.weaponMissing).toBe(false)
    expect(built.rows[0]!.text).toBe('18,663')
  })

  it('counts every worn artifact and its set bonus', () => {
    const piece = {
      setKey: 'CrimsonWitchOfFlames',
      rarity: 5,
      level: 20,
      substats: [{ key: 'critRate_', value: 3.9 }],
    }
    const built = buildPanel({
      ...huTao,
      artifacts: [
        { ...piece, mainStatKey: 'hp' },
        { ...piece, mainStatKey: 'atk' },
        null,
        null,
        null,
      ],
    })!
    expect(built.stats.critRate).toBe(12.8)
    expect(built.stats.elementalDmg.pyro).toBe(15)
    expect(built.stats.hp).toBe(18663 + 4780)
  })

  it('is null for a character newer than the data', () => {
    expect(buildPanel({ ...huTao, key: 'SomeoneNew' })).toBeNull()
  })

  it('leaves out a weapon newer than the data, and says so', () => {
    const built = buildPanel({ ...huTao, weapon: { ...homa, key: 'SomeNewSpear' } })!
    expect(built.weaponMissing).toBe(true)
    expect(built.stats).toEqual(computeStats(huTao, null, []))
  })

  it('reads the plain Traveler like any Traveler', () => {
    const traveler = { ...huTao, key: 'Traveler', weapon: null }
    expect(buildPanel(traveler)!.stats.hp).toBe(
      buildPanel({ ...traveler, key: 'TravelerAnemo' })!.stats.hp,
    )
  })
})

describe('talentLevels', () => {
  const talent = { auto: 10, skill: 9, burst: 10 }

  it('adds C3 and C5 as the game shows them', () => {
    const boosts = constellationBoosts(planner, 'Furina')
    expect(boosts).toEqual({ c3: 'burst', c5: 'skill' })
    expect(talentLevels(talent, 2, boosts).map((t) => t.level)).toEqual([10, 9, 10])
    expect(talentLevels(talent, 3, boosts).map((t) => t.level)).toEqual([10, 9, 13])
    const c6 = talentLevels(talent, 6, boosts)
    expect(c6.map((t) => t.level)).toEqual([10, 12, 13])
    expect(c6.map((t) => t.from)).toEqual([null, 5, 3])
    expect(c6.map((t) => t.crowned)).toEqual([true, false, true])
  })

  it('marks book levels 1-5 low, by the book level, not the boosted one', () => {
    const low = talentLevels({ auto: 1, skill: 5, burst: 6 }, 6, { c3: 'auto', c5: 'skill' })
    expect(low.map((t) => t.level)).toEqual([4, 8, 6])
    expect(low.map((t) => t.low)).toEqual([true, true, false])
    expect(talentLevels(talent, 6, null).map((t) => t.low)).toEqual([false, false, false])
  })

  it('shows base levels without boosts (newer character, data not loaded)', () => {
    expect(talentLevels(talent, 6, null).map((t) => t.level)).toEqual([10, 9, 10])
    expect(constellationBoosts(planner, 'Aloy')).toEqual({ c3: null, c5: null })
  })

  it('titles the sum', () => {
    const [, skill, burst] = talentLevels(talent, 6, { c3: 'burst', c5: 'skill' })
    expect(talentTitle(burst!)).toBe('Elemental Burst 10 → 13 (C3) · crowned')
    expect(talentTitle(skill!)).toBe('Elemental Skill 9 → 12 (C5)')
  })
})

describe('weaponLines', () => {
  it('splits base ATK, the substat and the passive', () => {
    const lines = weaponLines(homa)!
    expect(lines.atk).toMatchObject({ key: 'baseAtk', label: 'Base ATK', text: '608' })
    expect(lines.sub).toMatchObject({ key: 'critDMG_', label: 'CRIT DMG', text: '66.2%' })
    expect(lines.passive).toEqual([expect.objectContaining({ key: 'hp_', text: '20.0%' })])
    expect(weaponLines({ ...homa, refinement: 5 })!.passive[0]!.text).toBe('40.0%')
  })

  it("keeps a passive of the substat's own stat out of the substat", () => {
    const lines = weaponLines({ key: 'WolfsGravestone', level: 90, ascension: 6, refinement: 1 })!
    expect(lines.sub).toMatchObject({ key: 'atk_', text: '49.6%' })
    expect(lines.passive).toEqual([expect.objectContaining({ key: 'atk_', text: '20.0%' })])
  })

  it('has no substat on 1–2★ weapons', () => {
    const lines = weaponLines({ key: 'WasterGreatsword', level: 70, ascension: 4, refinement: 5 })!
    expect(lines.sub).toBeNull()
    expect(lines.atk.text).toBe('185')
    expect(lines.passive).toEqual([])
  })

  it('is null for a weapon newer than the data', () => {
    expect(weaponLines({ ...homa, key: 'SomeNewSpear' })).toBeNull()
  })
})

describe('buildRv', () => {
  it("adds up the worn pieces' RV, empty slots as 0", () => {
    expect(buildRv([{ rv: 120 }, null, { rv: 80 }, { rv: 300 }, null])).toBe(500)
    expect(buildRv([null, null, null, null, null])).toBe(0)
  })
})

describe('bonusSets', () => {
  const set = (setKey: string, count: number, thresholds: readonly number[] = [2, 4]) => ({
    setKey,
    count,
    thresholds,
  })

  it('lists a 4-piece and leaves out the single piece', () => {
    const listed = bonusSets([set('SilkenMoonsSerenade', 4), set('CrimsonWitchOfFlames', 1)])
    expect(listed.map((b) => [b.set.setKey, b.pieces])).toEqual([['SilkenMoonsSerenade', 4]])
  })

  it('lists 2 + 2, and a 5th or 3rd piece reads as the bonus it reaches', () => {
    expect(bonusSets([set('A', 2), set('B', 3)]).map((b) => [b.set.setKey, b.pieces])).toEqual([
      ['A', 2],
      ['B', 2],
    ])
    expect(bonusSets([set('A', 5)])[0]!.pieces).toBe(4)
  })

  it('lists nothing when no set reaches 2 pieces, nor 1-piece bonuses', () => {
    expect(bonusSets([set('A', 1), set('B', 1), set('C', 1)])).toEqual([])
    expect(bonusSets([set('PrayersForWisdom', 1, [1])])).toEqual([])
    expect(bonusSets([])).toEqual([])
  })
})

describe('set bonuses', () => {
  it('lists the stats each bonus always adds', () => {
    expect(setBonusLines('CrimsonWitchOfFlames')).toEqual([
      { pieces: 2, stats: [expect.objectContaining({ key: 'pyro_dmg_', text: '15.0%' })] },
    ])
    expect(setBonusLines('SomeNewSet')).toEqual([])
    expect(setBonusTitle('EmblemOfSeveredFate', [2, 4])).toEqual([
      '2-piece: Energy Recharge +20.0%',
    ])
    expect(setBonusTitle('EmblemOfSeveredFate', [])).toEqual([
      '2-piece (inactive): Energy Recharge +20.0%',
    ])
  })
})
