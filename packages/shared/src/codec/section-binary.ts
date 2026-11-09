/**
 * Binary encodings of the section shapes in sections.ts (storage format v2).
 * Each encodes a section's canonical value (the JSON a v1 blob holds) into
 * varints, column by column, and decodes it back to the same value: the JSON
 * text of the decoded value equals the original's, which every write checks
 * (see section-blob.ts) before it trusts the binary form.
 *
 * A delta's base is not stored here: the snapshot row names it, and the
 * section's content address (which covers the base's hash) keeps deltas of
 * different bases apart. `encode` takes the value without `b` plus whether
 * it is a delta; `decode` gives the value back with `b` set to the key the
 * caller names its base by.
 *
 * Every encoder throws (RangeError, TypeError) on a value outside what its
 * layout holds: a float, a number past 2^52, an unexpected field. The caller
 * then stores that section as JSON instead, so nothing is ever lost to a
 * layout that did not foresee it.
 *
 * These layouts are a storage format: data written today must decode
 * forever. Change a layout only by adding a new codec version (see the
 * format byte in section-blob.ts), never by editing one.
 */

import type { KeyRef } from '../dictionary'
import { ARCHIVE_TABS } from '../good'
import { ByteReader, ByteWriter, CorruptDataError } from './bytes'
import type { SectionKind } from './sections'

// ------------------------------------------------------------------ cells
// A KeyRef cell: a number as zigzag(n - previous) * 2 (previous is 0 unless
// the column is delta-coded), a string as length * 2 + 1 then its UTF-8.

function writeRef(w: ByteWriter, value: KeyRef, previous: number): number {
  if (typeof value === 'number') {
    const delta = value - previous
    if (!Number.isSafeInteger(value) || !Number.isSafeInteger(delta) || Math.abs(delta) > 2 ** 50) {
      throw new RangeError(`Not a storable integer: ${value}`)
    }
    w.uint((delta >= 0 ? delta * 2 : -delta * 2 - 1) * 2)
    return value
  }
  if (typeof value !== 'string') throw new TypeError('Not a key')
  const bytes = new TextEncoder().encode(value)
  w.uint(bytes.length * 2 + 1).bytes(bytes)
  return previous
}

function readRef(r: ByteReader, previous: number): [KeyRef, number] {
  const tag = r.uint()
  if (tag % 2 === 1) {
    const length = (tag - 1) / 2
    return [decodeUtf8(r.bytes(length)), previous]
  }
  const z = tag / 2
  const delta = z % 2 === 0 ? z / 2 : -(z + 1) / 2
  const value = previous + delta
  return [value, value]
}

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
function decodeUtf8(bytes: Uint8Array): string {
  try {
    return utf8.decode(bytes)
  } catch {
    throw new CorruptDataError('Invalid UTF-8')
  }
}

function int(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || Math.abs(value) > 2 ** 51) {
    throw new RangeError(`Not a storable integer: ${String(value)}`)
  }
  return value
}

function uint(value: unknown): number {
  const n = int(value)
  if (n < 0) throw new RangeError(`Negative: ${n}`)
  return n
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new TypeError('Not an array')
  return value
}

/** An object with exactly `keys` (in that order; `optional` ones may be absent). */
function fields(value: unknown, keys: readonly string[], optional: readonly string[] = []) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Not an object')
  }
  const own = Object.keys(value)
  const expected = keys.filter((k) => !optional.includes(k) || k in value)
  if (own.length !== expected.length || own.some((k, i) => k !== expected[i])) {
    throw new TypeError(`Unexpected fields: ${own.join(',')}`)
  }
  return value as Record<string, unknown>
}

// ------------------------------------------------------------------ rows
// characters, weapons, characterExtras: arrays of trimmed rows. Stored by
// column: every row's length, then column 0 (the dictionary ref, ascending,
// so delta-coded), then each further column for the rows long enough to
// have it.

function writeRows(w: ByteWriter, value: unknown, deltaColumns: ReadonlySet<number>): void {
  const rows = array(value).map((row) => array(row) as KeyRef[])
  w.uint(rows.length)
  let width = 0
  for (const row of rows) {
    if (row.length === 0) throw new RangeError('Empty row')
    w.uint(row.length)
    width = Math.max(width, row.length)
  }
  for (let column = 0; column < width; column++) {
    let previous = 0
    for (const row of rows) {
      if (row.length <= column) continue
      const cell = row[column]!
      previous = writeRef(w, cell, deltaColumns.has(column) ? previous : 0)
    }
  }
}

function readRows(r: ByteReader, deltaColumns: ReadonlySet<number>): KeyRef[][] {
  const count = r.uint()
  if (count > r.remaining) throw new CorruptDataError('Row count past the data')
  const rows: KeyRef[][] = []
  for (let i = 0; i < count; i++) rows.push(new Array<KeyRef>(r.uint()))
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0)
  for (let column = 0; column < width; column++) {
    let previous = 0
    for (const row of rows) {
      if (row.length <= column) continue
      const [cell, next] = readRef(r, deltaColumns.has(column) ? previous : 0)
      row[column] = cell
      if (deltaColumns.has(column)) previous = next
    }
  }
  return rows
}

// --------------------------------------------------------- kind layouts

/** Flags byte of the keyed layouts: bit 0 = the section is a delta. */
const DELTA = 1
/** achievementTimes: bit 1 = times are delta-coded (each vs the previous). */
const TIMES_DELTA = 2

export interface BinaryInput {
  /** The canonical value without `b`. */
  value: unknown
  delta: boolean
}

/** What a layout may vary per section (it tries each and keeps the smallest). */
type Variant = number

interface Layout {
  variants: readonly Variant[]
  encode(w: ByteWriter, input: BinaryInput, variant: Variant): void
  /** `base` is what `b` is set to when the section is a delta. */
  decode(r: ByteReader, base: string | null): unknown
}

const COLUMN0 = new Set([0])

const rowsLayout: Layout = {
  variants: [0],
  encode(w, { value, delta }) {
    if (delta) throw new TypeError('Rows sections have no deltas')
    writeRows(w, value, COLUMN0)
  },
  decode(r) {
    return readRows(r, COLUMN0)
  },
}

function withBase(base: string | null, flags: number): { b?: string } {
  if ((flags & DELTA) === 0) return {}
  if (base === null) throw new CorruptDataError('A delta section needs its base')
  return { b: base }
}

const artifactsLayout: Layout = {
  variants: [0],
  encode(w, { value, delta }) {
    const v = fields(value, ['i', 'l', 'f'])
    const ids = array(v.i)
    const locations = array(v.l) as KeyRef[]
    const flags = array(v.f)
    if (locations.length !== ids.length || flags.length !== ids.length) {
      throw new RangeError('Columns differ in length')
    }
    w.byte(delta ? DELTA : 0).uint(ids.length)
    for (const id of ids) w.uint(uint(id))
    for (const location of locations) writeRef(w, location, 0)
    for (const flag of flags) w.int(int(flag))
  },
  decode(r, base) {
    const flags = r.byte()
    const count = r.uint()
    if (count > r.remaining) throw new CorruptDataError('Count past the data')
    const i: number[] = []
    for (let n = 0; n < count; n++) i.push(r.uint())
    const l: KeyRef[] = []
    for (let n = 0; n < count; n++) l.push(readRef(r, 0)[0])
    const f: number[] = []
    for (let n = 0; n < count; n++) f.push(r.int())
    return { ...withBase(base, flags), i, l, f }
  },
}

const materialsLayout: Layout = {
  variants: [0],
  encode(w, { value, delta }) {
    const entries = array(fields(value, ['m']).m).map((e) => array(e))
    w.byte(delta ? DELTA : 0).uint(entries.length)
    let previous = 0
    for (const entry of entries) {
      if (entry.length !== 2) throw new RangeError('Not a [key, count] entry')
      previous = writeRef(w, entry[0] as KeyRef, previous)
    }
    for (const entry of entries) w.int(int(entry[1]))
  },
  decode(r, base) {
    const flags = r.byte()
    const count = r.uint()
    if (count > r.remaining) throw new CorruptDataError('Count past the data')
    const keys: KeyRef[] = []
    let previous = 0
    for (let n = 0; n < count; n++) {
      const [key, next] = readRef(r, previous)
      keys.push(key)
      previous = next
    }
    const m = keys.map((key): [KeyRef, number] => [key, r.int()])
    return { ...withBase(base, flags), m }
  },
}

const achievementsLayout: Layout = {
  variants: [0],
  encode(w, { value, delta }) {
    if (delta) throw new TypeError('Achievements have no deltas')
    const ids = array(value)
    w.uint(ids.length)
    for (const id of ids) w.uint(uint(id))
  },
  decode(r) {
    const count = r.uint()
    if (count > r.remaining) throw new CorruptDataError('Count past the data')
    const ids: number[] = []
    for (let n = 0; n < count; n++) ids.push(r.uint())
    return ids
  },
}

const achievementTimesLayout: Layout = {
  // Plain times, or each as the difference from the previous one: a run of
  // achievements finished together is a run of small numbers.
  variants: [0, TIMES_DELTA],
  encode(w, { value, delta }, variant) {
    const v = fields(value, ['i', 't'])
    const ids = array(v.i)
    const times = array(v.t)
    if (times.length !== ids.length) throw new RangeError('Columns differ in length')
    w.byte((delta ? DELTA : 0) | variant).uint(ids.length)
    for (const id of ids) w.uint(uint(id))
    let previous = 0
    for (const time of times) {
      const t = int(time)
      w.int(variant === TIMES_DELTA ? t - previous : t)
      previous = t
    }
  },
  decode(r, base) {
    const flags = r.byte()
    const count = r.uint()
    if (count > r.remaining) throw new CorruptDataError('Count past the data')
    const i: number[] = []
    for (let n = 0; n < count; n++) i.push(r.uint())
    const t: number[] = []
    let previous = 0
    for (let n = 0; n < count; n++) {
      const value = (flags & TIMES_DELTA) !== 0 ? previous + r.int() : r.int()
      t.push(value)
      previous = value
    }
    return { ...withBase(base, flags), i, t }
  },
}

// player: an object of numbers and strings. Known keys are one byte (their
// index in PLAYER_KEYS, append-only), others are spelled out; lowercase hex
// strings (the game-data commit) are stored as bytes.

/** Append-only: a key's index is stored. */
const PLAYER_KEYS = [
  'uid',
  'ar',
  'arExp',
  'wl',
  'wlLimit',
  'resin',
  'storyKeys',
  'maxStamina',
  'gameData',
] as const

const VALUE_INT = 0
const VALUE_STRING = 1
const VALUE_HEX = 2
/**
 * Player v2 (2026-11-09): an object of whole numbers by key (Capture 1.14's
 * `profilePicture`, `birthday`), which made those player sections JSON. A
 * section holding one is written after PLAYER_V2 in place of the count: a
 * count no player section reaches, which the deployed builds' decoder
 * refuses (past the data), so the server sends those builds JSON instead
 * (worker/services/export.ts). Sections without one keep the first form.
 */
const VALUE_OBJECT = 3
const PLAYER_V2 = 2_000_001

const playerLayout: Layout = {
  variants: [0],
  encode(w, { value, delta }) {
    if (delta) throw new TypeError('Player sections have no deltas')
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('Not an object')
    }
    const entries = Object.entries(value)
    const objects = entries.some(([, field]) => field !== null && typeof field === 'object')
    if (objects) w.uint(PLAYER_V2)
    w.uint(entries.length)
    for (const [key, field] of entries) {
      const index = (PLAYER_KEYS as readonly string[]).indexOf(key)
      if (index >= 0) w.uint(index * 2)
      else {
        const bytes = new TextEncoder().encode(key)
        w.uint(bytes.length * 2 + 1).bytes(bytes)
      }
      if (typeof field === 'number') {
        w.uint(VALUE_INT).int(int(field))
      } else if (typeof field === 'string' && field.length % 2 === 0 && /^[0-9a-f]*$/.test(field)) {
        w.uint(VALUE_HEX).uint(field.length / 2)
        for (let i = 0; i < field.length; i += 2) w.byte(parseInt(field.slice(i, i + 2), 16))
      } else if (typeof field === 'string') {
        w.uint(VALUE_STRING).string(field)
      } else if (objects && field !== null && typeof field === 'object' && !Array.isArray(field)) {
        const pairs = Object.entries(field)
        w.uint(VALUE_OBJECT).uint(pairs.length)
        for (const [name, n] of pairs) w.string(name).int(int(n))
      } else {
        throw new TypeError(`Unsupported player value for ${key}`)
      }
    }
  },
  decode(r) {
    let count = r.uint()
    const v2 = count === PLAYER_V2
    if (v2) count = r.uint()
    if (count > r.remaining) throw new CorruptDataError('Count past the data')
    const player: Record<string, number | string | Record<string, number>> = {}
    for (let n = 0; n < count; n++) {
      const tag = r.uint()
      let key: string
      if (tag % 2 === 0) {
        const known = PLAYER_KEYS[tag / 2]
        if (known === undefined) throw new CorruptDataError(`Unknown player key ${tag / 2}`)
        key = known
      } else key = decodeUtf8(r.bytes((tag - 1) / 2))
      const type = r.uint()
      if (type === VALUE_INT) player[key] = r.int()
      else if (type === VALUE_STRING) player[key] = r.string()
      else if (type === VALUE_HEX) {
        let hex = ''
        for (const byte of r.bytes(r.uint())) hex += byte.toString(16).padStart(2, '0')
        player[key] = hex
      } else if (v2 && type === VALUE_OBJECT) {
        const object: Record<string, number> = {}
        for (let n = r.uint(); n > 0; n--) {
          const name = r.string()
          object[name] = r.int()
        }
        player[key] = object
      } else throw new CorruptDataError(`Unknown player value type ${type}`)
    }
    return player
  },
}

// anecdotes: flags (bit 0 = has `r`, bit 1 = has `w`), the entry count, the
// id column (already delta-coded in the value), states, finish counts, the
// areas, then `r` and `w` when present. Every number is unsigned.

const HAS_REWARD = 1
const HAS_WISH = 2

const anecdotesLayout: Layout = {
  variants: [0],
  encode(w, { value, delta }) {
    if (delta) throw new TypeError('Anecdotes have no deltas')
    const v = fields(value, ['i', 's', 'c', 'a', 'r', 'w'], ['r', 'w'])
    const ids = array(v.i)
    const states = array(v.s)
    const counts = array(v.c)
    const areas = array(v.a)
    if (states.length !== ids.length || counts.length !== ids.length) {
      throw new RangeError('Columns differ in length')
    }
    const reward = v.r === undefined ? null : array(v.r)
    const wish = v.w === undefined ? null : array(v.w)
    if (reward && reward.length !== 3) throw new RangeError('Not a [index, progress, target]')
    if (wish && wish.length !== 2) throw new RangeError('Not a [npc, time]')
    w.byte((reward ? HAS_REWARD : 0) | (wish ? HAS_WISH : 0)).uint(ids.length)
    for (const id of ids) w.uint(uint(id))
    for (const state of states) w.uint(uint(state))
    for (const count of counts) w.uint(uint(count))
    w.uint(areas.length)
    for (const area of areas) w.uint(uint(area))
    for (const n of reward ?? []) w.uint(uint(n))
    for (const n of wish ?? []) w.uint(uint(n))
  },
  decode(r) {
    const flags = r.byte()
    if ((flags & ~(HAS_REWARD | HAS_WISH)) !== 0) {
      throw new CorruptDataError(`Unknown anecdotes flags ${flags}`)
    }
    const count = r.uint()
    if (count > r.remaining) throw new CorruptDataError('Count past the data')
    const column = (n: number) => {
      const out: number[] = []
      for (let k = 0; k < n; k++) out.push(r.uint())
      return out
    }
    const i = column(count)
    const s = column(count)
    const c = column(count)
    const areaCount = r.uint()
    if (areaCount > r.remaining) throw new CorruptDataError('Count past the data')
    const a = column(areaCount)
    const section: Record<string, unknown> = { i, s, c, a }
    if (flags & HAS_REWARD) section.r = column(3)
    if (flags & HAS_WISH) section.w = column(2)
    return section
  },
}

// tasks: flags (bit 0 = `c`, 1 = `a`, 2 = `e`, 3 = `r`, 4 = `w`), then each
// present part in that order: `c` and `r` as two numbers, `a` as start,
// end - start, stars, maxStars, `e` as the count then per expedition the
// character (a string), id, start, hours and doneAt - start, `w` as one
// number. Every number is unsigned.

const TASK_PARTS = ['c', 'a', 'e', 'r', 'w'] as const

// tasks v2 (2026-11-09, docs/plans/storage-efficiency.md phase 4): the parts
// Capture added later (`t p n q m k i s f x`) made every tasks section JSON
// on every snapshot. A section the first layout cannot hold is written as
// TASKS_V2 (a byte the deployed builds' decoder refuses, so the server sends
// those builds JSON instead: worker/services/export.ts), then a bit per
// present part (TASK_PARTS_V2 order, the section's own key order), then each
// part. Times are written as the zigzag difference from the time before
// (in that order), so a section's many nearby timestamps take a byte or two.

const TASKS_V2 = 0xf0
const TASK_PARTS_V2 = [
  'c',
  't',
  'a',
  'e',
  'r',
  'w',
  'p',
  'n',
  'q',
  'm',
  'k',
  'i',
  's',
  'f',
  'x',
] as const

function encodeTasksV2(w: ByteWriter, value: unknown): void {
  const v = fields(value, TASK_PARTS_V2, TASK_PARTS_V2)
  let present = 0
  TASK_PARTS_V2.forEach((part, bit) => {
    if (v[part] !== undefined) present |= 1 << bit
  })
  w.byte(TASKS_V2).uint(present)
  let previous = 0
  const time = (t: unknown) => {
    const at = int(t)
    w.int(at - previous)
    previous = at
  }
  const cells = (part: unknown, n: number) => {
    const values = array(part)
    if (values.length !== n) throw new RangeError(`Not ${n} values`)
    return values
  }
  const idList = (list: unknown[], each: (row: unknown[]) => void) => {
    w.uint(list.length)
    let id = 0
    for (const entry of list) {
      const row = array(entry)
      w.int(int(row[0]) - id)
      id = int(row[0])
      each(row)
    }
  }
  if (v.c !== undefined) for (const n of cells(v.c, 2)) w.uint(uint(n))
  if (v.t !== undefined) w.uint(uint(v.t))
  if (v.a !== undefined) {
    const [start, end, stars, maxStars] = cells(v.a, 4)
    time(start)
    time(end)
    w.uint(uint(stars)).uint(uint(maxStars))
  }
  if (v.e !== undefined) {
    const list = array(v.e)
    w.uint(list.length)
    for (const entry of list) {
      const [character, id, start, hours, doneAt] = cells(entry, 5)
      if (typeof character !== 'string') throw new TypeError('Not an expedition')
      w.string(character).uint(uint(id))
      time(start)
      w.uint(uint(hours))
      time(doneAt)
    }
  }
  if (v.r !== undefined) for (const n of cells(v.r, 2)) w.uint(uint(n))
  if (v.w !== undefined) w.uint(uint(v.w))
  if (v.p !== undefined) {
    const [weapon, points, max] = cells(v.p, 3)
    if (typeof weapon !== 'string') throw new TypeError('Not a weapon key')
    w.string(weapon).uint(uint(points)).uint(uint(max))
  }
  if (v.n !== undefined) {
    const [resin, nextAt] = cells(v.n, 2)
    w.uint(uint(resin))
    time(nextAt)
  }
  if (v.q !== undefined) {
    const values = array(v.q)
    if (values.length !== 4 && values.length !== 5) throw new RangeError('Not 4 or 5 values')
    w.uint(values.length)
    for (const n of values) w.uint(uint(n))
  }
  if (v.m !== undefined) {
    idList(array(v.m), (row) => {
      if (row.length !== 2) throw new TypeError('Not a respawn row')
      const times = array(row[1])
      w.uint(times.length)
      for (const t of times) time(t)
    })
  }
  if (v.k !== undefined) {
    const list = array(v.k)
    w.uint(list.length)
    let k = 0
    for (const n of list) {
      w.int(int(n) - k)
      k = int(n)
    }
  }
  if (v.i !== undefined) {
    idList(array(v.i), (row) => {
      if (row.length !== 6) throw new TypeError('Not a sign-in row')
      const claimed = array(row[2])
      w.uint(uint(row[1])).uint(claimed.length)
      for (const day of claimed) w.uint(uint(day))
      time(row[3])
      time(row[4])
      time(row[5])
    })
  }
  if (v.s !== undefined) {
    const [spent, day, at] = cells(v.s, 3)
    w.uint(uint(spent)).uint(uint(day))
    time(at)
  }
  if (v.f !== undefined) {
    const [at, bought, fates] = cells(v.f, 3)
    time(at)
    w.uint(uint(bought))
    const list = array(fates)
    w.uint(list.length)
    for (const entry of list) {
      const [item, currency, cost, count, limit] = cells(entry, 5)
      if (typeof item !== 'string' || typeof currency !== 'string') {
        throw new TypeError('Not a bargain')
      }
      w.string(item).string(currency).uint(uint(cost)).uint(uint(count)).uint(uint(limit))
    }
  }
  if (v.x !== undefined) {
    const [usedAt, readyAt] = cells(v.x, 2)
    time(usedAt)
    time(readyAt)
  }
}

function decodeTasksV2(r: ByteReader): Record<string, unknown> {
  const present = r.uint()
  if (present >= 1 << TASK_PARTS_V2.length) {
    throw new CorruptDataError(`Unknown tasks parts ${present}`)
  }
  const has = (part: (typeof TASK_PARTS_V2)[number]) =>
    (present & (1 << TASK_PARTS_V2.indexOf(part))) !== 0
  let previous = 0
  const time = () => (previous += r.int())
  const count = () => {
    const n = r.uint()
    if (n > r.remaining) throw new CorruptDataError('Count past the data')
    return n
  }
  const idList = <T>(each: (id: number) => T): T[] => {
    const out: T[] = []
    let id = 0
    for (let n = count(); n > 0; n--) out.push(each((id += r.int())))
    return out
  }
  const section: Record<string, unknown> = {}
  if (has('c')) section.c = [r.uint(), r.uint()]
  if (has('t')) section.t = r.uint()
  if (has('a')) {
    const start = time()
    const end = time()
    section.a = [start, end, r.uint(), r.uint()]
  }
  if (has('e')) {
    const e: unknown[] = []
    for (let n = count(); n > 0; n--) {
      const character = r.string()
      const id = r.uint()
      const start = time()
      const hours = r.uint()
      e.push([character, id, start, hours, time()])
    }
    section.e = e
  }
  if (has('r')) section.r = [r.uint(), r.uint()]
  if (has('w')) section.w = r.uint()
  if (has('p')) section.p = [r.string(), r.uint(), r.uint()]
  if (has('n')) {
    const resin = r.uint()
    section.n = [resin, time()]
  }
  if (has('q')) {
    const n = r.uint()
    if (n !== 4 && n !== 5) throw new CorruptDataError('Not 4 or 5 weekly boss values')
    section.q = Array.from({ length: n }, () => r.uint())
  }
  if (has('m')) {
    section.m = idList((id) => {
      const times: number[] = []
      for (let n = count(); n > 0; n--) times.push(time())
      return [id, times]
    })
  }
  if (has('k')) {
    const k: number[] = []
    let at = 0
    for (let n = count(); n > 0; n--) k.push((at += r.int()))
    section.k = k
  }
  if (has('i')) {
    section.i = idList((id) => {
      const days = r.uint()
      const claimed: number[] = []
      for (let n = count(); n > 0; n--) claimed.push(r.uint())
      const lastAt = time()
      const start = time()
      return [id, days, claimed, lastAt, start, time()]
    })
  }
  if (has('s')) {
    const spent = r.uint()
    const day = r.uint()
    section.s = [spent, day, time()]
  }
  if (has('f')) {
    const at = time()
    const bought = r.uint()
    const fates: unknown[] = []
    for (let n = count(); n > 0; n--) {
      fates.push([r.string(), r.string(), r.uint(), r.uint(), r.uint()])
    }
    section.f = [at, bought, fates]
  }
  if (has('x')) {
    const usedAt = time()
    section.x = [usedAt, time()]
  }
  return section
}

/** True when a player payload (layout bytes, no format byte) is the v2 form. */
export function isPlayerV2(data: Uint8Array): boolean {
  try {
    return new ByteReader(data).uint() === PLAYER_V2
  } catch {
    return false
  }
}

/** True when a tasks payload (layout bytes, no format byte) is the v2 form. */
export function isTasksV2(data: Uint8Array): boolean {
  return data.length > 0 && data[0] === TASKS_V2
}

const tasksLayout: Layout = {
  variants: [0],
  encode(w, { value, delta }) {
    if (delta) throw new TypeError('Tasks have no deltas')
    // The first layout while it holds the section (every deployed build reads it).
    if (
      value === null ||
      typeof value !== 'object' ||
      Object.keys(value).some((key) => !(TASK_PARTS as readonly string[]).includes(key))
    ) {
      encodeTasksV2(w, value)
      return
    }
    const v = fields(value, TASK_PARTS, TASK_PARTS)
    let flags = 0
    TASK_PARTS.forEach((part, bit) => {
      if (v[part] !== undefined) flags |= 1 << bit
    })
    w.byte(flags)
    const fixed = (part: unknown, n: number) => {
      const values = array(part)
      if (values.length !== n) throw new RangeError(`Not ${n} numbers`)
      return values.map(uint)
    }
    if (v.c !== undefined) for (const n of fixed(v.c, 2)) w.uint(n)
    if (v.a !== undefined) {
      const [start, end, stars, maxStars] = fixed(v.a, 4) as [number, number, number, number]
      w.uint(start)
        .uint(uint(end - start))
        .uint(stars)
        .uint(maxStars)
    }
    if (v.e !== undefined) {
      const list = array(v.e)
      w.uint(list.length)
      for (const entry of list) {
        const [character, id, start, hours, doneAt] = array(entry)
        if (array(entry).length !== 5 || typeof character !== 'string') {
          throw new TypeError('Not an expedition')
        }
        w.string(character).uint(uint(id)).uint(uint(start)).uint(uint(hours))
        w.uint(uint(uint(doneAt) - uint(start)))
      }
    }
    if (v.r !== undefined) for (const n of fixed(v.r, 2)) w.uint(n)
    if (v.w !== undefined) w.uint(uint(v.w))
  },
  decode(r) {
    const flags = r.byte()
    if (flags === TASKS_V2) return decodeTasksV2(r)
    if (flags >= 1 << TASK_PARTS.length) throw new CorruptDataError(`Unknown tasks flags ${flags}`)
    const section: Record<string, unknown> = {}
    if (flags & 1) section.c = [r.uint(), r.uint()]
    if (flags & 2) {
      const start = r.uint()
      section.a = [start, start + r.uint(), r.uint(), r.uint()]
    }
    if (flags & 4) {
      const count = r.uint()
      if (count > r.remaining) throw new CorruptDataError('Count past the data')
      const e: unknown[] = []
      for (let n = 0; n < count; n++) {
        const character = r.string()
        const id = r.uint()
        const start = r.uint()
        const hours = r.uint()
        e.push([character, id, start, hours, start + r.uint()])
      }
      section.e = e
    }
    if (flags & 8) section.r = [r.uint(), r.uint()]
    if (flags & 16) section.w = r.uint()
    return section
  },
}

// collections: flags (bit 0 = `s`), then each present part in that order:
// `s` as the count then the ids ascending, the first as is and each next as
// its distance from the one before (at least 1). A part this layout does not
// know makes the encoder throw, so such a section is stored as JSON.
//
// This layout is what the deployed builds decode, and their decoder refuses
// any other flag, so it never learns a part: every later part (`a`, `d`, `h`,
// `r`, `g`, Capture 1.4.0) makes the section JSON, which every build reads.
// The JSON of thousands of codex ids deflates to a few bytes each, and a
// changed section is compressed against the last one (store-v2), so a few
// more defeats still cost a few bytes.

const COLLECTION_PARTS = ['s'] as const

const collectionsLayout: Layout = {
  variants: [0],
  encode(w, { value, delta }) {
    if (delta) throw new TypeError('Collections have no deltas')
    const v = fields(value, COLLECTION_PARTS, COLLECTION_PARTS)
    let flags = 0
    COLLECTION_PARTS.forEach((part, bit) => {
      if (v[part] !== undefined) flags |= 1 << bit
    })
    w.byte(flags)
    if (v.s !== undefined) {
      const ids = array(v.s).map(uint)
      w.uint(ids.length)
      let previous = -1
      for (const id of ids) {
        if (id <= previous) throw new RangeError('Not ascending')
        w.uint(previous < 0 ? id : id - previous)
        previous = id
      }
    }
  },
  decode(r) {
    const flags = r.byte()
    if (flags >= 1 << COLLECTION_PARTS.length) {
      throw new CorruptDataError(`Unknown collections flags ${flags}`)
    }
    const section: Record<string, unknown> = {}
    if (flags & 1) {
      const count = r.uint()
      if (count > r.remaining) throw new CorruptDataError('Count past the data')
      const s: number[] = []
      let previous = 0
      for (let n = 0; n < count; n++) {
        previous = n === 0 ? r.uint() : previous + r.uint()
        s.push(previous)
      }
      section.s = s
    }
    return section
  },
}

// ------------------------------------------- helpers for the layouts below

/** A row of exactly `n` cells. */
function row(value: unknown, n: number): unknown[] {
  const cells = array(value)
  if (cells.length !== n) throw new TypeError(`Not a row of ${n}`)
  return cells
}

function writeAscending(w: ByteWriter, ids: readonly number[]): void {
  w.uint(ids.length)
  let previous = -1
  for (const id of ids) {
    if (id <= previous) throw new RangeError('Not ascending')
    w.uint(previous < 0 ? id : id - previous)
    previous = id
  }
}

function checkedCount(r: ByteReader): number {
  const count = r.uint()
  if (count > r.remaining) throw new CorruptDataError('Count past the data')
  return count
}

/** Reads `count` rows whose first cell is an ascending id stored as a distance. */
function readById<T>(r: ByteReader, count: number, rest: (id: number) => T): T[] {
  const out: T[] = []
  let previous = 0
  for (let n = 0; n < count; n++) {
    previous = n === 0 ? r.uint() : previous + r.uint()
    out.push(rest(previous))
  }
  return out
}

function readAscending(r: ByteReader): number[] {
  return readById(r, checkedCount(r), (id) => id)
}

/** Rows sorted by their first cell (an id), the ids as distances, then `cells` per row. */
function writeById(w: ByteWriter, rows: unknown, n: number, cells: (row: unknown[]) => void) {
  const list = array(rows).map((entry) => row(entry, n))
  w.uint(list.length)
  let previous = -1
  for (const entry of list) {
    const id = uint(entry[0])
    if (id <= previous) throw new RangeError('Not ascending')
    w.uint(previous < 0 ? id : id - previous)
    previous = id
    cells(entry)
  }
}

function uintList(w: ByteWriter, value: unknown): void {
  const list = array(value).map(uint)
  w.uint(list.length)
  for (const n of list) w.uint(n)
}

function readUintList(r: ByteReader): number[] {
  const count = checkedCount(r)
  return Array.from({ length: count }, () => r.uint())
}

// ------------------------------------------------------------ tagged parts
// collections2, wardrobe, exploration and progress are tagged layouts: each present part is written
// as its index in the layout's part list (append-only), its byte length and
// its bytes, in list order. A decoder skips a part whose index it does not
// know, so a part a later build adds never makes an older build refuse the
// section: it reads the parts it knows. A part this build's encoder does not
// know (a key it has no index for) makes it throw, so that section is stored
// as JSON instead.

interface TaggedPart {
  write(w: ByteWriter, value: unknown): void
  read(r: ByteReader): unknown
}

function taggedLayout(what: string, parts: readonly (readonly [string, TaggedPart])[]): Layout {
  const keys = parts.map(([key]) => key)
  return {
    variants: [0],
    encode(w, { value, delta }) {
      if (delta) throw new TypeError(`${what} has no deltas`)
      const v = fields(value, keys, keys)
      parts.forEach(([key, part], index) => {
        if (v[key] === undefined) return
        const body = new ByteWriter()
        part.write(body, v[key])
        const bytes = body.finish()
        w.uint(index).uint(bytes.length).bytes(bytes)
      })
    },
    decode(r) {
      const section: Record<string, unknown> = {}
      let last = -1
      while (!r.done) {
        const index = r.uint()
        const bytes = r.bytes(r.uint())
        if (index <= last) throw new CorruptDataError(`${what} parts out of order`)
        last = index
        const part = parts[index]
        if (!part) continue // written by a later build
        const body = new ByteReader(bytes)
        section[part[0]] = part[1].read(body)
        if (!body.done) throw new CorruptDataError(`${what} part ${part[0]} has bytes left`)
      }
      return section
    },
  }
}

// collections2 (gi_collections' parts from Capture 1.4.0 on). Ids sorted
// ascending are stored as distances (see writeAscending); every number is
// unsigned.
// `a`: a byte of tab flags (ARCHIVE_TABS order), then each present tab's
// ascending list. `d`: the count, then per row the id, defeated, captured.
// `h`: chapters (count; id, progress, total, state), then targets (count;
// quest id, chapter, progress, total, state). `r`: the count, then per row
// type, id, state. `g`: a byte of flags (bit 0 = `k`, 1 = `u`), the cards
// (count; id, count, proficiency), the decks (count; id, name (a string),
// valid, the character cards and the cards, each count + ids as they are),
// then the current deck.

const archivePart: TaggedPart = {
  write(w, value) {
    const a = fields(value, ARCHIVE_TABS, ARCHIVE_TABS)
    let tabs = 0
    ARCHIVE_TABS.forEach((tab, bit) => {
      if (a[tab] !== undefined) tabs |= 1 << bit
    })
    w.byte(tabs)
    for (const tab of ARCHIVE_TABS) {
      if (a[tab] !== undefined) writeAscending(w, array(a[tab]).map(uint))
    }
  },
  read(r) {
    const tabs = r.byte()
    const a: Record<string, number[]> = {}
    ARCHIVE_TABS.forEach((tab, bit) => {
      if (tabs & (1 << bit)) a[tab] = readAscending(r)
    })
    return a
  },
}

const defeatsPart: TaggedPart = {
  write(w, value) {
    writeById(w, value, 3, ([, defeated, captured]) => w.uint(uint(defeated)).uint(uint(captured)))
  },
  read: (r) => readById(r, checkedCount(r), (id) => [id, r.uint(), r.uint()]),
}

const handbookPart: TaggedPart = {
  write(w, value) {
    const h = fields(value, ['c', 't'])
    writeById(w, h.c, 4, ([, progress, total, state]) => {
      w.uint(uint(progress)).uint(uint(total)).uint(uint(state))
    })
    writeById(w, h.t, 5, ([, chapter, progress, total, state]) => {
      w.uint(uint(chapter)).uint(uint(progress)).uint(uint(total)).uint(uint(state))
    })
  },
  read(r) {
    const c = readById(r, checkedCount(r), (id) => [id, r.uint(), r.uint(), r.uint()])
    const t = readById(r, checkedCount(r), (id) => [id, r.uint(), r.uint(), r.uint(), r.uint()])
    return { c, t }
  },
}

const aranaraPart: TaggedPart = {
  write(w, value) {
    const rows = array(value).map((entry) => row(entry, 3).map(uint))
    w.uint(rows.length)
    for (const [type, id, state] of rows) w.uint(type!).uint(id!).uint(state!)
  },
  read(r) {
    const count = checkedCount(r)
    return Array.from({ length: count }, () => [r.uint(), r.uint(), r.uint()])
  },
}

const tcgPart: TaggedPart = {
  write(w, value) {
    const g = fields(value, ['c', 'k', 'u'], ['k', 'u'])
    w.byte((g.k !== undefined ? 1 : 0) | (g.u !== undefined ? 2 : 0))
    writeById(w, g.c, 3, ([, count, proficiency]) => w.uint(uint(count)).uint(uint(proficiency)))
    if (g.k !== undefined) {
      writeById(w, g.k, 5, ([, name, valid, characters, cards]) => {
        if (typeof name !== 'string') throw new TypeError('Not a deck name')
        w.string(name).uint(uint(valid))
        uintList(w, characters)
        uintList(w, cards)
      })
    }
    if (g.u !== undefined) w.uint(uint(g.u))
  },
  read(r) {
    const parts = r.byte()
    if (parts >= 4) throw new CorruptDataError(`Unknown TCG flags ${parts}`)
    const g: Record<string, unknown> = {
      c: readById(r, checkedCount(r), (id) => [id, r.uint(), r.uint()]),
    }
    if (parts & 1) {
      g.k = readById(r, checkedCount(r), (id) => [
        id,
        r.string(),
        r.uint(),
        readUintList(r),
        readUintList(r),
      ])
    }
    if (parts & 2) g.u = r.uint()
    return g
  },
}

// `p`: recipes (rows by id: proficiency).
const recipesPart: TaggedPart = {
  write: (w, value) => writeById(w, value, 2, ([, proficiency]) => w.uint(uint(proficiency))),
  read: (r) => readById(r, checkedCount(r), (id) => [id, r.uint()]),
}

// Capture 1.7.0's parts: `u` Hangout chapters (rows by id: state, endings
// (rows by id: state), pictures (an ascending list), pictures in all); `m`
// monsters seen and `f` blueprints (ascending lists; `b` is the delta base's key).
const hangoutsPart: TaggedPart = {
  write(w, value) {
    writeById(w, value, 5, ([, state, endings, pictures, total]) => {
      w.uint(uint(state))
      writeById(w, endings, 2, ([, s]) => w.uint(uint(s)))
      writeAscending(w, array(pictures).map(uint))
      w.uint(uint(total))
    })
  },
  read: (r) =>
    readById(r, checkedCount(r), (id) => [
      id,
      r.uint(),
      readById(r, checkedCount(r), (e) => [e, r.uint()]),
      readAscending(r),
      r.uint(),
    ]),
}

const ascendingPart: TaggedPart = {
  write: (w, value) => writeAscending(w, array(value).map(uint)),
  read: (r) => readAscending(r),
}

// Capture 1.8.0-1.11.0's parts: `k` recipes unlocked (a byte of flags c/f/p,
// then each present ascending list); `v` the TCG's later parts (flags l/s/t;
// rows by id of ascending lists, an ascending list); `y` the music game
// (rows by id: score + 1, claimed); `e`, `o`, `n` ascending lists.
const idListRows = {
  write: (w: ByteWriter, value: unknown) =>
    writeById(w, value, 2, ([, list]) => writeAscending(w, array(list).map(uint))),
  read: (r: ByteReader) => readById(r, checkedCount(r), (id) => [id, readAscending(r)]),
}

function flaggedLists(letters: readonly string[], kinds: readonly ('list' | 'rows')[]): TaggedPart {
  return {
    write(w, value) {
      const v = fields(value, letters, letters)
      let flags = 0
      letters.forEach((letter, bit) => {
        if (v[letter] !== undefined) flags |= 1 << bit
      })
      w.byte(flags)
      letters.forEach((letter, i) => {
        if (v[letter] === undefined) return
        if (kinds[i] === 'rows') idListRows.write(w, v[letter])
        else writeAscending(w, array(v[letter]).map(uint))
      })
    },
    read(r) {
      const flags = r.byte()
      const out: Record<string, unknown> = {}
      letters.forEach((letter, bit) => {
        if (!(flags & (1 << bit))) return
        out[letter] = kinds[bit] === 'rows' ? idListRows.read(r) : readAscending(r)
      })
      return out
    },
  }
}

const musicPart: TaggedPart = {
  write: (w, value) =>
    writeById(w, value, 3, ([, score, claimed]) => w.uint(uint(score)).uint(uint(claimed))),
  read: (r) => readById(r, checkedCount(r), (id) => [id, r.uint(), r.uint()]),
}

/** collections2's parts, by index (append-only). */
const COLLECTION2_PARTS: readonly (readonly [string, TaggedPart])[] = [
  ['a', archivePart],
  ['d', defeatsPart],
  ['h', handbookPart],
  ['r', aranaraPart],
  ['g', tcgPart],
  ['p', recipesPart],
  ['u', hangoutsPart],
  ['m', ascendingPart],
  ['f', ascendingPart],
  ['k', flaggedLists(['c', 'f', 'p'], ['list', 'list', 'list'])],
  ['v', flaggedLists(['l', 's', 't'], ['rows', 'list', 'rows'])],
  ['y', musicPart],
  ['e', ascendingPart],
  ['o', ascendingPart],
  ['n', ascendingPart],
  ['q', flaggedLists(['f', 'a'], ['list', 'list'])],
]

const collections2Layout = taggedLayout('collections2', COLLECTION2_PARTS)

// wardrobe: `o`, `g`, `s`, `t` (outfits, gliders, weapon skins, trails) each
// a byte (bit 0 = `e`), its owned ids (an ascending list), who wears what
// (count; character key (a string), id), then the expiries (rows by id: id,
// time); `m`: teams (rows by slot: name, character keys as count + strings);
// `c`: the team in use.

const wardrobeKindPart: TaggedPart = {
  write(w, value) {
    const kind = fields(value, ['o', 'w', 'e'], ['e'])
    w.byte(kind.e !== undefined ? 1 : 0)
    writeAscending(w, array(kind.o).map(uint))
    const worn = array(kind.w).map((entry) => row(entry, 2))
    w.uint(worn.length)
    for (const [key, id] of worn) {
      if (typeof key !== 'string') throw new TypeError('Not a character key')
      w.string(key).uint(uint(id))
    }
    if (kind.e !== undefined) writeById(w, kind.e, 2, ([, at]) => w.uint(uint(at)))
  },
  read(r) {
    const parts = r.byte()
    if (parts >= 2) throw new CorruptDataError(`Unknown wardrobe kind flags ${parts}`)
    const kind: Record<string, unknown> = { o: readAscending(r) }
    const count = checkedCount(r)
    kind.w = Array.from({ length: count }, () => [r.string(), r.uint()])
    if (parts & 1) kind.e = readById(r, checkedCount(r), (id) => [id, r.uint()])
    return kind
  },
}

const teamsPart: TaggedPart = {
  write(w, value) {
    writeById(w, value, 3, ([, name, characters]) => {
      if (typeof name !== 'string') throw new TypeError('Not a team name')
      const keys = array(characters)
      w.string(name).uint(keys.length)
      for (const key of keys) {
        if (typeof key !== 'string') throw new TypeError('Not a character key')
        w.string(key)
      }
    })
  },
  read: (r) =>
    readById(r, checkedCount(r), (slot) => {
      const name = r.string()
      const count = checkedCount(r)
      return [slot, name, Array.from({ length: count }, () => r.string())]
    }),
}

const numberPart: TaggedPart = {
  write: (w, value) => void w.uint(uint(value)),
  read: (r) => r.uint(),
}

/** wardrobe's parts, by index (append-only). */
const WARDROBE_PARTS: readonly (readonly [string, TaggedPart])[] = [
  ['o', wardrobeKindPart],
  ['g', wardrobeKindPart],
  ['s', wardrobeKindPart],
  ['t', wardrobeKindPart],
  ['m', teamsPart],
  ['c', numberPart],
]

const wardrobeLayout = taggedLayout('wardrobe', WARDROBE_PARTS)

// exploration: `s` Statues (rows by city: level, Oculi), `f` offerings and
// `x` exploration points and `r` reputation (rows by id: the number), `p`
// scenes (rows by scene: the map points, then the areas, each an ascending
// list).

const levelsPart: TaggedPart = {
  write: (w, value) => writeById(w, value, 2, ([, n]) => w.uint(uint(n))),
  read: (r) => readById(r, checkedCount(r), (id) => [id, r.uint()]),
}

const statuesPart: TaggedPart = {
  write: (w, value) =>
    writeById(w, value, 3, ([, level, oculi]) => w.uint(uint(level)).uint(uint(oculi))),
  read: (r) => readById(r, checkedCount(r), (id) => [id, r.uint(), r.uint()]),
}

const scenesPart: TaggedPart = {
  write(w, value) {
    writeById(w, value, 3, ([, points, areas]) => {
      writeAscending(w, array(points).map(uint))
      writeAscending(w, array(areas).map(uint))
    })
  },
  read: (r) => readById(r, checkedCount(r), (id) => [id, readAscending(r), readAscending(r)]),
}

/** exploration's parts, by index (append-only). */
const EXPLORATION_PARTS: readonly (readonly [string, TaggedPart])[] = [
  ['s', statuesPart],
  ['f', levelsPart],
  ['p', scenesPart],
  ['x', levelsPart],
  ['r', levelsPart],
  ['d', ascendingPart],
  ['t', statuesPart],
]

const explorationLayout = taggedLayout('exploration', EXPLORATION_PARTS)

// progress (Capture 1.7.0): `a` achievement progress (rows by id: progress,
// total); `e` events (rows by id: schedule, start, end, counters (rows by
// watcher: progress, total, claimed)).
const achievementProgressPart: TaggedPart = {
  write: (w, value) =>
    writeById(w, value, 3, ([, progress, total]) => w.uint(uint(progress)).uint(uint(total))),
  read: (r) => readById(r, checkedCount(r), (id) => [id, r.uint(), r.uint()]),
}

const eventsPart: TaggedPart = {
  write(w, value) {
    writeById(w, value, 5, ([, schedule, start, end, counters]) => {
      w.uint(uint(schedule)).uint(uint(start)).uint(uint(end))
      writeById(w, counters, 4, ([, progress, total, claimed]) => {
        w.uint(uint(progress)).uint(uint(total)).uint(uint(claimed))
      })
    })
  },
  read: (r) =>
    readById(r, checkedCount(r), (id) => [
      id,
      r.uint(),
      r.uint(),
      r.uint(),
      readById(r, checkedCount(r), (wid) => [wid, r.uint(), r.uint(), r.uint()]),
    ]),
}

const progressLayout = taggedLayout('progress', [
  ['a', achievementProgressPart],
  ['e', eventsPart],
])

// extras (Capture 1.8.0+): `t` the Serenitea Pot's comfort (rows by realm:
// mansion, the blocks as count + numbers); `m` Miliastra cosmetics (rows by id: time).
const comfortPart: TaggedPart = {
  write: (w, value) =>
    writeById(w, value, 3, ([, mansion, blocks]) => {
      w.uint(uint(mansion))
      uintList(w, blocks)
    }),
  read: (r) => readById(r, checkedCount(r), (id) => [id, r.uint(), readUintList(r)]),
}

// `e` gi_endgame (Capture 1.17.12): a byte of flags (bit 0 = `t`, 1 = `s`,
// 2 = `r`, 3 = `x`, 4 = the records carry Capture 1.17.20's players); `t` the
// Theater run's four numbers; `r` the run's two star numbers; `x` the starred
// acts as count + numbers; `s` the records as count, then per record season,
// difficulty, at, co-op, (with bit 4) a byte, 1 when the players follow, and
// then each player's position, you, picture and nickname; fights as count,
// then per fight time, done, the team as count + KeyRef cells (no delta: a
// team is unordered), a byte of figure flags (bit 0 strike, 1 damage, 2 the
// players' teams follow) and each present figure's value + its character as a
// KeyRef cell (0: none), then the teams as count + per team its position and
// members as count + [KeyRef cell, level, constellation + 1]; `a` (bit 5,
// Capture 1.17.21) the Abyss record book as count, then per period season,
// floor, chamber, stars, a byte of figure flags (bit i = the i-th of the
// five figures) and each present figure's value + its character as a KeyRef
// cell (0: none), then the picks as count + [KeyRef cell, times]. The keys
// keep the encoder's order (t, r, x, s, a): blobs written before `r` hold
// `t`/`s` only.
const ENDGAME_KEYS = ['t', 'r', 'x', 's', 'a'] as const

const endgamePart: TaggedPart = {
  write(w, value) {
    const v = fields(value, ENDGAME_KEYS, ENDGAME_KEYS)
    const records = v.s === undefined ? [] : array(v.s)
    const withPlayers = records.some((record) => array(record).length === 6)
    w.byte(
      (v.t !== undefined ? 1 : 0) |
        (v.s !== undefined ? 2 : 0) |
        (v.r !== undefined ? 4 : 0) |
        (v.x !== undefined ? 8 : 0) |
        (withPlayers ? 16 : 0) |
        (v.a !== undefined ? 32 : 0),
    )
    if (v.t !== undefined) for (const n of row(v.t, 4)) w.uint(uint(n))
    if (v.r !== undefined) for (const n of row(v.r, 2)) w.uint(uint(n))
    if (v.x !== undefined) uintList(w, array(v.x) as number[])
    if (v.s !== undefined) {
      w.uint(records.length)
      for (const record of records) {
        const cells = array(record)
        if (cells.length !== 5 && cells.length !== 6) throw new TypeError('Not a record')
        const [season, difficulty, at, coop, fights, players] = cells
        w.uint(uint(season)).uint(uint(difficulty)).uint(uint(at)).uint(uint(coop))
        if (withPlayers) {
          w.byte(players === undefined ? 0 : 1)
          if (players !== undefined) {
            const list = array(players)
            w.uint(list.length)
            for (const player of list) {
              const [p, self, picture, nickname] = row(player, 4)
              if (typeof nickname !== 'string') throw new TypeError('Not a nickname')
              w.uint(uint(p)).uint(uint(self)).uint(uint(picture)).string(nickname)
            }
          }
        }
        const list = array(fights)
        w.uint(list.length)
        for (const fight of list) {
          const fightCells = array(fight)
          if (fightCells.length !== 3 && fightCells.length !== 5 && fightCells.length !== 6) {
            throw new TypeError('Not a fight')
          }
          const [time, done, team, strike, damage, teams] = fightCells
          w.uint(uint(time)).uint(uint(done))
          const keys = array(team) as KeyRef[]
          w.uint(keys.length)
          for (const key of keys) writeRef(w, key, 0)
          const figures = [strike, damage].map((f) =>
            f === 0 || f === undefined ? null : row(f, 2),
          )
          // A six-cell fight writes its figures even when both are 0; the
          // bit tells a five-cell fight with no figures from a three-cell one.
          w.byte(
            (figures[0] ? 1 : 0) |
              (figures[1] ? 2 : 0) |
              (teams !== undefined ? 4 : 0) |
              (fightCells.length === 5 && !figures[0] && !figures[1] ? 8 : 0),
          )
          for (const figure of figures) {
            if (!figure) continue
            w.uint(uint(figure[0]))
            writeRef(w, figure[1] as KeyRef, 0)
          }
          if (teams !== undefined) {
            const teamRows = array(teams)
            w.uint(teamRows.length)
            for (const teamRow of teamRows) {
              const [p, members] = row(teamRow, 2)
              const memberRows = array(members)
              w.uint(uint(p)).uint(memberRows.length)
              for (const member of memberRows) {
                const [ref, level, constellation] = row(member, 3)
                writeRef(w, ref as KeyRef, 0)
                w.uint(uint(level)).uint(uint(constellation))
              }
            }
          }
        }
      }
    }
    if (v.a !== undefined) {
      const periods = array(v.a)
      w.uint(periods.length)
      for (const period of periods) {
        const [season, floor, chamber, stars, figures, picked] = row(period, 6)
        w.uint(uint(season)).uint(uint(floor)).uint(uint(chamber)).uint(uint(stars))
        const cells = row(figures, 5).map((f) => (f === 0 ? null : row(f, 2)))
        w.byte(cells.reduce((flags, f, i) => flags | (f ? 1 << i : 0), 0))
        for (const figure of cells) {
          if (!figure) continue
          w.uint(uint(figure[0]))
          writeRef(w, figure[1] as KeyRef, 0)
        }
        const picks = array(picked)
        w.uint(picks.length)
        for (const pick of picks) {
          const [ref, times] = row(pick, 2)
          writeRef(w, ref as KeyRef, 0)
          w.uint(uint(times))
        }
      }
    }
  },
  read(r) {
    const flags = r.byte()
    if (flags >= 64) throw new CorruptDataError(`Unknown endgame flags ${flags}`)
    const section: Record<string, unknown> = {}
    if (flags & 1) section.t = [r.uint(), r.uint(), r.uint(), r.uint()]
    if (flags & 4) section.r = [r.uint(), r.uint()]
    if (flags & 8) section.x = readUintList(r)
    if (flags & 2) {
      section.s = Array.from({ length: checkedCount(r) }, () => {
        const head = [r.uint(), r.uint(), r.uint(), r.uint()]
        let players: unknown[] | undefined
        if (flags & 16) {
          const has = r.byte()
          if (has > 1) throw new CorruptDataError(`Unknown record flags ${has}`)
          if (has) {
            players = Array.from({ length: checkedCount(r) }, () => [
              r.uint(),
              r.uint(),
              r.uint(),
              r.string(),
            ])
          }
        }
        const fights = Array.from({ length: checkedCount(r) }, () => {
          const fight: unknown[] = [
            r.uint(),
            r.uint(),
            Array.from({ length: checkedCount(r) }, () => readRef(r, 0)[0]),
          ]
          const figures = r.byte()
          if (figures >= 16) throw new CorruptDataError(`Unknown fight figures ${figures}`)
          if (figures) {
            for (const bit of [1, 2]) {
              fight.push(figures & bit ? [r.uint(), readRef(r, 0)[0]] : 0)
            }
          }
          if (figures & 4) {
            fight.push(
              Array.from({ length: checkedCount(r) }, () => [
                r.uint(),
                Array.from({ length: checkedCount(r) }, () => [
                  readRef(r, 0)[0],
                  r.uint(),
                  r.uint(),
                ]),
              ]),
            )
          }
          return fight
        })
        return players ? [...head, fights, players] : [...head, fights]
      })
    }
    if (flags & 32) {
      section.a = Array.from({ length: checkedCount(r) }, () => {
        const head = [r.uint(), r.uint(), r.uint(), r.uint()]
        const present = r.byte()
        if (present >= 32) throw new CorruptDataError(`Unknown period figures ${present}`)
        const figures = Array.from({ length: 5 }, (_, i) =>
          present & (1 << i) ? [r.uint(), readRef(r, 0)[0]] : 0,
        )
        const picked = Array.from({ length: checkedCount(r) }, () => [readRef(r, 0)[0], r.uint()])
        return [...head, figures, picked]
      })
    }
    return section
  },
}

const extrasLayout = taggedLayout('extras', [
  ['t', comfortPart],
  ['m', levelsPart],
  ['e', endgamePart],
])

const LAYOUTS: Record<SectionKind, Layout> = {
  characters: rowsLayout,
  weapons: rowsLayout,
  characterExtras: rowsLayout,
  artifacts: artifactsLayout,
  materials: materialsLayout,
  achievements: achievementsLayout,
  achievementTimes: achievementTimesLayout,
  player: playerLayout,
  anecdotes: anecdotesLayout,
  tasks: tasksLayout,
  collections: collectionsLayout,
  collections2: collections2Layout,
  wardrobe: wardrobeLayout,
  exploration: explorationLayout,
  progress: progressLayout,
  extras: extrasLayout,
}

/** Every variant the kind's layout offers, encoded (the caller keeps the smallest). */
export function encodeBinaryVariants(kind: SectionKind, input: BinaryInput): Uint8Array[] {
  const layout = LAYOUTS[kind]
  return layout.variants.map((variant) => {
    const w = new ByteWriter()
    layout.encode(w, input, variant)
    return w.finish()
  })
}

export function decodeBinary(kind: SectionKind, data: Uint8Array, base: string | null): unknown {
  const r = new ByteReader(data)
  const value = LAYOUTS[kind].decode(r, base)
  r.end()
  return value
}

/** True when the binary layout of `kind` records deltas (so a delta's base must be given). */
export function isDeltaBinary(kind: SectionKind, data: Uint8Array): boolean {
  if (kind !== 'artifacts' && kind !== 'materials' && kind !== 'achievementTimes') return false
  return data.length > 0 && (data[0]! & DELTA) !== 0
}
