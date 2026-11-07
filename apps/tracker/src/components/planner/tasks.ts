/**
 * Planner tasks, pure: the built-in ones and their resets, the player's own
 * recurring ones (Seelie's custom tasks), and what Done, snooze and Undo do.
 *
 * Server time: each server keeps a fixed UTC offset all year (no daylight
 * saving; America UTC−5, Europe UTC+1, Asia and TW/HK/MO UTC+8, the same
 * table the farm days use) and its game day turns at 04:00. Without a
 * server, the browser's own time zone with the same 04:00 turn. A *game day*
 * is the date of the day that starts at 04:00, `YYYY-MM-DD`; here it is a
 * day number (days since 1970-01-01).
 *
 * Built-in tasks and when they come back (sources in the tests' header):
 * - Daily Commissions: every day at 04:00.
 * - Trounce Domains (weekly bosses), the Battle Pass's weekly missions,
 *   reputation bounties and requests: Mondays at 04:00.
 * - Spiral Abyss: the 16th of each month at 04:00 (monthly since 4.7).
 * - Imaginarium Theater, Paimon's Bargains: the 1st of each month at 04:00.
 * - Parametric Transformer: 166 hours after it was used (a cooldown, not a
 *   reset).
 * From irminsul's captures (`gi_tasks`, the game's state at login): the
 * commissions done today and the Abyss stars tick those two by themselves,
 * and three more rows appear once a capture has them: Expeditions (back
 * when the first one is done), Realm Currency (when the jar is full) and
 * the Welkin Moon (three days before it runs out). Paimon's Bargains ticks
 * once the capture shows anything bought there this month (Capture 1.17.2
 * reads the shop when the player opens it). The capture decides a
 * row while it is newer than the row's hand state: a tick, Undo or snooze
 * after it wins until the next capture.
 * Domain events (Overflowing Abundance & co.) come from the tracker
 * (`GET /api/domain-events`: the game data's announced runs and staff's):
 * while one runs it is a daily task (its multiplied claims come back at
 * 04:00) until it ends; one starting soon is listed resting until it starts,
 * like Seelie's Events tab. Other event schedules (Stygian Onslaught,
 * banners) follow the patch calendar, which has no machine-readable source.
 */

import { RESET_HOUR, SERVER_UTC_OFFSET } from '@gdt/game-data/planner-math'
import { serverLocalTime } from '@gdt/game-data/events'
import {
  noticeShortTitle,
  type CustomTask,
  type DomainEventWindow,
  type GameNotice,
  type GiTasks,
  type PlannerTask,
  type PlannerTaskInput,
} from '@gdt/shared'
import { locale } from '@/i18n/locale'
import { formatTime, keyToName } from '@/lib/format'
import { t } from '@/i18n'

const HOUR = 3_600_000
const DAY = 86_400_000

// ------------------------------------------------------------- server time

/** The server's offset from UTC in hours, null for none (the browser's zone). */
export function serverOffset(server: string | null | undefined): number | null {
  return server && server in SERVER_UTC_OFFSET
    ? SERVER_UTC_OFFSET[server as keyof typeof SERVER_UTC_OFFSET]
    : null
}

/** The game day (a day number) at `now` on a server. */
export function gameDay(now: number, server: string | null | undefined): number {
  const offset = serverOffset(server)
  if (offset !== null) return Math.floor((now + (offset - RESET_HOUR) * HOUR) / DAY)
  const d = new Date(now)
  const day = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY
  return d.getHours() < RESET_HOUR ? day - 1 : day
}

/** When game day `day` starts (its 04:00) on a server. */
export function dayStart(day: number, server: string | null | undefined): number {
  const offset = serverOffset(server)
  if (offset !== null) return day * DAY + (RESET_HOUR - offset) * HOUR
  const d = new Date(day * DAY)
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), RESET_HOUR).getTime()
}

/** `YYYY-MM-DD` of a day number. */
export function dayText(day: number): string {
  return new Date(day * DAY).toISOString().slice(0, 10)
}

/** The day number of `YYYY-MM-DD`, null when it isn't one. */
export function parseDay(text: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!m) return null
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return dayText(ms / DAY) === text ? ms / DAY : null
}

/** 0 = Sunday, as Date#getDay. */
export const weekdayOf = (day: number) => new Date(day * DAY).getUTCDay()

/** The day number of year `y`, month `m` (0-based, may overflow), date `d`. */
const dayOfDate = (y: number, m: number, d: number) => Date.UTC(y, m, d) / DAY

/** `YYYY-MM-DD HH:mm` in server time (Seelie writes its task times so). */
export function serverClockText(ms: number, server: string | null | undefined): string {
  const offset = serverOffset(server)
  const pad = (n: number) => String(n).padStart(2, '0')
  if (offset !== null) {
    const d = new Date(ms + offset * HOUR)
    return `${dayText(Math.floor((ms + offset * HOUR) / DAY))} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  }
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** `YYYY-MM-DD[ HH:mm[:ss]]` in server time as ms, null when it isn't one. */
export function parseServerClock(text: string, server: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(text.trim())
  if (!m) return null
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6]].map((x) => Number(x ?? 0)) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ]
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null
  const offset = serverOffset(server)
  if (offset !== null) return Date.UTC(y, mo - 1, d, h, mi, s) - offset * HOUR
  return new Date(y, mo - 1, d, h, mi, s).getTime()
}

// ------------------------------------------------------------- built-in tasks

export type TaskRule =
  | { kind: 'daily' }
  /** `weekday`: 0 = Sunday, as Date#getDay. */
  | { kind: 'weekly'; weekday: number }
  /** `date`: the day of the month (1–28). */
  | { kind: 'monthly'; date: number }
  | { kind: 'cooldown'; hours: number }

export interface BuiltinTask {
  id: string
  name: string
  rule: TaskRule
  /** A task still to do turns red this long before its reset. */
  soonMs: number
  /** Seelie's key for it (`tasks[].id` in its export), when it has one. */
  seelie?: string
  /** Listed only while the newest capture has this part of `gi_tasks`. */
  capture?: 'expeditions' | 'realm' | 'welkin' | 'arRewards' | 'signIns'
  /** The game's own icon for it, shown before the name. */
  icon: TaskIcon
}

/**
 * A task's game icon: `cdn` art gi-cdn publishes by hand (its publish.json
 * `extra`), `game` an image nanoka hosts. A `glyph` is white on clear (a
 * menu button icon) and is drawn in the text colour instead.
 */
export interface TaskIcon {
  name: string
  from: 'cdn' | 'game'
  glyph?: boolean
}

const MONDAY = 1

/**
 * The built-in tasks, in the order the strip lists them. Ids are never
 * reused. Names are read where they render (they answer in the language on
 * screen).
 */
export const BUILTIN_TASKS: readonly BuiltinTask[] = [
  {
    id: 'commissions',
    icon: { name: 'UI_MarkQuest_Events_Start', from: 'cdn' },
    get name() {
      return t('planner.task.builtin.commissions')
    },
    rule: { kind: 'daily' },
    soonMs: 3 * HOUR,
    seelie: 'dt',
  },
  {
    id: 'weekly-bosses',
    icon: { name: 'UI_MarkTower_Weekly', from: 'cdn' },
    get name() {
      return t('planner.task.builtin.weeklyBosses')
    },
    rule: { kind: 'weekly', weekday: MONDAY },
    soonMs: DAY,
    seelie: 'trounce',
  },
  {
    id: 'battle-pass',
    icon: { name: 'UI_BtnIcon_BattlePass', from: 'cdn', glyph: true },
    get name() {
      return t('planner.task.builtin.battlePass')
    },
    rule: { kind: 'weekly', weekday: MONDAY },
    soonMs: DAY,
  },
  {
    id: 'reputation',
    icon: { name: 'UI_MarkQuest_Reputation_Start', from: 'cdn' },
    get name() {
      return t('planner.task.builtin.reputation')
    },
    rule: { kind: 'weekly', weekday: MONDAY },
    soonMs: DAY,
  },
  {
    id: 'abyss',
    icon: { name: 'UI_MarkTower_Tower', from: 'cdn' },
    get name() {
      return t('planner.task.builtin.abyss')
    },
    rule: { kind: 'monthly', date: 16 },
    soonMs: 3 * DAY,
    seelie: 'abyss',
  },
  {
    id: 'theater',
    icon: { name: 'UI_MarkTower_RoleCombat', from: 'cdn' },
    get name() {
      return t('planner.task.builtin.theater')
    },
    rule: { kind: 'monthly', date: 1 },
    soonMs: 3 * DAY,
    seelie: 'theater',
  },
  {
    id: 'bargains',
    icon: { name: 'UI_Icon_Paimon', from: 'cdn' },
    get name() {
      return t('planner.task.builtin.bargains')
    },
    rule: { kind: 'monthly', date: 1 },
    soonMs: 3 * DAY,
    seelie: 'bargains',
  },
  {
    id: 'transformer',
    icon: { name: 'UI_ItemIcon_220021', from: 'game' },
    get name() {
      return t('planner.task.builtin.transformer')
    },
    rule: { kind: 'cooldown', hours: 166 },
    soonMs: 0,
  },
  {
    id: 'expeditions',
    icon: { name: 'UI_Talent_Expedition_Mengde', from: 'game', glyph: true },
    get name() {
      return t('planner.task.builtin.expeditions')
    },
    rule: { kind: 'cooldown', hours: 20 },
    soonMs: 0,
    capture: 'expeditions',
  },
  {
    id: 'realm',
    icon: { name: 'UI_ItemIcon_204', from: 'game' },
    get name() {
      return t('planner.task.builtin.realm')
    },
    rule: { kind: 'cooldown', hours: 24 },
    soonMs: 0,
    capture: 'realm',
  },
  {
    id: 'welkin',
    icon: { name: 'UI_ItemIcon_1202', from: 'game' },
    get name() {
      return t('planner.task.builtin.welkin')
    },
    rule: { kind: 'cooldown', hours: 7 * 24 },
    soonMs: 0,
    capture: 'welkin',
  },
  {
    id: 'ar-rewards',
    icon: { name: 'UI_BtnIcon_Handbook', from: 'cdn', glyph: true },
    get name() {
      return t('planner.task.builtin.arRewards')
    },
    rule: { kind: 'cooldown', hours: 24 },
    soonMs: 0,
    capture: 'arRewards',
  },
  {
    id: 'sign-ins',
    icon: { name: 'UI_Icon_Activity_SignInTab', from: 'cdn', glyph: true },
    get name() {
      return t('planner.task.builtin.signIns')
    },
    rule: { kind: 'daily' },
    soonMs: 3 * HOUR,
    capture: 'signIns',
  },
]

export const builtinTask = (id: string) => BUILTIN_TASKS.find((t) => t.id === id) ?? null

/** The built-in tasks to list: capture-only ones while the capture has their part. */
export function listedBuiltins(capture: CapturedTasks | null | undefined): BuiltinTask[] {
  return BUILTIN_TASKS.filter((b) => !b.capture || capture?.tasks[b.capture] !== undefined)
}

/** The first reset of a periodic rule after `now` (null for a cooldown). */
export function nextReset(rule: TaskRule, now: number, server: string | null | undefined) {
  const today = gameDay(now, server)
  if (rule.kind === 'daily') return dayStart(today + 1, server)
  if (rule.kind === 'weekly') {
    const since = (weekdayOf(today) - rule.weekday + 7) % 7
    return dayStart(today - since + 7, server)
  }
  if (rule.kind === 'monthly') {
    const d = new Date(today * DAY)
    const y = d.getUTCFullYear()
    const m = d.getUTCMonth()
    const day =
      d.getUTCDate() >= rule.date ? dayOfDate(y, m + 1, rule.date) : dayOfDate(y, m, rule.date)
    return dayStart(day, server)
  }
  return null
}

/** The last reset of a periodic rule at or before `now` (null for a cooldown). */
export function lastReset(rule: TaskRule, now: number, server: string | null | undefined) {
  const today = gameDay(now, server)
  if (rule.kind === 'daily') return dayStart(today, server)
  if (rule.kind === 'weekly') {
    return dayStart(today - ((weekdayOf(today) - rule.weekday + 7) % 7), server)
  }
  if (rule.kind === 'monthly') {
    const d = new Date(today * DAY)
    const y = d.getUTCFullYear()
    const m = d.getUTCMonth()
    const day =
      d.getUTCDate() >= rule.date ? dayOfDate(y, m, rule.date) : dayOfDate(y, m - 1, rule.date)
    return dayStart(day, server)
  }
  return null
}

/** What a Done sets `next` to: the next reset, or the end of the cooldown. */
export function doneUntil(task: BuiltinTask, now: number, server: string | null | undefined) {
  const rule = task.rule
  return rule.kind === 'cooldown' ? now + rule.hours * HOUR : nextReset(rule, now, server)!
}

export interface SnoozeChoice {
  /** Days from today (the day it comes back is today + days). */
  days: number
  /** When it comes back (that day's 04:00). */
  until: number
  /** The last day before the reset. */
  last: boolean
}

/**
 * The snoozes a built-in task offers: back on a later day, before its reset
 * (a snooze past the reset would skip a period). Cooldowns snooze 1–7 days;
 * a daily task has nothing to snooze to.
 */
export function snoozeChoices(
  task: BuiltinTask,
  now: number,
  server: string | null | undefined,
): SnoozeChoice[] {
  const today = gameDay(now, server)
  const reset = nextReset(task.rule, now, server)
  const lastDay = reset === null ? today + 7 : gameDay(reset, server) - 1
  const days = new Set([1, 2, 3, 5, 7].filter((d) => today + d <= lastDay))
  if (reset !== null && lastDay > today) days.add(lastDay - today)
  return [...days]
    .sort((a, b) => a - b)
    .map((d) => ({
      days: d,
      until: dayStart(today + d, server),
      last: reset !== null && today + d === lastDay,
    }))
}

/** Back on game day today + `days` (its 04:00). */
export function snoozeUntil(days: number, now: number, server: string | null | undefined) {
  return dayStart(gameDay(now, server) + days, server)
}

// ------------------------------------------------------------- custom tasks

/** A Done on a custom task due `due` (a day number) on `today`: the day it is due next. */
export function customDone(task: Pick<CustomTask, 'every' | 'mode'>, due: number, today: number) {
  if (today < due) return due
  if (task.mode === 'completed') return today + task.every
  return due + (Math.floor((today - due) / task.every) + 1) * task.every
}

/** Taking a Done back (Seelie's toggle): one period earlier. */
export const customUndone = (task: Pick<CustomTask, 'every'>, due: number) => due - task.every

// ------------------------------------------------------------- captures

/** The newest capture's `gi_tasks`, taken at `at` (ms). */
export interface CapturedTasks {
  at: number
  tasks: GiTasks
  /** Parts the live journal set since (Capture 1.16.0), with when its last batch came (ms). */
  live?: { parts: readonly string[]; at: number }
  /** The capture's Adventure Rank (`gi_player.ar`), for the AR rewards row. */
  ar?: number
}

/** Adventure Ranks at or below `ar` (2-60) whose reward the capture does not list as claimed. */
export function unclaimedArRewards(claimed: readonly number[], ar: number): number[] {
  const held = new Set(claimed)
  const out: number[] = []
  for (let rank = 2; rank <= Math.min(ar, 60); rank++) if (!held.has(rank)) out.push(rank)
  return out
}

/** The `gi_tasks` part each capture-read row is read from. */
const TASK_PARTS: Record<string, keyof GiTasks> = {
  commissions: 'commissions',
  abyss: 'abyss',
  expeditions: 'expeditions',
  realm: 'realm',
  'weekly-bosses': 'weeklyBosses',
  'sign-ins': 'signIns',
  'ar-rewards': 'arRewards',
  welkin: 'welkin',
  transformer: 'transformer',
}

/**
 * Original Resin spent today per the capture (`gi_tasks.resinSpent`,
 * Capture 1.16.0) and when the game said so (ms), or null when it says
 * nothing about today.
 */
export function resinSpentToday(
  tasks: GiTasks | null | undefined,
  now: number,
  server: string | null | undefined,
): { value: number; at: number } | null {
  const spent = tasks?.resinSpent
  if (!spent || spent.at * 1000 < lastReset({ kind: 'daily' }, now, server)!) return null
  return { value: spent.value, at: spent.at * 1000 }
}

/** What a capture says about a built-in task now. */
export interface CaptureRead {
  /** When the capture was taken (ms). */
  at: number
  /** Done for now (per the capture). */
  done: boolean
  /** Resting until (ms), when the capture knows; null: due, or unknown. */
  back: number | null
  /** The figure shown by the name: "2/4", "30★", "3/5", "1800/2400", "12d". */
  text: string
  /** The figure in words, for the tooltip. */
  title: string
}

/** Welkin days left today: the capture's count, one fewer each game day since. */
export function welkinDays(
  days: number,
  capturedAt: number,
  now: number,
  server: string | null | undefined,
) {
  return days - Math.max(0, gameDay(now, server) - gameDay(capturedAt, server))
}

/** Paimon's Bargains' stock comes back with the month. */
const BARGAINS_MONTH = { kind: 'monthly', date: 1 } as const satisfies TaskRule

/** One Fate in Paimon's Bargains this month; `limit`/`left` null when it has no limit. */
export interface BargainFate {
  item: string
  currency: string
  cost: number
  bought: number
  limit: number | null
  left: number | null
}

/** Paimon's Bargains this month, per the capture (times in ms). */
export interface BargainsMonth {
  /** When the game last showed the shop. */
  seenAt: number
  /** Anything at all bought there this month. */
  bought: boolean
  fates: BargainFate[]
  resetsAt: number
}

/**
 * Paimon's Bargains this month from the capture's `gi_tasks.bargains`, or
 * null when the shop was last seen before this month's reset (its counts
 * are another month's) or never.
 */
export function bargainsThisMonth(
  bargains: GiTasks['bargains'],
  now: number,
  server: string | null | undefined,
): BargainsMonth | null {
  if (!bargains) return null
  const seenAt = bargains.at * 1000
  if (seenAt < lastReset(BARGAINS_MONTH, now, server)!) return null
  return {
    seenAt,
    bought: bargains.bought,
    resetsAt: nextReset(BARGAINS_MONTH, now, server)!,
    fates: bargains.fates.map((f) => ({
      item: f.item,
      currency: f.currency,
      cost: f.cost,
      bought: f.bought,
      limit: f.limit ?? null,
      left: f.limit === undefined ? null : Math.max(0, f.limit - f.bought),
    })),
  }
}

/** Welkin Moon rows come due this many days before it runs out. */
export const WELKIN_SOON_DAYS = 3

/**
 * What the capture says about built-in task `id` at `now`, or null when it
 * says nothing about the period running (a commission count from another
 * day, an Abyss period that ended, a part it lacks).
 */
export function captureRead(
  id: string,
  capture: CapturedTasks | null | undefined,
  now: number,
  server: string | null | undefined,
): CaptureRead | null {
  if (!capture) return null
  const { tasks } = capture
  // A part the live journal set is as of its last batch, the rest as of the login.
  const part = TASK_PARTS[id]
  const at = part && capture.live?.parts.includes(part) ? capture.live.at : capture.at
  switch (id) {
    case 'commissions': {
      const c = tasks.commissions
      if (!c || at < lastReset({ kind: 'daily' }, now, server)!) return null
      // Katheryne's reward taken, when the capture knows (Capture 1.16.0).
      const unclaimed = c.finished >= c.total && c.claimed === false
      const done = c.finished >= c.total && !unclaimed
      return {
        at,
        done,
        back: done ? nextReset({ kind: 'daily' }, now, server) : null,
        text: `${c.finished}/${c.total}`,
        title: t(
          unclaimed
            ? 'planner.tasks.capture.commissionsUnclaimed'
            : 'planner.tasks.capture.commissions',
          { n: c.finished, total: c.total },
        ),
      }
    }
    case 'abyss': {
      const a = tasks.abyss
      if (!a || now >= (a.end + 1) * 1000 || at < a.start * 1000) return null
      const done = a.stars >= a.maxStars
      return {
        at,
        done,
        back: done ? (a.end + 1) * 1000 : null,
        text: `${a.stars}★`,
        title: t('planner.tasks.capture.abyss', { stars: a.stars, max: a.maxStars }),
      }
    }
    case 'expeditions': {
      const out = tasks.expeditions
      if (!out) return null
      if (out.length === 0) {
        return {
          at,
          done: false,
          back: null,
          text: '0',
          title: t('planner.tasks.capture.nobodyOut'),
        }
      }
      const times = out.map((e) => e.doneAt * 1000)
      const first = Math.min(...times)
      const back = times.filter((time) => time <= now).length
      const who = out
        .map(
          (e) => `${e.character ? `${keyToName(e.character)} ` : ''}${formatTime(e.doneAt * 1000)}`,
        )
        .join(' · ')
      return {
        at,
        done: first > now,
        back: first > now ? first : null,
        text: `${back}/${out.length}`,
        title: `${t('planner.tasks.capture.expeditions', { n: back, total: out.length })} · ${who}`,
      }
    }
    case 'realm': {
      const r = tasks.realm
      if (!r) return null
      return {
        at,
        done: r.value < r.limit,
        back: null,
        text: `${r.value}/${r.limit}`,
        title: t('planner.tasks.capture.realm', { value: r.value, limit: r.limit }),
      }
    }
    case 'weekly-bosses': {
      const b = tasks.weeklyBosses
      const week = { kind: 'weekly', weekday: MONDAY } as const
      if (!b || at < lastReset(week, now, server)!) return null
      // Captures before Capture 1.14.0 (no `used`) sent the discounts used as `left`.
      const left = b.used === undefined ? b.limit - b.left : b.left
      const used = b.limit - left
      const done = left === 0
      return {
        at,
        done,
        back: done ? nextReset(week, now, server) : null,
        text: `${used}/${b.limit}`,
        title: t('planner.tasks.capture.weeklyBosses', { n: used, total: b.limit }),
      }
    }
    case 'sign-ins': {
      // Login events running now that still have days to claim: due until signed in today.
      const today = lastReset({ kind: 'daily' }, now, server)!
      const open = Object.values(tasks.signIns ?? {}).filter(
        (c) => c.start * 1000 <= now && now < c.end * 1000 && c.claimed.length < c.days,
      )
      if (!tasks.signIns) return null
      const left = open.filter((c) => c.lastAt * 1000 < today).length
      return {
        at,
        done: left === 0,
        back: left === 0 ? nextReset({ kind: 'daily' }, now, server) : null,
        text: String(left),
        title:
          left === 0
            ? t('planner.tasks.capture.signInsNone')
            : t('planner.tasks.capture.signIns', { n: left }),
      }
    }
    case 'ar-rewards': {
      const claimed = tasks.arRewards
      if (!claimed || capture.ar === undefined) return null
      const open = unclaimedArRewards(claimed, capture.ar)
      return {
        at,
        done: open.length === 0,
        back: null,
        text: String(open.length),
        title:
          open.length === 0
            ? t('planner.tasks.capture.arRewardsNone')
            : t('planner.tasks.capture.arRewards', { ranks: open.join(', ') }),
      }
    }
    case 'bargains': {
      // When the shop was seen decides, not when the capture was sent.
      const month = bargainsThisMonth(tasks.bargains, now, server)
      if (!month) return null
      const limited = month.fates.filter((f) => f.limit !== null)
      const bought = limited.reduce((n, f) => n + f.bought, 0)
      const limit = limited.reduce((n, f) => n + f.limit!, 0)
      const left = limited
        .map((f) =>
          t('planner.tasks.capture.fateLeft', {
            name: keyToName(f.item),
            currency: keyToName(f.currency),
            n: f.left!,
          }),
        )
        .join(' · ')
      const said = t(
        month.bought ? 'planner.tasks.capture.bargains' : 'planner.tasks.capture.bargainsNone',
      )
      return {
        at: month.seenAt,
        done: month.bought,
        back: month.bought ? month.resetsAt : null,
        text: limit > 0 ? `${bought}/${limit}` : '',
        title: left ? `${said} · ${left}` : said,
      }
    }
    case 'transformer': {
      // Capture 1.17.23: the game's own recharge, so the row needs no tick.
      const x = tasks.transformer
      if (!x) return null
      const ready = x.readyAt * 1000
      const left = ready - now
      if (left <= 0) {
        return {
          at,
          done: false,
          back: null,
          text: '',
          title: t('planner.tasks.capture.transformerReady', { time: formatTime(ready) }),
        }
      }
      const days = Math.floor(left / 86_400_000)
      const hours = Math.floor((left % 86_400_000) / 3_600_000)
      const minutes = Math.floor((left % 3_600_000) / 60_000)
      return {
        at,
        done: true,
        back: ready,
        text:
          days > 0
            ? t('farm.time.dh', { d: days, h: hours })
            : t('farm.time.hm', { h: hours, m: minutes }),
        title: t('planner.tasks.capture.transformer', { time: formatTime(ready) }),
      }
    }
    case 'welkin': {
      const w = tasks.welkin
      if (!w) return null
      const left = welkinDays(w.days, at, now, server)
      const soon = left <= WELKIN_SOON_DAYS
      return {
        at,
        done: !soon,
        back: soon ? null : dayStart(gameDay(at, server) + w.days - WELKIN_SOON_DAYS, server),
        text: t('farm.time.d', { d: Math.max(0, left) }),
        title: t('planner.tasks.capture.welkin', { n: Math.max(0, left) }),
      }
    }
  }
  return null
}

// ------------------------------------------------------------- the list

export type TaskTone = 'soon' | 'today' | 'due' | 'rest'

export interface TaskRow {
  /** `builtin:<id>` / `custom:<id>` / `event:<id>` */
  key: string
  kind: 'builtin' | 'custom' | 'event'
  id: string
  name: string
  note?: string
  /** To do now. */
  due: boolean
  /**
   * Due and close to its reset (built-in), or past its day (custom): red.
   * `today`: a custom task due today. `rest`: done or snoozed.
   */
  tone: TaskTone
  /** Built-in, due: its reset (null for a cooldown). */
  resets: number | null
  /** Resting: when it is back (ms; a custom task's day start). */
  back: number | null
  /** Resting before its reset (not Done): a snooze. */
  snoozed: boolean
  /** Custom: days past due (0 today), negative while resting. */
  late: number
  builtin: BuiltinTask | null
  custom: { task: CustomTask; due: number; position: number } | null
  /** A domain event: its window, and when it starts/ends on the server (ms). */
  event: { window: DomainEventWindow; start: number; end: number } | null
  /** Seelie's small tag before the name: `daily` (a domain event), `checkin`, `exploration`, `quest`. */
  tag?: 'daily' | 'checkin' | 'exploration' | 'quest'
  /** A notice board event: done once per run; `end` null = open-ended. */
  notice: { notice: GameNotice; start: number; end: number | null } | null
  /** What is stored for it (a built-in task never touched has nothing). */
  stored: PlannerTask | null
  /**
   * What the newest capture says about it; `rules`: the capture is newer
   * than the hand state, so it decides whether the row is done.
   */
  capture?: CaptureRead & { rules: boolean }
}

/** Events starting within this long are listed (resting) before they start. */
export const EVENT_LEAD_MS = 14 * DAY

/**
 * A domain event window's task id: stored like a built-in task's (no other
 * storage), unique per run: `ev-abundance-20261013`.
 */
export const eventTaskId = (window: Pick<DomainEventWindow, 'kind' | 'start'>) =>
  `ev-${window.kind.toLowerCase()}-${window.start.slice(0, 10).replace(/-/g, '')}`

/** A notice board event's task id, stored like a built-in's: `nt-21168`. */
export const noticeTaskId = (notice: Pick<GameNotice, 'id'>) =>
  `nt-${notice.id.replace(/^board:/, '')}`

/** A notice's title in the language on screen, shortened to its quoted name. */
export function noticeName(notice: GameNotice): { name: string; full: string } {
  const full = notice.title[locale.value] || notice.title.en || notice.id
  return { name: noticeShortTitle(full), full }
}

/** Open-ended events stay done this long. */
const OPEN_DONE_MS = 365 * DAY

/**
 * The tasks to list: running and soon domain events first, built-in ones
 * (minus the hidden), then custom ones by position. `stored` is what the
 * server has (and what waits).
 */
export function taskRows(
  stored: readonly PlannerTask[],
  now: number,
  server: string | null | undefined,
  events: readonly DomainEventWindow[] = [],
  notices: readonly GameNotice[] = [],
  capture: CapturedTasks | null = null,
): TaskRow[] {
  const byId = new Map(stored.map((t) => [`${t.kind}:${t.id}`, t]))
  const rows: TaskRow[] = []
  const seen = new Set<string>()
  for (const window of events) {
    const id = eventTaskId(window)
    const start = serverLocalTime(window.start, server)
    const end = serverLocalTime(window.end, server)
    if (seen.has(id) || !(end > now) || !(start - now <= EVENT_LEAD_MS)) continue
    seen.add(id)
    const s = byId.get(`builtin:${id}`)
    if (s?.kind === 'builtin' && s.hidden) continue
    const upcoming = start > now
    const next = s?.kind === 'builtin' ? (s.next ?? null) : null
    const resting = upcoming || (next !== null && next > now)
    const resets = Math.min(nextReset({ kind: 'daily' }, now, server) ?? end, end)
    const due = !resting
    rows.push({
      key: `event:${id}`,
      kind: 'event',
      id,
      name: t(`farm.event.names.${window.kind}`),
      note: t(`farm.event.rules.${window.kind}`),
      due,
      tone: !due ? 'rest' : resets - now <= 3 * HOUR ? 'soon' : 'due',
      resets: due ? resets : null,
      back: upcoming ? start : resting ? next : null,
      snoozed: false,
      late: 0,
      builtin: null,
      custom: null,
      event: { window, start, end },
      notice: null,
      tag: 'daily',
      stored: s ?? null,
    })
  }
  // The notice board's events (wishes have their own page): done once per run.
  for (const notice of notices) {
    if (notice.kind !== 'event') continue
    const id = noticeTaskId(notice)
    const start = serverLocalTime(notice.start, server)
    const end = notice.end === null ? null : serverLocalTime(notice.end, server)
    if (seen.has(id) || (end !== null && !(end > now)) || !(start - now <= EVENT_LEAD_MS)) continue
    seen.add(id)
    const s = byId.get(`builtin:${id}`)
    if (s?.kind === 'builtin' && s.hidden) continue
    const upcoming = start > now
    const next = s?.kind === 'builtin' ? (s.next ?? null) : null
    const resting = upcoming || (next !== null && next > now)
    const due = !resting
    const { name, full } = noticeName(notice)
    rows.push({
      key: `event:${id}`,
      kind: 'event',
      id,
      name,
      note: full !== name ? full : undefined,
      due,
      tone: !due ? 'rest' : end !== null && end - now <= DAY ? 'soon' : 'due',
      resets: due ? end : null,
      back: upcoming ? start : resting ? next : null,
      snoozed: false,
      late: 0,
      builtin: null,
      custom: null,
      event: null,
      notice: { notice, start, end },
      tag: notice.tag ?? undefined,
      stored: s ?? null,
    })
  }
  for (const b of listedBuiltins(capture)) {
    const s = byId.get(`builtin:${b.id}`)
    if (s?.kind === 'builtin' && s.hidden) continue
    const resets = nextReset(b.rule, now, server)
    const read = captureRead(b.id, capture, now, server)
    // The capture decides while it is newer than what was done by hand.
    const rules = read !== null && (!s || s.updatedAt < read.at)
    let row: Pick<TaskRow, 'due' | 'back' | 'snoozed'>
    if (rules) {
      row = { due: !read.done, back: read.done ? read.back : null, snoozed: false }
    } else {
      const next = s?.kind === 'builtin' ? (s.next ?? null) : null
      const resting = next !== null && next > now
      row = {
        due: !resting,
        back: resting ? next : null,
        snoozed: resting && resets !== null && next < resets,
      }
    }
    rows.push({
      key: `builtin:${b.id}`,
      kind: 'builtin',
      id: b.id,
      name: b.name,
      ...row,
      tone: !row.due ? 'rest' : resets !== null && resets - now <= b.soonMs ? 'soon' : 'due',
      resets: row.due ? resets : null,
      late: 0,
      builtin: b,
      custom: null,
      event: null,
      notice: null,
      stored: s ?? null,
      ...(read ? { capture: { ...read, rules } } : {}),
    })
  }
  const today = gameDay(now, server)
  const customs = stored
    .flatMap((t, i) => (t.kind === 'custom' ? [{ t, i }] : []))
    .sort((a, b) => (a.t.position ?? a.i) - (b.t.position ?? b.i) || a.i - b.i)
  for (const { t, i } of customs) {
    const due = parseDay(t.due) ?? today
    const late = today - due
    rows.push({
      key: `custom:${t.id}`,
      kind: 'custom',
      id: t.id,
      name: t.task.name,
      note: t.task.note,
      due: late >= 0,
      tone: late > 0 ? 'soon' : late === 0 ? 'today' : 'rest',
      resets: null,
      back: late < 0 ? dayStart(due, server) : null,
      snoozed: false,
      late,
      builtin: null,
      custom: { task: t.task, due, position: t.position ?? i },
      event: null,
      notice: null,
      stored: t,
    })
  }
  return rows
}

// ------------------------------------------------------------- writes

/** A row's task as it is stored (the write that puts it back). */
export function taskInput(row: TaskRow): PlannerTaskInput {
  if (row.kind === 'builtin' || row.kind === 'event') {
    const s = row.stored?.kind === 'builtin' ? row.stored : null
    return {
      kind: 'builtin',
      id: row.id,
      ...(s?.next !== undefined && s.next !== null ? { next: s.next } : {}),
      ...(s?.hidden ? { hidden: true } : {}),
    }
  }
  const c = row.custom!
  const s = row.stored?.kind === 'custom' ? row.stored : null
  return {
    kind: 'custom',
    id: row.id,
    task: c.task,
    due: dayText(c.due),
    ...(s?.position !== undefined ? { position: s.position } : {}),
  }
}

/** Done: a built-in task rests until its reset (or its cooldown ends), a custom one moves on. */
export function doneInput(
  row: TaskRow,
  now: number,
  server: string | null | undefined,
): PlannerTaskInput {
  const input = taskInput(row)
  if (input.kind === 'builtin') {
    // An event's claims come back at the next 04:00, or never once it ends.
    if (row.event) {
      const reset = nextReset({ kind: 'daily' }, now, server) ?? row.event.end
      return { ...input, next: Math.min(reset, row.event.end) }
    }
    // A notice's event: done for this run.
    if (row.notice) return { ...input, next: row.notice.end ?? now + OPEN_DONE_MS }
    return { ...input, next: doneUntil(row.builtin!, now, server) }
  }
  return {
    ...input,
    due: dayText(customDone(row.custom!.task, row.custom!.due, gameDay(now, server))),
  }
}

/** Taking a Done (or a snooze) back: a built-in task is due again, a custom one a period earlier. */
export function undoneInput(row: TaskRow): PlannerTaskInput {
  const input = taskInput(row)
  if (input.kind === 'builtin') {
    const { next: _, ...rest } = input
    return rest
  }
  return { ...input, due: dayText(customUndone(row.custom!.task, row.custom!.due)) }
}

/** Snoozed: back on game day today + `days`. */
export function snoozedInput(
  row: TaskRow,
  days: number,
  now: number,
  server: string | null | undefined,
): PlannerTaskInput {
  const input = taskInput(row)
  if (input.kind === 'builtin') return { ...input, next: snoozeUntil(days, now, server) }
  return { ...input, due: dayText(gameDay(now, server) + days) }
}

/** Snoozes a custom task offers (days from today). */
export const CUSTOM_SNOOZES = [1, 2, 3, 5, 7] as const

/** "45m", "5h 12m", "3d 4h" (rounded up to the minute). */
export function formatSpan(ms: number): string {
  const minutes = Math.max(0, Math.ceil(ms / 60_000))
  const d = Math.floor(minutes / 1440)
  const h = Math.floor((minutes % 1440) / 60)
  const m = minutes % 60
  if (d > 0) return h > 0 ? t('farm.time.dh', { d, h }) : t('farm.time.d', { d })
  return h > 0 ? t('farm.time.hm', { h, m }) : t('farm.time.m', { m })
}
