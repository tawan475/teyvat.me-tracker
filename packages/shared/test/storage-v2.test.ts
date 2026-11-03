import { describe, expect, it } from 'vitest'
import {
  BlobDecoder,
  ByteReader,
  ByteWriter,
  CorruptDataError,
  KIND_DELTA,
  LEGACY_FORMAT,
  SECTION_KIND_CODES,
  SLOTS,
  SOURCES,
  artifactIdentityText,
  artifactKeyString,
  contentKey,
  decodeBundle,
  decodeCatalogChunk,
  decodeSectionBlob,
  decodeSnapshot,
  decodeSnapshotMeta,
  deflateRaw,
  encodeCatalogChunk,
  encodeSectionBlob,
  encodeSectionBlobVariants,
  encodeSnapshot,
  encodeSnapshotMeta,
  kindCode,
  mergePlayer,
  openBundle,
  planSnapshotV2,
  prepareSnapshot,
  sectionHashesOf,
  shortHashHex,
  splitPlayer,
  storedSnapshotOf,
  withBases,
  writeBundle,
  writeBundleV2,
  type ArtifactIdentity,
  type BundleSnapshot,
  type BundleSnapshotV2,
  type EncodedSnapshot,
  type Good,
  type KnownBlob,
  type RawBlob,
  type SectionKind,
  type SnapshotMeta,
} from '../src'
import { SLOT_KEYS, STAT_KEYS, SUBSTAT_KEYS } from '../src/dictionary/artifacts'
import { MATERIALS } from '../src/dictionary/materials'
import { int, pick, playOn, random, syntheticArtifact, syntheticGood } from './synthetic'

const json = (value: unknown) => JSON.stringify(value)

describe('bytes', () => {
  it('round-trips varints, zigzag and strings at their edges', () => {
    const uints = [0, 1, 127, 128, 16383, 16384, 2 ** 31, 2 ** 32 + 5, Number.MAX_SAFE_INTEGER]
    const ints = [0, -1, 1, -64, 64, -(2 ** 40), 2 ** 40, -(2 ** 51), 2 ** 51]
    const strings = ['', 'GoldenTroupe', 'Ünïcödé ✓ 🍰', '﻿starts with a BOM']
    const w = new ByteWriter()
    for (const n of uints) w.uint(n)
    for (const n of ints) w.int(n)
    for (const s of strings) w.string(s)
    const r = new ByteReader(w.finish())
    expect(uints.map(() => r.uint())).toEqual(uints)
    expect(ints.map(() => r.int())).toEqual(ints)
    expect(strings.map(() => r.string())).toEqual(strings)
    r.end()
  })

  it('refuses what it cannot hold, and data that ends early', () => {
    expect(() => new ByteWriter().uint(-1)).toThrow(RangeError)
    expect(() => new ByteWriter().uint(1.5)).toThrow(RangeError)
    expect(() => new ByteWriter().int(2 ** 53)).toThrow(RangeError)
    expect(() => new ByteReader(new Uint8Array([0x80])).uint()).toThrow(CorruptDataError)
    expect(() => new ByteReader(new Uint8Array([5, 1])).string()).toThrow(CorruptDataError)
  })
})

// ---------------------------------------------------------------- sections

/** A canonical-looking value of each section kind, occasionally odd. */
function randomSection(rand: () => number, kind: SectionKind, delta: boolean): unknown {
  const ref = () => (rand() < 0.05 ? pick(rand, ['NewThing', 'Ünï', '']) : int(rand, 0, 7000))
  const sortedIds = (n: number) => {
    let id = int(rand, 0, 50)
    return Array.from({ length: n }, (_, i) => (i === 0 ? id : (id = int(rand, 1, 40))))
  }
  const n = int(rand, 0, 60)
  const b = delta ? { b: 'base' } : {}
  switch (kind) {
    case 'characters':
    case 'weapons':
    case 'characterExtras':
      return Array.from({ length: n }, () =>
        Array.from({ length: int(rand, 1, kind === 'characterExtras' ? 3 : 7) }, (_, i) =>
          i === 0 ? ref() : i === 4 && kind === 'weapons' ? ref() : int(rand, 0, 2e9),
        ),
      )
    case 'artifacts':
      return {
        ...b,
        i: sortedIds(n),
        l: Array.from({ length: n }, ref),
        f: Array.from({ length: n }, () => int(rand, -1, 3)),
      }
    case 'materials':
      return {
        ...b,
        m: Array.from({ length: n }, () => [ref(), rand() < 0.1 ? -1 : int(rand, 0, 5e8)]),
      }
    case 'achievements':
      return sortedIds(n)
    case 'achievementTimes':
      return {
        ...b,
        i: sortedIds(n),
        t: Array.from({ length: n }, () => (rand() < 0.05 ? -1 : int(rand, 1.6e9, 1.8e9))),
      }
    case 'player':
      return {
        uid: 812345678,
        ar: int(rand, 1, 60),
        ...(rand() < 0.5 ? { arExp: int(rand, 0, 1e6) } : {}),
        wl: int(rand, 0, 9),
        ...(rand() < 0.2 ? { someNewField: int(rand, -5, 5) } : {}),
        gameData: '792978e5503ecfba73dcb3562ed44a0d35a2abe2',
      }
    case 'anecdotes':
      return {
        i: sortedIds(n),
        s: Array.from({ length: n }, () => int(rand, 0, 15)),
        c: Array.from({ length: n }, () => int(rand, 0, 100_000)),
        a: sortedIds(int(rand, 0, 8)),
        ...(rand() < 0.7 ? { r: [int(rand, 0, 100), int(rand, 0, 9), 10] } : {}),
        ...(rand() < 0.5 ? { w: [rand() < 0.5 ? 0 : 9801, int(rand, 0, 2e9)] } : {}),
      }
    case 'tasks': {
      const start = int(rand, 1.6e9, 2e9)
      return {
        ...(rand() < 0.8 ? { c: [int(rand, 0, 4), 4] } : {}),
        ...(rand() < 0.8 ? { a: [start, start + 2_592_000, int(rand, 0, 36), 36] } : {}),
        ...(rand() < 0.8
          ? {
              e: Array.from({ length: int(rand, 0, 5) }, (_, k) => [
                rand() < 0.2 ? '' : `Character${k}`,
                int(rand, 101, 706),
                start + k,
                20,
                start + k + 72_000,
              ]),
            }
          : {}),
        ...(rand() < 0.8 ? { r: [int(rand, 0, 2400), 2400] } : {}),
        ...(rand() < 0.8 ? { w: int(rand, 0, 180) } : {}),
      }
    }
    case 'collections': {
      const ascending = (from: number, length: number) => {
        let id = from
        return Array.from({ length }, () => (id += int(rand, 1, 3)))
      }
      const byId = <T extends unknown[]>(from: number, length: number, rest: () => T) =>
        ascending(from, length).map((id) => [id, ...rest()])
      return rand() < 0.9 ? { s: ascending(141_000, n * 4) } : {}
    }
    case 'collections2': {
      const ascending = (from: number, length: number) => {
        let id = from
        return Array.from({ length }, () => (id += int(rand, 1, 3)))
      }
      const byId = <T extends unknown[]>(from: number, length: number, rest: () => T) =>
        ascending(from, length).map((id) => [id, ...rest()])
      return {
        ...(rand() < 0.7
          ? {
              a: {
                quests: ascending(10_000_000, n * 8),
                ...(rand() < 0.5 ? { livingBeings: ascending(20_000_000, n * 9) } : {}),
                materials: ascending(40_000_000, n * 17),
              },
            }
          : {}),
        ...(rand() < 0.7
          ? {
              d: byId(20_000_000, n * 8, () => [
                int(rand, 1, 9_999),
                rand() < 0.1 ? int(rand, 1, 50) : 0,
              ]),
            }
          : {}),
        ...(rand() < 0.7
          ? {
              h: {
                c: byId(10_000, 22, () => [int(rand, 0, 10), 10, int(rand, 0, 2)]),
                t: byId(300_000, n * 4, () => [10_001, int(rand, 0, 5), 5, int(rand, 0, 2)]),
              },
            }
          : {}),
        ...(rand() < 0.5
          ? {
              r: [
                [1, 1, int(rand, 0, 3)],
                [1, 4, int(rand, 0, 3)],
              ],
            }
          : {}),
        ...(rand() < 0.7
          ? {
              g: {
                c: byId(1_000, n * 2, () => [int(rand, 1, 2), rand() < 0.3 ? int(rand, 1, 20) : 0]),
                ...(rand() < 0.7
                  ? {
                      k: byId(0, 4, () => [
                        pick(rand, ['Deck', 'Ünï ★', '']),
                        int(rand, 0, 1),
                        [1101, 1201, 1301],
                        Array.from({ length: 30 }, () => int(rand, 211_011, 333_020)),
                      ]),
                    }
                  : {}),
                ...(rand() < 0.5 ? { u: int(rand, 0, 3) } : {}),
              },
            }
          : {}),
        ...(rand() < 0.6 ? { p: byId(1_000, n * 4, () => [int(rand, 0, 30)]) } : {}),
      }
    }
    case 'wardrobe': {
      const kind = () => {
        let id = 0
        const owned = Array.from({ length: int(rand, 0, 30) }, () => (id += int(rand, 1, 5)))
        return {
          o: owned,
          w: [
            ['Furina', owned[0] ?? 1],
            ['Traveler', 140_001],
          ],
          ...(rand() < 0.5 ? { e: [[owned[0] ?? 1, int(rand, 1.7e9, 1.9e9)]] } : {}),
        }
      }
      return {
        ...(rand() < 0.8 ? { o: kind() } : {}),
        ...(rand() < 0.8 ? { g: kind() } : {}),
        ...(rand() < 0.5 ? { s: kind() } : {}),
        ...(rand() < 0.5 ? { t: kind() } : {}),
        ...(rand() < 0.7
          ? {
              m: [
                [1, 'Team ★', ['Furina', 'Bennett']],
                [3, '', []],
              ],
            }
          : {}),
        ...(rand() < 0.5 ? { c: int(rand, 1, 4) } : {}),
      }
    }
    case 'extras':
      return {
        ...(rand() < 0.7
          ? {
              t: sortedIds(int(rand, 0, 5)).map((_, i, all) => [
                all.slice(0, i + 1).reduce((x, y) => x + y, 0),
                int(rand, 0, 30_000),
                Array.from({ length: int(rand, 0, 5) }, () => int(rand, 0, 20_000)),
              ]),
            }
          : {}),
        ...(rand() < 0.6
          ? {
              m: sortedIds(int(rand, 0, 20)).map((_, i, all) => [
                all.slice(0, i + 1).reduce((x, y) => x + y, 0),
                rand() < 0.3 ? 0 : int(rand, 1.7e9, 1.8e9),
              ]),
            }
          : {}),
        ...(rand() < 0.6
          ? {
              e: {
                ...(rand() < 0.8
                  ? { t: [int(rand, 1, 40), int(rand, 0, 200), int(rand, 0, 5), int(rand, 0, 12)] }
                  : {}),
                ...(rand() < 0.8
                  ? {
                      s: Array.from({ length: int(rand, 0, 30) }, () => [
                        int(rand, 5_269_001, 5_269_030),
                        int(rand, 1, 6),
                        int(rand, 1.7e9, 1.8e9),
                        int(rand, 0, 1),
                        Array.from({ length: int(rand, 0, 3) }, () => [
                          int(rand, 0, 600),
                          int(rand, 0, 1),
                          Array.from({ length: int(rand, 0, 4) }, () =>
                            rand() < 0.1 ? `Custom${int(rand, 1, 9)}` : int(rand, 1, 110),
                          ),
                        ]),
                      ]),
                    }
                  : {}),
              },
            }
          : {}),
      }
    case 'progress':
      return {
        ...(rand() < 0.7
          ? {
              a: sortedIds(int(rand, 0, 20)).map((_, i, all) => [
                all.slice(0, i + 1).reduce((x, y) => x + y, 0),
                int(rand, 0, 5),
                int(rand, 1, 5),
              ]),
            }
          : {}),
        ...(rand() < 0.7
          ? {
              e: sortedIds(int(rand, 0, 8)).map((_, i, all) => [
                all.slice(0, i + 1).reduce((x, y) => x + y, 0),
                int(rand, 0, 9_999),
                int(rand, 1.7e9, 1.8e9),
                int(rand, 1.7e9, 1.8e9),
                sortedIds(int(rand, 0, 6)).map((_, j, ws) => [
                  ws.slice(0, j + 1).reduce((x, y) => x + y, 0),
                  int(rand, 0, 10),
                  int(rand, 1, 10),
                  int(rand, 0, 1),
                ]),
              ]),
            }
          : {}),
      }
    case 'exploration': {
      const rows = (cells: () => number[]) =>
        sortedIds(int(rand, 0, 20)).map((_, i, all) => [
          all.slice(0, i + 1).reduce((a, b) => a + b, 0),
          ...cells(),
        ])
      const ascending = (count: number) => {
        let id = 0
        return Array.from({ length: count }, () => (id += int(rand, 1, 9)))
      }
      return {
        ...(rand() < 0.8 ? { s: rows(() => [int(rand, 1, 10), int(rand, 0, 30)]) } : {}),
        ...(rand() < 0.7 ? { f: rows(() => [int(rand, 1, 50)]) } : {}),
        ...(rand() < 0.7
          ? {
              p: rows(() => []).map(([id]) => [
                id,
                ascending(int(rand, 0, 900)),
                ascending(int(rand, 0, 60)),
              ]),
            }
          : {}),
        ...(rand() < 0.7 ? { x: rows(() => [int(rand, 0, 1_000)]) } : {}),
        ...(rand() < 0.5 ? { r: rows(() => [int(rand, 1, 10)]) } : {}),
      }
    }
  }
}

const KINDS = Object.keys(SECTION_KIND_CODES) as SectionKind[]
const DELTA_KINDS: SectionKind[] = ['materials', 'artifacts', 'achievementTimes']

/** The value as a decode gives it back: `b` names the base by the key given. */
const withB = (value: unknown, key: string) =>
  value && typeof value === 'object' && !Array.isArray(value) && 'b' in value
    ? { ...(value as object), b: key }
    : value

describe('section blobs', () => {
  it('round-trips every kind, full and delta, through every compression', () => {
    const rand = random(7)
    for (let round = 0; round < 60; round++) {
      for (const kind of KINDS) {
        for (const delta of DELTA_KINDS.includes(kind) ? [false, true] : [false]) {
          const value = randomSection(rand, kind, delta)
          const base = delta
            ? decodeSectionBlob(
                kindCode(kind, false),
                encodeSectionBlob(kind, randomSection(rand, kind, false), false, null).data,
                null,
                null,
              )
            : null
          const blob = encodeSectionBlob(kind, value, delta, base)
          const back = decodeSectionBlob(kindCode(kind, delta), blob.data, base, '#9')
          expect(json(back.value), `${kind} ${delta ? 'delta' : 'full'}`).toBe(
            json(withB(value, '#9')),
          )
          expect([...back.payload]).toEqual([...blob.payload])
        }
      }
    }
  })

  it('stores what no binary layout holds exactly as JSON, still exactly', () => {
    const odd: [SectionKind, unknown][] = [
      ['materials', { m: [['Mora', 1.5]] }],
      ['materials', { m: [[1, 1e20]] }],
      ['characters', [[1, 90.5]]],
      ['achievements', [-3, 4]],
      ['artifacts', { i: [1], l: [0], f: [1], extra: true }],
      ['player', { ar: 60, nested: { a: 1 } }],
    ]
    for (const [kind, value] of odd) {
      const blob = encodeSectionBlob(kind, value, false, null)
      expect(blob.payload[0]! & 0xf0, kind).toBe(0x00)
      expect(json(decodeSectionBlob(kindCode(kind, false), blob.data, null, null).value)).toBe(
        json(value),
      )
    }
  })

  it('compresses a section against a similar base, and needs that base to decode', () => {
    const base = encodeSectionBlob(
      'weapons',
      randomSection(random(1), 'weapons', false),
      false,
      null,
    )
    const baseDecoded = decodeSectionBlob(kindCode('weapons', false), base.data, null, null)
    const changed = structuredClone(baseDecoded.value) as number[][]
    if (changed[0]) changed[0][1] = 77
    const { standalone, withBase } = encodeSectionBlobVariants('weapons', changed, baseDecoded)
    expect(withBase).not.toBeNull()
    expect(withBase!.data.length).toBeLessThan(standalone.data.length / 4)
    expect(() => decodeSectionBlob(kindCode('weapons', false), withBase!.data, null, null)).toThrow(
      CorruptDataError,
    )
    expect(
      json(decodeSectionBlob(kindCode('weapons', false), withBase!.data, baseDecoded, null).value),
    ).toBe(json(changed))
  })

  it('rejects unknown formats, kinds and a delta flag that disagrees with its kind', () => {
    const blob = encodeSectionBlob('materials', { m: [[1, 2]] }, false, null)
    expect(() =>
      decodeSectionBlob(kindCode('materials', false), new Uint8Array([0x7f]), null, null),
    ).toThrow(CorruptDataError)
    expect(() => decodeSectionBlob(99, blob.data, null, null)).toThrow(CorruptDataError)
    if (blob.data[0]! >> 4 === 1) {
      expect(() => decodeSectionBlob(kindCode('materials', true), blob.data, null, '#1')).toThrow(
        CorruptDataError,
      )
    }
  })

  it('reads v1 blobs (deflated JSON) behind the legacy format byte', async () => {
    const v1 = '{"b":"0123456789abcdef0123456789abcdef","m":[[1,2],["X",-1]]}'
    const deflated = await deflateRaw(v1)
    const tagged = new Uint8Array([LEGACY_FORMAT, ...deflated])
    // As a v1 delta it keeps its own `b` when read as a legacy blob...
    const bundle = openBundle(writeBundleV2([], { legacy: [{ hash: 'h1', data: deflated }] }))
    expect(await bundle.sections.text('h1')).toBe(v1)
    // ...and as a v2 JSON blob of a delta, `b` names the base by key.
    const decoded = decodeSectionBlob(
      kindCode('materials', true),
      tagged,
      { value: {}, payload: new Uint8Array([0]) },
      '#4',
    )
    expect(decoded.value).toEqual({
      b: '#4',
      m: [
        [1, 2],
        ['X', -1],
      ],
    })
  })

  it('pins the codes and key lists stored data depends on (append only)', () => {
    expect(SECTION_KIND_CODES).toEqual({
      characters: 1,
      weapons: 2,
      artifacts: 3,
      materials: 4,
      achievements: 5,
      player: 6,
      achievementTimes: 7,
      characterExtras: 8,
      anecdotes: 9,
      tasks: 10,
      collections: 11,
      collections2: 12,
      wardrobe: 13,
      exploration: 14,
      progress: 15,
      extras: 32,
    })
    expect(KIND_DELTA).toBe(0x10)
    expect(LEGACY_FORMAT).toBe(0x01)
    expect([...SLOT_KEYS]).toEqual(['flower', 'plume', 'sands', 'goblet', 'circlet'])
    expect([...SUBSTAT_KEYS].slice(0, 10)).toEqual([
      'hp',
      'hp_',
      'atk',
      'atk_',
      'def',
      'def_',
      'eleMas',
      'enerRech_',
      'critRate_',
      'critDMG_',
    ])
    expect([...STAT_KEYS].slice(0, 19)).toEqual([
      'hp',
      'hp_',
      'atk',
      'atk_',
      'def',
      'def_',
      'eleMas',
      'enerRech_',
      'critRate_',
      'critDMG_',
      'heal_',
      'physical_dmg_',
      'anemo_dmg_',
      'geo_dmg_',
      'electro_dmg_',
      'hydro_dmg_',
      'pyro_dmg_',
      'cryo_dmg_',
      'dendro_dmg_',
    ])
    expect([...SOURCES].slice(0, 6)).toEqual([
      'Irminsul',
      'Unknown',
      'Genshin Optimizer',
      'Inventory_Kamera',
      'AdeptiScanner',
      'Genshin-Data-Tracker',
    ])
    expect([...SLOTS]).toEqual([
      'characters',
      'weapons',
      'artifacts',
      'materials',
      'achievements',
      'player',
      'achievementTimes',
      'characterExtras',
      'anecdotes',
      'tasks',
      'collections',
      'collections2',
      'wardrobe',
      'exploration',
      'progress',
      'extras',
    ])
    expect(contentKey('ffffffffffff' + '0'.repeat(20))).toBe(2 ** 47 - 1)
    expect(shortHashHex('0123456789abcdef' + 'f'.repeat(16))).toBe('0123456789abcdef')
  })
})

// ---------------------------------------------------------------- catalog

function oddIdentity(rand: () => number): ArtifactIdentity {
  const a = syntheticArtifact(rand, pick(rand, [0, 4, 20]))
  const identity: ArtifactIdentity = {
    setKey: a.setKey,
    slotKey: a.slotKey,
    level: a.level,
    rarity: a.rarity,
    mainStatKey: a.mainStatKey,
    substats: a.substats,
    totalRolls: a.totalRolls ?? 0,
    elixerCrafted: rand() < 0.1,
    unactivatedSubstats: a.unactivatedSubstats ?? [],
  }
  switch (int(rand, 0, 12)) {
    case 0:
      identity.setKey = 'ASetFromTheNextPatch'
      break
    case 1:
      identity.slotKey = 'hat'
      break
    case 2:
      identity.substats = [{ key: 'newStat_', value: 1.25 }]
      break
    case 3:
      identity.substats = identity.substats.map((s) => ({ key: s.key, value: s.value }))
      break
    case 4:
      identity.substats = [{ key: 'critRate_', value: 0.1 + 0.2, initialValue: 2.72 }]
      break
    case 5:
      identity.level = 3.5
      break
    case 6:
      identity.rarity = 9
      break
    case 7:
      identity.substats = [{ key: 'hp', value: -0, initialValue: 0 }]
      break
    case 8:
      identity.mainStatKey = ''
      break
  }
  return identity
}

describe('compact catalog', () => {
  it('round-trips identities exactly, odd ones too, many to a chunk', () => {
    const rand = random(3)
    const entries = Array.from({ length: 700 }, (_, i) => ({
      id: 1000 + i * int(rand, 1, 30),
      identity: oddIdentity(rand),
    }))
    const data = encodeCatalogChunk(entries)
    const back = decodeCatalogChunk(data)
    expect(back.map((e) => e.id)).toEqual(entries.map((e) => e.id))
    back.forEach((entry, i) => {
      expect(artifactIdentityText(entry.identity)).toBe(artifactIdentityText(entries[i]!.identity))
      expect(json(entry.identity)).toBe(json(entries[i]!.identity))
      expect(entry.key).toBe(artifactKeyString(entries[i]!.identity))
    })
    // The real thing is ~15 bytes per piece before DEFLATE; this mix is odder.
    expect(data.length / entries.length).toBeLessThan(25)
  })

  it('gives equal keys exactly to equal identities', () => {
    const rand = random(4)
    const identities = Array.from({ length: 400 }, () => oddIdentity(rand))
    const byKey = new Map<string, string>()
    for (const identity of identities) {
      const text = artifactIdentityText(identity)
      const key = artifactKeyString(identity)
      const seen = byKey.get(key)
      if (seen !== undefined) expect(seen).toBe(text)
      byKey.set(key, text)
    }
    const copy = structuredClone(identities[0]!)
    expect(artifactKeyString(copy)).toBe(artifactKeyString(identities[0]!))
  })

  it('refuses a damaged chunk', () => {
    const data = encodeCatalogChunk([{ id: 5, identity: oddIdentity(random(9)) }])
    expect(() => decodeCatalogChunk(data.subarray(0, data.length - 2))).toThrow(CorruptDataError)
    expect(() => decodeCatalogChunk(new Uint8Array([9, 1, 2]))).toThrow(CorruptDataError)
  })
})

// ---------------------------------------------------------------- meta

describe('snapshot meta and the player split', () => {
  const summary = {
    characters: 103,
    weapons: 1122,
    artifacts: 1847,
    materials: 1552,
    mora: 52_234_276,
    primogem: 16_000,
    artifact3: 110,
    artifact4: 50,
  }

  it('round-trips binary, and falls back to JSON for anything else', () => {
    const cases: SnapshotMeta[] = [
      { format: 'GOOD', version: 3, source: 'Irminsul', summary, playerVars: { resin: 57 } },
      { format: 'GOOD', version: 2, source: 'MyScanner', summary, playerVars: {} },
      {
        format: 'GOOD',
        version: 1,
        source: 'Unknown',
        summary: { ...summary, mora: 1.5 },
        playerVars: { arExp: 3, resin: 0 },
      },
      {
        format: 'GOOD',
        version: 3,
        source: 'Irminsul',
        summary: { ...summary, extra: 1 } as never,
        playerVars: {},
      },
      { format: 'NOT', version: 3, source: 'Irminsul', summary, playerVars: {} },
    ]
    for (const meta of cases) {
      const data = encodeSnapshotMeta(meta)
      const back = decodeSnapshotMeta(data)
      expect(json(back.summary)).toBe(json(meta.summary))
      expect(back).toMatchObject({
        format: meta.format,
        version: meta.version,
        source: meta.source,
      })
      expect(back.playerVars).toEqual(meta.playerVars)
    }
    expect(encodeSnapshotMeta(cases[0]!).length).toBeLessThan(25)
    expect(() => decodeSnapshotMeta(new Uint8Array([7]))).toThrow(CorruptDataError)
  })

  it('splits off the per-login player values and merges them back byte for byte', () => {
    const full = {
      uid: 811111111,
      ar: 58,
      arExp: 1234,
      wl: 8,
      wlLimit: 9,
      resin: 57,
      storyKeys: 3,
      maxStamina: 24000,
      gameData: '792978e5503ecfba73dcb3562ed44a0d35a2abe2',
    }
    const { stable, vars } = splitPlayer(full)
    expect(vars).toEqual({ resin: 57, arExp: 1234 })
    expect('resin' in stable).toBe(false)
    expect(json(mergePlayer(stable, vars))).toBe(json(full))
    // Another login, same account: the same stored part.
    expect(json(splitPlayer({ ...full, resin: 3 }).stable)).toBe(json(stable))
    // An order merging cannot rebuild stays whole.
    const odd = { resin: 1, uid: 811111111 }
    expect(splitPlayer(odd)).toEqual({ stable: odd, vars: {} })
  })
})

// ---------------------------------------------------------------- planner

/** The v1 full decode of a capture: what every stored form must give back. */
async function v1File(
  encoded: EncodedSnapshot,
  good: Good,
  catalog: Map<number, ArtifactIdentity>,
) {
  return json(
    decodeSnapshot(
      {
        format: good.format,
        version: good.version,
        source: good.source,
        takenAt: good.timestamp!,
        characters: encoded.characters.json,
        weapons: encoded.weapons.json,
        artifacts: encoded.artifacts.json,
        materials: encoded.materials.json,
        materialsKeyframe: null,
        achievements: encoded.achievements?.json ?? null,
        player: encoded.player?.json ?? null,
        achievementTimes: encoded.achievementTimes?.json ?? null,
        characterExtras: encoded.characterExtras?.json ?? null,
        anecdotes: encoded.anecdotes?.json ?? null,
        tasks: encoded.tasks?.json ?? null,
        collections: encoded.collections?.json ?? null,
        collections2: encoded.collections2?.json ?? null,
        wardrobe: encoded.wardrobe?.json ?? null,
      },
      catalog,
      MATERIALS,
    ),
  )
}

/**
 * A decoded file with its materials in key order. A materials delta lists a
 * key that is new since its keyframe after the keyframe's keys, so a capture
 * stored as a delta exports its materials in another order than the same
 * capture stored in full: in v1 as in v2 (the order is whichever the stored
 * form gives, and repack keeps every stored form). Everything else is
 * compared byte for byte.
 */
function materialsInKeyOrder(file: string): string {
  const good = JSON.parse(file) as Good
  return json({ ...good, materials: Object.fromEntries(Object.entries(good.materials).sort()) })
}

/** A model of the v2 import over an in-memory section_blobs table. */
class V2Store {
  readonly blobs = new Map<number, RawBlob & { hash: string }>()
  readonly byHash = new Map<string, { id: number; code: number }>()
  readonly ids = new Map<string, number>()
  readonly catalog = new Map<number, ArtifactIdentity>()
  latest: Record<string, number | null> | null = null
  bytes = 0
  v1Bytes = 0
  private readonly v1Stored = new Set<string>()
  private next = 1
  private v1Latest: {
    encoded: EncodedSnapshot
    bases: Record<string, { hash: string; json: string; size: number } | null | undefined>
  } | null = null

  async upload(good: Good) {
    const prepared = await prepareSnapshot(good, { materials: MATERIALS })
    prepared.artifactHashes.forEach((hash, i) => {
      if (this.ids.has(hash)) return
      const id = this.ids.size + 1
      this.ids.set(hash, id)
      this.catalog.set(id, prepared.good.artifacts[i]!.identity)
    })
    const encoded = await encodeSnapshot(prepared, this.ids, MATERIALS)
    const decoder = new BlobDecoder((id) => this.blobs.get(id))
    const known = (id: number | null | undefined): KnownBlob | null => {
      if (!id) return null
      const blob = this.blobs.get(id)!
      return {
        id,
        code: blob.code,
        hash: blob.hash,
        size: blob.data.length,
        decoded: decoder.decode(id),
        base: known(blob.baseId),
      }
    }
    const latest = this.latest
      ? Object.fromEntries(SLOTS.map((s) => [s, known(this.latest![s])]))
      : {}
    const plan = await planSnapshotV2({
      encoded,
      prepared,
      materialsDictionary: MATERIALS,
      latest,
      existing: this.byHash,
    })
    for (const blob of plan.blobs) {
      const id = this.next++
      const baseId =
        blob.base === null
          ? null
          : 'id' in blob.base
            ? blob.base.id
            : this.byHash.get(blob.base.hash)!.id
      this.blobs.set(id, { id, code: blob.code, baseId, data: blob.data, hash: blob.hash })
      this.byHash.set(blob.hash, { id, code: blob.code })
      this.bytes += blob.data.length
    }
    const refs = Object.fromEntries(
      SLOTS.map((s) => {
        const ref = plan.refs[s]
        return [s, ref === null ? null : 'id' in ref ? ref.id : this.byHash.get(ref.hash)!.id]
      }),
    )
    this.latest = refs
    await this.v1Upload(encoded, prepared)
    return { encoded, prepared, plan, refs }
  }

  /** The same capture as v1 would store it (sizes only). */
  private async v1Upload(
    encoded: EncodedSnapshot,
    prepared: Awaited<ReturnType<typeof prepareSnapshot>>,
  ) {
    const bases = this.v1Latest?.bases ?? {
      materials: null,
      artifacts: null,
      achievementTimes: null,
    }
    const stored = this.v1Stored
    const withDeltas = await withBases(encoded, prepared, MATERIALS, bases as never, (hash) =>
      stored.has(hash),
    )
    for (const section of [
      withDeltas.characters,
      withDeltas.weapons,
      withDeltas.artifacts,
      withDeltas.materials,
      withDeltas.achievements,
      withDeltas.player,
      withDeltas.achievementTimes,
      withDeltas.characterExtras,
    ]) {
      if (!section || stored.has(section.hash)) continue
      stored.add(section.hash)
      this.v1Bytes += (await deflateRaw(section.json)).length
    }
    const full = async (s: { hash: string; json: string } | null) =>
      s ? { hash: s.hash, json: s.json, size: (await deflateRaw(s.json)).length } : null
    this.v1Latest = {
      encoded,
      bases: {
        materials: withDeltas.materialsBase ? bases.materials : await full(encoded.materials),
        artifacts: withDeltas.artifactsBase ? bases.artifacts : await full(encoded.artifacts),
        achievementTimes: withDeltas.achievementTimesBase
          ? bases.achievementTimes
          : await full(encoded.achievementTimes),
      },
    }
  }

  /** The snapshot as a GDT2 bundle entry, and the GOOD file the browser rebuilds from it. */
  async file(refs: Record<string, number | null>, good: Good, vars: object): Promise<string> {
    const meta = new Map([...this.blobs].map(([id, b]) => [id, b]))
    const deltaBase = (id: number | null) => {
      const blob = id === null ? undefined : meta.get(id)
      return blob && blob.code & KIND_DELTA ? blob.baseId : null
    }
    const entry: BundleSnapshotV2 = {
      id: 1,
      takenAt: good.timestamp!,
      lastSeenAt: good.timestamp!,
      format: good.format,
      version: good.version,
      source: good.source,
      characters: refs.characters!,
      weapons: refs.weapons!,
      artifacts: refs.artifacts!,
      artifactsBase: deltaBase(refs.artifacts!),
      materials: refs.materials!,
      materialsKeyframe: deltaBase(refs.materials!) ?? refs.materials!,
      achievements: refs.achievements ?? null,
      player: refs.player ?? null,
      achievementTimes: refs.achievementTimes ?? null,
      achievementTimesBase: deltaBase(refs.achievementTimes ?? null),
      characterExtras: refs.characterExtras ?? null,
      anecdotes: refs.anecdotes ?? null,
      tasks: refs.tasks ?? null,
      collections: refs.collections ?? null,
      collections2: refs.collections2 ?? null,
      wardrobe: refs.wardrobe ?? null,
      ...(Object.keys(vars).length > 0 ? { playerVars: vars } : {}),
    }
    // The blobs the snapshot needs, bases included, as the server sends them.
    const needed = new Map<number, RawBlob>()
    const add = (id: number | null | undefined) => {
      while (id) {
        const { code, baseId, data } = this.blobs.get(id)!
        needed.set(id, { id, code, baseId, data })
        id = baseId
      }
    }
    for (const id of Object.values(refs)) add(id)
    const blobs = [...needed.values()]
    const { snapshots, texts } = await decodeBundle(writeBundleV2([entry], { blobs }))
    const snapshot = snapshots[0]!
    return json(
      decodeSnapshot(
        storedSnapshotOf(snapshot, (key) => texts.get(key)!),
        this.catalog,
        MATERIALS,
      ),
    )
  }
}

describe('storage v2 of a capture sequence', () => {
  it('stores each capture so it decodes byte for byte, at a fraction of v1', async () => {
    const store = new V2Store()
    let good = syntheticGood(5)
    const perSnapshot: number[] = []
    let depth = 0
    for (let step = 0; step < 40; step++) {
      if (step > 0) good = playOn(good, step)
      const before = store.bytes
      const { encoded, plan, refs } = await store.upload(good)
      perSnapshot.push(store.bytes - before)
      expect(
        materialsInKeyOrder(await store.file(refs, good, plan.playerVars)),
        `capture ${step}`,
      ).toBe(materialsInKeyOrder(await v1File(encoded, good, store.catalog)))
      for (const id of Object.values(refs)) {
        let d = 0
        for (let blob = id === null ? undefined : store.blobs.get(id); blob?.baseId; d++) {
          blob = store.blobs.get(blob.baseId)
        }
        depth = Math.max(depth, d)
      }
    }
    expect(depth).toBeLessThanOrEqual(2)
    const later = perSnapshot.slice(1).sort((a, b) => a - b)
    const median = later[Math.floor(later.length / 2)]!
    // Measured on this sequence: a few hundred bytes per later capture, where
    // v1 stores a few kilobytes; the first capture is the account's base.
    expect(median).toBeLessThan(400)
    expect(store.bytes).toBeLessThan(store.v1Bytes / 2)
  }, 60_000)

  it('stores nothing for a later login that only moved resin', async () => {
    const store = new V2Store()
    const good = syntheticGood(6)
    await store.upload(good)
    const { plan } = await store.upload({
      ...good,
      gi_player: { ...good.gi_player!, resin: 3 },
      timestamp: good.timestamp! + 1,
    })
    expect(plan.blobs).toEqual([])
    expect(plan.playerVars).toEqual({ resin: 3, arExp: 0 })
  })
})

// ---------------------------------------------------------------- bundles

describe('bundles', () => {
  it('reads GDT1 as before and GDT2 with v1 and v2 sections side by side', async () => {
    const v1Text = '[[1,90,6,2,6,10,10]]'
    const v1Data = await deflateRaw(v1Text)
    const legacy: BundleSnapshot = {
      id: 1,
      takenAt: 1,
      lastSeenAt: 1,
      format: 'GOOD',
      version: 3,
      source: 'Irminsul',
      characters: 'c1',
      weapons: 'c1',
      artifacts: 'c1',
      materials: 'c1',
      materialsKeyframe: 'c1',
      achievements: null,
    }
    const gdt1 = await decodeBundle(
      writeBundle({ snapshots: [legacy], blobs: ['c1'] }, new Map([['c1', v1Data]])),
    )
    expect(gdt1.texts.get('c1')).toBe(v1Text)

    const player = encodeSectionBlob('player', { uid: 812345678, ar: 60 }, false, null)
    const blobs: RawBlob[] = [
      { id: 7, code: kindCode('player', false), baseId: null, data: player.data },
    ]
    const entry = (id: number, resin: number): BundleSnapshotV2 => ({
      id,
      takenAt: id,
      lastSeenAt: id,
      format: 'GOOD',
      version: 3,
      source: 'Irminsul',
      characters: 'c1',
      weapons: 'c1',
      artifacts: 'c1',
      artifactsBase: null,
      materials: 'c1',
      materialsKeyframe: 'c1',
      achievements: null,
      player: 7,
      achievementTimes: null,
      achievementTimesBase: null,
      characterExtras: null,
      playerVars: { resin },
    })
    const gdt2 = writeBundleV2([entry(2, 10), entry(3, 10), entry(4, 99)], {
      legacy: [{ hash: 'c1', data: v1Data }],
      blobs,
    })
    const { snapshots, texts } = await decodeBundle(gdt2)
    const [a, b, c] = snapshots
    expect(texts.get(a!.characters)).toBe(v1Text)
    // Same per-login values, same key (one login); different ones, another key.
    expect(a!.player).toBe(b!.player)
    expect(c!.player).not.toBe(a!.player)
    expect(JSON.parse(texts.get(a!.player!)!)).toEqual({ uid: 812345678, ar: 60, resin: 10 })
    expect(JSON.parse(texts.get(c!.player!)!)).toEqual({ uid: 812345678, ar: 60, resin: 99 })
    expect(sectionHashesOf(a!)).toContain(a!.player)

    // A bundle of some sections names the others without carrying them.
    const partial = await decodeBundle(
      writeBundleV2([{ ...entry(5, 1), characters: 99, weapons: 98 }], { blobs }),
    )
    expect([...partial.texts.keys()].sort()).toEqual([partial.snapshots[0]!.player].sort())
  })
})

// Real exports are personal inventory data, so they are never committed. Point
// GDT_GOOD_SAMPLES_DIR at a folder of GOOD files to run this locally.
const samplesDir = process.env.GDT_GOOD_SAMPLES_DIR
describe.skipIf(!samplesDir)('real GOOD exports in storage v2', () => {
  it('stores every file in order so it decodes as v1 does', async () => {
    const { readdirSync, readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const files = readdirSync(samplesDir!)
      .filter((f) => f.endsWith('.json'))
      .sort()
    const store = new V2Store()
    for (const [index, file] of files.entries()) {
      const good = JSON.parse(readFileSync(join(samplesDir!, file), 'utf8')) as Good
      good.timestamp ??= index + 1
      const { encoded, plan, refs } = await store.upload(good)
      expect(materialsInKeyOrder(await store.file(refs, good, plan.playerVars)), file).toBe(
        materialsInKeyOrder(await v1File(encoded, good, store.catalog)),
      )
    }
    console.log(
      `${files.length} files: sections ${(store.bytes / 1024).toFixed(1)} KB in v2, ` +
        `${(store.v1Bytes / 1024).toFixed(1)} KB in v1`,
    )
  }, 600_000)
})
