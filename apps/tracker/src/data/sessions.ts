/**
 * Play sessions (docs/plans/live-sync.md §8.3): snapshots grouped by
 * irminsul's `gi_capture.session` (one game login), each split into world
 * stays at the game's full sends (`login`, `world`). Snapshots without a
 * capture (older ones, other uploaders) group by local day, as the list does.
 * A snapshot that left a figure's section out on purpose (Capture's gi_off,
 * issue 12) says nothing about the figure: a change is counted only between
 * snapshots that shared it, never as a drop to 0 and back.
 * Pure: the Snapshots page and Overview render the result.
 */

import type {
  GoodCharacter,
  LiveJournalResponse,
  SnapshotResponse,
  SnapshotSummary,
} from '@gdt/shared'
import { dayKey, sharesFigure, type SummaryKey } from './overview'

export interface Stay {
  /** 1 = the first world of the session (the player's own at login), 2+ in order. */
  world: number
  start: number
  end: number
  /** What the stay brought: the next stay's start (or now) minus this one's. */
  mora: number
  primogem: number
  artifacts: number
}

export interface Session {
  /** irminsul's session id, or `day:YYYY-MM-DD` for snapshots without one. */
  key: string
  /** True for snapshots grouped by day (no session id). */
  byDay: boolean
  start: number
  end: number
  /** Oldest first. */
  snapshots: SnapshotResponse[]
  /** The session's change: its end (the journal's figures when it is open) minus its start. */
  totals: { mora: number; primogem: number; artifacts: number; characters: number; weapons: number }
  stays: Stay[]
  /** The open journal continues this session (its newest snapshot is the journal's base). */
  live: boolean
}

const STAY_REASONS = new Set(['login', 'world'])

/**
 * Sessions, newest first, from snapshots newest first (as loadSnapshots
 * gives them) and the open journal, if any.
 */
export function buildSessions(
  snapshots: readonly SnapshotResponse[],
  live?: LiveJournalResponse | null,
): Session[] {
  const oldestFirst = [...snapshots].sort((a, b) => a.takenAt - b.takenAt || a.id - b.id)
  const groups: { key: string; byDay: boolean; snapshots: SnapshotResponse[] }[] = []
  for (const snapshot of oldestFirst) {
    const session = snapshot.capture?.session
    const key = session ?? `day:${dayKey(snapshot.takenAt)}`
    const last = groups.at(-1)
    if (last && last.key === key) last.snapshots.push(snapshot)
    else groups.push({ key, byDay: !session, snapshots: [snapshot] })
  }
  const newestId = snapshots[0]?.id
  const journalOpen =
    !!live?.open && !!live.figures && !!live.changes?.length && live.base?.snapshotId === newestId
  return groups
    .map((group) => {
      const first = group.snapshots[0]!
      const last = group.snapshots.at(-1)!
      const isLive = journalOpen && last.id === newestId
      // The journal's figures are counted from what Capture uploads: a
      // section its base left out counts 0 there, like the base's own.
      const endSummary: SnapshotSummary = isLive ? live!.figures! : last.summary
      const end = isLive ? Math.max(live!.updatedAt ?? 0, last.takenAt) : lastTime(last)
      /** From the first snapshot that shared the figure to the last (the journal's when it follows one). */
      const total = (key: SummaryKey) => {
        const shared = group.snapshots.filter((s) => sharesFigure(s.off, key))
        const from = shared[0]
        if (!from) return 0
        const to = shared.at(-1) === last ? endSummary : shared.at(-1)!.summary
        return to[key] - from.summary[key]
      }
      return {
        key: group.key,
        byDay: group.byDay,
        start: first.takenAt,
        end,
        snapshots: group.snapshots,
        totals: {
          mora: total('mora'),
          primogem: total('primogem'),
          artifacts: total('artifacts'),
          characters: total('characters'),
          weapons: total('weapons'),
        },
        stays: group.byDay ? [] : stays(group.snapshots, endSummary, last.off, end),
        live: isLive,
      }
    })
    .reverse()
}

/** The last moment a snapshot is known to hold: seen again later, or taken. */
function lastTime(snapshot: SnapshotResponse): number {
  return Math.max(snapshot.takenAt, snapshot.lastSeenAt)
}

/**
 * World stays: a new one at each full send of the game; other snapshots fall
 * within. `endOff`: the last snapshot's gi_off (the end's figures are its
 * own, or its journal's). A figure either end of a stay did not share counts 0.
 */
function stays(
  snapshots: readonly SnapshotResponse[],
  endSummary: SnapshotSummary,
  endOff: readonly string[] | undefined,
  end: number,
) {
  const starts = snapshots.filter((s, i) => i === 0 || STAY_REASONS.has(s.capture?.reason ?? ''))
  return starts.map((snapshot, i): Stay => {
    const next = starts[i + 1]
    const to = next ? next.summary : endSummary
    const toOff = next ? next.off : endOff
    const brought = (key: SummaryKey) =>
      sharesFigure(snapshot.off, key) && sharesFigure(toOff, key)
        ? to[key] - snapshot.summary[key]
        : 0
    return {
      world: snapshot.capture?.world ?? 1,
      start: snapshot.takenAt,
      end: next ? next.takenAt : end,
      mora: brought('mora'),
      primogem: brought('primogem'),
      artifacts: brought('artifacts'),
    }
  })
}

export interface CharacterChange {
  key: string
  field: 'level' | 'constellation' | 'auto' | 'skill' | 'burst' | 'new'
  from: number
  to: number
}

/** What moved on the roster between two captures: new characters, levels, constellations, talents. */
export function characterChanges(
  before: readonly GoodCharacter[],
  after: readonly GoodCharacter[],
): CharacterChange[] {
  const old = new Map(before.map((c) => [c.key, c]))
  const out: CharacterChange[] = []
  for (const now of after) {
    const was = old.get(now.key)
    if (!was) {
      out.push({ key: now.key, field: 'new', from: 0, to: now.level })
      continue
    }
    if (now.level !== was.level)
      out.push({ key: now.key, field: 'level', from: was.level, to: now.level })
    if (now.constellation !== was.constellation) {
      out.push({
        key: now.key,
        field: 'constellation',
        from: was.constellation,
        to: now.constellation,
      })
    }
    for (const talent of ['auto', 'skill', 'burst'] as const) {
      if (now.talent[talent] !== was.talent[talent]) {
        out.push({ key: now.key, field: talent, from: was.talent[talent], to: now.talent[talent] })
      }
    }
  }
  return out
}
