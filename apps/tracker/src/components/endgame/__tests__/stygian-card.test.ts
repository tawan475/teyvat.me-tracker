import { describe, expect, it } from 'vitest'
import { frameSize } from '@/data/profile-card'
import {
  COLUMN,
  DIRE_TIME_LIMIT,
  PROFILE,
  STYGIAN_CARD,
  bagCell,
  columnFootH,
  fastestFight,
  profileTextLeft,
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

  it('keeps the name clear of the profile frame', () => {
    const { picture, text } = PROFILE
    const frameRight = (natural: number) =>
      picture.x + picture.d / 2 + frameSize(picture.d, natural) / 2
    // No frame, and a frame that ends well short of the text: the usual start.
    expect(profileTextLeft(0)).toBe(text.left)
    expect(profileTextLeft(frameSize(picture.d, 200))).toBe(text.left)
    // Every frame width the game has (272-360px): the gap holds.
    for (const natural of [272, 300, 324, 360]) {
      const left = profileTextLeft(frameSize(picture.d, natural))
      expect(left - frameRight(natural), `frame ${natural}`).toBeGreaterThanOrEqual(text.gap)
      expect(left).toBeGreaterThanOrEqual(text.left)
    }
    // The widest frame still leaves the name most of the panel.
    expect(profileTextLeft(frameSize(picture.d, 360))).toBeLessThanOrEqual(text.left + 40)
  })
})
