import { createDictionary, type MaterialsSection } from '@gdt/shared'
import { describe, expect, it } from 'vitest'
import { withMaterialFigures } from '@/components/progression/progression-series'
import { buildMaterialsHistory, valueAt, type MaterialsSnapshotRef } from '../materials-history'

const dictionary = createDictionary([])
const DAY = 86_400_000

/** One keyframe snapshot per entry of `bags` (raw-key refs), a day apart. */
function history(
  bags: Record<string, number>[],
  deltas: Record<number, Record<string, number>> = {},
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
    return { id: i + 1, takenAt: at, lastSeenAt: at, materials, materialsKeyframe: keyframe }
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
})
