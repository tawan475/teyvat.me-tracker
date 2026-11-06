/**
 * The artifact catalog in its compact form (storage format v2): artifact
 * identities packed into bytes, many to a chunk, each chunk deflated once.
 *
 * One identity, as written by `packArtifact`:
 *   uint  head      0: the identity follows as JSON (anything the layout
 *                   below cannot hold exactly), else
 *                   1 + slot + 8 * (rarity + 8 * elixirCrafted), where slot
 *                   is its index in SLOT_KEYS (7: spelled out after the head)
 *                   and rarity 0-6 (7: a uint after the head)
 *   [string slot] [uint rarity]
 *   ref   set       index + 1 in ARTIFACT_SETS * 2, or a string (see writeKey)
 *   ref   main stat index + 1 in STAT_KEYS, the same way
 *   uint  level, uint totalRolls
 *   uint  substats count + 8 * unactivated substats count (each at most 7)
 *   then each substat, active ones first:
 *     byte  stat (index in SUBSTAT_KEYS, 15: a string follows)
 *           | value scale << 4 (0: x1, 1: x10, 2: x100, 3: float64)
 *           | initial value << 6 (0: none, 1: equal to the value,
 *                                 2: its own uint at the same scale,
 *                                 3: a float64)
 *     [string stat] value (uint, or 8 bytes float64) [initial value]
 *
 * Values are doubles from JSON; a scale is used only when `n / scale` gives
 * back exactly the same double, so decoding is exact.
 *
 * A chunk (`encodeCatalogChunk`): format byte, then (deflated as one stream
 * when that is smaller) uint count, the catalog ids as zigzag deltas, then
 * each packed identity.
 *
 * A storage format: append to the key lists, add layouts under new format
 * bytes, never change what existing bytes mean.
 */

import type { ArtifactIdentity } from '../artifact'
import type { GoodSubstat } from '../good'
import { ARTIFACT_SETS, STAT_KEYS, SUBSTAT_KEYS, SLOT_KEYS } from '../dictionary/artifacts'
import { ByteReader, ByteWriter, CorruptDataError } from './bytes'
import { deflate, inflate } from './deflate'

const float = new DataView(new ArrayBuffer(8))

function writeFloat(w: ByteWriter, value: number): void {
  float.setFloat64(0, value, true)
  w.bytes(new Uint8Array(float.buffer.slice(0)))
}

function readFloat(r: ByteReader): number {
  const bytes = r.bytes(8)
  for (let i = 0; i < 8; i++) float.setUint8(i, bytes[i]!)
  return float.getFloat64(0, true)
}

const SCALES = [1, 10, 100] as const
const FLOAT_SCALE = 3

/** True when `value` is exactly `n / scale` for a uint n. */
function fitsScale(value: number, scale: number): boolean {
  const factor = SCALES[scale]!
  const n = Math.round(value * factor)
  return Number.isSafeInteger(n) && n >= 0 && n / factor === value && !Object.is(value, -0)
}

/** The smallest scale that holds `value` exactly as a uint, else FLOAT_SCALE. */
function scaleOf(value: number): number {
  for (let i = 0; i < SCALES.length; i++) if (fitsScale(value, i)) return i
  return FLOAT_SCALE
}

function writeScaled(w: ByteWriter, value: number, scale: number): void {
  if (scale === FLOAT_SCALE) writeFloat(w, value)
  else w.uint(Math.round(value * SCALES[scale]!))
}

function readScaled(r: ByteReader, scale: number): number {
  return scale === FLOAT_SCALE ? readFloat(r) : r.uint() / SCALES[scale]!
}

/** A key from `list` as (index + 1) * 2, or an unknown one as length * 2 + 1 and its UTF-8. */
function writeKey(w: ByteWriter, list: readonly string[], key: string): void {
  const index = list.indexOf(key)
  if (index >= 0) w.uint((index + 1) * 2)
  else {
    const bytes = new TextEncoder().encode(key)
    w.uint(bytes.length * 2 + 1).bytes(bytes)
  }
}

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

function readKey(r: ByteReader, list: readonly string[]): string {
  const tag = r.uint()
  if (tag % 2 === 1) {
    try {
      return utf8.decode(r.bytes((tag - 1) / 2))
    } catch (error) {
      if (error instanceof CorruptDataError) throw error
      throw new CorruptDataError('Invalid UTF-8')
    }
  }
  if (tag === 0) return ''
  const key = list[tag / 2 - 1]
  if (key === undefined) throw new CorruptDataError(`Unknown key id ${tag / 2}`)
  return key
}

const ESCAPE_STAT = 15
const ESCAPE_SLOT = 7
const ESCAPE_RARITY = 7

function isUint(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

/** True when the identity fits the packed layout (otherwise it is stored as JSON). */
function packable(a: ArtifactIdentity): boolean {
  const substatsOk = (list: readonly GoodSubstat[]) =>
    list.length <= 7 &&
    list.every(
      (s) =>
        typeof s.key === 'string' &&
        typeof s.value === 'number' &&
        Number.isFinite(s.value) &&
        (s.initialValue === undefined ||
          (typeof s.initialValue === 'number' && Number.isFinite(s.initialValue))) &&
        Object.keys(s).every((k) => k === 'key' || k === 'value' || k === 'initialValue'),
    )
  return (
    isUint(a.level) &&
    isUint(a.rarity) &&
    isUint(a.totalRolls) &&
    typeof a.elixirCrafted === 'boolean' &&
    substatsOk(a.substats) &&
    substatsOk(a.unactivatedSubstats)
  )
}

function writeSubstat(w: ByteWriter, s: GoodSubstat): void {
  const index = (SUBSTAT_KEYS as readonly string[]).indexOf(s.key)
  const stat = index >= 0 && index < ESCAPE_STAT ? index : ESCAPE_STAT
  const scale = scaleOf(s.value)
  let initial: number
  if (s.initialValue === undefined) initial = 0
  else if (Object.is(s.initialValue, s.value)) initial = 1
  else if (scale !== FLOAT_SCALE && fitsScale(s.initialValue, scale)) initial = 2
  else initial = 3
  w.byte(stat | (scale << 4) | (initial << 6))
  if (stat === ESCAPE_STAT) w.string(s.key)
  writeScaled(w, s.value, scale)
  if (initial === 2) writeScaled(w, s.initialValue!, scale)
  else if (initial === 3) writeFloat(w, s.initialValue!)
}

function readSubstat(r: ByteReader): GoodSubstat {
  const byte = r.byte()
  const stat = byte & 0x0f
  const scale = (byte >> 4) & 3
  const initial = byte >> 6
  const key = stat === ESCAPE_STAT ? r.string() : SUBSTAT_KEYS[stat]
  if (key === undefined) throw new CorruptDataError(`Unknown substat ${stat}`)
  const substat: GoodSubstat = { key, value: readScaled(r, scale) }
  if (initial === 1) substat.initialValue = substat.value
  else if (initial === 2) substat.initialValue = readScaled(r, scale)
  else if (initial === 3) substat.initialValue = readFloat(r)
  return substat
}

export function packArtifact(w: ByteWriter, a: ArtifactIdentity): void {
  if (!packable(a)) {
    w.uint(0).string(JSON.stringify(a))
    return
  }
  const slotIndex = (SLOT_KEYS as readonly string[]).indexOf(a.slotKey)
  const slot = slotIndex >= 0 && slotIndex < ESCAPE_SLOT ? slotIndex : ESCAPE_SLOT
  const rarity = a.rarity < ESCAPE_RARITY ? a.rarity : ESCAPE_RARITY
  w.uint(1 + slot + 8 * (rarity + 8 * (a.elixirCrafted ? 1 : 0)))
  if (slot === ESCAPE_SLOT) w.string(a.slotKey)
  if (rarity === ESCAPE_RARITY) w.uint(a.rarity)
  writeKey(w, ARTIFACT_SETS, a.setKey)
  writeKey(w, STAT_KEYS, a.mainStatKey)
  w.uint(a.level)
    .uint(a.totalRolls)
    .uint(a.substats.length + 8 * a.unactivatedSubstats.length)
  for (const s of a.substats) writeSubstat(w, s)
  for (const s of a.unactivatedSubstats) writeSubstat(w, s)
}

export function unpackArtifact(r: ByteReader): ArtifactIdentity {
  const head = r.uint()
  if (head === 0) {
    let parsed: unknown
    try {
      parsed = JSON.parse(r.string())
    } catch {
      throw new CorruptDataError('Invalid artifact JSON')
    }
    return parsed as ArtifactIdentity
  }
  const code = head - 1
  const slot = code % 8
  const rarityCode = Math.floor(code / 8) % 8
  const elixer = Math.floor(code / 64)
  if (elixer > 1) throw new CorruptDataError('Invalid artifact head')
  const slotKey = slot === ESCAPE_SLOT ? r.string() : SLOT_KEYS[slot]
  if (slotKey === undefined) throw new CorruptDataError(`Unknown slot ${slot}`)
  const rarity = rarityCode === ESCAPE_RARITY ? r.uint() : rarityCode
  const setKey = readKey(r, ARTIFACT_SETS)
  const mainStatKey = readKey(r, STAT_KEYS)
  const level = r.uint()
  const totalRolls = r.uint()
  const counts = r.uint()
  const substats: GoodSubstat[] = []
  const unactivatedSubstats: GoodSubstat[] = []
  for (let i = 0; i < counts % 8; i++) substats.push(readSubstat(r))
  for (let i = 0; i < Math.floor(counts / 8); i++) unactivatedSubstats.push(readSubstat(r))
  return {
    setKey,
    slotKey,
    level,
    rarity,
    mainStatKey,
    substats,
    totalRolls,
    elixirCrafted: elixer === 1,
    unactivatedSubstats,
  }
}

/** Packed bytes of one identity: equal bytes mean an equal identity. */
export function artifactKey(a: ArtifactIdentity): Uint8Array {
  const w = new ByteWriter()
  packArtifact(w, a)
  return w.finish()
}

export interface CatalogEntryBytes {
  id: number
  identity: ArtifactIdentity
}

/** One decoded chunk entry with its packed bytes as a string key (see artifactKeyString). */
export interface CatalogEntryWithKey extends CatalogEntryBytes {
  key: string
}

/** Packed identity bytes as a string, for use as a Map key: equal strings, equal identities. */
export function artifactKeyString(a: ArtifactIdentity): string {
  return bytesKey(artifactKey(a))
}

function bytesKey(bytes: Uint8Array): string {
  let key = ''
  for (let i = 0; i < bytes.length; i += 0x2000) {
    key += String.fromCharCode(...bytes.subarray(i, i + 0x2000))
  }
  return key
}

/** Format byte of a chunk: 1 = packed entries, stored; 2 = packed entries, deflated. */
const CHUNK_STORED = 1
const CHUNK_DEFLATED = 2

export function encodeCatalogChunk(entries: readonly CatalogEntryBytes[]): Uint8Array {
  const w = new ByteWriter()
  w.uint(entries.length)
  let previous = 0
  for (const { id } of entries) {
    if (!Number.isSafeInteger(id) || id <= 0) throw new RangeError(`Invalid catalog id ${id}`)
    w.int(id - previous)
    previous = id
  }
  for (const { identity } of entries) packArtifact(w, identity)
  const body = w.finish()
  const deflated = deflate(body)
  const out = new Uint8Array(1 + Math.min(body.length, deflated.length))
  if (deflated.length < body.length) {
    out[0] = CHUNK_DEFLATED
    out.set(deflated, 1)
  } else {
    out[0] = CHUNK_STORED
    out.set(body, 1)
  }
  return out
}

export function decodeCatalogChunk(data: Uint8Array): CatalogEntryWithKey[] {
  if (data.length === 0) throw new CorruptDataError('Empty catalog chunk')
  const format = data[0]
  let body: Uint8Array
  if (format === CHUNK_STORED) body = data.subarray(1)
  else if (format === CHUNK_DEFLATED) body = inflate(data.subarray(1))
  else throw new CorruptDataError(`Unknown catalog chunk format ${format}`)
  const r = new ByteReader(body)
  const count = r.uint()
  if (count > r.remaining) throw new CorruptDataError('Count past the data')
  const ids: number[] = []
  let previous = 0
  for (let i = 0; i < count; i++) {
    previous += r.int()
    ids.push(previous)
  }
  const entries = ids.map((id) => {
    const start = r.offset
    const identity = unpackArtifact(r)
    return { id, identity, key: bytesKey(body.subarray(start, r.offset)) }
  })
  r.end()
  return entries
}
