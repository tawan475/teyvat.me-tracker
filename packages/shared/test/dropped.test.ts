import { describe, expect, it } from 'vitest'
import {
  cleanSection,
  decodeSectionBlob,
  encodeCollections2,
  encodeExtras,
  encodeProgress,
  encodeSectionBlob,
  encodeSnapshot,
  encodeTasks,
  isDroppedChange,
  kindCode,
  normalizeGood,
  prepareSnapshot,
  sectionHashOf,
  withoutDropped,
  type NormalizedGood,
  type SectionKind,
} from '../src'
import { MATERIALS } from '../src/dictionary/materials'
import { synthetic17, synthetic18, syntheticCollections, syntheticGood } from './synthetic'

const new17 = synthetic17(3)
const new18 = synthetic18(3)
const input = {
  ...syntheticGood(3),
  gi_tasks: { welkin: { days: 30 }, ...new17.tasks, ...new18.tasks },
  gi_collections: { ...syntheticCollections(3), ...new17.collections },
  gi_events: new17.events,
  gi_teapot: new18.teapot,
  gi_miliastra: new18.miliastra,
}

/** A section as stored and read back (storage letters), as the repack sees it. */
function stored(kind: SectionKind, value: object | null): unknown {
  if (value === null) return null
  const blob = encodeSectionBlob(kind, value, false, null)
  return decodeSectionBlob(kindCode(kind, false), blob.data, null, null).value
}

const sectionsOf = (good: NormalizedGood) => ({
  tasks: good.tasks ? encodeTasks(good.tasks) : null,
  collections2: good.collections ? encodeCollections2(good.collections) : null,
  progress: encodeProgress({
    ...(good.achievementProgress ? { achievementProgress: good.achievementProgress } : {}),
    ...(good.events ? { events: good.events } : {}),
  }),
  extras: encodeExtras({
    ...(good.teapot ? { teapot: good.teapot } : {}),
    ...(good.miliastra ? { miliastra: good.miliastra } : {}),
  }),
})

describe('fields the tracker no longer keeps', () => {
  it('are left out of what is stored, the monsters seen as a count', async () => {
    const prepared = await prepareSnapshot(input, { materials: MATERIALS })
    expect(prepared.full).toBeDefined()
    expect(prepared.good.tasks!.respawns).toBeUndefined()
    expect(prepared.good.tasks!.welkin).toEqual({ days: 30 })
    expect(prepared.good.events).toBeNull()
    expect(prepared.good.miliastra).toBeNull()
    expect(prepared.good.teapot).toEqual(prepared.full!.teapot)
    expect(prepared.good.collections!.monstersSeen).toBeUndefined()
    expect(prepared.good.collections!.monstersSeenCount).toBe(
      prepared.full!.collections!.monstersSeen!.length,
    )
    // A file without them is left as it is.
    const plain = normalizeGood(syntheticGood(3), { materials: MATERIALS })
    expect(withoutDropped(plain)).toBe(plain)
  })

  it('cleaning a stored section gives the section the import stores now, hash and all', async () => {
    const full = normalizeGood(input, { materials: MATERIALS })
    const before = sectionsOf(full)
    const after = sectionsOf(withoutDropped(full))
    for (const kind of ['tasks', 'collections2', 'progress', 'extras'] as const) {
      const cleaned = cleanSection(kind, stored(kind, before[kind]))
      const expected = stored(kind, after[kind])
      expect(JSON.stringify(cleaned), kind).toBe(JSON.stringify(expected))
      if (expected !== null) {
        expect(await sectionHashOf(kind, cleaned), kind).toBe(await sectionHashOf(kind, expected))
      }
    }
    // A section left with nothing goes.
    expect(cleanSection('extras', { m: [[1, 0]] })).toBeNull()
    // Others are untouched.
    const wardrobe = { c: 1 }
    expect(cleanSection('wardrobe', wardrobe)).toBe(wardrobe)
  })

  it('keeps the hashes an older tracker gave the same file', async () => {
    const prepared = await prepareSnapshot(input, { materials: MATERIALS })
    const ids = new Map(prepared.artifactHashes.map((hash, i) => [hash, i + 1]))
    const encoded = await encodeSnapshot(prepared, ids, MATERIALS)
    // The old content hash: the same file prepared as if nothing was dropped.
    const asBefore = await encodeSnapshot(
      { ...prepared, good: prepared.full!, full: undefined },
      ids,
      MATERIALS,
    )
    expect(encoded.contentHash).not.toBe(asBefore.contentHash)
    expect(encoded.preDropContentHashes).toContain(asBefore.contentHash)
    expect(encoded.preDropContentHashes).toContain(asBefore.pre17ContentHash)
    expect(asBefore.preDropContentHashes).toEqual([])
  })

  it('live changes to them are not stored', () => {
    expect(isDroppedChange(['set', ['gi_tasks', 'respawns', '12'], [1]])).toBe(true)
    expect(isDroppedChange(['set', ['gi_events', '5'], {}])).toBe(true)
    expect(isDroppedChange(['del', ['gi_miliastra', 'cosmetics', '3']])).toBe(true)
    expect(isDroppedChange(['set', ['gi_collections', 'monstersSeen'], [1, 2]])).toBe(true)
    expect(isDroppedChange(['set', ['gi_tasks', 'resin'], { value: 1, nextAt: 2 }])).toBe(false)
    expect(isDroppedChange(['set', ['gi_collections', 'quests', '7'], 1])).toBe(false)
  })
})
