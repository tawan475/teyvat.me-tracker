import type { GiStygianRecord } from '@gdt/shared'
import { describe, expect, it } from 'vitest'
import {
  capturedEndgame,
  fightsDone,
  formatFightTime,
  NO_CAPTURED_ENDGAME,
  recordTotal,
} from '../endgame-runs'

const record = (season: number, coop: boolean, time: number): GiStygianRecord => ({
  season,
  difficulty: 6,
  at: 1_790_000_000,
  coop,
  fights: [{ time, done: true, team: ['Furina', 'Bennett'] }],
})

describe('capturedEndgame', () => {
  it('is empty without any endgame capture', () => {
    expect(capturedEndgame([])).toBe(NO_CAPTURED_ENDGAME)
    expect(
      capturedEndgame([
        { takenAt: 1, endgame: null },
        { takenAt: 2, endgame: undefined },
      ]),
    ).toBe(NO_CAPTURED_ENDGAME)
  })

  it('keeps the newest Theater state per season, across the captures', () => {
    const got = capturedEndgame([
      // Out of order on purpose: the newest capture of a season wins, whatever the list order.
      { takenAt: 30, endgame: { theater: { season: 31, difficulty: 129, level: 5, acts: 10 } } },
      { takenAt: 10, endgame: { theater: { season: 30, acts: 0 } } },
      { takenAt: 20, endgame: { theater: { season: 30, difficulty: 128, level: 4, acts: 8 } } },
      { takenAt: 25, endgame: { theater: { season: 31, acts: 0 } } },
    ])
    expect([...got.theater.keys()].sort()).toEqual([30, 31])
    expect(got.theater.get(30)).toEqual({
      run: { season: 30, difficulty: 128, level: 4, acts: 8 },
      takenAt: 20,
    })
    expect(got.theater.get(31)).toEqual({
      run: { season: 31, difficulty: 129, level: 5, acts: 10 },
      takenAt: 30,
    })
    expect(got.takenAt).toBe(30)
    expect(got.stygian.size).toBe(0)
  })

  it('groups the Stygian records by season from the newest capture that lists the season', () => {
    const got = capturedEndgame([
      {
        takenAt: 10,
        endgame: {
          stygian: { records: [record(5_269_011, false, 70), record(5_269_012, false, 60)] },
        },
      },
      {
        takenAt: 20,
        endgame: {
          stygian: { records: [record(5_269_012, false, 55), record(5_269_012, true, 40)] },
        },
      },
    ])
    expect([...got.stygian.keys()].sort()).toEqual([5_269_011, 5_269_012])
    // A season an older capture alone lists is kept from that capture.
    expect(got.stygian.get(5_269_011)).toEqual({
      records: [record(5_269_011, false, 70)],
      takenAt: 10,
    })
    // The newest capture's records of a season replace the older capture's.
    expect(got.stygian.get(5_269_012)).toEqual({
      records: [record(5_269_012, false, 55), record(5_269_012, true, 40)],
      takenAt: 20,
    })
  })

  it('reads a capture with both parts', () => {
    const got = capturedEndgame([
      {
        takenAt: 5,
        endgame: {
          theater: { season: 31, acts: 3 },
          stygian: { records: [record(5_269_012, true, 90)] },
        },
      },
    ])
    expect(got.theater.get(31)?.run.acts).toBe(3)
    expect(got.stygian.get(5_269_012)?.records[0]?.coop).toBe(true)
    expect(got.takenAt).toBe(5)
  })
})

describe('record figures', () => {
  it('formats a time like the game', () => {
    expect(formatFightTime(0)).toBe('0s')
    expect(formatFightTime(51)).toBe('51s')
    expect(formatFightTime(78)).toBe('78s')
  })

  it('totals a record only once every fight is done', () => {
    const full = record(1, false, 50)
    full.fights.push({ time: 40, done: true, team: [] }, { time: 30, done: true, team: [] })
    expect(recordTotal(full)).toBe(120)
    expect(fightsDone(full)).toBe(3)
    const partial = { ...full, fights: [...full.fights, { time: 0, done: false, team: [] }] }
    expect(recordTotal(partial)).toBeNull()
    expect(fightsDone(partial)).toBe(3)
    expect(recordTotal({ ...full, fights: [] })).toBeNull()
  })
})

describe('captured Abyss periods', () => {
  const abyss = (start: number, stars: number) => ({
    start,
    end: start + 1_296_000,
    stars,
    maxStars: 36,
  })

  it('keeps the newest capture of each period, by its start, beside the other modes', () => {
    const got = capturedEndgame([
      { takenAt: 10, endgame: null, abyss: abyss(1_792_094_400, 27) },
      { takenAt: 20, endgame: null, abyss: abyss(1_792_094_400, 33) },
      { takenAt: 5, endgame: null, abyss: abyss(1_790_798_400, 36) },
      { takenAt: 30, endgame: { theater: { season: 31, acts: 1 } }, abyss: null },
    ])
    expect([...got.abyss.keys()].sort()).toEqual([1_790_798_400, 1_792_094_400])
    expect(got.abyss.get(1_792_094_400)).toEqual({ run: abyss(1_792_094_400, 33), takenAt: 20 })
    expect(got.abyss.get(1_790_798_400)?.takenAt).toBe(5)
    expect(got.theater.get(31)?.run.acts).toBe(1)
    expect(got.takenAt).toBe(30)
    // Abyss figures alone make a capture count.
    expect(capturedEndgame([{ takenAt: 1, endgame: null, abyss: abyss(1, 1) }]).takenAt).toBe(1)
  })

  it('keeps the record book by period, from the newest capture that lists it', () => {
    const period = (season: number, stars: number) => ({
      season,
      floor: 12,
      chamber: 3,
      stars,
      picked: [{ key: 'Mavuika', times: 17 }],
    })
    const got = capturedEndgame([
      { takenAt: 20, endgame: { abyss: { periods: [period(122, 36), period(123, 30)] } } },
      { takenAt: 10, endgame: { abyss: { periods: [period(123, 36)] } } },
      { takenAt: 30, endgame: { theater: { season: 31, acts: 1 } } },
    ])
    expect([...got.abyssBook.keys()].sort()).toEqual([122, 123])
    expect(got.abyssBook.get(123)).toEqual({ record: period(123, 30), takenAt: 20 })
    expect(got.takenAt).toBe(30)
    expect(capturedEndgame([]).abyssBook.size).toBe(0)
  })
})
