import type { PartNotes, SnapshotResponse } from '@gdt/shared'
import { describe, expect, it } from 'vitest'
import { allPartsNote, noteRows, offSince, partNote, sectionNote } from '../not-shared'

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

describe('a build section not shared by Capture', () => {
  it('says since when, and which capture its page shows instead', () => {
    const list = snaps([40, ['characters']], [30, ['characters', 'weapons']], [20, []], [10])
    expect(sectionNote('characters', list, NONE)).toEqual({
      section: 'characters',
      since: 30,
      shownAt: 20,
    })
    // Shared by the newest capture: nothing to say, whatever older ones did.
    expect(sectionNote('weapons', list, NONE)).toBeNull()
    expect(sectionNote('materials', list, NONE)).toBeNull()
    // An older snapshot without gi_off (an older Capture, an import) shared it.
    expect(sectionNote('artifacts', snaps([40, ['artifacts']], [10]), NONE)).toMatchObject({
      since: 40,
      shownAt: 10,
    })
  })

  it('shows no capture when none ever shared it, and nothing without gi_off', () => {
    expect(sectionNote('materials', snaps([40, ['materials']], [30, ['materials']]), NONE)).toEqual(
      { section: 'materials', since: 30, shownAt: null },
    )
    expect(sectionNote('materials', snaps([40], [30, ['materials']]), NONE)).toBeNull()
    expect(sectionNote('materials', [], NONE)).toBeNull()
  })

  it('stays hidden by the owner until a new run starts', () => {
    const list = snaps([40, ['weapons']], [30, ['weapons']], [20, []])
    expect(sectionNote('weapons', list, { removed: {}, hidden: { weapons: 35 } })).toBeNull()
    const again = snaps([60, ['weapons']], [50, []], [40, ['weapons']])
    expect(sectionNote('weapons', again, { removed: {}, hidden: { weapons: 45 } })).toMatchObject({
      since: 60,
      shownAt: 50,
    })
    // Hiding another note does not hide this one.
    expect(sectionNote('weapons', list, { removed: {}, hidden: { all: 99 } })).not.toBeNull()
  })

  it('puts what was left out with the same capture in one row', () => {
    const list = snaps(
      [50, ['characters', 'weapons', 'materials']],
      [40, ['characters', 'materials']],
      [30, ['materials']],
      [20, []],
    )
    const sections = (['characters', 'weapons', 'artifacts', 'materials'] as const).flatMap(
      (section) => sectionNote(section, list, NONE) ?? [],
    )
    expect(noteRows(sections)).toEqual([
      { key: 'characters', subjects: ['characters'], since: 40, shownAt: 30 },
      { key: 'weapons', subjects: ['weapons'], since: 50, shownAt: 40 },
      { key: 'materials', subjects: ['materials'], since: 30, shownAt: 20 },
    ])
    const together = snaps([50, ['weapons', 'artifacts']], [40, []])
    expect(
      noteRows(
        (['weapons', 'artifacts'] as const).flatMap((s) => sectionNote(s, together, NONE) ?? []),
      ),
    ).toEqual([{ key: 'weapons', subjects: ['weapons', 'artifacts'], since: 50, shownAt: 40 }])
  })

  it("has no note for the characters' extras: Characters covers them", () => {
    // A build from before the switches were folded named `gi_characters` too.
    const list = snaps([50, ['characters', 'gi_characters']], [40, ['gi_characters']], [30, []])
    expect(noteRows([sectionNote('characters', list, NONE)!])).toEqual([
      { key: 'characters', subjects: ['characters'], since: 50, shownAt: 40 },
    ])
    // Overview lists the switches that exist; the retired name alone says nothing.
    expect(allPartsNote(list, NONE)).toEqual({ names: ['characters'], since: 50 })
    expect(allPartsNote(list.slice(1), NONE)).toBeNull()
  })
})
