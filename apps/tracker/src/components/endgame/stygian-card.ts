/**
 * The Stygian Onslaught record share card (the user's ask, 2026-11-06,
 * after the game's own record screen and Genshin Wizard's card): what it
 * shows, worked out from one captured record, and where it goes. Pure; the
 * canvas is stygian-card-canvas.ts.
 *
 * 1920 × 1080: a header (the mode, the season's name, the run kind,
 * difficulty and month), a side panel (the owner, the best-record medal
 * with the total time, the battle synopsis with the fastest fight) and a
 * row per battlefield (the boss's art with its level, its name, the battle
 * time with a done mark, the team as the game's bag cells with constellation
 * and level from the newest capture, the strongest strike and the top
 * damage with whose they were).
 */

import type { GiStygianRecord } from '@gdt/shared'
import { recordTotal } from '@/data/endgame-runs'

export const STYGIAN_CARD = {
  width: 1920,
  height: 1080,
  pad: 44,
  /** The header's band, from the top. */
  headerTop: 36,
  headerH: 84,
  /** The body under it. */
  bodyTop: 140,
  sideW: 420,
  gap: 24,
  rowGap: 18,
} as const

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

/** Where the body's parts go. */
export function stygianCardLayout(fights: number) {
  const { width, height, pad, bodyTop, sideW, gap, rowGap } = STYGIAN_CARD
  const bodyH = height - pad - bodyTop
  const rows = Math.max(1, fights)
  const rowX = pad + sideW + gap
  const rowW = width - pad - rowX
  const rowH = Math.floor((bodyH - rowGap * (rows - 1)) / rows)
  return {
    width,
    height,
    side: { x: pad, y: bodyTop, w: sideW, h: bodyH },
    rows: Array.from({ length: rows }, (_, i) => ({
      x: rowX,
      y: bodyTop + i * (rowH + rowGap),
      w: rowW,
      h: rowH,
    })),
  }
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
