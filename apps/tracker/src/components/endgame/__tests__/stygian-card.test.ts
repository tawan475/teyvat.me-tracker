import { describe, expect, it } from 'vitest'
import {
  DIRE_TIME_LIMIT,
  STYGIAN_CARD,
  fastestFight,
  seasonMonth,
  stygianCardLayout,
  stygianFileName,
  stygianMedal,
} from '../stygian-card'

const fight = (time: number, done = true) => ({ time, done, team: [] })

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

  it('fits the rows to the body, whatever the number of fights', () => {
    for (const n of [1, 2, 3]) {
      const layout = stygianCardLayout(n)
      expect(layout.rows).toHaveLength(n)
      const last = layout.rows.at(-1)!
      expect(last.y + last.h).toBeLessThanOrEqual(STYGIAN_CARD.height - STYGIAN_CARD.pad)
      expect(last.x + last.w).toBe(STYGIAN_CARD.width - STYGIAN_CARD.pad)
    }
  })
})
