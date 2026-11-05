/**
 * The live journal and chart points this tab holds per account, kept
 * current from the socket's `live` events: the batch an event carries is
 * applied here with the server's own merge, so the pages' re-read after the
 * event is answered without a request (live sync sends a batch every 15 s
 * or so, and every open tab used to read the whole journal after each).
 * Anything that does not follow what is held (another base, a gap, a bare
 * event, a reconnect that moved it) drops it, and the next read goes to the
 * server. The owner's and members' reads only, never staff Inspect.
 */

import {
  applyLiveBatch,
  applyLivePoint,
  type LiveBatchPush,
  type LiveJournalMark,
  type LiveJournalResponse,
  type LivePointRow,
} from '@gdt/shared'
import { onLiveBatch } from '@/live/journal'

interface Held<T> {
  /** The account's data version it was read at (a new snapshot rebases the journal). */
  dataVersion: number
  value: T
}

const journals = new Map<number, Held<LiveJournalResponse>>()
const points = new Map<number, Held<LivePointRow[]>>()
/** Live events seen per account: a read that started before one is not kept. */
const events = new Map<number, number>()

/** The live events seen for the account so far: pass to `holdJournal` / `holdPoints`. */
export function liveEventsSeen(accountId: number): number {
  return events.get(accountId) ?? 0
}

export function heldJournal(accountId: number, dataVersion: number): LiveJournalResponse | null {
  const held = journals.get(accountId)
  return held && held.dataVersion === dataVersion ? held.value : null
}

export function heldPoints(accountId: number, dataVersion: number): LivePointRow[] | null {
  const held = points.get(accountId)
  return held && held.dataVersion === dataVersion ? held.value : null
}

/** Keeps a journal read from the server, unless a live event came while it was read. */
export function holdJournal(
  accountId: number,
  dataVersion: number,
  value: LiveJournalResponse,
  since: number,
): void {
  if (liveEventsSeen(accountId) === since) journals.set(accountId, { dataVersion, value })
}

/** Keeps chart points read from the server, unless a live event came while they were read. */
export function holdPoints(
  accountId: number,
  dataVersion: number,
  value: LivePointRow[],
  since: number,
): void {
  if (liveEventsSeen(accountId) === since) points.set(accountId, { dataVersion, value })
}

function onBatch(accountId: number, seq: number, batch: LiveBatchPush | undefined): void {
  events.set(accountId, liveEventsSeen(accountId) + 1)
  const held = journals.get(accountId)
  let next: LiveJournalResponse | null = null
  try {
    next = held && batch ? applyLiveBatch(held.value, seq, batch) : null
  } catch {
    next = null
  }
  if (!held || !batch || !next) {
    journals.delete(accountId)
    points.delete(accountId)
    return
  }
  journals.set(accountId, { ...held, value: next })
  const heldPoints = points.get(accountId)
  if (heldPoints) {
    points.set(accountId, {
      ...heldPoints,
      value: applyLivePoint(heldPoints.value, { at: batch.updatedAt, figures: batch.figures }),
    })
  }
}

/** Whether the journal held for the account is where the hello's marks put it. */
function isCurrent(accountId: number, marks: readonly LiveJournalMark[] | undefined): boolean {
  const held = journals.get(accountId)?.value
  if (!held || !marks) return false
  const mark = marks.find((m) => m.id === accountId)
  if (!mark) return held.open === false
  return held.open && held.base?.contentKey === mark.base && (held.seq ?? 0) === mark.seq
}

onLiveBatch(onBatch, isCurrent)
