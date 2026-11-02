/**
 * The banner share card (banner-card-canvas): one banner run's pulls, after
 * the user's design (Claude Design "Banner pulls share card", high
 * fidelity). One grid holds the info panel and every 5★, so all gaps match:
 * the panel takes the top-left block and the 5★ tiles (the game's bag cell)
 * flow around it, newest first, row by row, then fill whole rows under it.
 * Up to 12 5★ the tiles are sized so their rows end level with the panel
 * (about 3 tile columns for every 2 rows; one row is capped); past 12 (the
 * mega whale) the panel spans 4 rows beside 7 columns of smaller tiles and
 * the card grows taller. The card is as wide and as tall as the grid.
 */

import { formatWishTime } from '@gdt/shared'
import type { EventBanner, Outcome, PullRow } from '@/data/wish-history'
import { giCdnArt } from '@/lib/assets'

export const BANNER_CARD_PAD_X = 48
export const BANNER_CARD_PAD_Y = 40
/** The info panel's height: the tile rows beside it end level with it. */
export const PANEL_H = 900
const PANEL_MIN_W = 560

/** Tile text as a share of the tile's width, within readable limits (the user's pick). */
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
export const tileNameSize = (w: number) => clamp(w * 0.14, 17, 32)
export const tileNameGap = (w: number) => clamp(w * 0.11, 16, 26)
export const tilePitySize = (w: number) => clamp(w * 0.135, 18, 38)
export const tileNumberSize = (w: number) => clamp(w * 0.085, 12, 20)
export const tileRadius = (w: number) => clamp(w * 0.065, 12, 20)
/** A tile's name line under the cell: the gap, then the name (line height 1.15). */
const label = (w: number) => tileNameSize(w) * 1.15 + tileNameGap(w)
/** The game's bag cell: 80×98, a square picture over the cream strip. */
export const CELL_RATIO = 98 / 80

export interface BannerCardLayout {
  width: number
  height: number
  /** The info panel's box. */
  panel: { x: number; y: number; w: number; h: number }
  /** One tile's cell (without its name), and where each one's cell starts. */
  cellW: number
  cellH: number
  tiles: { x: number; y: number }[]
  colGap: number
  rowGap: number
}

/** The card's geometry for `count` 5★ (0 draws the panel alone). */
export function bannerCardLayout(count: number): BannerCardLayout {
  const n = Math.max(0, count)
  let gap: number
  let rowGap: number
  let cellW: number
  let tileCols: number
  let panelRows: number
  if (n <= 12) {
    tileCols = Math.max(1, Math.min(Math.max(n, 1), Math.round(Math.sqrt(1.5 * n))))
    panelRows = Math.max(1, Math.ceil(n / tileCols))
    gap = 34
    rowGap = 22
    // The cell that makes panelRows rows (cell + name) fill the panel's height.
    const rowH = (PANEL_H - (panelRows - 1) * rowGap) / panelRows
    let w = ((rowH - label(rowH * 0.6)) * 80) / 98
    w = ((rowH - label(w)) * 80) / 98
    cellW = panelRows === 1 ? Math.min(w, 294) : w
  } else {
    gap = 30
    rowGap = 18
    tileCols = 7
    panelRows = 4
    const rowH = (PANEL_H - (panelRows - 1) * rowGap) / panelRows
    const w = ((rowH - label(140)) * 80) / 98
    cellW = ((rowH - label(w)) * 80) / 98
  }
  cellW = Math.round(cellW)
  const cellH = Math.round(cellW * CELL_RATIO)
  const rowPitch = cellH + label(cellW) + rowGap
  const panelCols = Math.ceil((PANEL_MIN_W + gap) / (cellW + gap))
  const cols = panelCols + tileCols
  const x0 = BANNER_CARD_PAD_X
  const y0 = BANNER_CARD_PAD_Y
  const tiles: { x: number; y: number }[] = []
  // Row by row, skipping the panel's block (the grid's auto-placement around it).
  for (let row = 0, placed = 0; placed < n; row++) {
    for (let col = 0; col < cols && placed < n; col++) {
      if (row < panelRows && col < panelCols) continue
      tiles.push({ x: x0 + col * (cellW + gap), y: y0 + row * rowPitch })
      placed++
    }
  }
  const panelW = panelCols * cellW + (panelCols - 1) * gap
  const rows = n ? Math.floor((tiles.at(-1)!.y - y0) / rowPitch) + 1 : 0
  // Rows beside the panel end level with it (a pixel of rounding stays inside).
  const gridH = rows <= panelRows ? PANEL_H : Math.max(PANEL_H, rows * rowPitch - rowGap)
  return {
    width: Math.round(2 * x0 + cols * cellW + (cols - 1) * gap),
    height: Math.round(2 * y0 + gridH),
    panel: { x: x0, y: y0, w: panelW, h: PANEL_H },
    cellW,
    cellH,
    tiles,
    colGap: gap,
    rowGap,
  }
}

// ------------------------------------------------------------------ the numbers

export interface CardFive {
  row: PullRow
  /** Its pull number on the run (the pull table's #). */
  number: number
}

export interface RarityRow {
  count: number
  /** Of the run's wishes, 0-1. */
  share: number
  avgPity: number
}

export interface BannerCardNumbers {
  wishes: number
  fives: CardFive[]
  five: RarityRow
  four: RarityRow
  fourCharacter: RarityRow
  fourWeapon: RarityRow
  outcomes: Record<Outcome, number>
}

function rarityRow(rows: readonly PullRow[], total: number): RarityRow {
  return {
    count: rows.length,
    share: total ? rows.length / total : 0,
    avgPity: rows.length ? rows.reduce((sum, r) => sum + r.pity, 0) / rows.length : 0,
  }
}

/** The card's numbers from one run's pulls (newest first) and their run numbers. */
export function bannerCardNumbers(
  pulls: readonly PullRow[],
  rolls: ReadonlyMap<PullRow, number>,
): BannerCardNumbers {
  const fives = pulls.filter((r) => r.pull.item.rank === 5)
  const fours = pulls.filter((r) => r.pull.item.rank === 4)
  const outcomes: Record<Outcome, number> = { won: 0, lost: 0, guaranteed: 0, radiance: 0 }
  for (const r of fives) if (r.outcome) outcomes[r.outcome]++
  const total = pulls.length
  return {
    wishes: total,
    fives: fives.map((row) => ({ row, number: rolls.get(row) ?? row.number })),
    five: rarityRow(fives, total),
    four: rarityRow(fours, total),
    fourCharacter: rarityRow(
      fours.filter((r) => r.pull.item.kind === 'character'),
      total,
    ),
    fourWeapon: rarityRow(
      fours.filter((r) => r.pull.item.kind === 'weapon'),
      total,
    ),
    outcomes,
  }
}

// ------------------------------------------------------------------ the banner's art

const ART_KIND: Record<EventBanner['kind'], string> = {
  character: 'C',
  weapon: 'W',
  chronicled: 'R',
}

/**
 * The banner's official art on gi-cdn (`WishBanner_<C|W|R>_<YYYYMMDD>`, `_2`
 * the second banner of a double character run; gi-cdn's wish-banners.ts):
 * named by the start date on the banner's own clock (UTC+8 in the data; the
 * server-clock openings at 06:00 keep the same date there).
 */
export function bannerArt(banner: EventBanner, second = false): string {
  const day = formatWishTime(banner.start + 8 * 3600)
    .slice(0, 10)
    .replaceAll('-', '')
  return giCdnArt(`WishBanner_${ART_KIND[banner.kind]}_${day}${second ? '_2' : ''}`)
}

/** The PNG's name: `banner-7-1-phase-1-teyvat-me.png`. */
export function bannerFileName(banner: EventBanner, phase: number): string {
  return `banner-${banner.version.replaceAll('.', '-')}-phase-${phase}-teyvat-me.png`
}
