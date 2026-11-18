import type { SnapshotResponse, SnapshotSummary } from '@gdt/shared'
import { describe, expect, it } from 'vitest'
import { buildHistory, latestDelta, sharedSummary, withSharedFigures } from '../overview'
import { sharedSightings, sharedSources } from '../shared-sources'

// "Now" while Teyvat.me Capture leaves a build section out (gi_off, issue 12).

const summary = (characters: number, mora: number): SnapshotSummary => ({
  characters,
  weapons: 4,
  artifacts: 9,
  materials: mora > 0 ? 30 : 0,
  mora,
  primogem: mora > 0 ? 160 : 0,
  artifact3: 1,
  artifact4: 2,
})

/** Newest first, like the snapshot list. */
function snaps(...list: [id: number, s: SnapshotSummary, off?: string[]][]): SnapshotResponse[] {
  return list.map(([id, s, off]) => ({
    id,
    takenAt: id * 1000,
    lastSeenAt: id * 1000,
    createdAt: id * 1000,
    source: 'Teyvat.me',
    rawSize: 1,
    storedSize: 1,
    summary: s,
    ...(off ? { off } : {}),
  }))
}

describe('the newest capture that shared a section', () => {
  it('stands in for each section the newest one left out', () => {
    const list = snaps(
      [4, summary(0, 0), ['characters', 'materials', 'gi_tasks']],
      [3, summary(0, 500), ['characters']],
      [2, summary(12, 400), []],
      [1, summary(11, 300)],
    )
    expect(sharedSources(list, 4)).toEqual({ characters: 2, materials: 3 })
    expect(sharedSources(list, 2)).toBeNull()
    // None shared it: nothing to read.
    expect(sharedSources(snaps([1, summary(0, 0), ['weapons']]), 1)).toEqual({ weapons: null })
    // When each stand-in was last seen (0 where none shared): the Planner's edits count from it.
    expect(sharedSightings(list, { characters: 2, materials: 3, weapons: null })).toEqual({
      characters: 2_000,
      materials: 3_000,
      weapons: 0,
    })
  })

  it("gives the newest snapshot's figures, and its change, from the shared ones", () => {
    const list = snaps(
      [3, summary(0, 0), ['characters', 'materials']],
      [2, summary(12, 400), []],
      [1, summary(11, 300)],
    )
    expect(sharedSummary(list, 0)).toMatchObject({ characters: 12, mora: 400, weapons: 4 })
    expect(latestDelta(list)).toMatchObject({ characters: 0, mora: 0 })
    expect(withSharedFigures(summary(0, 0), ['characters'], summary(12, 400))).toMatchObject({
      characters: 12,
      mora: 0,
    })
  })

  it('holds the last shared figures on not-shared captures in the history', () => {
    const list = snaps(
      [4, summary(14, 700)],
      [3, summary(0, 0), ['characters', 'materials']],
      [2, summary(12, 400)],
    )
    const { captures } = buildHistory(list)
    expect(captures.map((c) => [c.summary.characters, c.summary.mora])).toEqual([
      [12, 400],
      [12, 400],
      [14, 700],
    ])
  })
})
