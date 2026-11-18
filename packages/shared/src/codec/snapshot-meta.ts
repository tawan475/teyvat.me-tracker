/**
 * The per-row values of a snapshot in storage format v2 (`snapshots.meta`):
 * the summary, the GOOD header (format, version, source) and the
 * per-capture fields of irminsul's `gi_player` (resin, AR EXP), which change
 * on almost every login and so are kept here instead of in the shared
 * player section (see splitPlayer).
 *
 * Layout, format byte 1 (all varints):
 *   summary: characters, weapons, artifacts, materials, mora, primogem,
 *            artifact3, artifact4 (uint each)
 *   version (int)
 *   source: index + 1 in SOURCES, or 0 and the string
 *   player flags (bit 0 resin, bit 1 arExp), then those values (int)
 * Format byte 2 (2026-10-15, live sync): format 1's fields, then irminsul's
 * `gi_capture`: reason (index in CAPTURE_REASONS), session (string), world,
 * journal seq (uints). A meta without a capture is still written as format 1.
 * Format byte 3 (2026-11-18, issue 12): format 1's fields, then a flag (uint
 * 0/1) and format 2's capture fields when it is 1, then Teyvat.me Capture's
 * `gi_off`: a count, then each name as its index + 1 in OFF_SWITCHES, or 0
 * and the string. Written only when the upload had `gi_off`.
 * `format` is "GOOD" (normalizeGood allows nothing else). Anything that does
 * not fit (a float count, another format) is stored as format byte 0 and the
 * JSON of the whole value.
 *
 * A storage format: new fields go at the end under a new format byte; an
 * existing format byte keeps its meaning forever.
 */

import type { GiPlayer } from '../good'
import { CAPTURE_REASONS, type GiCapture } from '../live/capture'
import { OFF_SWITCHES } from '../off'
import { ByteReader, ByteWriter, CorruptDataError } from './bytes'
import { PLAYER_KEY_ORDER } from './normalize'
import type { SnapshotSummary } from './snapshot'

/** Append-only: sources seen in GOOD files, stored as their position. */
export const SOURCES = [
  'Irminsul',
  'Unknown',
  'Genshin Optimizer',
  'Inventory_Kamera',
  'AdeptiScanner',
  'Genshin-Data-Tracker',
] as const

/** The `gi_player` fields that move between logins without the account changing. */
export interface PlayerVars {
  resin?: number
  arExp?: number
}

export interface SnapshotMeta {
  format: string
  version: number
  source: string
  summary: SnapshotSummary
  playerVars: PlayerVars
  /** Why irminsul took the snapshot (live sync); absent on older ones and other uploads. */
  capture?: GiCapture
  /**
   * Teyvat.me Capture's `gi_off`: the upload switches that were off ([] =
   * everything shared); absent when the upload had none.
   */
  off?: string[]
}

const JSON_META = 0
const META_V1 = 1
const META_V2 = 2
const META_V3 = 3

const SUMMARY_FIELDS = [
  'characters',
  'weapons',
  'artifacts',
  'materials',
  'mora',
  'primogem',
  'artifact3',
  'artifact4',
] as const satisfies readonly (keyof SnapshotSummary)[]

export function encodeSnapshotMeta(meta: SnapshotMeta): Uint8Array {
  try {
    const encoded = binaryMeta(meta)
    if (JSON.stringify(decodeSnapshotMeta(encoded)) === JSON.stringify(canonicalMeta(meta))) {
      return encoded
    }
  } catch (error) {
    if (!(error instanceof RangeError || error instanceof TypeError)) throw error
  }
  const json = new TextEncoder().encode(JSON.stringify(canonicalMeta(meta)))
  const out = new Uint8Array(json.length + 1)
  out[0] = JSON_META
  out.set(json, 1)
  return out
}

/** The meta as decoding gives it back: fixed key order outside the summary. */
function canonicalMeta(meta: SnapshotMeta): SnapshotMeta {
  const playerVars: PlayerVars = {}
  if (meta.playerVars.resin !== undefined) playerVars.resin = meta.playerVars.resin
  if (meta.playerVars.arExp !== undefined) playerVars.arExp = meta.playerVars.arExp
  return {
    format: meta.format,
    version: meta.version,
    source: meta.source,
    summary: meta.summary,
    playerVars,
    ...(meta.capture ? { capture: canonicalCapture(meta.capture) } : {}),
    ...(meta.off ? { off: [...meta.off] } : {}),
  }
}

function canonicalCapture(capture: GiCapture): GiCapture {
  return {
    v: 1,
    reason: capture.reason,
    session: capture.session,
    world: capture.world,
    journal: { seq: capture.journal.seq },
  }
}

function binaryMeta(meta: SnapshotMeta): Uint8Array {
  if (meta.format !== 'GOOD') throw new TypeError('Only GOOD has a binary meta')
  // Exactly the known summary fields, in their order: anything else keeps JSON.
  const keys = Object.keys(meta.summary)
  if (keys.length !== SUMMARY_FIELDS.length || keys.some((k, i) => k !== SUMMARY_FIELDS[i])) {
    throw new TypeError('Summary has other fields')
  }
  const w = new ByteWriter().byte(meta.off ? META_V3 : meta.capture ? META_V2 : META_V1)
  for (const field of SUMMARY_FIELDS) w.uint(meta.summary[field])
  w.int(meta.version)
  const source = (SOURCES as readonly string[]).indexOf(meta.source)
  if (source >= 0) w.uint(source + 1)
  else w.uint(0).string(meta.source)
  const { resin, arExp } = meta.playerVars
  w.uint((resin !== undefined ? 1 : 0) | (arExp !== undefined ? 2 : 0))
  if (resin !== undefined) w.int(resin)
  if (arExp !== undefined) w.int(arExp)
  if (meta.off) w.uint(meta.capture ? 1 : 0)
  if (meta.capture) {
    const reason = (CAPTURE_REASONS as readonly string[]).indexOf(meta.capture.reason)
    if (reason < 0) throw new TypeError('Unknown capture reason')
    w.uint(reason).string(meta.capture.session).uint(meta.capture.world)
    w.uint(meta.capture.journal.seq)
  }
  if (meta.off) {
    w.uint(meta.off.length)
    for (const name of meta.off) {
      const known = (OFF_SWITCHES as readonly string[]).indexOf(name)
      if (known >= 0) w.uint(known + 1)
      else w.uint(0).string(name)
    }
  }
  return w.finish()
}

export function decodeSnapshotMeta(data: Uint8Array): SnapshotMeta {
  if (data.length === 0) throw new CorruptDataError('Empty snapshot meta')
  if (data[0] === JSON_META) {
    try {
      return JSON.parse(
        new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data.subarray(1)),
      )
    } catch {
      throw new CorruptDataError('Invalid snapshot meta JSON')
    }
  }
  if (data[0] !== META_V1 && data[0] !== META_V2 && data[0] !== META_V3) {
    throw new CorruptDataError(`Unknown snapshot meta format ${data[0]}`)
  }
  const r = new ByteReader(data.subarray(1))
  const summary = Object.fromEntries(
    SUMMARY_FIELDS.map((field) => [field, r.uint()]),
  ) as unknown as SnapshotSummary
  const version = r.int()
  const sourceCode = r.uint()
  let source: string
  if (sourceCode === 0) source = r.string()
  else {
    const known = SOURCES[sourceCode - 1]
    if (known === undefined) throw new CorruptDataError(`Unknown source ${sourceCode}`)
    source = known
  }
  const flags = r.uint()
  const playerVars: PlayerVars = {}
  if (flags & 1) playerVars.resin = r.int()
  if (flags & 2) playerVars.arExp = r.int()
  let capture: GiCapture | undefined
  if (data[0] === META_V2 || (data[0] === META_V3 && r.uint() === 1)) {
    const reason = CAPTURE_REASONS[r.uint()]
    if (reason === undefined) throw new CorruptDataError('Unknown capture reason')
    const session = r.string()
    const world = r.uint()
    capture = { v: 1, reason, session, world, journal: { seq: r.uint() } }
  }
  let off: string[] | undefined
  if (data[0] === META_V3) {
    off = []
    for (let n = r.uint(); n > 0; n--) {
      const code = r.uint()
      if (code === 0) off.push(r.string())
      else {
        const known = OFF_SWITCHES[code - 1]
        if (known === undefined) throw new CorruptDataError(`Unknown switch ${code}`)
        off.push(known)
      }
    }
  }
  r.end()
  return {
    format: 'GOOD',
    version,
    source,
    summary,
    playerVars,
    ...(capture ? { capture } : {}),
    ...(off ? { off } : {}),
  }
}

// --------------------------------------------------------------- player
// The stored player section keeps what describes the account (UID, AR,
// World Level…); the row keeps what moves with every login. Merged back, the
// keys are in the order normalizeGood writes them (PLAYER_KEY_ORDER), which
// is the order every stored player section has; splitPlayer only splits a
// section that merges back to exactly the same JSON.

const VAR_KEYS = ['resin', 'arExp'] as const

export function splitPlayer(player: GiPlayer): { stable: GiPlayer; vars: PlayerVars } {
  const stable: Record<string, unknown> = {}
  const vars: PlayerVars = {}
  for (const [key, value] of Object.entries(player)) {
    if ((VAR_KEYS as readonly string[]).includes(key) && typeof value === 'number') {
      vars[key as keyof PlayerVars] = value
    } else stable[key] = value
  }
  const split = { stable: stable as GiPlayer, vars }
  return JSON.stringify(mergePlayer(split.stable, vars)) === JSON.stringify(player)
    ? split
    : { stable: player, vars: {} }
}

export function mergePlayer(stable: GiPlayer, vars: PlayerVars): GiPlayer {
  if (vars.resin === undefined && vars.arExp === undefined) return { ...stable }
  const all: Record<string, unknown> = { ...stable, ...vars }
  const merged: Record<string, unknown> = {}
  for (const key of PLAYER_KEY_ORDER) if (key in all) merged[key] = all[key]
  for (const key of Object.keys(stable)) if (!(key in merged)) merged[key] = all[key]
  return merged as GiPlayer
}
