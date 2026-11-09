import { afterEach, describe, expect, it } from 'vitest'
import type { WishPull } from '@gdt/shared'
import {
  blockedInThePast,
  historyAt,
  keepPast,
  leavePastOnNextNavigation,
  stepFrom,
  takeLeaving,
  travelParam,
  travelTo,
  travelling,
  type RouteLike,
} from '../time-travel'
import { wishHistoryAt, type WishHistory } from '../wish-history'

// The snapshot list comes newest first; ids are not in time order (an old
// capture imported later gets a bigger id).
const list = [
  { id: 9, takenAt: 5_000 },
  { id: 4, takenAt: 4_000 },
  { id: 12, takenAt: 3_000 },
  { id: 2, takenAt: 2_000 },
  { id: 1, takenAt: 1_000 },
]

describe('time travel: the address', () => {
  it('reads a snapshot id from ?at and nothing else', () => {
    expect(travelParam({ at: '12' })).toBe(12)
    expect(travelParam({ at: ['7', '8'] })).toBe(7)
    for (const at of [undefined, '', '0', '-3', '1.5', '12abc', '2026-10-04T12:00:00Z', null])
      expect(travelParam({ at })).toBeNull()
  })
})

describe('time travel: where a snapshot sits', () => {
  it('counts oldest first by taken time, not by id', () => {
    expect(travelTo(list, 12)).toEqual({ at: 12, takenAt: 3_000, index: 3, total: 5 })
    expect(travelTo(list, 1)).toMatchObject({ index: 1 })
    expect(travelTo(list, 9)).toMatchObject({ index: 5 })
    expect(travelTo(list, 77)).toBeNull()
  })

  it('keeps the history up to and including the snapshot, in the list order', () => {
    const travel = travelTo(list, 12)!
    expect(historyAt(list, travel).map((s) => s.id)).toEqual([12, 2, 1])
  })

  it('cuts by time when the snapshot is not in the list', () => {
    expect(
      historyAt(list, { at: 77, takenAt: 4_500, index: 1, total: 1 }).map((s) => s.id),
    ).toEqual([1, 2, 12, 4])
  })

  it('keeps a twin taken at the same time on the right side of the cut', () => {
    const twins = [
      { id: 6, takenAt: 2_000 },
      { id: 5, takenAt: 2_000 },
      { id: 1, takenAt: 1_000 },
    ]
    expect(historyAt(twins, travelTo(twins, 5)!).map((s) => s.id)).toEqual([5, 1])
    expect(historyAt(twins, travelTo(twins, 6)!).map((s) => s.id)).toEqual([6, 5, 1])
  })

  it('steps to the older and newer capture, and stops at the ends', () => {
    expect(stepFrom(list, 12, -1)).toBe(2)
    expect(stepFrom(list, 12, 1)).toBe(4)
    expect(stepFrom(list, 1, -1)).toBeNull()
    expect(stepFrom(list, 9, 1)).toBeNull()
    expect(stepFrom(list, 77, 1)).toBeNull()
  })
})

describe('time travel: the past is read-only', () => {
  afterEach(() => (travelling.value = null))

  it('refuses writes to the travelled account only', () => {
    expect(blockedInThePast('/api/accounts/3/planner-state', 'PATCH')).toBe(false)
    travelling.value = { accountId: 3, travel: { at: 12, takenAt: 3_000, index: 3, total: 5 } }
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE', 'post'])
      expect(blockedInThePast('/api/accounts/3/planner-state', method)).toBe(true)
    expect(blockedInThePast('/api/accounts/3', 'PATCH')).toBe(true)
    expect(blockedInThePast('/api/accounts/3?x=1', 'DELETE')).toBe(true)
    // Reads, another account (3 is not 30) and the user's own routes pass.
    expect(blockedInThePast('/api/accounts/3/snapshots', 'GET')).toBe(false)
    expect(blockedInThePast('/api/accounts/3/snapshots', undefined)).toBe(false)
    expect(blockedInThePast('/api/accounts/30/planner-state', 'PATCH')).toBe(false)
    expect(blockedInThePast('/api/auth/logout', 'POST')).toBe(false)
  })
})

describe('time travel: links stay in the past', () => {
  const route = (
    path: string,
    query: Record<string, unknown> = {},
    accountId?: string,
  ): RouteLike => ({
    path,
    params: accountId === undefined ? {} : { accountId },
    query,
    hash: '',
  })
  const past = route('/app/a/3/overview', { at: '12' }, '3')

  it('carries ?at to another page of the same account', () => {
    expect(keepPast(route('/app/a/3/characters', { c: 'Furina' }, '3'), past, false)).toEqual({
      path: '/app/a/3/characters',
      query: { c: 'Furina', at: '12' },
      hash: '',
      replace: true,
    })
  })

  it('leaves the past on Back to now, another account, outside one, or its own ?at', () => {
    expect(keepPast(route('/app/a/3/characters', {}, '3'), past, true)).toBeNull()
    expect(keepPast(route('/app/a/4/overview', {}, '4'), past, false)).toBeNull()
    expect(keepPast(route('/app/settings'), past, false)).toBeNull()
    expect(keepPast(route('/app/a/3/overview', { at: '2' }, '3'), past, false)).toBeNull()
    expect(
      keepPast(route('/app/a/3/characters', {}, '3'), route('/app/a/3/overview', {}, '3'), false),
    ).toBeNull()
  })

  it('reads the leave flag once', () => {
    leavePastOnNextNavigation()
    expect(takeLeaving()).toBe(true)
    expect(takeLeaving()).toBe(false)
  })
})

describe('time travel: wishes', () => {
  const pull = (id: number, time: number) => ({ id: BigInt(id), time }) as unknown as WishPull
  // Server clock UTC+8: a pull at wall-clock 8 h after 0 is Unix 0.
  const history: WishHistory = {
    timezone: 8,
    banners: new Map([
      [301, [pull(1, 8 * 3600 - 10), pull(2, 8 * 3600), pull(3, 8 * 3600 + 10)]],
      [302, [pull(4, 8 * 3600 + 50)]],
    ]),
    total: 4,
    bytes: 100,
    updatedAt: null,
  }

  it('keeps the pulls made by the capture time on the server clock', () => {
    const cut = wishHistoryAt(history, 0)
    expect([...cut.banners.keys()]).toEqual([301])
    expect(cut.banners.get(301)!.map((p) => Number(p.id))).toEqual([1, 2])
    expect(cut.total).toBe(2)
    expect(cut.bytes).toBe(100)
  })

  it('is the same object when nothing is cut', () => {
    expect(wishHistoryAt(history, 60_000)).toBe(history)
  })
})
