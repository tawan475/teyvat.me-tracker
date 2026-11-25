/**
 * GGScanner's per-substat roll lists (`substats[n].rolls`, display units, in
 * order within the line): read as a `~` RollsText beside the identity, given
 * back the same way on export (package T5).
 */
import { describe, expect, it } from 'vitest'
import {
  artifactIdentityText,
  artifactKey,
  artifactKeyString,
  bytesToHex,
  checkRolls,
  decodeCatalogChunk,
  decodeSnapshot,
  encodeCatalogChunk,
  encodeSnapshot,
  hashArtifactIdentity,
  normalizeGood,
  prepareSnapshot,
  readRollLists,
  rollPairs,
  rollsAgree,
  rollsByLine,
  rollValue,
  withRollLists,
  type CatalogEntryBytes,
  type Good,
  type StoredSnapshot,
} from '../src'
import { MATERIALS } from '../src/dictionary/materials'
import cases from './fixtures/gi-rolls-cases.json'
import { random } from './synthetic'

type Loose = Record<string, any>

const asArtifact = (artifact: object, slotKey = 'flower'): Loose => ({
  setKey: 'GladiatorsFinale',
  slotKey,
  mainStatKey: 'hp',
  location: '',
  lock: false,
  ...artifact,
})

const fileOf = (artifacts: object[]) => ({
  format: 'GOOD',
  version: 2,
  source: 'yas-GOODScanner',
  characters: [{ key: 'Furina', level: 90, constellation: 0, ascension: 6, talent: {} }],
  artifacts,
})

const readOne = (artifact: object) => normalizeGood(fileOf([artifact])).artifacts[0]!

/**
 * A contract case as GGScanner writes it: no gi_rolls, each substat's roll
 * values in its own order, nudged by `noise` (its packet captures list the
 * game's float values; the tier table holds them rounded to 0.01).
 */
function ggscanner(c: (typeof cases.valid)[number], noise = 0.004): Loose {
  const { gi_rolls: text, ...rest } = c.artifact
  const byLine = rollsByLine(text, c.artifact.substats.length)
  return asArtifact({
    ...rest,
    substats: c.artifact.substats.map((s, line) => ({
      ...s,
      rolls: byLine[line]!.map((tier) => rollValue(s.key, c.artifact.rarity, tier)! + noise),
    })),
  })
}

/** The `~` text of a case: its pairs grouped by line, each line in its own order. */
const unorderedOf = (text: string, lines: number) =>
  '~' +
  rollsByLine(text, lines)
    .map((tiers, line) => tiers.map((t) => `${line}${t}`).join(''))
    .join('')

/** The same artifact with its lists edited by `edit` (line, list) → list. */
function editLists(artifact: Loose, edit: (line: number, list: unknown[]) => unknown): Loose {
  return {
    ...artifact,
    substats: artifact.substats.map((s: Loose, line: number) => ({
      ...s,
      rolls: edit(line, s.rolls),
    })),
  }
}

const withoutLists = (artifact: Loose): Loose => ({
  ...artifact,
  substats: artifact.substats.map(({ rolls: _, ...s }: Loose) => s),
})

describe("reading GGScanner's roll lists", () => {
  it.each(cases.valid.map((c) => [c.name, c] as const))('reads %s as a `~` text', (_, c) => {
    const occurrence = readOne(ggscanner(c))
    const expected = unorderedOf(c.artifact.gi_rolls, c.artifact.substats.length)
    expect(occurrence.rolls).toBe(expected)
    expect(rollsByLine(occurrence.rolls!, 4)).toEqual(rollsByLine(c.artifact.gi_rolls, 4))
    // Everything else as if the lists were absent; no list on the identity.
    const plain = readOne(withoutLists(ggscanner(c)))
    expect(plain.rolls).toBeUndefined()
    expect(occurrence.identity).toEqual(plain.identity)
    expect(occurrence.state).toEqual(plain.state)
    expect(JSON.stringify(occurrence.identity)).not.toContain('rolls')
  })

  it('reads exact tier values and values within 0.011 / 0.051, no further', () => {
    const c = cases.valid[1]! // hp, critRate_, critDMG_, def: flat and percentage lines
    expect(readOne(ggscanner(c, 0)).rolls).toBeDefined()
    expect(readOne(ggscanner(c, 0.0105)).rolls).toBeDefined()
    expect(readOne(ggscanner(c, -0.0105)).rolls).toBeDefined()
    // Over 0.011 on a percentage line alone.
    const pct = editLists(ggscanner(c, 0), (line, list) =>
      line === 1 ? list.map((v, i) => (i === 0 ? (v as number) + 0.0125 : v)) : list,
    )
    expect(readOne(pct).rolls).toBeUndefined()
    // A flat line: 0.05 off is read, 0.052 is not.
    const flat = (off: number) =>
      editLists(ggscanner(c, 0), (line, list) =>
        line === 0 ? list.map((v, i) => (i === 0 ? (v as number) + off : v)) : list,
      )
    expect(readOne(flat(0.05)).rolls).toBeDefined()
    expect(readOne(flat(-0.05)).rolls).toBeDefined()
    expect(readOne(flat(0.052)).rolls).toBeUndefined()
  })

  it('reads percentages only in display units (3.89, never 0.0389)', () => {
    // GGScanner's capture adds its listed values into the substat's value,
    // which is in display units (its round_stat rounds 3.89 to 3.9).
    const c = cases.valid[0]!
    const fractions = editLists(ggscanner(c, 0), (line, list) =>
      c.artifact.substats[line]!.key.endsWith('_') ? list.map((v) => (v as number) / 100) : list,
    )
    expect(readOne(fractions).rolls).toBeUndefined()
  })

  it('reads no rolls, and the same artifact otherwise, for anything that does not fit', () => {
    const c = cases.valid[0]! // lines [4,1,2] [2,4,3] [1] [3,4], nine rolls
    const good = ggscanner(c)
    const bad: [string, Loose][] = [
      [
        'a value off by more than the tolerance',
        editLists(good, (l, x) => (l === 2 ? [4.53 + 0.05] : x)),
      ],
      ['a line without a list', editLists(good, (l, x) => (l === 3 ? undefined : x))],
      ['a line whose list is not an array', editLists(good, (l, x) => (l === 3 ? '3.89' : x))],
      ['an empty list', editLists(good, (l, x) => (l === 2 ? [] : x))],
      ['one roll too many', editLists(good, (l, x) => (l === 2 ? [...x, 4.53] : x))],
      ['one roll too few', editLists(good, (l, x) => (l === 0 ? x.slice(0, 2) : x))],
      // [4,1,2] listed as [1,4,2]: the same sum, but the first is not initialValue.
      ['a wrong first value', editLists(good, (l, x) => (l === 0 ? [x[1], x[0], x[2]] : x))],
      // The last roll one tier up: the count is right, the sum is not.
      ['a sum that does not match', editLists(good, (l, x) => (l === 0 ? [x[0], x[1], 3.5] : x))],
      ['a string', editLists(good, (l, x) => (l === 1 ? ['6.22', ...x.slice(1)] : x))],
      ['NaN', editLists(good, (l, x) => (l === 1 ? [Number.NaN, ...x.slice(1)] : x))],
      ['Infinity', editLists(good, (l, x) => (l === 1 ? [Infinity, ...x.slice(1)] : x))],
      ['null', editLists(good, (l, x) => (l === 1 ? [null, ...x.slice(1)] : x))],
      ['10,000 entries', editLists(good, (l, x) => (l === 2 ? new Array(10_000).fill(4.53) : x))],
      ['a tier of another stat', editLists(good, (l, x) => (l === 2 ? [3.89] : x))],
      [
        'a substat without a key',
        { ...good, substats: [...good.substats, { value: 1, rolls: [1] }] },
      ],
      [
        'a fifth substat',
        { ...good, substats: [...good.substats, { key: 'hp', value: 239, rolls: [239] }] },
      ],
      ['an unknown rarity', { ...good, rarity: 6 }],
    ]
    for (const [name, artifact] of bad) {
      const occurrence = readOne(artifact)
      expect('rolls' in occurrence, name).toBe(false)
      expect(occurrence, name).toEqual(readOne(withoutLists(artifact)))
    }
  })

  it('lets a valid gi_rolls win, and reads the lists when gi_rolls is invalid', () => {
    const c = cases.valid[0]!
    const lists = ggscanner(c)
    expect(readOne({ ...lists, gi_rolls: c.artifact.gi_rolls }).rolls).toBe(c.artifact.gi_rolls)
    const unordered = unorderedOf(c.artifact.gi_rolls, 4)
    for (const broken of [
      '04',
      '0412213314011334',
      '99',
      12,
      '~' + c.artifact.gi_rolls.slice(0, 16),
    ]) {
      expect(readOne({ ...lists, gi_rolls: broken }).rolls).toBe(unordered)
    }
    // And a `~` text in gi_rolls is never read from a file, even a right one.
    expect(readOne({ ...withoutLists(lists), gi_rolls: unordered }).rolls).toBeUndefined()
  })

  it('never throws on random lists', () => {
    const next = random(5)
    const values = [3.89, 0.0389, '3.89', null, undefined, NaN, -1, 1e308, [], {}, 239, 16.2]
    const c = cases.valid[0]!
    for (let i = 0; i < 2_000; i++) {
      const artifact = editLists(ggscanner(c), (_line, list) =>
        next() < 0.3
          ? list
          : next() < 0.1
            ? values[Math.floor(next() * values.length)]
            : Array.from(
                { length: Math.floor(next() * 6) },
                () => values[Math.floor(next() * values.length)],
              ),
      )
      const occurrence = readOne(artifact)
      if (occurrence.rolls !== undefined) {
        expect(checkRolls(occurrence.identity, occurrence.rolls)).toBe(occurrence.rolls)
      }
      expect(() => readRollLists(artifact.rarity, artifact.substats)).not.toThrow()
    }
    // Over MAX_ROLLS values in all: refused before they are read.
    const long = editLists(ggscanner(c), (l, x) => (l === 2 ? new Array(10_000).fill(4.53) : x))
    expect(readRollLists(5, long.substats)).toBeUndefined()
    const seventeen = editLists(ggscanner(c), (l, x) => (l === 2 ? new Array(9).fill(4.53) : x))
    expect(readRollLists(5, seventeen.substats)).toBeUndefined()
    expect(readRollLists(5, ggscanner(c).substats)).toBe(unorderedOf(c.artifact.gi_rolls, 4))
    for (const junk of [null, undefined, 5, 'x', {}, [null], [{}], [{ key: 'hp' }]]) {
      expect(readRollLists(5, junk)).toBeUndefined()
    }
    expect(readRollLists('5', ggscanner(c).substats)).toBeUndefined()
  })
})

describe('roll lists are never part of the identity', () => {
  it('keeps packed bytes, keys, identity text and hash with or without the lists', async () => {
    for (const c of cases.valid) {
      const a = readOne(ggscanner(c))
      const b = readOne(withoutLists(ggscanner(c)))
      expect(a.rolls).toBeDefined()
      expect(JSON.stringify(a.identity)).toBe(JSON.stringify(b.identity))
      expect(bytesToHex(artifactKey(a.identity))).toBe(bytesToHex(artifactKey(b.identity)))
      expect(artifactKeyString(a.identity)).toBe(artifactKeyString(b.identity))
      expect(artifactIdentityText(a.identity)).toBe(artifactIdentityText(b.identity))
      expect(await hashArtifactIdentity(a.identity)).toBe(await hashArtifactIdentity(b.identity))
    }
  })
})

describe('giving roll lists back', () => {
  it('writes each `~` text as tier values that read back to the same text', () => {
    for (const c of cases.valid) {
      const text = unorderedOf(c.artifact.gi_rolls, c.artifact.substats.length)
      const substats = withRollLists(c.artifact.substats, c.artifact.rarity, text)
      expect(readRollLists(c.artifact.rarity, substats)).toBe(text)
      // Copies: the substats given keep no list.
      expect(c.artifact.substats.some((s) => 'rolls' in s)).toBe(false)
      substats.forEach((s, line) => {
        expect(s.rolls).toEqual(
          rollsByLine(text, 4)[line]!.map((t) => rollValue(s.key, c.artifact.rarity, t)),
        )
      })
    }
  })

  it('exports `~` rolls as per-substat lists, no gi_rolls, and imports the export to the same rolls', async () => {
    const pieces = cases.valid.map((c, i) => {
      const artifact = ggscanner(c)
      artifact.slotKey = ['flower', 'plume', 'sands', 'goblet', 'circlet'][i % 5]
      return artifact
    })
    const file = { ...fileOf(pieces), weapons: [], materials: {} }
    const prepared = await prepareSnapshot(file, { materials: MATERIALS })
    const ids = new Map<string, number>()
    const entries: CatalogEntryBytes[] = []
    prepared.artifactHashes.forEach((hash, i) => {
      if (ids.has(hash)) return
      ids.set(hash, ids.size + 1)
      const { identity, rolls } = prepared.good.artifacts[i]!
      expect(rolls?.startsWith('~')).toBe(true)
      entries.push({ id: ids.get(hash)!, identity, rolls })
    })
    const encoded = await encodeSnapshot(prepared, ids, MATERIALS)
    const stored: StoredSnapshot = {
      format: 'GOOD',
      version: 2,
      source: 'yas-GOODScanner',
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
    const identities = JSON.stringify([...catalog.values()])

    const decoded: Good = decodeSnapshot(stored, catalog, MATERIALS, rolls)
    expect(decoded.artifacts).toHaveLength(pieces.length)
    for (const artifact of decoded.artifacts) {
      expect(artifact).not.toHaveProperty('gi_rolls')
      expect(artifact.substats.every((s) => Array.isArray(s.rolls))).toBe(true)
    }
    // The catalog's identities were not touched.
    expect(JSON.stringify([...catalog.values()])).toBe(identities)
    // The export read again: the same rolls by identity.
    const again = normalizeGood({ ...file, artifacts: decoded.artifacts }).artifacts
    const byKey = (list: { identity: object; rolls?: string }[]) =>
      new Map(list.map((a) => [artifactIdentityText(a.identity as never), a.rolls]))
    expect(byKey(again)).toEqual(byKey(prepared.good.artifacts))
    // Without rolls: the lists are left out, the rest is the same.
    const bare = decodeSnapshot(stored, catalog, MATERIALS)
    expect(JSON.stringify(bare.artifacts)).not.toContain('"rolls"')
    expect(JSON.stringify(bare.artifacts)).toBe(
      JSON.stringify(decoded.artifacts.map((a) => withoutLists(a))),
    )
    // A `~` text that no longer fits its piece is left out on the way out.
    const [first, second] = [...rolls.keys()]
    const swapped = new Map(rolls).set(first!, rolls.get(second!)!)
    const checked = decodeSnapshot(stored, catalog, MATERIALS, swapped)
    const listed = checked.artifacts.filter((a) => a.substats.some((s) => 'rolls' in s))
    expect(listed).toHaveLength(rolls.size - 1)
  })
})

describe('rollsAgree', () => {
  it('is true for the same tiers per line in either form, false otherwise', () => {
    const c = cases.valid[0]!
    const ordered = c.artifact.gi_rolls
    const unordered = unorderedOf(ordered, 4)
    expect(rollsAgree(ordered, unordered)).toBe(true)
    expect(rollsAgree(unordered, ordered)).toBe(true)
    expect(rollsAgree(unordered, unordered)).toBe(true)
    expect(unordered).toBe('~040102121413213334')
    // One line's rolls in another order, a tier changed, a roll more.
    expect(rollsAgree(unordered, '~010402121413213334')).toBe(false)
    expect(rollsAgree(ordered, '~040103121413213334')).toBe(false)
    expect(rollsAgree(unordered, unordered + '34')).toBe(false)
    // Two ordered texts that differ only across lines each state an order: they disagree.
    expect(ordered).toBe('041221331401133402')
    expect(rollsAgree(ordered, '041221330114133402')).toBe(false)
    expect(rollsAgree('041221330114133402', unordered)).toBe(true)
    expect(rollsAgree(unordered, 'x' as never)).toBe(false)
    expect(rollPairs(unordered)).toHaveLength(9)
  })
})
