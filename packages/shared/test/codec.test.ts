import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DELTA_GROWTH_BYTES,
  artifactRows,
  decodeAchievementTimes,
  decodeAnecdotes,
  decodeArtifacts,
  decodeCollections,
  decodeSectionBlob,
  decodeSnapshot,
  decodeTasks,
  decodeExploration,
  decodeProgress,
  decodeWardrobe,
  deflateRaw,
  deltaPaysOff,
  encodeAchievementTimes,
  encodeAchievementTimesDelta,
  encodeAnecdotes,
  encodeArtifactsDelta,
  encodeCollections,
  encodeCollections2,
  encodeSectionBlob,
  encodeSnapshot,
  encodeTasks,
  encodeExploration,
  encodeEndgame,
  encodeExtras,
  encodeProgress,
  encodeWardrobe,
  extraSectionsOf,
  GOOD_LIMITS,
  GoodFormatError,
  GoodLimitError,
  inflateRaw,
  kindCode,
  normalizeGood,
  prepareSnapshot,
  sectionHashesOf,
  storedSnapshotOf,
  withBases,
  type AchievementTimesSection,
  type ArtifactIdentity,
  type ArtifactsSection,
  type BundleSnapshot,
  type EncodedSnapshot,
  type Good,
  type PreparedSnapshot,
  type Section,
  type SectionBase,
  type SnapshotBases,
  type StoredSnapshot,
} from '../src'
import { MATERIALS } from '../src/dictionary/materials'
import {
  syntheticCollections,
  syntheticExploration,
  synthetic17,
  synthetic18,
  syntheticEndgame,
  syntheticRecipes,
  syntheticWardrobe,
} from './synthetic'

/** Stands in for the D1 catalog: assigns ids to new hashes, remembers identities. */
class Catalog {
  readonly ids = new Map<string, number>()
  readonly identities = new Map<number, ArtifactIdentity>()

  add(prepared: PreparedSnapshot): void {
    prepared.artifactHashes.forEach((hash, index) => {
      if (this.ids.has(hash)) return
      const id = this.ids.size + 1
      this.ids.set(hash, id)
      this.identities.set(id, prepared.good.artifacts[index]!.identity)
    })
  }
}

const NO_BASES: SnapshotBases = { materials: null, artifacts: null, achievementTimes: null }

/** Every section a test encoded, by hash: stands in for the blobs table. */
const sectionJson = new Map<string, string>()

function sectionsOf(encoded: EncodedSnapshot): Section[] {
  return [
    encoded.characters,
    encoded.weapons,
    encoded.artifacts,
    encoded.materials,
    ...(encoded.achievements ? [encoded.achievements] : []),
    ...extraSectionsOf(encoded),
  ]
}

/** `section` as a base for later snapshots, sized as it would be stored. */
async function baseOf(section: Section): Promise<SectionBase> {
  sectionJson.set(section.hash, section.json)
  return { hash: section.hash, json: section.json, size: (await deflateRaw(section.json)).length }
}

async function roundTrip(
  input: unknown,
  catalog = new Catalog(),
  bases: Partial<SnapshotBases> = {},
) {
  const prepared = await prepareSnapshot(input, { materials: MATERIALS })
  catalog.add(prepared)
  const encoded = await withBases(
    await encodeSnapshot(prepared, catalog.ids, MATERIALS),
    prepared,
    MATERIALS,
    { ...NO_BASES, ...bases },
  )
  for (const section of sectionsOf(encoded)) sectionJson.set(section.hash, section.json)
  const decoded = decodeSnapshot(await storedOf(encoded, prepared), catalog.identities, MATERIALS)
  return { prepared, encoded, decoded }
}

/** A snapshot as the server would read it back, every section through deflate and back. */
async function storedOf(
  encoded: EncodedSnapshot,
  prepared: PreparedSnapshot,
): Promise<StoredSnapshot> {
  const base = async (hash: string | null) =>
    hash === null ? null : viaStorage(sectionJson.get(hash)!)
  return {
    format: prepared.good.format,
    version: prepared.good.version,
    source: prepared.good.source,
    takenAt: 1_700_000_000_000,
    characters: await viaStorage(encoded.characters.json),
    weapons: await viaStorage(encoded.weapons.json),
    artifacts: await viaStorage(encoded.artifacts.json),
    artifactsBase: await base(encoded.artifactsBase),
    materials: await viaStorage(encoded.materials.json),
    materialsKeyframe: await base(encoded.materialsBase),
    achievements: await optionalViaStorage(encoded.achievements),
    player: await optionalViaStorage(encoded.player),
    achievementTimes: await optionalViaStorage(encoded.achievementTimes),
    achievementTimesBase: await base(encoded.achievementTimesBase),
    characterExtras: await optionalViaStorage(encoded.characterExtras),
    anecdotes: await optionalViaStorage(encoded.anecdotes),
    tasks: await optionalViaStorage(encoded.tasks),
    collections: await optionalViaStorage(encoded.collections),
    collections2: await optionalViaStorage(encoded.collections2),
    wardrobe: await optionalViaStorage(encoded.wardrobe),
    exploration: await optionalViaStorage(encoded.exploration),
    progress: await optionalViaStorage(encoded.progress),
    extras: await optionalViaStorage(encoded.extras),
  }
}

async function optionalViaStorage(section: Section | null): Promise<string | null> {
  return section ? viaStorage(section.json) : null
}

/** Every section goes through deflate and back, as it would through D1. */
async function viaStorage(json: string): Promise<string> {
  return inflateRaw(await deflateRaw(json))
}

/**
 * A model of the worker's import (services/import.ts) over an in-memory
 * blobs table: each upload's bases are those of the latest snapshot by capture
 * time, and a section already stored costs nothing. `useBases: false` stores
 * every section in full, as rows written before a section kind could be a
 * delta are.
 */
class Store {
  readonly catalog = new Catalog()
  readonly blobs = new Map<string, { json: string; size: number }>()
  readonly rows: BundleSnapshot[] = []
  storedBytes = 0

  constructor(private readonly useBases = true) {}

  async upload(input: unknown, takenAt: number): Promise<BundleSnapshot> {
    const prepared = await prepareSnapshot(input, { materials: MATERIALS })
    this.catalog.add(prepared)
    let encoded = await encodeSnapshot(prepared, this.catalog.ids, MATERIALS)
    const latest = this.rows.reduce<BundleSnapshot | null>(
      (newest, row) => (!newest || row.takenAt > newest.takenAt ? row : newest),
      null,
    )
    if (this.useBases && latest) {
      encoded = await withBases(
        encoded,
        prepared,
        MATERIALS,
        {
          materials: this.base(latest.materialsKeyframe),
          artifacts: this.base(latest.artifactsBase ?? latest.artifacts),
          achievementTimes: this.base(latest.achievementTimesBase ?? latest.achievementTimes),
        },
        (hash) => this.blobs.has(hash),
      )
    }
    for (const section of sectionsOf(encoded)) {
      if (this.blobs.has(section.hash)) continue
      const size = (await deflateRaw(section.json)).length
      this.blobs.set(section.hash, { json: section.json, size })
      this.storedBytes += size
    }
    const row: BundleSnapshot = {
      id: this.rows.length + 1,
      takenAt,
      lastSeenAt: takenAt,
      format: prepared.good.format,
      version: prepared.good.version,
      source: prepared.good.source,
      characters: encoded.characters.hash,
      weapons: encoded.weapons.hash,
      artifacts: encoded.artifacts.hash,
      artifactsBase: encoded.artifactsBase,
      materials: encoded.materials.hash,
      materialsKeyframe: encoded.materialsBase ?? encoded.materials.hash,
      achievements: encoded.achievements?.hash ?? null,
      player: encoded.player?.hash ?? null,
      achievementTimes: encoded.achievementTimes?.hash ?? null,
      achievementTimesBase: encoded.achievementTimesBase,
      characterExtras: encoded.characterExtras?.hash ?? null,
    }
    this.rows.push(row)
    return row
  }

  private base(hash: string | null | undefined): SectionBase | null {
    const blob = hash ? this.blobs.get(hash) : undefined
    return blob ? { hash: hash!, ...blob } : null
  }

  /**
   * The GOOD file as the export zip writes it: decoded from the sections the
   * export worker inflates for this snapshot (`sectionHashesOf`) and no others.
   */
  file(row: BundleSnapshot): string {
    const needed = new Set(sectionHashesOf(row))
    const text = (hash: string) => {
      const blob = this.blobs.get(hash)
      if (!needed.has(hash) || !blob) throw new Error(`Missing section ${hash}`)
      return blob.json
    }
    return JSON.stringify(
      decodeSnapshot(storedSnapshotOf(row, text), this.catalog.identities, MATERIALS),
    )
  }
}

/** What a perfect round trip must produce: the normalized input, order-insensitive. */
function expectedGood(input: unknown): Omit<Good, 'timestamp'> {
  const good = normalizeGood(input, { materials: MATERIALS })
  const expected: Omit<Good, 'timestamp'> = {
    format: good.format,
    version: good.version,
    source: good.source,
    characters: good.characters,
    artifacts: good.artifacts.map(({ identity, state }) => ({
      setKey: identity.setKey,
      slotKey: identity.slotKey,
      level: identity.level,
      rarity: identity.rarity,
      mainStatKey: identity.mainStatKey,
      location: state.location,
      lock: state.lock,
      substats: identity.substats,
      totalRolls: identity.totalRolls,
      astralMark: state.astralMark,
      elixerCrafted: identity.elixerCrafted,
      unactivatedSubstats: identity.unactivatedSubstats,
      ...(state.exp ? { gi_exp: state.exp } : {}),
    })),
    weapons: good.weapons,
    materials: Object.fromEntries(good.materials),
  }
  if (good.achievements) expected.gi_achievements = good.achievements
  if (good.player) expected.gi_player = good.player
  if (good.achievementTimes) {
    expected.gi_achievement_times = Object.fromEntries(
      good.achievementTimes.map(([id, at]) => [String(id), at]),
    )
  }
  if (good.characterExtras) expected.gi_characters = Object.fromEntries(good.characterExtras)
  if (good.anecdotes) expected.gi_anecdotes = good.anecdotes
  if (good.tasks) expected.gi_tasks = good.tasks
  if (good.collections) expected.gi_collections = good.collections
  if (good.wardrobe) expected.gi_wardrobe = good.wardrobe
  if (good.exploration) expected.gi_exploration = good.exploration
  if (good.achievementProgress) expected.gi_achievement_progress = good.achievementProgress
  if (good.events) expected.gi_events = good.events
  if (good.teapot) expected.gi_teapot = good.teapot
  if (good.miliastra) expected.gi_miliastra = good.miliastra
  if (good.endgame) expected.gi_endgame = good.endgame
  return expected
}

function canonical(good: Omit<Good, 'timestamp'> & { timestamp?: number }) {
  const sorted = <T>(items: T[]) => items.map((x) => JSON.stringify(x)).sort()
  const { timestamp: _, ...rest } = good
  return {
    ...rest,
    characters: sorted(good.characters),
    artifacts: sorted(good.artifacts),
    weapons: sorted(good.weapons),
    materials: Object.fromEntries(Object.entries(good.materials).sort()),
  }
}

const sample: Good = {
  format: 'GOOD',
  version: 3,
  source: 'Irminsul',
  characters: [
    {
      key: 'Furina',
      level: 90,
      constellation: 2,
      ascension: 6,
      talent: { auto: 6, skill: 10, burst: 10 },
    },
    {
      key: 'SomeoneFromTheNextPatch',
      level: 1,
      constellation: 0,
      ascension: 0,
      talent: { auto: 1, skill: 1, burst: 1 },
    },
  ],
  artifacts: [
    {
      setKey: 'GoldenTroupe',
      slotKey: 'flower',
      level: 20,
      rarity: 5,
      mainStatKey: 'hp',
      location: 'Furina',
      lock: true,
      totalRolls: 9,
      astralMark: true,
      elixerCrafted: false,
      substats: [
        { key: 'critRate_', value: 10.5, initialValue: 3.9 },
        { key: 'critDMG_', value: 21.8, initialValue: 7.8 },
      ],
      unactivatedSubstats: [],
    },
    // Two stat-identical 3★ pieces in different states: one catalog row,
    // two snapshot entries, each keeping its own state.
    {
      setKey: 'Adventurer',
      slotKey: 'plume',
      level: 0,
      rarity: 3,
      mainStatKey: 'atk',
      location: '',
      lock: false,
      substats: [{ key: 'hp', value: 167 }],
    },
    {
      setKey: 'Adventurer',
      slotKey: 'plume',
      level: 0,
      rarity: 3,
      mainStatKey: 'atk',
      location: '',
      lock: true,
      substats: [{ key: 'hp', value: 167 }],
    },
  ],
  weapons: [
    {
      key: 'SplendorOfTranquilWaters',
      level: 90,
      ascension: 6,
      refinement: 1,
      location: 'Furina',
      lock: true,
    },
    { key: 'DullBlade', level: 1, ascension: 0, refinement: 1, location: '', lock: false },
    { key: 'DullBlade', level: 1, ascension: 0, refinement: 1, location: '', lock: false },
  ],
  materials: { Mora: 1_234_567, Primogem: 16_000, MaterialFromTheNextPatch: 3 },
  gi_achievements: [81003, 81001, 81002, 81001],
}

describe('snapshot codec', () => {
  it('round-trips a snapshot, unknown keys and duplicates included', async () => {
    const { decoded } = await roundTrip(sample)
    expect(canonical(decoded)).toEqual(canonical(expectedGood(sample)))
  })

  it('omits achievements when the file had none', async () => {
    const { gi_achievements: _, ...withoutAchievements } = sample
    const { encoded, decoded } = await roundTrip(withoutAchievements)
    expect(encoded.achievements).toBeNull()
    expect(decoded).not.toHaveProperty('gi_achievements')
  })

  it('encodes the same inventory identically whatever the upload order', async () => {
    const shuffled: Good = {
      ...sample,
      characters: [...sample.characters].reverse(),
      artifacts: [...sample.artifacts].reverse(),
      weapons: [...sample.weapons].reverse(),
      gi_achievements: [...sample.gi_achievements!].reverse(),
    }
    const catalog = new Catalog()
    const a = await roundTrip(sample, catalog)
    const b = await roundTrip(shuffled, catalog)
    expect(b.encoded.contentHash).toBe(a.encoded.contentHash)
    expect(b.encoded.artifacts.hash).toBe(a.encoded.artifacts.hash)
  })

  it('stores materials as a delta against a keyframe, removals included', async () => {
    const catalog = new Catalog()
    const big = bigGood()
    const first = await roundTrip(big, catalog)
    expect(first.encoded.materialsBase).toBeNull()
    const keyframe = await baseOf(first.encoded.materials)

    const { [MATERIALS.keys[0]!]: _, ...rest } = big.materials
    const next = { ...big, materials: { ...rest, Mora: 2_000_000, Crystalfly: 1 } }
    const second = await roundTrip(next, catalog, { materials: keyframe })
    expect(second.encoded.materialsBase).toBe(keyframe.hash)
    expect(JSON.parse(second.encoded.materials.json).m).toHaveLength(3)
    expect(second.decoded.materials).toEqual(expectedGood(next).materials)
    // The content hash ignores how materials happened to be stored.
    const asKeyframe = await roundTrip(next, catalog)
    expect(asKeyframe.encoded.materialsBase).toBeNull()
    expect(second.encoded.contentHash).toBe(asKeyframe.encoded.contentHash)
  })

  it('stores a new keyframe once the delta outgrows the cost model', async () => {
    const catalog = new Catalog()
    const big = bigGood()
    const first = await roundTrip(big, catalog)
    const keyframe = await baseOf(first.encoded.materials)
    // Every count changed: the delta is about as large as the keyframe.
    const changed = Object.fromEntries(
      Object.entries(big.materials).map(([key, count]) => [key, count + 1]),
    )
    const second = await roundTrip({ ...big, materials: changed }, catalog, { materials: keyframe })
    expect(second.encoded.materialsBase).toBeNull()
    expect(second.decoded.materials).toEqual(changed)
    // A tiny keyframe never pays for a delta: the base's hash alone outweighs it.
    const tiny = await roundTrip({ ...sample, materials: { Mora: 1 } }, catalog)
    const third = await roundTrip({ ...sample, materials: { Mora: 2 } }, catalog, {
      materials: await baseOf(tiny.encoded.materials),
    })
    expect(third.encoded.materialsBase).toBeNull()
  })

  it('rejects JSON that is not a GOOD file', async () => {
    await expect(prepareSnapshot({ hello: 'world' })).rejects.toThrow(/Not a GOOD file/)
    await expect(prepareSnapshot([])).rejects.toThrow(/JSON object/)
  })

  it('refuses a file with more items than the game holds, and takes one at the limit', async () => {
    const limitError = (input: unknown, code: string, message: RegExp) =>
      expect(prepareSnapshot(input, { materials: MATERIALS })).rejects.toSatisfy(
        (error) =>
          error instanceof GoodLimitError &&
          error instanceof GoodFormatError &&
          error.code === code &&
          message.test(error.message),
      )
    const times = (n: number) => Array.from({ length: n }, (_, i) => i)
    const artifact = sample.artifacts[1]!
    const weapon = sample.weapons[1]!
    const character = sample.characters[0]!
    const keyed = (n: number) => Object.fromEntries(times(n).map((i) => [`Item${i}`, 1]))
    const over: [string, Record<string, unknown>][] = [
      ['characters', { characters: times(GOOD_LIMITS.characters + 1).map(() => character) }],
      ['weapons', { weapons: times(GOOD_LIMITS.weapons + 1).map(() => weapon) }],
      ['artifacts', { artifacts: times(GOOD_LIMITS.artifacts + 1).map(() => artifact) }],
      ['materials', { materials: keyed(GOOD_LIMITS.materialKeys + 1) }],
      ['achievements', { gi_achievements: times(GOOD_LIMITS.achievements + 1) }],
      ['achievement times', { gi_achievement_times: keyed(GOOD_LIMITS.achievements + 1) }],
      ['character extras', { gi_characters: keyed(GOOD_LIMITS.characters + 1) }],
      ['anecdotes', { gi_anecdotes: { anecdotes: keyed(GOOD_LIMITS.anecdotes + 1) } }],
    ]
    for (const [what, fields] of over) {
      await limitError({ ...sample, ...fields }, 'too_many_items', new RegExp(` ${what}; at most`))
    }
    // Malformed entries count too: the cap is on what was sent.
    await limitError(
      { ...sample, artifacts: times(GOOD_LIMITS.artifacts + 1) },
      'too_many_items',
      /4,051 artifacts; at most 4,050/,
    )
    await limitError(
      {
        ...sample,
        artifacts: [{ ...artifact, substats: times(7).map(() => ({ key: 'hp', value: 1 })) }],
      },
      'too_many_items',
      /7 substats; at most 6/,
    )

    const atLimit = await prepareSnapshot(
      {
        ...sample,
        weapons: times(GOOD_LIMITS.weapons).map(() => weapon),
        artifacts: times(GOOD_LIMITS.artifacts).map(() => artifact),
        materials: keyed(GOOD_LIMITS.materialKeys),
        gi_achievements: times(GOOD_LIMITS.achievements),
      },
      { materials: MATERIALS },
    )
    expect(atLimit.summary.artifacts).toBe(GOOD_LIMITS.artifacts)
    expect(atLimit.good.materials.size).toBe(GOOD_LIMITS.materialKeys)
  })

  it('refuses a key longer than any real one unless the material dictionary knows it', async () => {
    const long = 'X'.repeat(GOOD_LIMITS.keyLength + 1)
    const fits = 'X'.repeat(GOOD_LIMITS.keyLength)
    const artifact = sample.artifacts[0]!
    const cases: [string, Record<string, unknown>][] = [
      ['source', { source: long }],
      ['character key', { characters: [{ ...sample.characters[0]!, key: long }] }],
      ['weapon key', { weapons: [{ ...sample.weapons[0]!, key: long }] }],
      ['weapon location', { weapons: [{ ...sample.weapons[0]!, location: long }] }],
      ['artifact set key', { artifacts: [{ ...artifact, setKey: long }] }],
      ['artifact location', { artifacts: [{ ...artifact, location: long }] }],
      ['substat key', { artifacts: [{ ...artifact, substats: [{ key: long, value: 1 }] }] }],
      ['material key', { materials: { [long]: 1 } }],
      ['character key', { gi_characters: { [long]: { friendship: 10 } } }],
    ]
    for (const [what, fields] of cases) {
      await expect(
        prepareSnapshot({ ...sample, ...fields }, { materials: MATERIALS }),
      ).rejects.toSatisfy(
        (error) =>
          error instanceof GoodLimitError &&
          error.code === 'key_too_long' &&
          error.message.startsWith(`A ${what} in this file is 65 characters long`),
      )
    }
    const ok = await prepareSnapshot(
      { ...sample, source: fits, materials: { [fits]: 1 } },
      { materials: MATERIALS },
    )
    expect(ok.good.source).toBe(fits)

    // The game's own longest keys are materials (90 characters): known, they pass.
    const known = MATERIALS.keys.filter((key) => key.length > GOOD_LIMITS.keyLength)
    expect(known.length).toBeGreaterThan(0)
    const withKnown = { ...sample, materials: Object.fromEntries(known.map((k) => [k, 1])) }
    const prepared = await prepareSnapshot(withKnown, { materials: MATERIALS })
    expect([...prepared.good.materials.keys()]).toEqual(known)
    // Without the dictionary nothing is known.
    await expect(prepareSnapshot(withKnown)).rejects.toThrow(GoodLimitError)
  })

  it('summarizes the figures the dashboard reads', async () => {
    const { prepared } = await roundTrip(sample)
    expect(prepared.summary).toEqual({
      characters: 2,
      weapons: 3,
      artifacts: 3,
      materials: 3,
      mora: 1_234_567,
      primogem: 16_000,
      artifact3: 1,
      artifact4: 0,
    })
  })
})

const extras = {
  gi_player: {
    uid: 811111111,
    ar: 60,
    arExp: 0,
    wl: 8,
    wlLimit: 9,
    resin: 124,
    storyKeys: 3,
    maxStamina: 24000,
    gameData: '792978e5503ecfba73dcb3562ed44a0d35a2abe2',
  },
  gi_achievement_times: { '81003': 1_700_000_300, '81001': 1_650_000_000 },
  gi_characters: {
    Furina: { friendship: 10, obtainedAt: 1_694_000_000 },
    SomeoneFromTheNextPatch: { obtainedAt: 1_760_000_000 },
  },
} satisfies Partial<Good>

describe("irminsul's extra keys", () => {
  it('round-trips gi_player, gi_achievement_times and gi_characters', async () => {
    const withExtras = { ...sample, ...extras }
    const { encoded, decoded } = await roundTrip(withExtras)
    expect(extraSectionsOf(encoded).map((s) => s.kind)).toEqual([
      'player',
      'achievementTimes',
      'characterExtras',
    ])
    expect(canonical(decoded)).toEqual(canonical(expectedGood(withExtras)))
    expect(decoded.gi_player).toEqual(extras.gi_player)
    expect(decoded.gi_achievement_times).toEqual(extras.gi_achievement_times)
    expect(decoded.gi_characters).toEqual(extras.gi_characters)
    // Written after `timestamp`, in irminsul's order.
    expect(Object.keys(decoded).slice(-4)).toEqual([
      'timestamp',
      'gi_player',
      'gi_achievement_times',
      'gi_characters',
    ])
  })

  it('round-trips item, character and friendship EXP, leaving 0 out', async () => {
    const withExp = {
      ...sample,
      artifacts: sample.artifacts.map((a, i) => ({ ...a, gi_exp: i === 0 ? 3_150 : 0 })),
      weapons: sample.weapons.map((w, i) => ({ ...w, gi_exp: i === 0 ? 120_000 : 0 })),
      gi_characters: {
        Furina: { friendship: 9, obtainedAt: 1_694_000_000, exp: 40_000, friendshipExp: 2_100 },
        Nahida: { friendship: 10, exp: 0, friendshipExp: 0 },
      },
    }
    const { encoded, decoded } = await roundTrip(withExp)
    expect(canonical(decoded)).toEqual(canonical(expectedGood(withExp)))
    expect(decoded.artifacts.filter((a) => a.gi_exp).map((a) => a.gi_exp)).toEqual([3_150])
    expect(decoded.weapons.filter((w) => w.gi_exp).map((w) => w.gi_exp)).toEqual([120_000])
    expect(decoded.gi_characters).toEqual({
      Furina: { friendship: 9, obtainedAt: 1_694_000_000, exp: 40_000, friendshipExp: 2_100 },
      Nahida: { friendship: 10 },
    })
    // Without any EXP, the item sections are what they were before it existed.
    const plain = await roundTrip(sample)
    const zero = await roundTrip({
      ...sample,
      artifacts: sample.artifacts.map((a) => ({ ...a, gi_exp: 0 })),
      weapons: sample.weapons.map((w) => ({ ...w, gi_exp: 0 })),
    })
    expect(zero.encoded.weapons.hash).toBe(plain.encoded.weapons.hash)
    expect(zero.encoded.artifacts.hash).toBe(plain.encoded.artifacts.hash)
    expect(encoded.weapons.hash).not.toBe(plain.encoded.weapons.hash)
  })

  it('stores and hashes a file without them exactly as before they existed', async () => {
    const old: Good = {
      format: 'GOOD',
      version: 3,
      source: 'Irminsul',
      characters: [
        {
          key: 'Furina',
          level: 90,
          constellation: 2,
          ascension: 6,
          talent: { auto: 6, skill: 10, burst: 10 },
        },
      ],
      artifacts: [
        {
          setKey: 'GoldenTroupe',
          slotKey: 'flower',
          level: 20,
          rarity: 5,
          mainStatKey: 'hp',
          location: 'Furina',
          lock: true,
          substats: [{ key: 'critRate_', value: 10.5 }],
        },
      ],
      weapons: [
        { key: 'DullBlade', level: 1, ascension: 0, refinement: 1, location: '', lock: false },
      ],
      materials: { Mora: 1234567 },
      gi_achievements: [81001, 81002],
    }
    const { encoded, decoded } = await roundTrip(old)
    expect(extraSectionsOf(encoded)).toEqual([])
    // Pinned from the codec before the extras were stored: an unchanged file
    // keeps its content hash, so re-uploading it stays a no-op.
    expect(encoded.contentHash).toBe('27f93f4d1e8fd06ecb09a38d26761421')
    expect(encoded.legacyContentHash).toBe(encoded.contentHash)
    for (const key of ['gi_player', 'gi_achievement_times', 'gi_characters']) {
      expect(decoded).not.toHaveProperty(key)
    }
  })

  it('decodes stored snapshots and bundles written before the extras existed', async () => {
    const { encoded } = await roundTrip(sample)
    const texts = new Map(
      [encoded.characters, encoded.weapons, encoded.artifacts, encoded.materials].map((s) => [
        s.hash,
        s.json,
      ]),
    )
    texts.set(encoded.achievements!.hash, encoded.achievements!.json)
    // A manifest entry as the worker wrote it then: no extra hash fields at all.
    const entry: BundleSnapshot = {
      id: 1,
      takenAt: 1_700_000_000_000,
      lastSeenAt: 1_700_000_000_000,
      format: 'GOOD',
      version: 3,
      source: 'Irminsul',
      characters: encoded.characters.hash,
      weapons: encoded.weapons.hash,
      artifacts: encoded.artifacts.hash,
      materials: encoded.materials.hash,
      materialsKeyframe: encoded.materials.hash,
      achievements: encoded.achievements!.hash,
    }
    const catalog = new Catalog()
    catalog.add(await prepareSnapshot(sample))
    const stored = storedSnapshotOf(entry, (hash) => texts.get(hash)!)
    expect(stored).toMatchObject({ player: null, achievementTimes: null, characterExtras: null })
    const decoded = decodeSnapshot(stored, catalog.identities, MATERIALS)
    expect(canonical(decoded)).toEqual(canonical(expectedGood(sample)))
    expect(Object.keys(decoded).at(-1)).toBe('timestamp')
  })

  it('keeps the inventory hash of a capture stored before the extras', async () => {
    const catalog = new Catalog()
    const before = await roundTrip(sample, catalog)
    const after = await roundTrip({ ...sample, ...extras }, catalog)
    expect(after.encoded.contentHash).not.toBe(before.encoded.contentHash)
    expect(after.encoded.legacyContentHash).toBe(before.encoded.contentHash)
  })

  it('deduplicates each extra on its own, whatever the key order', async () => {
    const catalog = new Catalog()
    const a = await roundTrip({ ...sample, ...extras }, catalog)
    const b = await roundTrip(
      {
        ...sample,
        gi_player: { ...extras.gi_player, resin: 160 },
        gi_achievement_times: Object.fromEntries(
          Object.entries(extras.gi_achievement_times).reverse(),
        ),
        gi_characters: Object.fromEntries(Object.entries(extras.gi_characters).reverse()),
      },
      catalog,
    )
    expect(b.encoded.player!.hash).not.toBe(a.encoded.player!.hash)
    expect(b.encoded.achievementTimes!.hash).toBe(a.encoded.achievementTimes!.hash)
    expect(b.encoded.characterExtras!.hash).toBe(a.encoded.characterExtras!.hash)
    expect(b.encoded.contentHash).not.toBe(a.encoded.contentHash)
    // The order of gi_player's fields in the file does not matter either.
    const shuffled = await roundTrip(
      {
        ...sample,
        ...extras,
        gi_player: Object.fromEntries(Object.entries(extras.gi_player).reverse()),
      },
      catalog,
    )
    expect(shuffled.encoded.player!.hash).toBe(a.encoded.player!.hash)
  })

  it('drops values outside their range and keys with nothing left', () => {
    const good = normalizeGood({
      ...sample,
      gi_player: {
        uid: '811111111', // a string, not a number
        ar: 61,
        arExp: -1,
        wl: 8,
        wlLimit: 10,
        resin: 2001,
        storyKeys: 1.5,
        maxStamina: 0,
        gameData: 'not-hex',
        somethingNew: 1,
      },
      gi_achievement_times: {
        '81001': 1_650_000_000,
        '81002': 1_500_000_000, // before the game existed
        '0': 1_650_000_000,
        abc: 1_650_000_000,
        '81003': 2 ** 32,
        '81004': '1650000000',
      },
      gi_characters: {
        Furina: { friendship: 11, obtainedAt: 1_694_000_000 },
        Bennett: { friendship: 0 },
        Xiangling: 'nope',
        TravelerAnemo: { friendship: 7, obtainedAt: 0, extra: true },
      },
    })
    expect(good.player).toEqual({ wl: 8 })
    expect(good.achievementTimes).toEqual([[81001, 1_650_000_000]])
    expect(good.characterExtras).toEqual(
      new Map([
        ['Furina', { obtainedAt: 1_694_000_000 }],
        ['TravelerAnemo', { friendship: 7 }],
      ]),
    )

    const empty = normalizeGood({
      ...sample,
      gi_player: { gameData: 'abc123' },
      gi_achievement_times: {},
      gi_characters: { Furina: {} },
    })
    expect(empty.player).toBeNull()
    expect(empty.achievementTimes).toBeNull()
    expect(empty.characterExtras).toBeNull()
    expect(normalizeGood({ ...sample, gi_player: [1], gi_characters: null }).player).toBeNull()
  })

  it("round-trips Capture 1.14's profile fields after the old ones", async () => {
    const profile = {
      nickname: 'player01',
      signature: '',
      nameCard: 210001,
      profilePicture: { id: 1001, frameId: 100016 },
      birthday: { month: 1, day: 2 },
    }
    const withProfile = { ...sample, gi_player: { ...extras.gi_player, ...profile } }
    const { decoded } = await roundTrip(withProfile)
    expect(decoded.gi_player).toEqual(withProfile.gi_player)
    expect(Object.keys(decoded.gi_player!)).toEqual(Object.keys(withProfile.gi_player))

    const without = await roundTrip({ ...sample, ...extras })
    const plain = await roundTrip({ ...sample, ...extras, gi_player: { ...extras.gi_player } })
    // A capture without them keeps the hash it always had.
    expect(plain.encoded.player!.hash).toBe(without.encoded.player!.hash)
  })

  it('drops profile values the game could not send', () => {
    const good = normalizeGood({
      ...sample,
      gi_player: {
        ar: 60,
        nickname: 'x'.repeat(65),
        signature: 'tab\there',
        nameCard: 110001,
        profilePicture: { id: 0, avatarId: 1, frameId: 'a' },
        birthday: { month: 13, day: 1 },
      },
    })
    expect(good.player).toEqual({ ar: 60 })
    const kept = normalizeGood({
      ...sample,
      gi_player: { profilePicture: { avatarId: 10000007, costumeId: 200301, extra: 1 } },
    })
    expect(kept.player).toEqual({ profilePicture: { avatarId: 10000007, costumeId: 200301 } })
    // The signature box allows line breaks; the name doesn't.
    const lines = normalizeGood({
      ...sample,
      gi_player: { nickname: 'two\nlines', signature: 'two\nlines' },
    })
    expect(lines.player).toEqual({ signature: 'two\nlines' })
  })

  it('keeps the edges of every range', () => {
    const good = normalizeGood({
      ...sample,
      gi_player: { uid: 100_000_000, ar: 1, wl: 0, resin: 2000, maxStamina: 1 },
      gi_characters: { Furina: { friendship: 1, obtainedAt: 1_600_128_000 } },
    })
    expect(good.player).toEqual({ uid: 100_000_000, ar: 1, wl: 0, resin: 2000, maxStamina: 1 })
    expect(good.characterExtras!.get('Furina')).toEqual({
      friendship: 1,
      obtainedAt: 1_600_128_000,
    })
  })
})

const SLOTS = ['flower', 'plume', 'sands', 'goblet', 'circlet'] as const

/**
 * A larger inventory: deltas only pay off against bases of some size (a tiny
 * section is cheaper to store again than a delta naming it), so the delta
 * tests need real-sized sections. Deterministic, high-entropy times.
 */
function bigGood(): Good {
  const scatter = (i: number, n: number) => ((i * 2_654_435_761) >>> 7) % n
  const artifacts = Array.from({ length: 1000 }, (_, i) => ({
    setKey: 'GoldenTroupe',
    slotKey: SLOTS[i % 5]!,
    level: 20,
    rarity: 5,
    mainStatKey: 'hp',
    location: ['', '', '', 'Furina', 'Bennett', 'Xiangling'][scatter(i, 6)]!,
    lock: scatter(i, 3) !== 0,
    astralMark: scatter(i, 11) === 0,
    substats: [
      { key: 'critRate_', value: 3 + (i % 50) / 10 },
      { key: 'hp', value: 100 + i },
    ],
  }))
  const times = Array.from({ length: 600 }, (_, i): [string, number] => [
    String(81000 + i),
    1_650_000_000 + ((i * 7_919_993) % 120_000_000),
  ])
  return {
    ...sample,
    artifacts: [...sample.artifacts, ...artifacts],
    materials: Object.fromEntries(
      MATERIALS.keys.slice(0, 600).map((key, i) => [key, ((i * 7919) % 5000) + 1]),
    ),
    gi_achievements: times.map(([id]) => Number(id)),
    ...extras,
    gi_achievement_times: Object.fromEntries(times),
  }
}

describe('stored before sections could be deltas', () => {
  // Literal sections in the shape every row before migration 0009 holds (and
  // full sections still have): no `b`, no base hash anywhere.
  const artifacts = '{"i":[1,2,0],"l":[36,0,0],"f":[3,0,1]}'
  const times = '{"i":[81001,2],"t":[1650000000,1700000300]}'

  it('keeps the full forms and content hash byte for byte', async () => {
    const pinned: Good = {
      format: 'GOOD',
      version: 3,
      source: 'Irminsul',
      characters: [sample.characters[0]!],
      artifacts: [
        { ...sample.artifacts[0]!, substats: [{ key: 'critRate_', value: 10.5 }] },
        sample.artifacts[1]!,
        sample.artifacts[2]!,
      ],
      weapons: [sample.weapons[1]!],
      materials: { Mora: 1234567 },
      gi_achievements: [81001, 81002],
      gi_player: { uid: 811111111, ar: 60, wl: 8 },
      gi_achievement_times: { '81003': 1_700_000_300, '81001': 1_650_000_000 },
      gi_characters: { Furina: { friendship: 10, obtainedAt: 1_694_000_000 } },
    }
    const prepared = await prepareSnapshot(pinned)
    const ids = new Map(prepared.artifactHashes.map((hash, i) => [hash, i + 1]))
    const encoded = await encodeSnapshot(prepared, ids, MATERIALS)
    // Pinned from the codec before deltas existed.
    expect(encoded.artifacts.json).toBe(artifacts)
    expect(encoded.artifacts.hash).toBe('258f9006b18f48460b39a8b6c7002a40')
    expect(encoded.achievementTimes!.json).toBe(times)
    expect(encoded.achievementTimes!.hash).toBe('cd3491e5dd5b716f7879c113ed9c0f09')
    expect(encoded.contentHash).toBe('93528b14dc879a021d11affdbaed6f7e')
    expect(encoded.legacyContentHash).toBe('d2a8a9a624e0f70f385ac210fe4eb0c2')
    // No base offered: nothing changes.
    const same = await withBases(encoded, prepared, MATERIALS, NO_BASES)
    expect(same).toEqual(encoded)
  })

  it('decodes old rows and bundle entries without any base field', () => {
    const identity = (setKey: string): ArtifactIdentity => ({
      setKey,
      slotKey: 'flower',
      level: 0,
      rarity: 3,
      mainStatKey: 'hp',
      substats: [],
      totalRolls: 0,
      elixerCrafted: false,
      unactivatedSubstats: [],
    })
    const catalog = new Map([
      [1, identity('A')],
      [3, identity('B')],
    ])
    const old = JSON.parse(artifacts) as ArtifactsSection
    expect(artifactRows(old)).toEqual([
      [1, 36, 3],
      [3, 0, 0],
      [3, 0, 1],
    ])
    expect(
      decodeArtifacts(old, catalog).map((a) => [a.setKey, a.location, a.lock, a.astralMark]),
    ).toEqual([
      ['A', 'Furina', true, true],
      ['B', '', false, false],
      ['B', '', true, false],
    ])
    expect(decodeAchievementTimes(JSON.parse(times))).toEqual([
      [81001, 1_650_000_000],
      [81003, 1_700_000_300],
    ])

    // A bundle entry from before 0009: no artifactsBase / achievementTimesBase keys.
    const entry: BundleSnapshot = {
      id: 1,
      takenAt: 5,
      lastSeenAt: 5,
      format: 'GOOD',
      version: 3,
      source: 'Irminsul',
      characters: 'c',
      weapons: 'w',
      artifacts: 'a',
      materials: 'm',
      materialsKeyframe: 'm',
      achievements: null,
      player: null,
      achievementTimes: 't',
      characterExtras: null,
    }
    const texts = new Map([
      ['c', '[]'],
      ['w', '[]'],
      ['a', artifacts],
      ['m', '{"m":[[3939,7]]}'],
      ['t', times],
    ])
    expect(sectionHashesOf(entry).sort()).toEqual(['a', 'c', 'm', 'm', 't', 'w'])
    const stored = storedSnapshotOf(entry, (hash) => texts.get(hash)!)
    expect(stored).toMatchObject({ artifactsBase: null, achievementTimesBase: null })
    const good = decodeSnapshot(stored, catalog, MATERIALS)
    expect(good.artifacts).toHaveLength(3)
    expect(good.materials).toEqual({ Mora: 7 })
    expect(good.gi_achievement_times).toEqual({ '81001': 1_650_000_000, '81003': 1_700_000_300 })
  })
})

describe('artifacts deltas', () => {
  // Rows: [catalog id, location, flags (1 = lock, 2 = astral mark)].
  // Rows listed in stored order (sorted).
  const section = (sorted: [number, number | string, number][]): ArtifactsSection => {
    let previous = 0
    return {
      i: sorted.map((r) => {
        const d = r[0] - previous
        previous = r[0]
        return d
      }),
      l: sorted.map((r) => r[1]),
      f: sorted.map((r) => r[2]),
    }
  }
  const base = section([
    [1, 0, 0],
    [2, 36, 1],
    [5, 0, 0],
    [5, 0, 1],
    [9, 0, 0],
  ])

  it('lists every row of each changed id, and gone ids once with flags -1', () => {
    const now = section([
      [1, 0, 0], // unchanged
      [2, 36, 3], // astral mark added
      [5, 0, 1], // one of two identical pieces gone (the unlocked one)
      [5, 0, 1], // ... and a new locked copy
      [12, 'SomeoneNew', 0], // new, at a character the dictionary lacks
      // 9 gone
    ])
    const delta = encodeArtifactsDelta(now, base, 'BASE')
    expect(delta.b).toBe('BASE')
    expect(artifactRows({ ...delta, b: undefined })).toEqual([
      [2, 36, 3],
      [5, 0, 1],
      [5, 0, 1],
      [9, 0, -1],
      [12, 'SomeoneNew', 0],
    ])
    expect(artifactRows(delta, base)).toEqual(artifactRows(now))
  })

  it('is empty when nothing changed, and decodes to the base', () => {
    const delta = encodeArtifactsDelta(base, base, 'BASE')
    expect(delta).toEqual({ b: 'BASE', i: [], l: [], f: [] })
    expect(artifactRows(delta, base)).toEqual(artifactRows(base))
  })

  it('refuses to decode a delta without its full base', () => {
    const delta = encodeArtifactsDelta(section([[1, 0, 1]]), base, 'BASE')
    expect(() => artifactRows(delta)).toThrow(/needs base BASE/)
    expect(() => artifactRows(delta, delta)).toThrow(/needs base BASE/)
  })
})

describe('achievement times deltas', () => {
  const base = encodeAchievementTimes([
    [81001, 1_650_000_000],
    [81002, 1_660_000_000],
    [81003, 1_670_000_000],
  ])

  it('lists new and changed times, and -1 for an id that is gone', () => {
    const now = encodeAchievementTimes([
      [81001, 1_650_000_000],
      [81002, 1_660_000_999], // changed
      [81007, 1_680_000_000], // new
      // 81003 gone
    ])
    const delta = encodeAchievementTimesDelta(now, base, 'BASE')
    expect(delta).toEqual({
      b: 'BASE',
      i: [81002, 1, 4],
      t: [1_660_000_999, -1, 1_680_000_000],
    })
    expect(decodeAchievementTimes(delta, base)).toEqual(decodeAchievementTimes(now))
  })

  it('is empty when nothing changed, and decodes to the base', () => {
    const delta = encodeAchievementTimesDelta(base, base, 'BASE')
    expect(delta).toEqual({ b: 'BASE', i: [], t: [] })
    expect(decodeAchievementTimes(delta, base)).toEqual(decodeAchievementTimes(base))
  })

  it('refuses to decode a delta without its full base', () => {
    const delta: AchievementTimesSection = { b: 'BASE', i: [81001], t: [1] }
    expect(() => decodeAchievementTimes(delta)).toThrow(/needs base BASE/)
    expect(() => decodeAchievementTimes(delta, delta)).toThrow(/needs base BASE/)
  })
})

describe('bases', () => {
  it('stores a delta until it passes √(2·g·base)', () => {
    expect(DELTA_GROWTH_BYTES).toBe(25)
    // A 7 KB materials keyframe: deltas up to 591 bytes.
    expect(deltaPaysOff(591, 7000)).toBe(true)
    expect(deltaPaysOff(592, 7000)).toBe(false)
    // An 8 KB achievement-times base: up to 632 bytes.
    expect(deltaPaysOff(632, 8000)).toBe(true)
    expect(deltaPaysOff(633, 8000)).toBe(false)
    // A 1.2 KB artifacts base: up to 244 bytes.
    expect(deltaPaysOff(244, 1200)).toBe(true)
    expect(deltaPaysOff(245, 1200)).toBe(false)
  })

  it('uses a delta only where it is cheaper, never changing the content hash', async () => {
    const catalog = new Catalog()
    const big = bigGood()
    const first = await roundTrip(big, catalog)
    const bases: SnapshotBases = {
      materials: await baseOf(first.encoded.materials),
      artifacts: await baseOf(first.encoded.artifacts),
      achievementTimes: await baseOf(first.encoded.achievementTimes!),
    }

    // Unchanged: every section is its base, stored in full (it costs nothing).
    const same = await roundTrip(big, catalog, bases)
    expect(same.encoded).toEqual(first.encoded)

    // One achievement more and one piece locked: small deltas.
    const next: Good = {
      ...big,
      artifacts: big.artifacts.map((a, i) => (i === 3 ? { ...a, lock: !a.lock } : a)),
      gi_achievement_times: { ...big.gi_achievement_times, '84584': 1_791_189_294 },
    }
    const changed = await roundTrip(next, catalog, bases)
    expect(changed.encoded.artifactsBase).toBe(bases.artifacts!.hash)
    expect(changed.encoded.achievementTimesBase).toBe(bases.achievementTimes!.hash)
    expect(JSON.parse(changed.encoded.achievementTimes!.json)).toEqual({
      b: bases.achievementTimes!.hash,
      i: [84584],
      t: [1_791_189_294],
    })
    expect(canonical(changed.decoded)).toEqual(canonical(expectedGood(next)))
    const inFull = await roundTrip(next, catalog)
    expect(changed.encoded.contentHash).toBe(inFull.encoded.contentHash)
    expect(changed.encoded.legacyContentHash).toBe(inFull.encoded.legacyContentHash)
    expect(JSON.stringify(changed.decoded)).toBe(JSON.stringify(inFull.decoded))

    // Everything different: new bases.
    const other: Good = {
      ...big,
      artifacts: big.artifacts.map((a) => ({ ...a, lock: !a.lock })),
      gi_achievement_times: Object.fromEntries(
        Object.entries(big.gi_achievement_times!).map(([id, at]) => [id, at + 1]),
      ),
    }
    const rebased = await roundTrip(other, catalog, bases)
    expect(rebased.encoded.artifactsBase).toBeNull()
    expect(rebased.encoded.achievementTimesBase).toBeNull()
    expect(canonical(rebased.decoded)).toEqual(canonical(expectedGood(other)))
  })

  it('round-trips a run of uploads, out of order too, to the same files as full storage', async () => {
    const deltas = new Store()
    const inFull = new Store(false)
    const big = bigGood()
    const upload = async (good: Good, takenAt: number) => {
      const row = await deltas.upload(good, takenAt)
      const full = await inFull.upload(good, takenAt)
      // Byte-identical GOOD files whichever way the sections were stored.
      expect(deltas.file(row)).toBe(inFull.file(full))
      return row
    }

    const first = await upload(big, 1_000)
    expect(first).toMatchObject({ artifactsBase: null, achievementTimesBase: null })

    // The base is the latest snapshot's own section.
    const relock = big.artifacts.map((a, i) => (i < 4 ? { ...a, lock: !a.lock } : a))
    const second = await upload(
      {
        ...big,
        artifacts: relock,
        materials: { ...big.materials, Mora: 5 },
        gi_achievement_times: { ...big.gi_achievement_times, '84584': 1_791_189_294 },
      },
      3_000,
    )
    expect(second.artifactsBase).toBe(first.artifacts)
    expect(second.achievementTimesBase).toBe(first.achievementTimes)
    expect(second.materialsKeyframe).toBe(first.materials)

    // Older than the latest: a delta against the latest's bases all the same,
    // with a time changed, one removed and a piece gone.
    const { '81001': _, ...fewer } = big.gi_achievement_times!
    const older = await upload(
      {
        ...big,
        artifacts: big.artifacts.slice(1),
        gi_achievement_times: { ...fewer, '81002': 1_700_000_001 },
      },
      2_000,
    )
    expect(older.artifactsBase).toBe(first.artifacts)
    expect(older.achievementTimesBase).toBe(first.achievementTimes)
    expect(JSON.parse(deltas.blobs.get(older.achievementTimes!)!.json)).toMatchObject({
      i: [81001, 1],
      t: [-1, 1_700_000_001],
    })

    // Only gi_player changed since the latest: its deltas are reused as they are.
    const relogin = await upload(
      {
        ...big,
        artifacts: relock,
        materials: { ...big.materials, Mora: 5 },
        gi_achievement_times: { ...big.gi_achievement_times, '84584': 1_791_189_294 },
        gi_player: { ...extras.gi_player, resin: 1 },
      },
      4_000,
    )
    expect(relogin.artifacts).toBe(second.artifacts)
    expect(relogin.achievementTimes).toBe(second.achievementTimes)
    expect(relogin.materials).toBe(second.materials)

    // Back to the base's exact times: the base itself, in full.
    const back = await upload({ ...big, artifacts: relock }, 5_000)
    expect(back.achievementTimes).toBe(first.achievementTimes)
    expect(back.achievementTimesBase).toBeNull()

    expect(deltas.storedBytes).toBeLessThan(inFull.storedBytes)
  })
})

// Real exports are personal inventory data, so they are never committed. Point
// GDT_GOOD_SAMPLES_DIR at a folder of GOOD files to run these locally.
const samplesDir = process.env.GDT_GOOD_SAMPLES_DIR
describe.skipIf(!samplesDir)('real GOOD exports', () => {
  it('round-trips every file in order, with bases, deltas and section dedup', async () => {
    const files = readdirSync(samplesDir!)
      .filter((f) => f.endsWith('.json'))
      .sort()
    const deltas = new Store()
    const inFull = new Store(false)
    let rawBytes = 0

    for (const [index, file] of files.entries()) {
      const text = readFileSync(join(samplesDir!, file), 'utf8')
      rawBytes += text.length
      const input = JSON.parse(text)
      const takenAt = typeof input.timestamp === 'number' ? input.timestamp : index + 1
      const row = await deltas.upload(input, takenAt)
      const full = await inFull.upload(input, takenAt)
      const decoded = JSON.parse(deltas.file(row))
      expect(canonical(decoded), file).toEqual(canonical(expectedGood(input)))
      expect(deltas.file(row), file).toBe(inFull.file(full))
    }

    const kb = (bytes: number) => (bytes / files.length / 1024).toFixed(1)
    console.log(
      `${files.length} snapshots: ${kb(rawBytes)} KB raw each, sections stored ` +
        `${kb(deltas.storedBytes)} KB each with deltas (${kb(inFull.storedBytes)} KB in full), ` +
        `catalog ${deltas.catalog.ids.size} artifacts`,
    )
  })
})

// ------------------------------------------------------------- gi_anecdotes

const anecdotes = {
  gi_anecdotes: {
    anecdotes: {
      '101604': { state: 0, finishCount: 3 },
      '100001': { state: 3, finishCount: 1 },
      '109201': { state: 2, finishCount: 0 },
    },
    unlockedAreas: [8, 1, 2, 3, 4, 5, 6, 7],
    reward: { index: 12, progress: 4, target: 10 },
    wish: { npcId: 9801, lastWishTime: 1_791_000_000 },
  },
} satisfies Partial<Good>

describe("irminsul's gi_anecdotes", () => {
  it('round-trips, ids ascending and areas sorted, after the other extra keys', async () => {
    const input = { ...sample, ...extras, ...anecdotes }
    const { encoded, decoded } = await roundTrip(input)
    expect(extraSectionsOf(encoded).map((s) => s.kind)).toEqual([
      'player',
      'achievementTimes',
      'characterExtras',
      'anecdotes',
    ])
    expect(canonical(decoded)).toEqual(canonical(expectedGood(input)))
    expect(decoded.gi_anecdotes).toEqual({
      anecdotes: {
        '100001': { state: 3, finishCount: 1 },
        '101604': { state: 0, finishCount: 3 },
        '109201': { state: 2, finishCount: 0 },
      },
      unlockedAreas: [1, 2, 3, 4, 5, 6, 7, 8],
      reward: { index: 12, progress: 4, target: 10 },
      wish: { npcId: 9801, lastWishTime: 1_791_000_000 },
    })
    expect(Object.keys(decoded.gi_anecdotes!.anecdotes)).toEqual(['100001', '101604', '109201'])
    expect(Object.keys(decoded).slice(-2)).toEqual(['gi_characters', 'gi_anecdotes'])
    // Alone, and without a reward, a wished NPC or any anecdote met.
    const bare = {
      ...sample,
      gi_anecdotes: { anecdotes: {}, unlockedAreas: [1], wish: { lastWishTime: 0 } },
    }
    const alone = await roundTrip(bare)
    expect(alone.decoded.gi_anecdotes).toEqual(bare.gi_anecdotes)
    expect(Object.keys(alone.decoded).at(-1)).toBe('gi_anecdotes')
  })

  it('keeps the content hash of a file without them, and knows the one from before them', async () => {
    const catalog = new Catalog()
    const plain = await roundTrip(sample, catalog)
    const withExtras = await roundTrip({ ...sample, ...extras }, catalog)
    const both = await roundTrip({ ...sample, ...extras, ...anecdotes }, catalog)
    const only = await roundTrip({ ...sample, ...anecdotes }, catalog)

    // Without them: as before (the codec's older hashes are pinned above).
    expect(plain.encoded.preAnecdotesContentHash).toBe(plain.encoded.contentHash)
    expect(withExtras.encoded.preAnecdotesContentHash).toBe(withExtras.encoded.contentHash)
    // With them: another inventory, which also knows the hash it had before them.
    expect(both.encoded.contentHash).not.toBe(withExtras.encoded.contentHash)
    expect(both.encoded.preAnecdotesContentHash).toBe(withExtras.encoded.contentHash)
    expect(both.encoded.legacyContentHash).toBe(plain.encoded.contentHash)
    expect(only.encoded.contentHash).not.toBe(plain.encoded.contentHash)
    expect(only.encoded.contentHash).not.toBe(both.encoded.contentHash)
    expect(only.encoded.preAnecdotesContentHash).toBe(plain.encoded.contentHash)
    expect(only.encoded.legacyContentHash).toBe(plain.encoded.contentHash)

    // The order of the file's ids and areas doesn't matter.
    const shuffled = await roundTrip(
      {
        ...sample,
        ...extras,
        gi_anecdotes: {
          ...anecdotes.gi_anecdotes,
          anecdotes: Object.fromEntries(Object.entries(anecdotes.gi_anecdotes.anecdotes).reverse()),
          unlockedAreas: [3, 3, 2, 1, 8, 7, 6, 5, 4],
        },
      },
      catalog,
    )
    expect(shuffled.encoded.anecdotes!.hash).toBe(both.encoded.anecdotes!.hash)
    expect(shuffled.encoded.contentHash).toBe(both.encoded.contentHash)
  })

  it('drops what is outside the contract and keeps its edges', () => {
    const good = normalizeGood({
      ...sample,
      gi_anecdotes: {
        anecdotes: {
          '100000': { state: 0, finishCount: 0 }, // the edges
          '199999': { state: 15, finishCount: 100_000 },
          '100002': { finishCount: 1 }, // state omitted on the wire = 0
          '99999': { state: 3, finishCount: 1 },
          '200000': { state: 3, finishCount: 1 },
          '0100003': { state: 3, finishCount: 1 },
          abc: { state: 3, finishCount: 1 },
          '100004': { state: 16, finishCount: 1 },
          '100005': { state: 3, finishCount: -1 },
          '100006': { state: 3, finishCount: 100_001 },
          '100007': { state: 1.5, finishCount: 1 },
          '100008': 'done',
        },
        unlockedAreas: [0, 1, 64, 65, 2, 2, 'x', 1.5],
        reward: { index: 1, progress: 4 }, // no target
        wish: { npcId: 0, lastWishTime: 1_791_000_000 },
      },
    })
    expect(good.anecdotes).toEqual({
      anecdotes: {
        '100000': { state: 0, finishCount: 0 },
        '100002': { state: 0, finishCount: 1 },
        '199999': { state: 15, finishCount: 100_000 },
      },
      unlockedAreas: [1, 2, 64],
      wish: { lastWishTime: 1_791_000_000 },
    })
    const reward = normalizeGood({
      ...sample,
      gi_anecdotes: {
        anecdotes: {},
        unlockedAreas: [],
        reward: { index: 0, progress: 1000, target: 1 },
        wish: { npcId: 9801, lastWishTime: -1 },
      },
    })
    expect(reward.anecdotes).toEqual({
      anecdotes: {},
      unlockedAreas: [],
      reward: { index: 0, progress: 1000, target: 1 },
    })
    // Nothing left: no section at all.
    for (const raw of [
      { anecdotes: { '1': { state: 3, finishCount: 1 } }, unlockedAreas: [99] },
      { anecdotes: {}, unlockedAreas: [] },
      [1, 2],
      'yes',
      null,
    ]) {
      expect(normalizeGood({ ...sample, gi_anecdotes: raw }).anecdotes).toBeNull()
    }
  })

  it('stores the section in its binary layout and gives it back exactly', () => {
    const value = encodeAnecdotes(normalizeGood({ ...sample, ...anecdotes }).anecdotes!)
    expect(value).toEqual({
      i: [100001, 1603, 7597],
      s: [3, 0, 2],
      c: [1, 3, 0],
      a: [1, 2, 3, 4, 5, 6, 7, 8],
      r: [12, 4, 10],
      w: [9801, 1_791_000_000],
    })
    for (const v of [value, { i: [], s: [], c: [], a: [] }, { ...value, r: undefined }]) {
      const clean = JSON.parse(JSON.stringify(v))
      const blob = encodeSectionBlob('anecdotes', clean, false, null)
      // Layout nibble 1: the binary layout, not the JSON fallback.
      expect(blob.payload[0]).toBe(0x10)
      const back = decodeSectionBlob(kindCode('anecdotes', false), blob.data, null, null)
      expect(JSON.stringify(back.value)).toBe(JSON.stringify(clean))
      expect(decodeAnecdotes(back.value as typeof value)).toEqual(decodeAnecdotes(clean))
    }
  })

  it('reads bundle entries written before anecdotes were kept', async () => {
    const { encoded } = await roundTrip(sample)
    const entry: BundleSnapshot = {
      id: 1,
      takenAt: 1_700_000_000_000,
      lastSeenAt: 1_700_000_000_000,
      format: 'GOOD',
      version: 3,
      source: 'Irminsul',
      characters: encoded.characters.hash,
      weapons: encoded.weapons.hash,
      artifacts: encoded.artifacts.hash,
      materials: encoded.materials.hash,
      materialsKeyframe: encoded.materials.hash,
      achievements: encoded.achievements!.hash,
    }
    expect(sectionHashesOf(entry)).toHaveLength(6)
    const stored = storedSnapshotOf(entry, (hash) => sectionJson.get(hash)!)
    expect(stored.anecdotes).toBeNull()
  })
})

// ------------------------------------------------------------- gi_tasks

const tasks = {
  gi_tasks: {
    commissions: { finished: 3, total: 4 },
    abyss: { start: 1_789_502_400, end: 1_792_094_399, stars: 30, maxStars: 36 },
    expeditions: [
      { character: 'Yelan', id: 202, start: 1_791_010_000, hours: 20, doneAt: 1_791_082_000 },
      { id: 301, start: 1_791_000_000, hours: 20, doneAt: 1_791_054_000 },
    ],
    realm: { value: 1_800, limit: 2_400 },
    welkin: { days: 0 },
  },
} satisfies Partial<Good>

describe("irminsul's gi_tasks", () => {
  it('round-trips, expeditions by when they are done, last of the extra keys', async () => {
    const input = { ...sample, ...extras, ...anecdotes, ...tasks }
    const { encoded, decoded } = await roundTrip(input)
    expect(extraSectionsOf(encoded).map((s) => s.kind)).toEqual([
      'player',
      'achievementTimes',
      'characterExtras',
      'anecdotes',
      'tasks',
    ])
    expect(canonical(decoded)).toEqual(canonical(expectedGood(input)))
    expect(decoded.gi_tasks).toEqual({
      ...tasks.gi_tasks,
      expeditions: [tasks.gi_tasks.expeditions[1], tasks.gi_tasks.expeditions[0]],
    })
    expect(Object.keys(decoded).slice(-2)).toEqual(['gi_anecdotes', 'gi_tasks'])
    // One part alone.
    const alone = await roundTrip({ ...sample, gi_tasks: { expeditions: [] } })
    expect(alone.decoded.gi_tasks).toEqual({ expeditions: [] })
  })

  it('round-trips the Epitomized Path and the resin clock, and drops them out of range', async () => {
    const more = {
      ...sample,
      gi_tasks: {
        ...tasks.gi_tasks,
        wishPath: { weapon: 'StaffOfHoma', points: 1, max: 1 },
        resin: { value: 124, nextAt: 1_791_000_300 },
      },
    }
    const { decoded } = await roundTrip(more)
    expect(decoded.gi_tasks?.wishPath).toEqual({ weapon: 'StaffOfHoma', points: 1, max: 1 })
    expect(decoded.gi_tasks?.resin).toEqual({ value: 124, nextAt: 1_791_000_300 })
    const bad = await roundTrip({
      ...sample,
      gi_tasks: {
        welkin: { days: 3 },
        wishPath: { weapon: 'StaffOfHoma', points: 2, max: 1 },
        resin: { value: 124, nextAt: 12 },
      },
    })
    expect(bad.decoded.gi_tasks).toEqual({ welkin: { days: 3 } })
  })

  it('keeps the content hash of a file without them, and knows the one from before them', async () => {
    const catalog = new Catalog()
    const plain = await roundTrip(sample, catalog)
    const before = await roundTrip({ ...sample, ...extras, ...anecdotes }, catalog)
    const all = await roundTrip({ ...sample, ...extras, ...anecdotes, ...tasks }, catalog)
    const only = await roundTrip({ ...sample, ...tasks }, catalog)
    const noAnecdotes = await roundTrip({ ...sample, ...extras, ...tasks }, catalog)
    const extrasOnly = await roundTrip({ ...sample, ...extras }, catalog)

    expect(plain.encoded.preTasksContentHash).toBe(plain.encoded.contentHash)
    expect(before.encoded.preTasksContentHash).toBe(before.encoded.contentHash)
    expect(all.encoded.contentHash).not.toBe(before.encoded.contentHash)
    expect(all.encoded.preTasksContentHash).toBe(before.encoded.contentHash)
    expect(all.encoded.preAnecdotesContentHash).toBe(extrasOnly.encoded.contentHash)
    expect(only.encoded.preTasksContentHash).toBe(plain.encoded.contentHash)
    expect(only.encoded.contentHash).not.toBe(plain.encoded.contentHash)
    expect(noAnecdotes.encoded.preTasksContentHash).toBe(extrasOnly.encoded.contentHash)
    expect(new Set([all, only, noAnecdotes].map((x) => x.encoded.contentHash)).size).toBe(3)

    // Another day's state is another capture.
    const later = await roundTrip(
      { ...sample, ...extras, ...anecdotes, gi_tasks: { ...tasks.gi_tasks, welkin: { days: 1 } } },
      catalog,
    )
    expect(later.encoded.contentHash).not.toBe(all.encoded.contentHash)
    expect(later.encoded.preTasksContentHash).toBe(all.encoded.preTasksContentHash)
  })

  it('keeps each part only when all of it is in range', () => {
    const read = (raw: unknown) => normalizeGood({ ...sample, gi_tasks: raw }).tasks
    expect(
      read({
        commissions: { finished: 5, total: 4 },
        abyss: { start: 1_789_502_400, end: 1_789_502_400, stars: 1, maxStars: 36 },
        expeditions: [
          { character: 'Yelan', id: 202, start: 1_791_010_000, hours: 20, doneAt: 1_791_082_000 },
          { character: 'Hu Tao', id: 202, start: 1_791_010_000, hours: 20, doneAt: 1_791_082_000 },
        ],
        realm: { value: 2_401, limit: 2_400 },
        welkin: { days: 30 },
      }),
    ).toEqual({ welkin: { days: 30 } })
    // The edges.
    expect(
      read({
        commissions: { finished: 0, total: 10 },
        abyss: {
          start: 1_789_502_400,
          end: 1_789_502_400 + 62 * 86_400,
          stars: 108,
          maxStars: 108,
        },
        expeditions: [{ id: 1, start: 1_420_070_400, hours: 100, doneAt: 1_420_070_400 }],
        realm: { value: 0, limit: 100_000 },
        welkin: { days: 400 },
      }),
    ).toEqual({
      commissions: { finished: 0, total: 10 },
      abyss: { start: 1_789_502_400, end: 1_789_502_400 + 62 * 86_400, stars: 108, maxStars: 108 },
      expeditions: [{ id: 1, start: 1_420_070_400, hours: 100, doneAt: 1_420_070_400 }],
      realm: { value: 0, limit: 100_000 },
      welkin: { days: 400 },
    })
    const tooMany = Array.from({ length: 21 }, () => ({
      id: 101,
      start: 1_791_000_000,
      hours: 4,
      doneAt: 1_791_014_400,
    }))
    for (const raw of [{ expeditions: tooMany }, { welkin: { days: -1 } }, {}, [1], 'x', null]) {
      expect(read(raw)).toBeNull()
    }
  })

  it('stores the section in its binary layout and gives it back exactly', () => {
    const value = encodeTasks(normalizeGood({ ...sample, ...tasks }).tasks!)
    expect(value).toEqual({
      c: [3, 4],
      a: [1_789_502_400, 1_792_094_399, 30, 36],
      e: [
        ['', 301, 1_791_000_000, 20, 1_791_054_000],
        ['Yelan', 202, 1_791_010_000, 20, 1_791_082_000],
      ],
      r: [1_800, 2_400],
      w: 0,
    })
    for (const v of [value, { e: [] }, { w: 3 }, { c: [0, 4], r: [0, 300] }]) {
      const clean = JSON.parse(JSON.stringify(v))
      const blob = encodeSectionBlob('tasks', clean, false, null)
      expect(blob.payload[0]).toBe(0x10)
      const back = decodeSectionBlob(kindCode('tasks', false), blob.data, null, null)
      expect(JSON.stringify(back.value)).toBe(JSON.stringify(clean))
      expect(decodeTasks(back.value as typeof value)).toEqual(decodeTasks(clean))
    }
  })
})

// ------------------------------------------------------------- gi_collections

/** 120 of the 141001-141306 range, ascending (made up, as a capture sends them). */
function spincrystalIds(count = 120, seed = 7): number[] {
  let x = seed
  const ids = new Set<number>()
  while (ids.size < count) {
    x = (x * 1_103_515_245 + 12_345) % 2 ** 31
    ids.add(141_001 + (x % 306))
  }
  return [...ids].sort((a, b) => a - b)
}

const collections = {
  gi_collections: { spincrystals: spincrystalIds() },
} satisfies Partial<Good>

describe("Teyvat.me Capture's gi_collections", () => {
  it('round-trips, ids ascending, last of the extra keys', async () => {
    const input = { ...sample, ...extras, ...anecdotes, ...tasks, ...collections }
    const { encoded, decoded } = await roundTrip(input)
    expect(extraSectionsOf(encoded).map((s) => s.kind)).toEqual([
      'player',
      'achievementTimes',
      'characterExtras',
      'anecdotes',
      'tasks',
      'collections',
    ])
    expect(canonical(decoded)).toEqual(canonical(expectedGood(input)))
    expect(decoded.gi_collections).toEqual(collections.gi_collections)
    expect(decoded.gi_collections!.spincrystals).toHaveLength(120)
    expect(Object.keys(decoded).slice(-2)).toEqual(['gi_tasks', 'gi_collections'])
    // Sent out of order: stored ascending. An empty list is a list (none yet).
    const shuffled = [...collections.gi_collections.spincrystals].reverse()
    const unsorted = await roundTrip({ ...sample, gi_collections: { spincrystals: shuffled } })
    expect(unsorted.decoded.gi_collections).toEqual(collections.gi_collections)
    const none = await roundTrip({ ...sample, gi_collections: { spincrystals: [] } })
    expect(none.decoded.gi_collections).toEqual({ spincrystals: [] })
    // Absent is not "none": no section at all.
    const absent = await roundTrip({ ...sample, gi_collections: {} })
    expect(absent.encoded.collections).toBeNull()
    expect('gi_collections' in absent.decoded).toBe(false)
  })

  it('keeps the content hash of a file without them, and knows the one from before them', async () => {
    const catalog = new Catalog()
    const plain = await roundTrip(sample, catalog)
    const before = await roundTrip({ ...sample, ...extras, ...anecdotes, ...tasks }, catalog)
    const all = await roundTrip(
      { ...sample, ...extras, ...anecdotes, ...tasks, ...collections },
      catalog,
    )
    const only = await roundTrip({ ...sample, ...collections }, catalog)
    const noTasks = await roundTrip({ ...sample, ...extras, ...anecdotes, ...collections }, catalog)
    const anecdotesOnly = await roundTrip({ ...sample, ...extras, ...anecdotes }, catalog)

    expect(plain.encoded.preCollectionsContentHash).toBe(plain.encoded.contentHash)
    expect(before.encoded.preCollectionsContentHash).toBe(before.encoded.contentHash)
    expect(all.encoded.contentHash).not.toBe(before.encoded.contentHash)
    expect(all.encoded.preCollectionsContentHash).toBe(before.encoded.contentHash)
    expect(all.encoded.preTasksContentHash).toBe(before.encoded.preTasksContentHash)
    expect(only.encoded.preCollectionsContentHash).toBe(plain.encoded.contentHash)
    expect(only.encoded.contentHash).not.toBe(plain.encoded.contentHash)
    expect(noTasks.encoded.preCollectionsContentHash).toBe(anecdotesOnly.encoded.contentHash)
    expect(new Set([all, only, noTasks].map((x) => x.encoded.contentHash)).size).toBe(3)

    // One more Spincrystal is another capture.
    const more = spincrystalIds(121)
    const later = await roundTrip(
      { ...sample, ...extras, ...anecdotes, ...tasks, gi_collections: { spincrystals: more } },
      catalog,
    )
    expect(later.encoded.contentHash).not.toBe(all.encoded.contentHash)
    expect(later.encoded.preCollectionsContentHash).toBe(all.encoded.preCollectionsContentHash)
  })

  it('keeps a part only when every entry passes', () => {
    const read = (raw: unknown) => normalizeGood({ ...sample, gi_collections: raw }).collections
    const ids = collections.gi_collections.spincrystals
    expect(read({ spincrystals: [100_000, 999_999] })).toEqual({ spincrystals: [100_000, 999_999] })
    for (const bad of [
      [...ids, ids[0]],
      [...ids, 99_999],
      [...ids, 1_000_000],
      [...ids, 141_001.5],
      [...ids, '141001'],
      [...ids, null],
      [...ids, -141_001],
    ]) {
      expect(read({ spincrystals: bad })).toBeNull()
    }
    // A part this build does not know yet is not stored (and not a reason to drop the rest).
    expect(read({ spincrystals: [141_002], handbook: [1] })).toEqual({ spincrystals: [141_002] })
    for (const raw of [{ handbook: [1] }, { spincrystals: 'x' }, {}, [141_001], 'x', null]) {
      expect(read(raw)).toBeNull()
    }
  })

  it('stores the section in its binary layout, and a later part as JSON', () => {
    const value = encodeCollections(normalizeGood({ ...sample, ...collections }).collections!)!
    expect(value).toEqual({ s: collections.gi_collections.spincrystals })
    for (const v of [value, { s: [] }, { s: [141_306] }, {}]) {
      const blob = encodeSectionBlob('collections', v, false, null)
      expect(blob.payload[0]).toBe(0x10)
      const back = decodeSectionBlob(kindCode('collections', false), blob.data, null, null)
      expect(JSON.stringify(back.value)).toBe(JSON.stringify(v))
      expect(decodeCollections(back.value as NonNullable<typeof value>)).toEqual(
        decodeCollections(v),
      )
    }
    // 120 ids: a byte or two each before compression.
    expect(encodeSectionBlob('collections', value, false, null).data.length).toBeLessThan(140)
    // A part a later build adds is kept whole, as JSON, by this one's decoder too.
    const later = { s: [141_001], h: [[1, 2]] }
    const blob = encodeSectionBlob('collections', later, false, null)
    expect(blob.payload[0]).toBe(0x00)
    const back = decodeSectionBlob(kindCode('collections', false), blob.data, null, null)
    expect(back.value).toEqual(later)
  })
})

// ------------------------------------- gi_collections' 1.4.0 parts, gi_wardrobe

describe("Teyvat.me Capture 1.4.0's collections and wardrobe", () => {
  const full = syntheticCollections(4)
  const wardrobe = syntheticWardrobe(4)
  const input = { ...sample, ...extras, gi_collections: full, gi_wardrobe: wardrobe }

  it("round-trips every part at a real capture's scale, the wardrobe last", async () => {
    const { encoded, decoded } = await roundTrip(input)
    expect(
      extraSectionsOf(encoded)
        .map((s) => s.kind)
        .slice(-3),
    ).toEqual(['collections', 'collections2', 'wardrobe'])
    expect(canonical(decoded)).toEqual(canonical(expectedGood(input)))
    expect(decoded.gi_collections).toEqual(normalizeGood(input).collections)
    expect(decoded.gi_wardrobe).toEqual(normalizeGood(input).wardrobe)
    expect(Object.keys(decoded).slice(-2)).toEqual(['gi_collections', 'gi_wardrobe'])
    // The player's own text, as typed.
    expect(decoded.gi_collections!.tcg!.decks!['3']!.name).toBe(full.tcg!.decks!['3']!.name)
    expect(decoded.gi_wardrobe!.teams!['1']!.name).toBe('Abyss ★ Floor 12 — second half')
    const a = decoded.gi_collections!.archive!
    expect([a.quests, a.weapons, a.livingBeings, a.materials].map((l) => l!.length)).toEqual([
      488, 164, 538, 1_006,
    ])
    expect(Object.keys(decoded.gi_collections!.defeats!)).toHaveLength(502)
    expect(Object.keys(decoded.gi_collections!.handbook!.targets)).toHaveLength(244)
  })

  it('keeps the hash of a file without the new parts, and knows the one from before the wardrobe', async () => {
    const catalog = new Catalog()
    const spincrystalsOnly = { ...sample, gi_collections: { spincrystals: full.spincrystals } }
    const before = await roundTrip(spincrystalsOnly, catalog)
    // The section of a file with only spincrystals is the one 1.3.0 stored.
    expect(encodeCollections({ spincrystals: full.spincrystals! })).toEqual({
      s: full.spincrystals,
    })
    // A 1.4.0 file as the deployed tracker stored it (only the Spincrystals
    // of gi_collections, no wardrobe): the same capture, a no-op re-upload.
    const all = await roundTrip({ ...sample, gi_collections: full, gi_wardrobe: wardrobe }, catalog)
    expect(all.encoded.preCollections2ContentHash).toBe(before.encoded.contentHash)
    expect(new Set([all.encoded.contentHash, all.encoded.preWardrobeContentHash]).size).toBe(2)
    const withWardrobe = await roundTrip({ ...spincrystalsOnly, gi_wardrobe: wardrobe }, catalog)
    expect(before.encoded.preWardrobeContentHash).toBe(before.encoded.contentHash)
    expect(withWardrobe.encoded.preWardrobeContentHash).toBe(before.encoded.contentHash)
    expect(withWardrobe.encoded.contentHash).not.toBe(before.encoded.contentHash)
    const plain = await roundTrip(sample, catalog)
    const wardrobeOnly = await roundTrip({ ...sample, gi_wardrobe: wardrobe }, catalog)
    expect(wardrobeOnly.encoded.preWardrobeContentHash).toBe(plain.encoded.contentHash)
    expect(plain.encoded.preWardrobeContentHash).toBe(plain.encoded.contentHash)
  })

  it('drops a bad part and keeps the rest', () => {
    const read = (collections: unknown, wardrobeRaw?: unknown) =>
      normalizeGood({ ...sample, gi_collections: collections, gi_wardrobe: wardrobeRaw })
    const bad = (part: string, value: unknown) => {
      const good = read({ ...full, [part]: value })
      expect(good.collections && part in good.collections, part).toBe(false)
      const kept = part === 'spincrystals' ? 'archive' : 'spincrystals'
      expect(good.collections?.[kept], part).toEqual(
        normalizeGood({ ...sample, gi_collections: full }).collections![kept],
      )
    }
    bad('archive', { quests: [10_000_001, 10_000_001] })
    bad('defeats', { '20010001': { defeated: -1 } })
    bad('defeats', { '1': { defeated: 3 } })
    bad('handbook', {
      chapters: { '10001': { progress: 1, total: 2, state: 'done' } },
      targets: {},
    })
    bad('aranara', { '1': { '1': 'lost' } })
    bad('tcg', { cards: { '1101': { count: 1.5 } } })
    bad('tcg', {
      cards: {},
      decks: { '0': { name: 'x'.repeat(101), characters: [], cards: [], valid: true } },
    })
    bad(
      'spincrystals',
      Array.from({ length: GOOD_LIMITS.spincrystals + 1 }, (_, i) => 141_001 + i),
    )
    // One bad tab drops only that tab.
    const tab = read({ archive: { quests: [10_000_001], weapons: [1] } }).collections
    expect(tab).toEqual({ archive: { quests: [10_000_001] } })
    // Wardrobe: a bad kind goes, the rest stays.
    const w = read(null, { ...wardrobe, gliders: { owned: [1, 1], worn: {} } }).wardrobe!
    expect('gliders' in w).toBe(false)
    expect(w.outfits).toEqual(normalizeGood({ ...sample, gi_wardrobe: wardrobe }).wardrobe!.outfits)
    expect(
      read(null, { teams: { '1': { name: 'A', characters: ['Not a key!'] } } }).wardrobe,
    ).toBeNull()
    expect(read(null, { currentTeam: 2 }).wardrobe).toEqual({ currentTeam: 2 })
  })

  it('stores the 1.4.0 parts and the wardrobe in their binary layouts, small', () => {
    const collectionsValue = JSON.parse(
      JSON.stringify(encodeCollections2(normalizeGood(input).collections!)),
    )
    const wardrobeValue = JSON.parse(JSON.stringify(encodeWardrobe(normalizeGood(input).wardrobe!)))
    // The Spincrystals stay in the `collections` section as 1.3.0 stored them
    // (the deployed builds' layout); the later parts have their own section.
    expect(encodeCollections(normalizeGood(input).collections!)).toEqual({ s: full.spincrystals })
    expect('s' in collectionsValue).toBe(false)
    for (const [kind, value, layout, decode] of [
      ['collections2', collectionsValue, 0x10, decodeCollections],
      ['wardrobe', wardrobeValue, 0x10, decodeWardrobe],
      ['collections', { s: full.spincrystals }, 0x10, decodeCollections],
    ] as const) {
      const blob = encodeSectionBlob(kind, value, false, null)
      expect(blob.payload[0], kind).toBe(layout)
      const back = decodeSectionBlob(kindCode(kind, false), blob.data, null, null)
      expect(JSON.stringify(back.value)).toBe(JSON.stringify(value))
      expect(decode(back.value as never)).toEqual(decode(value as never))
    }
    // About 3.5k Archive ids, 502 defeats, 244 targets, 104 cards and 4 decks.
    const last = encodeSectionBlob('collections2', collectionsValue, false, null)
    expect(last.data.length).toBeLessThan(12_000)
    expect(encodeSectionBlob('wardrobe', wardrobeValue, false, null).data.length).toBeLessThan(
      1_500,
    )
    // A few more defeats cost a few bytes against the last section.
    const next = structuredClone(collectionsValue)
    next.d[0][1] += 3
    next.d[10][1] += 1
    const changed = encodeSectionBlob('collections2', next, false, {
      value: collectionsValue,
      payload: last.payload,
    })
    expect(changed.usesBase).toBe(true)
    expect(changed.data.length).toBeLessThan(200)
    // A part this build does not know: JSON (its encoder refuses it whole).
    const later = { ...collectionsValue, z: [1] }
    expect(encodeSectionBlob('collections2', later, false, null).payload[0]).toBe(0x00)
    // A part a later build writes (an index this build has none for) is
    // skipped by this decoder, which reads the rest.
    for (const [kind, value] of [
      ['collections2', collectionsValue],
      ['wardrobe', wardrobeValue],
    ] as const) {
      const payload = encodeSectionBlob(kind, value, false, null).payload
      const extended = new Uint8Array([...payload, 99, 3, 7, 7, 7])
      const back = decodeSectionBlob(kindCode(kind, false), extended, null, null)
      expect(JSON.stringify(back.value), kind).toBe(JSON.stringify(value))
    }
  })
})

// ------------------------------------------- gi_collections.recipes (1.5.0)

describe("Teyvat.me Capture 1.5.0's recipes", () => {
  const recipes = syntheticRecipes(6)
  const base = {
    ...sample,
    gi_collections: syntheticCollections(6),
    gi_wardrobe: syntheticWardrobe(6),
  }
  const withRecipes = { ...base, gi_collections: { ...base.gi_collections, recipes } }

  it('round-trips inside collections2, last of its parts', async () => {
    const { encoded, decoded } = await roundTrip(withRecipes)
    expect(decoded.gi_collections!.recipes).toEqual(recipes)
    expect(Object.keys(decoded.gi_collections!).at(-1)).toBe('recipes')
    expect(Object.keys(JSON.parse(encoded.collections2!.json)).at(-1)).toBe('p')
    const blob = encodeSectionBlob(
      'collections2',
      JSON.parse(encoded.collections2!.json),
      false,
      null,
    )
    expect(blob.payload[0]).toBe(0x10)
    // Recipes alone make a collections2 of their own.
    const alone = await roundTrip({ ...sample, gi_collections: { recipes: { '1001': 0 } } })
    expect(alone.decoded.gi_collections).toEqual({ recipes: { '1001': 0 } })
  })

  it('knows the hash a tracker from before recipes gave the same file', async () => {
    const catalog = new Catalog()
    const before = await roundTrip(base, catalog)
    const after = await roundTrip(withRecipes, catalog)
    expect(after.encoded.contentHash).not.toBe(before.encoded.contentHash)
    expect(after.encoded.preRecipesContentHash).toBe(before.encoded.contentHash)
    expect(before.encoded.preRecipesContentHash).toBe(before.encoded.contentHash)
    // Without other parts or a wardrobe: the hash of the file without collections2.
    const plain = await roundTrip(sample, catalog)
    const only = await roundTrip({ ...sample, gi_collections: { recipes } }, catalog)
    expect(only.encoded.preRecipesContentHash).toBe(plain.encoded.contentHash)
  })

  it('drops the list when one entry is bad, and keeps the rest', () => {
    const read = (value: unknown) =>
      normalizeGood({ ...sample, gi_collections: { spincrystals: [141_001], recipes: value } })
        .collections
    for (const bad of [{ '1001': -1 }, { '1001': 1.5 }, { x: 1 }, { '01001': 1 }, [1], 'x']) {
      expect(read(bad)).toEqual({ spincrystals: [141_001] })
    }
    const tooMany = Object.fromEntries(
      Array.from({ length: GOOD_LIMITS.recipes + 1 }, (_, i) => [String(1_000 + i), 0]),
    )
    expect(read(tooMany)).toEqual({ spincrystals: [141_001] })
    expect(read({ '5502': 30, '1001': 0 })!.recipes).toEqual({ '1001': 0, '5502': 30 })
  })
})

// ---------------------------------------------------- gi_exploration (1.6.0)

describe("Teyvat.me Capture 1.6.0's exploration", () => {
  const exploration = syntheticExploration(5)
  const base = {
    ...sample,
    gi_collections: syntheticCollections(5),
    gi_wardrobe: syntheticWardrobe(5),
  }
  const input = { ...base, gi_exploration: exploration }

  it("round-trips every part at a real capture's scale, last", async () => {
    const { encoded, decoded } = await roundTrip(input)
    expect(extraSectionsOf(encoded).at(-1)!.kind).toBe('exploration')
    expect(canonical(decoded)).toEqual(canonical(expectedGood(input)))
    expect(decoded.gi_exploration).toEqual(exploration)
    expect(Object.keys(decoded).at(-1)).toBe('gi_exploration')
    expect(decoded.gi_exploration!.scenes!['3']!.points).toHaveLength(893)
  })

  it('knows the hash a tracker from before the exploration gave the same file', async () => {
    const catalog = new Catalog()
    const before = await roundTrip(base, catalog)
    const after = await roundTrip(input, catalog)
    expect(after.encoded.contentHash).not.toBe(before.encoded.contentHash)
    expect(after.encoded.preExplorationContentHash).toBe(before.encoded.contentHash)
    expect(before.encoded.preExplorationContentHash).toBe(before.encoded.contentHash)
    // The older steps still name what older trackers stored.
    expect(after.encoded.preWardrobeContentHash).toBe(before.encoded.preWardrobeContentHash)
    const plain = await roundTrip(sample, catalog)
    const only = await roundTrip({ ...sample, gi_exploration: exploration }, catalog)
    expect(only.encoded.preExplorationContentHash).toBe(plain.encoded.contentHash)
    expect(only.encoded.preWardrobeContentHash).toBe(plain.encoded.contentHash)
  })

  it('drops a bad part and keeps the rest', () => {
    const read = (value: unknown) => normalizeGood({ ...sample, gi_exploration: value }).exploration
    const bad = (part: string, value: unknown) => {
      const got = read({ ...exploration, [part]: value })
      expect(got && part in got, part).toBe(false)
      const kept = part === 'statues' ? 'offerings' : 'statues'
      expect(got?.[kept], part).toEqual(exploration[kept])
    }
    bad('statues', { '1': { level: 10 } })
    bad('statues', { '1': { level: -1, oculi: 0 } })
    bad('offerings', { '1': 2.5 })
    bad('offerings', { x: 1 })
    bad('scenes', { '3': { points: [1, 1], areas: [] } })
    bad('scenes', { '3': { points: [1] } })
    bad('explore', { '1': -1 })
    bad('reputation', { '1': 'ten' })
    const tooMany = Object.fromEntries(
      Array.from({ length: GOOD_LIMITS.exploreAreas + 1 }, (_, i) => [String(i), 1]),
    )
    bad('explore', tooMany)
    expect(read({ nothing: true })).toBeNull()
    expect(read([1])).toBeNull()
    // Rewritten in id order, so the hash does not depend on the key order.
    expect(Object.keys(read({ offerings: { '20': 1, '3': 2 } })!.offerings!)).toEqual(['3', '20'])
  })

  it('stores it in its binary layout, small, and a new map point costs a few bytes', () => {
    const value = JSON.parse(JSON.stringify(encodeExploration(exploration)))
    const blob = encodeSectionBlob('exploration', value, false, null)
    expect(blob.payload[0]).toBe(0x10)
    const back = decodeSectionBlob(kindCode('exploration', false), blob.data, null, null)
    expect(JSON.stringify(back.value)).toBe(JSON.stringify(value))
    expect(decodeExploration(back.value as never)).toEqual(exploration)
    expect(blob.data.length).toBeLessThan(2_500)
    const next = structuredClone(value)
    next.p[0][1].push(next.p[0][1].at(-1) + 1)
    next.x[3][1] += 12
    const changed = encodeSectionBlob('exploration', next, false, {
      value,
      payload: blob.payload,
    })
    expect(changed.usesBase).toBe(true)
    expect(changed.data.length).toBeLessThan(120)
    // A part a later build writes is skipped by this decoder, which reads the rest.
    const extended = new Uint8Array([...blob.payload, 99, 3, 7, 7, 7])
    const later = decodeSectionBlob(kindCode('exploration', false), extended, null, null)
    expect(JSON.stringify(later.value)).toBe(JSON.stringify(value))
  })
})

// ------------------------------------------------------------- Capture 1.7.0

describe("Teyvat.me Capture 1.7.0's keys", () => {
  const new17 = synthetic17(8)
  const base = {
    ...sample,
    gi_tasks: { welkin: { days: 30 } },
    gi_collections: syntheticCollections(8),
    gi_exploration: syntheticExploration(8),
  }
  const input = {
    ...base,
    gi_tasks: { ...base.gi_tasks, ...new17.tasks },
    gi_collections: { ...base.gi_collections, ...new17.collections },
    gi_achievement_progress: new17.achievementProgress,
    gi_events: new17.events,
  }

  it("round-trips every part at a real capture's scale", async () => {
    const { encoded, decoded } = await roundTrip(input)
    expect(extraSectionsOf(encoded).at(-1)!.kind).toBe('progress')
    expect(canonical(decoded)).toEqual(canonical(expectedGood(input)))
    expect(decoded.gi_tasks).toEqual(input.gi_tasks)
    expect(decoded.gi_collections!.hangouts).toEqual(new17.collections.hangouts)
    expect(decoded.gi_collections!.monstersSeen).toHaveLength(2_300)
    expect(decoded.gi_achievement_progress).toEqual(new17.achievementProgress)
    expect(decoded.gi_events).toEqual(new17.events)
    expect(Object.keys(decoded).slice(-2)).toEqual(['gi_achievement_progress', 'gi_events'])
  })

  it('knows the hash a tracker from before 1.7.0 gave the same file', async () => {
    const catalog = new Catalog()
    const before = await roundTrip(base, catalog)
    const after = await roundTrip(input, catalog)
    expect(after.encoded.contentHash).not.toBe(before.encoded.contentHash)
    expect(after.encoded.pre17ContentHash).toBe(before.encoded.contentHash)
    expect(before.encoded.pre17ContentHash).toBe(before.encoded.contentHash)
    // Each 1.7.0 part alone, too.
    for (const part of [
      { gi_tasks: { ...base.gi_tasks, arRewards: [2, 3] } },
      { gi_collections: { ...base.gi_collections, blueprints: [360_101] } },
      { gi_events: new17.events },
    ]) {
      const one = await roundTrip({ ...base, ...part }, catalog)
      expect(one.encoded.pre17ContentHash).toBe(before.encoded.contentHash)
    }
    // Only 1.7.0 task parts: the file had no tasks before.
    const plain = await roundTrip(sample, catalog)
    const tasksOnly = await roundTrip({ ...sample, gi_tasks: new17.tasks }, catalog)
    expect(tasksOnly.encoded.pre17ContentHash).toBe(plain.encoded.contentHash)
  })

  it('drops a bad part and keeps the rest', () => {
    const read = (patch: object) => normalizeGood({ ...input, ...patch })
    const t = (tasks: object) => read({ gi_tasks: { ...input.gi_tasks, ...tasks } }).tasks!
    expect(
      'weeklyBosses' in t({ weeklyBosses: { left: 4, limit: 3, cost: 30, fullCost: 60 } }),
    ).toBe(false)
    // Capture 1.14.0's `used` is kept beside `left`; one out of range is left out.
    const boss = { left: 2, limit: 3, cost: 30, fullCost: 60 }
    expect(t({ weeklyBosses: { ...boss, used: 1 } }).weeklyBosses).toEqual({ ...boss, used: 1 })
    expect(t({ weeklyBosses: { ...boss, used: 4 } }).weeklyBosses).toEqual(boss)
    expect(decodeTasks(encodeTasks({ weeklyBosses: { ...boss, used: 1 } }))).toEqual({
      weeklyBosses: { ...boss, used: 1 },
    })
    expect(decodeTasks(encodeTasks({ weeklyBosses: boss }))).toEqual({ weeklyBosses: boss })
    // Capture 1.16.0: Katheryne's reward beside the commissions, the resin spent today.
    const claimed = { finished: 4, total: 4, claimed: true }
    expect(t({ commissions: claimed }).commissions).toEqual(claimed)
    expect(t({ commissions: { finished: 4, total: 4, claimed: 1 } }).commissions).toEqual({
      finished: 4,
      total: 4,
    })
    const spent = { value: 160, day: 3, at: 1_791_756_000 }
    expect(t({ resinSpent: spent }).resinSpent).toEqual(spent)
    expect('resinSpent' in t({ resinSpent: { ...spent, day: 8 } })).toBe(false)
    expect('resinSpent' in t({ resinSpent: { ...spent, value: 2_010 } })).toBe(false)
    for (const tasks of [
      { commissions: claimed, resinSpent: spent },
      { commissions: { ...claimed, claimed: false } },
      { commissions: { finished: 2, total: 4 } },
    ]) {
      expect(decodeTasks(encodeTasks(tasks))).toEqual(tasks)
      const section = JSON.parse(JSON.stringify(encodeTasks(tasks)))
      const blob = encodeSectionBlob('tasks', section, false, null)
      const back = decodeSectionBlob(kindCode('tasks', false), blob.data, null, null)
      expect(decodeTasks(back.value as typeof section)).toEqual(tasks)
    }
    // Capture 1.17.2: Paimon's Bargains; one bad Fate and the part is left out.
    const fate = { item: 'IntertwinedFate', currency: 'MasterlessStardust', cost: 75, bought: 2 }
    const bargains = {
      at: 1_791_756_000,
      bought: true,
      fates: [
        { ...fate, limit: 5 },
        { item: 'AcquaintFate', currency: 'MasterlessStarglitter', cost: 5, bought: 0 },
      ],
    }
    expect(t({ bargains }).bargains).toEqual(bargains)
    for (const bad of [
      { ...fate, limit: 1 },
      { ...fate, item: 'Primogem' },
      { ...fate, cost: 0 },
      { ...fate, bought: -1 },
    ]) {
      expect('bargains' in t({ bargains: { ...bargains, fates: [bad] } })).toBe(false)
    }
    expect('bargains' in t({ bargains: { ...bargains, bought: 1 } })).toBe(false)
    for (const tasks of [{ bargains }, { bargains: { ...bargains, bought: false, fates: [] } }]) {
      const section = JSON.parse(JSON.stringify(encodeTasks(tasks)))
      const blob = encodeSectionBlob('tasks', section, false, null)
      const back = decodeSectionBlob(kindCode('tasks', false), blob.data, null, null)
      expect(decodeTasks(back.value as typeof section)).toEqual(tasks)
    }
    expect('respawns' in t({ respawns: { '1001': [1] } })).toBe(false)
    expect('arRewards' in t({ arRewards: [2, 2] })).toBe(false)
    expect(t({ respawns: { '1001': [1_790_000_100, 1_790_000_000] } }).respawns).toEqual({
      '1001': [1_790_000_000, 1_790_000_100],
    })
    const c = (collections: object) =>
      read({ gi_collections: { ...input.gi_collections, ...collections } }).collections!
    expect(
      'hangouts' in
        c({ hangouts: { '101401': { endings: { '1': 'done' }, pictures: [], picturesTotal: 1 } } }),
    ).toBe(false)
    expect('monstersSeen' in c({ monstersSeen: [5, 5] })).toBe(false)
    expect(c({ blueprints: [1] }).monstersSeen).toHaveLength(2_300)
    expect(
      read({ gi_achievement_progress: { '80001': { progress: -1, total: 1 } } })
        .achievementProgress,
    ).toBeNull()
    expect(
      read({
        gi_events: {
          '1': { schedule: 1, start: 1, end: 2, progress: { '5': { progress: 1, total: 1 } } },
        },
      }).events,
    ).toBeNull()
  })

  it('stores collections2 and progress in their binary layouts, the tasks as JSON', async () => {
    const good = normalizeGood(input)
    const c2 = JSON.parse(JSON.stringify(encodeCollections2(good.collections!)))
    const progress = JSON.parse(
      JSON.stringify(
        encodeProgress({ achievementProgress: good.achievementProgress!, events: good.events! }),
      ),
    )
    for (const [kind, value, decode] of [
      ['collections2', c2, decodeCollections],
      ['progress', progress, decodeProgress],
    ] as const) {
      const blob = encodeSectionBlob(kind, value, false, null)
      expect(blob.payload[0], kind).toBe(0x10)
      const back = decodeSectionBlob(kindCode(kind, false), blob.data, null, null)
      expect(JSON.stringify(back.value)).toBe(JSON.stringify(value))
      expect(decode(back.value as never)).toEqual(decode(value as never))
    }
    expect(encodeSectionBlob('progress', progress, false, null).data.length).toBeLessThan(1_500)
    // The deployed tasks layout has no place for the new letters: JSON, which old decoders read.
    const tasks = JSON.parse(JSON.stringify(encodeTasks(good.tasks!)))
    expect(encodeSectionBlob('tasks', tasks, false, null).payload[0]).toBe(0x00)
    expect(decodeTasks(tasks)).toEqual(good.tasks)
  })
})

// ------------------------------------------------------ Capture 1.8.0-1.11.0

describe("Teyvat.me Capture 1.8.0-1.11.0's keys", () => {
  const new18 = synthetic18(9)
  const collections = { ...syntheticCollections(9), ...synthetic17(9).collections }
  const base = {
    ...sample,
    gi_tasks: { welkin: { days: 30 }, ...synthetic17(9).tasks },
    gi_collections: collections,
    gi_exploration: syntheticExploration(9),
    gi_events: synthetic17(9).events,
  }
  const input = {
    ...base,
    gi_tasks: { ...base.gi_tasks, ...new18.tasks },
    gi_collections: {
      ...collections,
      ...new18.collections,
      tcg: { ...collections.tcg!, ...new18.tcg },
    },
    gi_exploration: { ...base.gi_exploration, ...new18.exploration },
    gi_teapot: new18.teapot,
    gi_miliastra: new18.miliastra,
  }

  it("round-trips every part at a real capture's scale", async () => {
    const { encoded, decoded } = await roundTrip(input)
    expect(extraSectionsOf(encoded).at(-1)!.kind).toBe('extras')
    expect(canonical(decoded)).toEqual(canonical(expectedGood(input)))
    expect(decoded.gi_collections!.tcg).toEqual(input.gi_collections.tcg)
    expect(decoded.gi_collections!.crafting).toEqual(new18.collections.crafting)
    expect(decoded.gi_collections!.musicGame).toEqual(new18.collections.musicGame)
    expect(decoded.gi_tasks!.signIns).toEqual(new18.tasks.signIns)
    expect(decoded.gi_exploration).toEqual(input.gi_exploration)
    expect(decoded.gi_teapot).toEqual(new18.teapot)
    expect(decoded.gi_miliastra).toEqual(new18.miliastra)
    expect(Object.keys(decoded).slice(-2)).toEqual(['gi_teapot', 'gi_miliastra'])
  })

  it('knows the hashes trackers from before 1.8.0 and 1.7.0 gave the same file', async () => {
    const catalog = new Catalog()
    const before = await roundTrip(base, catalog)
    const after = await roundTrip(input, catalog)
    expect(after.encoded.contentHash).not.toBe(before.encoded.contentHash)
    expect(after.encoded.pre18ContentHash).toBe(before.encoded.contentHash)
    expect(after.encoded.pre17ContentHash).toBe(before.encoded.pre17ContentHash)
    expect(before.encoded.pre18ContentHash).toBe(before.encoded.contentHash)
    for (const part of [
      { gi_tasks: { ...base.gi_tasks, ...new18.tasks } },
      { gi_collections: { ...collections, tcg: { ...collections.tcg!, bosses: [1] } } },
      { gi_exploration: { ...base.gi_exploration, domainsCleared: [1006] } },
      { gi_teapot: new18.teapot },
    ]) {
      const one = await roundTrip({ ...base, ...part }, catalog)
      expect(one.encoded.pre18ContentHash).toBe(before.encoded.contentHash)
    }
  })

  describe("Capture 1.17's quests", () => {
    // A long-played account's scale: ~2,400 parent quests finished, ~250 open.
    const quests = {
      finished: Array.from({ length: 2_400 }, (_, i) => 300 + i * 31),
      active: Array.from({ length: 250 }, (_, i) => 80_000 + i * 97),
    }
    const withQuests = { ...input, gi_collections: { ...input.gi_collections, quests } }

    it('round-trips, small, and hashes as before for the trackers that dropped it', async () => {
      const catalog = new Catalog()
      const without = await roundTrip(input, catalog)
      const { encoded, decoded } = await roundTrip(withQuests, catalog)
      expect(decoded.gi_collections!.quests).toEqual(quests)
      expect(encoded.contentHash).not.toBe(without.encoded.contentHash)
      expect(encoded.pre19ContentHash).toBe(without.encoded.contentHash)
      expect(encoded.pre18ContentHash).toBe(without.encoded.pre18ContentHash)
      expect(encoded.pre17ContentHash).toBe(without.encoded.pre17ContentHash)
      expect(without.encoded.pre19ContentHash).toBe(without.encoded.contentHash)
      const part = encodeSectionBlob(
        'collections2',
        { q: { f: quests.finished, a: quests.active } },
        false,
        null,
      )
      expect(part.data.length).toBeLessThan(800)
    })

    it('keeps both lists or neither; a finished id is not open too', () => {
      const read = (q: unknown) =>
        normalizeGood({ ...input, gi_collections: { ...input.gi_collections, quests: q } })
          .collections!.quests
      expect(read({ finished: [5, 3] })).toEqual({ finished: [3, 5] })
      expect(read({ finished: [3, 5], active: [5, 7] })).toEqual({ finished: [3, 5], active: [7] })
      expect(read({ finished: [3, 5], active: [5] })).toEqual({ finished: [3, 5] })
      expect(read({ finished: [3, 3] })).toBeUndefined()
      expect(read({ finished: [3], active: [0] })).toBeUndefined()
      expect(read({ active: [3] })).toBeUndefined()
    })
  })

  it('drops a bad part and keeps the rest', () => {
    const read = (patch: object) => normalizeGood({ ...input, ...patch })
    const c = (more: object) =>
      read({ gi_collections: { ...input.gi_collections, ...more } }).collections!
    expect('crafting' in c({ crafting: { forging: [1, 1] } })).toBe(false)
    expect(c({ crafting: { forging: [1, 1], crafting: [5] } }).crafting).toEqual({ crafting: [5] })
    expect('musicGame' in c({ musicGame: { '1': { score: -1, claimed: true } } })).toBe(false)
    const tcg = c({ tcg: { ...input.gi_collections.tcg, bosses: [2, 2] } }).tcg!
    expect('bosses' in tcg).toBe(false)
    expect(tcg.levels).toEqual(new18.tcg.levels)
    const t = read({
      gi_tasks: { signIns: { '1': { days: 7, claimed: [1], lastAt: 1, start: 1 } } },
    })
    expect(t.tasks).toBeNull()
    const e = read({
      gi_exploration: { ...input.gi_exploration, tribalChapters: { '1': { state: 'done' } } },
    }).exploration!
    expect('tribalChapters' in e).toBe(false)
    expect(read({ gi_teapot: { comfort: { '1': { mansion: 1 } } } }).teapot).toBeNull()
    expect(read({ gi_miliastra: { cosmetics: { '1': -5 } } }).miliastra).toBeNull()
  })

  it('stores the new parts in their binary layouts; old decoders skip them', () => {
    const good = normalizeGood(input)
    const values = {
      collections2: JSON.parse(JSON.stringify(encodeCollections2(good.collections!))),
      exploration: JSON.parse(JSON.stringify(encodeExploration(good.exploration!))),
      extras: JSON.parse(
        JSON.stringify(encodeExtras({ teapot: good.teapot!, miliastra: good.miliastra! })),
      ),
    }
    for (const [kind, value] of Object.entries(values) as [
      'collections2' | 'exploration' | 'extras',
      unknown,
    ][]) {
      const blob = encodeSectionBlob(kind, value, false, null)
      expect(blob.payload[0], kind).toBe(0x10)
      const back = decodeSectionBlob(kindCode(kind, false), blob.data, null, null)
      expect(JSON.stringify(back.value), kind).toBe(JSON.stringify(value))
    }
    // The deployed TCG part keeps its flags: the later TCG parts are their own part `v`.
    expect(Object.keys(values.collections2.g)).toEqual(
      ['c', 'k', 'u'].filter((k) => k in values.collections2.g),
    )
    expect(values.collections2.v).toBeDefined()
  })
})

// ------------------------------------------------------ Capture 1.17.12

describe("Teyvat.me Capture 1.17.12's gi_endgame", () => {
  const endgame = syntheticEndgame(11)
  const new18 = synthetic18(11)
  const base = { ...sample, gi_tasks: { welkin: { days: 30 } } }
  const withExtras = { ...base, gi_teapot: new18.teapot, gi_miliastra: new18.miliastra }
  const input = { ...withExtras, gi_endgame: endgame }

  it("round-trips the Theater run and every Stygian record at a real account's scale", async () => {
    const { encoded, decoded } = await roundTrip(input)
    expect(extraSectionsOf(encoded).at(-1)!.kind).toBe('extras')
    expect(canonical(decoded)).toEqual(canonical(expectedGood(input)))
    expect(decoded.gi_endgame).toEqual(endgame)
    expect(Object.keys(decoded).at(-1)).toBe('gi_endgame')
    expect(endgame.stygian.records.length).toBeGreaterThan(15)
  })

  it('is the extras section alone when the file has no other extras', async () => {
    const { encoded, decoded } = await roundTrip({ ...base, gi_endgame: endgame })
    expect(encoded.extras).not.toBeNull()
    expect(JSON.parse(encoded.extras!.json)).toEqual({
      e: encodeEndgame(normalizeGood(input).endgame!),
    })
    expect(decoded.gi_endgame).toEqual(endgame)
    expect(decoded.gi_teapot).toBeUndefined()
  })

  it('keeps the star count when the capture has it (appended after v1)', async () => {
    const catalog = new Catalog()
    const without = await roundTrip({ ...base, gi_endgame: { theater: endgame.theater } }, catalog)
    const starred = { ...endgame.theater, stars: 12, maxStars: 12 }
    const { encoded, decoded } = await roundTrip(
      { ...base, gi_endgame: { theater: starred } },
      catalog,
    )
    expect(decoded.gi_endgame).toEqual({ theater: starred })
    expect(encoded.contentHash).not.toBe(without.encoded.contentHash)
    expect(JSON.parse(encoded.extras!.json).e).toEqual({
      t: [31, 129, 5, starred.acts],
      r: [12, 12],
    })
    // Earned alone (no maximum sent); 0 stars is a value, not an absence.
    const zero = (
      await roundTrip({ ...base, gi_endgame: { theater: { season: 31, acts: 0, stars: 0 } } })
    ).decoded
    expect(zero.gi_endgame).toEqual({ theater: { season: 31, acts: 0, stars: 0 } })
    const blob = encodeSectionBlob('extras', { e: { t: [31, 129, 5, 10], r: [7, 0] } }, false, null)
    const back = decodeSectionBlob(kindCode('extras', false), blob.data, null, null)
    expect(back.value).toEqual({ e: { t: [31, 129, 5, 10], r: [7, 0] } })
    // A bad star count drops the run, like any other part of it.
    const read = (theater: object) => normalizeGood({ ...base, gi_endgame: { theater } }).endgame
    expect(read({ season: 31, acts: 1, stars: -1 })).toBeNull()
    expect(read({ season: 31, acts: 1, maxStars: 0 })).toBeNull()
    expect(read({ season: 31, acts: 1, stars: 3 })).toEqual({
      theater: { season: 31, acts: 1, stars: 3 },
    })
  })

  it('keeps the theater run or the records alone', async () => {
    const theater = (await roundTrip({ ...base, gi_endgame: { theater: endgame.theater } })).decoded
    expect(theater.gi_endgame).toEqual({ theater: endgame.theater })
    const bare = (await roundTrip({ ...base, gi_endgame: { theater: { season: 31, acts: 0 } } }))
      .decoded
    expect(bare.gi_endgame).toEqual({ theater: { season: 31, acts: 0 } })
    const stygian = (await roundTrip({ ...base, gi_endgame: { stygian: endgame.stygian } })).decoded
    expect(stygian.gi_endgame).toEqual({ stygian: endgame.stygian })
  })

  it('hashes as before for the trackers that did not keep it', async () => {
    const catalog = new Catalog()
    const before = await roundTrip(withExtras, catalog)
    const after = await roundTrip(input, catalog)
    expect(after.encoded.contentHash).not.toBe(before.encoded.contentHash)
    expect(after.encoded.pre20ContentHash).toBe(before.encoded.contentHash)
    expect(after.encoded.pre19ContentHash).toBe(before.encoded.pre19ContentHash)
    expect(after.encoded.pre18ContentHash).toBe(before.encoded.pre18ContentHash)
    expect(after.encoded.pre17ContentHash).toBe(before.encoded.pre17ContentHash)
    expect(before.encoded.pre20ContentHash).toBe(before.encoded.contentHash)
    // Alone, the endgame makes an extras section those trackers never had.
    const plain = await roundTrip(base, catalog)
    const alone = await roundTrip({ ...base, gi_endgame: endgame }, catalog)
    expect(alone.encoded.pre20ContentHash).toBe(plain.encoded.contentHash)
    expect(alone.encoded.pre19ContentHash).toBe(plain.encoded.contentHash)
    expect(alone.encoded.pre18ContentHash).toBe(plain.encoded.contentHash)
  })

  it('drops a bad part and keeps the rest', () => {
    const read = (patch: object) =>
      normalizeGood({ ...input, gi_endgame: { ...endgame, ...patch } })
    const record = endgame.stygian.records[0]!
    expect(read({ theater: { season: 0, acts: 1 } }).endgame).toEqual({ stygian: endgame.stygian })
    expect(read({ theater: { season: 31, acts: 13 } }).endgame).toEqual({
      stygian: endgame.stygian,
    })
    expect(
      read({ theater: { season: 31, difficulty: 201, acts: 1 } }).endgame!.theater,
    ).toBeUndefined()
    expect(read({ stygian: { records: [{ ...record, difficulty: 201 }] } }).endgame).toEqual({
      theater: endgame.theater,
    })
    expect(
      read({ stygian: { records: [{ ...record, coop: 1 }] } }).endgame!.stygian,
    ).toBeUndefined()
    const fight = record.fights[0]!
    const fights = (f: object) =>
      read({ stygian: { records: [{ ...record, fights: [{ ...fight, ...f }] }] } })
    expect(fights({ team: ['Furina', 'Bad Key'] }).endgame!.stygian).toBeUndefined()
    expect(fights({ team: ['A', 'B', 'C', 'D', 'E'] }).endgame!.stygian).toBeUndefined()
    expect(fights({ time: -1 }).endgame!.stygian).toBeUndefined()
    expect(fights({ time: 0, done: false, team: [] }).endgame!.stygian!.records[0]!.fights).toEqual(
      [{ time: 0, done: false, team: [] }],
    )
    const many = { records: Array.from({ length: 201 }, () => record) }
    expect(read({ stygian: many }).endgame!.stygian).toBeUndefined()
    expect(
      read({ stygian: { records: Array(7).fill(record) } }).endgame!.stygian!.records,
    ).toHaveLength(7)
    expect(normalizeGood({ ...input, gi_endgame: {} }).endgame).toBeNull()
    expect(normalizeGood({ ...input, gi_endgame: 5 }).endgame).toBeNull()
  })

  it('stores it in the extras binary layout, small; a team key the dictionary lacks is spelled out', () => {
    const good = normalizeGood({
      ...input,
      gi_endgame: {
        ...endgame,
        stygian: {
          records: [
            ...endgame.stygian.records,
            {
              season: 5_269_014,
              difficulty: 6,
              at: 1_790_972_494,
              coop: false,
              fights: [{ time: 51, done: true, team: ['Alhaitham', 'Newcomer7'] }],
            },
          ],
        },
      },
    })
    const value = JSON.parse(
      JSON.stringify(
        encodeExtras({ teapot: good.teapot!, miliastra: good.miliastra!, endgame: good.endgame! }),
      ),
    )
    expect(value.e.s.at(-1)[4][0][2]).toEqual([expect.any(Number), 'Newcomer7'])
    const blob = encodeSectionBlob('extras', value, false, null)
    expect(blob.payload[0]).toBe(0x10)
    const back = decodeSectionBlob(kindCode('extras', false), blob.data, null, null)
    expect(JSON.stringify(back.value)).toBe(JSON.stringify(value))
    const alone = encodeSectionBlob('extras', { e: value.e }, false, null)
    // ~25 records × 3 fights × a team: well under a kilobyte.
    expect(alone.data.length).toBeLessThan(1_000)
  })
})
