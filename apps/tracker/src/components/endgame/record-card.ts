/**
 * The Spiral Abyss and Imaginarium Theater record share cards (the user's
 * ask, 2026-11-07: "share button so we can export it like SO"; designs on
 * https://claude.ai/artifact/3Gy9VneyBDzUd6h271ziwV): where things go. Pure;
 * the canvas is record-card-canvas.ts.
 *
 * Both are the Stygian card's frame at 1920 × 1080 (stygian-card.ts): the
 * owner's profile on the left, the record in the middle pill (the game's
 * own star and the number, nothing else: the user's call), the season on
 * its mirror, a foot line with the capture's date and the site.
 *
 * Abyss: the blessing (art, text) and the characters picked most on the
 * left, the five figures as big rows on the right.
 * Theater: a band over the season's art, everything centred: difficulty and
 * acts, the Stellas (one per act, a divider, the extra bouts'), the
 * elements; under it one row of the season's cast, Opening Characters and
 * Special Guest Stars side by side (the capture has no teams per act).
 */

import { STYGIAN_CARD } from './stygian-card'

type Box = { x: number; y: number; w: number; h: number }

/** The record pill: the star, then the number and its maximum. */
export const RECORD_PILL = {
  h: 172,
  icon: 120,
  gap: 20,
  padLeft: 30,
  padRight: 44,
  value: 104,
  of: 38,
} as const

/** Where the body (between the header and the foot line) and the foot line are. */
export function recordBody(): { body: Box; foot: Box } {
  const { width, height, padX, padTop, padBottom, headerH, gap, footH } = STYGIAN_CARD
  const top = padTop + headerH + gap
  const footY = height - padBottom - footH
  return {
    body: { x: padX, y: top, w: width - 2 * padX, h: footY - gap - top },
    foot: { x: padX + 8, y: footY, w: width - 2 * padX - 16, h: footH },
  }
}

/** The Abyss card's body: the blessing panel and its parts, the five figure rows. */
export const ABYSS_LAYOUT = {
  leftW: 700,
  columnGap: 24,
  artH: 400,
  rowGap: 14,
  pickGap: 22,
  portrait: 104,
} as const

export function abyssLayout(body: Box) {
  const { leftW, columnGap, rowGap } = ABYSS_LAYOUT
  const left = { x: body.x, y: body.y, w: leftW, h: body.h }
  const right = {
    x: body.x + leftW + columnGap,
    y: body.y,
    w: body.w - leftW - columnGap,
    h: body.h,
  }
  const rowH = (right.h - 4 * rowGap) / 5
  const rows = Array.from({ length: 5 }, (_, i) => ({
    x: right.x,
    y: right.y + i * (rowH + rowGap),
    w: right.w,
    h: rowH,
  }))
  return { left, right, rows }
}

/** The Theater card's body: the Stella band on top, the cast row at its foot. */
export const THEATER_LAYOUT = {
  gap: 22,
  /** The cast row: padding, label, the bag cells' width, gaps. */
  castPadTop: 20,
  castPadBottom: 24,
  castLabelH: 30,
  castLabelGap: 14,
  cell: 150,
  cellGap: 16,
  groupGap: 56,
  stella: 96,
  stellaGap: 14,
  divider: 22,
} as const

export function theaterLayout(body: Box) {
  const L = THEATER_LAYOUT
  const cellH = (L.cell * 98) / 80
  const castH = L.castPadTop + L.castLabelH + L.castLabelGap + cellH + L.castPadBottom
  const band = { x: body.x, y: body.y, w: body.w, h: body.h - castH - L.gap }
  const cast = { x: body.x, y: band.y + band.h + L.gap, w: body.w, h: castH }
  return { band, cast, cellH }
}

/** The Stella row's width: `acts` Stellas, then the divider and `extra` more when there are any. */
export function stellaRowWidth(acts: number, extra: number): number {
  const { stella, stellaGap, divider } = THEATER_LAYOUT
  const n = acts + extra
  if (!n) return 0
  const base = n * stella + (n - 1) * stellaGap
  return extra && acts ? base + 2 * divider + 3 - stellaGap : base
}

/**
 * The Stellas a run earned, as the game lists them: per act (the starred
 * acts) and the extra bouts' (what is left of the count, from the first).
 * Null without the starred acts.
 */
export function stellaMarks(
  run: { stars?: number; starredActs?: number[] },
  acts: number,
  extra: number,
): { acts: boolean[]; extra: boolean[] } | null {
  if (!run.starredActs || run.stars === undefined) return null
  const starred = new Set(run.starredActs)
  const extraEarned = Math.max(0, Math.min(extra, run.stars - starred.size))
  return {
    acts: Array.from({ length: acts }, (_, i) => starred.has(i + 1)),
    extra: Array.from({ length: extra }, (_, i) => i < extraEarned),
  }
}

/** The PNG's file name: the mode and the season's start month. */
export function recordFileName(mode: 'abyss' | 'theater', start: string): string {
  const month = /^(\d{4})-(\d{2})/.exec(start)
  return `${mode}-${month ? `${month[1]}-${month[2]}` : 'record'}-teyvat-me.png`
}
