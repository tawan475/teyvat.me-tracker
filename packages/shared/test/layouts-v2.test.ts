import { describe, expect, it } from 'vitest'
import {
  decodeSectionBlob,
  encodeSectionBlob,
  encodeSectionBlobVariants,
  isPlayerV2,
  isTasksV2,
  jsonSectionBlob,
  kindCode,
  type SectionKind,
} from '../src'

// The second binary forms of tasks and player (2026-11-09,
// docs/plans/storage-efficiency.md phase 4): sections the first layouts
// could not hold were stored as JSON on every snapshot.

const LAYOUT_JSON = 0x00
const LAYOUT_BINARY = 0x10

function roundTrip(kind: SectionKind, value: unknown) {
  const blob = encodeSectionBlob(kind, value, false, null)
  const decoded = decodeSectionBlob(kindCode(kind, false), blob.data, null, null)
  expect(JSON.stringify(decoded.value)).toBe(JSON.stringify(value))
  return { blob, layout: blob.data[0]! & 0xf0, body: decoded.payload.subarray(1) }
}

const T = 1_794_000_000 // unix seconds, as Capture sends them

/** Every part Capture sends, in the section's own key order (sections.ts encodeTasks). */
const allTasks = {
  c: [4, 4],
  t: 1,
  a: [T - 86_400 * 9, T + 86_400 * 7, 27, 36],
  e: [
    ['Bennett', 1001, T - 3_600, 20, T + 68_400],
    ['', 1002, T - 7_200, 4, T + 7_200],
  ],
  r: [1_850, 2_400],
  w: 37,
  p: ['TheCatch', 1, 2],
  n: [41, T + 480],
  q: [3, 3, 30, 60, 0],
  m: [
    [20101, [T - 120, T + 3_000]],
    [20102, [T + 5]],
    [20450, []],
  ],
  k: [5, 9, 10, 30],
  i: [[44, 12, [1, 2, 3, 7], T - 50_000, T - 86_400 * 12, T + 86_400 * 20]],
  s: [160, 20_401, T - 30],
  f: [
    T - 99_000,
    1,
    [
      ['IntertwinedFate', 'Stardust', 75, 5, 5],
      ['AcquaintFate', 'Stardust', 75, 2, 0],
    ],
  ],
  x: [T - 86_400 * 3, T + 86_400 * 4],
}

describe('tasks, second form', () => {
  it('holds every part exactly, in binary, smaller than the JSON it replaces', () => {
    const { layout, body, blob } = roundTrip('tasks', allTasks)
    expect(layout).toBe(LAYOUT_BINARY)
    expect(isTasksV2(body)).toBe(true)
    expect(blob.data.length).toBeLessThan(jsonSectionBlob(allTasks).length)
  })

  it('keeps the first form while it holds the section (every deployed build reads it)', () => {
    const { layout, body } = roundTrip('tasks', { c: [2, 4], a: [T, T + 600, 9, 36], w: 3 })
    expect(layout).toBe(LAYOUT_BINARY)
    expect(isTasksV2(body)).toBe(false)
  })

  it('holds one part alone, empty lists and times that go backwards', () => {
    for (const value of [
      { t: 0 },
      { m: [] },
      { e: [] },
      { k: [] },
      { i: [[1, 0, [], 0, 0, 0]] },
      { m: [[5, [T + 100, T - 100, T]]], x: [T, T - 5] },
      { c: [0, 0], q: [0, 3, 30, 60] },
    ]) {
      const { layout } = roundTrip('tasks', value)
      expect(layout).toBe(LAYOUT_BINARY)
    }
  })

  it('falls back to JSON, still exactly, for what it cannot hold', () => {
    for (const value of [
      { n: [1.5, T] }, // not a whole number
      { c: [-1, 4] }, // negative
      { q: [1, 2, 3] }, // wrong length
      { z: 1 }, // a letter no layout knows
      { x: [T, T], c: [1, 1] }, // keys out of the section's order
    ]) {
      expect(roundTrip('tasks', value).layout).toBe(LAYOUT_JSON)
    }
  })

  it('is compressed against a similar section like the first form', () => {
    const base = encodeSectionBlob('tasks', allTasks, false, null)
    const root = decodeSectionBlob(kindCode('tasks', false), base.data, null, null)
    const next = { ...allTasks, c: [3, 4], n: [43, T + 960] }
    const { standalone, withBase } = encodeSectionBlobVariants('tasks', next, root)
    expect(withBase).not.toBeNull()
    expect(withBase!.data.length * 3).toBeLessThan(standalone.data.length)
    const decoded = decodeSectionBlob(kindCode('tasks', false), withBase!.data, root, null)
    expect(decoded.value).toEqual(next)
  })
})

describe('player, second form', () => {
  const player = {
    uid: 812345678,
    ar: 60,
    nickname: 'Traveler',
    profilePicture: { id: 1_000_001, costume: 0 },
    birthday: { month: 2, day: 29 },
  }

  it('holds objects of whole numbers in binary', () => {
    const { layout, body } = roundTrip('player', player)
    expect(layout).toBe(LAYOUT_BINARY)
    expect(isPlayerV2(body)).toBe(true)
  })

  it('keeps the first form without them', () => {
    const { layout, body } = roundTrip('player', { uid: 812345678, ar: 60, gameData: 'ab12' })
    expect(layout).toBe(LAYOUT_BINARY)
    expect(isPlayerV2(body)).toBe(false)
  })

  it('falls back to JSON for objects of anything else', () => {
    expect(roundTrip('player', { uid: 1, profilePicture: { id: 'x' } }).layout).toBe(LAYOUT_JSON)
    expect(roundTrip('player', { uid: 1, list: [1, 2] }).layout).toBe(LAYOUT_JSON)
  })
})

describe('JSON blobs for old builds', () => {
  it('decode to the same value as the binary form', () => {
    for (const [kind, value] of [
      ['tasks', allTasks],
      ['player', { uid: 1, birthday: { month: 1, day: 2 } }],
    ] as const) {
      const data = jsonSectionBlob(value)
      expect(data[0]! & 0xf0).toBe(LAYOUT_JSON)
      expect(decodeSectionBlob(kindCode(kind, false), data, null, null).value).toEqual(value)
    }
  })
})
