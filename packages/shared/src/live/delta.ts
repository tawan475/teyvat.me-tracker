/**
 * GOOD-X delta: a batch of changes irminsul saw since the account's newest
 * snapshot (docs/plans/live-sync.md §5.2). A wire contract with irminsul
 * (`src/delta.rs` there, fixture `tests/fixtures/good-x-delta.json`, copied to
 * `packages/shared/test/fixtures/`): fields and path kinds are only appended.
 *
 * A change is `["set", path, value]`, `["add", path, item]` or
 * `["del", path, hint?]`, always an absolute value: re-applying a batch is
 * harmless. Paths (every part a string in v1; numbers are read as strings):
 *
 * | path | value |
 * |---|---|
 * | `materials.<key>` | count (`set`); `del` = the key is gone |
 * | `characters.<key>` | `add` a whole GOOD character; `del` |
 * | `characters.<key>.level\|ascension\|constellation` | number |
 * | `characters.<key>.talent.auto\|skill\|burst` | number |
 * | `weapons.<guid>` / `artifacts.<guid>` | `add` a whole GOOD item; `del` (hint `{rarity}`) |
 * | `weapons.<guid>.<field>` / `artifacts.<guid>.<field>` | that field's new value |
 * | `gi_player.<field>` | number (`del` = gone); `nickname`/`signature` a string, `profilePicture`/`birthday` an object of numbers |
 * | `gi_player.profilePicture\|birthday.<field>` | number |
 * | `gi_characters.<key>.<field>` | number; `del` of `gi_characters.<key>` drops the entry |
 * | `achievements.<id>` | finish time, unix seconds (0: finished, time unknown); `del` |
 * | `anecdotes.<id>` | `{state, finishCount}`; `del` |
 * | `gi_anecdotes.unlockedAreas\|reward\|wish` | that value; `del` |
 * | `gi_tasks.resin` | `{value, nextAt}`: the resin clock (Capture 1.12.0); `del` |
 * | `gi_tasks.<part>` | any other part of `gi_tasks`, whole, checked as a snapshot's (Capture 1.16.0); `del` |
 * | `gi_wardrobe.teams\|currentTeam` | the saved teams whole / the slot in use, checked as a snapshot's (Capture 1.17.1); `del` |
 * | `quests.<id>` | a parent quest (`gi_collections.quests`): 1 finished, 0 accepted and not finished; `del` (Capture 1.17.25) |
 *
 * Items (weapons, artifacts) are named by the game's guid, `gi_guid` on the
 * item; an item without one never appears in a journal. Unknown paths are
 * ignored, never an error: a newer irminsul may send more.
 */

import { z } from 'zod'
import type { GiAnecdotes, Good, GoodArtifact, GoodCharacter, GoodWeapon } from '../good'
import type { SnapshotSummary } from '../codec/snapshot'
import { normalizeTaskPart, normalizeWardrobePart } from '../codec/normalize'

export type DeltaPath = readonly (string | number)[]
export type DeltaChange =
  | readonly ['set', DeltaPath, unknown]
  | readonly ['add', DeltaPath, Record<string, unknown>]
  | readonly ['del', DeltaPath]
  | readonly ['del', DeltaPath, Record<string, unknown>]

export const DELTA_FORMAT = 'GOOD-X-delta'
/** At most this many changes per batch; anything bigger is a snapshot. */
export const MAX_DELTA_CHANGES = 2000
/** At most this many bytes of JSON per batch. */
export const MAX_DELTA_BYTES = 512 * 1024

export interface GoodDelta {
  format: typeof DELTA_FORMAT
  v: 1
  uid: number
  /** irminsul's id of this game login. */
  session: string
  /** 1, 2, 3 … within the journal of `base`. */
  seq: number
  /** The `live.base` the snapshot this journal follows was answered with. */
  base: string
  /** Unix ms, irminsul's clock when the batch was built. */
  at: number
  changes: DeltaChange[]
  /**
   * The chart figures of the whole account after this batch, as a snapshot's
   * summary would count them (optional; without it the tracker keeps what
   * the changes alone tell it).
   */
  sum?: SnapshotSummary
}

/**
 * A path part: GOOD keys (some material keys the game data names are 90+
 * characters, past GOOD_LIMITS.keyLength), guids, ids.
 */
const pathPart = z.union([z.string().max(256), z.number().int()])
const path = z.array(pathPart).min(1).max(5)
const hint = z.record(z.string(), z.unknown())
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)

export const snapshotSummarySchema = z.object({
  characters: count,
  weapons: count,
  artifacts: count,
  materials: count,
  mora: count,
  primogem: count,
  artifact3: count,
  artifact4: count,
})

export const goodDeltaSchema = z.object({
  format: z.literal(DELTA_FORMAT),
  v: z.literal(1),
  uid: z.number().int().positive().max(0xffff_ffff),
  session: z.string().min(8).max(64),
  seq: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  base: z.string().min(1).max(32),
  at: z.number().int().positive(),
  changes: z
    .array(
      z.union([
        z.tuple([z.literal('set'), path, z.unknown()]),
        z.tuple([z.literal('add'), path, hint]),
        z.tuple([z.literal('del'), path]),
        z.tuple([z.literal('del'), path, hint]),
      ]),
    )
    .max(MAX_DELTA_CHANGES),
  sum: snapshotSummarySchema.optional(),
})

/** A GOOD item as the journal sees it: the game's guid when it is known. */
export type LiveArtifact = GoodArtifact & { gi_guid?: string }
export type LiveWeapon = GoodWeapon & { gi_guid?: string }

/** A GOOD file whose items may carry `gi_guid` (irminsul's snapshots do). */
export interface LiveGood extends Omit<Good, 'artifacts' | 'weapons'> {
  artifacts: LiveArtifact[]
  weapons: LiveWeapon[]
}

const CHARACTER_FIELDS = new Set(['level', 'ascension', 'constellation'])
const TALENTS = new Set(['auto', 'skill', 'burst'])
const ANECDOTE_FIELDS = new Set(['unlockedAreas', 'reward', 'wish'])
/** The parts of `gi_wardrobe` a journal may set (Capture 1.17.1). */
const WARDROBE_LIVE = new Set(['teams', 'currentTeam'])

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
/** `gi_player`'s text and object fields (Teyvat.me Capture 1.14+); the rest are numbers. */
const PLAYER_TEXTS = new Set(['nickname', 'signature'])
const PLAYER_GROUPS = new Set(['profilePicture', 'birthday'])
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

/**
 * Applies changes to a GOOD state, in order (pure: what it touches is copied).
 * Items are found by `gi_guid`; a change to an item or character that is not
 * there, or to an unknown path, is skipped.
 */
/**
 * GOOD spells it `elixirCrafted`; Teyvat.me Capture before 1.17.18 (and
 * irminsul) sent `elixerCrafted`. Journals hold what was sent, so items are
 * read into GOOD's name here, once, wherever a batch is applied.
 */
const OLD_ELIXIR = 'elixerCrafted'
function goodSpelling(value: Record<string, unknown>): Record<string, unknown> {
  if (!(OLD_ELIXIR in value)) return value
  const { [OLD_ELIXIR]: old, ...rest } = value
  return 'elixirCrafted' in rest ? rest : { ...rest, elixirCrafted: old }
}

export function applyDelta(good: LiveGood, changes: readonly DeltaChange[]): LiveGood {
  const next = { ...good }
  const copied = new Set<string>()
  /** The section, copied once before its first change. */
  const own = <K extends keyof LiveGood>(key: K, copy: (value: LiveGood[K]) => LiveGood[K]) => {
    if (!copied.has(key)) {
      copied.add(key)
      next[key] = copy(next[key])
    }
    return next[key]
  }
  for (const change of changes) {
    const [op, rawPath] = change
    const value = change[2]
    const parts = rawPath.map(String)
    const [section, name, field, sub] = parts
    if (name === undefined) continue
    switch (section) {
      case 'materials': {
        if (parts.length !== 2) break
        const materials = own('materials', (m) => ({ ...m }))
        if (op === 'del') delete materials[name]
        else if (op === 'set' && isNumber(value)) materials[name] = value
        break
      }
      case 'artifacts':
      case 'weapons': {
        const list = own(section, (items) => [...items] as never) as (LiveArtifact | LiveWeapon)[]
        const at = list.findIndex((item) => item.gi_guid === name)
        if (parts.length === 2) {
          if (op === 'del') {
            if (at >= 0) list.splice(at, 1)
          } else if (isObject(value)) {
            const item = { ...goodSpelling(value), gi_guid: name } as LiveArtifact & LiveWeapon
            if (at >= 0) list[at] = item
            else list.push(item)
          }
        } else if (parts.length === 3 && at >= 0 && field !== 'gi_guid') {
          const item: Record<string, unknown> = { ...list[at]! }
          const key = field === OLD_ELIXIR ? 'elixirCrafted' : field!
          if (op === 'del') delete item[key]
          else if (op === 'set') item[key] = value
          list[at] = item as unknown as LiveArtifact & LiveWeapon
        }
        break
      }
      case 'characters': {
        const list = own('characters', (items) => [...items])
        const at = list.findIndex((c) => c.key === name)
        if (parts.length === 2) {
          if (op === 'del') {
            if (at >= 0) list.splice(at, 1)
          } else if (isObject(value)) {
            const character = { ...value, key: name } as unknown as GoodCharacter
            if (at >= 0) list[at] = character
            else list.push(character)
          }
        } else if (at >= 0 && op === 'set' && isNumber(value)) {
          const character = list[at]!
          if (parts.length === 3 && CHARACTER_FIELDS.has(field!)) {
            list[at] = { ...character, [field!]: value }
          } else if (parts.length === 4 && field === 'talent' && TALENTS.has(sub!)) {
            list[at] = { ...character, talent: { ...character.talent, [sub!]: value } }
          }
        }
        break
      }
      case 'gi_player': {
        if (parts.length === 3 && op === 'set' && isNumber(value) && PLAYER_GROUPS.has(name!)) {
          const player = own('gi_player', (p) => ({ ...p })) as Record<string, unknown>
          const group = player[name!]
          player[name!] = { ...(isPlainObject(group) ? group : {}), [field!]: value }
          break
        }
        if (parts.length !== 2) break
        if (op === 'del') {
          if (next.gi_player && name in next.gi_player) {
            const player = own('gi_player', (p) => ({ ...p })) as Record<string, unknown>
            delete player[name]
          }
        } else if (
          op === 'set' &&
          (isNumber(value) ||
            (typeof value === 'string' && PLAYER_TEXTS.has(name!)) ||
            (isPlainObject(value) && PLAYER_GROUPS.has(name!)))
        ) {
          const player = own('gi_player', (p) => ({ ...p })) as Record<string, unknown>
          player[name] = isPlainObject(value) ? { ...value } : value
        }
        break
      }
      case 'gi_characters': {
        if (op === 'del' && !next.gi_characters?.[name]) break
        if (op === 'set' && (parts.length !== 3 || !isNumber(value))) break
        const extras = own('gi_characters', (e) => ({ ...e }))!
        if (parts.length === 2 && op === 'del') delete extras[name]
        else if (parts.length === 3) {
          const entry: Record<string, unknown> = { ...extras[name] }
          if (op === 'del') delete entry[field!]
          else entry[field!] = value
          if (Object.keys(entry).length > 0) extras[name] = entry
          else delete extras[name]
        }
        break
      }
      case 'achievements': {
        if (parts.length !== 2) break
        const id = Number(name)
        if (!Number.isInteger(id) || id < 0) break
        if (op === 'del') {
          if (next.gi_achievements?.includes(id)) {
            const ids = own('gi_achievements', (list) => [...list!])!
            ids.splice(ids.indexOf(id), 1)
          }
          if (next.gi_achievement_times && name in next.gi_achievement_times) {
            delete own('gi_achievement_times', (t) => ({ ...t }))![name]
          }
        } else if (op === 'set' && isNumber(value)) {
          if (!next.gi_achievements?.includes(id)) {
            const ids = own('gi_achievements', (list) => [...(list ?? [])])!
            ids.push(id)
            ids.sort((x, y) => x - y)
          }
          if (value > 0) own('gi_achievement_times', (t) => ({ ...t }))![name] = value
          else if (next.gi_achievement_times && name in next.gi_achievement_times) {
            delete own('gi_achievement_times', (t) => ({ ...t }))![name]
          }
        }
        break
      }
      case 'anecdotes': {
        if (parts.length !== 2) break
        if (op === 'del' && !next.gi_anecdotes?.anecdotes[name]) break
        const book = own('gi_anecdotes', copyBook)!
        if (op === 'del') delete book.anecdotes[name]
        else if (op === 'set' && isObject(value) && isNumber(value.state)) {
          book.anecdotes[name] = {
            state: value.state,
            finishCount: isNumber(value.finishCount) ? value.finishCount : 0,
          }
        }
        break
      }
      case 'gi_tasks': {
        // The resin clock since Capture 1.12.0, every part since 1.16.0: each
        // whole, kept only when a snapshot's check would keep it.
        if (parts.length !== 2) break
        if (op === 'del') {
          if (next.gi_tasks && Object.hasOwn(next.gi_tasks, name)) {
            const tasks = own('gi_tasks', (t) => ({ ...t }))! as Record<string, unknown>
            delete tasks[name]
          }
        } else if (op === 'set') {
          const part = normalizeTaskPart(name, value)
          if (part === undefined) break
          const tasks = own('gi_tasks', (t) => ({ ...t }))! as Record<string, unknown>
          tasks[name] = part
        }
        break
      }
      case 'gi_wardrobe': {
        // The parts that move within a session (Capture 1.17.1), each whole.
        if (parts.length !== 2 || !WARDROBE_LIVE.has(name)) break
        if (op === 'del') {
          if (next.gi_wardrobe && Object.hasOwn(next.gi_wardrobe, name)) {
            const wardrobe = own('gi_wardrobe', (w) => ({ ...w }))! as Record<string, unknown>
            delete wardrobe[name]
          }
        } else if (op === 'set') {
          const part = normalizeWardrobePart(name, value)
          if (part === undefined) break
          const wardrobe = own('gi_wardrobe', (w) => ({ ...w }))! as Record<string, unknown>
          wardrobe[name] = part
        }
        break
      }
      case 'quests': {
        // One parent quest (Capture 1.17.25); kept sorted like a snapshot's lists.
        if (parts.length !== 2) break
        const id = Number(name)
        if (!Number.isInteger(id) || id < 1 || id > 999_999) break
        if (op === 'set' && value !== 0 && value !== 1) break
        if (op === 'del' && !next.gi_collections?.quests) break
        const collections = own('gi_collections', (c) => ({ ...c }))!
        const held = collections.quests
        const finished = (held?.finished ?? []).filter((q) => q !== id)
        const active = (held?.active ?? []).filter((q) => q !== id)
        if (op === 'set') {
          // A finished quest never goes back to accepted.
          if (value === 1 || held?.finished.includes(id)) insertSorted(finished, id)
          else insertSorted(active, id)
        }
        collections.quests = { finished, ...(active.length > 0 ? { active } : {}) }
        break
      }
      case 'gi_anecdotes': {
        if (parts.length !== 2 || !ANECDOTE_FIELDS.has(name)) break
        if (op === 'del' && !next.gi_anecdotes) break
        const book = own('gi_anecdotes', copyBook)! as unknown as Record<string, unknown>
        if (op === 'del') {
          if (name === 'unlockedAreas') book.unlockedAreas = []
          else delete book[name]
        } else if (op === 'set') book[name] = value
        break
      }
    }
  }
  return next
}

function insertSorted(list: number[], id: number): void {
  let at = list.findIndex((q) => q > id)
  if (at < 0) at = list.length
  list.splice(at, 0, id)
}

function copyBook(book: GiAnecdotes | undefined): GiAnecdotes {
  return book ? { ...book, anecdotes: { ...book.anecdotes } } : { anecdotes: {}, unlockedAreas: [] }
}

/** A path as one string key (what merging and counting go by). */
export function pathKey(path: DeltaPath): string {
  return JSON.stringify(path.map(String))
}

/**
 * `b`'s changes over `a`'s, applied in order, as one list: what a merged
 * stored batch holds. The last change of a path wins and moves to the end;
 * a whole-value change (an item added or deleted, a key set or dropped)
 * also drops the earlier changes inside it, so applying the result gives
 * what applying `a` then `b` gives.
 */
export function mergeChanges(
  a: readonly DeltaChange[],
  b: readonly DeltaChange[] = [],
): DeltaChange[] {
  const byPath = new Map<string, DeltaChange>()
  /** Keys of the changes inside each path (paths of 3+ parts), by that path's key. */
  const inside = new Map<string, Set<string>>()
  for (const change of [...a, ...b]) {
    const parts = change[1].map(String)
    const key = JSON.stringify(parts)
    byPath.delete(key)
    const children = inside.get(key)
    if (children) {
      for (const child of children) byPath.delete(child)
      inside.delete(key)
    }
    byPath.set(key, change)
    // Every ancestor of two parts or more learns of this path.
    for (let length = 2; length < parts.length; length++) {
      const parent = JSON.stringify(parts.slice(0, length))
      let set = inside.get(parent)
      if (!set) inside.set(parent, (set = new Set()))
      set.add(key)
    }
  }
  return [...byPath.values()]
}

/** Distinct paths in a list of changes. */
export function distinctPaths(changes: readonly DeltaChange[]): number {
  return new Set(changes.map((change) => pathKey(change[1]))).size
}

/**
 * Item guids a list of changes touches that it did not add itself: the base
 * snapshot's items the browser has to find (`bindItemGuids`).
 */
export function touchedBaseItems(
  changes: readonly DeltaChange[],
): { kind: 'artifacts' | 'weapons'; guid: string }[] {
  const added = new Set<string>()
  const touched = new Map<string, { kind: 'artifacts' | 'weapons'; guid: string }>()
  for (const [op, path] of changes) {
    const kind = String(path[0])
    if ((kind !== 'artifacts' && kind !== 'weapons') || path[1] === undefined) continue
    const guid = String(path[1])
    const key = `${kind}:${guid}`
    if (op === 'add' && path.length === 2) {
      if (!touched.has(key)) added.add(key)
    } else if (!added.has(key) && !touched.has(key)) touched.set(key, { kind, guid })
  }
  return [...touched.values()]
}

/**
 * A GOOD state in one fixed order, for comparing two states (the replay
 * check): items by guid (then content), characters by key, materials and
 * maps by key, `timestamp` left out.
 */
export function canonicalLiveGood(good: LiveGood): Record<string, unknown> {
  const sortKeys = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sortKeys)
    if (value === null || typeof value !== 'object') return value
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
    )
  }
  const byText = (a: unknown, b: unknown) => {
    const x = JSON.stringify(a)
    const y = JSON.stringify(b)
    return x < y ? -1 : x > y ? 1 : 0
  }
  const { timestamp: _timestamp, ...rest } = good
  const sorted = sortKeys(rest) as Record<string, unknown>
  for (const key of ['artifacts', 'weapons', 'characters'] as const) {
    if (Array.isArray(sorted[key])) sorted[key] = [...(sorted[key] as unknown[])].sort(byText)
  }
  return sorted
}
