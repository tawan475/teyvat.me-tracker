import { describe, expect, it } from 'vitest'
import {
  BlobDecoder,
  OFF_SWITCHES,
  PART_SWITCH,
  REMOVABLE_PARTS,
  decodeSectionBlob,
  decodeSnapshotMeta,
  encodeSectionBlob,
  encodeSectionBlobVariants,
  encodeSnapshotMeta,
  holdsPartKeys,
  isPartChange,
  kindCode,
  lastRemoval,
  normalizeGood,
  partNeighbours,
  partOfSwitch,
  planPartRemoval,
  readOff,
  sameOff,
  sectionHashOf,
  shortHashHex,
  withoutPartChanges,
  withoutPartKeys,
  type DeltaChange,
  type PartBlobRow,
  type PartSnapshotRow,
} from '../src'

// Capture's gi_off and the parts a user can remove (issue 12, item 3).

const SUMMARY = {
  characters: 2,
  weapons: 3,
  artifacts: 4,
  materials: 5,
  mora: 6,
  primogem: 7,
  artifact3: 0,
  artifact4: 1,
}
const META = {
  format: 'GOOD',
  version: 2,
  source: 'Irminsul',
  summary: SUMMARY,
  playerVars: { resin: 160 },
}
const CAPTURE = {
  v: 1 as const,
  reason: 'login' as const,
  session: '01J9ZK5Q8W3E7R2T',
  world: 1,
  journal: { seq: 0 },
}

describe('gi_off', () => {
  it('keeps valid names once, unknown ones too, and nothing that is not a list', () => {
    expect(readOff(['gi_achievements', 'gi_achievements', 'gi_future', 3, 'two words'])).toEqual([
      'gi_achievements',
      'gi_future',
    ])
    expect(readOff([])).toEqual([])
    expect(readOff('gi_achievements')).toBeNull()
    expect(readOff(undefined)).toBeNull()
    expect(readOff(Array.from({ length: 50 }, (_, i) => `x${i}`))).toHaveLength(32)
  })

  it('is read from an upload, absent when the file has none', () => {
    const file = { format: 'GOOD', version: 2, source: 'Teyvat.me', characters: [] }
    expect(normalizeGood({ ...file, gi_off: ['gi_tasks'] }).off).toEqual(['gi_tasks'])
    expect(normalizeGood(file).off).toBeUndefined()
  })

  it('lets a capture leave the characters out on purpose', () => {
    const file = {
      format: 'GOOD',
      version: 2,
      source: 'Teyvat.me',
      characters: [],
      materials: { Mora: 10 },
    }
    expect(() => normalizeGood(file)).toThrow(/no characters/)
    expect(normalizeGood({ ...file, gi_off: ['characters'] }).materials.get('Mora')).toBe(10)
  })

  it('is stored in meta format 3, with or without a capture, and old formats read as before', () => {
    const plain = encodeSnapshotMeta(META)
    expect(plain[0]).toBe(1)
    expect(decodeSnapshotMeta(plain)).toEqual(META)
    const withCapture = encodeSnapshotMeta({ ...META, capture: CAPTURE })
    expect(withCapture[0]).toBe(2)

    const off = ['gi_achievements', 'gi_player.profile', 'gi_future']
    const three = encodeSnapshotMeta({ ...META, off })
    expect(three[0]).toBe(3)
    expect(decodeSnapshotMeta(three)).toEqual({ ...META, off })
    const both = encodeSnapshotMeta({ ...META, capture: CAPTURE, off: [] })
    expect(both[0]).toBe(3)
    expect(decodeSnapshotMeta(both)).toEqual({ ...META, capture: CAPTURE, off: [] })
    // A known name costs one byte.
    expect(encodeSnapshotMeta({ ...META, off: ['gi_tasks'] }).length).toBe(plain.length + 3)
  })

  it('names every removable part by a switch, and never the builds', () => {
    for (const part of REMOVABLE_PARTS) {
      expect(OFF_SWITCHES).toContain(PART_SWITCH[part])
      expect(partOfSwitch(PART_SWITCH[part])).toBe(part)
    }
    for (const name of ['characters', 'weapons', 'artifacts', 'materials', 'gi_player.numbers']) {
      expect(partOfSwitch(name)).toBeNull()
    }
  })
})

describe('removable parts', () => {
  it('know their neighbours in a shared section', () => {
    expect(partNeighbours('achievements')).toEqual(['events'])
    expect(partNeighbours('endgame')).toEqual(['teapot', 'miliastra'])
    expect(partNeighbours('tasks')).toEqual([])
  })

  it('leave a shared section without their keys, or nothing', () => {
    expect(withoutPartKeys({ a: [1], e: [2] }, ['a'])).toEqual({ e: [2] })
    expect(withoutPartKeys({ a: [1] }, ['a'])).toBeNull()
  })

  it('pick their own live changes by path', () => {
    const changes: DeltaChange[] = [
      ['set', ['materials', 'Mora'], 5],
      ['set', ['achievements', '84001'], 1],
      ['set', ['gi_player', 'nickname'], 'player01'],
      ['set', ['gi_player', 'ar'], 60],
      ['set', ['quests', '352'], 1],
      ['del', ['gi_tasks', 'welkin']],
    ]
    expect(withoutPartChanges('achievements', changes).dropped).toBe(1)
    expect(withoutPartChanges('profile', changes).changes).toHaveLength(5)
    expect(isPartChange('profile', changes[3]!)).toBe(false)
    expect(isPartChange('collections', changes[4]!)).toBe(true)
    expect(isPartChange('tasks', changes[5]!)).toBe(true)
  })
})

describe('the no-op decision', () => {
  it('tells switch lists apart, in any order; absent is not []', () => {
    expect(sameOff(['gi_tasks', 'gi_events'], ['gi_events', 'gi_tasks'])).toBe(true)
    expect(sameOff(['gi_tasks'], [])).toBe(false)
    expect(sameOff(undefined, [])).toBe(false)
    expect(sameOff(undefined, undefined)).toBe(true)
  })

  it('reads the newest removal time', () => {
    expect(lastRemoval(undefined)).toBe(0)
    expect(lastRemoval({ tasks: 5, profile: 9 })).toBe(9)
  })
})

describe('planning a removal', () => {
  const progress = (achievements: boolean) => ({
    ...(achievements
      ? {
          a: Object.fromEntries(
            Array.from({ length: 300 }, (_, i) => [String(80_000 + i), { progress: i, total: 9 }]),
          ),
        }
      : {}),
    e: { '2001': { progress: 3, total: 7 } },
  })
  async function blob(id: number, value: unknown, base: PartBlobRow | null): Promise<PartBlobRow> {
    const code = kindCode('progress', false)
    const encoded = base
      ? encodeSectionBlobVariants(
          'progress',
          value,
          decodeSectionBlob(base.code, base.data, null, null),
        ).withBase!
      : encodeSectionBlob('progress', value, false, null)
    return {
      id,
      code,
      baseId: base ? base.id : null,
      data: encoded.data,
      hash: shortHashHex(await sectionHashOf('progress', value)),
    }
  }

  it('leaves no base holding the part: a later section compressed against it is made standalone', async () => {
    const anchor = await blob(1, progress(true), null)
    const later = await blob(2, progress(false), anchor)
    expect(later.baseId).toBe(1)
    const blobs = new Map([anchor, later].map((b) => [b.id, b]))
    const rows: PartSnapshotRow[] = [
      { id: 10, takenAt: 1, deleted: false, refs: { progress: 1 } },
      { id: 11, takenAt: 2, deleted: false, refs: { progress: 2 } },
    ]
    const plan = await planPartRemoval('achievements', rows, blobs)
    // The anchor's rest is exactly the later blob: reused, and that one rewritten standalone.
    expect(plan.blobs).toEqual([])
    expect(plan.rewrites.map((r) => r.id)).toEqual([2])
    expect(plan.updates.find((u) => u.id === 10)!.refs).toEqual({ progress: { id: 2 } })
    expect(plan.snapshots).toBe(1)

    // Applied: every blob the rows still reach decodes without the part.
    const after = new Map(blobs)
    for (const r of plan.rewrites) after.set(r.id, { ...after.get(r.id)!, ...r, baseId: null })
    const refs = rows.map((row) => {
      const ref = plan.updates.find((u) => u.id === row.id)?.refs.progress
      return ref && 'id' in ref ? ref.id : row.refs.progress!
    })
    const reached = new Set<number>()
    for (let id of refs) {
      for (let next: number | null = id; next !== null; next = after.get(next)!.baseId) {
        reached.add(next)
      }
    }
    expect([...reached]).toEqual([2])
    const decoder = new BlobDecoder((id) => after.get(id))
    expect(holdsPartKeys(decoder.decode(2).value, ['a'])).toBe(false)
    expect(decoder.decode(2).value).toEqual(progress(false))
    expect(plan.freed).toBe(anchor.data.length + later.data.length - plan.rewrites[0]!.data.length)
  })

  it('rewrites a section that never held the part when its base did', async () => {
    const anchor = await blob(1, progress(true), null)
    const later = await blob(2, { e: { '2001': { progress: 4, total: 7 } } }, anchor)
    const blobs = new Map([anchor, later].map((b) => [b.id, b]))
    const rows: PartSnapshotRow[] = [
      { id: 10, takenAt: 1, deleted: false, refs: { progress: 1 } },
      { id: 11, takenAt: 2, deleted: false, refs: { progress: 2 } },
    ]
    const plan = await planPartRemoval('achievements', rows, blobs)
    expect(plan.blobs).toHaveLength(1)
    expect(plan.rewrites.map((r) => r.id)).toEqual([2])
    // Only the snapshot whose own section held it counts.
    expect(plan.snapshots).toBe(1)
  })
})
