/**
 * When Snapshots shows guest mode's backup note (docs/plans/open-site.md §4,
 * design E): once the history in this browser is worth something (about 10
 * imports, or two weeks of it), and not while "Not now" holds (30 days).
 * Pure; the page keeps the snooze per device (`guest:backup-note`).
 */

export const BACKUP_NOTE_SNAPSHOTS = 10
export const BACKUP_NOTE_AGE_MS = 14 * 86_400_000
export const BACKUP_NOTE_SNOOZE_MS = 30 * 86_400_000
export const BACKUP_NOTE_KEY = 'guest:backup-note'

export function showBackupNote(input: {
  /** Snapshots held. */
  count: number
  /** The oldest snapshot's capture time (null: none). */
  oldestAt: number | null
  now: number
  /** When "Not now" was last pressed (null: never). */
  snoozedAt: number | null
}): boolean {
  if (input.count === 0) return false
  if (input.snoozedAt !== null && input.now - input.snoozedAt < BACKUP_NOTE_SNOOZE_MS) return false
  if (input.count >= BACKUP_NOTE_SNAPSHOTS) return true
  return input.oldestAt !== null && input.now - input.oldestAt >= BACKUP_NOTE_AGE_MS
}
