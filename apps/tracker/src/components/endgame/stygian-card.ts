/**
 * The Stygian Onslaught record share card (the user's ask, 2026-11-06,
 * after the game's own record screen and Genshin Wizard's card; design "F",
 * iterated with the user on https://claude.ai/artifact/GbHi5x3VT98oFfpm1nVs3q):
 * what it shows, worked out from one captured record, and where it goes.
 * Pure; the canvas is stygian-card-canvas.ts.
 *
 * 1920 × 1080. A header of three: the owner's in-game profile (name card
 * fading out to the ground, the profile picture in its frame at the game's
 * scale, name, signature, UID), the best-record medal and total time in a
 * pill in the middle, and the season (mode, month, version; name; dates) in
 * a panel fading the other way. Then a column per battlefield: the boss's
 * art growing to fill it, its name and title, the battle time, the team as
 * the game's bag cells (element, constellation, level from the newest
 * capture) and the strongest strike and top damage with whose they were.
 * A foot line: when the record was set, and the site.
 */

import type { GiStygianRecord } from '@gdt/shared'
import { recordTotal } from '@/data/endgame-runs'

export const STYGIAN_CARD = {
  width: 1920,
  height: 1080,
  padX: 44,
  padTop: 32,
  padBottom: 26,
  headerH: 190,
  /** Between the header, the columns and the foot line. */
  gap: 22,
  /** Between the header's three parts. */
  headerGap: 26,
  columnGap: 24,
  /** The foot line's box (17px text). */
  footH: 25,
} as const

/** The medal pill: its height, medal, gaps and padding. */
export const MEDAL_PILL = { h: 172, medal: 140, gap: 18, padLeft: 22, padRight: 40 } as const

/**
 * Where the name card is opaque, then fades out (alpha by the card's width,
 * left to right); the season panel fades the same way from the right,
 * starting later (it is a plain panel, which melts into the ground sooner).
 * The user's tuning, 2026-11-06.
 */
export const PROFILE_FADE: readonly (readonly [number, number])[] = [
  [0, 1],
  [0.28, 1],
  [0.41, 0.8],
  [0.53, 0.55],
  [0.64, 0.3],
  [0.73, 0.12],
  [0.79, 0],
]
export const SEASON_FADE: readonly (readonly [number, number])[] = [
  [0, 1],
  [0.4, 1],
  [0.56, 0.8],
  [0.7, 0.55],
  [0.84, 0.3],
  [0.94, 0.12],
  [1, 0],
]
/** How much of the ground colour lies over the fading part (to dim it), by the same axis. */
export const PROFILE_DIM: readonly (readonly [number, number])[] = [
  [0.28, 0],
  [0.45, 0.25],
  [0.63, 0.5],
  [0.79, 0.6],
]
export const SEASON_DIM: readonly (readonly [number, number])[] = [
  [0.4, 0],
  [0.62, 0.25],
  [0.84, 0.5],
  [1, 0.6],
]

/** The profile card's parts, from its top-left (design F). */
export const PROFILE = {
  /** The profile picture's circle. */
  picture: { x: 32, y: 25, d: 140 },
  text: { left: 204, right: 90, top: 28, bottom: 26 },
} as const

type Box = { x: number; y: number; w: number; h: number }

/** The header's three boxes, given the medal pill's width (it sizes to its time). */
export function stygianHeader(pillW: number): { profile: Box; pill: Box; season: Box } {
  const { width, padX, padTop, headerH, headerGap } = STYGIAN_CARD
  const inner = width - 2 * padX
  const side = (inner - pillW - 2 * headerGap) / 2
  return {
    profile: { x: padX, y: padTop, w: side, h: headerH },
    pill: {
      x: padX + side + headerGap,
      y: padTop + (headerH - MEDAL_PILL.h) / 2,
      w: pillW,
      h: MEDAL_PILL.h,
    },
    season: { x: width - padX - side, y: padTop, w: side, h: headerH },
  }
}

/** A column per fight under the header, and the foot line's box. */
export function stygianColumns(fights: number): { columns: Box[]; foot: Box } {
  const { width, height, padX, padTop, padBottom, headerH, gap, columnGap, footH } = STYGIAN_CARD
  const n = Math.max(1, fights)
  const top = padTop + headerH + gap
  const footY = height - padBottom - footH
  const h = footY - gap - top
  const w = (width - 2 * padX - columnGap * (n - 1)) / n
  return {
    columns: Array.from({ length: n }, (_, i) => ({ x: padX + i * (w + columnGap), y: top, w, h })),
    foot: { x: padX + 8, y: footY, w: width - 2 * padX - 16, h: footH },
  }
}

/** A column's lower part (design F): padding, gaps and the parts' heights. */
export const COLUMN = {
  pad: 24,
  padBottom: 22,
  gap: 14,
  /** The boss name (26px × 1.15), 2px, the title (17px × 1.5). */
  nameH: 30,
  titleH: 25.5,
  tileGap: 10,
  figureH: 58,
  figureGap: 10,
  /** The boss art's square, centred at 52% of the art box's height. */
  art: 440,
  /** The fade from the art into the panel at the art box's foot. */
  artFade: 110,
} as const

/** The column's lower part's height, given its width (the tiles' height follows it). */
export function columnFootH(w: number): number {
  const tile = bagCell((w - 2 * COLUMN.pad - 3 * COLUMN.tileGap) / 4)
  return (
    COLUMN.nameH +
    2 +
    COLUMN.titleH +
    COLUMN.gap +
    tile.h +
    COLUMN.gap +
    2 * COLUMN.figureH +
    COLUMN.figureGap +
    COLUMN.padBottom
  )
}

/**
 * The game's bag cell `w` wide (the site's ItemTile, 80 × 98): the
 * portrait fills the top square, the cream strip with the level at the
 * foot with the cell's inner curl over its right end, the element top-left
 * and the constellation chip top-right. Every length is a share of the width.
 */
export function bagCell(w: number) {
  return {
    w,
    h: (w * 98) / 80,
    r: w * 0.07,
    strip: w * 0.205,
    /** The curl: a quarter circle of cream cut round, on the strip's right end. */
    curl: w * 0.19,
    curlBottom: w * 0.204,
    levelSize: w * 0.155,
    element: { x: w * 0.04, y: w * 0.04, d: w * 0.24 },
    chip: { inset: w * 0.04, padX: w * 0.045, padY: w * 0.005, r: w * 0.045, size: w * 0.11 },
  }
}

/** A boss's full name splits at its colon: the name, then the title under it. */
export function splitBossName(full: string): { name: string; title: string } {
  const at = full.search(/[:：]/)
  return at < 0
    ? { name: full.trim(), title: '' }
    : { name: full.slice(0, at).trim(), title: full.slice(at + 1).trim() }
}

/**
 * Text broken into at most `lines` lines `max` px wide (by words; a word
 * wider than a line, or text without spaces, by characters), the last cut
 * with an ellipsis when the rest doesn't fit.
 */
export function wrapLines(
  text: string,
  max: number,
  measure: (text: string) => number,
  lines: number,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const out: string[] = []
  let line = ''
  const push = () => {
    out.push(line)
    line = ''
  }
  const tokens: string[] = []
  for (const word of words) {
    if (measure(word) <= max) tokens.push(word)
    else tokens.push(...Array.from(word).map((c, i) => (i === 0 ? c : `\u0000${c}`)))
  }
  for (const token of tokens) {
    const joined = token.startsWith('\u0000')
    const piece = joined ? token.slice(1) : token
    const next = line ? (joined ? line + piece : `${line} ${piece}`) : piece
    if (!line || measure(next) <= max) line = next
    else {
      push()
      line = piece
    }
  }
  if (line) push()
  if (out.length <= lines) return out
  const kept = out.slice(0, lines)
  let last = `${kept[lines - 1]} ${out.slice(lines).join(' ')}`
  while (last && measure(`${last}…`) > max) last = Array.from(last).slice(0, -1).join('')
  kept[lines - 1] = `${last.trimEnd()}…`
  return kept
}

/**
 * The game version a season ran in: the version of the newest character
 * event wish that opened by its start (banners are the site's dated
 * version timeline; "YYYY-MM-DD hh:mm:ss" strings compare in order).
 */
export function seasonVersion(
  start: string,
  banners: readonly { kind: string; start: string; version: string }[],
): string | null {
  let best: { start: string; version: string } | null = null
  for (const b of banners)
    if (b.kind === 'character' && b.start <= start && (!best || b.start > best.start)) best = b
  return best?.version ?? null
}

/**
 * Dire's time limit (LeyLineLevel's 180 s on every season's Dire level, game
 * data 7.2): a Dire clear inside it earns the laurelled medal
 * (`UI_LeyLineChallenge_Medal_7`, LeyLineDifficulty 6's second medal).
 */
export const DIRE_TIME_LIMIT = 180
const DIRE = 6

/** The medal a record earns: the difficulty's (1-6), or Dire's laurelled one inside the time limit. */
export function stygianMedal(record: Pick<GiStygianRecord, 'difficulty' | 'fights'>): string {
  const total = recordTotal(record as GiStygianRecord)
  const n =
    record.difficulty === DIRE && total !== null && total <= DIRE_TIME_LIMIT
      ? 7
      : Math.min(6, Math.max(1, record.difficulty))
  return `UI_LeyLineChallenge_Medal_${n}`
}

/** The index of the fastest done fight, when two or more are done; else -1. */
export function fastestFight(record: Pick<GiStygianRecord, 'fights'>): number {
  const done = record.fights.flatMap((f, i) => (f.done ? [{ i, time: f.time }] : []))
  if (done.length < 2) return -1
  return done.reduce((best, f) => (f.time < best.time ? f : best)).i
}

/** The PNG's file name: the season's start month and the run kind. */
export function stygianFileName(start: string, coop: boolean): string {
  const month = /^(\d{4})-(\d{2})/.exec(start)
  return `stygian-${month ? `${month[1]}-${month[2]}` : 'record'}-${coop ? 'coop' : 'solo'}-teyvat-me.png`
}

/** The season's month as the game's record screen writes it: "2026/9". */
export function seasonMonth(start: string): string {
  const month = /^(\d{4})-(\d{2})/.exec(start)
  return month ? `${month[1]}/${Number(month[2])}` : ''
}
