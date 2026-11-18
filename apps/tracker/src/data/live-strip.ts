/**
 * The Overview's live strip (docs/plans/live-sync.md §8.2): what this play
 * session has brought so far, from the open journal and the snapshot list.
 * "This session" starts at the session's first snapshot (`gi_capture.session`);
 * a journal on a snapshot without a capture counts from that snapshot.
 */

import type { LiveJournalResponse, SnapshotResponse, SnapshotSummary } from '@gdt/shared'
import { sharesFigure, type SummaryKey } from './overview'

export interface LiveStrip {
  /** Change since the session began. */
  mora: number
  primogem: number
  artifacts: number
  /** Characters whose level the journal moved (since the newest snapshot). */
  levelUps: number
  /** Talents the journal moved. */
  talents: number
  /** Unix ms of the last batch. */
  updatedAt: number
  /** When the session (or the snapshot it counts from) began. */
  since: number
}

/**
 * The strip, or null when there is nothing to show: no open journal, one that
 * does not follow the newest snapshot, or one without changes.
 */
export function liveStrip(
  live: LiveJournalResponse | null | undefined,
  snapshots: readonly SnapshotResponse[],
): LiveStrip | null {
  if (!live?.open || !live.base || !live.figures || !live.changes?.length) return null
  const newest = snapshots[0]
  if (!newest || newest.id !== live.base.snapshotId) return null
  const session = newest.capture?.session
  // Newest first: the last one of the run with this session is where it began.
  let start: SnapshotResponse = newest
  if (session) {
    for (const snapshot of snapshots) {
      if (snapshot.capture?.session === session) start = snapshot
      else if (snapshot.takenAt < start.takenAt) break
    }
  }
  const from: SnapshotSummary = start.summary
  const levelled = new Set<string>()
  let talents = 0
  for (const [op, path] of live.changes) {
    if (op !== 'set' || path[0] !== 'characters') continue
    if (path[2] === 'level') levelled.add(String(path[1]))
    else if (path[2] === 'talent') talents++
  }
  // The journal's figures are counted from what Capture uploads: a section
  // its base or the session's first snapshot left out (gi_off) counts no change.
  const figures = live.figures
  const brought = (key: SummaryKey) =>
    sharesFigure(newest.off, key) && sharesFigure(start.off, key) ? figures[key] - from[key] : 0
  return {
    mora: brought('mora'),
    primogem: brought('primogem'),
    artifacts: brought('artifacts'),
    levelUps: levelled.size,
    talents,
    updatedAt: live.updatedAt ?? 0,
    since: start.takenAt,
  }
}
