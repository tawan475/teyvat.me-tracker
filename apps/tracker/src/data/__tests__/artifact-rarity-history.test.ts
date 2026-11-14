import {
  encodeArtifacts,
  encodeArtifactsDelta,
  prepareSnapshot,
  type BundleSnapshot,
  type GoodArtifact,
  type SnapshotSummary,
} from '@gdt/shared'
import { describe, expect, it } from 'vitest'
import { withArtifactFigures } from '@/components/progression/progression-series'
import type { Capture } from '@/data/overview'
import { buildArtifactRarityHistory } from '../artifact-rarity-history'

/** A piece of `rarity`; `n` keeps pieces of one rarity apart (each its own catalog row). */
const piece = (
  rarity: number,
  n: number,
  state: { location?: string; lock?: boolean } = {},
): GoodArtifact => ({
  setKey: 'Adventurer',
  slotKey: 'flower',
  level: 0,
  rarity,
  mainStatKey: 'hp',
  location: state.location ?? '',
  lock: state.lock ?? false,
  substats: [{ key: 'atk', value: n + 1 }],
})

const good = (artifacts: GoodArtifact[]) => ({
  format: 'GOOD',
  version: 3,
  source: 'Irminsul',
  characters: [
    {
      key: 'Furina',
      level: 90,
      constellation: 0,
      ascension: 6,
      talent: { auto: 1, skill: 1, burst: 1 },
    },
  ],
  artifacts,
  weapons: [],
  materials: { Mora: 1_000 },
})

// Counted by hand: unlocked and worn by nobody.
// 5★: three spare, one locked, one worn → 3.  4★: two spare, one locked → 2.
// 3★: four spare → 4.  2★: two spare, one worn → 2.  1★: five spare, one locked → 5.
const first = [
  piece(5, 0),
  piece(5, 1),
  piece(5, 2),
  piece(5, 3, { lock: true }),
  piece(5, 4, { location: 'Furina' }),
  piece(4, 0),
  piece(4, 1),
  piece(4, 2, { lock: true }),
  piece(3, 0),
  piece(3, 1),
  piece(3, 2),
  piece(3, 3),
  piece(2, 0),
  piece(2, 1),
  piece(2, 2, { location: 'Furina' }),
  piece(1, 0),
  piece(1, 1),
  piece(1, 2),
  piece(1, 3),
  piece(1, 4),
  piece(1, 5, { lock: true }),
]
// Later: a 5★ locked, a 2★ fed away, two 1★ fed away, a 3★ locked.
const second = first
  .filter((a) => !(a.rarity === 2 && a.substats[0]!.value === 1))
  .filter((a) => !(a.rarity === 1 && a.substats[0]!.value <= 2))
  .map((a) =>
    (a.rarity === 5 && a.substats[0]!.value === 1) || (a.rarity === 3 && a.substats[0]!.value === 1)
      ? { ...a, lock: true }
      : a,
  )

/** The snapshot's stored artifacts section and summary, over one shared catalog. */
async function stored(
  artifacts: GoodArtifact[],
  ids: Map<string, number>,
  rarity: Map<number, number>,
) {
  const prepared = await prepareSnapshot(good(artifacts))
  const refs = prepared.good.artifacts.map(({ identity, state }, i) => {
    const hash = prepared.artifactHashes[i]!
    let id = ids.get(hash)
    if (id === undefined) ids.set(hash, (id = ids.size + 1))
    rarity.set(id, identity.rarity)
    return { id, state }
  })
  return { section: encodeArtifacts(refs), summary: prepared.summary }
}

const snapshot = (id: number, artifacts: string, artifactsBase: string | null) =>
  ({ id, takenAt: id * 1_000, artifacts, artifactsBase }) as unknown as BundleSnapshot

describe('artifact rarity counts', () => {
  it('counts every rarity from the stored rows, as the summary counts 3★ / 4★', async () => {
    const ids = new Map<string, number>()
    const rarity = new Map<number, number>()
    const a = await stored(first, ids, rarity)
    const b = await stored(second, ids, rarity)
    const delta = encodeArtifactsDelta(b.section, a.section, 'h1')
    const texts = new Map([
      ['h1', JSON.stringify(a.section)],
      ['h2', JSON.stringify(delta)],
    ])
    const history = await buildArtifactRarityHistory(
      [snapshot(1, 'h1', null), snapshot(2, 'h2', 'h1'), snapshot(3, 'missing', null)],
      texts,
      (id) => rarity.get(id),
    )

    // [1★, 2★, 3★, 4★, 5★]
    expect(history.counts.get(1)).toEqual([5, 2, 4, 2, 3])
    expect(history.counts.get(2)).toEqual([3, 1, 3, 2, 2])
    expect(history.counts.has(3)).toBe(false)
    // The summary's own 3★ / 4★ counts agree.
    for (const [id, { summary }] of [
      [1, a],
      [2, b],
    ] as const) {
      expect(history.counts.get(id)![2]).toBe(summary.artifact3)
      expect(history.counts.get(id)![3]).toBe(summary.artifact4)
    }

    // On the card: each capture reads its snapshot; a live point and a
    // snapshot without rows carry the capture before.
    const s = { mora: 1, primogem: 1 } as SnapshotSummary
    const captures: Capture[] = [
      { at: 1, summary: s, snapshot: 1 },
      { at: 2, summary: s },
      { at: 3, summary: s, snapshot: 2 },
      { at: 4, summary: s, snapshot: 3 },
    ]
    expect(
      withArtifactFigures(captures, history).map(({ summary: f }) => [
        f.artifact5,
        f.artifact2,
        f.artifact1,
      ]),
    ).toEqual([
      [3, 2, 5],
      [3, 2, 5],
      [2, 1, 3],
      [2, 1, 3],
    ])
  })
})
