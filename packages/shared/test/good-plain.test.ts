import { describe, expect, it } from 'vitest'
import { toPlainGood } from '../src/good-plain'

// The keys Genshin Optimizer's GOOD schema reads (facts from its MIT schema,
// written out by hand): top level, and per item. `materials` is GOOD's (Seelie
// reads it) though GO's schema drops it; `timestamp` is GOOD's own field.
const TOP = [
  'format',
  'source',
  'version',
  'characters',
  'artifacts',
  'weapons',
  'materials',
  'timestamp',
]
const CHARACTER = ['key', 'level', 'constellation', 'ascension', 'talent']
const WEAPON = ['key', 'level', 'ascension', 'refinement', 'location', 'lock']
const ARTIFACT = [
  'setKey',
  'slotKey',
  'level',
  'rarity',
  'mainStatKey',
  'location',
  'lock',
  'substats',
  'totalRolls',
  'astralMark',
  'elixirCrafted',
  'unactivatedSubstats',
]

// A made-up Leyline file (UID 812345678), with every kind of extra.
function leyline(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: 'GOOD',
    version: 3,
    source: 'Teyvat.me',
    leyline: 1,
    characters: [
      {
        key: 'Bennett',
        level: 90,
        constellation: 6,
        ascension: 6,
        talent: { auto: 1, skill: 9, burst: 9 },
      },
    ],
    artifacts: [
      {
        setKey: 'NoblesseOblige',
        slotKey: 'flower',
        level: 20,
        rarity: 5,
        mainStatKey: 'hp',
        location: 'Bennett',
        lock: true,
        substats: [{ key: 'critRate_', value: 3.9, initialValue: 3.9 }],
        totalRolls: 5,
        astralMark: false,
        elixirCrafted: false,
        unactivatedSubstats: [],
        gi_rolls: '0004',
        gi_guid: '1234567890123',
        gi_exp: 0,
      },
    ],
    weapons: [
      {
        key: 'MistsplitterReforged',
        level: 90,
        ascension: 6,
        refinement: 1,
        location: 'Bennett',
        lock: true,
        gi_guid: '1234567890124',
        gi_exp: 0,
      },
    ],
    materials: { Mora: 1000 },
    timestamp: 1_700_000_000_000,
    gi_achievements: [80001],
    gi_achievement_times: { '80001': 1_700_000_000 },
    gi_player: { uid: 812345678, ar: 60 },
    gi_characters: { Bennett: { friendship: 10 } },
    gi_wardrobe: {},
    ...extra,
  }
}

const keys = (o: unknown) => Object.keys(o as object)
const sub = (list: string[], allowed: string[]) => list.every((k) => allowed.includes(k))

describe('toPlainGood', () => {
  it('keeps only what a GOOD reader knows', () => {
    const plain = toPlainGood(leyline())
    expect(sub(keys(plain), TOP)).toBe(true)
    expect(keys(plain)).not.toContain('leyline')
    const items = plain as Record<string, unknown[]>
    for (const c of items.characters!) expect(sub(keys(c), CHARACTER)).toBe(true)
    for (const w of items.weapons!) expect(sub(keys(w), WEAPON)).toBe(true)
    for (const a of items.artifacts!) expect(keys(a).sort()).toEqual([...ARTIFACT].sort())
    expect(plain.materials).toEqual({ Mora: 1000 })
    expect(plain.timestamp).toBe(1_700_000_000_000)
    expect(plain.source).toBe('Teyvat.me')
  })

  it('leaves the key of a part not shared out, never an empty list', () => {
    const plain = toPlainGood(
      leyline({
        characters: [],
        materials: {},
        gi_off: ['characters', 'materials', 'gi_player.profile'],
      }),
    )
    expect('characters' in plain).toBe(false)
    expect('materials' in plain).toBe(false)
    expect(plain.weapons).toHaveLength(1)
    expect(plain.artifacts).toHaveLength(1)
    expect('gi_off' in plain).toBe(false)
  })

  it('keeps a part that is shared but empty', () => {
    const plain = toPlainGood(leyline({ weapons: [], gi_off: ['characters'] }))
    expect(plain.weapons).toEqual([])
  })

  it('clamps the version to 1-3', () => {
    expect(toPlainGood(leyline({ version: 7 })).version).toBe(3)
    expect(toPlainGood(leyline({ version: 0 })).version).toBe(1)
    expect(toPlainGood(leyline({ version: 2 })).version).toBe(2)
    expect(toPlainGood(leyline({ version: 'x' })).version).toBe(3)
    const { version: _, ...without } = leyline()
    expect(toPlainGood(without).version).toBe(3)
  })

  it('is idempotent and leaves its input alone', () => {
    const input = leyline({ gi_off: ['weapons'] })
    const before = JSON.stringify(input)
    const once = toPlainGood(input)
    expect(JSON.stringify(input)).toBe(before)
    expect(toPlainGood(once)).toEqual(once)
    expect('weapons' in once).toBe(false)
  })

  it('keeps only GOOD substat keys: per-substat rolls and gi_* fields go', () => {
    const artifact = {
      setKey: 'GladiatorsFinale',
      slotKey: 'flower',
      level: 20,
      rarity: 5,
      mainStatKey: 'hp',
      location: '',
      lock: false,
      substats: [
        { key: 'critRate_', value: 7.8, initialValue: 3.9, rolls: [3.9, 3.9], gi_tier: 4 },
        { key: 'atk', value: 19 },
      ],
      unactivatedSubstats: [{ key: 'def', value: 23, rolls: [23], gi_x: 1 }],
      gi_rolls: '0001',
    }
    const input = leyline({ artifacts: [artifact] })
    const before = JSON.stringify(input)
    const plain = toPlainGood(input)
    const out = (plain.artifacts as Record<string, unknown>[])[0]!
    expect(out.substats).toEqual([
      { key: 'critRate_', value: 7.8, initialValue: 3.9 },
      { key: 'atk', value: 19 },
    ])
    expect(out.unactivatedSubstats).toEqual([{ key: 'def', value: 23 }])
    for (const sub of [...(out.substats as object[]), ...(out.unactivatedSubstats as object[])])
      for (const key of Object.keys(sub)) expect(['key', 'value', 'initialValue']).toContain(key)
    expect(JSON.stringify(input)).toBe(before)
  })
})
