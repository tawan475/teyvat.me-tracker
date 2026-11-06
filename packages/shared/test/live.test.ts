import { describe, expect, it } from 'vitest'
import {
  addPoint,
  applyDelta,
  applyFigures,
  bindItemGuids,
  canonicalLiveGood,
  decodeChanges,
  decodeFigures,
  decodeItemIndex,
  decodePoints,
  distinctPaths,
  encodeChanges,
  encodeFigures,
  encodeItemIndex,
  encodePoints,
  goodDeltaSchema,
  itemFingerprint,
  itemIndexOf,
  mergeChanges,
  pointDay,
  readCapture,
  touchedBaseItems,
  type DeltaChange,
  type Figures,
  type LiveGood,
} from '../src'
import fixture from './fixtures/good-x-delta.json'

const base = fixture.base as unknown as LiveGood
const result = fixture.result as unknown as LiveGood
const changes = fixture.delta.changes as unknown as DeltaChange[]

const FIGURES: Figures = {
  characters: 2,
  weapons: 2,
  artifacts: 2,
  materials: 4,
  mora: 100,
  primogem: 10,
  artifact3: 0,
  artifact4: 1,
}

describe('GOOD-X delta contract', () => {
  it('the fixture is a valid batch', () => {
    const parsed = goodDeltaSchema.parse(fixture.delta)
    expect(parsed.changes).toHaveLength(changes.length)
    expect(parsed.sum?.mora).toBe(48211930)
  })

  it('applying the fixture to its base gives its result', () => {
    const applied = applyDelta(base, changes)
    expect(canonicalLiveGood({ ...applied, timestamp: 0 })).toEqual(
      canonicalLiveGood({ ...result, timestamp: 0 }),
    )
  })

  it('leaves its input alone', () => {
    const before = JSON.stringify(base)
    applyDelta(base, changes)
    expect(JSON.stringify(base)).toBe(before)
  })

  it('applying twice is the same as once (absolute values)', () => {
    const once = applyDelta(base, changes)
    expect(canonicalLiveGood(applyDelta(once, changes))).toEqual(canonicalLiveGood(once))
  })

  it('refuses malformed batches', () => {
    const bad = (patch: object) => goodDeltaSchema.safeParse({ ...fixture.delta, ...patch }).success
    expect(bad({})).toBe(true)
    expect(bad({ format: 'GOOD' })).toBe(false)
    expect(bad({ seq: 0 })).toBe(false)
    expect(bad({ session: 'short' })).toBe(false)
    expect(bad({ changes: [['put', ['materials', 'Mora'], 1]] })).toBe(false)
    expect(bad({ changes: [['set', [], 1]] })).toBe(false)
    // Material keys can be long (the game data has 90-character ones).
    expect(bad({ changes: [['set', ['materials', 'x'.repeat(120)], 1]] })).toBe(true)
    expect(bad({ changes: [['set', ['materials', 'x'.repeat(257)], 1]] })).toBe(false)
    expect(bad({ changes: [['add', ['artifacts', '1'], 5]] })).toBe(false)
    expect(bad({ changes: Array.from({ length: 2001 }, () => ['del', ['materials', 'x']]) })).toBe(
      false,
    )
    expect(bad({ sum: { mora: -1 } })).toBe(false)
  })

  it('skips unknown paths and changes to items it does not hold', () => {
    const applied = applyDelta(base, [
      ['set', ['furniture', '1'], 3],
      ['set', ['artifacts', '999', 'level'], 20],
      ['set', ['characters', 'Nobody', 'level'], 90],
      ['set', ['characters', 'Furina', 'friendship'], 10],
      ['set', ['materials', 'Mora'], 'lots'],
      ['del', ['weapons', '999']],
    ])
    expect(canonicalLiveGood(applied)).toEqual(canonicalLiveGood(base))
  })

  it("reads an artifact sent as elixerCrafted (Capture before 1.17.18) as GOOD's elixirCrafted", () => {
    const piece = { ...base.artifacts[0]!, gi_guid: undefined }
    const { elixirCrafted: _, ...old } = { ...piece, elixerCrafted: true } as Record<
      string,
      unknown
    >
    const added = applyDelta(base, [['add', ['artifacts', '424242'], old]])
    const item = added.artifacts.find((a) => a.gi_guid === '424242')! as Record<string, unknown>
    expect(item.elixirCrafted).toBe(true)
    expect(item).not.toHaveProperty('elixerCrafted')
    const set = applyDelta(added, [['set', ['artifacts', '424242', 'elixerCrafted'], false]])
    const after = set.artifacts.find((a) => a.gi_guid === '424242')! as Record<string, unknown>
    expect(after.elixirCrafted).toBe(false)
    expect(after).not.toHaveProperty('elixerCrafted')
  })

  it('creates sections only when something goes in them', () => {
    const bare: LiveGood = {
      format: 'GOOD',
      version: 2,
      source: 'Irminsul',
      characters: [],
      artifacts: [],
      weapons: [],
      materials: {},
    }
    const applied = applyDelta(bare, [
      ['del', ['achievements', '81000']],
      ['del', ['gi_characters', 'Furina']],
      ['del', ['anecdotes', '100001']],
      ['del', ['gi_anecdotes', 'reward']],
      ['del', ['gi_player', 'resin']],
      ['del', ['gi_tasks', 'resin']],
    ])
    expect(applied).toEqual(bare)
    const filled = applyDelta(bare, [
      ['set', ['achievements', '81000'], 0],
      ['set', ['anecdotes', '100001'], { state: 3, finishCount: 1 }],
    ])
    expect(filled.gi_achievements).toEqual([81000])
    expect(filled.gi_achievement_times).toBeUndefined()
    expect(filled.gi_anecdotes).toEqual({
      anecdotes: { '100001': { state: 3, finishCount: 1 } },
      unlockedAreas: [],
    })
  })

  it("sets Capture 1.14's profile fields, whole or one id at a time", () => {
    const applied = applyDelta(base, [
      ['set', ['gi_player', 'nickname'], 'player01'],
      ['set', ['gi_player', 'signature'], ''],
      ['set', ['gi_player', 'profilePicture'], { id: 1001, frameId: 100016 }],
      ['set', ['gi_player', 'profilePicture', 'frameId'], 100017],
      ['set', ['gi_player', 'birthday', 'month'], 3],
      ['set', ['gi_player', 'resin'], 'not a number'],
      ['set', ['gi_player', 'ar', 'x'], 1],
    ])
    expect(applied.gi_player).toMatchObject({
      nickname: 'player01',
      signature: '',
      profilePicture: { id: 1001, frameId: 100017 },
      birthday: { month: 3 },
    })
    expect(applied.gi_player!.resin).toBe(base.gi_player?.resin)
  })

  it('sets each part of gi_tasks whole, checked as a snapshot would be (Capture 1.16.0)', () => {
    // Capture 1.17.2: Paimon's Bargains, as opening the shop showed it.
    const BARGAINS = {
      at: 1_791_756_000,
      bought: true,
      fates: [
        { item: 'IntertwinedFate', currency: 'MasterlessStardust', cost: 75, bought: 2, limit: 5 },
      ],
    }
    const withTasks: LiveGood = {
      ...base,
      gi_tasks: { welkin: { days: 3 }, resin: { value: 20, nextAt: 1_791_756_000 } },
    }
    const applied = applyDelta(withTasks, [
      ['set', ['gi_tasks', 'resin'], { value: 21, nextAt: 1_791_756_416 }],
      ['set', ['gi_tasks', 'welkin'], { days: 99 }],
      ['set', ['gi_tasks', 'commissions'], { finished: 4, total: 4, claimed: true }],
      ['set', ['gi_tasks', 'resinSpent'], { value: 160, day: 3, at: 1_791_756_000 }],
      ['set', ['gi_tasks', 'bargains'], BARGAINS],
      ['set', ['gi_tasks', 'resin', 'value'], 5],
      ['set', ['gi_tasks', 'unknownPart'], { any: 1 }],
      ['set', ['gi_tasks', '__proto__'], { days: 1 }],
    ])
    expect(applied.gi_tasks).toEqual({
      welkin: { days: 99 },
      resin: { value: 21, nextAt: 1_791_756_416 },
      commissions: { finished: 4, total: 4, claimed: true },
      resinSpent: { value: 160, day: 3, at: 1_791_756_000 },
      bargains: BARGAINS,
    })
    expect(withTasks.gi_tasks!.resin).toEqual({ value: 20, nextAt: 1_791_756_000 })
    const bad = applyDelta(withTasks, [
      ['set', ['gi_tasks', 'resin'], { value: -1, nextAt: 5 }],
      ['set', ['gi_tasks', 'commissions'], { finished: 5, total: 4 }],
    ])
    expect(bad.gi_tasks).toEqual(withTasks.gi_tasks)
    expect(applyDelta(withTasks, [['del', ['gi_tasks', 'resin']]]).gi_tasks).toEqual({
      welkin: { days: 3 },
    })
    // A base without gi_tasks takes a part all the same.
    const bare: LiveGood = { ...base, gi_tasks: undefined }
    expect(
      applyDelta(bare, [['set', ['gi_tasks', 'realm'], { value: 300, limit: 2400 }]]).gi_tasks,
    ).toEqual({ realm: { value: 300, limit: 2400 } })
  })

  it('sets the saved teams whole and the team in use (Capture 1.17.1)', () => {
    const gliders = { owned: [140_001], worn: {} }
    const withTeams: LiveGood = {
      ...base,
      gi_wardrobe: {
        gliders,
        teams: { '1': { name: 'Vape', characters: ['HuTao'] } },
        currentTeam: 1,
      },
    }
    const teams = {
      '1': { name: 'Vape', characters: ['Xingqiu', 'HuTao'] },
      '5': { name: '', characters: ['Furina'] },
    }
    const applied = applyDelta(withTeams, [
      ['set', ['gi_wardrobe', 'teams'], teams],
      ['set', ['gi_wardrobe', 'currentTeam'], 5],
      ['set', ['gi_wardrobe', 'gliders'], { owned: [140_002], worn: {} }],
      ['set', ['gi_wardrobe', 'teams', '1'], { name: 'x', characters: [] }],
      ['set', ['gi_wardrobe', '__proto__'], 1],
    ])
    expect(applied.gi_wardrobe).toEqual({ gliders, teams, currentTeam: 5 })
    expect(withTeams.gi_wardrobe!.currentTeam).toBe(1)
    const bad = applyDelta(withTeams, [
      ['set', ['gi_wardrobe', 'teams'], { '1': { name: 'x', characters: ['not a key!'] } }],
      ['set', ['gi_wardrobe', 'currentTeam'], -1],
    ])
    expect(bad.gi_wardrobe).toEqual(withTeams.gi_wardrobe)
    expect(applyDelta(withTeams, [['del', ['gi_wardrobe', 'currentTeam']]]).gi_wardrobe).toEqual({
      gliders,
      teams: withTeams.gi_wardrobe!.teams,
    })
    // A base without gi_wardrobe takes the parts all the same.
    const bare: LiveGood = { ...base, gi_wardrobe: undefined }
    expect(applyDelta(bare, [['set', ['gi_wardrobe', 'currentTeam'], 2]]).gi_wardrobe).toEqual({
      currentTeam: 2,
    })
  })
})

describe('mergeChanges', () => {
  it('keeps the last value per path', () => {
    const merged = mergeChanges(
      [['set', ['materials', 'Mora'], 1]],
      [
        ['set', ['materials', 'Mora'], 2],
        ['set', ['materials', 'Mora'], 3],
      ],
    )
    expect(merged).toEqual([['set', ['materials', 'Mora'], 3]])
  })

  it('applying the merge equals applying both in order', () => {
    const cases: [DeltaChange[], DeltaChange[]][] = [
      [changes.slice(0, 10), changes.slice(5)],
      // A character set, deleted, then added again: the old set must not come back.
      [
        [
          [
            'add',
            ['characters', 'Nahida'],
            {
              key: 'Nahida',
              level: 1,
              constellation: 0,
              ascension: 0,
              talent: { auto: 1, skill: 1, burst: 1 },
            },
          ],
          ['set', ['characters', 'Nahida', 'level'], 20],
          ['del', ['characters', 'Nahida']],
        ],
        [
          [
            'add',
            ['characters', 'Nahida'],
            {
              key: 'Nahida',
              level: 1,
              constellation: 0,
              ascension: 0,
              talent: { auto: 1, skill: 1, burst: 1 },
            },
          ],
        ],
      ],
      // An item levelled, then deleted.
      [
        [['set', ['artifacts', '3488998120056947072', 'level'], 20]],
        [['del', ['artifacts', '3488998120056947072'], { rarity: 5 }]],
      ],
      // An item added, then levelled twice.
      [
        [
          [
            'add',
            ['weapons', '42'],
            { key: 'DullBlade', level: 1, ascension: 0, refinement: 1, location: '', lock: false },
          ],
        ],
        [
          ['set', ['weapons', '42', 'level'], 20],
          ['set', ['weapons', '42', 'level'], 40],
        ],
      ],
    ]
    for (const [a, b] of cases) {
      const merged = mergeChanges(a, b)
      expect(canonicalLiveGood(applyDelta(base, merged))).toEqual(
        canonicalLiveGood(applyDelta(applyDelta(base, a), b)),
      )
    }
  })

  it('counts distinct paths', () => {
    expect(distinctPaths(changes)).toBe(changes.length)
    expect(distinctPaths([...changes, ...changes])).toBe(changes.length)
  })
})

describe('storage formats', () => {
  it('round-trips a batch', () => {
    expect(decodeChanges(encodeChanges(changes))).toEqual(changes)
  })

  it('round-trips figures', () => {
    expect(decodeFigures(encodeFigures(FIGURES))).toEqual(FIGURES)
  })

  it('updates figures from changes, or takes irminsul’s sum', () => {
    expect(applyFigures(FIGURES, changes)).toEqual({
      ...FIGURES,
      mora: 48211930,
      characters: 3,
      artifacts: 2,
      weapons: 1,
    })
    expect(applyFigures(FIGURES, changes, fixture.delta.sum)).toEqual(fixture.delta.sum)
    expect(applyFigures(FIGURES, [['del', ['materials', 'Primogem']]]).primogem).toBe(0)
  })

  it('keeps one point per ten minutes', () => {
    const day = '2026-10-15'
    const t0 = Date.parse(`${day}T10:00:00Z`)
    let points = addPoint([], { at: t0, figures: FIGURES })
    points = addPoint(points, { at: t0 + 60_000, figures: { ...FIGURES, mora: 200 } })
    expect(points).toHaveLength(1)
    expect(points[0]!.figures.mora).toBe(200)
    points = addPoint(points, { at: t0 + 11 * 60_000, figures: { ...FIGURES, mora: 300 } })
    expect(points).toHaveLength(2)
    points = addPoint(points, { at: t0, figures: FIGURES })
    expect(points).toHaveLength(2)
    expect(pointDay(t0)).toBe(day)
    expect(decodePoints(day, encodePoints(day, points))).toEqual(points)
  })

  it('a day of points stays small', () => {
    const day = '2026-10-15'
    const t0 = Date.parse(`${day}T08:00:00Z`)
    const points = Array.from({ length: 42 }, (_, i) => ({
      at: t0 + i * 10 * 60_000,
      figures: { ...FIGURES, mora: 48_000_000 + i * 12_345, artifacts: 1800 + i },
    }))
    expect(encodePoints(day, points).length).toBeLessThan(800)
  })

  it('indexes items by guid and finds them again by fingerprint', () => {
    const index = itemIndexOf(base)
    expect(index.artifacts).toHaveLength(2)
    expect(index.weapons).toHaveLength(2)
    expect(decodeItemIndex(encodeItemIndex(index))).toEqual({
      artifacts: [...index.artifacts].sort((a, b) => (BigInt(a[0]) < BigInt(b[0]) ? -1 : 1)),
      weapons: [...index.weapons].sort((a, b) => (BigInt(a[0]) < BigInt(b[0]) ? -1 : 1)),
    })
    // A stored snapshot has no guids: bind the ones the journal touches, then apply.
    const stored: LiveGood = {
      ...base,
      artifacts: base.artifacts.map(({ gi_guid: _g, ...a }) => a),
      weapons: base.weapons.map(({ gi_guid: _g, ...w }) => w),
    }
    const binds = touchedBaseItems(changes).map(({ kind, guid }) => {
      const fp = index[kind].find(([g]) => g === guid)![1]
      return [kind, guid, fp] as const
    })
    expect(binds.map((b) => b[1]).sort()).toEqual([
      '3488998120056947072',
      '3488998120056947078',
      '3488998120056947188',
      '3488998120056947189',
    ])
    const now = applyDelta(bindItemGuids(stored, binds), changes)
    const strip = (good: LiveGood) =>
      canonicalLiveGood({
        ...good,
        timestamp: 0,
        artifacts: good.artifacts.map(({ gi_guid: _g, ...a }) => a),
        weapons: good.weapons.map(({ gi_guid: _g, ...w }) => w),
      })
    expect(strip(now)).toEqual(strip(result))
  })

  it('fingerprints tell items apart by what they show', () => {
    const [a, b] = base.artifacts
    expect(itemFingerprint('artifacts', a!)).not.toBe(itemFingerprint('artifacts', b!))
    expect(itemFingerprint('artifacts', { ...a!, gi_guid: 'x' })).toBe(
      itemFingerprint('artifacts', a!),
    )
    expect(itemFingerprint('artifacts', { ...a!, lock: true })).not.toBe(
      itemFingerprint('artifacts', a!),
    )
    expect(itemFingerprint('artifacts', a!)).toBeLessThan(2 ** 48)
  })

  it('a large item index stays compact', () => {
    const top = 812345678 * 2 ** 32
    const artifacts: [string, number][] = Array.from({ length: 2000 }, (_, i) => [
      (BigInt(top) + BigInt(1000 + i * 3)).toString(),
      (i * 7919) % 2 ** 48,
    ])
    const size = encodeItemIndex({ artifacts, weapons: [] }).length
    expect(size).toBeLessThan(2000 * 9)
  })
})

describe('gi_capture', () => {
  it('reads a valid capture and drops a bad one', () => {
    expect(
      readCapture({
        v: 1,
        reason: 'world',
        session: '01J9ZK5Q8W3E7R2T',
        world: 3,
        journal: { seq: 4 },
      }),
    ).toEqual({ v: 1, reason: 'world', session: '01J9ZK5Q8W3E7R2T', world: 3, journal: { seq: 4 } })
    expect(readCapture({ v: 1, reason: 'login', session: '01J9ZK5Q8W3E7R2T' })).toEqual({
      v: 1,
      reason: 'login',
      session: '01J9ZK5Q8W3E7R2T',
      world: 1,
      journal: { seq: 0 },
    })
    expect(readCapture({ v: 2, reason: 'login', session: '01J9ZK5Q8W3E7R2T' })).toBeNull()
    expect(readCapture({ v: 1, reason: 'nap', session: '01J9ZK5Q8W3E7R2T' })).toBeNull()
    expect(readCapture({ v: 1, reason: 'login', session: 'bad id!' })).toBeNull()
    expect(readCapture('login')).toBeNull()
  })
})

describe('snapshot meta with gi_capture', () => {
  it('stores the capture in format 2 and keeps format 1 without one', async () => {
    const { decodeSnapshotMeta, encodeSnapshotMeta } = await import('../src')
    const meta = {
      format: 'GOOD',
      version: 2,
      source: 'Irminsul',
      summary: FIGURES,
      playerVars: { resin: 160 },
    }
    const plain = encodeSnapshotMeta(meta)
    expect(plain[0]).toBe(1)
    const capture = {
      v: 1 as const,
      reason: 'world' as const,
      session: '01J9ZK5Q8W3E7R2T',
      world: 3,
      journal: { seq: 12 },
    }
    const withCapture = encodeSnapshotMeta({ ...meta, capture })
    expect(withCapture[0]).toBe(2)
    expect(decodeSnapshotMeta(withCapture)).toEqual({ ...meta, capture })
    expect(decodeSnapshotMeta(plain)).toEqual(meta)
  })
})
