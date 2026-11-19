import { createDictionary, type MaterialsSection } from '@gdt/shared'
import { describe, expect, it } from 'vitest'
import { withMaterialFigures } from '@/components/progression/progression-series'
import { historyPeriods, historySeries } from '@/components/material-history/history-series'
import {
  buildMaterialsHistory,
  changeOver,
  chartFrame,
  firstShared,
  lastSharedIn,
  seriesPoints,
  sharedAt,
  valueAt,
  withHiddenKeys,
  withLiveMaterials,
  type MaterialsSnapshotRef,
} from '../materials-history'

const dictionary = createDictionary([])
const DAY = 86_400_000
const HOUR = 3_600_000

/**
 * One keyframe snapshot per entry of `bags` (raw-key refs), a day apart;
 * `offs`: the `gi_off` of the captures that had one, by position.
 */
function history(
  bags: Record<string, number>[],
  deltas: Record<number, Record<string, number>> = {},
  offs: Record<number, string[]> = {},
) {
  const texts = new Map<string, string>()
  const refs: MaterialsSnapshotRef[] = bags.map((bag, i) => {
    const keyframe = `k${i}`
    texts.set(keyframe, JSON.stringify({ m: Object.entries(bag) } satisfies MaterialsSection))
    const delta = deltas[i]
    let materials = keyframe
    if (delta) {
      materials = `d${i}`
      texts.set(
        materials,
        JSON.stringify({ b: keyframe, m: Object.entries(delta) } satisfies MaterialsSection),
      )
    }
    const at = i * DAY
    return {
      id: i + 1,
      takenAt: at,
      lastSeenAt: at,
      materials,
      materialsKeyframe: keyframe,
      ...(offs[i] ? { off: offs[i] } : {}),
    }
  })
  return buildMaterialsHistory(refs, texts, dictionary)
}

describe('materials history', () => {
  it('holds mora and primogems over a capture that missed them', () => {
    // The middle capture has the bag (Fates went up) but not the currency message.
    const h = history([
      { Mora: 500, Primogem: 1_600, IntertwinedFate: 4 },
      { IntertwinedFate: 5 },
      { Mora: 600, Primogem: 1_760, IntertwinedFate: 5 },
    ])
    const at = (key: string) => [0, 1, 2].map((i) => valueAt(h.series.get(key), i))
    expect(at('Mora')).toEqual([500, 500, 600])
    expect(at('Primogem')).toEqual([1_600, 1_600, 1_760])
    expect(at('IntertwinedFate')).toEqual([4, 5, 5])
    // No change point for the skipped capture.
    expect(h.series.get('Primogem')!.at).toEqual([0, 2])

    // So "Wishes saved" doesn't plunge either.
    const summary = {
      characters: 1,
      weapons: 1,
      artifacts: 1,
      materials: 1,
      mora: 1,
      primogem: 1,
      artifact3: 0,
      artifact4: 0,
    }
    const captures = withMaterialFigures(
      [0, 1, 2].map((i) => ({ at: i * DAY, summary, snapshot: i + 1 })),
      h,
    )
    expect(captures.map((c) => c.summary.wishes)).toEqual([14, 15, 16])
  })

  it('keeps the newest capture exactly as listed', () => {
    const h = history([{ Mora: 500, Primogem: 1_600 }, { HerosWit: 3 }])
    expect([...h.latest]).toEqual([['HerosWit', 3]])
    expect(valueAt(h.series.get('Mora'), 1)).toBe(500)
  })

  it('does the same through a delta that removes them', () => {
    const base = { Mora: 500, Primogem: 1_600, HerosWit: 1 }
    const h = history([base, base, base], { 1: { Mora: -1, Primogem: -1, HerosWit: 2 } })
    expect([0, 1, 2].map((i) => valueAt(h.series.get('Mora'), i))).toEqual([500, 500, 500])
    expect([0, 1, 2].map((i) => valueAt(h.series.get('HerosWit'), i))).toEqual([1, 2, 1])
  })

  it('still follows a real drop to zero of one of them', () => {
    const h = history([{ Mora: 500, Primogem: 160 }, { Mora: 400 }])
    expect(valueAt(h.series.get('Primogem'), 1)).toBe(0)
    expect(valueAt(h.series.get('Mora'), 1)).toBe(400)
  })

  it("takes a count the newest capture's switches cover out of now, not out of the past", () => {
    // Issue 12: Account numbers off covers Original Resin. An older capture
    // (and a Capture build that still sends it) left the count in the bag.
    const h = history([
      { Mora: 500, OriginalResin: 160 },
      { Mora: 600, OriginalResin: 200 },
    ])
    expect(withHiddenKeys(h, [])).toBe(h)
    const hidden = withHiddenKeys(h, ['OriginalResin', 'RealmCurrency'])
    expect(hidden.hidden).toEqual(['OriginalResin', 'RealmCurrency'])
    expect([...hidden.latest]).toEqual([['Mora', 600]])
    // The stored points stay (the charts), and the input is left alone.
    expect(hidden.series).toBe(h.series)
    expect(valueAt(hidden.series.get('OriginalResin'), 0)).toBe(160)
    expect(h.latest.get('OriginalResin')).toBe(200)
    expect(h.hidden).toBeUndefined()

    // The live journal's changes to it are not applied either; the rest are.
    const journal = (changes: [string, string[], unknown?][]) => ({
      open: true,
      base: { snapshotId: 2, takenAt: DAY },
      updatedAt: DAY + HOUR,
      changes,
    })
    const live = withLiveMaterials(
      hidden,
      journal([
        ['set', ['materials', 'OriginalResin'], 120],
        ['set', ['materials', 'Mora'], 700],
      ]),
    )
    expect([...live.latest]).toEqual([['Mora', 700]])
    expect(live.hidden).toEqual(['OriginalResin', 'RealmCurrency'])
    expect(live.series.get('OriginalResin')).toBe(h.series.get('OriginalResin'))
    // A journal of nothing else adds no point.
    expect(withLiveMaterials(hidden, journal([['del', ['materials', 'OriginalResin']]]))).toBe(
      hidden,
    )
    // While the count is shared the journal sets it as before.
    const shared = withLiveMaterials(h, journal([['set', ['materials', 'OriginalResin'], 120]]))
    expect(shared.latest.get('OriginalResin')).toBe(120)
  })

  it('keeps the captures that did not share the materials as times only', () => {
    const shared = history([{ Mora: 500 }, { Mora: 600 }])
    expect(shared).not.toHaveProperty('unshared')

    const texts = new Map([
      ['k0', JSON.stringify({ m: [['Mora', 500]] } satisfies MaterialsSection)],
      ['k1', JSON.stringify({ m: [['Mora', 600]] } satisfies MaterialsSection)],
    ])
    const ref = (id: number, takenAt: number, lastSeenAt: number): MaterialsSnapshotRef => ({
      id,
      takenAt,
      lastSeenAt,
      materials: `k${id - 1}`,
      materialsKeyframe: `k${id - 1}`,
    })
    const h = buildMaterialsHistory(
      [ref(1, 0, 2 * HOUR), ref(2, 3 * DAY, 3 * DAY)],
      texts,
      dictionary,
      // In any order; one was seen again later, which is a capture too.
      [
        { takenAt: 2 * DAY, lastSeenAt: 2 * DAY },
        { takenAt: DAY, lastSeenAt: DAY + HOUR },
      ],
    )
    // They hold no bag: the counts and their snapshots are the shared ones.
    expect(h.times).toEqual([0, 3 * DAY])
    expect(h.ids).toEqual([1, 2])
    expect([0, 1].map((i) => valueAt(h.series.get('Mora'), i))).toEqual([500, 600])
    expect(h.unshared).toEqual({
      at: [DAY, DAY + HOUR, 2 * DAY],
      seen: [2 * HOUR, 3 * DAY],
    })
  })
})

describe('a count a capture did not share (the bag copies)', () => {
  // Issue 12: Account numbers off covers Original Resin, Serenitea Pot off
  // Realm Currency. The capture shares the bag, but not that count.
  const NUMBERS = ['gi_player.numbers']
  const TEAPOT = ['gi_teapot']
  const counts = (h: ReturnType<typeof history>, key: string) =>
    h.times.map((_, i) => valueAt(h.series.get(key), i))

  it('is no point of its series: the last shared count stands, never 0', () => {
    const h = history(
      [
        { Mora: 500, OriginalResin: 160 },
        { Mora: 600 },
        { Mora: 650 },
        { Mora: 700, OriginalResin: 40 },
      ],
      {},
      { 1: NUMBERS, 2: NUMBERS },
    )
    const resin = h.series.get('OriginalResin')!
    expect(resin).toEqual({ at: [0, 3], value: [160, 40], off: [1, 2] })
    expect(counts(h, 'OriginalResin')).toEqual([160, 160, 160, 40])
    expect([0, 1, 2, 3].map((i) => sharedAt(resin, i))).toEqual([true, false, false, true])
    // Only that count: the rest of the bag was shared.
    expect(h.series.get('Mora')).toEqual({ at: [0, 1, 2, 3], value: [500, 600, 650, 700] })
    expect(h.latest.get('OriginalResin')).toBe(40)
    // The charts need each snapshot's last sighting to end a line before a break.
    expect(h.unshared).toEqual({ at: [], seen: [0, DAY, 2 * DAY, 3 * DAY] })
  })

  it("goes by each capture's own gi_off, not the newest one's", () => {
    // Off in the middle only; the newest capture shares the count again.
    const middle = history(
      [{ OriginalResin: 160 }, { Mora: 1 }, { OriginalResin: 160 }],
      {},
      { 0: [], 1: NUMBERS, 2: [] },
    )
    // Shared again with the count it had: no change point at all.
    expect(middle.series.get('OriginalResin')).toEqual({ at: [0], value: [160], off: [1] })
    // The same bags without a gi_off (stored before it existed): a real 0.
    const before = history([{ OriginalResin: 160 }, { Mora: 1 }, { OriginalResin: 160 }])
    expect(before.series.get('OriginalResin')).toEqual({ at: [0, 1, 2], value: [160, 0, 160] })
    expect(before).not.toHaveProperty('unshared')
    // A switch that covers no count of the bag, and one the tracker does not know.
    const other = history(
      [{ OriginalResin: 160 }, { Mora: 1 }],
      {},
      { 1: ['gi_achievements', 'gi_future'] },
    )
    expect(other.series.get('OriginalResin')).toEqual({ at: [0, 1], value: [160, 0] })
  })

  it('covers each count by its own switch', () => {
    const h = history(
      [{ OriginalResin: 160, RealmCurrency: 900 }, { OriginalResin: 120 }, { RealmCurrency: 950 }],
      {},
      { 1: TEAPOT, 2: NUMBERS },
    )
    expect(h.series.get('RealmCurrency')).toEqual({ at: [0, 2], value: [900, 950], off: [1] })
    expect(h.series.get('OriginalResin')).toEqual({ at: [0, 1], value: [160, 120], off: [2] })
    expect(counts(h, 'OriginalResin')).toEqual([160, 120, 120])
  })

  it('does the same through a delta that removes the count', () => {
    const base = { Mora: 500, OriginalResin: 160 }
    const h = history([base, base, base], { 1: { OriginalResin: -1 } }, { 1: NUMBERS })
    expect(h.series.get('OriginalResin')).toEqual({ at: [0], value: [160], off: [1] })
    expect(counts(h, 'OriginalResin')).toEqual([160, 160, 160])
  })

  it('reads the captures before the first that shared it as that one: no gain', () => {
    const h = history(
      [{ Mora: 500 }, { Mora: 600 }, { Mora: 700, OriginalResin: 120 }, { OriginalResin: 80 }],
      {},
      { 0: NUMBERS, 1: NUMBERS },
    )
    const resin = h.series.get('OriginalResin')!
    expect(resin).toEqual({ at: [2, 3], value: [120, 80], off: [0, 1] })
    expect(firstShared(resin)).toBe(2)
    expect(counts(h, 'OriginalResin')).toEqual([120, 120, 120, 80])
    // The range change compares the captures that shared it: 120 to 80.
    expect(changeOver(h, 'OriginalResin', chartFrame(h, -Infinity, 'raw'))).toBe(-40)
    // A key every capture shared still counts 0 before it first appears.
    expect(firstShared(h.series.get('Mora'))).toBe(0)
    expect(valueAt({ at: [2], value: [5] }, 1)).toBe(0)
  })

  it('follows the count once it is shared again, a real 0 included', () => {
    // Shared, not shared, then shared with the count gone from the bag.
    const h = history(
      [{ Mora: 1, RealmCurrency: 900 }, { Mora: 2 }, { Mora: 3 }, { Mora: 4, RealmCurrency: 30 }],
      {},
      { 1: TEAPOT },
    )
    expect(h.series.get('RealmCurrency')).toEqual({
      at: [0, 2, 3],
      value: [900, 0, 30],
      off: [1],
    })
  })

  it('gives a count no capture shared no series', () => {
    const h = history([{ Mora: 1 }, { Mora: 2 }, { Mora: 3 }], {}, { 0: TEAPOT, 1: TEAPOT })
    expect(h.series.has('RealmCurrency')).toBe(false)
    expect(h).not.toHaveProperty('unshared')
  })

  it('skips a count an upload stored although its gi_off covers it', () => {
    // An upload from before the import dropped these: the bag still holds it.
    const h = history(
      [{ OriginalResin: 160 }, { OriginalResin: 200 }, { OriginalResin: 200 }],
      {},
      { 1: NUMBERS },
    )
    // Not the covered capture's 200; the next one that shares it brings its own.
    expect(h.series.get('OriginalResin')).toEqual({ at: [0, 2], value: [160, 200], off: [1] })
    expect(counts(h, 'OriginalResin')).toEqual([160, 160, 200])
    const back = history(
      [{ OriginalResin: 160 }, { OriginalResin: 200 }, { OriginalResin: 160 }],
      {},
      { 1: NUMBERS },
    )
    expect(back.series.get('OriginalResin')).toEqual({ at: [0], value: [160], off: [1] })
  })

  it('finds the last capture of a stretch that shared it', () => {
    const series = { at: [0], value: [160], off: [1, 2, 4] }
    expect(lastSharedIn(series, 4)).toBe(3)
    expect(lastSharedIn(series, 2)).toBe(0)
    expect(lastSharedIn(series, 2, 0)).toBe(-1)
    expect(lastSharedIn(series, 3, 2)).toBe(3)
    expect(lastSharedIn({ at: [], value: [], off: [0, 1] }, 1)).toBe(-1)
    // Every capture shared it: the snapshot itself.
    expect(lastSharedIn({ at: [0], value: [1] }, 5, 2)).toBe(5)
    expect(lastSharedIn(undefined, 5)).toBe(5)
  })

  it('breaks the line of that count alone', () => {
    const h = history(
      [{ Mora: 500, OriginalResin: 160 }, { Mora: 600 }, { Mora: 700, OriginalResin: 40 }],
      {},
      { 1: NUMBERS },
    )
    const frame = chartFrame(h, -Infinity, 'raw')
    expect(frame).not.toHaveProperty('gaps')
    expect(seriesPoints(h, 'OriginalResin', frame)).toEqual([
      { x: 0, y: 160 },
      { x: DAY, y: null },
      { x: 2 * DAY, y: 40 },
    ])
    expect(seriesPoints(h, 'Mora', frame).map((p) => p.y)).toEqual([500, 600, 700])
  })

  it("keeps the break under live sync's point while the count is not shared now", () => {
    const h = withHiddenKeys(
      history([{ Mora: 500, OriginalResin: 160 }, { Mora: 600 }], {}, { 1: NUMBERS }),
      ['OriginalResin'],
    )
    const live = withLiveMaterials(h, {
      open: true,
      base: { snapshotId: 2, takenAt: DAY },
      updatedAt: DAY + HOUR,
      changes: [['set', ['materials', 'Mora'], 650]],
    })
    expect(live.series.get('OriginalResin')).toEqual({ at: [0], value: [160], off: [1, 2] })
    expect(live.series.get('Mora')).toEqual({ at: [0, 1, 2], value: [500, 600, 650] })
    // The input is left alone.
    expect(h.series.get('OriginalResin')!.off).toEqual([1])
    expect(seriesPoints(live, 'OriginalResin', chartFrame(live, -Infinity, 'raw'))).toEqual([
      { x: 0, y: 160 },
      { x: DAY, y: null },
      { x: DAY + HOUR, y: null },
    ])
    // A count shared now keeps its breaks, and the journal sets it as before.
    const shared = history(
      [{ OriginalResin: 160 }, { Mora: 1 }, { OriginalResin: 120 }],
      {},
      { 1: NUMBERS },
    )
    const now = withLiveMaterials(shared, {
      open: true,
      base: { snapshotId: 3, takenAt: 2 * DAY },
      updatedAt: 2 * DAY + HOUR,
      changes: [['set', ['materials', 'OriginalResin'], 100]],
    })
    expect(now.series.get('OriginalResin')).toEqual({
      at: [0, 2, 3],
      value: [160, 120, 100],
      off: [1],
    })
  })

  it('has no value in a period of the per-period history none of whose captures shared it', () => {
    const day = (d: number, hour = 12) => new Date(2026, 2, d, hour).getTime()
    const times = [day(1), day(2, 9), day(2, 15), day(3), day(5)]
    const h = {
      times,
      ids: [1, 2, 3, 4, 5],
      lastSeenAt: day(5),
      // Day 2: shared in the morning, not in the afternoon. Day 3: not shared
      // (day 4 has no capture and carries it). Day 5: shared again.
      series: new Map([['OriginalResin', { at: [0, 1, 4], value: [160, 120, 60], off: [2, 3] }]]),
      latest: new Map([['OriginalResin', 60]]),
    }
    const periods = historyPeriods(times, 'day', 10, day(5, 18))
    expect(periods.map((p) => p.index)).toEqual([0, 2, 3, 3, 4])
    const [resin, mora] = historySeries(h, ['OriginalResin', 'Mora'], periods)
    expect(resin!.points.map((p) => p.count)).toEqual([160, 120, null, null, 60])
    expect(mora!.points.map((p) => p.count)).toEqual([0, 0, 0, 0, 0])
  })
})
