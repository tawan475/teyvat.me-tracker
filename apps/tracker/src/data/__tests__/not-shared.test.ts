import type { PartNotes, SnapshotResponse } from '@gdt/shared'
import { describe, expect, it } from 'vitest'
import { allPartsNote, offSince, partNote } from '../not-shared'

const SUMMARY = {
  characters: 1,
  weapons: 1,
  artifacts: 1,
  materials: 1,
  mora: 1,
  primogem: 1,
  artifact3: 0,
  artifact4: 0,
}

/** Newest first, like the snapshot list. */
function snaps(...list: [takenAt: number, off?: string[]][]): SnapshotResponse[] {
  return list.map(([takenAt, off]) => ({
    id: takenAt,
    takenAt,
    lastSeenAt: takenAt,
    createdAt: takenAt,
    source: 'Teyvat.me',
    rawSize: 1,
    storedSize: 1,
    summary: SUMMARY,
    ...(off ? { off } : {}),
  }))
}

const NONE: PartNotes = { removed: {}, hidden: {} }

describe('not shared by Capture', () => {
  it('starts at the oldest of the newest run naming the switch', () => {
    const list = snaps([30, ['gi_achievements']], [20, ['gi_achievements']], [10, []], [5])
    expect(offSince(list, 'gi_achievements')).toBe(20)
    expect(offSince(list, 'gi_tasks')).toBeNull()
  })

  it('says nothing when the newest capture has no gi_off', () => {
    const list = snaps([30], [20, ['gi_achievements']])
    expect(partNote('achievements', list, NONE)).toBeNull()
    expect(allPartsNote(list, NONE)).toBeNull()
  })

  it('names the part, hidden by the owner until a new run starts', () => {
    const list = snaps([30, ['gi_achievements']], [20, ['gi_achievements']])
    expect(partNote('achievements', list, NONE)).toEqual({
      part: 'achievements',
      since: 20,
      removedAt: null,
    })
    expect(partNote('achievements', list, { removed: {}, hidden: { achievements: 25 } })).toBeNull()
    const again = snaps([50, ['gi_achievements']], [40, []], [30, ['gi_achievements']])
    expect(
      partNote('achievements', again, { removed: {}, hidden: { achievements: 35 } }),
    ).toMatchObject({ since: 50 })
  })

  it('says "removed from history" until a capture may hold the part again', () => {
    const notes: PartNotes = { removed: { achievements: 35 }, hidden: {} }
    const kept = snaps([40, ['gi_achievements']], [30, ['gi_achievements']])
    expect(partNote('achievements', kept, notes)).toEqual({
      part: 'achievements',
      since: 30,
      removedAt: 35,
    })
    const back = snaps([40, []], [30, ['gi_achievements']])
    expect(partNote('achievements', back, notes)).toBeNull()
    const noneSince = snaps([30])
    expect(partNote('achievements', noneSince, notes)).toEqual({
      part: 'achievements',
      since: null,
      removedAt: 35,
    })
  })

  it('lists every switch off on Overview, from the earliest run', () => {
    const list = snaps(
      [30, ['gi_player.profile', 'gi_achievements', 'gi_future']],
      [20, ['gi_achievements']],
    )
    expect(allPartsNote(list, NONE)).toEqual({
      names: ['gi_player.profile', 'gi_achievements'],
      since: 20,
    })
    expect(allPartsNote(list, { removed: {}, hidden: { all: 30 } })).toBeNull()
    expect(allPartsNote(list, { removed: {}, hidden: { all: 25 } })).not.toBeNull()
  })
})
