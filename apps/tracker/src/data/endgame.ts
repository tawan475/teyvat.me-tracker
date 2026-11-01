/**
 * The endgame modes (Spiral Abyss, Imaginarium Theater, Stygian Onslaught)
 * from the game data (`@gdt/game-data/endgame`): what the Endgame page lists.
 *
 * - Dates are the game's server-time strings; a season's status is read on
 *   the account's server (Asia when it has none).
 * - Seasons that haven't started are left out: the site shows only what is
 *   in the live game.
 */

import {
  endgameTime,
  loadEndgame,
  loadEndgameText,
  type AbyssPeriod,
  type Endgame,
  type EndgameText,
  type StygianSeason,
  type TheaterSeason,
  type SERVER_OFFSETS,
} from '@gdt/game-data/endgame'
import type { GenshinServer } from '@gdt/shared'
import type { RouteLocationRaw } from 'vue-router'
import type { Locale } from '@/i18n/locale'

export const ENDGAME_MODES = ['abyss', 'theater', 'stygian'] as const
export type EndgameMode = (typeof ENDGAME_MODES)[number]
export const ENDGAME_MODE_PATTERN = ENDGAME_MODES.join('|')

export const isEndgameMode = (value: unknown): value is EndgameMode =>
  typeof value === 'string' && (ENDGAME_MODES as readonly string[]).includes(value)

export type SeasonStatus = 'upcoming' | 'active' | 'ended'

/** A row of the Endgame page's season list. */
export interface SeasonRow {
  id: number
  name: string
  status: Exclude<SeasonStatus, 'upcoming'>
  period: string
  to: RouteLocationRaw
}

export interface EndgameData {
  data: Endgame
  text: EndgameText
}

const cache = new Map<Locale, Promise<EndgameData>>()

/** The data and its text in a language; the same promise per language (useResource reads it at once). */
export function loadEndgameData(lang: Locale): Promise<EndgameData> {
  let found = cache.get(lang)
  if (!found) {
    found = Promise.all([loadEndgame(), loadEndgameText(lang)]).then(([data, text]) => ({
      data,
      text,
    }))
    found.catch(() => cache.delete(lang))
    cache.set(lang, found)
  }
  return found
}

const SERVER_CLOCKS: Record<GenshinServer, keyof typeof SERVER_OFFSETS> = {
  ASIA: 'asia',
  SAR: 'asia',
  EUROPE: 'europe',
  AMERICA: 'america',
}

/** A schedule date as a timestamp on the account's server. */
export function seasonTime(date: string, server: GenshinServer | null | undefined): number {
  return endgameTime(date, server ? SERVER_CLOCKS[server] : 'asia')
}

export function seasonStatus(
  season: { start: string; end: string },
  now: number,
  server: GenshinServer | null | undefined,
): SeasonStatus {
  if (now < seasonTime(season.start, server)) return 'upcoming'
  return now <= seasonTime(season.end, server) ? 'active' : 'ended'
}

export type AnySeason = AbyssPeriod | TheaterSeason | StygianSeason

/** A mode's seasons that have started, newest first. */
export function startedSeasons(
  data: Endgame,
  mode: EndgameMode,
  now: number,
  server: GenshinServer | null | undefined,
): AnySeason[] {
  const list: readonly AnySeason[] = data[mode]
  return list.filter((s) => seasonStatus(s, now, server) !== 'upcoming')
}

/** A season's name as the game shows it ('' when it has none: the Theater names its seasons by month). */
export function seasonName(mode: EndgameMode, season: AnySeason, text: EndgameText): string {
  if (mode === 'abyss') return text.get(`abyss.${season.id}.name`)
  if (mode === 'stygian') return text.get(`stygian.${season.id}.name`)
  return ''
}

/** A schedule date's day ("2026-10-16 04:00:00" -> "2026-10-16"), for compact ranges. */
export const dateOf = (date: string) => date.slice(0, 10)

/** One piece of game text: plain, a coloured run, or an inline icon (`{SPRITE_PRESET#id}`). */
export type GameRun =
  | { text: string; color?: string; sprite?: undefined }
  | { sprite: number; text?: undefined }

const RUNS = /<color=#([0-9A-Fa-f]{6})>(.*?)<\/color>|\{SPRITE_PRESET#(\d+)\}/g

/**
 * Game text as lines of runs: its line breaks, `<color=#RRGGBB>…</color>`
 * spans and `{SPRITE_PRESET#<id>}` icons (an element or a reaction).
 */
export function gameRuns(text: string): GameRun[][] {
  return text.split('\n').map((line) => {
    const runs: GameRun[] = []
    let at = 0
    for (const match of line.matchAll(RUNS)) {
      if (match.index > at) runs.push({ text: line.slice(at, match.index) })
      if (match[3]) runs.push({ sprite: Number(match[3]) })
      else if (match[2]) runs.push({ text: match[2], color: `#${match[1]}` })
      at = match.index + match[0].length
    }
    if (at < line.length) runs.push({ text: line.slice(at) })
    return runs
  })
}
