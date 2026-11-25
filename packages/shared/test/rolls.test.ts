import { describe, expect, it } from 'vitest'
import {
  CorruptDataError,
  artifactIdentityText,
  artifactKey,
  artifactKeyString,
  bytesToHex,
  catalogFromRows,
  catalogRolls,
  checkRolls,
  decodeCatalogChunk,
  decodeSnapshot,
  encodeCatalogChunk,
  encodeSnapshot,
  hashArtifactIdentity,
  hexToBytes,
  normalizeGood,
  prepareSnapshot,
  rollPairs,
  rollsByLine,
  rollValue,
  type ArtifactIdentity,
  type CatalogEntryBytes,
  type CatalogRow,
  type Good,
  type StoredSnapshot,
} from '../src'
import { inflate } from '../src/codec/deflate'
import { MATERIALS } from '../src/dictionary/materials'
import cases from './fixtures/gi-rolls-cases.json'
import { syntheticGood } from './synthetic'

type Case = (typeof cases.valid)[number]

/** A contract case as a whole GOOD artifact (the cases leave out the keys rolls do not read). */
const asArtifact = (artifact: object, slotKey = 'flower') => ({
  setKey: 'GladiatorsFinale',
  slotKey,
  mainStatKey: 'hp',
  location: '',
  lock: false,
  ...artifact,
})

const withoutRolls = ({ gi_rolls: _, ...rest }: Record<string, unknown>) => rest

const fileOf = (artifacts: object[]) => ({
  format: 'GOOD',
  version: 2,
  source: 'Test',
  characters: [{ key: 'Furina', level: 90, constellation: 0, ascension: 6, talent: {} }],
  artifacts,
})

const readOne = (artifact: object) => normalizeGood(fileOf([artifact])).artifacts[0]!

describe('gi_rolls contract cases', () => {
  it.each(cases.valid.map((c) => [c.name, c] as const))('reads %s', (_, c: Case) => {
    const occurrence = readOne(asArtifact(c.artifact))
    expect(occurrence.rolls).toBe(c.artifact.gi_rolls)
    expect(rollPairs(occurrence.rolls!)).toEqual(c.rolls)
    // Everything else as if the key were absent.
    const plain = readOne(asArtifact(withoutRolls(c.artifact)))
    expect(occurrence.identity).toEqual(plain.identity)
    expect(occurrence.state).toEqual(plain.state)
  })

  it.each(cases.invalid.map((c) => [c.name, c] as const))('drops %s', (_, c) => {
    const occurrence = readOne(asArtifact(c.artifact))
    expect('rolls' in occurrence).toBe(false)
    expect(occurrence).toEqual(readOne(asArtifact(withoutRolls(c.artifact))))
  })

  it('gives each line its tiers and each tier its value', () => {
    const c = cases.valid[0]!
    const lines = rollsByLine(c.artifact.gi_rolls, c.artifact.substats.length)
    expect(lines).toEqual([[4, 1, 2], [2, 4, 3], [1], [3, 4]])
    lines.forEach((tiers, line) => {
      const { key, value } = c.artifact.substats[line]!
      const sum = tiers.reduce((total, tier) => total + rollValue(key, 5, tier)!, 0)
      expect(Math.abs(sum - value)).toBeLessThan(0.051)
    })
    expect(rollValue('critRate_', 5, 4)).toBe(3.89)
    expect(rollValue('critRate_', 5, 5)).toBeUndefined()
    expect(rollValue('critRate_', 9, 1)).toBeUndefined()
    expect(rollValue('toString', 5, 1)).toBeUndefined()
  })
})

describe('checkRolls on any input', () => {
  const good = cases.valid[0]!.artifact

  it('accepts the `~` form only with lines grouped and ascending', () => {
    // 04 12 21 33 14 01 13 34 02 grouped by line: 0:4,1,2 1:2,4,3 2:1 3:3,4
    expect(checkRolls(good, '~040102121413213334')).toBe('~040102121413213334')
    expect(checkRolls(good, '~121413040102213334')).toBeUndefined()
    expect(checkRolls(good, '~04122133140113340')).toBeUndefined()
    // A file never carries the `~` form.
    const occurrence = readOne(asArtifact({ ...good, gi_rolls: '~040102121413213334' }))
    expect(occurrence.rolls).toBeUndefined()
  })

  it('never throws and refuses what is not rolls', () => {
    const hostile: [unknown, unknown][] = [
      [null, good.gi_rolls],
      [undefined, good.gi_rolls],
      ['artifact', good.gi_rolls],
      [good, undefined],
      [good, 41],
      [good, ['04', '12']],
      [good, { length: 18 }],
      [good, '0'.repeat(1 << 20)],
      [good, '04'.repeat(1 << 19)],
      [{ ...good, totalRolls: 1 << 19 }, '01'.repeat(1 << 19)],
      [{ ...good, totalRolls: '9' }, good.gi_rolls],
      [{ ...good, totalRolls: 9.5 }, good.gi_rolls],
      [{ ...good, totalRolls: Infinity }, good.gi_rolls],
      [{ ...good, totalRolls: 0 }, ''],
      [{ ...good, rarity: 6 }, good.gi_rolls],
      [{ ...good, rarity: '5' }, good.gi_rolls],
      [{ ...good, substats: 'four' }, good.gi_rolls],
      [{ ...good, substats: [] }, good.gi_rolls],
      [{ ...good, substats: [null, null, null, null] }, good.gi_rolls],
      [{ ...good, substats: good.substats.map((s) => ({ ...s, key: 'atk%' })) }, good.gi_rolls],
      [{ ...good, substats: good.substats.map((s) => ({ ...s, value: NaN })) }, good.gi_rolls],
      [{ ...good, substats: good.substats.map((s) => ({ ...s, value: '9.7' })) }, good.gi_rolls],
      [
        { ...good, substats: good.substats.map((s) => ({ ...s, initialValue: 'x' })) },
        good.gi_rolls,
      ],
      [good, '04122133140113340٢'],
      [good, '０4122133140113340２'],
      [good, '941221331401133402'],
      [good, '091221331401133402'],
      [good, '04122133140113349'],
      [good, ' 041221331401133402'],
      [good, '041221331401133402\n'],
    ]
    for (const [artifact, text] of hostile) {
      expect(() => checkRolls(artifact, text)).not.toThrow()
      expect(checkRolls(artifact, text)).toBeUndefined()
    }
    expect(checkRolls(good, good.gi_rolls)).toBe(good.gi_rolls)
  })

  it('reads a file with a megabyte of rolls as one without them', () => {
    const big = asArtifact({ ...good, totalRolls: 1 << 19, gi_rolls: '01'.repeat(1 << 19) })
    const occurrence = readOne(big)
    expect(occurrence.rolls).toBeUndefined()
    expect(occurrence.identity.totalRolls).toBe(1 << 19)
  })
})

// ------------------------------------------------------------------ identity

/** One identity `packArtifact` cannot lay out (a level that is not a whole number). */
const jsonFallback = () => asArtifact({ ...cases.valid[0]!.artifact, level: 20.5 })

describe('rolls are never part of the identity', () => {
  const artifacts = [...cases.valid.map((c) => asArtifact(c.artifact)), jsonFallback()]

  it('keeps packed bytes, keys, identity text and hash with or without rolls', async () => {
    const withRolls = normalizeGood(fileOf(artifacts)).artifacts
    const without = normalizeGood(fileOf(artifacts.map(withoutRolls))).artifacts
    expect(withRolls.every((a) => a.rolls !== undefined)).toBe(true)
    expect(artifactKey(withRolls.at(-1)!.identity)[0]).toBe(0) // the JSON layout
    for (let i = 0; i < withRolls.length; i++) {
      const a = withRolls[i]!.identity
      const b = without[i]!.identity
      expect(json(a)).toBe(json(b))
      expect(bytesToHex(artifactKey(a))).toBe(bytesToHex(artifactKey(b)))
      expect(artifactKeyString(a)).toBe(artifactKeyString(b))
      expect(artifactIdentityText(a)).toBe(artifactIdentityText(b))
      expect(await hashArtifactIdentity(a)).toBe(await hashArtifactIdentity(b))
    }
  })

  it('prepares the same snapshot from a file with or without gi_rolls', async () => {
    const good = syntheticGood(7) as unknown as Record<string, unknown>
    const extra = artifacts.map((a, i) => ({ ...a, slotKey: ['flower', 'plume', 'sands'][i % 3] }))
    const file = { ...good, artifacts: [...(good.artifacts as object[]), ...extra] }
    const plain = { ...file, artifacts: file.artifacts.map((a) => withoutRolls(a as never)) }
    const a = await prepareSnapshot(file, { materials: MATERIALS })
    const b = await prepareSnapshot(plain, { materials: MATERIALS })
    expect(a.artifactHashes).toEqual(b.artifactHashes)
    const ids = new Map(a.artifactHashes.map((hash, i) => [hash, i + 1]))
    const encodedA = await encodeSnapshot(a, ids, MATERIALS)
    const encodedB = await encodeSnapshot(b, ids, MATERIALS)
    expect(encodedA.contentHash).toBe(encodedB.contentHash)
    expect(json(encodedA)).toBe(json(encodedB))
    expect(json(a.summary)).toBe(json(b.summary))
  })
})

const json = (value: unknown) => JSON.stringify(value)

// -------------------------------------------------------------------- chunks

const identities = (): ArtifactIdentity[] =>
  normalizeGood(
    fileOf([...cases.valid.map((c) => asArtifact(c.artifact)), jsonFallback()]),
  ).artifacts.map((a) => a.identity)

/** Body of a chunk before deflate. */
const bodyOf = (data: Uint8Array) =>
  data[0] === 2 || data[0] === 4 ? inflate(data.subarray(1)) : data.subarray(1)

/**
 * Two of the cases' pieces as the encoder before rolls (main at f5ddaa96)
 * writes them: format 2, deflated.
 */
const PINNED_SMALL_CHUNK =
  '026362e3d1d46312e1649991a87e52f4ec1910907008d79d9c6f0212e76069f8c3fc9e718697f249516330907770110000'

describe('catalog chunks with rolls', () => {
  it('writes exactly the old bytes when no entry has rolls', () => {
    const [a, b] = identities()
    const data = encodeCatalogChunk([
      { id: 3, identity: a! },
      { id: 9, identity: b! },
    ])
    expect(bytesToHex(data)).toBe(PINNED_SMALL_CHUNK)
    const back = decodeCatalogChunk(hexToBytes(PINNED_SMALL_CHUNK))
    expect(back.map((e) => [e.id, json(e.identity), 'rolls' in e])).toEqual([
      [3, json(a), false],
      [9, json(b), false],
    ])
    // The same body stored (format 1) reads the same.
    const stored = new Uint8Array([1, ...bodyOf(hexToBytes(PINNED_SMALL_CHUNK))])
    expect(decodeCatalogChunk(stored).map((e) => e.key)).toEqual(back.map((e) => e.key))
    // A bigger old chunk reads too, with no rolls.
    const many = encodeCatalogChunk(
      Array.from({ length: 40 }, (_, i) => ({ id: i + 1, identity: identities()[i % 14]! })),
    )
    expect(many[0]).toBe(2)
    expect(decodeCatalogChunk(many).every((e) => e.rolls === undefined)).toBe(true)
  })

  it('round-trips a mixed chunk, keys equal to the identity alone', () => {
    const list = identities()
    const texts = [
      ...cases.valid.map((c) => c.artifact.gi_rolls),
      '~040102121413213334',
      '0151', // a line past 3: the digit layout
      '~0102',
      '01',
      '0'.repeat(32),
      '~' + '34'.repeat(16),
    ]
    const entries: CatalogEntryBytes[] = list.map((identity, i) => ({
      id: 100 + i * 7,
      identity,
      ...(i % 4 === 3 ? {} : { rolls: texts[i % texts.length] }),
    }))
    for (const [i, rolls] of texts.entries()) {
      entries.push({ id: 1000 + i, identity: list[i % list.length]!, rolls })
    }
    for (const data of [encodeCatalogChunk(entries), encodeCatalogChunk(entries.slice(0, 2))]) {
      expect([3, 4]).toContain(data[0])
      const back = decodeCatalogChunk(data)
      const expected = entries.slice(0, back.length)
      expect(back.map((e) => e.id)).toEqual(expected.map((e) => e.id))
      back.forEach((entry, i) => {
        expect(entry.rolls).toBe(expected[i]!.rolls)
        expect('rolls' in entry).toBe(expected[i]!.rolls !== undefined)
        expect(entry.key).toBe(artifactKeyString(expected[i]!.identity))
        expect(json(entry.identity)).toBe(json(expected[i]!.identity))
        expect('rolls' in entry.identity).toBe(false)
      })
    }
  })

  it('refuses rolls that are not a RollsText when encoding', () => {
    const [identity] = identities()
    for (const rolls of ['', '0', 'ab', '~', '01'.repeat(17), '~~01']) {
      expect(() => encodeCatalogChunk([{ id: 1, identity: identity!, rolls }])).toThrow(RangeError)
    }
  })

  it('throws CorruptDataError on a damaged rolls block', () => {
    const [a, b] = identities()
    const plain = bodyOf(
      encodeCatalogChunk([
        { id: 1, identity: a! },
        { id: 2, identity: b! },
      ]),
    )
    const chunk = (...records: number[]) => new Uint8Array([3, ...plain, ...records])
    // Sound: two records, the first none, the second one roll "01".
    expect(decodeCatalogChunk(chunk(0, 1 + 0 + 2 * (0 + 2 * 1), 0x00))[1]!.rolls).toBe('01')
    const damaged = [
      chunk(), // no records
      chunk(0), // one record of two
      chunk(0, 0, 0), // a record too many
      chunk(0, 0xff, 0xff, 0xff, 0xff, 0x7f), // a count past MAX_ROLLS
      chunk(0, 1 + 2 * (2 * 17)), // 17 rolls
      chunk(0, 1 + 2 * 0), // head of 0 rolls
      chunk(0, 1 + 2 * (2 * 9), 1, 2), // nine rolls, two bytes
      chunk(0, 1 + 2 * (2 * 1), 0x10), // a spare nibble that is not 0
      chunk(0, 2 + 2 * (2 * 1), 0xaf), // digit layout, line 10
      chunk(0, 2 + 2 * (2 * 1), 0x1c), // digit layout, tier 12
      chunk(0, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80), // a varint that never ends
    ]
    for (const data of damaged) expect(() => decodeCatalogChunk(data)).toThrow(CorruptDataError)
    // Format 4 whose stream is not deflate.
    expect(() => decodeCatalogChunk(new Uint8Array([4, 1, 2, 3]))).toThrow()
  })

  it('grows a 512-entry chunk by at most 6 bytes per entry for nine rolls each', () => {
    const list = identities()
    const nine = cases.valid[0]!.artifact.gi_rolls
    const plain = Array.from({ length: 512 }, (_, i) => ({ id: 1 + i, identity: list[i % 14]! }))
    const rolled = plain.map((e) => ({ ...e, rolls: nine }))
    const growth =
      bodyOf(encodeCatalogChunk(rolled)).length - bodyOf(encodeCatalogChunk(plain)).length
    expect(growth).toBeLessThanOrEqual(6 * 512)
  })
})

// ---------------------------------------------------------------- round trip

describe('rolls through storage and back', () => {
  it('gives gi_rolls back when the catalog knows them, else leaves the key out', async () => {
    const pieces = cases.valid.map((c, i) =>
      asArtifact(c.artifact, ['flower', 'plume', 'sands', 'goblet', 'circlet'][i % 5]),
    )
    const file = { ...fileOf(pieces), weapons: [], materials: {} }
    const prepared = await prepareSnapshot(file, { materials: MATERIALS })
    const ids = new Map<string, number>()
    const entries: CatalogEntryBytes[] = []
    prepared.artifactHashes.forEach((hash, i) => {
      if (ids.has(hash)) return
      ids.set(hash, ids.size + 1)
      const { identity, rolls } = prepared.good.artifacts[i]!
      entries.push({ id: ids.get(hash)!, identity, rolls })
    })
    const encoded = await encodeSnapshot(prepared, ids, MATERIALS)
    const stored: StoredSnapshot = {
      format: 'GOOD',
      version: 2,
      source: 'Test',
      takenAt: 1_700_000_000_000,
      characters: encoded.characters.json,
      weapons: encoded.weapons.json,
      artifacts: encoded.artifacts.json,
      materials: encoded.materials.json,
      materialsKeyframe: null,
      achievements: null,
    }
    const back = decodeCatalogChunk(encodeCatalogChunk(entries))
    const catalog = new Map(back.map((e) => [e.id, e.identity]))
    const rolls = new Map(back.flatMap((e) => (e.rolls ? [[e.id, e.rolls] as const] : [])))

    const decoded: Good = decodeSnapshot(stored, catalog, MATERIALS, rolls)
    const byRolls = (list: Good['artifacts']) => list.map((a) => a.gi_rolls).sort()
    expect(byRolls(decoded.artifacts)).toEqual(cases.valid.map((c) => c.artifact.gi_rolls).sort())
    for (const artifact of decoded.artifacts) {
      // Appended after every key the artifact had before.
      expect(Object.keys(artifact).at(-1)).toBe('gi_rolls')
      expect(readOne(artifact).rolls).toBe(artifact.gi_rolls)
    }

    const bare = decodeSnapshot(stored, catalog, MATERIALS)
    expect(bare.artifacts.some((a) => 'gi_rolls' in a)).toBe(false)
    expect(json(bare.artifacts)).toBe(
      json(decoded.artifacts.map((a) => withoutRolls(a as unknown as Record<string, unknown>))),
    )
    // `~` rolls are not written as gi_rolls (a later package gives them another shape).
    const unordered = new Map([...rolls].map(([id]) => [id, '~040102121413213334']))
    const loose = decodeSnapshot(stored, catalog, MATERIALS, unordered)
    expect(loose.artifacts.some((a) => 'gi_rolls' in a)).toBe(false)
  })

  it('reads the wire row with and without its eleventh element', () => {
    const base: CatalogRow = [7, 'GladiatorsFinale', 'flower', 20, 5, 'hp', [], 9, 0, []]
    const rolled: CatalogRow = [8, ...(base.slice(1) as never[]), '041221331401133402'] as never
    const bad: CatalogRow = [9, ...(base.slice(1) as never[]), 'nope'] as never
    const catalog = catalogFromRows([base, rolled, bad])
    expect('rolls' in catalog.get(7)!).toBe(false)
    expect(catalog.get(8)!.rolls).toBe('041221331401133402')
    expect('rolls' in catalog.get(9)!).toBe(false)
    expect([...catalogRolls(catalog)]).toEqual([[8, '041221331401133402']])
  })
})
