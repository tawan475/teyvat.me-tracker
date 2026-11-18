import type { CaptureReason, LiveJournalResponse, SnapshotResponse } from '@gdt/shared'
import { describe, expect, it } from 'vitest'
import { withPoints } from '@/data/overview'
import { buildSessions, characterChanges } from '@/data/sessions'

const FIGURES = {
  characters: 90,
  weapons: 300,
  artifacts: 1800,
  materials: 1400,
  mora: 1_000_000,
  primogem: 16_000,
  artifact3: 10,
  artifact4: 30,
}
const MIN = 60_000

function snapshot(
  id: number,
  at: number,
  capture?: { reason: CaptureReason; session: string; world: number },
  mora = FIGURES.mora,
  artifacts = FIGURES.artifacts,
): SnapshotResponse {
  return {
    id,
    takenAt: at,
    lastSeenAt: at,
    createdAt: at,
    source: 'Irminsul',
    rawSize: 1,
    storedSize: 1,
    summary: { ...FIGURES, mora, artifacts },
    ...(capture ? { capture: { v: 1, ...capture, journal: { seq: 0 } } } : {}),
  }
}

/** A Mora run: login, two co-op worlds, home again (by order), then a logout snapshot. */
const T0 = new Date(2026, 9, 15, 19, 0).getTime()
const run = [
  snapshot(5, T0 + 250 * MIN, { reason: 'logout', session: 'S2', world: 4 }, 1_041_000, 1810),
  snapshot(4, T0 + 150 * MIN, { reason: 'world', session: 'S2', world: 4 }, 1_031_300, 1808),
  snapshot(3, T0 + 125 * MIN, { reason: 'world', session: 'S2', world: 3 }, 1_021_200, 1806),
  snapshot(2, T0 + 100 * MIN, { reason: 'world', session: 'S2', world: 2 }, 1_010_200, 1803),
  snapshot(1, T0, { reason: 'login', session: 'S2', world: 1 }, 1_000_000, 1800),
  snapshot(0, T0 - 24 * 60 * MIN),
]

describe('buildSessions', () => {
  it('groups by session, one stay per full send, newest session first', () => {
    const [session, older] = buildSessions(run)
    expect(session).toMatchObject({
      key: 'S2',
      byDay: false,
      start: T0,
      end: T0 + 250 * MIN,
      live: false,
      totals: { mora: 41_000, artifacts: 10 },
    })
    expect(session!.stays.map((s) => [s.world, s.mora, s.artifacts])).toEqual([
      [1, 10_200, 3],
      [2, 11_000, 3],
      [3, 10_100, 2],
      // The logout snapshot falls inside the last stay.
      [4, 9_700, 2],
    ])
    expect(older).toMatchObject({ byDay: true, stays: [] })
  })

  it('the open journal ends the newest session', () => {
    const live: LiveJournalResponse = {
      open: true,
      base: { snapshotId: 5, contentKey: 'k', takenAt: T0 + 250 * MIN },
      seq: 3,
      updatedAt: T0 + 260 * MIN,
      figures: { ...FIGURES, mora: 1_100_000, artifacts: 1812 },
      changes: [['set', ['materials', 'Mora'], 1_100_000]],
    }
    const [session] = buildSessions(run, live)
    expect(session).toMatchObject({ live: true, end: T0 + 260 * MIN, totals: { mora: 100_000 } })
    expect(session!.stays.at(-1)).toMatchObject({ mora: 68_700, end: T0 + 260 * MIN })
    // A journal on another snapshot is not this session's.
    expect(buildSessions(run, { ...live, base: { ...live.base!, snapshotId: 4 } })[0]!.live).toBe(
      false,
    )
  })

  it('counts no change for a figure a snapshot did not share (a switch went off mid-session)', () => {
    const off = (s: SnapshotResponse, names: string[], zero: Partial<typeof FIGURES>) => ({
      ...s,
      off: names,
      summary: { ...s.summary, ...zero },
    })
    // The switch went off after the second world: the snapshots after it have no roster.
    const list = [
      off(run[0]!, ['characters'], { characters: 0 }),
      off(run[1]!, ['characters'], { characters: 0 }),
      { ...run[2]!, summary: { ...run[2]!.summary, characters: 91 } },
      ...run.slice(3),
    ]
    const [session] = buildSessions(list)
    // From the first snapshot that shared it to the last: +1, never -90.
    expect(session!.totals).toMatchObject({ characters: 1, mora: 41_000, artifacts: 10 })
    // A journal on a base that left the bag out counts it as 0: no change either.
    const bagOff = [
      off(run[0]!, ['materials'], { mora: 0, primogem: 0, materials: 0 }),
      ...run.slice(1),
    ]
    const live: LiveJournalResponse = {
      open: true,
      base: { snapshotId: 5, contentKey: 'k', takenAt: T0 + 250 * MIN },
      seq: 3,
      updatedAt: T0 + 260 * MIN,
      figures: { ...FIGURES, mora: 0, primogem: 0, materials: 0, artifacts: 1815 },
      changes: [['set', ['gi_tasks', 'welkin'], { days: 3 }]],
    }
    const [open] = buildSessions(bagOff, live)
    expect(open!.totals).toMatchObject({ mora: 31_300, artifacts: 15 })
    expect(open!.stays.map((s) => s.mora)).toEqual([10_200, 11_000, 10_100, 0])
    expect(open!.stays.at(-1)).toMatchObject({ artifacts: 7 })
  })
})

describe('characterChanges', () => {
  it('lists new characters, levels, constellations and talents', () => {
    const talent = { auto: 1, skill: 8, burst: 8 }
    expect(
      characterChanges(
        [{ key: 'Furina', level: 80, constellation: 0, ascension: 5, talent }],
        [
          {
            key: 'Furina',
            level: 90,
            constellation: 1,
            ascension: 6,
            talent: { ...talent, burst: 9 },
          },
          { key: 'Nahida', level: 1, constellation: 0, ascension: 0, talent },
        ],
      ),
    ).toEqual([
      { key: 'Furina', field: 'level', from: 80, to: 90 },
      { key: 'Furina', field: 'constellation', from: 0, to: 1 },
      { key: 'Furina', field: 'burst', from: 8, to: 9 },
      { key: 'Nahida', field: 'new', from: 0, to: 1 },
    ])
  })
})

describe('withPoints', () => {
  it('merges points between captures, dropping those within a minute of one', () => {
    const captures = [
      { at: 0, summary: FIGURES },
      { at: 60 * MIN, summary: { ...FIGURES, mora: 2 } },
    ]
    const merged = withPoints(captures, [
      { at: 30 * MIN, figures: { ...FIGURES, mora: 1 } },
      { at: 60 * MIN - 30_000, figures: { ...FIGURES, mora: 9 } },
      { at: 90 * MIN, figures: { ...FIGURES, mora: 3 } },
      { at: 95 * MIN, figures: { ...FIGURES, mora: 0, primogem: 0 } },
    ])
    expect(merged.map((c) => [c.at / MIN, c.summary.mora])).toEqual([
      [0, FIGURES.mora],
      [30, 1],
      [60, 2],
      [90, 3],
    ])
  })
})
