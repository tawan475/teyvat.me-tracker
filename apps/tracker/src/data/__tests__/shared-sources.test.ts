import type { SnapshotResponse, SnapshotSummary } from '@gdt/shared'
import { describe, expect, it } from 'vitest'
import {
  buildHistory,
  latestDelta,
  recentSnapshots,
  sharedDelta,
  sharedSummary,
  withPoints,
  withSharedFigures,
} from '../overview'
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
    // Not shared says nothing: no change, where the raw figures would say -12.
    expect(latestDelta(list)).toMatchObject({ characters: null, mora: null, weapons: 0 })
    expect(withSharedFigures(summary(0, 0), ['characters'], summary(12, 400))).toMatchObject({
      characters: 12,
      mora: 0,
    })
  })

  it('holds the last shared figures on not-shared captures in the history, and marks them', () => {
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
    // The charts break their line on the marked one; it counts no change.
    expect(captures.map((c) => c.unshared)).toEqual([
      undefined,
      ['characters', 'materials'],
      undefined,
    ])
  })

  it('never counts a not-shared capture as a loss, nor the next shared one as a gain', () => {
    const list = snaps(
      [5, summary(13, 450)],
      [4, summary(0, 0), ['characters', 'materials']],
      [3, summary(0, 500), ['characters']],
      [2, summary(12, 400), []],
      [1, summary(11, 300)],
    )
    // Not shared: no change at all (the raw figures would say -12 characters).
    expect(sharedDelta(list, 1)).toMatchObject({ characters: null, mora: null, weapons: 0 })
    expect(sharedDelta(list, 2)).toMatchObject({ characters: null, mora: 100 })
    // Shared again: against the newest older capture that shared it (never +13).
    expect(sharedDelta(list, 0)).toMatchObject({ characters: 1, mora: -50 })
    expect(sharedDelta(list, 4)).toBeNull()
    // Nothing older shared it: nothing to compare with.
    const fresh = snaps([2, summary(12, 400), []], [1, summary(0, 0), ['characters', 'materials']])
    expect(sharedDelta(fresh, 0)).toMatchObject({ characters: null, mora: null, weapons: 0 })

    const recent = recentSnapshots(list, 5)
    expect(recent[1]!.changes).toEqual([])
    // Left out on purpose is not a missed currency packet.
    expect(recent[1]!.currencyMissing).toBe(false)
    expect(recent[0]!.changes.map((c) => [c.key, c.value])).toEqual([
      ['mora', -50],
      ['characters', 1],
    ])
    expect(recent[2]!.changes.map((c) => [c.key, c.value])).toEqual([['mora', 100]])
  })

  it("treats live points after a not-shared capture as not shared too, never as their journal's 0", () => {
    const list = snaps([3000, summary(0, 500), ['characters']], [2000, summary(12, 400), []])
    const { captures } = buildHistory(list)
    // Capture counts the journal's sums from the stripped export: 0 characters.
    const merged = withPoints(captures, [
      { at: 2_500_000, figures: summary(12, 420) },
      { at: 4_000_000, figures: summary(0, 650) },
      { at: 5_000_000, figures: summary(0, 700) },
    ])
    expect(merged.map((c) => [c.at, c.summary.characters, c.summary.mora, c.unshared])).toEqual([
      [2_000_000, 12, 400, undefined],
      [2_500_000, 12, 420, undefined],
      [3_000_000, 12, 500, ['characters']],
      [4_000_000, 12, 650, ['characters']],
      [5_000_000, 12, 700, ['characters']],
    ])
    // With the materials left out, a point without currency is kept (it is not a missed packet).
    const bagOff = snaps([3000, summary(12, 0), ['materials']], [2000, summary(12, 400), []])
    const kept = withPoints(buildHistory(bagOff).captures, [
      { at: 4_000_000, figures: summary(13, 0) },
    ])
    expect(kept.at(-1)).toMatchObject({
      at: 4_000_000,
      summary: { characters: 13, mora: 400, primogem: 160 },
      unshared: ['materials'],
    })
  })

  it("finds a point's capture by the server's clock, not the capture's own", () => {
    // Capture's clock runs 10 minutes ahead: the snapshot that switched the
    // roster off is "taken" after the server stamps the next live point.
    const [off, on] = snaps([3000, summary(0, 500), ['characters']], [2000, summary(12, 400), []])
    const list = [{ ...off!, takenAt: 3_600_000, lastSeenAt: 3_600_000 }, on!]
    const merged = withPoints(buildHistory(list).captures, [
      { at: 3_100_000, figures: summary(0, 520) },
    ])
    expect(merged.map((c) => [c.at, c.summary.characters, c.unshared])).toEqual([
      [2_000_000, 12, undefined],
      // Never the journal's 0 on the capture before.
      [3_100_000, 12, ['characters']],
      [3_600_000, 12, ['characters']],
    ])
    // A file imported later with an older capture time is not the journal's base.
    const late = snaps([1000, summary(0, 300), ['characters']])[0]!
    const withLate = [on!, { ...late, createdAt: 2_500_000 }]
    expect(
      withPoints(buildHistory(withLate).captures, [
        { at: 2_800_000, figures: summary(13, 450) },
      ]).at(-1),
    ).toEqual({ at: 2_800_000, summary: summary(13, 450) })
  })
})
