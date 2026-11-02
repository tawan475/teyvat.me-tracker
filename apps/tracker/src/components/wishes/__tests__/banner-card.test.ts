import { describe, expect, it } from 'vitest'
import { parseWishTime } from '@gdt/shared'
import type { EventBanner } from '@/data/wish-history'
import { PANEL_H, bannerArt, bannerCardLayout, bannerFileName } from '../banner-card'

const overlaps = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

describe('banner share card layout', () => {
  it('keeps tiles off the panel and off each other, at every count', () => {
    for (const n of [1, 2, 3, 5, 6, 8, 9, 12, 13, 20, 28, 29, 40, 70]) {
      const layout = bannerCardLayout(n)
      expect(layout.tiles).toHaveLength(n)
      const cells = layout.tiles.map((t) => ({ ...t, w: layout.cellW, h: layout.cellH }))
      for (const [i, cell] of cells.entries()) {
        expect(overlaps(cell, layout.panel), `n=${n} tile ${i} on the panel`).toBe(false)
        expect(cell.x + cell.w).toBeLessThanOrEqual(layout.width - 48)
        for (const other of cells.slice(i + 1)) expect(overlaps(cell, other)).toBe(false)
      }
    }
  })

  it('ends the tile rows beside the panel level with it (1–12 5★, more than one row)', () => {
    for (const n of [4, 6, 8, 12]) {
      const layout = bannerCardLayout(n)
      expect(layout.height).toBe(2 * 40 + PANEL_H)
    }
  })

  it('grows taller only past what fits beside the panel (mega whale)', () => {
    expect(bannerCardLayout(20).height).toBe(980)
    expect(bannerCardLayout(28).height).toBe(980)
    expect(bannerCardLayout(29).height).toBeGreaterThan(980)
    expect(bannerCardLayout(40).height).toBeGreaterThan(bannerCardLayout(29).height)
  })

  it('fills the rows beside the panel before adding columns (20 5★: 5 × 4)', () => {
    const layout = bannerCardLayout(20)
    const columns = new Set(layout.tiles.map((t) => t.x)).size
    const rows = new Set(layout.tiles.map((t) => t.y)).size
    expect([columns, rows]).toEqual([5, 4])
    expect(bannerCardLayout(13).width).toBeLessThan(bannerCardLayout(20).width)
  })

  it('is only as wide as its tiles need', () => {
    expect(bannerCardLayout(2).width).toBeLessThan(bannerCardLayout(6).width)
    expect(bannerCardLayout(2).width).toBeLessThan(1500)
  })
})

describe('banner art names', () => {
  const banner = (start: string, kind: EventBanner['kind'] = 'character'): EventBanner => ({
    kind,
    start: parseWishTime(start)! - 8 * 3600,
    end: 0,
    featured5: [],
    featured4: [],
    version: '7.1',
    name: 'When Warm Winds Cavort',
    name400: 'Surging Ballad',
  })

  it('names the art by the start date on the banner clock, _2 for the second banner', () => {
    expect(bannerArt(banner('2026-09-23 06:00:00'))).toMatch(/\/WishBanner_C_20260923\.webp$/)
    expect(bannerArt(banner('2026-10-13 18:00:00'), true)).toMatch(/WishBanner_C_20261013_2\.webp$/)
    expect(bannerArt(banner('2025-01-21 18:00:00', 'chronicled'))).toMatch(/WishBanner_R_20250121/)
  })

  it('a server-clock opening keeps its date in any time zone', () => {
    // 06:00 on an America server (UTC-5) is 11:00 UTC.
    const b = { ...banner('2026-09-23 06:00:00'), start: parseWishTime('2026-09-23 11:00:00')! }
    expect(bannerArt(b)).toMatch(/WishBanner_C_20260923\.webp$/)
  })

  it('names the PNG by version and phase', () => {
    expect(bannerFileName(banner('2026-09-23 06:00:00'), 1)).toBe(
      'banner-7-1-phase-1-teyvat-me.png',
    )
  })
})
