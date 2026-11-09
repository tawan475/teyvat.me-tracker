import { describe, expect, it } from 'vitest'
import type { BundleSnapshot } from '@gdt/shared'
import { bundlePacks, mergeDecoded, PACK_SIZE } from '../bundle-packs'

const history = (count: number, from = 0) =>
  Array.from({ length: count }, (_, i) => ({
    id: 100 + from + i,
    takenAt: 1_000 * (from + i + 1),
    lastSeenAt: 1_000 * (from + i + 1),
  }))

describe('history packs', () => {
  it('cuts the history oldest first into packs of PACK_SIZE', () => {
    const list = history(PACK_SIZE * 2 + 5).reverse() // the snapshot list is newest first
    const packs = bundlePacks(list)
    expect(packs.map((p) => p.ids.length)).toEqual([PACK_SIZE, PACK_SIZE, 5])
    expect(packs[0]!.ids[0]).toBe(100)
    expect(packs.flatMap((p) => p.ids)).toEqual(history(PACK_SIZE * 2 + 5).map((s) => s.id))
  })

  it('changes only the last pack when a capture arrives', () => {
    const before = bundlePacks(history(PACK_SIZE * 3 + 10))
    const after = bundlePacks([...history(PACK_SIZE * 3 + 10), ...history(1, PACK_SIZE * 3 + 10)])
    expect(after.slice(0, 3).map((p) => p.key)).toEqual(before.slice(0, 3).map((p) => p.key))
    expect(after[3]!.key).not.toBe(before[3]!.key)
  })

  it('changes a pack when one of its snapshots is seen again or goes', () => {
    const list = history(PACK_SIZE + 3)
    const packs = bundlePacks(list)
    const seen = bundlePacks(
      list.map((s, i) => (i === 5 ? { ...s, lastSeenAt: s.lastSeenAt + 1 } : s)),
    )
    expect(seen[0]!.key).not.toBe(packs[0]!.key)
    expect(seen[1]!.key).toBe(packs[1]!.key)
    const gone = bundlePacks(list.filter((_, i) => i !== 5))
    // Everything after it moves down a place: both packs are new.
    expect(gone[0]!.key).not.toBe(packs[0]!.key)
    expect(gone[1]!.key).not.toBe(packs[1]!.key)
  })

  it('sorts snapshots taken at the same time by id, as the bundle does', () => {
    const packs = bundlePacks([
      { id: 9, takenAt: 5, lastSeenAt: 5 },
      { id: 3, takenAt: 5, lastSeenAt: 5 },
      { id: 4, takenAt: 1, lastSeenAt: 1 },
    ])
    expect(packs[0]!.ids).toEqual([4, 3, 9])
  })

  it('merges decoded packs into one bundle in order', () => {
    const snap = (id: number) => ({ id }) as unknown as BundleSnapshot
    const merged = mergeDecoded([
      { snapshots: [snap(1), snap(2)], texts: new Map([['a', '1']]) },
      {
        snapshots: [snap(3)],
        texts: new Map([
          ['b', '2'],
          ['a', '1'],
        ]),
      },
    ])
    expect(merged.snapshots.map((s) => s.id)).toEqual([1, 2, 3])
    expect([...merged.texts]).toEqual([
      ['a', '1'],
      ['b', '2'],
    ])
  })
})
