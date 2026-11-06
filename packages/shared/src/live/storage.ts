/**
 * How the live journal is kept in `gdt-live` (docs/plans/live-sync.md §7):
 * batch rows, the running chart figures, the day rows of chart points and the
 * base snapshot's item index. Storage formats: each starts with a format
 * byte that keeps its meaning forever; new layouts get a new byte.
 */

import { ByteReader, ByteWriter, CorruptDataError } from '../codec/bytes'
import { deflate, inflate } from '../codec/deflate'
import type { NormalizedGood } from '../codec/normalize'
import type { SnapshotSummary } from '../codec/snapshot'
import type { DeltaChange, LiveArtifact, LiveGood, LiveWeapon } from './delta'

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

// ------------------------------------------------------------------ batches

/** Format 0x01: the merged changes as deflated JSON. */
const CHANGES_JSON = 0x01

export function encodeChanges(changes: readonly DeltaChange[]): Uint8Array {
  return withFormat(CHANGES_JSON, deflate(encoder.encode(JSON.stringify(changes))))
}

export function decodeChanges(data: Uint8Array): DeltaChange[] {
  if (data[0] !== CHANGES_JSON) throw new CorruptDataError(`Unknown changes format ${data[0]}`)
  try {
    const parsed: unknown = JSON.parse(decoder.decode(inflate(data.subarray(1))))
    if (!Array.isArray(parsed)) throw new CorruptDataError('Changes are not a list')
    return parsed as DeltaChange[]
  } catch (error) {
    if (error instanceof CorruptDataError) throw error
    throw new CorruptDataError('Invalid changes JSON')
  }
}

// ------------------------------------------------------------------ figures

/** The chart figures, in their stored order (the snapshot summary's fields). */
export const FIGURE_FIELDS = [
  'characters',
  'weapons',
  'artifacts',
  'materials',
  'mora',
  'primogem',
  'artifact3',
  'artifact4',
] as const satisfies readonly (keyof SnapshotSummary)[]

export type Figures = SnapshotSummary

const FIGURES_V1 = 0x01

export function encodeFigures(figures: Figures): Uint8Array {
  const w = new ByteWriter().byte(FIGURES_V1)
  for (const field of FIGURE_FIELDS) w.uint(Math.max(0, Math.round(figures[field] ?? 0)))
  return w.finish()
}

export function decodeFigures(data: Uint8Array): Figures {
  const r = new ByteReader(data)
  const format = r.byte()
  if (format !== FIGURES_V1) throw new CorruptDataError(`Unknown figures format ${format}`)
  const figures = Object.fromEntries(FIGURE_FIELDS.map((f) => [f, r.uint()])) as unknown as Figures
  r.end()
  return figures
}

/**
 * The figures after a batch: irminsul's own count (`sum`) when it sent one,
 * else what the changes tell (Mora, Primogems, items and characters added or
 * deleted). Unlocked spare 3★/4★ and the materials count need the whole
 * state, so without `sum` they stay as they were until the next snapshot.
 */
export function applyFigures(
  figures: Figures,
  changes: readonly DeltaChange[],
  sum?: Figures,
): Figures {
  if (sum) return { ...sum }
  const next = { ...figures }
  for (const [op, path, value] of changes) {
    const [section, name] = path.map(String)
    if (section === 'materials' && path.length === 2) {
      const count = op === 'set' && typeof value === 'number' ? value : op === 'del' ? 0 : null
      if (count === null) continue
      if (name === 'Mora') next.mora = count
      else if (name === 'Primogem') next.primogem = count
    } else if (path.length === 2 && (op === 'add' || op === 'del')) {
      const step = op === 'add' ? 1 : -1
      if (section === 'artifacts') next.artifacts = Math.max(0, next.artifacts + step)
      else if (section === 'weapons') next.weapons = Math.max(0, next.weapons + step)
      else if (section === 'characters') next.characters = Math.max(0, next.characters + step)
    }
  }
  return next
}

// ------------------------------------------------------------------- points

/** One chart sample: when (Unix ms) and the figures then. */
export interface LivePoint {
  at: number
  figures: Figures
}

/** A newer sample this close to the day's last one replaces it. */
export const POINT_SPACING_MS = 10 * 60_000

const POINTS_V1 = 0x01
const DAY_MS = 86_400_000

/** The UTC day (YYYY-MM-DD) of a time. */
export function pointDay(at: number): string {
  return new Date(at).toISOString().slice(0, 10)
}

/**
 * One day's points: count, then per point the ms since the previous one (the
 * first: since the UTC day's start) and each figure as the change from the
 * previous point (zigzag), deflated.
 */
export function encodePoints(day: string, points: readonly LivePoint[]): Uint8Array {
  const start = Date.parse(`${day}T00:00:00Z`)
  const w = new ByteWriter().uint(points.length)
  let at = start
  let previous: Figures | null = null
  for (const point of points) {
    w.uint(Math.max(0, point.at - at))
    at = Math.max(at, point.at)
    for (const field of FIGURE_FIELDS) {
      const value = Math.max(0, Math.round(point.figures[field] ?? 0))
      w.int(previous ? value - previous[field] : value)
    }
    previous = point.figures
  }
  return withFormat(POINTS_V1, deflate(w.finish()))
}

export function decodePoints(day: string, data: Uint8Array): LivePoint[] {
  if (data[0] !== POINTS_V1) throw new CorruptDataError(`Unknown points format ${data[0]}`)
  const r = new ByteReader(inflate(data.subarray(1)))
  const count = r.uint()
  let at = Date.parse(`${day}T00:00:00Z`)
  let previous: Figures | null = null
  const points: LivePoint[] = []
  for (let i = 0; i < count; i++) {
    at += r.uint()
    const figures = {} as Figures
    for (const field of FIGURE_FIELDS) {
      figures[field] = (previous ? previous[field] : 0) + r.int()
    }
    points.push({ at, figures })
    previous = figures
  }
  r.end()
  return points
}

/**
 * The day's points with one more sample: it replaces the last one when that
 * is less than POINT_SPACING_MS older, so a day keeps at most one point per
 * ten minutes of play. A sample older than the last one is dropped.
 */
export function addPoint(points: readonly LivePoint[], point: LivePoint): LivePoint[] {
  const last = points.at(-1)
  if (last && point.at < last.at) return [...points]
  if (last && point.at - last.at < POINT_SPACING_MS) return [...points.slice(0, -1), point]
  if (point.at - Date.parse(`${pointDay(point.at)}T00:00:00Z`) >= DAY_MS) return [...points]
  return [...points, point]
}

// --------------------------------------------------------------- item index

/**
 * A short hash of everything an item shows (cyrb53, 48 bits): how the
 * browser finds a stored snapshot's item, which has no guid, by the guid a
 * journal names it with. Identical items share it, which is harmless:
 * either one is the same item.
 */
export function itemFingerprint(kind: 'artifacts', item: LiveArtifact): number
export function itemFingerprint(kind: 'weapons', item: LiveWeapon): number
export function itemFingerprint(
  kind: 'artifacts' | 'weapons',
  item: LiveArtifact | LiveWeapon,
): number {
  return hash48(
    JSON.stringify(
      kind === 'artifacts'
        ? artifactFields(item as LiveArtifact)
        : weaponFields(item as LiveWeapon),
    ),
  )
}

const subs = (list: readonly { key: string; value: number }[] | undefined) =>
  (list ?? []).map((s) => [s.key, s.value])

function artifactFields(a: LiveArtifact): unknown[] {
  return [
    a.setKey,
    a.slotKey,
    a.level,
    a.rarity,
    a.mainStatKey,
    subs(a.substats),
    a.totalRolls ?? 0,
    (a.elixirCrafted ?? a.elixerCrafted) ? 1 : 0,
    subs(a.unactivatedSubstats),
    a.location ?? '',
    a.lock ? 1 : 0,
    a.astralMark ? 1 : 0,
  ]
}

function weaponFields(w: LiveWeapon): unknown[] {
  return [w.key, w.level, w.ascension, w.refinement, w.location ?? '', w.lock ? 1 : 0]
}

/** cyrb53 (public domain), cut to 48 bits. */
function hash48(text: string): number {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return ((h2 >>> 0) % 0x10000) * 0x1_0000_0000 + (h1 >>> 0)
}

/** Each kind's [guid, fingerprint] pairs. */
export interface ItemIndex {
  artifacts: [string, number][]
  weapons: [string, number][]
}

const GUID = /^\d{1,20}$/
const TWO_32 = 0x1_0000_0000n

/** A decimal u64 guid, or null when it is not one. */
function splitGuid(guid: string): [number, number] | null {
  if (!GUID.test(guid)) return null
  const value = BigInt(guid)
  if (value >= 1n << 64n) return null
  return [Number(value / TWO_32), Number(value % TWO_32)]
}

/** The index of a snapshot's items: the items that carry a valid guid. */
export function itemIndexOf(good: Pick<LiveGood, 'artifacts' | 'weapons'>): ItemIndex {
  const pairs = <T extends { gi_guid?: string }>(items: readonly T[], fp: (item: T) => number) =>
    items.flatMap((item): [string, number][] =>
      typeof item.gi_guid === 'string' && splitGuid(item.gi_guid) ? [[item.gi_guid, fp(item)]] : [],
    )
  return {
    artifacts: pairs(good.artifacts, (a) => itemFingerprint('artifacts', a)),
    weapons: pairs(good.weapons, (w) => itemFingerprint('weapons', w)),
  }
}

/**
 * The index of an upload's items, from the normalised file (what the stored
 * snapshot will decode to, so the browser's fingerprints match); null when
 * no item had a guid.
 */
export function preparedItemIndex(good: NormalizedGood): ItemIndex | null {
  const guids = good.itemGuids
  if (!guids) return null
  const artifacts = good.artifacts.flatMap(({ identity, state }, i): [string, number][] => {
    const guid = guids.artifacts[i]
    if (!guid || !splitGuid(guid)) return []
    const item: LiveArtifact = {
      setKey: identity.setKey,
      slotKey: identity.slotKey,
      level: identity.level,
      rarity: identity.rarity,
      mainStatKey: identity.mainStatKey,
      location: state.location,
      lock: state.lock,
      substats: identity.substats,
      totalRolls: identity.totalRolls,
      astralMark: state.astralMark,
      elixirCrafted: identity.elixirCrafted,
      unactivatedSubstats: identity.unactivatedSubstats,
    }
    return [[guid, itemFingerprint('artifacts', item)]]
  })
  const weapons = good.weapons.flatMap((weapon, i): [string, number][] => {
    const guid = guids.weapons[i]
    return guid && splitGuid(guid) ? [[guid, itemFingerprint('weapons', weapon)]] : []
  })
  return { artifacts, weapons }
}

const ITEMS_V1 = 0x01

/**
 * Per kind: count, then the entries sorted by guid, each as the guid's high
 * 32 bits as a step from the previous one, its low 32 bits as a step too when
 * the high part did not move (else whole), and the fingerprint; deflated.
 */
export function encodeItemIndex(index: ItemIndex): Uint8Array {
  const w = new ByteWriter()
  for (const kind of ['artifacts', 'weapons'] as const) {
    const entries = index[kind]
      .flatMap(([guid, fp]) => {
        const split = splitGuid(guid)
        return split ? [{ hi: split[0], lo: split[1], fp }] : []
      })
      .sort((a, b) => a.hi - b.hi || a.lo - b.lo)
    w.uint(entries.length)
    let hi = 0
    let lo = 0
    for (const entry of entries) {
      w.uint(entry.hi - hi)
      w.uint(entry.hi === hi ? entry.lo - lo : entry.lo)
      w.uint(entry.fp)
      hi = entry.hi
      lo = entry.lo
    }
  }
  return withFormat(ITEMS_V1, deflate(w.finish()))
}

export function decodeItemIndex(data: Uint8Array): ItemIndex {
  if (data[0] !== ITEMS_V1) throw new CorruptDataError(`Unknown item index format ${data[0]}`)
  const r = new ByteReader(inflate(data.subarray(1)))
  const index: ItemIndex = { artifacts: [], weapons: [] }
  for (const kind of ['artifacts', 'weapons'] as const) {
    const count = r.uint()
    let hi = 0
    let lo = 0
    for (let i = 0; i < count; i++) {
      const step = r.uint()
      lo = step === 0 ? lo + r.uint() : r.uint()
      hi += step
      const guid = (BigInt(hi) * TWO_32 + BigInt(lo)).toString()
      index[kind].push([guid, r.uint()])
    }
  }
  r.end()
  return index
}

/**
 * Gives the items of a stored snapshot (which keeps no guids) the guids a
 * journal names them by: each [kind, guid, fingerprint] goes to the first
 * item of that kind with that fingerprint and no guid yet. Pure.
 */
export function bindItemGuids<T extends LiveGood>(
  good: T,
  binds: readonly (readonly ['artifacts' | 'weapons', string, number])[],
): T {
  if (binds.length === 0) return good
  const next = { ...good }
  for (const kind of ['artifacts', 'weapons'] as const) {
    const wanted = binds.filter((b) => b[0] === kind)
    if (wanted.length === 0) continue
    const items = [...next[kind]] as (LiveArtifact | LiveWeapon)[]
    const bound = new Set(items.map((item) => item.gi_guid).filter(Boolean))
    const byFingerprint = new Map<number, number[]>()
    items.forEach((item, i) => {
      if (item.gi_guid) return
      const fp =
        kind === 'artifacts'
          ? itemFingerprint('artifacts', item as LiveArtifact)
          : itemFingerprint('weapons', item as LiveWeapon)
      const list = byFingerprint.get(fp)
      if (list) list.push(i)
      else byFingerprint.set(fp, [i])
    })
    for (const [, guid, fp] of wanted) {
      if (bound.has(guid)) continue
      const at = byFingerprint.get(fp)?.shift()
      if (at === undefined) continue
      items[at] = { ...items[at]!, gi_guid: guid }
      bound.add(guid)
    }
    ;(next as LiveGood)[kind] = items as never
  }
  return next
}

function withFormat(format: number, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(body.length + 1)
  out[0] = format
  out.set(body, 1)
  return out
}
