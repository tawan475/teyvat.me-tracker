/**
 * The game's notice board (the in-game "News"/"Event" notices, public at
 * hk4e-api's getAnnList/getAnnContent) read into dated events, and the
 * planner's domain events derived from them. Pure: the Worker's hourly sync
 * (worker/services/game-events.ts) fetches, this reads. See
 * docs/plans/game-events.md.
 *
 * Dates are the server's local time, as the notices write them, kept as
 * `YYYY-MM-DDTHH:mm` (the same shape as domain event windows): an event runs
 * at the same local hours on every server. The board's own start/end times
 * say when a notice is *shown*, not when its event runs, so only the text
 * counts.
 */

import { DOMAIN_EVENT_KINDS, type DomainEventKind, type DomainEventWindow } from './domain-events'
import type { SiteLanguage } from './settings'

export type NoticeKind = 'wish' | 'event'

/** A notice's event in server local time; `end` null = open-ended ("permanently available"). */
export interface NoticeWindow {
  start: string
  end: string | null
}

/** What the board says about a game version: when its update landed (server local). */
export interface VersionTimes {
  version: string
  /** The update time as written (UTC+8, the same instant on every server). */
  updateUtc8: string
}

/** Server UTC offsets (hours), as the planner's domain days use them. */
export const NOTICE_SERVER_OFFSETS = { AMERICA: -5, EUROPE: 1, ASIA: 8, SAR: 8 } as const
export type NoticeServer = keyof typeof NOTICE_SERVER_OFFSETS

/** The board's region code of each server. */
export const NOTICE_REGIONS: Readonly<Record<NoticeServer, string>> = {
  AMERICA: 'os_usa',
  EUROPE: 'os_euro',
  ASIA: 'os_asia',
  SAR: 'os_cht',
}

const ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

const decodeEntities = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code =
        name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1))
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[name.toLowerCase()] ?? whole
  })

/**
 * A notice's HTML as plain text: entities decoded (the board sends some tags
 * encoded), tags dropped, every space one space. The board marks each time:
 * `<t class="t_lc">` is the server's local time (kept), `<t class="t_gl">` a
 * global one in UTC+8, the same instant everywhere (web events): with
 * `server` it becomes that server's local time, so every time in the text
 * reads the same way.
 */
export function noticeText(html: string, server?: NoticeServer): string {
  const globalTime = /<t\b[^>]*\bt_gl\b[^>]*>\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/gi
  return decodeEntities(
    decodeEntities(html)
      .replace(globalTime, (whole, y: string, mo: string, d: string, h: string, mi: string) => {
        const at = local(y, mo, d, h, mi)
        if (!at || !server) return whole
        const there = addMinutes(at, (NOTICE_SERVER_OFFSETS[server] - 8) * 60)
        return ` ${there.slice(0, 10).replace(/-/g, '/')} ${there.slice(11)}`
      })
      .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, ' ')
      .replace(/<[^>]*>/g, ' '),
  )
    .replace(/[\s 　]+/g, ' ')
    .trim()
}

const DATE = String.raw`(\d{4})/(\d{1,2})/(\d{1,2})\s+(\d{1,2}):(\d{2})`
/** Between two times of a range: a dash of any kind, a tilde, "to". */
const SEP = String.raw`\s*(?:[-‐‑‒–—―~～至]|to)\s*`
const VERSION = String.raw`(?:the\s+)?Version\s+(\d+\.\d+)\s+[Uu]pdate`

const pad = (n: string | number) => String(n).padStart(2, '0')

/** `2026/9/30 10:00` parts as `2026-09-30T10:00`, null when not a real time. */
function local(y: string, mo: string, d: string, h: string, mi: string): string | null {
  const [Y, M, D, H, I] = [y, mo, d, h, mi].map(Number) as [number, number, number, number, number]
  const date = new Date(Date.UTC(Y, M - 1, D, H, I))
  if (date.getUTCMonth() !== M - 1 || date.getUTCDate() !== D || H > 23 || I > 59) return null
  return `${Y}-${pad(M)}-${pad(D)}T${pad(H)}:${pad(I)}`
}

/** A server local time `minutes` later. */
export function addMinutes(time: string, minutes: number): string {
  const ms = Date.parse(`${time}:00Z`) + minutes * 60_000
  return new Date(ms).toISOString().slice(0, 16)
}

/** An end written as `03:59` (the last minute) as the exclusive `04:00`. */
function endExclusive(time: string): string {
  return time.endsWith(':59') ? addMinutes(time, 1) : time
}

/** The version's update time (UTC+8) on a server, local time. */
export function versionStartOn(version: VersionTimes, server: NoticeServer): string {
  return addMinutes(version.updateUtc8, (NOTICE_SERVER_OFFSETS[server] - 8) * 60)
}

/**
 * "Version 7.1 Update Time: 2026/09/23 06:00" (the top-up reset notice, and
 * maintenance notices): the version and its update time, UTC+8.
 */
export function versionUpdateTime(text: string): VersionTimes | null {
  const m = new RegExp(
    String.raw`Version\s+(\d+\.\d+)\s+Update\s+Time\s*[:：]\s*${DATE}`,
    'i',
  ).exec(text)
  if (!m) return null
  const at = local(m[2]!, m[3]!, m[4]!, m[5]!, m[6]!)
  return at ? { version: m[1]!, updateUtc8: at } : null
}

export interface WindowContext {
  server: NoticeServer
  /** Versions whose update time is known (from any notice). */
  versions: readonly VersionTimes[]
  /** The end of the current version, server local, when known ("until the end of Version …"). */
  versionEnd?: string | null
  /**
   * When the board first showed the notice, server local: the start of an
   * event "after the Version X update" when no notice gives X's update time
   * any more (an older version's event, running for months).
   */
  shownFrom?: string | null
}

/**
 * The event window a notice's text states, the first one in the text (the
 * event's own duration comes first; later ranges are its phases): a range
 * `2026/09/30 10:00 - 2026/11/03 03:59`, `After the Version 7.1 update –
 * 2026/11/02 03:59`, `2026/09/28 00:00 until the end of Version 7.1`,
 * `throughout the entirety of Version 7.1`, `Permanently available after the
 * Version 7.1 update`. Ends written as the last minute (`03:59`) become the
 * exclusive next minute. Null when the text holds none of these, or names a
 * version whose update time is unknown.
 */
export function noticeWindow(text: string, context: WindowContext): NoticeWindow | null {
  const startOf = (version: string) => {
    const v = context.versions.find((x) => x.version === version)
    return v ? versionStartOn(v, context.server) : (context.shownFrom ?? null)
  }
  const versionEnd = context.versionEnd ?? null
  type Hit = { at: number; window: NoticeWindow | null }
  const hits: Hit[] = []
  const find = (pattern: string, read: (m: RegExpExecArray) => NoticeWindow | null) => {
    const m = new RegExp(pattern, 'i').exec(text)
    if (m) hits.push({ at: m.index, window: read(m) })
  }
  find(`${DATE}${SEP}${DATE}`, (m) => {
    const start = local(m[1]!, m[2]!, m[3]!, m[4]!, m[5]!)
    const end = local(m[6]!, m[7]!, m[8]!, m[9]!, m[10]!)
    return start && end && start < end ? { start, end: endExclusive(end) } : null
  })
  find(`After\\s+${VERSION}${SEP}${DATE}`, (m) => {
    const start = startOf(m[1]!)
    const end = local(m[2]!, m[3]!, m[4]!, m[5]!, m[6]!)
    return start && end && start < end ? { start, end: endExclusive(end) } : null
  })
  find(`${DATE}\\s+until\\s+the\\s+end\\s+of\\s+Version\\s+(\\d+\\.\\d+)`, (m) => {
    const start = local(m[1]!, m[2]!, m[3]!, m[4]!, m[5]!)
    return start && versionEnd && start < versionEnd ? { start, end: versionEnd } : null
  })
  find(String.raw`entirety\s+of\s+Version\s+(\d+\.\d+)`, (m) => {
    const start = startOf(m[1]!)
    return start && versionEnd && start < versionEnd ? { start, end: versionEnd } : null
  })
  find(`Permanently\\s+available\\s+after\\s+${VERSION}`, (m) => {
    const start = startOf(m[1]!)
    return start ? { start, end: null } : null
  })
  hits.sort((a, b) => a.at - b.at)
  return hits.find((hit) => hit.window)?.window ?? null
}

/** A board entry as the sync keeps it (the list's type and the content's text). */
export interface BoardEntry {
  annId: number
  /** The list's `type_label` in English: "Event", "Game", "Miliastra Wonderland". */
  typeLabel: string
  title: string
}

/**
 * Which notices are events the planner lists: Event Wishes (`wish`, they also
 * date the banner phases) and the board's Events (`event`); game news,
 * Miliastra Wonderland and top-up notices are not.
 */
export function noticeKind(entry: BoardEntry): NoticeKind | null {
  if (/^\s*Event Wish\b/i.test(entry.title)) return 'wish'
  if (entry.typeLabel !== 'Event') return null
  if (/Top-Up|Initial Top/i.test(entry.title)) return null
  return 'event'
}

/**
 * Board events the planner leaves out, as Seelie's Events tab does: game
 * modes and tracks that run all version (Genius Invokation TCG, Stygian
 * Onslaught, the Battle Pass, the dedication rewards).
 */
const NOT_PLANNER =
  /Genius Invokation TCG|Stygian Onslaught|Battle Pass|"Moontrace"|Rewards of Dedication/i

/**
 * Whether a board event belongs in the planner's Events (Seelie's choice):
 * one that ends (permanent quests do not) and is not a game mode or track.
 */
export function plannerNotice(notice: { title: string; end: string | null }): boolean {
  return notice.end !== null && !NOT_PLANNER.test(notice.title)
}

/** The small tag Seelie gives an event. */
export type NoticeTag = 'checkin' | 'exploration' | 'quest'

/** A board event's tag from its English title, null for a plain event. */
export function noticeTag(title: string): NoticeTag | null {
  if (/\bLog In\b|Check-?In/i.test(title)) return 'checkin'
  if (/Exploration/i.test(title)) return 'exploration'
  if (/Archon Quest|Story Quest|World Quest/i.test(title)) return 'quest'
  return null
}

/** A notice's title without the board's long tail: `"Moontrace" Event Details` -> `Moontrace`. */
export function noticeShortTitle(title: string): string {
  const quoted = /^[^"“「『]*["“「『]([^"”」』]{2,80})["”」』]/.exec(title)
  return (quoted ? quoted[1]! : title).trim()
}

// ------------------------------------------------------------- domain events

/** Days every domain stays open after a new version's banners (the user's rule, 2026-10-14). */
export const BANNER_ABUNDANCE_DAYS = 7

/** A version's second banners open at 18:00 server time; its first ones after the update. */
const PHASE_TWO_TIME = 'T18:00'

/**
 * One Overflowing Abundance window per new version: every talent book and
 * weapon material domain open for seven days (to 04:00) from the version's
 * first banners (the owner's observation since 7.1; only the version's
 * start, not its second phase: the user's call, 2026-11-02). The board
 * lists the next version's banners before the running ones end, so a
 * window opens only once those have.
 */
export function bannerAbundance(
  wishes: readonly NoticeWindow[],
  version = '',
): DomainEventWindow[] {
  const starts = [...new Set(wishes.map((w) => w.start))].sort()
  const out: DomainEventWindow[] = []
  for (const start of starts) {
    if (start.endsWith(PHASE_TWO_TIME)) continue
    const running = wishes
      .filter((w) => w.start < start && w.end && w.end > start)
      .map((w) => w.end!)
      .sort()
      .at(-1)
    const from = running ?? start
    const end = addMinutes(`${from.slice(0, 10)}T04:00`, BANNER_ABUNDANCE_DAYS * 24 * 60)
    out.push({
      kind: 'abundance',
      start: from,
      end,
      multiplier: 2,
      dailyClaims: 3,
      version,
      source: 'banner',
    })
  }
  return out
}

const OVERFLOWING: readonly [RegExp, DomainEventKind][] = [
  [/Overflowing Abundance/i, 'abundance'],
  [/Overflowing Mastery/i, 'mastery'],
  [/Overflowing Favor/i, 'favor'],
  [/Overflowing Wealth/i, 'wealth'],
  [/Overflowing Revelation/i, 'revelation'],
  [/Ley Line Overflow/i, 'leyLine'],
]

/**
 * An official HoYoLAB post announcing an Overflowing event (`"Overflowing
 * Abundance" Event: Double Drops …`, `〓Event Duration〓 2026/09/14 04:00 -
 * 2026/09/21 03:59`): its kind and window (server time), or null.
 */
export function overflowingPost(subject: string, content: string): DomainEventWindow | null {
  const kind = OVERFLOWING.find(([pattern]) => pattern.test(subject))?.[1]
  if (!kind || !DOMAIN_EVENT_KINDS.includes(kind)) return null
  const m = new RegExp(`${DATE}${SEP}${DATE}`).exec(noticeText(content))
  if (!m) return null
  const start = local(m[1]!, m[2]!, m[3]!, m[4]!, m[5]!)
  const end = local(m[6]!, m[7]!, m[8]!, m[9]!, m[10]!)
  if (!start || !end || start >= end) return null
  const claims = /up to (\d+) times? (?:a|per) day/i.exec(noticeText(content))
  return {
    kind,
    start,
    end: endExclusive(end),
    multiplier: 2,
    dailyClaims: claims ? Number(claims[1]) : null,
    version: '',
    source: 'hoyolab',
  }
}

/**
 * The domain event windows to serve: the game data's announced runs, staff's,
 * HoYoLAB's posts and the banner rule, a later copy of a run (same kind and
 * start) dropped; a banner-derived Abundance overlapping an announced one
 * (HoYoLAB, game data or staff) gives way to it.
 */
export function mergeDomainWindows(
  announced: readonly DomainEventWindow[],
  derived: readonly DomainEventWindow[],
): DomainEventWindow[] {
  const overlaps = (a: DomainEventWindow, b: DomainEventWindow) =>
    a.kind === b.kind && a.start < b.end && b.start < a.end
  const out: DomainEventWindow[] = []
  const seen = new Set<string>()
  for (const event of [
    ...announced,
    ...derived.filter((d) => !announced.some((a) => overlaps(a, d))),
  ]) {
    const id = `${event.kind}|${event.start}`
    if (seen.has(id)) continue
    seen.add(id)
    out.push(event)
  }
  return out.sort((a, b) => a.start.localeCompare(b.start))
}

// ------------------------------------------------------------- the API

/** One notice as `GET /api/game-events` lists it. */
export interface GameNotice {
  /** `board:<ann_id>`: stable across syncs, a task id is made from it. */
  id: string
  kind: NoticeKind
  start: string
  /** Null: open-ended. */
  end: string | null
  /** English always; the other site languages where the board has them. */
  title: { en: string } & Partial<Record<SiteLanguage, string>>
  /** The notice's banner image (HoYoverse's CDN), when it has one. */
  image: string | null
  /** Seelie's small tag (Check-in, World Exploration, Quest), null for a plain event. */
  tag: NoticeTag | null
}

/** The last game events sync (site_settings `events.sync`), for the staff page. */
export interface EventsSyncStatus {
  /** When it ran (ms). */
  at: number
  ok: boolean
  /** Rows read per source and server: `board:ASIA` -> 17, `hoyolab` -> 7. */
  counts: Record<string, number>
  /** Board events whose dates no rule read: `ASIA:21811 title`. */
  unparsed: string[]
  errors: string[]
  /** A digest of the lists and the HoYoLAB search the last full read saw (appended 2026-11-02). */
  signature?: string
  /** When the notices' contents were last read in full (ms); a sync whose lists match skips them. */
  fullAt?: number
}

/** `GET /api/game-events?server=ASIA`. */
export interface GameEventsResponse {
  server: NoticeServer | null
  /** Domain event windows (merged: game data, staff, HoYoLAB, the banner rule). */
  domain: DomainEventWindow[]
  /** The board's events and wishes running or starting within 14 days, by start. */
  notices: GameNotice[]
  /** When the board was last read (ms), null before the first sync. */
  syncedAt: number | null
}
