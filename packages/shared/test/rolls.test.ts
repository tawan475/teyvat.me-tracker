import { describe, expect, it } from 'vitest'
import {
  CHARACTERS,
  CorruptDataError,
  artifactsFingerprint,
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
  fillCatalogChunk,
  hashArtifactIdentity,
  hexToBytes,
  isStorableRolls,
  needsFill,
  normalizeGood,
  prepareSnapshot,
  readCatalogChunk,
  rollPairs,
  rollsByLine,
  rollTiers,
  rollValue,
  sha256Hex128,
  type ArtifactIdentity,
  type CatalogEntryBytes,
  type CatalogRow,
  type Good,
  type StoredSnapshot,
} from '../src'
import { ByteWriter } from '../src/codec/bytes'
import { inflate } from '../src/codec/deflate'
import { MATERIALS } from '../src/dictionary/materials'
import cases from './fixtures/gi-rolls-cases.json'
import { int, pick, random, syntheticGood } from './synthetic'

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
 * writes them: format 2, deflated. (Made again with that commit's encoder
 * when the cases' initial values were corrected, 2026-11-26.)
 */
const PINNED_SMALL_CHUNK =
  '026362e3d1d46312e1649991a87e52f4ec1910907008d79d9c6f0a12e76069f8c3fc9e718697f249516330907770110000'

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
      '0134', // line 0 and line 3, tiers 1 and 4: the edges of the layout
      '~0102',
      '01',
      '01'.repeat(16),
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

  it('refuses rolls that are not of the storable shape when encoding', () => {
    const [identity] = identities()
    const refused = [
      ...['', '0', 'ab', '~', '01'.repeat(17), '~~01'],
      // RollsTexts no artifact's checked rolls can be:
      '0151', // a line past 3
      '91', // line 9
      '00', // tier 0
      '05', // tier 5
      '0'.repeat(32), // tier 0, sixteen times
      '~1101', // a `~` text whose lines go down
      '~011201', // a `~` text whose lines are not grouped
    ]
    for (const rolls of refused) {
      expect(isStorableRolls(rolls)).toBe(false)
      expect(() => encodeCatalogChunk([{ id: 1, identity: identity!, rolls }])).toThrow(RangeError)
      const data = encodeCatalogChunk([{ id: 1, identity: identity! }])
      const fills = new Map([[artifactKeyString(identity!), rolls]])
      if (needsFill(undefined, rolls))
        expect(() => fillCatalogChunk(data, fills)).toThrow(RangeError)
      else expect(fillCatalogChunk(data, fills)).toBe(data)
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
      chunk(0, 2 + 2 * (2 * 1), 0xaf), // the old digit layout (line 10): no such layout
      chunk(0, 2 + 2 * (2 * 1), 0x01), // the old digit layout, even for a sound "01"
      chunk(0, 1 + 2 * (1 + 2 * 2), 0x04), // "~1101": a `~` text whose lines go down
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
    // A stored text checked again on the way out: one that no longer fits its
    // piece (here another piece's rolls) is left out, the others kept.
    const ids1 = [...rolls.keys()]
    const swapped = new Map(rolls)
    swapped.set(ids1[0]!, rolls.get(ids1[1]!)!)
    const checked = decodeSnapshot(stored, catalog, MATERIALS, swapped)
    expect(checked.artifacts.filter((a) => 'gi_rolls' in a)).toHaveLength(rolls.size - 1)
    for (const artifact of checked.artifacts) {
      if (artifact.gi_rolls) expect(checkRolls(artifact, artifact.gi_rolls)).toBe(artifact.gi_rolls)
    }
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

// ------------------------------------------------- what checkRolls accepts

const ROLL_KEYS = [
  'hp',
  'atk',
  'def',
  'hp_',
  'atk_',
  'def_',
  'eleMas',
  'enerRech_',
  'critRate_',
  'critDMG_',
]

/** A made-up artifact with rolls in first-appearance order, its values as the game shows them. */
function rolledArtifact(rand: () => number) {
  const rarity = int(rand, 1, 5)
  const lines = int(rand, 1, 4)
  const keys = [...ROLL_KEYS].sort(() => rand() - 0.5).slice(0, lines)
  const count = int(rand, lines, Math.min(9, lines + 5))
  const pairs: [number, number][] = keys.map((key, line) => [
    line,
    int(rand, 1, rollTiers(key, rarity).length),
  ])
  while (pairs.length < count) {
    const line = int(rand, 0, lines - 1)
    pairs.push([line, int(rand, 1, rollTiers(keys[line]!, rarity).length)])
  }
  // Keep each line's first roll first, shuffle the upgrades.
  const upgrades = pairs.slice(lines).sort(() => rand() - 0.5)
  const ordered = [...pairs.slice(0, lines), ...upgrades]
  const shown = (key: string, n: number) =>
    key.endsWith('_') ? Math.round(n * 10) / 10 : Math.round(n)
  const substats = keys.map((key, line) => {
    const tiers = ordered.filter(([l]) => l === line).map(([, t]) => t)
    const sum = tiers.reduce((total, t) => total + rollValue(key, rarity, t)!, 0)
    return {
      key,
      value: shown(key, sum),
      initialValue: shown(key, rollValue(key, rarity, tiers[0]!)!),
    }
  })
  const text = ordered.map(([l, t]) => `${l}${t}`).join('')
  const grouped = `~${[...ordered]
    .sort((a, b) => a[0] - b[0])
    .map(([l, t]) => `${l}${t}`)
    .join('')}`
  return { artifact: { rarity, totalRolls: count, substats }, text, grouped }
}

describe('what checkRolls accepts, the catalog stores', () => {
  it('refuses an artifact with more than four substat lines', () => {
    const substats = ['hp', 'atk', 'def', 'eleMas', 'critRate_'].map((key) => ({
      key,
      value: Math.round(rollValue(key, 5, 1)! * 10) / 10,
    }))
    expect(
      checkRolls({ rarity: 5, totalRolls: 4, substats: substats.slice(0, 4) }, '01112131'),
    ).toBe('01112131')
    expect(checkRolls({ rarity: 5, totalRolls: 5, substats }, '0111213141')).toBeUndefined()
  })

  it('keeps every accepted text, `~` ones too, through encode and decode unchanged', () => {
    const rand = random(11)
    const [identity] = identities()
    const accepted: string[] = []
    for (let i = 0; i < 3000; i++) {
      const { artifact, text, grouped } = rolledArtifact(rand)
      for (const candidate of [text, grouped]) {
        const kept = checkRolls(artifact, candidate)
        if (kept !== undefined) accepted.push(kept)
      }
      // Random digits against the same piece: whatever passes must store too.
      const noise = Array.from(
        { length: artifact.totalRolls },
        () => `${int(rand, 0, 9)}${int(rand, 0, 9)}`,
      )
      const kept = checkRolls(artifact, noise.join(''))
      if (kept !== undefined) accepted.push(kept)
    }
    expect(accepted.filter((t) => t.startsWith('~')).length).toBeGreaterThan(1000)
    expect(accepted.filter((t) => !t.startsWith('~')).length).toBeGreaterThan(1000)
    for (let i = 0; i < accepted.length; i += 400) {
      const part = accepted.slice(i, i + 400)
      const entries = part.map((rolls, j) => ({ id: j + 1, identity: identity!, rolls }))
      const back = decodeCatalogChunk(encodeCatalogChunk(entries))
      expect(back.map((e) => e.rolls)).toEqual(part)
    }
    // Every accepted text has lines 0-3 and tiers 1-4: the packed layout.
    for (const text of accepted) {
      for (const [line, tier] of rollPairs(text)) {
        expect(line).toBeLessThanOrEqual(3)
        expect(tier).toBeGreaterThanOrEqual(1)
        expect(tier).toBeLessThanOrEqual(4)
      }
    }
  })
})

// --------------------------------------------------------------- filling

describe('needsFill', () => {
  it('fills an empty entry, upgrades a matching `~` text, and nothing else', () => {
    const ordered = '041221331401133402'
    const grouped = '~040102121413213334'
    expect(needsFill(undefined, ordered)).toBe(true)
    expect(needsFill(undefined, grouped)).toBe(true)
    expect(needsFill(grouped, ordered)).toBe(true)
    // Line 1 holds 2, 3, 4 in the grouped text: not the same order.
    expect(needsFill('~040102121314213334', ordered)).toBe(false)
    expect(needsFill('~0401021214132133', ordered)).toBe(false)
    expect(needsFill(ordered, ordered)).toBe(false)
    expect(needsFill(ordered, '041221331401133402'.replace('3402', '3403'))).toBe(false)
    expect(needsFill(grouped, grouped)).toBe(false)
    expect(needsFill(grouped, '~040102121413213334')).toBe(false)
    expect(needsFill(undefined, undefined)).toBe(false)
    expect(needsFill(undefined, '')).toBe(false)
    expect(needsFill(undefined, 'nope')).toBe(false)
    expect(needsFill(ordered, undefined)).toBe(false)
  })
})

describe('fillCatalogChunk', () => {
  const list = identities()
  const nine = cases.valid[0]!.artifact.gi_rolls
  const prefix = (data: Uint8Array) => {
    const parts = readCatalogChunk(data)
    return bytesToHex(parts.body.subarray(0, parts.identitiesEnd))
  }

  it('splices rolls in without touching the identities', () => {
    for (const size of [2, 40]) {
      const plain = Array.from({ length: size }, (_, i) => ({
        id: 10 + i,
        identity: list[i % 14]!,
      }))
      const before = encodeCatalogChunk(plain)
      expect(before[0]).toBe(2)
      const fills = new Map([[artifactKeyString(list[0]!), nine]])
      const after = fillCatalogChunk(before, fills)
      expect(after).not.toBe(before)
      expect([3, 4]).toContain(after[0])
      expect(prefix(after)).toBe(prefix(before))
      const old = decodeCatalogChunk(before)
      const now = decodeCatalogChunk(after)
      expect(now.map((e) => [e.id, e.key])).toEqual(old.map((e) => [e.id, e.key]))
      // Every entry with that key, not only the first.
      now.forEach((e, i) => expect(e.rolls).toBe(i % 14 === 0 ? nine : undefined))
      expect(now.filter((e) => e.rolls).length).toBe(Math.ceil(size / 14))
      // Again with the same map: nothing to do, the same array back.
      expect(fillCatalogChunk(after, fills)).toBe(after)
    }
  })

  it('returns the very same array when nothing is filled, whatever the format', () => {
    const plain = [
      { id: 1, identity: list[0]! },
      { id: 2, identity: list[1]! },
    ]
    const deflated = encodeCatalogChunk(plain)
    const stored = new Uint8Array([1, ...readCatalogChunk(deflated).body])
    for (const data of [deflated, stored]) {
      expect(fillCatalogChunk(data, new Map())).toBe(data)
      expect(fillCatalogChunk(data, new Map([['no such key', nine]]))).toBe(data)
      expect(fillCatalogChunk(data, new Map([[artifactKeyString(list[0]!), 'nope']]))).toBe(data)
      const filled = fillCatalogChunk(data, new Map([[artifactKeyString(list[1]!), '0112233404']]))
      expect([3, 4]).toContain(filled[0])
      expect(prefix(filled)).toBe(prefix(data))
    }
  })

  it('keeps rolls an entry has, and upgrades only a matching `~` text', () => {
    const grouped = '~040102121413213334'
    const data = encodeCatalogChunk([
      { id: 1, identity: list[0]!, rolls: '0412213314011334' + '01' }, // ordered, another order
      { id: 2, identity: list[1]!, rolls: '0213243121241403' },
      { id: 3, identity: list[2]!, rolls: grouped },
      { id: 4, identity: list[3]! },
    ])
    const fills = new Map([
      [artifactKeyString(list[0]!), nine],
      [artifactKeyString(list[1]!), '0213243121241403'],
      [artifactKeyString(list[2]!), nine],
      [artifactKeyString(list[3]!), '01142233'],
    ])
    const after = fillCatalogChunk(data, fills)
    expect(prefix(after)).toBe(prefix(data))
    expect(decodeCatalogChunk(after).map((e) => e.rolls)).toEqual([
      '0412213314011334' + '01',
      '0213243121241403',
      nine,
      '01142233',
    ])
    expect(fillCatalogChunk(after, fills)).toBe(after)
  })

  it('throws CorruptDataError on a damaged chunk', () => {
    const data = encodeCatalogChunk([{ id: 1, identity: list[0]!, rolls: nine }])
    const fills = new Map([[artifactKeyString(list[0]!), nine]])
    const body = readCatalogChunk(data).body
    for (const bad of [
      new Uint8Array(0),
      new Uint8Array([7, 1, 2]),
      new Uint8Array([3, ...body.subarray(0, body.length - 1)]),
      new Uint8Array([3, ...body, 0]),
      new Uint8Array([1, ...body]),
    ]) {
      expect(() => fillCatalogChunk(bad, fills)).toThrow(CorruptDataError)
    }
  })
})

describe('one id in two copies', () => {
  it('never lets a copy without rolls replace one with them', () => {
    const row = (rolls?: string): CatalogRow =>
      [
        7,
        'GladiatorsFinale',
        'flower',
        0,
        5,
        'hp',
        [],
        4,
        0,
        [],
        ...(rolls ? [rolls] : []),
      ] as never
    for (const order of [
      [row('01112131'), row()],
      [row(), row('01112131')],
    ]) {
      expect(catalogFromRows(order).get(7)!.rolls).toBe('01112131')
    }
    expect('rolls' in catalogFromRows([row(), row()]).get(7)!).toBe(false)
  })
})

describe('one id in two rows, as the wire gives it', () => {
  const row = (level: number, rolls?: string): CatalogRow =>
    [
      7,
      'GladiatorsFinale',
      'flower',
      level,
      5,
      'hp',
      [],
      4,
      0,
      [],
      ...(rolls ? [rolls] : []),
    ] as never
  const ordered = '04122133'
  const grouped = '~04122133'

  it("shows the last row's identity and the better rolls of rows with that identity", () => {
    const cases: [CatalogRow[], string | undefined][] = [
      [[row(2, ordered), row(2, grouped)], ordered], // ordered then `~`
      [[row(2, grouped), row(2, ordered)], ordered], // `~` then ordered
      [[row(2, ordered), row(2)], ordered], // rolls then none
      [[row(2), row(2, ordered)], ordered], // none then rolls
      [[row(2, grouped), row(2)], grouped],
      [[row(2), row(2, grouped)], grouped],
      [[row(2, ordered), row(2, '01020304')], ordered], // ordered never replaced
      [[row(2), row(2)], undefined],
      // Another identity under the id: only the last row's own rolls (D47).
      [[row(1, ordered), row(2, grouped)], grouped],
      [[row(1, grouped), row(2, ordered)], ordered],
      [[row(1, ordered), row(2)], undefined],
      [[row(1), row(2, ordered)], ordered],
      [[row(1, ordered), row(2, '01020304')], '01020304'],
    ]
    for (const [rows, rolls] of cases) {
      const entry = catalogFromRows(rows).get(7)!
      expect(entry.level).toBe(2)
      expect(entry.rolls).toBe(rolls)
      expect('rolls' in entry).toBe(rolls !== undefined)
    }
  })
})

describe('a fill is a splice, not a repack', () => {
  it('keeps identity bytes the packer would not write, byte for byte', () => {
    // A valid identity in the JSON layout, spaced and ordered as no packer
    // writes it: decoding and packing again would change these bytes.
    const json =
      '{ "slotKey": "flower", "setKey": "GladiatorsFinale", "level": 20.5, "rarity": 5,\n' +
      '  "mainStatKey": "hp", "substats": [], "totalRolls": 4, "elixirCrafted": false,\n' +
      '  "unactivatedSubstats": [] }'
    const w = new ByteWriter()
    w.uint(2).int(5).int(3) // two entries: ids 5 and 8
    w.uint(0).string(json)
    w.uint(0).string(json.replace('20.5', '16.5'))
    const data = new Uint8Array([1, ...w.finish()])
    const before = readCatalogChunk(data)
    const fills = new Map(before.entries.map((e) => [e.key, '01112131']))
    const after = readCatalogChunk(fillCatalogChunk(data, fills))
    const prefix = (parts: typeof before) => bytesToHex(parts.body.subarray(0, parts.identitiesEnd))
    expect(prefix(after)).toBe(prefix(before))
    expect(after.entries.map((e) => [e.id, e.key, e.rolls])).toEqual(
      before.entries.map((e) => [e.id, e.key, '01112131']),
    )
    // What a decode-and-repack would have written: other identity bytes.
    const repacked = readCatalogChunk(
      encodeCatalogChunk(before.entries.map(({ id, identity }) => ({ id, identity }))),
    )
    expect(prefix(repacked)).not.toBe(prefix(before))
  })
})

describe('checkRolls tolerances, at their edges', () => {
  // One roll of tier 1: 5★ Crit Rate 2.72, 5★ HP 209.13.
  const one = (key: string, value: number, initialValue?: number) =>
    checkRolls(
      {
        rarity: 5,
        totalRolls: 1,
        substats: [{ key, value, ...(initialValue === undefined ? {} : { initialValue }) }],
      },
      '01',
    )

  it('adds up within 0.051 for percentages and 0.54 for flat stats, no further', () => {
    for (const sign of [1, -1]) {
      expect(one('critRate_', 2.72 + sign * 0.0505)).toBe('01')
      expect(one('critRate_', 2.72 + sign * 0.0515)).toBeUndefined()
      expect(one('hp', 209.13 + sign * 0.535)).toBe('01')
      expect(one('hp', 209.13 + sign * 0.545)).toBeUndefined()
    }
  })

  it('matches the first roll to initialValue within the same tolerances, no further', () => {
    for (const sign of [1, -1]) {
      expect(one('critRate_', 2.72, 2.72 + sign * 0.0505)).toBe('01')
      expect(one('critRate_', 2.72, 2.72 + sign * 0.0515)).toBeUndefined()
      expect(one('hp', 209.13, 209.13 + sign * 0.535)).toBe('01')
      expect(one('hp', 209.13, 209.13 + sign * 0.545)).toBeUndefined()
    }
  })
})

describe('what the catalog can store, both ways', () => {
  it('encodes a RollsText exactly when it is of the storable shape', () => {
    const rand = random(29)
    const [identity] = identities()
    let stored = 0
    let refused = 0
    for (let i = 0; i < 4000; i++) {
      const count = int(rand, 1, 16)
      const pairs = Array.from({ length: count }, () => [
        int(rand, 0, rand() < 0.8 ? 3 : 9),
        int(rand, rand() < 0.9 ? 1 : 0, rand() < 0.8 ? 4 : 9),
      ])
      if (rand() < 0.5) pairs.sort((a, b) => a[0]! - b[0]!)
      const text = `${rand() < 0.5 ? '~' : ''}${pairs.map(([l, t]) => `${l}${t}`).join('')}`
      const encode = () => encodeCatalogChunk([{ id: 1, identity: identity!, rolls: text }])
      if (isStorableRolls(text)) {
        stored++
        expect(decodeCatalogChunk(encode())[0]!.rolls).toBe(text)
        // The shape, said again without the function under test.
        for (const [line, tier] of rollPairs(text)) {
          expect(line).toBeLessThanOrEqual(3)
          expect(tier).toBeGreaterThanOrEqual(1)
          expect(tier).toBeLessThanOrEqual(4)
        }
        if (text.startsWith('~')) {
          const lines = rollPairs(text).map(([line]) => line)
          expect(lines).toEqual([...lines].sort((a, b) => a - b))
        }
      } else {
        refused++
        expect(encode).toThrow(RangeError)
      }
    }
    expect(stored).toBeGreaterThan(500)
    expect(refused).toBeGreaterThan(500)
  })
})

describe('ARTIFACTS_READING', () => {
  // A stored fingerprint stands for "this list, read by this code". The 2 in
  // the expected text is ARTIFACTS_READING (codec/parts.ts): change it here
  // only together with the constant, so lowering it, or forgetting to raise
  // it, fails this test. (The character dictionary's size is part of the
  // hash and grows with the game, so it is read, not written out.)
  it('pins the fingerprint of a fixed list', async () => {
    const list = [
      { setKey: 'GladiatorsFinale', slotKey: 'plume', level: 4, gi_rolls: '0111', gi_guid: '12' },
      { setKey: 'GladiatorsFinale', slotKey: 'flower', level: 0, gi_guid: '9' },
    ]
    const sorted = [list[1], list[0]]
    const expected = await sha256Hex128(
      `artifacts:2:${CHARACTERS.keys.length}:${JSON.stringify(sorted)}`,
    )
    expect(await artifactsFingerprint(list)).toBe(expected)
    expect(expected).toMatch(/^[0-9a-f]{32}$/)
  })
})
