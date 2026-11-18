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
 * - A build section (characters, weapons, artifacts, materials) is never
 *   removable: its note only says since when it is not shared and which
 *   capture its page shows instead (the newest that shared it).
 */

import {
  ALL_PARTS_NOTE,
  OFF_SWITCHES,
  PART_SWITCH,
  sharesSection,
  type OffSection,
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

export interface SectionNote {
  section: OffSection
  /** When Capture stopped sharing it. */
  since: number
  /** When the capture its page shows was taken: the newest that shared it (null: none did). */
  shownAt: number | null
}

/**
 * A build section's note (null: the newest capture shared it or says
 * nothing, or the owner hid the note since). Snapshots newest first.
 */
export function sectionNote(
  section: OffSection,
  snapshots: readonly Pick<SnapshotResponse, 'takenAt' | 'off'>[],
  notes: PartNotes | null,
): SectionNote | null {
  const since = offSince(snapshots, section)
  if (since === null) return null
  const hidden = notes?.hidden[section] ?? null
  if (hidden !== null && hidden >= since) return null
  // An older snapshot without `off` (an older Capture, an import) shared it.
  const shown = snapshots.find((s) => sharesSection(s.off, section))
  return { section, since, shownAt: shown?.takenAt ?? null }
}

/** What one strip row says: one or more things Capture left out since the same day's capture. */
export interface NoteRow {
  /** The row's key: its first subject. */
  key: string
  /** What the × hides: every subject of the row. */
  subjects: (RemovablePart | OffSection)[]
  since: number
  /** The capture the page shows instead (null: none, or the page shows nothing of it). */
  shownAt: number | null
  /** Whether a subject can be removed from history (the row offers the dialog). */
  removable: boolean
}

/**
 * The rows of a page that shows builds: its sections' notes and its
 * not-shared parts' (`parts`, with the capture the page shows of each),
 * those that started with the same capture and show the same one as one row.
 */
export function noteRows(
  sections: readonly SectionNote[],
  parts: readonly { part: RemovablePart; since: number; shownAt: number | null }[],
): NoteRow[] {
  const rows: NoteRow[] = []
  const add = (subject: RemovablePart | OffSection, since: number, shownAt: number | null) => {
    let row = rows.find((r) => r.since === since && r.shownAt === shownAt)
    if (!row) {
      row = { key: subject, subjects: [], since, shownAt, removable: false }
      rows.push(row)
    }
    row.subjects.push(subject)
    return row
  }
  for (const note of sections) add(note.section, note.since, note.shownAt)
  for (const note of parts) add(note.part, note.since, note.shownAt).removable = true
  return rows
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
