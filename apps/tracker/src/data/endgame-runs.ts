import type { GiEndgame, GiStygianRecord, GiTheaterRun } from '@gdt/shared'

/**
 * What the captures say about the account's endgame runs (`gi_endgame`,
 * Teyvat.me Capture 1.17.12), for the Endgame page: the Theater's state per
 * season and the Stygian records per season. Each capture's theater part is
 * one season's state (the season running at that login), so the history is
 * put together across the account's snapshots: the newest capture of each
 * season wins. The Stygian list is already per season; a season's records
 * come from the newest capture that lists it. Pure: the loader is
 * data/endgame-capture.ts (it reads the `extras` section of every snapshot).
 */

export interface CapturedTheater {
  run: GiTheaterRun
  /** When the capture it comes from was taken (ms). */
  takenAt: number
}

export interface CapturedStygian {
  /** This season's records, in the order sent (solo and co-op). */
  records: GiStygianRecord[]
  takenAt: number
}

export interface CapturedEndgame {
  /** By RoleCombatSchedule id. */
  theater: ReadonlyMap<number, CapturedTheater>
  /** By LeyLineChallenge schedule id. */
  stygian: ReadonlyMap<number, CapturedStygian>
  /** When the newest capture with any endgame data was taken; null without one. */
  takenAt: number | null
}

export const NO_CAPTURED_ENDGAME: CapturedEndgame = {
  theater: new Map(),
  stygian: new Map(),
  takenAt: null,
}

/** One snapshot's endgame key, if its capture had one (any order). */
export interface EndgameSnapshot {
  takenAt: number
  endgame: GiEndgame | null | undefined
}

export function capturedEndgame(snapshots: readonly EndgameSnapshot[]): CapturedEndgame {
  const theater = new Map<number, CapturedTheater>()
  const stygian = new Map<number, CapturedStygian>()
  let takenAt: number | null = null
  // Oldest first, so a later capture replaces an earlier one's season.
  for (const s of [...snapshots].sort((a, b) => a.takenAt - b.takenAt)) {
    const e = s.endgame
    if (!e) continue
    takenAt = s.takenAt
    if (e.theater) theater.set(e.theater.season, { run: e.theater, takenAt: s.takenAt })
    if (e.stygian) {
      const bySeason = new Map<number, GiStygianRecord[]>()
      for (const r of e.stygian.records) {
        let list = bySeason.get(r.season)
        if (!list) bySeason.set(r.season, (list = []))
        list.push(r)
      }
      for (const [season, records] of bySeason) {
        stygian.set(season, { records, takenAt: s.takenAt })
      }
    }
  }
  return takenAt === null ? NO_CAPTURED_ENDGAME : { theater, stygian, takenAt }
}

/** A fight's seconds as the game's timer shows them: "0:51", "12:03". */
export function formatFightTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s < 10 ? '0' : ''}${s}`
}

/** The record's time over its fights when every one is done; null while one isn't (no total yet). */
export function recordTotal(record: GiStygianRecord): number | null {
  if (record.fights.length === 0 || record.fights.some((f) => !f.done)) return null
  return record.fights.reduce((sum, f) => sum + f.time, 0)
}

/** How many of a record's fights are done. */
export const fightsDone = (record: GiStygianRecord) => record.fights.filter((f) => f.done).length
