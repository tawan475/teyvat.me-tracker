import { describe, expect, it } from 'vitest'
import { loadAchievements, type Achievement, type AchievementTexts } from '@gdt/game-data'
import {
  DEFAULT_ACHIEVEMENT_FILTERS,
  NO_ACHIEVEMENT_FILTERS,
  achievementVersions,
  captureAchievements,
  compareVersions,
  completedOn,
  countAchievements,
  doneSource,
  entryCompletedOn,
  filterAchievements,
  groupAchievements,
  hasAchievementFilters,
  idsToMark,
  idsToUnmark,
  markThrough,
  parseAchievementImport,
  planAchievementImport,
  restoreFilters,
  stardbAchievementUrl,
  storedFilters,
  summarizeAchievements,
  tiersDone,
  unmarkFrom,
  type AchievementFilters,
  type DoneState,
  withLiveAchievements,
} from '../achievement-progress'

// A made-up game: two categories (goal 2 comes first in game order).
function achievement(
  id: number,
  goal: number,
  order: number,
  extra: Partial<Achievement> = {},
): Achievement {
  return {
    id,
    goal,
    order,
    hidden: false,
    prevStage: 0,
    primogems: 5,
    progress: 1,
    version: '1.0',
    disused: false,
    ...extra,
  }
}

const achievements = [
  achievement(10, 1, 1),
  // A three-tier chain, listed out of order.
  achievement(13, 1, 4, { prevStage: 12, primogems: 20 }),
  achievement(11, 1, 2),
  achievement(12, 1, 3, { prevStage: 11, primogems: 10 }),
  achievement(20, 2, 1, { hidden: true, version: '4.2' }),
  achievement(21, 2, 2, { version: '4.10', primogems: 10 }),
  // Removed from the game, and a tier that hangs off it.
  achievement(30, 1, 5, { disused: true, version: '' }),
  achievement(31, 1, 6, { prevStage: 30 }),
]
const goals = [
  { id: 1, order: 2, icon: 'UI_AchievementIcon_A' },
  { id: 2, order: 1, icon: 'UI_AchievementIcon_B' },
]
const data = {
  achievements,
  byId: new Map(achievements.map((a) => [a.id, a])),
  goals,
  goalById: new Map(goals.map((g) => [g.id, g])),
}
const text: AchievementTexts = {
  achievements: new Map([
    [10, { title: 'Wind Rider', description: 'Glide for a while.' }],
    [11, { title: 'Survival Expert', description: 'Cook 10 dishes.' }],
    [12, { title: 'Survival Expert', description: 'Cook 20 dishes.' }],
    [13, { title: 'Survival Expert', description: 'Cook 40 dishes.' }],
    [20, { title: 'Secret', description: 'Find the hidden cat.' }],
    [21, { title: 'Snowfall', description: 'Climb Dragonspine.' }],
  ]),
  goals: new Map([
    [1, 'Wonders of the World'],
    [2, 'Mondstadt'],
  ]),
}
const entries = groupAchievements(data)
const entry = (id: number) => entries.find((e) => e.id === id)!

function state(captured: number[] = [], marked: number[] = []): DoneState {
  return { captured: new Set(captured), marked: new Set(marked) }
}
const filters = (patch: Partial<AchievementFilters>): AchievementFilters => ({
  ...NO_ACHIEVEMENT_FILTERS,
  ...patch,
})
const ids = (list: { id: number }[]) => list.map((e) => e.id)

describe('captureAchievements', () => {
  const lists: Record<string, number[]> = { a: [10, 11], b: [10, 11, 20], c: [11, 20, 21], e: [] }
  const decoded: string[] = []
  const decode = (key: string) => {
    decoded.push(key)
    return lists[key]!
  }

  it('takes the newest list and the first snapshot each id appears in', () => {
    decoded.length = 0
    const captured = captureAchievements(
      [
        // Newest first, like the app's snapshot list; walked oldest first.
        { takenAt: 600, key: null },
        { takenAt: 500, key: 'e' },
        { takenAt: 400, key: 'c' },
        { takenAt: 300, key: 'a' },
        { takenAt: 200, key: 'b' },
        { takenAt: 100, key: 'a' },
      ],
      decode,
    )
    expect([...captured.ids].sort()).toEqual([11, 20, 21])
    expect(captured.takenAt).toBe(400)
    expect(captured.firstTakenAt).toBe(100)
    expect(Object.fromEntries(captured.firstSeen)).toEqual({ 10: 100, 11: 100, 20: 200, 21: 400 })
    // The capture before the first with each id lacked it; the repeat of
    // list a at 300 counts as a capture, the empty list at 500 doesn't.
    expect(Object.fromEntries(captured.lastMissing)).toEqual({ 20: 100, 21: 300 })
    // Each distinct section is decoded once.
    expect(decoded.sort()).toEqual(['a', 'b', 'c', 'e'])
  })

  it('reports nothing when no snapshot has achievements', () => {
    const captured = captureAchievements(
      [
        { takenAt: 1, key: null },
        { takenAt: 2, key: 'e' },
      ],
      decode,
    )
    expect(captured.ids.size).toBe(0)
    expect(captured.takenAt).toBeNull()
    expect(captured.firstTakenAt).toBeNull()
    expect(captured.lastMissing.size).toBe(0)
    expect(captured.completedAt.size).toBe(0)
  })

  it("takes each id's finish time from the newest snapshot that has one", () => {
    const times: Record<string, [number, number][]> = {
      old: [
        [10, 1_600_200_000],
        [11, 1_600_300_000],
      ],
      // A later capture with a corrected time for 11 and a new one for 20.
      new: [
        [11, 1_600_400_000],
        [20, 1_650_000_000],
      ],
    }
    const decodedTimes: string[] = []
    const captured = captureAchievements(
      [
        { takenAt: 100, key: 'a', timesKey: 'old' },
        { takenAt: 200, key: 'b', timesKey: 'new' },
        { takenAt: 300, key: 'b', timesKey: null },
        { takenAt: 50, key: 'a', timesKey: 'old' },
        { takenAt: 400, key: 'c' },
      ],
      decode,
      (key) => {
        decodedTimes.push(key)
        return times[key]!
      },
    )
    expect(Object.fromEntries(captured.completedAt)).toEqual({
      10: 1_600_200_000_000,
      11: 1_600_400_000_000,
      20: 1_650_000_000_000,
    })
    expect(decodedTimes.sort()).toEqual(['new', 'old'])
  })
})

describe('completedOn', () => {
  const captured = {
    firstTakenAt: 100,
    firstSeen: new Map([
      [10, 100],
      [11, 100],
      [20, 200],
    ]),
    lastMissing: new Map([[20, 150]]),
    completedAt: new Map([[11, 1_600_400_000_000]]),
  }

  it('prefers the real finish time, then the captures around the first that had the id', () => {
    expect(completedOn(captured, 11)).toEqual({ at: 1_600_400_000_000, kind: 'exact' })
    // Already done when achievements were first captured: only "by then".
    expect(completedOn(captured, 10)).toEqual({ at: 100, kind: 'by' })
    // Done after the capture at 150, which lacked it, and by the one at 200.
    expect(completedOn(captured, 20)).toEqual({ at: 200, kind: 'seen', since: 150 })
    expect(completedOn(captured, 99)).toBeNull()
  })

  it('knows a finish time even for an id no list has yet', () => {
    expect(completedOn({ ...captured, completedAt: new Map([[99, 5]]) }, 99)).toEqual({
      at: 5,
      kind: 'exact',
    })
  })
})

describe('groupAchievements', () => {
  it('groups stage chains into one entry and keeps game order', () => {
    expect(entries.map((e) => [e.id, e.tiers.map((t) => t.id)])).toEqual([
      [20, [20]],
      [21, [21]],
      [10, [10]],
      [11, [11, 12, 13]],
      // Its previous tier is disused, so it stands alone.
      [31, [31]],
    ])
    expect(entry(11).primogems).toBe(35)
  })

  it('leaves disused achievements out', () => {
    expect(entries.flatMap((e) => e.tiers).some((t) => t.disused)).toBe(false)
  })

  it('sorts versions numerically', () => {
    expect(compareVersions('4.10', '4.9')).toBeGreaterThan(0)
    expect(compareVersions('', '1.0')).toBeLessThan(0)
    expect(achievementVersions(entries)).toEqual(['4.10', '4.2', '1.0'])
  })
})

describe('entryCompletedOn', () => {
  const captured = {
    firstTakenAt: 100,
    firstSeen: new Map([
      [10, 100],
      [11, 100],
      [12, 200],
    ]),
    lastMissing: new Map([[12, 100]]),
    completedAt: new Map([[11, 1_600_400_000_000]]),
  }

  it("shows a single achievement's date only when it is done", () => {
    expect(entryCompletedOn(entry(10), state([10]), captured)).toEqual({
      at: 100,
      kind: 'by',
      tier: 0,
    })
    // Seen in an old snapshot but not done now (or never captured): no date.
    expect(entryCompletedOn(entry(10), state([]), captured)).toBeNull()
    expect(entryCompletedOn(entry(20), state([20]), captured)).toBeNull()
  })

  it("shows a chain's highest done tier", () => {
    expect(entryCompletedOn(entry(11), state([11]), captured)).toEqual({
      at: 1_600_400_000_000,
      kind: 'exact',
      tier: 0,
    })
    expect(entryCompletedOn(entry(11), state([11, 12]), captured)).toEqual({
      at: 200,
      kind: 'seen',
      since: 100,
      tier: 1,
    })
  })

  it('says so when the highest done tier was only marked by hand', () => {
    expect(entryCompletedOn(entry(11), state([11, 12], [13]), captured)).toEqual({
      kind: 'marked',
      tier: 2,
    })
    expect(entryCompletedOn(entry(20), state([], [20]), captured)).toEqual({
      kind: 'marked',
      tier: 0,
    })
    // Marked by hand, but a capture has its finish time: the date still shows.
    const timed = { ...captured, completedAt: new Map([[13, 5_000]]) }
    expect(entryCompletedOn(entry(11), state([11, 12], [13]), timed)).toEqual({
      at: 5_000,
      kind: 'exact',
      tier: 2,
    })
  })
})

describe('done state and counts', () => {
  it('prefers captured over marked', () => {
    const s = state([10], [10, 11])
    expect(doneSource(s, 10)).toBe('captured')
    expect(doneSource(s, 11)).toBe('marked')
    expect(doneSource(s, 12)).toBeNull()
    expect(tiersDone(entry(11), s)).toBe(1)
  })

  it('counts tiers and primogems per category, skips disused and keeps unknown ids', () => {
    const summary = summarizeAchievements(
      entries,
      state([10, 11, 20, 30, 99001], [12, 21, 99002]),
      data.byId,
    )
    expect(summary).toMatchObject({
      done: 5,
      total: 7,
      primogems: 5 + 5 + 10 + 5 + 10,
      primogemsTotal: 5 + 5 + 10 + 20 + 5 + 5 + 10,
      captured: 3,
      marked: 2,
      unknown: [99001, 99002],
    })
    expect(summary.byGoal.get(1)).toEqual({
      done: 3,
      total: 5,
      primogems: 20,
      primogemsTotal: 45,
    })
    expect(summary.byGoal.get(2)).toEqual({ done: 2, total: 2, primogems: 15, primogemsTotal: 15 })
  })
})

describe('filters', () => {
  const s = state([10, 11], [12, 20])

  it('filters by completion across all tiers of a chain', () => {
    expect(ids(filterAchievements(entries, filters({ completion: 'done' }), s))).toEqual([20, 10])
    expect(ids(filterAchievements(entries, filters({ completion: 'missing' }), s))).toEqual([
      21, 11, 31,
    ])
  })

  it('filters by category, version and hidden', () => {
    expect(ids(filterAchievements(entries, filters({ goal: 2 }), s))).toEqual([20, 21])
    expect(ids(filterAchievements(entries, filters({ version: '4.10' }), s))).toEqual([21])
    expect(ids(filterAchievements(entries, filters({ hidden: 'hidden' }), s))).toEqual([20])
    expect(ids(filterAchievements(entries, filters({ hidden: 'visible' }), s))).not.toContain(20)
  })

  it('searches titles, descriptions, category names and ids', () => {
    const search = (query: string) => ids(filterAchievements(entries, filters({ query }), s, text))
    expect(search('  survival  ')).toEqual([11])
    expect(search('40 dishes')).toEqual([11])
    expect(search('COOK expert')).toEqual([11])
    expect(search('mondstadt')).toEqual([20, 21])
    expect(search('13')).toEqual([11])
    expect(search('nothing like this')).toEqual([])
    expect(ids(filterAchievements(entries, filters({ query: 'cat' }), s))).toEqual([])
  })

  it('counts tiers the way the totals do', () => {
    expect(countAchievements(entries, 'all', s)).toBe(7)
    expect(countAchievements(entries, 'done', s)).toBe(4)
    expect(countAchievements(entries, 'missing', s)).toBe(3)
  })

  it('restores stored filters, dropping anything malformed or unknown', () => {
    const stored = storedFilters(filters({ goal: 2, version: '4.10', query: 'cook' }))
    expect(stored).toEqual({ completion: 'all', goal: 2, version: '4.10', hidden: 'all' })
    expect(restoreFilters(JSON.parse(JSON.stringify(stored)))).toEqual({
      ...stored,
      query: '',
    })
    expect(restoreFilters(null)).toEqual(DEFAULT_ACHIEVEMENT_FILTERS)
    expect(restoreFilters([1])).toEqual(DEFAULT_ACHIEVEMENT_FILTERS)
    expect(restoreFilters({ completion: 'odd', goal: '2', version: 4, hidden: 'hidden' })).toEqual({
      ...DEFAULT_ACHIEVEMENT_FILTERS,
      hidden: 'hidden',
    })
    const known = { goals: new Set([1]), versions: new Set(['4.0']) }
    expect(restoreFilters(stored, known)).toEqual({
      ...stored,
      goal: null,
      version: null,
      query: '',
    })
  })

  it('knows when filters are on, "Missing" being the default', () => {
    expect(DEFAULT_ACHIEVEMENT_FILTERS).toEqual({
      ...NO_ACHIEVEMENT_FILTERS,
      completion: 'missing',
    })
    expect(hasAchievementFilters({ ...DEFAULT_ACHIEVEMENT_FILTERS })).toBe(false)
    expect(hasAchievementFilters({ ...DEFAULT_ACHIEVEMENT_FILTERS, query: ' ' })).toBe(false)
    expect(hasAchievementFilters({ ...DEFAULT_ACHIEVEMENT_FILTERS, goal: 0 })).toBe(true)
    expect(hasAchievementFilters(filters({}))).toBe(true)
    expect(hasAchievementFilters(filters({ completion: 'done' }))).toBe(true)
    // Against other defaults.
    expect(hasAchievementFilters(NO_ACHIEVEMENT_FILTERS, NO_ACHIEVEMENT_FILTERS)).toBe(false)
    expect(hasAchievementFilters(filters({ goal: 0 }), NO_ACHIEVEMENT_FILTERS)).toBe(true)
  })
})

describe('marking', () => {
  const s = state([11], [20])

  it('bulk marks what is not done and unmarks only hand marks', () => {
    expect(idsToMark(entries, s)).toEqual([21, 10, 12, 13, 31])
    expect(idsToUnmark(entries, state([11, 20], [20, 12]))).toEqual([12])
  })

  it('marks lower tiers with a higher one and unmarks higher ones with a lower one', () => {
    const chain = entry(11)
    expect(markThrough(chain, 2, s)).toEqual([12, 13])
    expect(markThrough(chain, 0, s)).toEqual([])
    expect(unmarkFrom(chain, 0, state([11], [12, 13]))).toEqual([12, 13])
    expect(unmarkFrom(chain, 2, state([11], [12, 13]))).toEqual([13])
  })
})

describe('imports', () => {
  it('reads a Seelie export', () => {
    expect(
      parseAchievementImport({
        goals: [],
        achievements: { '13': { done: true }, '10': { done: true }, '11': { done: false } },
      }),
    ).toEqual({ format: 'seelie', ids: [10, 13] })
  })

  it('reads GOOD files from irminsul or stardb, and bare lists', () => {
    expect(parseAchievementImport({ gi_achievements: [12, 10, 12, 'x', -1] })).toEqual({
      format: 'good',
      ids: [10, 12],
    })
    expect(parseAchievementImport({ format: 'GOOD', achievements: [20] })).toEqual({
      format: 'good',
      ids: [20],
    })
    expect(parseAchievementImport([21, 20])).toEqual({ format: 'list', ids: [20, 21] })
  })

  it('reads a paimon.moe backup, account by account', () => {
    const backup = {
      accounts: 'account2',
      achievement: { '0': { '10': true, '11': false }, '17': { '13': true } },
      'wish-uid': '812345678',
      ar: 60,
      'account2-achievement': { '0': { '20': true } },
      'account2-wish-uid': '812345679',
      'account3-todos': [],
    }
    const parsed = parseAchievementImport(backup)
    expect(parsed?.format).toBe('paimon')
    expect(parsed?.ids).toEqual([10, 13])
    expect(parsed?.accounts?.map((a) => [a.prefix, a.uid, a.ids])).toEqual([
      ['', '812345678', [10, 13]],
      ['account2-', '812345679', [20]],
    ])
    // A backup with no achievements (or only another tracker's keys) is none.
    expect(parseAchievementImport({ todos: [], ar: 55 })).toBeNull()
  })

  it('rejects anything else', () => {
    for (const json of [null, 5, 'x', [], ['a'], { characters: [] }, { achievements: [1] }])
      expect(parseAchievementImport(json)).toBeNull()
  })

  it('plans only what is not done yet, keeping unknown and disused ids', () => {
    expect(
      planAchievementImport([10, 11, 12, 30, 99001, 12], state([10], [11]), data.byId),
    ).toEqual({ add: [12, 30, 99001], already: 2, unknown: 1, disused: 1 })
  })
})

describe('real data', () => {
  it('groups every active achievement exactly once', async () => {
    const real = await loadAchievements()
    const grouped = groupAchievements(real)
    const tiers = grouped.flatMap((e) => e.tiers.map((t) => t.id))
    expect(new Set(tiers).size).toBe(tiers.length)
    expect(tiers.length).toBe(real.achievements.filter((a) => !a.disused).length)
    expect(grouped.some((e) => e.tiers.length === 3)).toBe(true)
    const summary = summarizeAchievements(grouped, state(), real.byId)
    expect(summary.primogemsTotal).toBe(
      real.achievements.filter((a) => !a.disused).reduce((sum, a) => sum + a.primogems, 0),
    )
  })

  it('links to stardb', () => {
    expect(stardbAchievementUrl(80001)).toBe(
      'https://stardb.gg/en/genshin/database/achievements/80001',
    )
  })
})

describe('withLiveAchievements', () => {
  const captured = {
    ids: new Set([84001]),
    takenAt: 1_000,
    firstTakenAt: 500,
    firstSeen: new Map([[84001, 500]]),
    lastMissing: new Map<number, number>(),
    completedAt: new Map<number, number>(),
    progress: new Map([[84002, { progress: 3, total: 4 }]]),
  }
  const journal = (changes: unknown[], snapshotId = 7) =>
    ({
      open: true,
      base: { snapshotId, contentKey: 'k', takenAt: 1_000 },
      updatedAt: 2_000,
      changes,
    }) as never

  it('finishes what the journal finished since the newest snapshot', () => {
    const now = withLiveAchievements(
      captured,
      journal([['set', ['achievements', 84002], 1_794_100_000]]),
      7,
    )
    expect(now.ids.has(84002)).toBe(true)
    expect(now.completedAt.get(84002)).toBe(1_794_100_000_000)
    expect(now.firstSeen.get(84002)).toBe(2_000)
    expect(now.lastMissing.get(84002)).toBe(1_000)
    expect(now.progress?.has(84002)).toBe(false)
    // An unknown finish time still counts as done.
    expect(
      withLiveAchievements(captured, journal([['set', ['achievements', 84003], 0]]), 7).ids.has(
        84003,
      ),
    ).toBe(true)
  })

  it('undoes on del and ignores a journal of another snapshot or none', () => {
    expect(
      withLiveAchievements(captured, journal([['del', ['achievements', 84001]]]), 7).ids.has(84001),
    ).toBe(false)
    const other = journal([['set', ['achievements', 84002], 1]], 6)
    expect(withLiveAchievements(captured, other, 7)).toBe(captured)
    expect(withLiveAchievements(captured, null, 7)).toBe(captured)
    expect(withLiveAchievements(captured, journal([['set', ['materials', 'Mora'], 5]]), 7)).toBe(
      captured,
    )
  })
})
