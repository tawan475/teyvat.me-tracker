import type { Good, LiveJournalResponse } from '@gdt/shared'
import { itemFingerprint } from '@gdt/shared'
import { describe, expect, it } from 'vitest'
import { liveFiles, pointsCsv } from '@/data/live-export'

const artifact = {
  setKey: 'GoldenTroupe',
  slotKey: 'flower',
  level: 4,
  rarity: 5,
  mainStatKey: 'hp',
  location: '',
  lock: false,
  substats: [{ key: 'critRate_', value: 3.9 }],
  totalRolls: 4,
  astralMark: false,
  elixirCrafted: false,
  unactivatedSubstats: [],
}
const good: Good = {
  format: 'GOOD',
  version: 2,
  source: 'Irminsul',
  characters: [],
  artifacts: [artifact],
  weapons: [],
  materials: { Mora: 100 },
  gi_player: { uid: 812345678 },
}
const FIGURES = {
  characters: 0,
  weapons: 0,
  artifacts: 1,
  materials: 1,
  mora: 250,
  primogem: 0,
  artifact3: 0,
  artifact4: 0,
}
const live: LiveJournalResponse = {
  open: true,
  base: { snapshotId: 9, contentKey: 'abc', takenAt: 1_000 },
  session: 'SESSION-1234',
  seq: 4,
  updatedAt: Date.UTC(2026, 9, 15, 12),
  figures: FIGURES,
  changes: [
    ['set', ['materials', 'Mora'], 250],
    ['set', ['artifacts', 'g1', 'level'], 8],
  ],
  items: [['artifacts', 'g1', itemFingerprint('artifacts', artifact)]],
}

describe('live export files', () => {
  it('writes the journal, the points and the account as of now', () => {
    const points = [{ at: Date.UTC(2026, 9, 15, 11), figures: FIGURES }]
    const files = liveFiles(live, points, { id: 9, good })
    expect(files.map((f) => f.name)).toEqual([
      'live/journal.ndjson',
      'live/points.csv',
      'live/now.json',
    ])
    const line = JSON.parse(files[0]!.text)
    expect(line).toMatchObject({
      format: 'GOOD-X-delta',
      v: 1,
      uid: 812345678,
      seq: 4,
      base: 'abc',
    })
    const now = JSON.parse(files[2]!.text) as Good
    expect(now.materials.Mora).toBe(250)
    expect(now.artifacts[0]).toEqual({ ...artifact, level: 8 })
    expect(now.timestamp).toBe(live.updatedAt)
    expect(pointsCsv(points)).toBe(
      'time,characters,weapons,artifacts,materials,mora,primogem,artifact3,artifact4\n' +
        '2026-10-15T11:00:00.000Z,0,0,1,1,250,0,0,0\n',
    )
  })

  it('leaves out what there is nothing for', () => {
    expect(liveFiles({ open: false }, [], null)).toEqual([])
    // A journal on a snapshot that is not exported: no "now".
    expect(liveFiles(live, [], { id: 8, good }).map((f) => f.name)).toEqual(['live/journal.ndjson'])
  })
})
