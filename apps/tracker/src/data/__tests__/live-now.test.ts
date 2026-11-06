import type { Good, LiveJournalResponse, SnapshotResponse } from '@gdt/shared'
import { itemFingerprint } from '@gdt/shared'
import { describe, expect, it } from 'vitest'
import { withJournal, type JournalTarget } from '@/data/live-now'
import { liveStrip } from '@/data/live-strip'

const artifact = (level: number, lock = false) => ({
  setKey: 'GoldenTroupe',
  slotKey: 'flower',
  level,
  rarity: 5,
  mainStatKey: 'hp',
  location: '',
  lock,
  substats: [{ key: 'critRate_', value: 3.9 }],
  totalRolls: 4,
  astralMark: false,
  elixirCrafted: false,
  unactivatedSubstats: [],
})

const good: Good = {
  format: 'GOOD',
  version: 2,
  source: 'Irminsul',
  characters: [
    {
      key: 'Furina',
      level: 80,
      constellation: 0,
      ascension: 5,
      talent: { auto: 1, skill: 1, burst: 1 },
    },
  ],
  artifacts: [artifact(0), artifact(4), artifact(8)],
  weapons: [],
  materials: { Mora: 100 },
}

const FIGURES = {
  characters: 1,
  weapons: 0,
  artifacts: 3,
  materials: 1,
  mora: 100,
  primogem: 0,
  artifact3: 0,
  artifact4: 0,
}

function journal(
  changes: LiveJournalResponse['changes'],
  items: LiveJournalResponse['items'] = [],
) {
  return {
    open: true,
    base: { snapshotId: 7, contentKey: 'k', takenAt: 1_000 },
    session: 'SESSION-1234',
    seq: 2,
    updatedAt: 5_000,
    figures: { ...FIGURES, mora: 250, artifacts: 4 },
    changes,
    items,
    bytes: 100,
  } satisfies LiveJournalResponse
}

describe('withJournal', () => {
  const inventory: JournalTarget = { good, artifactIds: [10, 11, 12] }

  it('applies the journal, keeping catalog ids of pieces whose identity held', () => {
    const fp4 = itemFingerprint('artifacts', artifact(4))
    const fp8 = itemFingerprint('artifacts', artifact(8))
    const now = withJournal(
      inventory,
      journal(
        [
          ['set', ['materials', 'Mora'], 250],
          ['set', ['characters', 'Furina', 'level'], 90],
          ['set', ['artifacts', 'g4', 'lock'], true],
          ['set', ['artifacts', 'g8', 'level'], 12],
          ['add', ['artifacts', 'g9'], artifact(0)],
        ],
        [
          ['artifacts', 'g4', fp4],
          ['artifacts', 'g8', fp8],
        ],
      ),
      7,
    )
    expect(now.good.materials.Mora).toBe(250)
    expect(now.good.characters[0]!.level).toBe(90)
    expect(now.good.artifacts.map((a) => [a.level, a.lock])).toEqual([
      [0, false],
      [4, true],
      [12, false],
      [0, false],
    ])
    // Lock only: same catalog piece. Levelled: a new identity. Added: none yet.
    expect(now.artifactIds).toEqual([10, 11, -1, -1])
    expect(now.live).toEqual({
      seq: 2,
      updatedAt: 5_000,
      changes: 5,
      materials: ['Mora'],
      player: [],
      tasks: [],
      wardrobe: [],
    })
  })

  it('ignores a journal on another snapshot, or an empty one', () => {
    expect(withJournal(inventory, journal([['set', ['materials', 'Mora'], 1]]), 8)).toBe(inventory)
    expect(withJournal(inventory, journal([]), 7)).toBe(inventory)
    expect(withJournal(inventory, { open: false }, 7)).toBe(inventory)
  })
})

describe('liveStrip', () => {
  const snapshot = (
    id: number,
    takenAt: number,
    session?: string,
    mora = 100,
  ): SnapshotResponse => ({
    id,
    takenAt,
    lastSeenAt: takenAt,
    createdAt: takenAt,
    source: 'Irminsul',
    rawSize: 1,
    storedSize: 1,
    summary: { ...FIGURES, mora },
    ...(session
      ? { capture: { v: 1, reason: 'world', session, world: 1, journal: { seq: 0 } } }
      : {}),
  })

  it('counts from the session’s first snapshot', () => {
    const list = [
      snapshot(7, 3_000, 'SESSION-1234', 150),
      snapshot(6, 2_000, 'SESSION-1234', 120),
      snapshot(5, 1_000, 'OTHER-SESSION', 50),
    ]
    const strip = liveStrip(
      journal([
        ['set', ['materials', 'Mora'], 250],
        ['set', ['characters', 'Furina', 'level'], 90],
        ['set', ['characters', 'Furina', 'talent', 'burst'], 2],
      ]),
      list,
    )
    expect(strip).toMatchObject({ mora: 130, artifacts: 1, levelUps: 1, talents: 1, since: 2_000 })
  })

  it('without a capture, counts from the newest snapshot; hides when nothing changed', () => {
    const list = [snapshot(7, 3_000, undefined, 150)]
    expect(liveStrip(journal([['set', ['materials', 'Mora'], 250]]), list)).toMatchObject({
      mora: 100,
      since: 3_000,
    })
    expect(liveStrip(journal([]), list)).toBeNull()
    expect(liveStrip(journal([['set', ['materials', 'Mora'], 1]]), [snapshot(8, 4_000)])).toBeNull()
  })
})
