/**
 * Where everything goes on the Lunar Arcana share card (the user's pick,
 * 2026-11-18: the design canvas's Export · Wide and Export · Tall). Pure, so
 * the layout is tested; arcana-card-canvas.ts paints it.
 *
 * Wide is 1920×1080 with 11 cards a row; tall is 1080×1920 with 6 a row. A
 * row that isn't full is centred (the user's ask for the page's grid, kept
 * on the card).
 */

export type ArcanaLayout = 'wide' | 'tall'

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

interface Spec {
  width: number
  height: number
  pad: { top: number; side: number; bottom: number }
  header: number
  foot: number
  /** The card art's box (the art is 373×958). */
  card: { w: number; h: number }
  perRow: number
  gap: { x: number; y: number }
  /** Under each card: the numeral's line, then the title's. */
  numeral: number
  title: number
  /** Between the art and the numeral, and the numeral and the title. */
  lineGap: number
}

export const ARCANA_CARD: Readonly<Record<ArcanaLayout, Spec>> = {
  wide: {
    width: 1920,
    height: 1080,
    pad: { top: 34, side: 72, bottom: 40 },
    header: 130,
    foot: 40,
    card: { w: 127, h: 326 },
    perRow: 11,
    gap: { x: 34, y: 30 },
    numeral: 17,
    title: 20,
    lineGap: 8,
  },
  tall: {
    width: 1080,
    height: 1920,
    pad: { top: 44, side: 60, bottom: 44 },
    header: 150,
    foot: 40,
    card: { w: 124, h: 318 },
    perRow: 6,
    gap: { x: 43, y: 30 },
    numeral: 16,
    title: 19,
    lineGap: 7,
  },
}

/** A card's full cell height: art, numeral, title. */
export function cellHeight(spec: Spec): number {
  return spec.card.h + spec.lineGap + spec.numeral + spec.lineGap + spec.title
}

/**
 * The art box of each of `count` cards, in order: rows of `perRow`, the last
 * one centred, the whole grid centred in the space between header and foot.
 */
export function arcanaGrid(layout: ArcanaLayout, count: number): Box[] {
  const spec = ARCANA_CARD[layout]
  const rows = Math.ceil(count / spec.perRow)
  const cell = cellHeight(spec)
  const top = spec.pad.top + spec.header
  const bottom = spec.height - spec.pad.bottom - spec.foot
  const gridH = rows * cell + Math.max(0, rows - 1) * spec.gap.y
  const y0 = top + (bottom - top - gridH) / 2
  const boxes: Box[] = []
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / spec.perRow)
    const inRow = Math.min(spec.perRow, count - row * spec.perRow)
    const rowW = inRow * spec.card.w + (inRow - 1) * spec.gap.x
    const x0 = (spec.width - rowW) / 2
    const col = i - row * spec.perRow
    boxes.push({
      x: x0 + col * (spec.card.w + spec.gap.x),
      y: y0 + row * (cell + spec.gap.y),
      w: spec.card.w,
      h: spec.card.h,
    })
  }
  return boxes
}

/** The PNG's file name: `lunar-arcana-<wide|tall>-<YYYY-MM-DD>.png` (the capture's day). */
export function arcanaFileName(layout: ArcanaLayout, takenAt: number | null): string {
  const day = takenAt ? new Date(takenAt) : new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const date = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
  return `lunar-arcana-${layout}-${date}.png`
}

/**
 * A missing card's look, the same on the page and the PNG (the user's pick,
 * 2026-11-18, "XX" with oval B): its own art, sharp, dimmed and a little
 * desaturated, then a darkening from the middle in a tall oval like the card
 * (radii 55% of its width, 50% of its height, smoothstep falloff), the
 * numeral over it. Missing differs from held in lightness and the numeral,
 * never by hue alone.
 */
export const LOCKED_LOOK = {
  brightness: 0.6,
  saturate: 0.75,
  oval: { rx: 0.55, ry: 0.5 },
  color: [4, 6, 16] as const,
  /** [where along the radius, alpha]: 0.78 × smoothstep(1 − r). */
  stops: [
    [0, 0.78],
    [0.25, 0.66],
    [0.5, 0.39],
    [0.75, 0.12],
    [1, 0],
  ] as const,
} as const

/** The oval darkening as a CSS background (radii in % of the box). */
export function lockedOvalCss(): string {
  const { oval, color, stops } = LOCKED_LOOK
  const rgb = color.join(',')
  return `radial-gradient(${oval.rx * 100}% ${oval.ry * 100}% at 50% 50%, ${stops
    .map(([at, a]) => `rgba(${rgb},${a}) ${at * 100}%`)
    .join(', ')})`
}

/** The game's Lunar Arcana sky (gi-cdn), behind the cards on the page and the PNG. */
export const ARCANA_SKY = 'UI_Bg_RoleCombat_Tarot_01'
