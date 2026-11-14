/**
 * Wish history on the page: the stored chunks decoded, and per banner the
 * pity counts and 50/50 outcomes.
 *
 * Rules (as paimon.moe counts them):
 * - Pity: pulls since the last 5★ (or 4★), that pull included. A 5★ does
 *   not reset the 4★ count. 301 and 400 share one count.
 * - Character Event (301 + 400): a 5★ that is the banner's featured
 *   character won the 50/50 (or was guaranteed after a loss); any other 5★
 *   lost it, and the next 5★ is guaranteed. The same for 4★ with the three
 *   featured 4★ characters.
 * - Weapon Event (302): a 5★ that is one of the two featured weapons won
 *   (75/25) or was guaranteed; a standard 5★ lost, the next 5★ is a
 *   featured one. Which of the two (Epitomized Path) is not tracked: the
 *   history doesn't say which weapon was charted.
 * - Chronicled, Standard, Beginners': pity only.
 * - Capturing Radiance (5.0+, character event): worked out from the
 *   50/50 chain since 5.0's first day (see `RADIANCE_FROM`); the history
 *   itself never says, so only certain ones are marked.
 * Featured items come from banner data adapted from paimon.moe (MIT,
 * wish-banners.json, apps/tracker/scripts/wish-data.mjs). A pull outside
 * every known banner (one newer than the data) gets no outcome, and the
 * guarantee after it reads as unknown.
 */

import {
  decodeWishChunk,
  formatWishTime,
  fromBase64,
  parseWishTime,
  type UigfGachaType,
  type WishHistoryResponse,
  type WishPull,
} from '@gdt/shared'

export interface WishHistory {
  /** Hours from UTC of the pull times (the account's server clock). */
  timezone: number
  /** Pulls per UIGF banner type, in pull order. */
  banners: ReadonlyMap<UigfGachaType, readonly WishPull[]>
  total: number
  bytes: number
  /** When new pulls were last stored (Unix ms), if the server says. */
  updatedAt: number | null
}

export function decodeWishHistory(response: WishHistoryResponse): WishHistory {
  const banners = new Map<UigfGachaType, WishPull[]>()
  let total = 0
  for (const chunk of response.chunks) {
    const data = fromBase64(chunk.data)
    if (!data) continue
    const pulls = decodeWishChunk(chunk.banner, data)
    total += pulls.length
    const list = banners.get(chunk.banner)
    if (list) list.push(...pulls)
    else banners.set(chunk.banner, pulls)
  }
  return {
    timezone: response.timezone ?? 8,
    banners,
    total,
    bytes: response.bytes,
    updatedAt: response.updatedAt ?? null,
  }
}

/**
 * Time travel: the history as it stood at `at` (Unix ms), the pulls made by
 * then. Pull times are wall-clock seconds on the account's server clock.
 * Pure; the same object when nothing is cut.
 */
export function wishHistoryAt(history: WishHistory, at: number): WishHistory {
  const last = Math.floor(at / 1000) + history.timezone * 3600
  let cut = false
  let total = 0
  const banners = new Map<UigfGachaType, readonly WishPull[]>()
  for (const [banner, pulls] of history.banners) {
    let end = pulls.length
    while (end > 0 && pulls[end - 1]!.time > last) end--
    if (end < pulls.length) cut = true
    if (end) banners.set(banner, end < pulls.length ? pulls.slice(0, end) : pulls)
    total += end
  }
  return cut ? { ...history, banners, total } : history
}

// ------------------------------------------------------------------ banners

export type EventKind = 'character' | 'weapon' | 'chronicled'

export interface EventBanner {
  kind: EventKind
  /** UTC seconds. */
  start: number
  end: number
  featured5: readonly string[]
  featured4: readonly string[]
  version: string
  /** The banner's name; `name400` the second character banner's of a dual phase ('' if none). */
  name: string
  name400: string
}

export interface BannerFile {
  columns: string[]
  banners: [EventKind, string, string, 0 | 1, string[], string[], string, string?, string?][]
}

/**
 * The banners in UTC: paimon.moe writes times in UTC+8, except the ones
 * that open on each server's own clock (`serverTime`), which `timezone`
 * places.
 */
export function eventBanners(file: BannerFile, timezone: number): Map<EventKind, EventBanner[]> {
  const out = new Map<EventKind, EventBanner[]>()
  const utc = (text: string, serverTime: boolean) =>
    (parseWishTime(text) ?? 0) - (serverTime ? timezone : 8) * 3600
  for (const [
    kind,
    start,
    end,
    serverTime,
    featured5,
    featured4,
    version,
    name,
    name400,
  ] of file.banners) {
    const list = out.get(kind) ?? []
    list.push({
      kind,
      start: utc(start, serverTime === 1),
      // A phase ends at one instant everywhere (UTC+8 in the data).
      end: utc(end, false),
      featured5,
      featured4,
      version,
      name: name ?? '',
      name400: name400 ?? '',
    })
    out.set(kind, list)
  }
  for (const list of out.values()) list.sort((a, b) => a.start - b.start)
  return out
}

/** The banner a pull (UTC seconds) was made on, or null. Banners are sorted by start. */
export function bannerAt(banners: readonly EventBanner[], utc: number): EventBanner | null {
  let lo = 0
  let hi = banners.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (banners[mid]!.start <= utc) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  // Two banners can share a start (a dual phase listed twice): check a few back.
  for (let i = found; i >= 0 && i >= found - 3; i--) {
    const b = banners[i]!
    if (b.start <= utc && utc <= b.end) return b
  }
  // Between two banners: an update day, where a server's clock opens the
  // next banner earlier than the data's start says. The one opening soon.
  const next = banners[found + 1]
  return next && next.start - utc < 86_400 ? next : null
}

// ---------------------------------------------------------------- pity

/**
 * `radiance`: a 50/50 the game had to give the featured 5★ (Capturing
 * Radiance), told only where it is certain — see `RADIANCE_FROM`.
 */
export type Outcome = 'won' | 'lost' | 'guaranteed' | 'radiance'

/**
 * Capturing Radiance (character event banners, since 5.0; never shown in the
 * history, so it is worked out): a counter 0-3 that every account started
 * at 1 on 5.0's first day. A lost 50/50 adds one, a won one takes one off;
 * at 3 the next 50/50 is always the featured 5★ (that pull is the
 * radiance), and the counter goes back to 1. A win at 2 may also be one
 * (odds unknown, about half): not marked. Community analysis of ~4M pulls
 * (OneBST, 2024-12); the game publishes no rule.
 */
export const RADIANCE_FROM = parseWishTime('2024-08-28 06:00:00')!
const RADIANCE_MAX = 3

export interface PullRow {
  pull: WishPull
  /** 1-based, in the banner's pull order. */
  number: number
  /** Pulls this 4★ / 5★ took; 0 for 3★. */
  pity: number
  /** 50/50 (or 75/25) result; null where the banner has none or is not known. */
  outcome: Outcome | null
  /** The event banner it was pulled on (character, weapon, chronicled), when known. */
  on: EventBanner | null
}

/** A rarity's line of the summary table: how many, of all pulls, and their average pity. */
export interface RarityLine {
  count: number
  /** Of all pulls of the banner, 0-1. */
  share: number
  avgPity: number
}

/** 50/50s (75/25 on the weapon banner) won and lost; guaranteed ones are neither. */
export interface RateLine {
  won: number
  lost: number
  /** Of `won`, the ones that were certainly Capturing Radiance (character banner). */
  radiance: number
  /** won / (won + lost), null before the first. */
  rate: number | null
  /** Wins (or losses) in a row: now, and the longest. */
  winStreak: number
  maxWinStreak: number
  loseStreak: number
  maxLoseStreak: number
}

export interface MonthCount {
  /** "2026-10" on the game's clock. */
  month: string
  total: number
  five: number
  four: number
}

/** One run of an event banner, as the account pulled on it. */
export interface BannerRun {
  banner: EventBanner
  pulls: number
  /** Its 5★, oldest first. */
  fives: PullRow[]
}

export interface BannerStats {
  banner: UigfGachaType
  total: number
  /** Pulls since the last 5★ (toward the 90 pity). */
  pity5: number
  pity4: number
  /** The next 5★ is a featured one; null: no 50/50 here, or not known. */
  guaranteed5: boolean | null
  guaranteed4: boolean | null
  five: RarityLine
  four: RarityLine
  fourCharacter: RarityLine
  fourWeapon: RarityLine
  /** null on banners without a 50/50 (standard, beginners', chronicled). */
  rate5: RateLine | null
  rate4: RateLine | null
  /** Every pull, newest first. */
  rows: PullRow[]
  /** 5★ and 4★ pulls, newest first. */
  fives: PullRow[]
  fours: PullRow[]
  months: MonthCount[]
  /** Event banner runs pulled on, oldest first (event banner types only). */
  runs: BannerRun[]
  /**
   * Capturing Radiance's counter now (0-3; at 3 the next 50/50 is the
   * featured 5★): character event only, null before 5.0's first 5★ or once
   * a pull outside the banner data broke the chain.
   */
  radiance: number | null
}

/** Hard pity per banner type (5★, 4★). */
export const HARD_PITY: Readonly<Record<UigfGachaType, [number, number]>> = {
  100: [90, 10],
  200: [90, 10],
  301: [90, 10],
  302: [80, 10],
  500: [90, 10],
}

/** Where soft pity starts (the 5★ rate climbs from this pull). */
export const SOFT_PITY: Readonly<Record<UigfGachaType, number>> = {
  100: 74,
  200: 74,
  301: 74,
  302: 63,
  500: 74,
}

/**
 * The average pulls a 5★ takes with soft pity, from the community's models
 * of the game's rates (0.6% / 0.7% base, +6% / +7% a pull from soft pity):
 * about 62.3 on character-type banners and 53.3 on the weapon banner.
 */
export const EXPECTED_PITY: Readonly<Record<UigfGachaType, number>> = {
  100: 62.3,
  200: 62.3,
  301: 62.3,
  302: 53.3,
  500: 62.3,
}

/** Primogems a wish costs. */
export const PRIMOS_PER_PULL = 160

const RATE_KIND: Partial<Record<UigfGachaType, EventKind>> = {
  301: 'character',
  302: 'weapon',
}
const RUN_KIND: Partial<Record<UigfGachaType, EventKind>> = {
  ...RATE_KIND,
  500: 'chronicled',
}

function newRate(): RateLine {
  return {
    won: 0,
    lost: 0,
    radiance: 0,
    rate: null,
    winStreak: 0,
    maxWinStreak: 0,
    loseStreak: 0,
    maxLoseStreak: 0,
  }
}

function tally(rate: RateLine, outcome: Outcome | null): void {
  if (outcome === 'won' || outcome === 'radiance') {
    rate.won++
    if (outcome === 'radiance') rate.radiance++
    rate.winStreak++
    rate.loseStreak = 0
    rate.maxWinStreak = Math.max(rate.maxWinStreak, rate.winStreak)
  } else if (outcome === 'lost') {
    rate.lost++
    rate.loseStreak++
    rate.winStreak = 0
    rate.maxLoseStreak = Math.max(rate.maxLoseStreak, rate.loseStreak)
  }
  rate.rate = rate.won + rate.lost > 0 ? rate.won / (rate.won + rate.lost) : null
}

function line(rows: readonly PullRow[], total: number): RarityLine {
  const sum = rows.reduce((s, r) => s + r.pity, 0)
  return {
    count: rows.length,
    share: total > 0 ? rows.length / total : 0,
    avgPity: rows.length > 0 ? sum / rows.length : 0,
  }
}

export function bannerStats(
  banner: UigfGachaType,
  pulls: readonly WishPull[],
  options: { timezone: number; banners: ReadonlyMap<EventKind, readonly EventBanner[]> | null },
): BannerStats {
  const runKind = RUN_KIND[banner]
  const list = runKind && options.banners ? (options.banners.get(runKind) ?? []) : null
  const rated = !!RATE_KIND[banner] && !!list
  let pity5 = 0
  let pity4 = 0
  // null: not known (a pull outside the banner data broke the chain).
  let guaranteed5: boolean | null = rated ? false : null
  let guaranteed4: boolean | null = rated ? false : null
  const rate5 = newRate()
  const rate4 = newRate()
  // Capturing Radiance's counter: null before 5.0, -1 once the chain is unknown.
  let radiance: number | null = null
  const rows: PullRow[] = []
  const months = new Map<string, MonthCount>()
  const runs = new Map<EventBanner, BannerRun>()
  pulls.forEach((pull, i) => {
    pity5++
    pity4++
    const rank = pull.item.rank
    const on = list ? bannerAt(list, pull.time - options.timezone * 3600) : null
    let pity = 0
    let outcome: Outcome | null = null
    if (rank === 5 || rank === 4) {
      pity = rank === 5 ? pity5 : pity4
      if (rated) {
        const featured = on ? (rank === 5 ? on.featured5 : on.featured4) : null
        const before = rank === 5 ? guaranteed5 : guaranteed4
        let after: boolean | null
        if (!featured || !pull.item.key) {
          after = null
        } else if (featured.includes(pull.item.key)) {
          outcome = before ? 'guaranteed' : 'won'
          after = false
        } else {
          outcome = 'lost'
          after = true
        }
        if (rank === 5 && banner === 301 && pull.time >= RADIANCE_FROM && radiance !== -1) {
          if (before === null || after === null) radiance = -1
          else if (!before) {
            radiance ??= 1
            if (outcome === 'lost') radiance = Math.min(radiance + 1, RADIANCE_MAX)
            else if (radiance === RADIANCE_MAX) {
              outcome = 'radiance'
              radiance = 1
            } else radiance = Math.max(radiance - 1, 0)
          }
        }
        if (rank === 5) {
          guaranteed5 = after
          tally(rate5, outcome)
        } else {
          guaranteed4 = after
          tally(rate4, outcome)
        }
      }
      if (rank === 5) pity5 = 0
      else pity4 = 0
    }
    const row: PullRow = { pull, number: i + 1, pity, outcome, on }
    rows.push(row)

    const month = formatWishTime(pull.time).slice(0, 7)
    const m = months.get(month) ?? { month, total: 0, five: 0, four: 0 }
    m.total++
    if (rank === 5) m.five++
    else if (rank === 4) m.four++
    months.set(month, m)

    if (on) {
      const run = runs.get(on) ?? { banner: on, pulls: 0, fives: [] }
      run.pulls++
      if (rank === 5) run.fives.push(row)
      runs.set(on, run)
    }
  })
  const total = pulls.length
  const fives = rows.filter((r) => r.pull.item.rank === 5)
  const fours = rows.filter((r) => r.pull.item.rank === 4)
  return {
    banner,
    total,
    pity5,
    pity4,
    guaranteed5,
    guaranteed4,
    five: line(fives, total),
    four: line(fours, total),
    fourCharacter: line(
      fours.filter((r) => r.pull.item.kind === 'character'),
      total,
    ),
    fourWeapon: line(
      fours.filter((r) => r.pull.item.kind === 'weapon'),
      total,
    ),
    rate5: rated ? rate5 : null,
    rate4: rated ? rate4 : null,
    rows: rows.reverse(),
    fives: fives.reverse(),
    fours: fours.reverse(),
    months: [...months.values()],
    runs: [...runs.values()],
    radiance: banner === 301 && radiance !== null && radiance >= 0 ? radiance : null,
  }
}

/** Every month from `first` to `last` ("2026-10"), both included. */
function monthRange(first: string, last: string): string[] {
  const out: string[] = []
  let [y, mo] = first.split('-').map(Number) as [number, number]
  for (;;) {
    const key = `${y}-${String(mo).padStart(2, '0')}`
    out.push(key)
    if (key >= last) break
    mo++
    if (mo > 12) {
      mo = 1
      y++
    }
  }
  return out
}

/** Pulls of every banner per month (game clock), oldest first, months without pulls included. */
export function monthlyPulls(stats: readonly BannerStats[]): MonthCount[] {
  const all = new Map<string, MonthCount>()
  for (const s of stats) {
    for (const m of s.months) {
      const a = all.get(m.month) ?? { month: m.month, total: 0, five: 0, four: 0 }
      a.total += m.total
      a.five += m.five
      a.four += m.four
      all.set(m.month, a)
    }
  }
  const keys = [...all.keys()].sort()
  if (keys.length === 0) return []
  return monthRange(keys[0]!, keys.at(-1)!).map(
    (key) => all.get(key) ?? { month: key, total: 0, five: 0, four: 0 },
  )
}

/**
 * How a 5★ pity reads, for its colour: early (up to about two thirds of the
 * way to soft pity: 50 on the character banner, 43 on the weapon one),
 * before soft pity, in soft pity's first six pulls (74-79, 63-68), or late.
 */
export type PityBand = 'early' | 'mid' | 'soft' | 'late'

export function pityBand(pity: number, banner: UigfGachaType): PityBand {
  const soft = SOFT_PITY[banner]
  if (pity <= Math.round(soft * 0.68)) return 'early'
  if (pity < soft) return 'mid'
  if (pity < soft + 6) return 'soft'
  return 'late'
}

/** The run of a banner open at `now` (UTC seconds), when the account pulled on it. */
export function currentRun(runs: readonly BannerRun[], now: number): BannerRun | null {
  for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i]!
    if (run.banner.start <= now && now <= run.banner.end) return run
  }
  return null
}

/** How many pulls of `rows` took each pity, 1..hard (index 0 = pity 1). */
export function pityHistogram(rows: readonly PullRow[], hard: number): number[] {
  const out = new Array<number>(hard).fill(0)
  for (const r of rows) if (r.pity >= 1 && r.pity <= hard) out[r.pity - 1]!++
  return out
}

/**
 * paimon.moe's "#Roll": each pull's number within the banner run it was
 * made on (1 = the run's first pull), for `rows` newest first as
 * BannerStats gives them. A pull outside the banner data, or on a banner
 * without runs (standard, beginners'), has its number on the banner.
 */
export function runPullNumbers(rows: readonly PullRow[]): Map<PullRow, number> {
  const out = new Map<PullRow, number>()
  const seen = new Map<EventBanner, number>()
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]!
    if (!row.on) {
      out.set(row, row.number)
      continue
    }
    const n = (seen.get(row.on) ?? 0) + 1
    seen.set(row.on, n)
    out.set(row, n)
  }
  return out
}
