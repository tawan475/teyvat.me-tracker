import { describe, expect, it } from 'vitest'
import type { Achievement } from '@gdt/game-data'
import {
  UIAF_UNKNOWN_TIME,
  parsePaimonCsv,
  parseUiaf,
  parseWishFile,
  resolveWishItem,
  toPlainGood,
  type WishPull,
} from '@gdt/shared'
import { parseAchievementImport } from '../achievement-progress'
import {
  formatsFor,
  type AchievementFileInput,
  type SnapshotExportInput,
  type WishExportInput,
} from '../export-formats'

// Made-up data only (UID 812345678).
const UID = '812345678'
const NOW = Date.UTC(2026, 10, 26, 12, 0, 0)

describe('formatsFor', () => {
  it('lists each page its own formats, the default first', () => {
    expect(formatsFor('snapshots').map((f) => f.id)).toEqual(['leyline', 'good'])
    expect(formatsFor('wishes').map((f) => f.id)).toEqual(['uigf', 'paimon-csv'])
    expect(formatsFor('achievements').map((f) => f.id)).toEqual(['uiaf', 'leyline'])
    for (const page of ['snapshots', 'wishes', 'achievements'] as const)
      for (const f of formatsFor(page)) {
        expect(f.name).not.toBe('')
        expect(f.importsBack).toBe(true)
      }
  })

  it('names no other tool for the Teyvat.me file; Genshin Optimizer and Seelie only for plain GOOD', () => {
    for (const page of ['snapshots', 'achievements'] as const)
      expect(formatsFor(page).find((f) => f.id === 'leyline')!.readers).toEqual([])
    for (const page of ['snapshots', 'wishes', 'achievements'] as const)
      for (const f of formatsFor(page))
        for (const tool of ['Genshin Optimizer', 'Seelie'])
          expect(f.readers.includes(tool)).toBe(f.id === 'good')
  })
})

describe('snapshots', () => {
  const leyline = {
    format: 'GOOD',
    version: 3,
    source: 'Teyvat.me',
    leyline: 1,
    characters: [],
    weapons: [
      {
        key: 'DullBlade',
        level: 1,
        ascension: 0,
        refinement: 1,
        location: '',
        lock: false,
        gi_guid: '1',
      },
    ],
    artifacts: [],
    materials: {},
    gi_off: ['characters', 'materials'],
    gi_player: { uid: 812345678 },
    gi_achievements: [80001],
  }
  const input: SnapshotExportInput = { leyline, takenAt: Date.UTC(2026, 0, 2, 3, 4, 5) }
  const [ley, good] = formatsFor('snapshots')

  it('Leyline is the stored file as is', () => {
    expect(JSON.parse(ley!.build(input).text)).toEqual(leyline)
    expect(ley!.fileName(input)).toBe('leyline-2026-01-02T03-04-05.json')
    expect(ley!.leavesOut(input)).toEqual([
      { code: 'not-shared', parts: ['characters', 'materials'] },
    ])
  })

  it("plain GOOD's facts name exactly what its builder drops", () => {
    const built = JSON.parse(good!.build(input).text)
    expect(built).toEqual(toPlainGood(leyline))
    expect(good!.fileName(input)).toBe('good-2026-01-02T03-04-05.json')
    const facts = good!.leavesOut(input)
    expect(facts).toEqual([
      { code: 'not-shared', parts: ['characters', 'materials'] },
      { code: 'teyvatme-keys', keys: ['gi_player', 'gi_achievements'] },
      { code: 'item-extras', count: 1 },
    ])
    const dropped = Object.keys(leyline).filter((k) => !(k in built))
    expect(dropped.sort()).toEqual(
      ['leyline', 'gi_off', 'gi_player', 'gi_achievements', 'characters', 'materials'].sort(),
    )
  })
})

describe('wishes', () => {
  const pull = (n: number, name: string): WishPull => ({
    id: 10n ** 18n + BigInt(n),
    time: Date.UTC(2026, 0, 2) / 1000 + n,
    gachaType: 301,
    item: resolveWishItem({ name, itemType: 'Character', rank: 5 }),
  })
  const input: WishExportInput = {
    uid: UID,
    accountId: 3,
    timezone: 8,
    pulls: [pull(1, 'Diluc'), pull(2, 'Made Up New One'), pull(3, 'Nobody Known')],
    itemIds: (p) => (p.item.name === 'Made Up New One' ? 10000999 : undefined),
    appVersion: '1.19.2',
    now: NOW,
  }
  const [uigf, csv] = formatsFor('wishes')

  it('UIGF v4.2: leaves out the pull without an item id, and says so', () => {
    const file = JSON.parse(uigf!.build(input).text)
    expect(file.info.version).toBe('v4.2')
    expect(file.hk4e[0].list).toHaveLength(2)
    expect(uigf!.leavesOut(input)).toEqual([{ code: 'no-item-id', count: 1 }])
    expect(uigf!.leavesOut({ ...input, pulls: input.pulls.slice(0, 2) })).toEqual([])
    expect(uigf!.fileName(input)).toBe(`wishes-uigf-${UID}-2026-11-26.json`)
    expect(parseWishFile(uigf!.build(input).text).accounts[0]!.records).toHaveLength(2)
  })

  it('paimon.moe CSV: every pull, no ids', () => {
    const text = csv!.build(input).text
    expect(parsePaimonCsv(text).accounts[0]!.records).toHaveLength(3)
    expect(csv!.leavesOut(input)).toEqual([{ code: 'record-ids' }])
    expect(csv!.fileName({ ...input, uid: null })).toBe('wishes-paimonmoe-account3-2026-11-26.csv')
  })
})

describe('achievements', () => {
  const a = (id: number, progress: number): Achievement => ({
    id,
    goal: 1,
    order: id,
    hidden: false,
    prevStage: 0,
    primogems: 5,
    progress,
    version: '1.0',
    disused: false,
  })
  const input: AchievementFileInput = {
    captured: {
      ids: new Set([80001, 80002]),
      completedAt: new Map([[80001, 1_700_000_000_000]]),
      progress: new Map([[80003, { progress: 2, total: 10 }]]),
    },
    // 80001 is marked too: the capture holds it, so it is not a mark the file lacks.
    marked: new Set([80001, 80004, 80005]),
    known: new Map([a(80001, 1), a(80002, 2), a(80003, 10), a(80004, 4)].map((x) => [x.id, x])),
    snapshot: {
      leyline: {
        format: 'GOOD',
        version: 3,
        source: 'Teyvat.me',
        leyline: 1,
        characters: [],
        weapons: [],
        artifacts: [],
        materials: {},
        gi_off: ['materials'],
        gi_achievements: [80001, 80002],
        gi_achievement_times: { '80001': 1_700_000_000 },
      },
      takenAt: Date.UTC(2026, 0, 2, 3, 4, 5),
    },
    uid: UID,
    accountId: 3,
    appVersion: '1.19.2',
    now: NOW,
  }
  const [uiaf, leyline] = formatsFor('achievements')
  const [snapshotLeyline] = formatsFor('snapshots')

  it("UIAF's facts agree with the rows it writes", () => {
    const file = parseUiaf(uiaf!.build(input).text)
    const unknownTime = file.entries.filter(
      (e) => e.status === 2 && e.timestamp === UIAF_UNKNOWN_TIME,
    )
    expect(unknownTime.map((e) => e.id)).toEqual([80002, 80004, 80005])
    expect(uiaf!.leavesOut(input)).toEqual([
      { code: 'marks-without-time', count: 2 },
      { code: 'captured-without-time', count: 1 },
      { code: 'reward-claimed' },
    ])
    expect(file.entries.some((e) => e.status === 3)).toBe(false)
    expect(uiaf!.fileName(input)).toBe(`achievements-uiaf-${UID}-2026-11-26.json`)
  })

  it('the Teyvat.me file is the capture, as on Snapshots, without hand marks', () => {
    const snapshot = input.snapshot!
    expect(leyline!.build(input)).toEqual(snapshotLeyline!.build(snapshot))
    expect(leyline!.fileName(input)).toBe(snapshotLeyline!.fileName(snapshot))
    expect(leyline!.fileName(input)).toBe('leyline-2026-01-02T03-04-05.json')
    expect(leyline!.readers).toEqual(snapshotLeyline!.readers)
    expect(leyline!.name).toBe(snapshotLeyline!.name)
    const json = JSON.parse(leyline!.build(input).text)
    expect(json.gi_achievements).toEqual([80001, 80002])
    expect(parseAchievementImport(json)?.ids).toEqual([80001, 80002])
    expect(leyline!.leavesOut(input)).toEqual([
      { code: 'not-shared', parts: ['materials'] },
      { code: 'hand-marks', count: 2 },
    ])
  })

  it('names no hand marks when every mark is captured', () => {
    expect(leyline!.leavesOut({ ...input, marked: new Set([80002]) })).toEqual([
      { code: 'not-shared', parts: ['materials'] },
    ])
  })

  it('has nothing to build without a capture', () => {
    expect(() => leyline!.build({ ...input, snapshot: null })).toThrow()
  })
})
