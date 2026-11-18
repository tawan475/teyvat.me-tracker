/**
 * "Not shared by Capture" and "Removed from history" (issue 12, item 3):
 * what a page's strip says about a part, from the snapshot list (each
 * snapshot's `off`, Capture's `gi_off`) and the account's part notes
 * (settings `parts`: removed / hidden times). Pure.
 *
 * - Not shared: the newest snapshot's `off` names the part's switch. "Since"
 *   is the oldest snapshot of the run of newest ones that all name it.
 *   A newest snapshot without `off` (older Capture builds, website imports)
 *   says nothing: no strip.
 * - Removed from history: the owner removed it, and every snapshot uploaded
 *   since names it off (or none came): a later one without it may hold it again.
 * - Hidden: the owner's × hides a note until it says something new (a run
 *   that started after the hide, a removal after it).
 */

import {
  ALL_PARTS_NOTE,
  OFF_SWITCHES,
  PART_SWITCH,
  type OffSwitch,
  type PartNotes,
  type RemovablePart,
  type SnapshotResponse,
} from '@gdt/shared'

export interface PartNote {
  part: RemovablePart
  /** When Capture stopped sharing it (null: it shares it, or says nothing). */
  since: number | null
  /** When the owner removed it from history (null: not removed, or back since). */
  removedAt: number | null
}

/** The oldest snapshot of the newest run that names `name` off; null when the newest doesn't. */
export function offSince(
  snapshots: readonly Pick<SnapshotResponse, 'takenAt' | 'off'>[],
  name: string,
): number | null {
  let since: number | null = null
  for (const snapshot of snapshots) {
    if (!snapshot.off?.includes(name)) break
    since = snapshot.takenAt
  }
  return since
}

/** Whether every snapshot uploaded after `at` names `name` off. */
function offSinceRemoval(
  snapshots: readonly Pick<SnapshotResponse, 'createdAt' | 'off'>[],
  name: string,
  at: number,
): boolean {
  return snapshots.every((s) => s.createdAt <= at || s.off?.includes(name) === true)
}

/** A part's note (null: nothing to say, or hidden). Snapshots newest first. */
export function partNote(
  part: RemovablePart,
  snapshots: readonly SnapshotResponse[],
  notes: PartNotes | null,
): PartNote | null {
  const name = PART_SWITCH[part]
  const since = offSince(snapshots, name)
  const removed = notes?.removed[part] ?? null
  const removedAt = removed !== null && offSinceRemoval(snapshots, name, removed) ? removed : null
  if (since === null && removedAt === null) return null
  const hidden = notes?.hidden[part] ?? null
  // Hidden until something newer than the hide: a new run, or a removal.
  const news = Math.max(since ?? 0, removedAt ?? 0)
  if (hidden !== null && hidden >= news) return null
  return { part, since, removedAt }
}

export interface AllPartsNote {
  /** Capture's switches that are off, in its order (known names only). */
  names: OffSwitch[]
  /** The earliest of their runs' starts. */
  since: number
}

/** Overview's note: every part Capture left out of the newest capture. */
export function allPartsNote(
  snapshots: readonly SnapshotResponse[],
  notes: PartNotes | null,
): AllPartsNote | null {
  const newest = snapshots[0]
  if (!newest?.off) return null
  const names = newest.off.filter((name): name is OffSwitch =>
    (OFF_SWITCHES as readonly string[]).includes(name),
  )
  if (names.length === 0) return null
  const starts = names.map((name) => offSince(snapshots, name) ?? newest.takenAt)
  const hidden = notes?.hidden[ALL_PARTS_NOTE] ?? null
  if (hidden !== null && hidden >= Math.max(...starts)) return null
  return { names, since: Math.min(...starts) }
}
