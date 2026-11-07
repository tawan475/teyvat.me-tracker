/**
 * Reset rules (checked 2026-10-06):
 * - Daily reset 04:00 server time; servers America UTC−5, Europe UTC+1,
 *   Asia UTC+8 (RPG Site, "Genshin Impact Daily Reset Time").
 * - Weekly reset Mondays 04:00: Trounce Domains, Battle Pass weekly
 *   missions, reputation bounties (same sources).
 * - Spiral Abyss: the 16th of each month, 04:00 server time (HoYoverse
 *   support, "When does the Spiral Abyss reset and what are the rewards?").
 * - Imaginarium Theater: the 1st of each month (Game8, "Imaginarium Theater
 *   Guide"); Paimon's Bargains: the 1st, after the 04:00 reset (Gamepur,
 *   "When does the Starglitter shop reset").
 * - Parametric Transformer: 166 hours after use (TheGamer, "How To Get And
 *   Use The Parametric Transformer").
 */

import type { DomainEventWindow, GameNotice, PlannerTask } from '@gdt/shared'
import { describe, expect, it } from 'vitest'
import {
  bargainsThisMonth,
  BUILTIN_TASKS,
  builtinTask,
  customDone,
  customUndone,
  dayStart,
  dayText,
  doneInput,
  doneUntil,
  formatSpan,
  gameDay,
  lastReset,
  nextReset,
  parseDay,
  parseServerClock,
  resinSpentToday,
  serverClockText,
  serverOffset,
  snoozeChoices,
  snoozedInput,
  taskInput,
  taskRows,
  unclaimedArRewards,
  undoneInput,
  weekdayOf,
  welkinDays,
  type CapturedTasks,
} from '../tasks'

const at = (iso: string) => Date.parse(iso)
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString())
const HOUR = 3_600_000
const task = (id: string) => builtinTask(id)!

describe('server time', () => {
  it('keeps each server on a fixed offset, the day turning at 04:00', () => {
    expect(serverOffset('AMERICA')).toBe(-5)
    expect(serverOffset('EUROPE')).toBe(1)
    expect(serverOffset('ASIA')).toBe(8)
    expect(serverOffset('SAR')).toBe(8)
    expect(serverOffset(null)).toBeNull()
    expect(serverOffset('MOON')).toBeNull()

    // Asia: 04:00 UTC+8 is 20:00 UTC the day before.
    expect(dayText(gameDay(at('2026-10-06T19:59:59Z'), 'ASIA'))).toBe('2026-10-06')
    expect(dayText(gameDay(at('2026-10-06T20:00:00Z'), 'ASIA'))).toBe('2026-10-07')
    expect(iso(dayStart(parseDay('2026-10-07')!, 'ASIA'))).toBe('2026-10-06T20:00:00.000Z')
    // America: 04:00 UTC−5 is 09:00 UTC, the same in January and July (no daylight saving).
    for (const day of ['2026-01-15', '2026-07-15']) {
      expect(iso(dayStart(parseDay(day)!, 'AMERICA'))).toBe(`${day}T09:00:00.000Z`)
      expect(iso(dayStart(parseDay(day)!, 'EUROPE'))).toBe(`${day}T03:00:00.000Z`)
    }
    expect(dayText(gameDay(at('2026-07-15T08:59:00Z'), 'AMERICA'))).toBe('2026-07-14')
    expect(dayText(gameDay(at('2026-07-15T09:00:00Z'), 'AMERICA'))).toBe('2026-07-15')
    // No server: the browser's own zone, whichever the tests run in.
    expect(dayText(gameDay(new Date(2026, 9, 6, 3, 59).getTime(), null))).toBe('2026-10-05')
    expect(dayText(gameDay(new Date(2026, 9, 6, 4, 0).getTime(), null))).toBe('2026-10-06')
    expect(dayStart(parseDay('2026-10-06')!, null)).toBe(new Date(2026, 9, 6, 4).getTime())
  })

  it('reads and writes server clock times as Seelie does', () => {
    expect(serverClockText(at('2026-10-06T20:00:00Z'), 'ASIA')).toBe('2026-10-07 04:00')
    expect(serverClockText(at('2026-10-16T08:59:00Z'), 'AMERICA')).toBe('2026-10-16 03:59')
    expect(serverClockText(at('2026-12-31T23:30:00Z'), 'EUROPE')).toBe('2027-01-01 00:30')
    for (const server of ['AMERICA', 'EUROPE', 'ASIA', 'SAR', null]) {
      // (null: the zone the tests run in)
      const ms = at('2026-10-16T09:00:00Z')
      expect(parseServerClock(serverClockText(ms, server), server)).toBe(ms)
    }
    expect(parseServerClock('2026-10-07', 'ASIA')).toBe(at('2026-10-06T16:00:00Z'))
    expect(parseServerClock('2026-10-07T04:00:00', 'ASIA')).toBe(at('2026-10-06T20:00:00Z'))
    expect(parseServerClock('2026-13-07 04:00', 'ASIA')).toBeNull()
    expect(parseServerClock('soon', 'ASIA')).toBeNull()
    expect(parseDay('2026-02-30')).toBeNull()
    expect(weekdayOf(parseDay('2026-10-06')!)).toBe(2) // a Tuesday
  })
})

describe('built-in resets', () => {
  it('daily: the next 04:00', () => {
    const rule = task('commissions').rule
    expect(iso(nextReset(rule, at('2026-10-06T12:00:00Z'), 'ASIA'))).toBe(
      '2026-10-06T20:00:00.000Z',
    )
    expect(iso(lastReset(rule, at('2026-10-06T12:00:00Z'), 'ASIA'))).toBe(
      '2026-10-05T20:00:00.000Z',
    )
    expect(iso(nextReset(rule, at('2026-10-06T12:00:00Z'), 'AMERICA'))).toBe(
      '2026-10-07T09:00:00.000Z',
    )
  })

  it('weekly: Monday 04:00, a reset moment starting the new week', () => {
    for (const id of ['weekly-bosses', 'battle-pass', 'reputation']) {
      const rule = task(id).rule
      // Tuesday Oct 6 (Asia) → Monday Oct 12 04:00 UTC+8.
      expect(iso(nextReset(rule, at('2026-10-06T12:00:00Z'), 'ASIA'))).toBe(
        '2026-10-11T20:00:00.000Z',
      )
      expect(iso(nextReset(rule, at('2026-10-11T19:59:00Z'), 'ASIA'))).toBe(
        '2026-10-11T20:00:00.000Z',
      )
      expect(iso(nextReset(rule, at('2026-10-11T20:00:00Z'), 'ASIA'))).toBe(
        '2026-10-18T20:00:00.000Z',
      )
      expect(iso(lastReset(rule, at('2026-10-11T20:00:00Z'), 'ASIA'))).toBe(
        '2026-10-11T20:00:00.000Z',
      )
      expect(iso(lastReset(rule, at('2026-10-06T12:00:00Z'), 'EUROPE'))).toBe(
        '2026-10-05T03:00:00.000Z',
      )
    }
  })

  it('the Spiral Abyss on the 16th, the Theater and Paimon on the 1st, across a year', () => {
    const abyss = task('abyss').rule
    expect(iso(nextReset(abyss, at('2026-10-16T08:59:00Z'), 'AMERICA'))).toBe(
      '2026-10-16T09:00:00.000Z',
    )
    expect(iso(nextReset(abyss, at('2026-10-16T09:00:00Z'), 'AMERICA'))).toBe(
      '2026-11-16T09:00:00.000Z',
    )
    expect(iso(lastReset(abyss, at('2026-10-16T08:59:00Z'), 'AMERICA'))).toBe(
      '2026-09-16T09:00:00.000Z',
    )
    expect(iso(nextReset(abyss, at('2026-12-20T00:00:00Z'), 'ASIA'))).toBe(
      '2027-01-15T20:00:00.000Z',
    )
    for (const id of ['theater', 'bargains']) {
      const rule = task(id).rule
      expect(iso(nextReset(rule, at('2026-12-31T12:00:00Z'), 'EUROPE'))).toBe(
        '2027-01-01T03:00:00.000Z',
      )
      // Jan 1 before 04:00 is still December's game day.
      expect(iso(lastReset(rule, at('2027-01-01T02:59:00Z'), 'EUROPE'))).toBe(
        '2026-12-01T03:00:00.000Z',
      )
      expect(iso(lastReset(rule, at('2027-01-01T03:00:00Z'), 'EUROPE'))).toBe(
        '2027-01-01T03:00:00.000Z',
      )
    }
  })

  it('Done rests a task until its reset; the Transformer for 166 hours', () => {
    const now = at('2026-10-06T12:00:00Z')
    expect(iso(doneUntil(task('abyss'), now, 'ASIA'))).toBe('2026-10-15T20:00:00.000Z')
    expect(doneUntil(task('transformer'), now, 'ASIA')).toBe(now + 166 * HOUR)
    expect(nextReset(task('transformer').rule, now, 'ASIA')).toBeNull()
  })

  it('offers snoozes before the reset, with the last day marked', () => {
    const now = at('2026-10-06T12:00:00Z') // Tuesday, Asia
    expect(snoozeChoices(task('commissions'), now, 'ASIA')).toEqual([])
    const weekly = snoozeChoices(task('weekly-bosses'), now, 'ASIA')
    expect(weekly.map((c) => [c.days, c.last])).toEqual([
      [1, false],
      [2, false],
      [3, false],
      [5, true],
    ])
    expect(iso(weekly[0]!.until)).toBe('2026-10-06T20:00:00.000Z')
    // The Abyss resets on the 16th: the last day is the 15th, 9 days out.
    expect(snoozeChoices(task('abyss'), now, 'ASIA').map((c) => [c.days, c.last])).toEqual([
      [1, false],
      [2, false],
      [3, false],
      [5, false],
      [7, false],
      [9, true],
    ])
    // The day before the reset: nothing later to snooze to.
    expect(snoozeChoices(task('abyss'), at('2026-10-15T12:00:00Z'), 'ASIA')).toEqual([])
    expect(snoozeChoices(task('transformer'), now, 'ASIA').map((c) => c.days)).toEqual([
      1, 2, 3, 5, 7,
    ])
  })
})

describe('custom tasks', () => {
  const d = (text: string) => parseDay(text)!

  it('moves on from the start day or from the day it was done', () => {
    const every3 = { every: 3, mode: 'original' as const }
    expect(dayText(customDone(every3, d('2026-10-06'), d('2026-10-06')))).toBe('2026-10-09')
    // Two days late: the rhythm of the start day stays.
    expect(dayText(customDone(every3, d('2026-10-04'), d('2026-10-06')))).toBe('2026-10-07')
    expect(dayText(customDone(every3, d('2026-10-01'), d('2026-10-06')))).toBe('2026-10-07')
    const fromDone = { every: 3, mode: 'completed' as const }
    expect(dayText(customDone(fromDone, d('2026-10-04'), d('2026-10-06')))).toBe('2026-10-09')
    // Not due yet: nothing to do.
    expect(customDone(every3, d('2026-10-08'), d('2026-10-06'))).toBe(d('2026-10-08'))
    expect(dayText(customUndone(every3, d('2026-10-09')))).toBe('2026-10-06')
  })
})

describe('the list and its writes', () => {
  const now = at('2026-10-13T12:00:00Z') // Tuesday Oct 13, Asia
  const stored: PlannerTask[] = [
    { kind: 'builtin', id: 'abyss', next: at('2026-10-15T20:00:00Z'), updatedAt: 1 },
    { kind: 'builtin', id: 'battle-pass', hidden: true, updatedAt: 1 },
    { kind: 'builtin', id: 'weekly-bosses', next: at('2026-10-14T20:00:00Z'), updatedAt: 1 },
    { kind: 'builtin', id: 'reputation', next: at('2026-10-01T00:00:00Z'), updatedAt: 1 },
    {
      kind: 'custom',
      id: 'cust000000b',
      task: { name: 'Teapot', every: 2, mode: 'original' },
      due: '2026-10-11',
      position: 2,
      updatedAt: 1,
    },
    {
      kind: 'custom',
      id: 'cust000000a',
      task: { name: 'Fish', every: 7, mode: 'completed', note: 'Liyue pond' },
      due: '2026-10-14',
      position: 1,
      updatedAt: 1,
    },
    {
      kind: 'custom',
      id: 'cust000000c',
      task: { name: 'Crystals', every: 1, mode: 'original' },
      due: '2026-10-13',
      updatedAt: 1,
    },
  ]
  const rows = taskRows(stored, now, 'ASIA')
  const row = (key: string) => rows.find((r) => r.key === key)!

  it('lists built-ins first (not the hidden ones), then custom ones by position', () => {
    expect(rows.map((r) => r.key)).toEqual([
      'builtin:commissions',
      'builtin:weekly-bosses',
      'builtin:reputation',
      'builtin:abyss',
      'builtin:theater',
      'builtin:bargains',
      'builtin:transformer',
      'custom:cust000000a',
      'custom:cust000000b',
      'custom:cust000000c',
    ])
    expect(BUILTIN_TASKS.map((b) => b.id)).toContain('battle-pass')
  })

  it('says what is due, what rests (done or snoozed) and what is close to its reset', () => {
    // The Abyss resets on the 16th (Oct 15 20:00 UTC): done until then.
    expect(row('builtin:abyss')).toMatchObject({ due: false, tone: 'rest', snoozed: false })
    // Snoozed to Thursday, before Monday's reset.
    expect(row('builtin:weekly-bosses')).toMatchObject({ due: false, snoozed: true })
    expect(iso(row('builtin:weekly-bosses').back)).toBe('2026-10-14T20:00:00.000Z')
    // A Done from an earlier week has run out.
    expect(row('builtin:reputation')).toMatchObject({ due: true, tone: 'due' })
    // Commissions: 8 h to the reset, not yet "soon" (3 h); the Theater has 18 days.
    expect(row('builtin:commissions')).toMatchObject({ due: true, tone: 'due' })
    expect(iso(row('builtin:commissions').resets)).toBe('2026-10-13T20:00:00.000Z')
    const late = taskRows(stored, at('2026-10-13T18:00:00Z'), 'ASIA')
    expect(late.find((r) => r.id === 'commissions')!.tone).toBe('soon')
    expect(row('builtin:transformer')).toMatchObject({ due: true, tone: 'due', resets: null })
    expect(row('custom:cust000000b')).toMatchObject({ due: true, tone: 'soon', late: 2 })
    expect(row('custom:cust000000c')).toMatchObject({ due: true, tone: 'today', late: 0 })
    expect(row('custom:cust000000a')).toMatchObject({ due: false, tone: 'rest', late: -1 })
    // Three days before the Abyss resets it turns red when not done.
    const abyssDue = taskRows([], at('2026-10-13T12:00:00Z'), 'ASIA').find((r) => r.id === 'abyss')
    expect(abyssDue!.tone).toBe('soon')
  })

  it('writes Done, Undo and snoozes as whole tasks', () => {
    expect(taskInput(row('builtin:commissions'))).toEqual({ kind: 'builtin', id: 'commissions' })
    expect(doneInput(row('builtin:commissions'), now, 'ASIA')).toEqual({
      kind: 'builtin',
      id: 'commissions',
      next: at('2026-10-13T20:00:00Z'),
    })
    expect(undoneInput(row('builtin:abyss'))).toEqual({ kind: 'builtin', id: 'abyss' })
    expect(snoozedInput(row('builtin:reputation'), 2, now, 'ASIA')).toEqual({
      kind: 'builtin',
      id: 'reputation',
      next: at('2026-10-14T20:00:00Z'),
    })
    const teapot = row('custom:cust000000b')
    expect(taskInput(teapot)).toEqual({
      kind: 'custom',
      id: 'cust000000b',
      task: { name: 'Teapot', every: 2, mode: 'original' },
      due: '2026-10-11',
      position: 2,
    })
    expect(doneInput(teapot, now, 'ASIA')).toMatchObject({ due: '2026-10-15' })
    expect(undoneInput(teapot)).toMatchObject({ due: '2026-10-09' })
    expect(snoozedInput(teapot, 3, now, 'ASIA')).toMatchObject({ due: '2026-10-16' })
    expect(taskInput(row('custom:cust000000c'))).not.toHaveProperty('position')
  })

  it('says spans briefly', () => {
    expect(formatSpan(45 * 60_000)).toBe('45m')
    expect(formatSpan(5 * HOUR + 12 * 60_000)).toBe('5h 12m')
    expect(formatSpan(3 * 24 * HOUR + 4 * HOUR + 1)).toBe('3d 4h')
    expect(formatSpan(2 * 24 * HOUR)).toBe('2d')
    expect(formatSpan(-5)).toBe('0m')
  })
})

describe('domain events as tasks', () => {
  const abundance: DomainEventWindow = {
    kind: 'abundance',
    start: '2026-10-13T04:00',
    end: '2026-10-20T04:00',
    multiplier: 2,
    dailyClaims: 3,
    version: '7.1',
    source: 'game data',
  }
  const favor: DomainEventWindow = {
    ...abundance,
    kind: 'favor',
    start: '2026-10-26T04:00',
    end: '2026-11-02T04:00',
  }
  // Wednesday 2026-10-14 12:00 in Asia (UTC+8).
  const NOW = Date.UTC(2026, 9, 14, 4)
  const rowsAt = (now: number, stored: PlannerTask[] = []) =>
    taskRows(stored, now, 'ASIA', [abundance, favor]).filter((r) => r.kind === 'event')

  it('lists a running event as a daily task and a soon one resting until it starts', () => {
    const [running, soon] = rowsAt(NOW)
    expect(running).toMatchObject({ id: 'ev-abundance-20261013', due: true, tone: 'due' })
    // Claims come back at the next 04:00 (Thursday 04:00 +08 = Wednesday 20:00 UTC).
    expect(running!.resets).toBe(Date.UTC(2026, 9, 14, 20))
    expect(soon).toMatchObject({ id: 'ev-favor-20261026', due: false, tone: 'rest' })
    expect(soon!.back).toBe(Date.UTC(2026, 9, 25, 20))
  })

  it('Done rests it until the next reset, never past its end; ended events go', () => {
    const [running] = rowsAt(NOW)
    const done = doneInput(running!, NOW, 'ASIA')
    expect(done).toEqual({
      kind: 'builtin',
      id: 'ev-abundance-20261013',
      next: Date.UTC(2026, 9, 14, 20),
    })
    const stored = [{ ...done, updatedAt: NOW } as PlannerTask]
    expect(rowsAt(NOW + 3_600_000, stored)[0]).toMatchObject({ due: false, tone: 'rest' })
    // Its last day: done means done until it ends.
    const lastDay = Date.UTC(2026, 9, 19, 4)
    const last = rowsAt(lastDay)[0]!
    expect(doneInput(last, lastDay, 'ASIA')).toMatchObject({ next: Date.UTC(2026, 9, 19, 20) })
    // After it ends only the upcoming one is left.
    expect(rowsAt(Date.UTC(2026, 9, 19, 20)).map((r) => r.id)).toEqual(['ev-favor-20261026'])
  })

  it('a run starting more than two weeks ahead is not listed yet', () => {
    expect(rowsAt(Date.UTC(2026, 8, 25)).map((r) => r.id)).toEqual([])
  })
})

describe('notice board events as tasks', () => {
  const notice = (over: Partial<GameNotice>): GameNotice => ({
    id: 'board:21168',
    kind: 'event',
    start: '2026-09-30T10:00',
    end: '2026-11-03T04:00',
    title: { en: 'Stygian Onslaught Event: Ley Line challenges', 'zh-CN': '「幽境危战」活动' },
    image: null,
    tag: null,
    ...over,
  })
  const NOW = Date.UTC(2026, 9, 14, 4)
  const rowsAt = (notices: GameNotice[], stored: PlannerTask[] = [], now = NOW) =>
    taskRows(stored, now, 'ASIA', [], notices).filter((r) => r.notice)

  it('lists running events once, upcoming ones resting, never wishes', () => {
    const rows = rowsAt([
      notice({}),
      notice({
        id: 'board:9',
        title: { en: '"Moontrace" Event Details' },
        start: '2026-10-20T10:00',
      }),
      notice({ id: 'board:10', kind: 'wish' }),
      notice({ id: 'board:11', start: '2026-12-01T10:00' }),
    ])
    expect(rows.map((r) => [r.id, r.due, r.name])).toEqual([
      ['nt-21168', true, 'Stygian Onslaught Event: Ley Line challenges'],
      ['nt-9', false, 'Moontrace'],
    ])
    expect(rows[0]!.resets).toBe(Date.UTC(2026, 10, 2, 20))
    expect(rows[1]!.back).toBe(Date.UTC(2026, 9, 20, 2))
  })

  it('Done lasts the run (a year for an open-ended one)', () => {
    const [row] = rowsAt([notice({})])
    expect(doneInput(row!, NOW, 'ASIA')).toEqual({
      kind: 'builtin',
      id: 'nt-21168',
      next: Date.UTC(2026, 10, 2, 20),
    })
    const [open] = rowsAt([notice({ end: null })])
    expect(doneInput(open!, NOW, 'ASIA')).toMatchObject({ next: NOW + 365 * 86_400_000 })
    const stored = [{ ...doneInput(row!, NOW, 'ASIA'), updatedAt: NOW } as PlannerTask]
    expect(rowsAt([notice({})], stored)[0]).toMatchObject({ due: false, tone: 'rest' })
  })
})

describe('ticked from a capture', () => {
  // Asia: the game day of Oct 13 runs from Oct 12 20:00 UTC to Oct 13 20:00 UTC.
  const now = at('2026-10-13T12:00:00Z')
  const capture = (
    tasks: CapturedTasks['tasks'],
    when = '2026-10-13T02:00:00Z',
  ): CapturedTasks => ({
    at: at(when),
    tasks,
  })
  const rowOf = (id: string, c: CapturedTasks | null, stored: PlannerTask[] = [], time = now) =>
    taskRows(stored, time, 'ASIA', [], [], c).find((r) => r.id === id)

  it("ticks the commissions when today's capture has them all, and counts them otherwise", () => {
    const done = rowOf('commissions', capture({ commissions: { finished: 4, total: 4 } }))!
    expect(done).toMatchObject({ due: false, tone: 'rest', snoozed: false })
    expect(iso(done.back)).toBe('2026-10-13T20:00:00.000Z')
    expect(done.capture).toMatchObject({ rules: true, text: '4/4' })
    const two = rowOf('commissions', capture({ commissions: { finished: 2, total: 4 } }))!
    expect(two).toMatchObject({ due: true, capture: { text: '2/4', rules: true } })
    // Yesterday's count says nothing about today.
    const old = capture({ commissions: { finished: 4, total: 4 } }, '2026-10-12T19:00:00Z')
    expect(rowOf('commissions', old)).toMatchObject({ due: true })
    expect(rowOf('commissions', old)!.capture).toBeUndefined()
  })

  it("waits for Katheryne's reward when the capture knows it (Capture 1.16.0)", () => {
    const all = { finished: 4, total: 4 }
    const unclaimed = rowOf('commissions', capture({ commissions: { ...all, claimed: false } }))!
    expect(unclaimed).toMatchObject({ due: true, capture: { text: '4/4', rules: true } })
    const claimed = rowOf('commissions', capture({ commissions: { ...all, claimed: true } }))!
    expect(claimed).toMatchObject({ due: false, tone: 'rest' })
  })

  it('reads a part the live journal set as of its batch, the rest as of the login', () => {
    // The login was yesterday; the journal set today's commissions.
    const login = capture({ commissions: { finished: 3, total: 4 } }, '2026-10-12T19:00:00Z')
    expect(rowOf('commissions', login)!.capture).toBeUndefined()
    const live = { ...login, live: { parts: ['commissions'], at: at('2026-10-13T04:00:00Z') } }
    expect(rowOf('commissions', live)).toMatchObject({ due: true, capture: { text: '3/4' } })
    // A journal that set only the resin leaves yesterday's count yesterday's.
    const resin = { ...login, live: { parts: ['resin'], at: at('2026-10-13T04:00:00Z') } }
    expect(rowOf('commissions', resin)!.capture).toBeUndefined()
  })

  it('reads the resin spent today only on the day it was said (Capture 1.16.0)', () => {
    const said = Math.floor(at('2026-10-13T02:00:00Z') / 1000)
    const tasks = { resinSpent: { value: 160, day: 2, at: said } }
    expect(resinSpentToday(tasks, now, 'ASIA')).toEqual({ value: 160, at: said * 1000 })
    expect(resinSpentToday(tasks, at('2026-10-13T21:00:00Z'), 'ASIA')).toBeNull()
    expect(resinSpentToday({}, now, 'ASIA')).toBeNull()
  })

  it('lets a hand tick or Undo made after the capture win until the next one', () => {
    const c = capture({ commissions: { finished: 4, total: 4 } })
    const undone: PlannerTask = {
      kind: 'builtin',
      id: 'commissions',
      updatedAt: at('2026-10-13T03:00:00Z'),
    }
    expect(rowOf('commissions', c, [undone])).toMatchObject({
      due: true,
      capture: { rules: false },
    })
    // A hand state older than the capture loses to it.
    const before: PlannerTask = { ...undone, updatedAt: at('2026-10-13T01:00:00Z') }
    expect(rowOf('commissions', c, [before])).toMatchObject({
      due: false,
      capture: { rules: true },
    })
    // A Done after a capture that said 2/4.
    const ticked: PlannerTask = {
      kind: 'builtin',
      id: 'commissions',
      next: at('2026-10-13T20:00:00Z'),
      updatedAt: at('2026-10-13T05:00:00Z'),
    }
    const two = capture({ commissions: { finished: 2, total: 4 } })
    expect(rowOf('commissions', two, [ticked])).toMatchObject({ due: false })
  })

  it('ticks the Abyss on full stars inside the captured period only', () => {
    const abyss = { start: 1_789_502_400, end: 1_792_094_399, stars: 36, maxStars: 36 }
    const full = rowOf('abyss', capture({ abyss }))!
    expect(full).toMatchObject({ due: false, capture: { text: '36★' } })
    expect(iso(full.back)).toBe('2026-10-15T20:00:00.000Z')
    expect(rowOf('abyss', capture({ abyss: { ...abyss, stars: 27 } }))).toMatchObject({
      due: true,
      capture: { text: '27★', rules: true },
    })
    // After the period ends the capture is out of date.
    const later = rowOf('abyss', capture({ abyss }), [], at('2026-10-16T01:00:00Z'))!
    expect(later.due).toBe(true)
    expect(later.capture).toBeUndefined()
  })

  it('lists expeditions, the jar and the Welkin Moon only when captured', () => {
    expect(rowOf('expeditions', null)).toBeUndefined()
    expect(rowOf('realm', capture({ commissions: { finished: 0, total: 4 } }))).toBeUndefined()
    const out = (doneAt: string) => ({
      id: 202,
      start: Date.parse(doneAt) / 1000 - 72_000,
      hours: 20,
      doneAt: Date.parse(doneAt) / 1000,
    })
    const away = rowOf(
      'expeditions',
      capture({ expeditions: [out('2026-10-13T15:00:00Z'), out('2026-10-13T16:00:00Z')] }),
    )!
    expect(away).toMatchObject({ due: false, capture: { text: '0/2' } })
    expect(iso(away.back)).toBe('2026-10-13T15:00:00.000Z')
    const back = rowOf(
      'expeditions',
      capture({ expeditions: [out('2026-10-13T11:00:00Z'), out('2026-10-13T16:00:00Z')] }),
    )!
    expect(back).toMatchObject({ due: true, capture: { text: '1/2' } })
    expect(rowOf('expeditions', capture({ expeditions: [] }))).toMatchObject({ due: true })

    expect(rowOf('realm', capture({ realm: { value: 2400, limit: 2400 } }))).toMatchObject({
      due: true,
    })
    expect(rowOf('realm', capture({ realm: { value: 900, limit: 2400 } }))).toMatchObject({
      due: false,
      back: null,
      capture: { text: '900/2400' },
    })
  })

  it('ticks the Parametric Transformer while it recharges and brings it back when ready', () => {
    // Used on Oct 10 at 04:00 UTC: ready 166 h later, Oct 17 at 02:00 UTC.
    const usedAt = at('2026-10-10T04:00:00Z') / 1000
    const transformer = { usedAt, readyAt: usedAt + 597_600 }
    const cooling = rowOf('transformer', capture({ transformer }))!
    expect(cooling).toMatchObject({ due: false, capture: { text: '3d 14h' } })
    expect(iso(cooling.back)).toBe('2026-10-17T02:00:00.000Z')
    const ready = rowOf('transformer', capture({ transformer }), [], at('2026-10-17T03:00:00Z'))!
    expect(ready).toMatchObject({ due: true })
    // Without the part the row is the hand-ticked one it always was.
    expect(rowOf('transformer', capture({}))!.capture).toBeUndefined()
  })

  it('brings the Welkin Moon back three days before it runs out', () => {
    // Captured on Oct 13 with 10 days: 9 on the 14th, 3 on the 20th.
    expect(welkinDays(10, at('2026-10-13T02:00:00Z'), at('2026-10-14T12:00:00Z'), 'ASIA')).toBe(9)
    const plenty = rowOf('welkin', capture({ welkin: { days: 10 } }))!
    expect(plenty.due).toBe(false)
    expect(iso(plenty.back)).toBe('2026-10-19T20:00:00.000Z')
    const soon = rowOf('welkin', capture({ welkin: { days: 10 } }), [], at('2026-10-19T21:00:00Z'))!
    expect(soon).toMatchObject({ due: true })
    expect(rowOf('welkin', capture({ welkin: { days: 2 } }))).toMatchObject({ due: true })
  })

  it("ticks Trounce Domains when this week's discounts are used, and counts them otherwise", () => {
    // Capture 1.14.0+: `left` is the count left, `used` beside it.
    const used = { left: 0, used: 3, limit: 3, cost: 30, fullCost: 60 }
    const done = rowOf('weekly-bosses', capture({ weeklyBosses: used }))!
    expect(done).toMatchObject({ due: false, capture: { text: '3/3' } })
    const one = rowOf('weekly-bosses', capture({ weeklyBosses: { ...used, left: 2, used: 1 } }))!
    expect(one).toMatchObject({ due: true, capture: { text: '1/3' } })
    // Last week's count says nothing about this week (Monday Oct 12, 04:00 Asia).
    const old = capture({ weeklyBosses: used }, '2026-10-11T19:00:00Z')
    expect(rowOf('weekly-bosses', old)!.capture).toBeUndefined()
  })

  it("ticks Paimon's Bargains once something was bought there this month", () => {
    const fates = [
      { item: 'IntertwinedFate', currency: 'MasterlessStardust', cost: 75, bought: 2, limit: 5 },
      { item: 'AcquaintFate', currency: 'MasterlessStardust', cost: 75, bought: 0, limit: 5 },
      { item: 'IntertwinedFate', currency: 'MasterlessStarglitter', cost: 5, bought: 1 },
    ]
    const seen = (bought: boolean, when = '2026-10-13T10:00:00Z') => ({
      bargains: { at: at(when) / 1000, bought, fates },
    })
    const done = rowOf('bargains', capture(seen(true)))!
    expect(done).toMatchObject({ due: false, capture: { text: '2/10' } })
    // Back on the 1st, 04:00 Asia (Oct 31 20:00 UTC).
    expect(iso(done.back)).toBe('2026-10-31T20:00:00.000Z')
    expect(done.capture!.title).toContain('3')
    expect(rowOf('bargains', capture(seen(false)))).toMatchObject({ due: true })
    // Seen last month: it says nothing about this one (Oct 1, 04:00 Asia).
    const old = rowOf('bargains', capture(seen(true, '2026-09-30T19:00:00Z')))!
    expect(old.capture).toBeUndefined()
    expect(
      bargainsThisMonth(seen(true).bargains, at('2026-10-13T12:00:00Z'), 'ASIA')!.fates,
    ).toEqual([
      { ...fates[0], left: 3 },
      { ...fates[1], left: 5 },
      { ...fates[2], limit: null, left: null },
    ])
  })

  it('reads captures before Capture 1.14.0 the other way round: their `left` was the count used', () => {
    const before = { limit: 3, cost: 30, fullCost: 60 }
    const allUsed = rowOf('weekly-bosses', capture({ weeklyBosses: { ...before, left: 3 } }))!
    expect(allUsed).toMatchObject({ due: false, capture: { text: '3/3' } })
    const fresh = rowOf('weekly-bosses', capture({ weeklyBosses: { ...before, left: 0 } }))!
    expect(fresh).toMatchObject({ due: true, capture: { text: '0/3' } })
  })

  it('asks to sign in to running login events not signed in today', () => {
    const calendar = (lastAt: string, claimed = [1]) => ({
      days: 7,
      claimed,
      lastAt: at(lastAt) / 1000,
      start: at('2026-10-01T00:00:00Z') / 1000,
      end: at('2026-10-30T00:00:00Z') / 1000,
    })
    // Asia: the game day of Oct 13 began at Oct 12 20:00 UTC.
    const yesterday = capture({ signIns: { '1': calendar('2026-10-12T10:00:00Z') } })
    expect(rowOf('sign-ins', yesterday)).toMatchObject({ due: true, capture: { text: '1' } })
    const today = capture({ signIns: { '1': calendar('2026-10-13T01:00:00Z') } })
    expect(rowOf('sign-ins', today)).toMatchObject({ due: false })
    const full = capture({
      signIns: { '1': calendar('2026-10-12T10:00:00Z', [1, 2, 3, 4, 5, 6, 7]) },
    })
    expect(rowOf('sign-ins', full)).toMatchObject({ due: false })
    expect(rowOf('sign-ins', capture({}))).toBeUndefined()
  })

  it('lists the AR rewards row while the capture has them, due while one is unclaimed', () => {
    expect(unclaimedArRewards([2, 3, 5], 6)).toEqual([4, 6])
    expect(rowOf('ar-rewards', capture({}))).toBeUndefined()
    const c = (claimed: number[]) => ({ ...capture({ arRewards: claimed }), ar: 4 })
    expect(rowOf('ar-rewards', c([2, 3]))).toMatchObject({ due: true, capture: { text: '1' } })
    expect(rowOf('ar-rewards', c([2, 3, 4]))).toMatchObject({ due: false })
  })
})
