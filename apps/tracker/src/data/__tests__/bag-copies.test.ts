import type { DeltaChange, LiveJournalResponse } from '@gdt/shared'
import { describe, expect, it } from 'vitest'
import { bagJournal, hiddenBagKeys, withoutBagKeys } from '../bag-copies'

// The bag copies (issue 12): Original Resin is covered by Capture's Account
// numbers switch, Realm Currency by its Serenitea Pot switch. While the
// newest capture has the switch off, no page shows the count as current.

const NUMBERS = 'gi_player.numbers'
const TEAPOT = 'gi_teapot'

/** The snapshot list as it comes: newest first. */
const list = [
  { id: 4, off: [NUMBERS, 'gi_tasks'] },
  { id: 3, off: [TEAPOT] },
  { id: 2, off: [] },
  { id: 1 },
]

describe('the keys a capture does not share', () => {
  it("are those its own switches cover, the newest capture's without an id", () => {
    expect(hiddenBagKeys(list)).toEqual(['OriginalResin'])
    expect(hiddenBagKeys(list, 4)).toEqual(['OriginalResin'])
    expect(hiddenBagKeys(list, 3)).toEqual(['RealmCurrency'])
    expect(hiddenBagKeys([{ id: 9, off: [TEAPOT, NUMBERS] }])).toEqual([
      'OriginalResin',
      'RealmCurrency',
    ])
  })

  it('are none for a capture that shares the part, has no gi_off, or is not listed', () => {
    expect(hiddenBagKeys(list, 2)).toEqual([])
    expect(hiddenBagKeys(list, 1)).toEqual([])
    expect(hiddenBagKeys(list, 77)).toEqual([])
    expect(hiddenBagKeys([])).toEqual([])
    // Other parts off, the builds too: the two counts stay.
    expect(
      hiddenBagKeys([{ id: 1, off: ['materials', 'gi_player.profile', 'gi_future'] }]),
    ).toEqual([])
  })

  it('are also those the capture its bag is read from left out (the Materials off)', () => {
    // 2026-11-20: with the Materials off the bag shown is the newest older
    // capture's that shared them. Taken with Account numbers off, it holds no
    // Original Resin: the count is not shared now, never a 0.
    const older = [
      { id: 6, off: ['materials'] },
      { id: 5, off: ['materials', TEAPOT] },
      { id: 4, off: [NUMBERS] },
      { id: 3, off: [TEAPOT] },
      { id: 2 },
      { id: 1, off: [NUMBERS] },
    ]
    expect(hiddenBagKeys(older)).toEqual(['OriginalResin'])
    expect(hiddenBagKeys(older, 6)).toEqual(['OriginalResin'])
    // Its own switches and the bag capture's.
    expect(hiddenBagKeys(older, 5)).toEqual(['OriginalResin', 'RealmCurrency'])
    // A capture that shares its Materials goes by its own switches alone.
    expect(hiddenBagKeys(older, 4)).toEqual(['OriginalResin'])
    expect(hiddenBagKeys(older, 3)).toEqual(['RealmCurrency'])
    // The bag is read from a capture stored before gi_off: it shared everything.
    const before = [{ id: 3, off: ['materials'] }, { id: 2 }, { id: 1, off: [NUMBERS] }]
    expect(hiddenBagKeys(before)).toEqual([])
    // No capture shared the Materials: no bag to read a count from.
    const none = [
      { id: 2, off: ['materials'] },
      { id: 1, off: ['materials', NUMBERS] },
    ]
    expect(hiddenBagKeys(none)).toEqual([])
  })

  it('leave the bag without copying one that holds none of them', () => {
    const bag = { Mora: 5, OriginalResin: 160, RealmCurrency: 900 }
    expect(withoutBagKeys(bag, ['OriginalResin'])).toEqual({ Mora: 5, RealmCurrency: 900 })
    expect(withoutBagKeys(bag, ['OriginalResin', 'RealmCurrency'])).toEqual({ Mora: 5 })
    // The input is left alone.
    expect(bag).toEqual({ Mora: 5, OriginalResin: 160, RealmCurrency: 900 })
    expect(withoutBagKeys(bag, [])).toBe(bag)
    const plain = { Mora: 5 }
    expect(withoutBagKeys(plain, ['OriginalResin', 'RealmCurrency'])).toBe(plain)
  })
})

describe('the live journal over a capture that left a count out', () => {
  const changes: DeltaChange[] = [
    ['set', ['materials', 'Mora'], 7],
    ['set', ['materials', 'OriginalResin'], 120],
    ['set', ['materials', 'RealmCurrency'], 950],
    ['set', ['gi_tasks', 'realm'], { value: 950, limit: 2400 }],
  ]
  const journal = (snapshotId: number): LiveJournalResponse => ({
    open: true,
    base: { snapshotId, contentKey: 'abc', takenAt: 1_000 },
    seq: 3,
    changes,
  })

  it("drops the changes to it, by the base snapshot's switches", () => {
    expect(bagJournal(journal(4), list).changes).toEqual([changes[0], changes[2], changes[3]])
    expect(bagJournal(journal(3), list).changes).toEqual([changes[0], changes[1], changes[3]])
    // The rest of the journal is as it was.
    expect(bagJournal(journal(4), list)).toMatchObject({ open: true, seq: 3 })
  })

  it('drops them too when the base snapshot reads its bag from a capture that left it out', () => {
    const older = [
      { id: 9, off: ['materials'] },
      { id: 8, off: [NUMBERS] },
    ]
    expect(bagJournal(journal(9), older).changes).toEqual([changes[0], changes[2], changes[3]])
  })

  it('is the same journal when there is nothing to drop', () => {
    for (const id of [2, 1, 77]) {
      const live = journal(id)
      expect(bagJournal(live, list)).toBe(live)
    }
    const closed: LiveJournalResponse = { open: false }
    expect(bagJournal(closed, list)).toBe(closed)
    const quiet: LiveJournalResponse = { ...journal(4), changes: [changes[0]!] }
    expect(bagJournal(quiet, list)).toBe(quiet)
  })
})
