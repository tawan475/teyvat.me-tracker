import { describe, expect, it } from 'vitest'
import {
  BlobDecoder,
  OFF_POSITIONS,
  OFF_SECTION_BITS,
  OFF_SWITCHES,
  PART_SWITCH,
  REMOVABLE_PARTS,
  countParts,
  decodeSectionBlob,
  decodeSnapshotMeta,
  encodeSectionBlob,
  encodeSectionBlobVariants,
  encodeSnapshotMeta,
  holdsPartKeys,
  isPartChange,
  isRemovablePart,
  kindCode,
  lastRemoval,
  normalizeGood,
  offSectionMask,
  partNeighbours,
  partOfSwitch,
  planPartRemoval,
  readOff,
  sameOff,
  sectionHashOf,
  sharedSummaryOf,
  shortHashHex,
  standInSummary,
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

  it('has sixteen switches and eleven removable parts: the characters cover their extras', () => {
    expect(OFF_SWITCHES).toHaveLength(16)
    expect(REMOVABLE_PARTS).toHaveLength(11)
    // Friendship and EXP belong to Characters: no switch and no part of their own.
    expect(OFF_SWITCHES).not.toContain('gi_characters')
    expect(partOfSwitch('gi_characters')).toBeNull()
    expect(isRemovablePart('characterExtras')).toBe(false)
  })

  it('keeps every stored position, the retired one too', () => {
    // A meta stores a known name as its position: never reorder or reuse one.
    expect(OFF_POSITIONS).toEqual([
      'characters',
      'weapons',
      'artifacts',
      'materials',
      'gi_player.profile',
      'gi_player.numbers',
      'gi_characters',
      'gi_achievements',
      'gi_anecdotes',
      'gi_tasks',
      'gi_endgame',
      'gi_exploration',
      'gi_collections',
      'gi_wardrobe',
      'gi_teapot',
      'gi_events',
      'gi_miliastra',
    ])
    const tail = (off: string[]) => [...encodeSnapshotMeta({ ...META, off }).slice(-off.length)]
    expect(tail(['gi_player.numbers', 'gi_achievements', 'gi_miliastra'])).toEqual([6, 8, 17])
    // Written while `gi_characters` was a switch: position 7 still reads back
    // as that name, which the tracker now treats like any name it does not know.
    const old = encodeSnapshotMeta({ ...META, off: ['characters', 'gi_characters'] })
    expect([...old.slice(-3)]).toEqual([2, 1, 7])
    expect(decodeSnapshotMeta(old)).toEqual({ ...META, off: ['characters', 'gi_characters'] })
    expect(readOff(['gi_characters', 'gi_tasks'])).toEqual(['gi_characters', 'gi_tasks'])
  })
})

describe('figures of the sections a capture left out', () => {
  const sum = (n: number) => ({
    characters: n,
    weapons: n + 1,
    artifacts: n + 2,
    materials: n + 3,
    mora: n + 4,
    primogem: n + 5,
    artifact3: n + 6,
    artifact4: n + 7,
  })

  it('stores the build sections as fixed bits', () => {
    expect(OFF_SECTION_BITS).toEqual({ characters: 1, weapons: 2, artifacts: 4, materials: 8 })
    expect(offSectionMask(undefined)).toBe(0)
    expect(offSectionMask([])).toBe(0)
    // Parts other than the builds, and names it does not know, are no bits.
    expect(offSectionMask(['gi_achievements', 'gi_future'])).toBe(0)
    expect(offSectionMask(['materials', 'gi_tasks', 'characters'])).toBe(9)
    expect(offSectionMask(['characters', 'weapons', 'artifacts', 'materials'])).toBe(15)
  })

  it("takes each left-out section's figures from its own stand-in, 0 without one", () => {
    const donors: Record<string, ReturnType<typeof sum> | null> = {
      characters: sum(100),
      materials: null,
    }
    const out = standInSummary(sum(0), ['characters', 'materials'], (s) => donors[s])
    // Characters from the stand-in; the bag's three figures 0 (none shared it);
    // weapons and artifacts as captured.
    expect(out).toEqual({ ...sum(0), characters: 100, materials: 0, mora: 0, primogem: 0 })
    const same = sum(1)
    expect(standInSummary(same, [], () => sum(9))).toBe(same)
  })

  it('reads, per section, the newest older capture that shared it', () => {
    const list = [
      { summary: sum(0), off: ['characters', 'artifacts'] },
      { summary: sum(10), off: ['artifacts'] },
      { summary: sum(20), off: [] },
      { summary: sum(30) },
    ]
    expect(sharedSummaryOf(list, 0)).toEqual({
      ...sum(0),
      characters: 10,
      artifacts: 22,
      artifact3: 26,
      artifact4: 27,
    })
    expect(sharedSummaryOf(list, 1)).toEqual({
      ...sum(10),
      artifacts: 22,
      artifact3: 26,
      artifact4: 27,
    })
    expect(sharedSummaryOf(list, 2)).toBe(list[2]!.summary)
    // Nothing older shared it: 0, never the capture's own empty count.
    expect(sharedSummaryOf([{ summary: sum(5), off: ['weapons'] }], 0).weapons).toBe(0)
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

  it("count the realm currency's live changes with the teapot, as Capture's switch does", () => {
    const realm: DeltaChange = ['set', ['gi_tasks', 'realm'], { value: 900, limit: 2400 }]
    const welkin: DeltaChange = ['del', ['gi_tasks', 'welkin']]
    const comfort: DeltaChange = ['set', ['gi_teapot', 'comfort'], {}]
    expect(isPartChange('teapot', realm)).toBe(true)
    expect(isPartChange('teapot', comfort)).toBe(true)
    expect(isPartChange('teapot', welkin)).toBe(false)
    // It is one of the Planner tasks too: removing those takes it as well.
    expect(isPartChange('tasks', realm)).toBe(true)
    expect(withoutPartChanges('teapot', [realm, welkin, comfort]).changes).toEqual([welkin])
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

  async function sectionBlob(
    id: number,
    slot: 'extras' | 'tasks',
    value: unknown,
  ): Promise<PartBlobRow> {
    return {
      id,
      code: kindCode(slot, false),
      baseId: null,
      data: encodeSectionBlob(slot, value, false, null).data,
      hash: shortHashHex(await sectionHashOf(slot, value)),
    }
  }
  const TEAPOT = [[1, 20000, [1500, 900]]]

  it('takes the realm currency out of the Planner tasks with the teapot', async () => {
    const extras = await sectionBlob(1, 'extras', { t: TEAPOT, m: [[7, 1]] })
    const tasks = await sectionBlob(2, 'tasks', { c: [4, 4], r: [900, 2400], w: 12 })
    const onlyRealm = await sectionBlob(3, 'tasks', { r: [1200, 2400] })
    const noRealm = await sectionBlob(4, 'tasks', { c: [2, 4] })
    const blobs = new Map([extras, tasks, onlyRealm, noRealm].map((b) => [b.id, b]))
    const rows: PartSnapshotRow[] = [
      { id: 10, takenAt: 1, deleted: false, refs: { extras: 1, tasks: 2 } },
      // Capture's Serenitea Pot switch went off, an older build still sent the jar.
      { id: 11, takenAt: 2, deleted: false, refs: { tasks: 3 } },
      { id: 12, takenAt: 3, deleted: false, refs: { tasks: 4 } },
    ]
    const counted = countParts(rows, blobs).find((c) => c.part === 'teapot')!
    expect(counted).toMatchObject({ snapshots: 2, trashed: 0, lastAt: 2 })
    expect(counted.bytes).toBeGreaterThan(0)

    const plan = await planPartRemoval('teapot', rows, blobs)
    expect(plan.snapshots).toBe(2)
    expect(plan.total).toBe(3)
    // The rest of the tasks stays, re-encoded; tasks that were only the jar go.
    const first = plan.updates.find((u) => u.id === 10)!.refs
    expect(Object.keys(first).sort()).toEqual(['extras', 'tasks'])
    expect(plan.updates.find((u) => u.id === 11)!.refs).toEqual({ tasks: null })
    expect(plan.updates.find((u) => u.id === 12)).toBeUndefined()
    const made = new Map(plan.blobs.map((b) => [b.hash, b]))
    const decode = (ref: unknown) => {
      const blob = made.get((ref as { hash: string }).hash)!
      return decodeSectionBlob(blob.code, blob.data, null, null).value
    }
    expect(decode(first.tasks)).toEqual({ c: [4, 4], w: 12 })
    expect(decode(first.extras)).toEqual({ m: [[7, 1]] })

    // Removing the Planner tasks leaves the teapot's comfort where it is.
    const tasksPlan = await planPartRemoval('tasks', rows, blobs)
    expect(tasksPlan.updates.find((u) => u.id === 10)!.refs).toEqual({ tasks: null })
    expect(tasksPlan.snapshots).toBe(3)
  })

  it('counts and cleans snapshots in the trash that still hold the part', async () => {
    const extras = await sectionBlob(1, 'extras', { t: TEAPOT })
    const blobs = new Map([[extras.id, extras]])
    const rows: PartSnapshotRow[] = [
      { id: 10, takenAt: 5, deleted: true, refs: { extras: 1, anecdotes: 9 } },
      { id: 11, takenAt: 6, deleted: false, refs: {} },
    ]
    blobs.set(9, {
      id: 9,
      code: kindCode('anecdotes', false),
      baseId: null,
      hash: 'aa',
      data: new Uint8Array(40),
    })
    const counts = countParts(rows, blobs)
    // Only the trash holds them: still something to remove.
    expect(counts.find((c) => c.part === 'teapot')).toMatchObject({
      snapshots: 1,
      trashed: 1,
      lastAt: 5,
    })
    expect(counts.find((c) => c.part === 'anecdotes')).toMatchObject({ snapshots: 1, trashed: 1 })
    expect(counts.find((c) => c.part === 'tasks')).toMatchObject({ snapshots: 0, trashed: 0 })
    const plan = await planPartRemoval('teapot', rows, blobs)
    expect(plan).toMatchObject({ snapshots: 1, trashed: 1, total: 2, lastAt: 5 })
    expect(plan.updates).toEqual([
      { id: 10, refs: { extras: null }, storedDelta: -extras.data.length },
    ])
    expect(plan.freed).toBe(extras.data.length)
  })
})
