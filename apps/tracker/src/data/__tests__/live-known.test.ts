import type { LiveBatchPush, LiveJournalResponse, SnapshotSummary } from '@gdt/shared'
import { describe, expect, it } from 'vitest'
import { heldJournal, heldPoints, holdJournal, holdPoints, liveEventsSeen } from '@/data/live-known'
import { noteLiveChange, noteLiveMarks } from '@/live/journal'

const figures = (mora: number) => ({ mora }) as unknown as SnapshotSummary

function journal(seq: number): LiveJournalResponse {
  return {
    open: true,
    base: { snapshotId: 5, contentKey: 'k1', takenAt: 0 },
    session: 'S',
    seq,
    updatedAt: 0,
    figures: figures(0),
    changes: [],
    items: [],
    bytes: 0,
  }
}

function batch(prev: number, mora: number, at: number): LiveBatchPush {
  return {
    base: 'k1',
    prev,
    changes: [['set', ['materials', 'Mora'], mora]],
    items: [],
    figures: figures(mora),
    updatedAt: at,
    bytes: 10 * (prev + 1),
  }
}

const AT = Date.UTC(2026, 10, 6, 1)

describe('live-known', () => {
  it('applies a batch to the journal held, so the next read needs no request', () => {
    const id = 101
    holdJournal(id, 3, journal(0), liveEventsSeen(id))
    holdPoints(id, 3, [], liveEventsSeen(id))
    noteLiveChange(id, 1, batch(0, 7, AT))
    expect(heldJournal(id, 3)).toMatchObject({
      seq: 1,
      changes: [['set', ['materials', 'Mora'], 7]],
      updatedAt: AT,
      bytes: 10,
    })
    expect(heldPoints(id, 3)).toEqual([{ at: AT, figures: figures(7) }])
    // Another data version (a new snapshot) is not this journal.
    expect(heldJournal(id, 4)).toBeNull()
  })

  it('drops the journal on a gap, a bare event or another base', () => {
    const id = 102
    holdJournal(id, 1, journal(0), liveEventsSeen(id))
    noteLiveChange(id, 2, batch(1, 7, AT))
    expect(heldJournal(id, 1)).toBeNull()

    holdJournal(id, 1, journal(0), liveEventsSeen(id))
    noteLiveChange(id, 1)
    expect(heldJournal(id, 1)).toBeNull()

    holdJournal(id, 1, journal(0), liveEventsSeen(id))
    noteLiveChange(id, 1, { ...batch(0, 7, AT), base: 'other' })
    expect(heldJournal(id, 1)).toBeNull()
  })

  it('does not keep a read that started before an event', () => {
    const id = 103
    const since = liveEventsSeen(id)
    noteLiveChange(id, 1, batch(0, 7, AT))
    holdJournal(id, 1, journal(0), since)
    expect(heldJournal(id, 1)).toBeNull()
  })

  it('keeps a journal the hello shows unmoved, and re-reads one that moved', () => {
    const id = 104
    holdJournal(id, 1, journal(2), liveEventsSeen(id))
    const before = liveEventsSeen(id)
    noteLiveMarks([id], [{ id, base: 'k1', seq: 2 }])
    expect(liveEventsSeen(id)).toBe(before)
    expect(heldJournal(id, 1)).not.toBeNull()
    noteLiveMarks([id], [{ id, base: 'k1', seq: 3 }])
    expect(heldJournal(id, 1)).toBeNull()
  })
})
