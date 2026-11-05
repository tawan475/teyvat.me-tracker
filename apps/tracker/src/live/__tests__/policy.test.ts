import type { AccountResponse } from '@gdt/shared'
import { describe, expect, it } from 'vitest'
import {
  BURST_GAP_MS,
  FETCH_GAP_MS,
  PING_MS,
  RECENT_PONG_MS,
  RECONNECT_MAX_MS,
  RECONNECT_SLOW_AFTER,
  RECONNECT_SLOW_MS,
  captureToShow,
  eventNeedsFetch,
  fetchDelay,
  isNewCapture,
  mergeAccounts,
  parseLiveEvent,
  reconnectDelay,
  shouldCatchUp,
  shouldPing,
  type KnownAccounts,
  type MergeInput,
} from '../policy'

function account(
  id: number,
  dataVersion: number,
  latest: { id: number; takenAt: number; lastSeenAt?: number } | null = null,
  extra: Partial<AccountResponse> = {},
): AccountResponse {
  return {
    id,
    name: `Account ${id}`,
    uid: null,
    server: null,
    createdAt: 1,
    dataVersion,
    snapshotCount: latest ? 1 : 0,
    rawBytes: 0,
    storedBytes: 0,
    latest: latest && {
      id: latest.id,
      takenAt: latest.takenAt,
      lastSeenAt: latest.lastSeenAt ?? latest.takenAt,
      summary: {} as never,
    },
    ...extra,
  }
}

const merge = (input: Partial<MergeInput> & Pick<MergeInput, 'shown' | 'fresh'>) =>
  mergeAccounts({ pending: new Map(), complete: true, held: () => false, ...input })

describe('reconnecting', () => {
  it('doubles from 1 s to a 30 s cap, then slows to 5 min, shortened at random', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 10].map((n) => reconnectDelay(n, 1))).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000,
    ])
    expect(reconnectDelay(RECONNECT_SLOW_AFTER + 1, 1)).toBe(RECONNECT_SLOW_MS)
    expect(reconnectDelay(1, 0)).toBe(750)
    expect(reconnectDelay(RECONNECT_SLOW_AFTER, 0)).toBe(RECONNECT_MAX_MS * 0.75)
    for (let i = 0; i < 50; i++) {
      const delay = reconnectDelay(8, Math.random())
      expect(delay).toBeGreaterThanOrEqual(RECONNECT_MAX_MS * 0.75)
      expect(delay).toBeLessThanOrEqual(RECONNECT_MAX_MS)
    }
  })

  it('pings on the beat only every five minutes, and at once when a tab comes back', () => {
    const now = 1_000_000
    const idle = { now, lastPingAt: now - PING_MS, lastPongAt: now - PING_MS, waiting: false }
    expect(shouldPing('tick', idle)).toBe(true)
    // Several visible tabs beat out of step: one ping serves them.
    expect(shouldPing('tick', { ...idle, lastPingAt: now - 60_000 })).toBe(false)
    expect(shouldPing('shown', idle)).toBe(true)
    expect(shouldPing('online', idle)).toBe(true)
    expect(shouldPing('shown', { ...idle, lastPongAt: now - RECENT_PONG_MS + 1 })).toBe(false)
    expect(shouldPing('shown', { ...idle, waiting: true })).toBe(false)
  })

  it('re-reads at once, then at most every gap, wider in a burst', () => {
    expect(fetchDelay(10_000, 0, [])).toBe(0)
    expect(fetchDelay(10_000, 9_500, [10_000])).toBe(FETCH_GAP_MS - 500)
    const burst = [1_000, 2_000, 3_000, 4_000, 9_000]
    expect(fetchDelay(10_000, 9_000, burst)).toBe(BURST_GAP_MS - 1_000)
    // Events older than the window no longer count.
    expect(fetchDelay(100_000, 99_000, burst)).toBe(FETCH_GAP_MS - 1_000)
  })

  it('catches up when shown again only for unread events or a socket that is down', () => {
    // The socket stayed up and nothing was said: nothing to read, however long it was hidden.
    const quiet = { linkUp: true, staleSince: null, lastReadAt: 0 }
    expect(shouldCatchUp(quiet)).toBe(false)
    expect(shouldCatchUp({ ...quiet, linkUp: false })).toBe(true)
    // An event while hidden: read, unless a tab read the list after it (and shared it).
    expect(shouldCatchUp({ ...quiet, staleSince: 5_000, lastReadAt: 4_000 })).toBe(true)
    expect(shouldCatchUp({ ...quiet, staleSince: 5_000, lastReadAt: 6_000 })).toBe(false)
  })
})

describe('events', () => {
  it('reads data and account events and ignores anything else', () => {
    expect(parseLiveEvent('{"type":"accounts"}')).toEqual({ type: 'accounts' })
    // The write's D1 bookmarks ride along.
    expect(parseLiveEvent('{"type":"accounts","d1":"b1","d1l":"b2","x":1}')).toEqual({
      type: 'accounts',
      d1: 'b1',
      d1l: 'b2',
    })
    expect(
      parseLiveEvent('{"type":"data","accountId":3,"dataVersion":7,"takenAt":1000,"x":1}'),
    ).toEqual({ type: 'data', accountId: 3, dataVersion: 7, takenAt: 1000 })
    expect(parseLiveEvent('{"type":"data","accountId":3,"dataVersion":null}')).toEqual({
      type: 'data',
      accountId: 3,
      dataVersion: null,
    })
    const hello =
      '{"type":"hello","accounts":[{"id":1,"dataVersion":5,"name":"Main","uid":"8","server":"ASIA"}]}'
    expect(parseLiveEvent(hello)).toEqual({
      type: 'hello',
      accounts: [{ id: 1, dataVersion: 5, name: 'Main', uid: '8', server: 'ASIA' }],
    })
    expect(parseLiveEvent('{"type":"hello","accounts":[]}')).toEqual({
      type: 'hello',
      accounts: [],
    })
    // Live sync: an account's journal moved.
    expect(parseLiveEvent('{"type":"live","accountId":3,"seq":12}')).toEqual({
      type: 'live',
      accountId: 3,
      seq: 12,
    })
    expect(parseLiveEvent('{"type":"live","accountId":"3","seq":12}')).toBeNull()
    // With the batch itself; a malformed one is dropped (the event stays, so the page re-reads).
    const batch = {
      base: 'k1',
      prev: 11,
      changes: [['set', ['materials', 'Mora'], 7]],
      items: [['artifacts', '9', 42]],
      figures: { mora: 7 },
      updatedAt: 1000,
      bytes: 80,
    }
    expect(parseLiveEvent(JSON.stringify({ type: 'live', accountId: 3, seq: 12, batch }))).toEqual({
      type: 'live',
      accountId: 3,
      seq: 12,
      batch,
    })
    for (const bad of [
      { ...batch, prev: '11' },
      { ...batch, changes: [['set', 'materials', 7]] },
      { ...batch, figures: null },
      'batch',
    ]) {
      expect(
        parseLiveEvent(JSON.stringify({ type: 'live', accountId: 3, seq: 12, batch: bad })),
      ).toEqual({ type: 'live', accountId: 3, seq: 12 })
    }
    // The hello says where each open journal stands.
    expect(
      parseLiveEvent('{"type":"hello","accounts":[],"journals":[{"id":1,"base":"k1","seq":4}]}'),
    ).toEqual({ type: 'hello', accounts: [], journals: [{ id: 1, base: 'k1', seq: 4 }] })
    expect(
      parseLiveEvent('{"type":"hello","accounts":[],"journals":[{"id":1,"base":2,"seq":4}]}'),
    ).toEqual({ type: 'hello', accounts: [] })
    // Wish history changed elsewhere (it was dropped here before).
    expect(parseLiveEvent('{"type":"wishes","accountId":3,"tab":"t1"}')).toEqual({
      type: 'wishes',
      accountId: 3,
      tab: 't1',
    })
    expect(parseLiveEvent('{"type":"planner","accountId":3,"tab":"t1"}')).toEqual({
      type: 'planner',
      accountId: 3,
      tab: 't1',
    })
    expect(parseLiveEvent('{"type":"planner","accountId":3,"tab":7}')).toEqual({
      type: 'planner',
      accountId: 3,
    })
    for (const junk of [
      'pong',
      '{',
      '{"type":"data"}',
      '{"type":"other"}',
      '{"type":"hello"}',
      '{"type":"hello","accounts":[{"id":1}]}',
      '{"type":"planner"}',
      'null',
      42,
    ]) {
      expect(parseLiveEvent(junk)).toBeNull()
    }
  })

  const held = account(1, 5, null, { name: 'Main', uid: '8', server: 'ASIA' })
  const known: KnownAccounts = {
    knownVersion: (id) => (id === 1 ? 5 : null),
    shown: [held],
  }

  it('re-reads only for versions this tab does not hold yet', () => {
    const data = (accountId: number, dataVersion: number | null) =>
      ({ type: 'data', accountId, dataVersion }) as const
    expect(eventNeedsFetch(data(1, 5), known)).toBe(false)
    expect(eventNeedsFetch(data(1, 4), known)).toBe(false)
    expect(eventNeedsFetch(data(1, 6), known)).toBe(true)
    expect(eventNeedsFetch(data(1, null), known)).toBe(true)
    expect(eventNeedsFetch(data(2, 1), known)).toBe(true) // an account this tab has not seen
    expect(eventNeedsFetch({ type: 'accounts' }, known)).toBe(true)
    // The Planner re-reads its own data; the account list has not moved.
    expect(eventNeedsFetch({ type: 'planner', accountId: 1 }, known)).toBe(false)
  })

  it('re-reads after a reconnect only when the hello shows something was missed', () => {
    const as = { id: 1, dataVersion: 5, name: 'Main', uid: '8', server: 'ASIA' as const }
    const hello = (...accounts: (typeof as)[]) => ({ type: 'hello', accounts }) as const
    expect(eventNeedsFetch(hello(as), known)).toBe(false)
    expect(eventNeedsFetch(hello({ ...as, dataVersion: 4 }), known)).toBe(false) // a stale tab
    expect(eventNeedsFetch(hello({ ...as, dataVersion: 6 }), known)).toBe(true) // an upload
    expect(eventNeedsFetch(hello({ ...as, name: 'Alt' }), known)).toBe(true) // a rename
    expect(eventNeedsFetch(hello(as, { ...as, id: 2 }), known)).toBe(true) // a new account
    expect(eventNeedsFetch(hello(), known)).toBe(true) // a deleted one
  })
})

describe('merging fresh rows', () => {
  const a1 = account(1, 3, { id: 10, takenAt: 1_000 })
  const a2 = account(2, 1, null)

  it('keeps untouched rows as they are, so nothing reloads', () => {
    const result = merge({ shown: [a1, a2], fresh: [{ ...a1 }, { ...a2 }] })
    expect(result.changed).toBe(false)
    expect(result.shown[0]).toBe(a1)
    expect(result.shown[1]).toBe(a2)
    expect(result.captures).toEqual([])
  })

  it('takes a newer version and reports a new newest capture', () => {
    const next = account(1, 4, { id: 11, takenAt: 2_000 })
    const result = merge({ shown: [a1, a2], fresh: [next, a2] })
    expect(result.changed).toBe(true)
    expect(result.shown).toEqual([next, a2])
    expect(result.shown[1]).toBe(a2)
    expect(result.captures).toEqual([next])
  })

  it('updates quietly for a capture seen again, a backfill or a delete', () => {
    const seen = account(1, 4, { id: 10, takenAt: 1_000, lastSeenAt: 5_000 })
    const backfill = account(1, 4, { id: 10, takenAt: 1_000 }, { snapshotCount: 2 })
    const deleted = account(1, 4, { id: 9, takenAt: 500 })
    for (const next of [seen, backfill, deleted]) {
      const result = merge({ shown: [a1], fresh: [next] })
      expect(result.shown).toEqual([next])
      expect(result.captures).toEqual([])
    }
    expect(isNewCapture(a1, account(1, 4, null))).toBe(false)
  })

  it('takes a rename at the same version, and ignores an older version', () => {
    const renamed = { ...a1, name: 'Alt' }
    expect(merge({ shown: [a1], fresh: [renamed] }).shown[0]).toBe(renamed)
    const stale = account(1, 2, { id: 9, takenAt: 500 })
    const result = merge({ shown: [a1], fresh: [stale] })
    expect(result.changed).toBe(false)
    expect(result.shown[0]).toBe(a1)
  })

  it('adds new accounts and, from a whole list, drops removed ones', () => {
    const made = account(3, 1, { id: 30, takenAt: 3_000 })
    const result = merge({ shown: [a1, a2], fresh: [a1, made] })
    expect(result.shown.map((a) => a.id)).toEqual([1, 3])
    expect(result.captures).toEqual([made])
    // A partial update (one re-read account) removes nothing.
    const partial = merge({ shown: [a1, a2], fresh: [made], complete: false })
    expect(partial.shown.map((a) => a.id)).toEqual([1, 2, 3])
  })

  it('holds a newer version back while held, newest first, then applies it', () => {
    const v4 = account(1, 4, { id: 11, takenAt: 2_000 })
    const v5 = account(1, 5, { id: 12, takenAt: 3_000 })
    const held = merge({ shown: [a1, a2], fresh: [v4, a2], held: (id) => id === 1 })
    expect(held.changed).toBe(false)
    expect(held.shown[0]).toBe(a1)
    expect(held.pending.get(1)).toBe(v4)

    // A later list keeps the newest waiting; an older message does not replace it.
    const later = merge({ shown: held.shown, pending: held.pending, fresh: [v5], held: () => true })
    expect(later.pending.get(1)).toBe(v5)
    const late = merge({
      shown: later.shown,
      pending: later.pending,
      fresh: [v4],
      complete: false,
      held: () => true,
    })
    expect(late.pending.get(1)).toBe(v5)

    // Released: the waiting row applies with nothing new from the server.
    const released = merge({ shown: late.shown, pending: late.pending, fresh: [], complete: false })
    expect(released.shown[0]).toBe(v5)
    expect(released.pending.size).toBe(0)
    expect(released.captures).toEqual([v5])
  })

  it('still adds accounts and takes renames while held', () => {
    const renamed = { ...a2, name: 'Alt' }
    const made = account(3, 1, null)
    const result = merge({ shown: [a1, a2], fresh: [a1, renamed, made], held: () => true })
    expect(result.shown).toEqual([a1, renamed, made])
  })

  it('drops a waiting row whose account is gone', () => {
    const v4 = account(1, 4, null)
    const result = merge({ shown: [a1, a2], pending: new Map([[1, v4]]), fresh: [a2] })
    expect(result.shown).toEqual([a2])
    expect(result.pending.size).toBe(0)
  })
})

describe('the capture toast', () => {
  const older = account(1, 2, { id: 10, takenAt: 1_000 })
  const newer = account(2, 2, { id: 20, takenAt: 2_000 })

  it('is about the open account, or the newest capture on pages about none', () => {
    expect(captureToShow([older, newer], 1)).toBe(older)
    expect(captureToShow([older, newer], 3)).toBeNull()
    expect(captureToShow([older, newer], null)).toBe(newer)
    expect(captureToShow([], null)).toBeNull()
  })
})
