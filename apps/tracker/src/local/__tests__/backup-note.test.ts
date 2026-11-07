import { describe, expect, it } from 'vitest'
import { BACKUP_NOTE_AGE_MS, BACKUP_NOTE_SNOOZE_MS, showBackupNote } from '../backup-note'

const now = Date.UTC(2026, 10, 8)
const note = (count: number, oldestAt: number | null, snoozedAt: number | null = null) =>
  showBackupNote({ count, oldestAt, now, snoozedAt })

describe('guest backup note', () => {
  it('shows once the history is worth something: ten snapshots or two weeks', () => {
    expect(note(0, null)).toBe(false)
    expect(note(9, now - 1000)).toBe(false)
    expect(note(10, now - 1000)).toBe(true)
    expect(note(2, now - BACKUP_NOTE_AGE_MS)).toBe(true)
    expect(note(2, now - BACKUP_NOTE_AGE_MS + 1)).toBe(false)
  })

  it('stays away for 30 days after Not now', () => {
    expect(note(50, now - BACKUP_NOTE_AGE_MS, now - 1000)).toBe(false)
    expect(note(50, now - BACKUP_NOTE_AGE_MS, now - BACKUP_NOTE_SNOOZE_MS)).toBe(true)
  })
})
