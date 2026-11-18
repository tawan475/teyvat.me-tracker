import { describe, expect, it } from 'vitest'
import {
  ARCANA_CARD,
  arcanaFileName,
  arcanaGrid,
  cellHeight,
  type ArcanaLayout,
} from '../arcana-card'

describe('arcana card layout', () => {
  for (const layout of ['wide', 'tall'] as ArcanaLayout[]) {
    it(`fits all 22 cards inside the ${layout} card, the last row centred`, () => {
      const spec = ARCANA_CARD[layout]
      const boxes = arcanaGrid(layout, 22)
      expect(boxes).toHaveLength(22)
      const top = spec.pad.top + spec.header
      const bottom = spec.height - spec.pad.bottom - spec.foot
      for (const b of boxes) {
        expect(b.x).toBeGreaterThanOrEqual(spec.pad.side)
        expect(b.x + b.w).toBeLessThanOrEqual(spec.width - spec.pad.side)
        expect(b.y).toBeGreaterThanOrEqual(top)
        expect(b.y + cellHeight(spec)).toBeLessThanOrEqual(bottom)
      }
      // Every row is centred on the card: the first and last cards of a row mirror each other.
      const rows = new Map<number, typeof boxes>()
      for (const b of boxes) rows.set(b.y, [...(rows.get(b.y) ?? []), b])
      for (const row of rows.values()) {
        const left = row[0]!.x
        const right = spec.width - (row.at(-1)!.x + row.at(-1)!.w)
        expect(Math.abs(left - right)).toBeLessThan(0.001)
      }
      expect(rows.size).toBe(Math.ceil(22 / spec.perRow))
    })
  }

  it('names the file after the layout and the capture day', () => {
    expect(arcanaFileName('tall', new Date(2026, 10, 18, 9).getTime())).toBe(
      'lunar-arcana-tall-2026-11-18.png',
    )
  })
})
