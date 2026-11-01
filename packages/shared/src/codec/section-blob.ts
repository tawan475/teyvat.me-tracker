/**
 * Section blobs, storage format v2: how one section is stored in
 * `section_blobs.data`, and the codes of the columns beside it.
 *
 * A blob starts with a format byte:
 *   high nibble, the layout of the payload: 0 = the canonical JSON text,
 *     1 = the binary layout of section-binary.ts
 *   low nibble, its compression: 0 = none, 1 = raw DEFLATE, 2 = raw DEFLATE
 *     with the payload of the blob's base as the preset dictionary
 * then the (compressed) payload. Format 0x01 (JSON, deflated) is exactly a
 * v1 blob with the byte in front, which is how bundles carry v1 blobs.
 *
 * A blob can name a base (`section_blobs.base_id`), which it needs to decode:
 * - a delta (materials, artifacts, achievement times; kind code with
 *   KIND_DELTA set) is a delta of its base, as in v1 ("bases & deltas" in
 *   sections.ts);
 * - any blob compressed with format low nibble 2 uses its base's payload as
 *   the DEFLATE dictionary, which is what makes a section that changed a
 *   little cost a little: the dictionary holds almost all of it.
 * A delta's base is a full section; a base is either standalone or itself
 * compressed against a standalone base. So decoding needs at most three
 * blobs (delta, its keyframe, the keyframe's dictionary).
 *
 * A storage format: data written today must decode forever. New layouts or
 * compressions take new format values; existing ones never change meaning.
 */

import type { KeyRef } from '../dictionary'
import { CorruptDataError } from './bytes'
import { deflate, inflate } from './deflate'
import { decodeBinary, encodeBinaryVariants, isDeltaBinary } from './section-binary'
import type { SectionKind } from './sections'

/** `section_blobs.kind`: the section kind, plus KIND_DELTA for a delta. Append-only. */
export const SECTION_KIND_CODES: Readonly<Record<SectionKind, number>> = {
  characters: 1,
  weapons: 2,
  artifacts: 3,
  materials: 4,
  achievements: 5,
  player: 6,
  achievementTimes: 7,
  characterExtras: 8,
  anecdotes: 9,
  tasks: 10,
  collections: 11,
  collections2: 12,
  wardrobe: 13,
  exploration: 14,
  // The last code below KIND_DELTA. Later kinds take codes without its bit:
  // 32-47, 64-79, … (old builds decode only the kinds they ask a bundle for).
  progress: 15,
  extras: 32,
}

export const KIND_DELTA = 0x10

const KINDS_BY_CODE = new Map(
  Object.entries(SECTION_KIND_CODES).map(([kind, code]) => [code, kind as SectionKind]),
)

export function kindCode(kind: SectionKind, delta: boolean): number {
  return SECTION_KIND_CODES[kind] | (delta ? KIND_DELTA : 0)
}

export function kindOfCode(code: number): { kind: SectionKind; delta: boolean } {
  const kind = KINDS_BY_CODE.get(code & ~KIND_DELTA)
  if (!kind) throw new CorruptDataError(`Unknown section kind ${code}`)
  return { kind, delta: (code & KIND_DELTA) !== 0 }
}

/** Kinds that are stored as a delta of a full base when that is cheaper. */
export const DELTA_KINDS: ReadonlySet<SectionKind> = new Set([
  'materials',
  'artifacts',
  'achievementTimes',
])

const LAYOUT_JSON = 0x00
const LAYOUT_BINARY = 0x10
const STORED = 0
const DEFLATED = 1
const DEFLATED_WITH_BASE = 2

/** The format byte of a v1 blob (deflated JSON) when it travels with v2 ones. */
export const LEGACY_FORMAT = LAYOUT_JSON | DEFLATED

/** What decoding a blob gives: its value, and the payload a dependent blob may use as dictionary. */
export interface DecodedBlob {
  /** The canonical section value, `b` set to the base's key for a delta. */
  value: unknown
  /** The uncompressed payload (layout bytes). */
  payload: Uint8Array
}

export interface EncodedBlob {
  /** Format byte + compressed payload: what `section_blobs.data` holds. */
  data: Uint8Array
  /** The uncompressed payload, for blobs that will use this one as their dictionary. */
  payload: Uint8Array
  /** Whether the data needs its base as dictionary (so the base must be stored with it). */
  usesBase: boolean
}

/** A section's value without its `b` (bases are named by the blob row, not the payload). */
export function withoutBase(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || !('b' in value)) {
    return value
  }
  const { b: _, ...rest } = value as Record<string, unknown>
  return rest
}

function withBaseKey(value: unknown, delta: boolean, baseKey: string | null): unknown {
  if (!delta) return value
  if (baseKey === null) throw new CorruptDataError('A delta section needs its base')
  return { b: baseKey, ...(value as object) }
}

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

/**
 * Encodes one section. `value` is its canonical value (a delta with its `b`);
 * `base` is the decoded base the blob will name, when it will name one (always
 * for a delta; for a full section, the dictionary candidate). Tries the binary
 * layout (checked by decoding it back) and falls back to JSON; then keeps the
 * smallest of stored, deflated and deflated against the base.
 */
export function encodeSectionBlob(
  kind: SectionKind,
  value: unknown,
  delta: boolean,
  base: DecodedBlob | null,
): EncodedBlob {
  if (delta && !base) throw new Error('A delta is stored with its base')
  return compress(sectionPayload(kind, value, delta), base)
}

/**
 * A full section both ways: on its own, and (with `dictionary`) compressed
 * against that blob's payload, for the caller to weigh (see planSnapshotV2).
 */
export function encodeSectionBlobVariants(
  kind: SectionKind,
  value: unknown,
  dictionary: DecodedBlob | null,
): { standalone: EncodedBlob; withBase: EncodedBlob | null } {
  const payload = sectionPayload(kind, value, false)
  // Both ways weigh the same plain deflate: run it once.
  const plain = deflate(payload.subarray(1))
  const standalone = compress(payload, null, plain)
  if (!dictionary) return { standalone, withBase: null }
  const withBase = compress(payload, dictionary, plain)
  return { standalone, withBase: withBase.usesBase ? withBase : null }
}

/** The uncompressed payload (layout byte + bytes) of a section value. */
function sectionPayload(kind: SectionKind, value: unknown, delta: boolean): Uint8Array {
  const bare = withoutBase(value)
  const expected = JSON.stringify(bare)
  let payload: Uint8Array | null = null
  try {
    const variants = encodeBinaryVariants(kind, { value: bare, delta })
    for (const variant of variants) {
      // One that could not replace the pick needs no check (decoding and
      // printing a whole section back is most of an import's encoding time).
      if (payload && variant.length >= payload.length - 1) continue
      // Never trust a layout that does not give the value back exactly.
      if (JSON.stringify(withoutBase(decodeBinary(kind, variant, 'b'))) !== expected) continue
      payload = variant
    }
    if (payload) payload = prefixed(LAYOUT_BINARY, payload)
  } catch (error) {
    if (!(error instanceof RangeError || error instanceof TypeError)) throw error
    payload = null
  }
  return payload ?? prefixed(LAYOUT_JSON, encoder.encode(expected))
}

/** Layout tag + bytes; the tag is the payload's first byte (its format nibble). */
function prefixed(layout: number, bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length + 1)
  out[0] = layout
  out.set(bytes, 1)
  return out
}

/** `deflated`: the body's plain deflate when the caller already made it. */
function compress(
  payload: Uint8Array,
  base: DecodedBlob | null,
  deflated?: Uint8Array,
): EncodedBlob {
  const layout = payload[0]!
  const body = payload.subarray(1)
  const candidates: [number, Uint8Array][] = [[STORED, body]]
  candidates.push([DEFLATED, deflated ?? deflate(body)])
  if (base) candidates.push([DEFLATED_WITH_BASE, deflate(body, base.payload)])
  let best = candidates[0]!
  for (const candidate of candidates) if (candidate[1].length < best[1].length) best = candidate
  const data = new Uint8Array(best[1].length + 1)
  data[0] = layout | best[0]
  data.set(best[1], 1)
  return { data, payload, usesBase: best[0] === DEFLATED_WITH_BASE }
}

/** True when a blob's data needs its base's payload as dictionary. */
export function blobUsesBase(data: Uint8Array): boolean {
  return data.length > 0 && (data[0]! & 0x0f) === DEFLATED_WITH_BASE
}

/**
 * Decodes one blob. `base` is its decoded base (required when the blob is a
 * delta or was compressed against it), `baseKey` what the decoded delta's `b`
 * is set to (the key the caller knows that base by).
 */
export function decodeSectionBlob(
  code: number,
  data: Uint8Array,
  base: DecodedBlob | null,
  baseKey: string | null,
): DecodedBlob {
  const { kind, delta } = kindOfCode(code)
  if (data.length === 0) throw new CorruptDataError('Empty section blob')
  const format = data[0]!
  const layout = format & 0xf0
  const compression = format & 0x0f
  const body = data.subarray(1)
  let raw: Uint8Array
  if (compression === STORED) raw = body
  else if (compression === DEFLATED) raw = inflate(body)
  else if (compression === DEFLATED_WITH_BASE) {
    if (!base) throw new CorruptDataError('Blob needs its base to decode')
    raw = inflate(body, base.payload)
  } else throw new CorruptDataError(`Unknown section compression ${compression}`)
  const payload = prefixed(layout, raw)
  let value: unknown
  if (layout === LAYOUT_BINARY) {
    if (DELTA_KINDS.has(kind) && isDeltaBinary(kind, raw) !== delta) {
      throw new CorruptDataError('Section kind and layout disagree on delta')
    }
    value = withBaseKey(withoutBase(decodeBinary(kind, raw, 'b')), delta, baseKey)
  } else if (layout === LAYOUT_JSON) {
    let parsed: unknown
    try {
      parsed = JSON.parse(decoder.decode(raw))
    } catch {
      throw new CorruptDataError('Invalid section JSON')
    }
    // v1 blobs carry their own `b`; v2 JSON blobs do not.
    value = delta ? withBaseKey(withoutBase(parsed), true, baseKey) : parsed
  } else throw new CorruptDataError(`Unknown section layout ${layout}`)
  return { value, payload }
}

/**
 * The first 8 bytes of a 32-hex-digit content address, as hex: what
 * `section_blobs.hash` holds (through SQL `unhex()`), and a map key.
 */
export function shortHashHex(hex128: string): string {
  return hex128.slice(0, 16)
}

/**
 * A snapshot's content hash as stored in `snapshots.content_key`: its first
 * 47 bits as an integer, a safe JS number that SQLite keeps in 6 bytes. It
 * only ever answers "is this the same inventory as that one snapshot", so a
 * false match needs a 1-in-2^47 coincidence on one comparison.
 */
export function contentKey(hex128: string): number {
  return parseInt(hex128.slice(0, 12), 16) % 2 ** 47
}

export type { KeyRef }
