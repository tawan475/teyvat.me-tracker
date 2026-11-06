import type { GoodArtifact, LiveArtifact } from '@gdt/shared'
import { describe, expect, it } from 'vitest'
import { artifactPotential, critRoll, upgradesLeft } from '@/data/artifact-potential'
import {
  buildArtifactRows,
  compileFilter,
  defaultFilters,
  isNewPiece,
  isSparePreset,
  isZeroPreset,
  rarityGroups,
  samePiece,
  sanitizeFilters,
  sanitizeView,
  sortRows,
  substatMask,
  toggleSparePreset,
  toggleZeroPreset,
  type ArtifactFilters,
} from '@/data/artifacts'

function piece(rest: Partial<LiveArtifact> = {}): GoodArtifact {
  return {
    setKey: 'GladiatorsFinale',
    slotKey: 'flower',
    level: 20,
    rarity: 5,
    mainStatKey: 'hp',
    location: '',
    lock: false,
    substats: [
      { key: 'critRate_', value: 3.9 },
      { key: 'critDMG_', value: 7.8 },
      { key: 'atk_', value: 5.8 },
      { key: 'enerRech_', value: 6.5 },
    ],
    ...rest,
  }
}

const filters = (change: Partial<ArtifactFilters> = {}): ArtifactFilters => ({
  ...defaultFilters(),
  ...change,
})

describe('artifactPotential', () => {
  it('opens the unactivated line first, then rolls the four lines', () => {
    const p = artifactPotential(
      {
        rarity: 5,
        level: 0,
        substats: [
          { key: 'critRate_', value: 3.9 },
          { key: 'atk_', value: 5.8 },
          { key: 'hp', value: 299 },
        ],
        unactivatedSubstats: [{ key: 'critDMG_', value: 7.0 }],
      },
      200,
    )
    expect(p.left).toBe(5)
    expect(p.activates).toEqual({ key: 'critDMG_', value: 7.0 })
    expect(p.critLines).toBe(2)
    expect(p.critChance).toBe(0.5)
    // CV with the opened line: 3.9 × 2 + 7.0 = 14.8; four rolls left, each a
    // crit line half the time: (6.61 + 6.605) / 4 per roll.
    expect(p.expectedCv).toBe(28)
    // Every roll a top CRIT Rate (3.89 × 2).
    expect(p.bestCv).toBe(45.9)
    expect(p.maxRv).toBe(700)
  })

  it('assumes nothing about a line still to open when the capture does not say', () => {
    const p = artifactPotential(
      {
        rarity: 5,
        level: 0,
        substats: [
          { key: 'critRate_', value: 3.1 },
          { key: 'critDMG_', value: 6.2 },
          { key: 'atk_', value: 5.8 },
        ],
      },
      0,
    )
    expect(p.activates).toBeNull()
    expect(p.expectedCv).toBe(Math.round((12.4 + 4 * ((6.61 + 6.605) / 4)) * 10) / 10)
  })

  it('is the CV itself once maxed, or without crit lines', () => {
    const maxed = artifactPotential(piece(), 600)
    expect(maxed).toMatchObject({ left: 0, expectedCv: 15.6, bestCv: 15.6, maxRv: 600 })
    const noCrit = artifactPotential(
      piece({
        level: 4,
        substats: [
          { key: 'atk_', value: 5.8 },
          { key: 'hp', value: 299 },
        ],
      }),
      200,
    )
    expect(noCrit).toMatchObject({ left: 4, critLines: 0, critChance: 0, expectedCv: 0, bestCv: 0 })
  })

  it('uses the rarity’s own rolls and level cap', () => {
    expect(upgradesLeft({ rarity: 4, level: 0 })).toBe(4)
    expect(upgradesLeft({ rarity: 3, level: 8 })).toBe(1)
    expect(upgradesLeft({ rarity: 1, level: 4 })).toBe(0)
    expect(critRoll('critDMG_', 4).average).toBeCloseTo(5.285, 6)
    expect(critRoll('critRate_', 5).max).toBeCloseTo(7.78, 6)
    expect(critRoll('atk_', 5)).toEqual({ average: 0, max: 0 })
  })
})

describe('rows and filters', () => {
  const artifacts = [
    piece(),
    piece({
      level: 0,
      substats: [
        { key: 'critRate_', value: 3.1 },
        { key: 'atk_', value: 5.8 },
        { key: 'def', value: 23 },
      ],
      unactivatedSubstats: [{ key: 'critDMG_', value: 7.8 }],
    }),
    piece({ rarity: 4, level: 16, location: 'Bennett', elixirCrafted: true }),
    piece({ rarity: 3, level: 0, lock: true, substats: [{ key: 'hp_', value: 3.5 }] }),
  ]
  const rows = buildArtifactRows(artifacts, [40, 41, 12, 7])
  const pick = (f: ArtifactFilters, previous: ReadonlySet<number> | null = null) =>
    rows.filter(compileFilter(f, undefined, previous)).map((r) => r.catalogId)

  it('derives catalog ids, lines and a substat mask that counts the unactivated line', () => {
    expect(rows.map((r) => r.catalogId)).toEqual([40, 41, 12, 7])
    expect(rows.map((r) => r.lines)).toEqual([4, 3, 4, 1])
    expect(rows[1]!.subMask).toBe(substatMask(['critRate_', 'atk_', 'def', 'critDMG_']))
  })

  it('keeps pieces with every picked substat', () => {
    expect(pick(filters({ substats: ['critRate_', 'critDMG_'] }))).toEqual([40, 41, 12])
    expect(pick(filters({ substats: ['critDMG_', 'def'] }))).toEqual([41])
    expect(pick(filters({ substats: ['eleMas'] }))).toEqual([])
  })

  it('filters lines, wearers and the elixir', () => {
    expect(pick(filters({ lines: 3 }))).toEqual([41])
    expect(pick(filters({ owners: ['Bennett'] }))).toEqual([12])
    expect(pick(filters({ elixir: 'yes' }))).toEqual([12])
    expect(pick(filters({ elixir: 'no', rarities: [4, 3] }))).toEqual([7])
  })

  it('"New" is what the previous capture lacked; nothing without one', () => {
    const previous = new Set([40, 12])
    expect(pick(filters({ fresh: true }), previous)).toEqual([41, 7])
    expect(pick(filters({ fresh: true }), null)).toEqual([])
    expect(isNewPiece(rows[0]!, previous)).toBe(false)
    expect(isNewPiece(rows[1]!, null)).toBe(false)
  })

  it('+0 5★ and Spare 5★ are separate presets', () => {
    const zero = toggleZeroPreset(filters())
    expect(isZeroPreset(zero)).toBe(true)
    expect(isSparePreset(zero)).toBe(false)
    expect(pick(zero)).toEqual([41])
    const spare = toggleSparePreset(zero)
    expect(isSparePreset(spare)).toBe(true)
    expect(isZeroPreset(spare)).toBe(false)
    expect(pick(spare)).toEqual([40, 41])
    expect(toggleZeroPreset(zero)).toEqual(filters())
  })
})

describe('sorting', () => {
  const rows = buildArtifactRows(
    [
      piece({ setKey: 'NoblesseOblige', level: 20 }),
      piece({ setKey: 'GladiatorsFinale', level: 20, location: 'Xiangling' }),
      piece({ setKey: 'GladiatorsFinale', level: 20 }),
      piece({
        setKey: 'GladiatorsFinale',
        level: 20,
        substats: [
          { key: 'critRate_', value: 3.9 },
          { key: 'critDMG_', value: 7.8 },
          { key: 'atk_', value: 5.8 },
        ],
      }),
      piece({ rarity: 4, level: 16 }),
      piece({ level: 8 }),
    ],
    [1, 2, 3, 9, 5, 6],
  )
  const ids = (sorted: typeof rows) => sorted.map((r) => r.catalogId)

  it('Quality: rarity, level, set, wearer first, more lines, then newest', () => {
    expect(ids(sortRows(rows, 'quality', true))).toEqual([2, 3, 9, 1, 6, 5])
    expect(ids(sortRows(rows, 'quality', false))).toEqual([5, 6, 1, 9, 3, 2])
  })

  it('Recent: newest catalog id first', () => {
    expect(ids(sortRows(rows, 'recent', true))).toEqual([9, 6, 5, 3, 2, 1])
  })

  it('Potential: expected CV at max', () => {
    const sorted = sortRows(rows, 'potential', true)
    // The +8 piece has three upgrades to come on top of the same CV.
    expect(sorted[0]!.catalogId).toBe(6)
  })

  it('groups by rarity, keeping the order inside', () => {
    const groups = rarityGroups(sortRows(rows, 'recent', true))
    expect(groups.map((g) => [g.rarity, g.rows.map((r) => r.catalogId)])).toEqual([
      [5, [9, 6, 3, 2, 1]],
      [4, [5]],
    ])
  })
})

describe('stored state', () => {
  it('reads old saves and drops unknown values', () => {
    const f = sanitizeFilters({
      sort: 'rarity',
      substats: ['critRate_', 'nope'],
      lines: 5,
      elixir: 'yes',
      owners: ['HuTao', 3],
      fresh: 'yes',
    })
    expect(f.sort).toBe('quality')
    expect(f.descending).toBe(true)
    expect(f.substats).toEqual(['critRate_'])
    expect(f.lines).toBe(0)
    expect(f.elixir).toBe('yes')
    expect(f.owners).toEqual(['HuTao'])
    expect(f.fresh).toBe(false)
    expect(sanitizeView('bag')).toBe('bag')
    expect(sanitizeView('grid')).toBe('cards')
  })
})

describe('samePiece', () => {
  it('follows a piece across a re-read: catalog id, else the game item id, else gone', () => {
    const before = buildArtifactRows(
      [
        piece({ gi_guid: '7' }),
        piece({ slotKey: 'plume', gi_guid: '8' }),
        piece({ slotKey: 'sands' }),
      ],
      [10, 11, 12],
    )
    // A new piece first, the plume levelled (new catalog id), the sands gone.
    const after = buildArtifactRows(
      [piece({ slotKey: 'goblet' }), piece(), piece({ slotKey: 'plume', level: 16, gi_guid: '8' })],
      [13, 10, 14],
    )
    expect(samePiece(after, before[0]!)?.id).toBe(1)
    expect(samePiece(after, before[1]!)?.id).toBe(2)
    expect(samePiece(after, before[2]!)).toBeNull()
  })
})
