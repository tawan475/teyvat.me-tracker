import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  RESIN_STEP_MS,
  clockReading,
  liveReading,
  capturedResin,
  alertAt,
  fullAt,
  manualReplaced,
  nextMark,
  parseAmount,
  addMark,
  addStep,
  reachedAt,
  resinAt,
  resinMarks,
  resinReading,
  setResin,
  stepResin,
} from '../resin'
import {
  alertSupport,
  cancelResinAlerts,
  scheduleResinAlert,
  scheduledAlert,
  setAlertShow,
} from '../resin-alerts'

const T = Date.parse('2026-10-06T10:00:00Z')
const MIN = 60_000

describe('resin spent in game (live sync)', () => {
  it("counts from the journal's value on the login clock's grid, never ahead of the game", () => {
    // Login: 160 with the next point at T + 3 min; resin spent to 20, last batch at T + 61 min.
    const clock = { value: 160, nextAt: (T + 3 * MIN) / 1000 }
    const reading = liveReading(20, T + 61 * MIN, clock)
    // The clock's ticks fall at T - 5 + 8k min: the last one by T + 61 is T + 59.
    expect(reading).toEqual({ value: 20, at: T + 59 * MIN })
    expect(resinAt(reading, T + 66 * MIN)).toBe(20)
    expect(resinAt(reading, T + 67 * MIN)).toBe(21)
    // Hours later: still regenerating from 20, not full from the login's 160.
    expect(resinAt(reading, T + 4 * 60 * MIN)).toBe(20 + Math.floor((4 * 60 - 59) / 8))
    // Without a clock: dated at the batch.
    expect(liveReading(20, T, null)).toEqual({ value: 20, at: T })
  })

  it("prefers a later snapshot's count over the login's clock when they differ", () => {
    const clock = { value: 160, nextAt: (T + 3 * MIN) / 1000 }
    expect(capturedResin(clock, { value: 160, at: T })).toEqual(clockReading(clock))
    expect(capturedResin(clock, { value: 40, at: T + 61 * MIN })).toEqual({
      value: 40,
      at: T + 59 * MIN,
    })
    expect(capturedResin(null, { value: 40, at: T })).toEqual({ value: 40, at: T })
    expect(capturedResin(clock, null)).toEqual(clockReading(clock))
  })
})

describe('resin readings', () => {
  const login = { known: true, atSnapshot: 100, at: T, source: 'player' as const }

  it('counts from a hand-set value until a capture reads resin after it', () => {
    expect(resinReading(login, null)).toEqual({ value: 100, at: T, source: 'player' })
    expect(resinReading(login, { value: 60, at: T + 30 * MIN })).toEqual({
      value: 60,
      at: T + 30 * MIN,
      source: 'manual',
    })
    // A capture read later (a new login) replaces it; one read at the same moment too.
    expect(resinReading({ ...login, at: T + 60 * MIN }, { value: 60, at: T + 30 * MIN })).toEqual({
      value: 100,
      at: T + 60 * MIN,
      source: 'player',
    })
    expect(manualReplaced({ ...login, at: T + 60 * MIN }, { value: 60, at: T + 30 * MIN })).toBe(
      true,
    )
    expect(manualReplaced(login, { value: 60, at: T + 30 * MIN })).toBe(false)
    // No capture, or one without a count: the hand-set value, else nothing.
    expect(resinReading(null, { value: 5, at: T })).toMatchObject({ source: 'manual' })
    expect(resinReading({ ...login, known: false }, null)).toBeNull()
    expect(resinReading(null, null)).toBeNull()
  })

  it('regenerates one per 8 minutes up to 200; refills above stay', () => {
    const r = { value: 100, at: T }
    expect(resinAt(r, T - MIN)).toBe(100)
    expect(resinAt(r, T + 8 * MIN - 1)).toBe(100)
    expect(resinAt(r, T + 8 * MIN)).toBe(101)
    expect(resinAt(r, T + 100 * 8 * MIN)).toBe(200)
    expect(resinAt(r, T + 900 * 8 * MIN)).toBe(200)
    expect(resinAt({ value: 260, at: T }, T + 99 * 8 * MIN)).toBe(260)
  })

  it('says when it is full and when the next 40 is there', () => {
    const r = { value: 95, at: T }
    expect(fullAt(r, T)).toBe(T + 105 * RESIN_STEP_MS)
    expect(fullAt(r, T + 105 * RESIN_STEP_MS)).toBeNull()
    expect(fullAt({ value: 200, at: T }, T)).toBeNull()
    expect(nextMark(r, T)).toEqual({ amount: 120, at: T + 25 * RESIN_STEP_MS })
    expect(nextMark({ value: 10, at: T }, T)).toEqual({ amount: 40, at: T + 30 * RESIN_STEP_MS })
    expect(nextMark({ value: 190, at: T }, T)).toEqual({ amount: 200, at: T + 10 * RESIN_STEP_MS })
    expect(nextMark({ value: 200, at: T }, T)).toBeNull()
    expect(reachedAt(r, 90)).toBe(T)
    expect(reachedAt(r, 201)).toBeNull()
  })

  it('lists every mark with when resin is there, reached ones flagged', () => {
    const marks = resinMarks(
      { value: 95, at: T },
      T + 2 * RESIN_STEP_MS,
      [40, 60, 80, 100, 120, 160, 180, 200],
    )
    expect(marks.map((m) => m.amount)).toEqual([40, 60, 80, 100, 120, 160, 180, 200])
    expect(marks.map((m) => m.reached)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
    ])
    expect(marks[0]!.at).toBe(T)
    expect(marks[3]!.at).toBe(T + 5 * RESIN_STEP_MS)
    expect(marks[7]!.at).toBe(T + 105 * RESIN_STEP_MS)
    expect(
      resinMarks({ value: 200, at: T }, T, [40, 60, 80, 100, 120, 160, 180, 200]).every(
        (m) => m.reached,
      ),
    ).toBe(true)
    // The account's own list: sorted, each once, out-of-range amounts left out.
    expect(resinMarks({ value: 0, at: T }, T, [200, 20, 140, 20, 0]).map((m) => m.amount)).toEqual([
      20, 140, 200,
    ])
    expect(resinMarks({ value: 0, at: T }, T, [])).toEqual([])
    expect(resinMarks({ value: 0, at: T }, T, [40, 250]).map((m) => m.amount)).toEqual([40])
  })

  it('counts from now when the reading is dated after it (a clock ahead)', () => {
    const ahead = { value: 155, at: T + 2 * 24 * 60 * MIN }
    expect(resinAt(ahead, T)).toBe(155)
    expect(fullAt(ahead, T)).toBe(T + 45 * RESIN_STEP_MS)
    expect(reachedAt(ahead, 160, T)).toBe(T + 5 * RESIN_STEP_MS)
    expect(reachedAt(ahead, 120, T)).toBe(T)
    expect(alertAt(ahead, 180, T)).toBe(T + 25 * RESIN_STEP_MS)
    const marks = resinMarks(ahead, T, [40, 60, 80, 100, 120, 160, 180, 200])
    expect(marks.map((m) => m.reached)).toEqual([true, true, true, true, true, false, false, false])
    expect(marks[5]!.at).toBe(T + 5 * RESIN_STEP_MS)
  })

  it('sets and steps resin, keeping the regeneration clock', () => {
    const r = { value: 100, at: T }
    // 20 minutes on: 102, 4 minutes into the next point.
    const now = T + 20 * MIN
    expect(setResin(r, 60, now)).toEqual({ value: 60, at: now - 4 * MIN })
    expect(stepResin(r, -40, now)).toEqual({ value: 62, at: now - 4 * MIN })
    expect(resinAt(stepResin(r, -40, now)!, now + 4 * MIN)).toBe(63)
    expect(stepResin(r, -200, now)).toBeNull()
    // Over the cap nothing regenerates: the clock starts when it is set.
    expect(stepResin({ value: 180, at: T }, 60, T + MIN)).toEqual({ value: 240, at: T + MIN })
    expect(stepResin(null, 60, T)).toEqual({ value: 60, at: T })
    expect(setResin(r, 5000, now).value).toBe(2000)
  })

  it('reads one typed amount', () => {
    expect(parseAmount('-40')).toBe(-40)
    expect(parseAmount(' +60 ')).toBe(60)
    expect(parseAmount('140')).toBe(140)
    expect(parseAmount('−20')).toBe(-20)
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('4.5')).toBeNull()
    expect(parseAmount('-40 60')).toBeNull()
    expect(parseAmount('abc')).toBeNull()
    expect(parseAmount('1000')).toBeNull()
  })

  it('adds a quick button at the end, a mark in order', () => {
    expect(addStep([-40, -20], 60)).toEqual([-40, -20, 60])
    expect(addStep([-40, -20, 60], -30)).toEqual([-40, -20, 60, -30])
    expect(addStep([-40, -20, 60, -30], 10)).toBeNull()
    expect(addStep([-40], -40)).toBeNull()
    expect(addStep([], 0)).toBeNull()
    expect(addStep([], 201)).toBeNull()
    expect(addStep([], -200)).toEqual([-200])
    expect(addMark([40, 200], 140)).toEqual([40, 140, 200])
    expect(addMark([40, 200], 20)).toEqual([20, 40, 200])
    expect(addMark([40, 200], 40)).toBeNull()
    expect(addMark([], 0)).toBeNull()
    expect(addMark([], 201)).toBeNull()
    expect(addMark([], -40)).toBeNull()
    expect(addMark([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 13)).toBeNull()
  })
})

describe('resin alerts', () => {
  afterEach(() => {
    cancelResinAlerts()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('fires once at the amount while the page is open, with permission only', async () => {
    expect(alertSupport()).toBe('unsupported')
    expect(alertAt({ value: 100, at: T }, 160, T)).toBe(T + 60 * RESIN_STEP_MS)
    expect(alertAt({ value: 170, at: T }, 160, T)).toBeNull()
    expect(alertAt(null, 160, T)).toBeNull()

    // No Notification API: nothing is scheduled.
    scheduleResinAlert(1, T + MIN, 160, { name: 'Main', url: '/' }, T)
    expect(scheduledAlert(1)).toBeNull()

    vi.useFakeTimers({ now: T })
    vi.stubGlobal('window', globalThis)
    const notification = { permission: 'default' as 'default' | 'granted' }
    vi.stubGlobal('Notification', notification)
    expect(alertSupport()).toBe('default')
    scheduleResinAlert(1, T + MIN, 160, { name: 'Main', url: '/' }, T)
    expect(scheduledAlert(1)).toBeNull()

    notification.permission = 'granted'
    const shown: string[][] = []
    setAlertShow(async (title, body, tag, url) => {
      shown.push([title, body, tag, url])
    })
    scheduleResinAlert(1, T + 10 * MIN, 160, { name: 'Main', url: '/app/a/1/planner' }, T)
    expect(scheduledAlert(1)).toEqual({ at: T + 10 * MIN, amount: 160 })
    // Moved (resin was spent): only the new time fires.
    scheduleResinAlert(1, T + 20 * MIN, 160, { name: 'Main', url: '/app/a/1/planner' }, T)
    await vi.advanceTimersByTimeAsync(10 * MIN)
    expect(shown).toEqual([])
    await vi.advanceTimersByTimeAsync(10 * MIN)
    expect(shown).toEqual([['Original Resin 160', 'Main', 'resin-1', '/app/a/1/planner']])
    expect(scheduledAlert(1)).toBeNull()

    // A time already past is dropped, not fired late; null cancels.
    scheduleResinAlert(1, T, 160, { name: 'Main', url: '/' }, T + MIN)
    expect(scheduledAlert(1)).toBeNull()
    scheduleResinAlert(2, T + 30 * MIN, 200, { name: 'Alt', url: '/' }, T + 20 * MIN)
    scheduleResinAlert(2, null, 200, { name: 'Alt', url: '/' }, T + 20 * MIN)
    await vi.advanceTimersByTimeAsync(60 * MIN)
    expect(shown).toHaveLength(1)
  })
})

describe("a capture's resin clock", () => {
  it("counts on the game's timer: the next point lands at nextAt", () => {
    const nextAt = 1_791_000_300
    const reading = clockReading({ value: 120, nextAt })
    expect(resinAt(reading, nextAt * 1000 - 1)).toBe(120)
    expect(resinAt(reading, nextAt * 1000)).toBe(121)
    expect(resinAt(reading, nextAt * 1000 + 8 * MIN)).toBe(122)
  })
})
