import { describe, expect, it } from 'vitest'
import {
  COLUMN,
  DIRE_TIME_LIMIT,
  STYGIAN_CARD,
  bagCell,
  columnFootH,
  fastestFight,
  seasonMonth,
  seasonVersion,
  splitBossName,
  stygianColumns,
  stygianFileName,
  stygianHeader,
  stygianMedal,
  wrapLines,
} from '../stygian-card'

const fight = (time: number, done = true) => ({ time, done, team: [] })
/** A fake font: every character 10 px. */
const measure = (s: string) => s.length * 10

describe('stygian share card', () => {
  it('gives the difficulty medal, and Dire its laurelled one inside the time limit', () => {
    const third = DIRE_TIME_LIMIT / 3
    expect(
      stygianMedal({ difficulty: 6, fights: [fight(third), fight(third), fight(third)] }),
    ).toBe('UI_LeyLineChallenge_Medal_7')
    expect(
      stygianMedal({ difficulty: 6, fights: [fight(third), fight(third), fight(third + 1)] }),
    ).toBe('UI_LeyLineChallenge_Medal_6')
    // Not every fight done: no total, so not inside the limit.
    expect(stygianMedal({ difficulty: 6, fights: [fight(10), fight(10, false)] })).toBe(
      'UI_LeyLineChallenge_Medal_6',
    )
    expect(stygianMedal({ difficulty: 3, fights: [fight(10)] })).toBe('UI_LeyLineChallenge_Medal_3')
  })

  it('marks the fastest done fight, only when there are two to compare', () => {
    expect(fastestFight({ fights: [fight(31), fight(17), fight(30)] })).toBe(1)
    expect(fastestFight({ fights: [fight(31), fight(5, false), fight(30)] })).toBe(2)
    expect(fastestFight({ fights: [fight(31), fight(5, false)] })).toBe(-1)
  })

  it('names the file and the month by the season start', () => {
    expect(stygianFileName('2026-09-30 10:00:00', false)).toBe('stygian-2026-09-solo-teyvat-me.png')
    expect(stygianFileName('2026-09-30 10:00:00', true)).toBe('stygian-2026-09-coop-teyvat-me.png')
    expect(seasonMonth('2026-09-30 10:00:00')).toBe('2026/9')
  })

  it('splits the header evenly around the medal pill', () => {
    const { profile, pill, season } = stygianHeader(400)
    expect(profile.w).toBeCloseTo(season.w)
    expect(profile.x).toBe(STYGIAN_CARD.padX)
    expect(season.x + season.w).toBeCloseTo(STYGIAN_CARD.width - STYGIAN_CARD.padX)
    expect(pill.x + pill.w / 2).toBeCloseTo(STYGIAN_CARD.width / 2)
  })

  it('fits a column per fight with room for the boss art', () => {
    for (const n of [1, 2, 3]) {
      const { columns, foot } = stygianColumns(n)
      expect(columns).toHaveLength(n)
      const last = columns.at(-1)!
      expect(last.x + last.w).toBeCloseTo(STYGIAN_CARD.width - STYGIAN_CARD.padX)
      expect(last.y + last.h).toBeLessThan(foot.y)
      expect(foot.y + foot.h).toBe(STYGIAN_CARD.height - STYGIAN_CARD.padBottom)
    }
    const [column] = stygianColumns(3).columns
    // The art keeps most of its square above the parts below.
    expect(column!.h - columnFootH(column!.w)).toBeGreaterThan(COLUMN.art * 0.75)
  })

  it('sizes the bag cell like the game (80 × 98)', () => {
    const cell = bagCell(80)
    expect(cell.h).toBe(98)
    expect(cell.strip).toBeCloseTo(16.4)
  })

  it('splits a boss name at its colon', () => {
    expect(splitBossName('Guardian Blade of Drifting Snow: Endless Reverberation')).toEqual({
      name: 'Guardian Blade of Drifting Snow',
      title: 'Endless Reverberation',
    })
    expect(splitBossName('冰风组曲：歌者')).toEqual({ name: '冰风组曲', title: '歌者' })
    expect(splitBossName('Lone Boss')).toEqual({ name: 'Lone Boss', title: '' })
  })

  it('wraps a signature into two lines and cuts the rest', () => {
    expect(wrapLines('one two three', 100, measure, 2)).toEqual(['one two', 'three'])
    const cut = wrapLines('aaaa bbbb cccc dddd eeee', 90, measure, 2)
    expect(cut).toHaveLength(2)
    expect(cut[0]).toBe('aaaa bbbb')
    expect(cut[1]!.endsWith('…')).toBe(true)
    expect(measure(cut[1]!)).toBeLessThanOrEqual(90)
    // No spaces (Chinese, Japanese): by characters.
    expect(wrapLines('一二三四五六', 30, measure, 2)).toEqual(['一二三', '四五六'])
  })

  it('reads the season version from the banners dated before it', () => {
    const banners = [
      { kind: 'character', start: '2026-09-01 18:00:00', version: '7.0' },
      { kind: 'character', start: '2026-09-23 06:00:00', version: '7.1' },
      { kind: 'weapon', start: '2026-10-01 06:00:00', version: '7.2' },
      { kind: 'character', start: '2026-11-04 06:00:00', version: '7.2' },
    ]
    expect(seasonVersion('2026-09-30 10:00:00', banners)).toBe('7.1')
    expect(seasonVersion('2020-01-01 00:00:00', banners)).toBeNull()
  })
})
