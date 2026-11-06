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
  type StygianBoss,
  type StygianSeason,
  type TheaterSeason,
  type SERVER_OFFSETS,
} from '@gdt/game-data/endgame'
import type { GenshinServer, GiStygianRecord, GiTheaterRun } from '@gdt/shared'
import { t } from '@/i18n'
import type { Locale } from '@/i18n/locale'
import { formatNumber } from '@/lib/format'
import {
  fightsDone,
  formatFightTime,
  recordTotal,
  type CapturedAbyss,
  type CapturedAbyssRecord,
  type CapturedEndgame,
  type GiAbyssRun,
} from './endgame-runs'

export const ENDGAME_MODES = ['abyss', 'theater', 'stygian'] as const
export type EndgameMode = (typeof ENDGAME_MODES)[number]
export const ENDGAME_MODE_PATTERN = ENDGAME_MODES.join('|')

export const isEndgameMode = (value: unknown): value is EndgameMode =>
  typeof value === 'string' && (ENDGAME_MODES as readonly string[]).includes(value)

export type SeasonStatus = 'upcoming' | 'active' | 'ended'

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

/** The year a season starts in (the archive's year chips). */
export const seasonYear = (season: { start: string }) => season.start.slice(0, 4)

const DAY = 86_400_000

/** Whole days left until a season ends on the account's server (0 once it has). */
export function daysLeft(
  season: { end: string },
  now: number,
  server: GenshinServer | null | undefined,
): number {
  return Math.max(0, Math.ceil((seasonTime(season.end, server) - now) / DAY))
}

/** How far through its period a season is, 0-100 (the mode cards' bars). */
export function elapsedPercent(
  season: { start: string; end: string },
  now: number,
  server: GenshinServer | null | undefined,
): number {
  const start = seasonTime(season.start, server)
  const end = seasonTime(season.end, server)
  if (!(end > start)) return 100
  return Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100))
}

/**
 * A Stygian boss's HP tooltip: the exact figure at the level and, when it is before the
 * difficulty's per-boss bonus (Fearless/Dire without known multipliers), what that means.
 */
export function stygianHpTip(hp: number, level: number, before: boolean): string {
  if (!hp) return ''
  const line = `${t('endgame.hpAt', { n: level })}: ${formatNumber(hp)}`
  return before ? `${line}\n${t('endgame.beforeBonusTip')}` : line
}

/**
 * A Stygian opponent's picture: the game's own boss art (the boss on its
 * purple swirl, UI_Img_LeyLineChallenge_*), else its icon. `art` says which,
 * since the art has room around the boss and is shown a little closer.
 */
export function stygianBossPicture(boss: StygianBoss): { name: string; art: boolean } {
  return boss.art ? { name: boss.art, art: true } : { name: boss.icon, art: false }
}

/** The distinct enemies of an Abyss period's last floor, in order (its cards' preview). */
export function abyssTopEnemies(season: AbyssPeriod, count = 6): number[] {
  const floor = season.floors.at(-1)
  const ids = floor?.chambers.flatMap((c) => c.halves.flat().map((e) => e.monster)) ?? []
  return [...new Set(ids)].slice(0, count)
}

/** The highest difficulty of a Stygian season (what its card's HP is read at). */
export function stygianTop(season: StygianSeason): StygianSeason['difficulties'][number] | null {
  return season.difficulties.at(-1) ?? null
}

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

// ----------------------------------------------------- the account's own runs
// What the captures say (gi_endgame, Capture 1.17.12; data/endgame-capture.ts),
// as the cards and season pages word it.

/** A Theater difficulty's name as the game shows it ("Visionary Mode"), else its number. */
export function theaterDifficultyName(level: number, text: EndgameText): string {
  return text.get(`theaterDifficulty.${level}`) || t('endgame.theater.difficultyN', { n: level })
}

export function stygianDifficultyName(difficulty: number, text: EndgameText): string {
  return text.get(`stygianDifficulty.${difficulty}`) || String(difficulty)
}

/** The account's own run of a season in a line (the hero and archive cards). */
export interface RunLine {
  text: string
  coop: boolean
}

/** The Theater difficulty row the run was on (its acts count), if the data has it. */
export const theaterRunRow = (run: GiTheaterRun, season: TheaterSeason) =>
  run.level === undefined ? undefined : season.difficulties.find((d) => d.difficulty === run.level)

/** The stars a run could earn: what the capture says, else one per act and extra bout of its difficulty. */
export function theaterStarsMax(run: GiTheaterRun, season: TheaterSeason): number {
  if (run.maxStars) return run.maxStars
  const row = theaterRunRow(run, season)
  return row ? row.acts.length + row.extra.length : 0
}

/** "★ 12/12" ("★ 12" when the maximum is unknown); '' when the capture has no stars. */
export function theaterStarsText(run: GiTheaterRun, season: TheaterSeason): string {
  if (run.stars === undefined) return ''
  const total = theaterStarsMax(run, season)
  return total
    ? t('endgame.captured.stars', { n: run.stars, total })
    : t('endgame.captured.starsN', { n: run.stars })
}

export function theaterRunLine(
  run: GiTheaterRun,
  season: TheaterSeason,
  text: EndgameText,
): RunLine {
  const row = theaterRunRow(run, season)
  if (!row && run.acts === 0 && !run.stars)
    return { text: t('endgame.captured.notEntered'), coop: false }
  const total = row?.acts.length ?? 0
  const acts = total
    ? t('endgame.captured.actsOf', { n: run.acts, total })
    : t('endgame.theater.acts', { n: run.acts })
  const label = row ? theaterDifficultyName(row.difficulty, text) : ''
  const stars = theaterStarsText(run, season)
  return { text: [label, acts, stars].filter(Boolean).join(' · '), coop: false }
}

export function stygianRecordLine(record: GiStygianRecord, text: EndgameText): RunLine {
  const total = recordTotal(record)
  const figure =
    total === null
      ? t('endgame.captured.clearedOf', { n: fightsDone(record), total: record.fights.length })
      : formatFightTime(total)
  return {
    text: `${stygianDifficultyName(record.difficulty, text)} · ${figure}`,
    coop: record.coop,
  }
}

/**
 * The account's Abyss stars of a period: the capture whose running period
 * (`gi_tasks.abyss`, the game's own start) began inside this period on the
 * account's server (the start matches to the second; the window tolerates a
 * clock a little off).
 */
export function abyssRunFor(
  period: AbyssPeriod,
  captured: CapturedEndgame,
  server: GenshinServer | null | undefined,
): CapturedAbyss | null {
  const start = seasonTime(period.start, server) / 1000
  const exact = captured.abyss.get(start)
  if (exact) return exact
  const end = seasonTime(period.end, server) / 1000
  for (const [at, run] of captured.abyss) if (at >= start && at <= end) return run
  return null
}

/** The account's record of a period from the Spiral Abyss's record book (by TowerSchedule id). */
export function abyssRecordFor(
  period: AbyssPeriod,
  captured: CapturedEndgame,
): CapturedAbyssRecord | null {
  return captured.abyssBook.get(period.id) ?? null
}

/** "★ 27/36": a period's stars as the capture counted them. */
export function abyssRunLine(run: GiAbyssRun): RunLine {
  return {
    text: t('endgame.captured.stars', { n: run.stars, total: run.maxStars }),
    coop: false,
  }
}

/** Solo first, then co-op (the order the game lists them). */
export const soloFirst = (records: readonly GiStygianRecord[]) =>
  [...records].sort((a, b) => Number(a.coop) - Number(b.coop))
