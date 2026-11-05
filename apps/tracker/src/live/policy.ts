/**
 * The decisions behind live updates, kept pure so they can be tested without
 * a socket, a timer or a page: how long to wait before reconnecting, when to
 * ping, which events (and which `hello`) need the account list re-read, when
 * a tab shown again must catch up, how fresh rows fold into the shown list
 * (or wait while a dialog is open), and which of them is a new capture.
 */

import type {
  AccountResponse,
  LiveAccount,
  LiveBatchPush,
  LiveEvent,
  LiveJournalMark,
} from '@gdt/shared'

// ----------------------------------------------------------------- timing

/** First reconnect wait; it doubles per failed attempt up to the cap. */
export const RECONNECT_BASE_MS = 1_000
export const RECONNECT_MAX_MS = 30_000
/** After this many failed connects in a row, try only every RECONNECT_SLOW_MS. */
export const RECONNECT_SLOW_AFTER = 10
export const RECONNECT_SLOW_MS = 300_000
/** Failed connects in a row (none opened) before slow polling backs the socket up. */
export const FALLBACK_AFTER = 3
/** Slow poll of the account list while the socket cannot connect (visible tabs, shared). */
export const FALLBACK_POLL_MS = 120_000
/** Keep-alive: a `ping` this often while some tab is visible (none while all are hidden). */
export const PING_MS = 300_000
/** No `pong` within this means a dead socket. */
export const PONG_TIMEOUT_MS = 10_000
/** A tab shown again, or the network back, pings unless a pong came this recently. */
export const RECENT_PONG_MS = 10_000
/** Re-reads of the list after events: at most one per gap (the first one at once). */
export const FETCH_GAP_MS = 2_000
/** A burst (a bulk import elsewhere): this many events within the window widens the gap. */
export const BURST_EVENTS = 5
export const BURST_WINDOW_MS = 30_000
export const BURST_GAP_MS = 10_000

/**
 * Wait before reconnect attempt `attempt` (1-based): 1 s, 2 s, 4 s … 30 s,
 * then every 5 minutes once it has failed RECONNECT_SLOW_AFTER times in a row
 * (a network that blocks WebSockets; the slow poll covers it). Each is
 * shortened by up to a quarter at random so browsers do not reconnect in step.
 */
export function reconnectDelay(attempt: number, random = Math.random()): number {
  const raw =
    attempt > RECONNECT_SLOW_AFTER
      ? RECONNECT_SLOW_MS
      : Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.max(0, attempt - 1))
  return Math.round(raw * (0.75 + 0.25 * Math.min(1, Math.max(0, random))))
}

export type PingReason = 'tick' | 'shown' | 'online'

/**
 * Whether the socket's holder should ping now. `tick`: the five-minute beat a
 * visible tab sends (several tabs share one ping). `shown` / `online`: a tab
 * came back or the network did, so check at once unless a pong just came.
 * Never while a ping is still waiting for its pong.
 */
export function shouldPing(
  reason: PingReason,
  state: { now: number; lastPingAt: number; lastPongAt: number; waiting: boolean },
): boolean {
  if (state.waiting) return false
  if (reason === 'tick') return state.now - state.lastPingAt >= PING_MS * 0.8
  return state.now - Math.max(state.lastPongAt, state.lastPingAt) >= RECENT_PONG_MS
}

/** How long until the list may be re-read, given the last read and the recent events. */
export function fetchDelay(
  now: number,
  lastFetchAt: number,
  eventTimes: readonly number[],
): number {
  const recent = eventTimes.filter((t) => now - t < BURST_WINDOW_MS).length
  const gap = recent >= BURST_EVENTS ? BURST_GAP_MS : FETCH_GAP_MS
  return Math.max(0, lastFetchAt + gap - now)
}

/**
 * Whether a tab shown again must re-read the list: while the socket is down
 * (pushes are being lost), or when an event (a `hello` after a reconnect
 * included) arrived while it was hidden and no tab has read the list since.
 * A socket that stayed up brought everything already.
 */
export function shouldCatchUp(state: {
  linkUp: boolean
  /** When the first event this tab did not read for arrived (null: none). */
  staleSince: number | null
  /** When this tab, or another one, last started reading the list. */
  lastReadAt: number
}): boolean {
  if (!state.linkUp) return true
  return state.staleSince !== null && state.lastReadAt < state.staleSince
}

// ----------------------------------------------------------------- events

/** A socket message as an event, or null for anything else (keep-alives, junk). */
export function parseLiveEvent(text: unknown): LiveEvent | null {
  if (typeof text !== 'string' || !text.startsWith('{')) return null
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object') return null
  const event = value as Record<string, unknown>
  const parsed = parseEventBody(event)
  if (!parsed) return null
  // The write's D1 bookmarks (worker/lib/d1-session.ts), when it sent them.
  if (typeof event.d1 === 'string') parsed.d1 = event.d1
  if (typeof event.d1l === 'string') parsed.d1l = event.d1l
  return parsed
}

function parseEventBody(event: Record<string, unknown>): LiveEvent | null {
  if (event.type === 'accounts') return { type: 'accounts' }
  if (event.type === 'hello') return parseHello(event.accounts, event.journals)
  if (event.type === 'planner' || event.type === 'wishes') {
    if (!Number.isSafeInteger(event.accountId)) return null
    return {
      type: event.type,
      accountId: event.accountId as number,
      ...(typeof event.tab === 'string' ? { tab: event.tab } : {}),
    }
  }
  if (event.type === 'live') {
    if (!Number.isSafeInteger(event.accountId)) return null
    const batch = parseBatch(event.batch)
    return {
      type: 'live',
      accountId: event.accountId as number,
      seq: Number.isSafeInteger(event.seq) ? (event.seq as number) : 0,
      ...(batch ? { batch } : {}),
    }
  }
  if (event.type === 'presence') {
    if (!Number.isSafeInteger(event.accountId)) return null
    const p = event.presence as Record<string, unknown> | null
    const presence =
      p && typeof p === 'object' && typeof p.at === 'number' && typeof p.device === 'string'
        ? {
            sid: Number.isSafeInteger(p.sid) ? (p.sid as number) : null,
            device: p.device,
            state: p.state === 'running' ? ('running' as const) : ('decoding' as const),
            at: p.at,
            platform: typeof p.platform === 'string' ? p.platform : null,
            app: typeof p.app === 'string' ? p.app : null,
          }
        : null
    const pending = Array.isArray(event.pending)
      ? (event.pending as unknown[]).filter(
          (k): k is 'wishes' | 'snapshot' => k === 'wishes' || k === 'snapshot',
        )
      : []
    return { type: 'presence', accountId: event.accountId as number, presence, pending }
  }
  if (event.type !== 'data' || !Number.isSafeInteger(event.accountId)) return null
  return {
    type: 'data',
    accountId: event.accountId as number,
    dataVersion: Number.isSafeInteger(event.dataVersion) ? (event.dataVersion as number) : null,
    ...(typeof event.takenAt === 'number' ? { takenAt: event.takenAt } : {}),
  }
}

/** A live event's batch, when it has the right shape (its changes are checked as applied). */
function parseBatch(value: unknown): LiveBatchPush | undefined {
  if (!value || typeof value !== 'object') return undefined
  const b = value as Record<string, unknown>
  if (
    typeof b.base !== 'string' ||
    !Number.isSafeInteger(b.prev) ||
    !Array.isArray(b.changes) ||
    !b.changes.every((c) => Array.isArray(c) && typeof c[0] === 'string' && Array.isArray(c[1])) ||
    !Array.isArray(b.items) ||
    !b.figures ||
    typeof b.figures !== 'object' ||
    typeof b.updatedAt !== 'number' ||
    typeof b.bytes !== 'number'
  ) {
    return undefined
  }
  return b as unknown as LiveBatchPush
}

/** The hello's journal marks (absent: the server did not say). */
function parseMarks(value: unknown): LiveJournalMark[] | undefined {
  if (!Array.isArray(value)) return undefined
  const marks: LiveJournalMark[] = []
  for (const item of value as Record<string, unknown>[]) {
    if (!item || !Number.isSafeInteger(item.id) || typeof item.base !== 'string') return undefined
    if (!Number.isSafeInteger(item.seq)) return undefined
    marks.push({ id: item.id as number, base: item.base, seq: item.seq as number })
  }
  return marks
}

function parseHello(value: unknown, journals?: unknown): LiveEvent | null {
  if (!Array.isArray(value)) return null
  const accounts: LiveAccount[] = []
  for (const item of value as Record<string, unknown>[]) {
    if (!item || !Number.isSafeInteger(item.id) || !Number.isSafeInteger(item.dataVersion)) {
      return null
    }
    accounts.push({
      id: item.id as number,
      dataVersion: item.dataVersion as number,
      name: (item.name as string | null) ?? null,
      uid: (item.uid as string | null) ?? null,
      server: (item.server as LiveAccount['server']) ?? null,
    })
  }
  const marks = parseMarks(journals)
  return { type: 'hello', accounts, ...(marks ? { journals: marks } : {}) }
}

/** What a tab holds, as far as telling events apart goes. */
export interface KnownAccounts {
  /** The newest version held of an account (shown or waiting), null when not held. */
  knownVersion: (id: number) => number | null
  /** The accounts shown. */
  shown: readonly AccountResponse[]
}

/**
 * Whether `event` tells this tab something it does not know yet. A data event
 * for a version already held (this tab's own import, or a list another tab
 * shared) needs nothing, nor a `hello` that matches what is held, nor a
 * planner change (the Planner page re-reads that itself); anything else
 * re-reads the list.
 */
export function eventNeedsFetch(event: LiveEvent, known: KnownAccounts): boolean {
  if (
    event.type === 'planner' ||
    event.type === 'wishes' ||
    event.type === 'live' ||
    event.type === 'presence'
  ) {
    return false
  }
  if (event.type === 'hello') return helloDiffers(event.accounts, known)
  if (event.type !== 'data' || event.dataVersion === null) return true
  const version = known.knownVersion(event.accountId)
  return version === null || version < event.dataVersion
}

/** Whether the accounts a `hello` lists differ from the ones held (missed while disconnected). */
export function helloDiffers(accounts: readonly LiveAccount[], known: KnownAccounts): boolean {
  if (accounts.length !== known.shown.length) return true
  const shown = new Map(known.shown.map((a) => [a.id, a]))
  for (const account of accounts) {
    const row = shown.get(account.id)
    const version = known.knownVersion(account.id)
    if (!row || version === null || version < account.dataVersion) return true
    // Renamed while away (a rename keeps the version).
    if (row.name !== account.name || row.uid !== account.uid || row.server !== account.server) {
      return true
    }
  }
  return false
}

// ----------------------------------------------------------------- merging

export interface MergeInput {
  /** What the app shows now. */
  shown: readonly AccountResponse[]
  /** Newer rows held back until the user is done (see `held`). */
  pending: ReadonlyMap<number, AccountResponse>
  fresh: readonly AccountResponse[]
  /** `fresh` is the whole list, so accounts missing from it are gone. */
  complete: boolean
  /** Whether a newer version of this account must wait (a dialog is open, an import runs). */
  held: (id: number) => boolean
}

export interface MergeOutput {
  shown: AccountResponse[]
  pending: Map<number, AccountResponse>
  /** Rows now shown whose newest snapshot is new: what the "New capture" toast is about. */
  captures: AccountResponse[]
  changed: boolean
}

/** Same row as far as anything on screen goes (the summary moves only with the version). */
export function sameAccount(a: AccountResponse, b: AccountResponse): boolean {
  return (
    a.id === b.id &&
    a.dataVersion === b.dataVersion &&
    a.name === b.name &&
    a.uid === b.uid &&
    a.server === b.server &&
    a.createdAt === b.createdAt &&
    a.snapshotCount === b.snapshotCount &&
    a.rawBytes === b.rawBytes &&
    a.storedBytes === b.storedBytes &&
    a.latest?.id === b.latest?.id &&
    a.latest?.takenAt === b.latest?.takenAt &&
    a.latest?.lastSeenAt === b.latest?.lastSeenAt &&
    (a.liveSync ?? false) === (b.liveSync ?? false)
  )
}

/** Whether `after` brought a newer newest capture than `before` had (not a delete or a backfill). */
export function isNewCapture(before: AccountResponse | undefined, after: AccountResponse): boolean {
  const next = after.latest
  if (!next) return false
  const previous = before?.latest
  if (!previous) return true
  return next.id !== previous.id && next.takenAt >= previous.takenAt
}

/**
 * Folds `fresh` rows (and any held-back ones) into the shown list:
 * - a newer version replaces the shown row, unless `held`, when it waits in
 *   `pending` (the newest one wins) and the row on screen stays as it is;
 * - the same version replaces it only when something visible differs (a
 *   rename), so untouched rows keep their identity and nothing reloads;
 * - an older version (a late or stale message) is ignored;
 * - new accounts are added at once, and with a `complete` list, accounts it
 *   lacks are dropped.
 */
export function mergeAccounts(input: MergeInput): MergeOutput {
  const { shown, fresh, complete, held } = input
  const pending = new Map(input.pending)
  const candidates = new Map(pending)
  for (const row of fresh) {
    const waiting = candidates.get(row.id)
    if (!waiting || waiting.dataVersion <= row.dataVersion) candidates.set(row.id, row)
  }
  if (complete) {
    const present = new Set(fresh.map((row) => row.id))
    for (const id of [...candidates.keys()]) if (!present.has(id)) candidates.delete(id)
    for (const id of [...pending.keys()]) if (!present.has(id)) pending.delete(id)
  }

  const captures: AccountResponse[] = []
  let changed = false
  const pick = (current: AccountResponse): AccountResponse | null => {
    const next = candidates.get(current.id)
    candidates.delete(current.id)
    if (!next) {
      if (complete) changed = true // gone
      return complete ? null : current
    }
    if (next.dataVersion < current.dataVersion) {
      pending.delete(current.id)
      return current
    }
    if (next.dataVersion === current.dataVersion) {
      pending.delete(current.id)
      if (sameAccount(current, next)) return current
      changed = true
      return next
    }
    if (held(current.id)) {
      pending.set(current.id, next)
      return current
    }
    pending.delete(current.id)
    if (isNewCapture(current, next)) captures.push(next)
    changed = true
    return next
  }

  let next = shown.map(pick).filter((row): row is AccountResponse => row !== null)
  // What is left is new to this tab.
  for (const row of candidates.values()) {
    pending.delete(row.id)
    if (isNewCapture(undefined, row)) captures.push(row)
    next.push(row)
    changed = true
  }
  if (complete && changed) {
    // The server's order (by id).
    const order = new Map(fresh.map((row, i) => [row.id, i]))
    next = next.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
  }
  return { shown: changed ? next : [...shown], pending, captures, changed }
}

/**
 * The capture the toast is about: the open account's, or on pages about no
 * account (the account list), the newest one.
 */
export function captureToShow(
  captures: readonly AccountResponse[],
  openAccountId: number | null,
): AccountResponse | null {
  if (openAccountId !== null) return captures.find((a) => a.id === openAccountId) ?? null
  let newest: AccountResponse | null = null
  for (const account of captures) {
    if (!newest || account.latest!.takenAt > newest.latest!.takenAt) newest = account
  }
  return newest
}
