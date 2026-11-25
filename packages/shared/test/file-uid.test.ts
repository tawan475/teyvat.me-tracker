import { describe, expect, it } from 'vitest'
import {
  encodeSnapshot,
  normalizeGood,
  prepareSnapshot,
  resolveDeferredArtifacts,
  uploadUid,
  type PreparedSnapshot,
} from '../src'
import { MATERIALS } from '../src/dictionary/materials'
import { synthetic17, syntheticGood } from './synthetic'

/** A GOOD file as GGScanner writes it: the UID under `metadata`, no `gi_player`. */
function plain() {
  const { gi_player: _, ...good } = syntheticGood(5)
  return good
}
const ggscanner = (metadata: unknown) => ({ ...plain(), source: 'yas-GOODScanner', metadata })

const normalize = (input: unknown) => normalizeGood(input, { materials: MATERIALS })
const fileUid = (metadata: unknown) => normalize(ggscanner(metadata)).fileUid

async function encoded(prepared: PreparedSnapshot) {
  const ids = new Map(prepared.artifactHashes.map((hash, i) => [hash, i + 1]))
  return encodeSnapshot(prepared, ids, MATERIALS)
}

describe("a file's metadata.uid (GGScanner)", () => {
  it('is read as a string or a number', () => {
    expect(fileUid({ uid: '812345678', nickname: 'player01' })).toBe(812345678)
    expect(fileUid({ uid: 812345678 })).toBe(812345678)
    expect(fileUid({ uid: '1812345678' })).toBe(1812345678)
    expect(fileUid({ uid: 1812345678 })).toBe(1812345678)
  })

  it('is ignored when malformed or out of range', () => {
    for (const uid of [
      '81234567', // 8 digits
      '81234567890', // 11 digits
      '8123456a8',
      ' 812345678',
      '812345678.0',
      '012345678',
      '',
      { value: '812345678' },
      ['812345678'],
      null,
      true,
      81234567, // below the range
      10_000_000_000, // above it
      812345678.5,
      -812345678,
    ]) {
      expect(fileUid({ uid }), JSON.stringify(uid)).toBeUndefined()
    }
    expect(fileUid('812345678')).toBeUndefined()
    expect(fileUid(['812345678'])).toBeUndefined()
    expect(fileUid(null)).toBeUndefined()
    expect(normalize(syntheticGood(5)).fileUid).toBeUndefined()
    expect(normalize(syntheticGood(5))).not.toHaveProperty('fileUid')
  })

  it('never becomes gi_player, and gi_player.uid wins over it', () => {
    const only = normalize(ggscanner({ uid: '812345678' }))
    expect(only.player).toBeNull()
    expect(uploadUid(only)).toBe(812345678)
    const both = normalize({
      ...ggscanner({ uid: '812345678' }),
      gi_player: { uid: 712345678, ar: 60 },
    })
    expect(both.player?.uid).toBe(712345678)
    expect(both.fileUid).toBe(812345678)
    expect(uploadUid(both)).toBe(712345678)
    expect(uploadUid(normalize(plain()))).toBeUndefined()
  })

  it('changes nothing stored: sections, content hash and summary are the same', async () => {
    for (const file of [plain(), syntheticGood(5)]) {
      const without = await prepareSnapshot(file, { materials: MATERIALS })
      const withUid = await prepareSnapshot(
        { ...file, metadata: { uid: '812345678', nickname: 'player01' } },
        { materials: MATERIALS },
      )
      expect(withUid.good.fileUid).toBe(812345678)
      expect(withUid.summary).toEqual(without.summary)
      expect(withUid.artifactHashes).toEqual(without.artifactHashes)
      const a = await encoded(without)
      const b = await encoded(withUid)
      expect(b.contentHash).toBe(a.contentHash)
      expect(JSON.stringify(b)).toBe(JSON.stringify(a))
    }
  })

  it('survives the paths that copy a prepared upload', async () => {
    // Dropped fields (gi_events): the stored copy is made by withoutDropped.
    const dropped = await prepareSnapshot(
      { ...ggscanner({ uid: '812345678' }), gi_events: synthetic17(3).events },
      { materials: MATERIALS },
    )
    expect(dropped.full).toBeDefined()
    expect(dropped.good.fileUid).toBe(812345678)
    // A deferred artifact list (every piece with a guid), then read.
    const base = ggscanner({ uid: 812345678 })
    const withGuids = {
      ...base,
      artifacts: base.artifacts.map((a, i) => ({ ...a, gi_guid: String(1_000 + i) })),
    }
    const deferred = await prepareSnapshot(withGuids, {
      materials: MATERIALS,
      deferArtifacts: true,
    })
    expect(deferred.deferred).toBeDefined()
    expect(deferred.good.fileUid).toBe(812345678)
    const resolved = await resolveDeferredArtifacts(deferred)
    expect(resolved.good.fileUid).toBe(812345678)
  })
})
