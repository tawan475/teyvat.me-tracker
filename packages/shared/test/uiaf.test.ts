import { describe, expect, it } from 'vitest'
import {
  UIAF_MAX_BYTES,
  UIAF_MAX_ENTRIES,
  UIAF_UNKNOWN_TIME,
  UiafError,
  WishFileError,
  buildUiaf,
  isUiaf,
  parseUiaf,
  parseWishFile,
} from '../src'

// Made-up files written from the spec (uigf.org UIAF v1.1); no file of another project.
const v11 = (list: unknown[], info: Record<string, unknown> = {}) => ({
  info: { export_app: 'Test', export_app_version: '1.0', uiaf_version: 'v1.1', ...info },
  list,
})

const code = (fn: () => unknown) => {
  try {
    fn()
  } catch (error) {
    if (error instanceof UiafError) return error.code
    throw error
  }
  return null
}

describe('parseUiaf', () => {
  it('reads every status of a v1.1 file', () => {
    const parsed = parseUiaf(
      JSON.stringify(
        v11(
          [
            { id: 80003, current: 40, status: 2, timestamp: 1700000000 },
            { id: 80001, current: 0, status: 3, timestamp: UIAF_UNKNOWN_TIME },
            { id: 80002, current: 12, status: 1, timestamp: 0 },
            { id: 80004, current: 0, status: 0, timestamp: 0 },
          ],
          { export_timestamp: 1700000100 },
        ),
      ),
    )
    expect(parsed.version).toBe('v1.1')
    expect(parsed.app).toBe('Test')
    expect(parsed.appVersion).toBe('1.0')
    expect(parsed.exportedAt).toBe(1700000100)
    expect(parsed.finished).toEqual([80001, 80003])
    expect(parsed.unfinished).toBe(1)
    expect(parsed.invalid).toBe(1)
    expect(parsed.malformed).toBe(0)
    expect(parsed.entries.map((e) => e.id)).toEqual([80001, 80002, 80003, 80004])
    expect(parsed.entries[0]!.timestamp).toBe(UIAF_UNKNOWN_TIME)
  })

  it('reads a v1.0 entry without a status as finished', () => {
    const parsed = parseUiaf(
      v11([{ id: 80001, current: 0, timestamp: 1600000000 }], { uiaf_version: 'v1.0' }),
    )
    expect(parsed.version).toBe('v1.0')
    expect(parsed.finished).toEqual([80001])
    expect(parsed.entries[0]).toEqual({ id: 80001, current: 0, status: 2, timestamp: 1600000000 })
  })

  it('reads a missing counter or time as unknown', () => {
    const parsed = parseUiaf(v11([{ id: 80001, status: 2 }]))
    expect(parsed.entries[0]).toEqual({
      id: 80001,
      current: 0,
      status: 2,
      timestamp: UIAF_UNKNOWN_TIME,
    })
  })

  it('merges duplicates: the highest status wins', () => {
    const parsed = parseUiaf(
      v11([
        { id: 80001, current: 3, status: 1, timestamp: 0 },
        { id: 80001, current: 5, status: 2, timestamp: 1700000000 },
        { id: 80001, current: 9, status: 1, timestamp: 0 },
        { id: 80002, current: 1, status: 1, timestamp: 0 },
        { id: 80002, current: 4, status: 1, timestamp: 0 },
      ]),
    )
    expect(parsed.duplicates).toBe(3)
    expect(parsed.entries).toEqual([
      { id: 80001, current: 5, status: 2, timestamp: 1700000000 },
      { id: 80002, current: 4, status: 1, timestamp: 0 },
    ])
    expect(parsed.finished).toEqual([80001])
    expect(parsed.unfinished).toBe(1)
  })

  it('leaves out and counts entries with a bad id or status only', () => {
    const parsed = parseUiaf(
      v11([
        { id: '80001', current: 0, status: 2, timestamp: 0 },
        { id: 80002, current: '1', status: 2, timestamp: 0 },
        { id: 80003, current: 0, status: 4, timestamp: 0 },
        { id: 80004, current: 0, status: 2, timestamp: -1 },
        { id: -5, current: 0, status: 2, timestamp: 0 },
        { id: 2 ** 31 + 1, current: 0, status: 2, timestamp: 0 },
        { id: 1.5, current: 0, status: 2, timestamp: 0 },
        null,
        [80005],
        { id: 80006, current: 0, status: 2, timestamp: 0 },
      ]),
    )
    // 80002 (counter '1') and 80004 (time -1) are finished all the same.
    expect(parsed.malformed).toBe(7)
    expect(parsed.finished).toEqual([80002, 80004, 80006])
  })

  it('reads a finished entry with a bad counter or time as finished, both unknown', () => {
    const parsed = parseUiaf(
      v11([
        { id: 80001, current: -3, status: 2, timestamp: -1 },
        { id: 80002, current: 'x', status: 3, timestamp: 'y' },
        { id: 80003, current: Number.NaN, timestamp: null },
        { id: 80004, current: -1, status: 1, timestamp: 'z' },
      ]),
    )
    expect(parsed.malformed).toBe(0)
    expect(parsed.finished).toEqual([80001, 80002, 80003])
    expect(parsed.unfinished).toBe(1)
    for (const entry of parsed.entries) {
      expect(entry.current).toBe(0)
      expect(entry.timestamp).toBe(UIAF_UNKNOWN_TIME)
    }
  })

  it('never reads a file naming another standard or holding a UIGF block as UIAF', () => {
    const list = [{ id: 80001, current: 0, status: 2, timestamp: 0 }]
    for (const other of ['uigf_version', 'srgf_version']) {
      const file = { info: { export_app: 'Test', uiaf_version: 'v1.1', [other]: 'v3.0' }, list }
      expect(isUiaf(file)).toBe(false)
      expect(code(() => parseUiaf(file))).toBe('not_uiaf')
    }
    for (const block of ['hk4e', 'hkrpg', 'nap', 'hk4e_ugc']) {
      const file = { info: { export_app: 'Test', uiaf_version: 'v1.1' }, list, [block]: [] }
      expect(isUiaf(file)).toBe(false)
      expect(code(() => parseUiaf(file))).toBe('not_uiaf')
    }
    expect(isUiaf({ info: { export_app: 'Test', uiaf_version: 'v1.1' }, list })).toBe(true)
  })

  it('refuses what is not UIAF v1.0 or v1.1', () => {
    expect(code(() => parseUiaf('not json'))).toBe('malformed')
    expect(code(() => parseUiaf({ list: [] }))).toBe('not_uiaf')
    expect(code(() => parseUiaf([80001]))).toBe('not_uiaf')
    expect(code(() => parseUiaf(v11([], { uiaf_version: 'v2.0' })))).toBe('version')
    expect(code(() => parseUiaf({ info: { uiaf_version: 'v1.1' }, list: {} }))).toBe('not_uiaf')
  })

  it('refuses a file over the limits', () => {
    const many = Array.from({ length: UIAF_MAX_ENTRIES + 1 }, (_, i) => ({
      id: 80000 + i,
      current: 0,
      status: 2,
      timestamp: 0,
    }))
    expect(code(() => parseUiaf(v11(many)))).toBe('too_many')
    expect(parseUiaf(v11(many.slice(0, UIAF_MAX_ENTRIES))).finished).toHaveLength(UIAF_MAX_ENTRIES)
    const big = JSON.stringify(v11([], { pad: 'x'.repeat(UIAF_MAX_BYTES) }))
    expect(code(() => parseUiaf(big))).toBe('too_big')
  })

  it('never reads a UIGF file as UIAF, nor UIAF as UIGF', () => {
    const uigf3 = {
      info: { uid: '812345678', lang: 'en-us', uigf_version: 'v3.0', region_time_zone: 8 },
      list: [{ id: '1700000000000000001', gacha_type: '301', time: '2023-01-01 00:00:00' }],
    }
    const uigf4 = {
      info: { export_app: 'Test', export_app_version: '1', version: 'v4.2', export_timestamp: 0 },
      hk4e: [{ uid: '812345678', timezone: 8, list: [] }],
    }
    expect(isUiaf(uigf3)).toBe(false)
    expect(isUiaf(uigf4)).toBe(false)
    expect(code(() => parseUiaf(uigf3))).toBe('not_uiaf')
    expect(code(() => parseUiaf(uigf4))).toBe('not_uiaf')
    // The reverse: a UIAF file has `info` and `list`, which UIGF v3 has too.
    const uiaf = JSON.stringify(v11([{ id: 80001, current: 0, status: 2, timestamp: 0 }]))
    expect(() => parseWishFile(uiaf)).toThrow(WishFileError)
    expect(parseWishFile(JSON.stringify(uigf3)).format).toBe('uigf')
  })
})

describe('buildUiaf', () => {
  it('writes v1.1, one row per id, sorted, and reads back the same', () => {
    const file = buildUiaf(
      [
        { id: 80003, current: 1, status: 1, timestamp: 0 },
        { id: 80001, current: 40, status: 2, timestamp: 1700000000 },
        { id: 80001, current: 0, status: 1, timestamp: 0 },
        { id: 80002, current: 10, status: 2, timestamp: UIAF_UNKNOWN_TIME },
      ],
      { name: 'Teyvat.me', version: '1.19.2', now: 1_700_000_123_456 },
    )
    expect(file.info).toEqual({
      export_app: 'Teyvat.me',
      export_app_version: '1.19.2',
      uiaf_version: 'v1.1',
      export_timestamp: 1_700_000_123,
    })
    expect(file.list.map((e) => e.id)).toEqual([80001, 80002, 80003])
    expect(Object.keys(file.list[0]!)).toEqual(['id', 'current', 'status', 'timestamp'])
    const back = parseUiaf(JSON.stringify(file))
    expect(back.entries).toEqual(file.list)
    expect(back.malformed + back.duplicates).toBe(0)
  })
})
