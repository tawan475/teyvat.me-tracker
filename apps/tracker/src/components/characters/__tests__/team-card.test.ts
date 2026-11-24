import { describe, expect, it } from 'vitest'
import type { CharacterView } from '@/data/characters'
import {
  DEFAULT_TEAM_REGION,
  MAX_PICKS,
  ROW_COLUMNS,
  ROW_COLUMN_GAP,
  ROW_PAD,
  TEAM_CARD_WIDTH,
  TEAM_PAD_X,
  TEAM_ROW,
  teamCardHeight,
  teamFileName,
  teamMembers,
  teamNameFit,
  teamRegion,
  teamRowTop,
  totalsWidths,
  togglePick,
} from '../team-card'

const char = (key: string): CharacterView => ({ key, name: key }) as CharacterView

describe('teamCardHeight', () => {
  it('makes two rows 1184 high (the build card frame plus two totals lines)', () => {
    expect(teamCardHeight(2)).toBe(1184)
  })

  it('grows by a row and its gap', () => {
    expect(teamCardHeight(3)).toBe(1698)
    expect(teamCardHeight(4)).toBe(2212)
  })

  it('puts the last row above the bottom padding', () => {
    for (const n of [2, 3, 4]) expect(teamRowTop(n - 1) + TEAM_ROW + 40).toBe(teamCardHeight(n))
  })
})

describe('teamNameFit', () => {
  it('never cuts a name that fits, however close', () => {
    // "daily driver" was cut to "daily driv…" with 1,300px to spare.
    expect(teamNameFit(312.4, 1300)).toEqual({ width: 312.4 })
    expect(teamNameFit(1300, 1300)).toEqual({ width: 1300 })
  })

  it('cuts a name wider than the room to the room', () => {
    expect(teamNameFit(1600.2, 1300)).toEqual({ width: 1300, max: 1300 })
  })
})

describe('row columns', () => {
  it('fill the row inside its padding', () => {
    const inner = TEAM_CARD_WIDTH - 2 * TEAM_PAD_X - 2 * ROW_PAD
    expect(ROW_COLUMNS.who + ROW_COLUMNS.middle + ROW_COLUMNS.pieces + 2 * ROW_COLUMN_GAP).toBe(
      inner,
    )
  })
})

describe('togglePick', () => {
  it('adds at the end and drops in place', () => {
    expect(togglePick([], 'A')).toEqual(['A'])
    expect(togglePick(['A', 'B', 'C'], 'B')).toEqual(['A', 'C'])
  })

  it('stops at the maximum', () => {
    const full = ['A', 'B', 'C', 'D']
    expect(full).toHaveLength(MAX_PICKS)
    expect(togglePick(full, 'E')).toEqual(full)
    expect(togglePick(full, 'A')).toEqual(['B', 'C', 'D'])
  })
})

describe('teamMembers', () => {
  const roster = [char('HuTao'), char('Yelan'), char('TravelerAnemo'), char('Zhongli')]

  it('keeps the team order and skips who the roster lacks', () => {
    expect(teamMembers(['Yelan', 'Nobody', 'HuTao', ''], roster).map((c) => c.key)).toEqual([
      'Yelan',
      'HuTao',
    ])
  })

  it('finds the Traveler by any element', () => {
    expect(teamMembers(['TravelerGeo'], roster).map((c) => c.key)).toEqual(['TravelerAnemo'])
  })

  it('lists nobody twice and four at most', () => {
    const keys = ['HuTao', 'HuTao', 'Yelan', 'TravelerAnemo', 'Zhongli', 'TravelerGeo']
    expect(teamMembers(keys, roster).map((c) => c.key)).toEqual([
      'HuTao',
      'Yelan',
      'TravelerAnemo',
      'Zhongli',
    ])
  })
})

describe('teamFileName', () => {
  it('names a team card after the team', () => {
    expect(teamFileName('Vape Squad ♡', ['HuTao'])).toBe('team-vape-squad-teyvat-me.png')
  })

  it('falls back to the characters', () => {
    expect(teamFileName(null, ['HuTao', 'Yelan'])).toBe('HuTao-Yelan-teyvat-me.png')
    expect(teamFileName('♡♡', ['HuTao'])).toBe('HuTao-teyvat-me.png')
  })
})

describe('teamRegion', () => {
  it('takes the region most members are from', () => {
    // Liyue: Xingqiu, Yelan, Zhongli; Mondstadt: Bennett.
    expect(teamRegion(['Xingqiu', 'Bennett', 'Yelan', 'Zhongli'])).toBe(2)
    // Two from Mondstadt beat one each from Liyue and Inazuma.
    expect(teamRegion(['Bennett', 'Sucrose', 'Xiangling', 'RaidenShogun'])).toBe(1)
    expect(teamRegion(['Furina', 'Neuvillette'])).toBe(5)
  })

  it('counts the Harbingers as Snezhnaya and leaves out the Traveler and the regionless', () => {
    expect(teamRegion(['Tartaglia', 'Arlecchino', 'KaedeharaKazuha'])).toBe(8)
    expect(teamRegion(['TravelerAnemo', 'Aloy', 'Skirk', 'Nahida'])).toBe(4)
  })

  it('falls back to the default on a tie or with nobody from a region', () => {
    expect(teamRegion(['Bennett', 'Xingqiu'])).toBe(DEFAULT_TEAM_REGION)
    expect(teamRegion(['TravelerAnemo', 'Aloy'])).toBe(DEFAULT_TEAM_REGION)
    expect(teamRegion(['NotACharacter'])).toBe(DEFAULT_TEAM_REGION)
    expect(teamRegion([])).toBe(DEFAULT_TEAM_REGION)
  })
})

describe('totalsWidths', () => {
  const sum = (list: number[]) => list.reduce((a, b) => a + b, 0)

  it('spreads spare room evenly and fills the line', () => {
    expect(
      totalsWidths(
        [
          { min: 40, want: 60 },
          { min: 50, want: 50 },
        ],
        130,
      ),
    ).toEqual([70, 60])
  })

  it('never cuts a total and roll count: the names share what is left', () => {
    const cells = [
      { min: 80, want: 120 },
      { min: 60, want: 80 },
    ]
    const widths = totalsWidths(cells, 170)
    expect(sum(widths)).toBeCloseTo(170)
    widths.forEach((w, i) => expect(w).toBeGreaterThanOrEqual(cells[i]!.min))
    expect(widths).toEqual([100, 70])
  })
})
