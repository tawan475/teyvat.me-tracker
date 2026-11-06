import { describe, expect, it } from 'vitest'
import {
  ABYSS_LAYOUT,
  THEATER_LAYOUT,
  abyssLayout,
  recordBody,
  recordFileName,
  stellaMarks,
  stellaRowWidth,
  theaterLayout,
} from '../record-card'
import { STYGIAN_CARD } from '../stygian-card'

describe('record share cards', () => {
  it('fill the Stygian frame between the header and the foot line', () => {
    const { body, foot } = recordBody()
    const { width, height, padX, padTop, padBottom, headerH, gap, footH } = STYGIAN_CARD
    expect(body).toEqual({
      x: padX,
      y: padTop + headerH + gap,
      w: width - 2 * padX,
      h: height - padBottom - footH - gap - (padTop + headerH + gap),
    })
    expect(foot.y + foot.h).toBe(height - padBottom)
  })

  it('give the Abyss five equal figure rows beside the blessing', () => {
    const { body } = recordBody()
    const { left, rows } = abyssLayout(body)
    expect(left.w).toBe(ABYSS_LAYOUT.leftW)
    expect(rows).toHaveLength(5)
    expect(rows[0]!.y).toBe(body.y)
    expect(rows[4]!.y + rows[4]!.h).toBeCloseTo(body.y + body.h)
    expect(rows[0]!.x + rows[0]!.w).toBe(body.x + body.w)
  })

  it('leave the Theater no empty space: the band takes what the cast row leaves', () => {
    const { body } = recordBody()
    const { band, cast, cellH } = theaterLayout(body)
    expect(band.y).toBe(body.y)
    expect(band.h + THEATER_LAYOUT.gap + cast.h).toBeCloseTo(body.h)
    expect(cellH).toBeCloseTo((THEATER_LAYOUT.cell * 98) / 80)
    // Ten cells and the divider fit in the card's width.
    const L = THEATER_LAYOUT
    const castW = 10 * L.cell + 8 * L.cellGap + 2 * L.groupGap + 2
    expect(castW).toBeLessThanOrEqual(body.w)
    expect(stellaRowWidth(10, 2)).toBeLessThanOrEqual(body.w)
  })

  it('put a divider between the acts and the extra bouts only when both are there', () => {
    const { stella, stellaGap, divider } = THEATER_LAYOUT
    expect(stellaRowWidth(10, 0)).toBe(10 * stella + 9 * stellaGap)
    expect(stellaRowWidth(10, 2)).toBe(12 * stella + 10 * stellaGap + 2 * divider + 3)
    expect(stellaRowWidth(0, 0)).toBe(0)
  })

  it('mark the starred acts, and the extra bouts from what is left of the count', () => {
    expect(stellaMarks({ stars: 12, starredActs: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }, 10, 2)).toEqual(
      {
        acts: Array(10).fill(true),
        extra: [true, true],
      },
    )
    expect(stellaMarks({ stars: 6, starredActs: [1, 2, 3, 5, 6] }, 10, 2)).toEqual({
      acts: [true, true, true, false, true, true, false, false, false, false],
      extra: [true, false],
    })
    // A count below the starred acts never goes negative.
    expect(stellaMarks({ stars: 2, starredActs: [1, 2, 3] }, 3, 2)?.extra).toEqual([false, false])
    expect(stellaMarks({ stars: 5 }, 10, 2)).toBeNull()
    expect(stellaMarks({ starredActs: [1] }, 10, 2)).toBeNull()
  })

  it('name the PNG by mode and month', () => {
    expect(recordFileName('abyss', '2026-01-16 04:00:00')).toBe('abyss-2026-01-teyvat-me.png')
    expect(recordFileName('theater', '2026-11-01 04:00:00')).toBe('theater-2026-11-teyvat-me.png')
    expect(recordFileName('abyss', '')).toBe('abyss-record-teyvat-me.png')
  })
})
