import { describe, expect, it } from 'vitest'
import type { Achievement } from '@gdt/game-data'
import { UIAF_UNKNOWN_TIME, normalizeGood, parseUiaf, type LiveJournalResponse } from '@gdt/shared'
import {
  achievementExportFacts,
  achievementExportRows,
  buildAchievementLeyline,
  buildAchievementUiaf,
  type AchievementExportInput,
} from '../achievement-export'
import {
  captureAchievements,
  parseAchievementImport,
  withLiveAchievements,
  type CapturedAchievements,
} from '../achievement-progress'

// A made-up game: four achievements with goal totals, one disused.
function achievement(id: number, progress: number, extra: Partial<Achievement> = {}): Achievement {
  return {
    id,
    goal: 1,
    order: id,
    hidden: false,
    prevStage: 0,
    primogems: 5,
    progress,
    version: '1.0',
    disused: false,
    ...extra,
  }
}
const known = new Map(
  [
    achievement(80001, 1),
    achievement(80002, 40),
    achievement(80003, 10),
    achievement(80004, 5),
    achievement(80005, 3, { disused: true }),
  ].map((a) => [a.id, a]),
)

const T = 1_700_000_000 // unix seconds

function captured(
  ids: number[],
  times: Record<number, number> = {},
  progress: Record<number, { progress: number; total: number }> = {},
): CapturedAchievements {
  return {
    ids: new Set(ids),
    takenAt: T * 1000,
    firstTakenAt: T * 1000,
    firstSeen: new Map(ids.map((id) => [id, T * 1000])),
    lastMissing: new Map(),
    completedAt: new Map(Object.entries(times).map(([id, s]) => [Number(id), s * 1000])),
    progress: new Map(Object.entries(progress).map(([id, p]) => [Number(id), p])),
  }
}

const input = (c: CapturedAchievements, marked: number[] = []): AchievementExportInput => ({
  captured: c,
  marked: new Set(marked),
  known,
})

describe('achievementExportRows', () => {
  it('maps every state the plan lists', () => {
    const rows = achievementExportRows(
      input(
        captured(
          [80001, 80002, 80005],
          { 80001: T, 80005: T + 5 },
          { 80003: { progress: 7, total: 10 }, 80002: { progress: 40, total: 40 } },
        ),
        [80004, 80001, 99999],
      ),
    )
    expect(rows).toEqual([
      // captured, time known: the game's seconds unchanged, current = the total
      { id: 80001, status: 2, current: 1, timestamp: T },
      // captured, no time (its stale counter is ignored: done wins)
      { id: 80002, status: 2, current: 40, timestamp: UIAF_UNKNOWN_TIME },
      // unfinished with a counter
      { id: 80003, status: 1, current: 7, timestamp: 0 },
      // marked by hand only: no finish time
      { id: 80004, status: 2, current: 5, timestamp: UIAF_UNKNOWN_TIME },
      // disused: written as held
      { id: 80005, status: 2, current: 3, timestamp: T + 5 },
      // an id the data does not know: kept, total unknown
      { id: 99999, status: 2, current: 0, timestamp: UIAF_UNKNOWN_TIME },
    ])
    expect(rows.some((r) => (r.status as number) === 3)).toBe(false)
  })

  it('writes no time for a marked id even when an older capture timed it', () => {
    // The newest capture lacks 80001 (undone), an older one timed it.
    const c = captured([], { 80001: T })
    expect(achievementExportRows(input(c, [80001]))).toEqual([
      { id: 80001, status: 2, current: 1, timestamp: UIAF_UNKNOWN_TIME },
    ])
  })

  it('writes nothing for an account with nothing known', () => {
    expect(achievementExportRows(input(captured([])))).toEqual([])
  })

  it('follows the live journal the page lays over the captures', () => {
    const base = captured([80001, 80002], { 80001: T }, { 80003: { progress: 2, total: 10 } })
    const live = {
      open: true,
      base: { snapshotId: 7, takenAt: T * 1000 },
      updatedAt: (T + 60) * 1000,
      changes: [
        ['set', ['achievements', '80003'], T + 50],
        ['del', ['achievements', '80002']],
      ],
    } as unknown as LiveJournalResponse
    const rows = achievementExportRows(input(withLiveAchievements(base, live, 7)))
    expect(rows).toEqual([
      { id: 80001, status: 2, current: 1, timestamp: T },
      { id: 80003, status: 2, current: 10, timestamp: T + 50 },
    ])
  })

  it('a travelled account exports what its cut history holds', () => {
    // captureAchievements over the snapshots up to the one travelled to
    // (the loaders cut the bundle there): the later finish is not in it.
    const sections = [
      { takenAt: 1000, key: 'a' },
      { takenAt: 2000, key: 'b' },
    ]
    const lists: Record<string, number[]> = { a: [80001], b: [80001, 80002] }
    const cut = captureAchievements(sections.slice(0, 1), (key) => lists[key]!)
    expect(achievementExportRows(input(cut)).map((r) => r.id)).toEqual([80001])
    const now = captureAchievements(sections, (key) => lists[key]!)
    expect(achievementExportRows(input(now)).map((r) => r.id)).toEqual([80001, 80002])
  })
})

describe('achievementExportFacts', () => {
  it('counts what the file cannot say', () => {
    const facts = achievementExportFacts(
      input(captured([80001, 80002], { 80001: T }, { 80003: { progress: 1, total: 10 } }), [80004]),
    )
    expect(facts).toEqual({ done: 3, timed: 1, capturedUntimed: 1, markedOnly: 1, unfinished: 1 })
  })
})

describe('buildAchievementUiaf', () => {
  it('writes UIAF v1.1 that reads back and imports as the done ids', () => {
    const data = input(
      captured([80001], { 80001: T }, { 80003: { progress: 4, total: 10 } }),
      [80004],
    )
    const file = buildAchievementUiaf(data, { version: '1.19.2', now: 1_700_000_500_000 })
    expect(file.info).toEqual({
      export_app: 'Teyvat.me',
      export_app_version: '1.19.2',
      uiaf_version: 'v1.1',
      export_timestamp: 1_700_000_500,
    })
    const text = JSON.stringify(file)
    expect(parseUiaf(text).entries).toEqual(achievementExportRows(data))
    const back = parseAchievementImport(JSON.parse(text))
    expect(back?.format).toBe('uiaf')
    expect(back?.ids).toEqual([80001, 80004])
    expect(back?.uiaf?.unfinished).toBe(1)
  })
})

describe('buildAchievementLeyline', () => {
  const data = input(
    captured([80001, 80002], { 80001: T }, { 80003: { progress: 4, total: 10 } }),
    [80004],
  )
  const file = buildAchievementLeyline(data, { version: '1.19.2', now: 1_700_000_500_000 })

  it('holds the done ids (marks too), the game times and the counters', () => {
    expect(file).toMatchObject({
      format: 'GOOD',
      version: 3,
      source: 'Teyvat.me',
      leyline: 1,
      gi_achievements: [80001, 80002, 80004],
      gi_achievement_times: { '80001': T },
      gi_achievement_progress: { '80003': { progress: 4, total: 10 } },
    })
    expect(Object.keys(file).slice(0, 4)).toEqual(['format', 'version', 'source', 'leyline'])
    expect(parseAchievementImport(file)).toEqual({
      format: 'good',
      ids: [80001, 80002, 80004],
    })
  })

  it('names every other part as not shared, so none reads as empty', () => {
    const good = normalizeGood(file)
    expect(good.off).toContain('characters')
    expect(good.off).toContain('materials')
    expect(good.off).not.toContain('gi_achievements')
    expect(good.achievements).toEqual([80001, 80002, 80004])
  })
})
