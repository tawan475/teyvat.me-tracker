/**
 * The Weapons page's model. An account holds 1,000+ weapons, most of them
 * identical low-rarity copies, so copies are handled at two levels:
 *
 * - rows (stacks): unequipped copies with the same key, level, ascension,
 *   refinement and lock state collapse into one row with a count; an
 *   equipped weapon always gets its own row (the Bag's tiles, the List);
 * - groups: every row of one weapon key together, with its owners and what
 *   the spare copies could refine (the By weapon view, the details).
 *
 * Filters apply to rows, then rows are grouped, so a group shows the copies
 * that match. Pure functions, run once per inventory or filter change.
 */

import type { Good } from '@gdt/shared'
import { keyToName } from '@/lib/format'
import { characterName, gameName } from '@/i18n/game-names'
import { levelCap } from '@/lib/level'
import { weaponGameId, weaponMaxLevel, weaponMeta, type WeaponType } from './game-meta'
import { compareText, normalizeSearch } from '@/lib/search'
import { labelTable } from '@/i18n/labels'
import { t } from '@/i18n'

export type { WeaponType }

export interface WeaponRow {
  /** Stable row id: the grouping key, or the owner for an equipped weapon. */
  id: string
  key: string
  name: string
  rarity: number | null
  type: WeaponType | null
  level: number
  ascension: number
  refinement: number
  /** Character key, or '' when unequipped. */
  location: string
  ownerName: string
  lock: boolean
  count: number
  /** The weapon's level cap: 90, or 70 for 1–2★. */
  maxLevel: number
  /** EXP toward the next level (a capture's `gi_exp`; 0 when unknown). */
  exp: number
  /** The game's weapon id ("newest" sorts by it); 0 for a key the data doesn't know. */
  gameId: number
  haystack: string
}

/** What spare (unequipped) copies could do for the equipped ones. */
export interface RefineTarget {
  owner: string
  ownerName: string
  from: number
  to: number
}

export interface RefineInfo {
  /** Unequipped copies of this weapon. */
  spare: number
  targets: RefineTarget[]
}

export interface WeaponGroup {
  key: string
  name: string
  rarity: number | null
  type: WeaponType | null
  /** Matching rows: equipped copies first, then stacks by level, then refinement. */
  rows: WeaponRow[]
  /** Matching copies. */
  count: number
  owners: { key: string; name: string }[]
  /** The best matching copy (highest level, then refinement). */
  best: WeaponRow
  /** From the whole inventory, not just the matches. */
  refine: RefineInfo | null
}

export interface Armory {
  rows: WeaponRow[]
  /** Refine headroom per weapon key (only keys that have some). */
  refine: Map<string, RefineInfo>
  total: number
  /** Distinct weapon keys. */
  kinds: number
  equipped: number
  /** Copies per rarity. */
  byRarity: Map<number, number>
  /** Unequipped 5★ copies. */
  spare5: number
}

export const WEAPON_TYPES: readonly WeaponType[] = [
  'sword',
  'claymore',
  'polearm',
  'bow',
  'catalyst',
]

/** "Sword", "Claymore", … in the language on screen. */
export const WEAPON_TYPE_LABELS = labelTable<WeaponType>('weaponType')

export const MAX_REFINEMENT = 5

/** Every rarity a weapon can have, highest first (the chips and the Bag's sections). */
export const WEAPON_RARITIES = [5, 4, 3, 2, 1] as const

const SMALL_WORDS = /(?<= )(Of|The|And|An|In|To|For|From|On|At|By|With)(?= )/g

/**
 * Weapon and artifact set names from their GOOD keys, with the small words
 * of a title back in lower case: "FragmentOfHarmonicWhimsy" -> "Fragment of
 * Harmonic Whimsy". (Apostrophes and hyphens are gone from GOOD keys.)
 */
export function itemName(key: string): string {
  return gameName(
    'weapons',
    key,
    keyToName(key).replace(SMALL_WORDS, (word) => word.toLowerCase()),
  )
}

const normalize = normalizeSearch

/**
 * Spare copies feed equipped ones: a copy of refinement N adds N ranks. The
 * most refined equipped copy is finished first. 1–2★ weapons do not refine.
 */
function refineInfo(rows: readonly WeaponRow[]): RefineInfo | null {
  const rarity = rows[0]?.rarity ?? null
  if (rarity !== null && rarity < 3) return null
  let pool = 0
  let spare = 0
  const equipped: WeaponRow[] = []
  for (const row of rows) {
    if (row.location) equipped.push(row)
    else {
      spare += row.count
      pool += row.refinement * row.count
    }
  }
  const targets: RefineTarget[] = []
  equipped
    .filter((r) => r.refinement < MAX_REFINEMENT)
    .sort((a, b) => b.refinement - a.refinement || b.level - a.level)
    .forEach((r) => {
      const gain = Math.min(MAX_REFINEMENT - r.refinement, pool)
      if (gain <= 0) return
      pool -= gain
      targets.push({
        owner: r.location,
        ownerName: r.ownerName,
        from: r.refinement,
        to: r.refinement + gain,
      })
    })
  return targets.length ? { spare, targets } : null
}

/**
 * Rows, refine headroom and headline counts. `gameId` is the weapon's game
 * id (the default reads the game data's catalog; tests pass their own).
 */
export function buildArmory(good: Good, gameId: (key: string) => number = weaponGameId): Armory {
  const rows = new Map<string, WeaponRow>()
  let equipped = 0
  const byRarity = new Map<number, number>()
  let spare5 = 0
  good.weapons.forEach((w, index) => {
    const meta = weaponMeta(w.key)
    const rarity = meta?.[0] ?? null
    if (rarity !== null) byRarity.set(rarity, (byRarity.get(rarity) ?? 0) + 1)
    if (w.location) equipped++
    else if (rarity === 5) spare5++
    const id = w.location
      ? `equipped:${w.location}:${index}`
      : `${w.key}:${w.level}:${w.ascension}:${w.refinement}:${w.lock ? 1 : 0}:${w.gi_exp ?? 0}`
    const existing = rows.get(id)
    if (existing) {
      existing.count++
      return
    }
    const name = itemName(w.key)
    const type = meta?.[1] ?? null
    const ownerName = w.location ? characterName(w.location) : ''
    rows.set(id, {
      id,
      key: w.key,
      name,
      rarity,
      type,
      level: w.level,
      ascension: w.ascension,
      refinement: w.refinement,
      location: w.location,
      ownerName,
      lock: w.lock,
      count: 1,
      maxLevel: weaponMaxLevel(w.key, rarity),
      exp: w.gi_exp ?? 0,
      gameId: gameId(w.key),
      haystack: normalize(`${name} ${w.key} ${ownerName} ${type ? WEAPON_TYPE_LABELS[type] : ''}`),
    })
  })

  const list = [...rows.values()]
  const byKey = new Map<string, WeaponRow[]>()
  for (const row of list) {
    const same = byKey.get(row.key)
    if (same) same.push(row)
    else byKey.set(row.key, [row])
  }
  const refine = new Map<string, RefineInfo>()
  for (const [key, same] of byKey) {
    const info = refineInfo(same)
    if (info) refine.set(key, info)
  }

  return {
    rows: list,
    refine,
    total: good.weapons.length,
    kinds: byKey.size,
    equipped,
    byRarity,
    spare5,
  }
}

/**
 * The order of one weapon's copies (By weapon chips, the details): equipped
 * copies first, then the highest level, then the highest refinement.
 */
export function compareCopies(a: WeaponRow, b: WeaponRow): number {
  return (
    Number(b.location !== '') - Number(a.location !== '') ||
    b.level - a.level ||
    b.refinement - a.refinement ||
    Number(b.lock) - Number(a.lock) ||
    compareText(a.ownerName, b.ownerName)
  )
}

/** The best copy: highest level, then refinement (equipped wins a tie). */
function compareBest(a: WeaponRow, b: WeaponRow): number {
  return b.level - a.level || b.refinement - a.refinement || compareCopies(a, b)
}

/** Groups (already filtered) rows by weapon key. */
export function groupWeapons(
  rows: readonly WeaponRow[],
  refine: ReadonlyMap<string, RefineInfo>,
): WeaponGroup[] {
  const byKey = new Map<string, WeaponRow[]>()
  for (const row of rows) {
    const same = byKey.get(row.key)
    if (same) same.push(row)
    else byKey.set(row.key, [row])
  }
  return [...byKey].map(([key, same]) => {
    same.sort(compareCopies)
    const first = same[0]!
    let best = first
    for (const row of same) if (compareBest(row, best) < 0) best = row
    return {
      key,
      name: first.name,
      rarity: first.rarity,
      type: first.type,
      rows: same,
      count: same.reduce((sum, r) => sum + r.count, 0),
      owners: same.filter((r) => r.location).map((r) => ({ key: r.location, name: r.ownerName })),
      best,
      refine: refine.get(key) ?? null,
    }
  })
}

/**
 * A weapon the account doesn't own, as the dialog shows it bare (the user's
 * ask, 2026-11-04): one imagined copy at its level cap, R1, held by no one,
 * so the passive, stats and lore have a level to read at. Null for a key the
 * game data doesn't know.
 */
export function bareWeaponGroup(key: string): WeaponGroup | null {
  const meta = weaponMeta(key)
  if (!meta) return null
  const [rarity, type] = meta
  const name = itemName(key)
  const maxLevel = weaponMaxLevel(key, rarity)
  const row: WeaponRow = {
    id: key,
    key,
    name,
    rarity,
    type,
    level: maxLevel,
    ascension: maxLevel >= 90 ? 6 : 4,
    refinement: 1,
    location: '',
    ownerName: '',
    lock: false,
    count: 0,
    maxLevel,
    exp: 0,
    gameId: weaponGameId(key),
    haystack: normalize(`${name} ${key}`),
  }
  return { key, name, rarity, type, rows: [], count: 0, owners: [], best: row, refine: null }
}

/** "Favonius Greatsword · R1 · Lv 1/20 · 55 copies · Locked", for tooltips. */
export function weaponTitle(row: WeaponRow): string {
  return [
    row.name,
    `R${row.refinement}`,
    t('weapons.title.level', { level: row.level, cap: levelCap(row.ascension, row.level) }),
    row.count > 1 ? t('weapons.title.copies', { n: row.count }, row.count) : '',
    row.ownerName,
    row.lock ? t('weapons.title.locked') : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

// ------------------------------------------------------------ filter & sort

export type WeaponSort = 'quality' | 'level' | 'refinement' | 'count' | 'name' | 'type'
export type SortDirection = 'asc' | 'desc'

export const WEAPON_SORTS: { value: WeaponSort; label: string; natural: SortDirection }[] = [
  {
    value: 'quality',
    get label() {
      return t('weapons.sort.quality')
    },
    natural: 'desc',
  },
  {
    value: 'level',
    get label() {
      return t('weapons.sort.level')
    },
    natural: 'desc',
  },
  {
    value: 'refinement',
    get label() {
      return t('weapons.sort.refinement')
    },
    natural: 'desc',
  },
  {
    value: 'count',
    get label() {
      return t('weapons.sort.count')
    },
    natural: 'desc',
  },
  {
    value: 'name',
    get label() {
      return t('weapons.sort.name')
    },
    natural: 'asc',
  },
  {
    value: 'type',
    get label() {
      return t('weapons.sort.type')
    },
    natural: 'asc',
  },
]

export type RarityFilter = 'all' | 1 | 2 | 3 | 4 | 5
export type LevelFilter = 'all' | 'max' | 'levelled' | 'base'
export type StatusFilter = 'all' | 'equipped' | 'unequipped'
export type LockFilter = 'all' | 'locked' | 'unlocked'

export interface WeaponFilters {
  query: string
  status: StatusFilter
  lock: LockFilter
  rarity: RarityFilter
  type: WeaponType | 'all'
  level: LevelFilter
  refinable: boolean
}

export const NO_WEAPON_FILTERS: WeaponFilters = {
  query: '',
  status: 'all',
  lock: 'all',
  rarity: 'all',
  type: 'all',
  level: 'all',
  refinable: false,
}

export const LEVEL_OPTIONS: { value: LevelFilter; label: string }[] = [
  {
    value: 'all',
    get label() {
      return t('weapons.levelFilter.all')
    },
  },
  {
    value: 'max',
    get label() {
      return t('weapons.levelFilter.max')
    },
  },
  {
    value: 'levelled',
    get label() {
      return t('weapons.levelFilter.levelled')
    },
  },
  {
    value: 'base',
    get label() {
      return t('weapons.levelFilter.base')
    },
  },
]

export function hasWeaponFilters(f: WeaponFilters): boolean {
  return (
    f.query.trim() !== '' ||
    f.status !== 'all' ||
    f.lock !== 'all' ||
    f.rarity !== 'all' ||
    f.type !== 'all' ||
    f.level !== 'all' ||
    f.refinable
  )
}

/** "Max" is the weapon's own cap (70 for 1–2★), not a flat 90. */
export function levelMatches(row: Pick<WeaponRow, 'level' | 'maxLevel'>, wanted: LevelFilter) {
  if (wanted === 'max') return row.level >= row.maxLevel
  if (wanted === 'levelled') return row.level > 1
  if (wanted === 'base') return row.level <= 1
  return true
}

/** Facets whose chips show "matches if you pick this" counts. */
export type WeaponFacet = 'type' | 'rarity'

export function filterWeapons(
  rows: readonly WeaponRow[],
  f: WeaponFilters,
  refine: ReadonlyMap<string, RefineInfo>,
  except?: WeaponFacet,
): WeaponRow[] {
  const words = normalize(f.query).split(' ').filter(Boolean)
  return rows.filter(
    (r) =>
      (f.status === 'all' || (f.status === 'equipped') === (r.location !== '')) &&
      (f.lock === 'all' || (f.lock === 'locked') === r.lock) &&
      (except === 'type' || f.type === 'all' || r.type === f.type) &&
      (except === 'rarity' || f.rarity === 'all' || r.rarity === f.rarity) &&
      levelMatches(r, f.level) &&
      (!f.refinable || refine.has(r.key)) &&
      words.every((w) => r.haystack.includes(w)),
  )
}

/** Copies per facet value, with every other filter applied. */
export function weaponFacetCounts<K>(
  rows: readonly WeaponRow[],
  f: WeaponFilters,
  refine: ReadonlyMap<string, RefineInfo>,
  facet: WeaponFacet,
  value: (r: WeaponRow) => K,
): Map<K, number> {
  const counts = new Map<K, number>()
  for (const r of filterWeapons(rows, f, refine, facet)) {
    const k = value(r)
    counts.set(k, (counts.get(k) ?? 0) + r.count)
  }
  return counts
}

const typeIndex = (type: WeaponType | null) =>
  type === null ? WEAPON_TYPES.length : WEAPON_TYPES.indexOf(type)

/** Each written low to high; the sort's direction flips it. */
const compareRows: Record<WeaponSort, (a: WeaponRow, b: WeaponRow) => number> = {
  // The game's "Quality": rarity, level, refinement, then the newest weapon.
  quality: (a, b) =>
    (a.rarity ?? 0) - (b.rarity ?? 0) ||
    a.level - b.level ||
    a.refinement - b.refinement ||
    a.gameId - b.gameId,
  level: (a, b) => a.level - b.level || a.ascension - b.ascension,
  refinement: (a, b) => a.refinement - b.refinement,
  count: (a, b) => a.count - b.count,
  name: (a, b) => compareText(a.name, b.name),
  type: (a, b) => typeIndex(a.type) - typeIndex(b.type),
}

/** Ties fall back to quality (best first), then name, equipped first, then owner. */
export function sortWeapons(
  rows: readonly WeaponRow[],
  sort: WeaponSort,
  direction: SortDirection,
): WeaponRow[] {
  const sign = direction === 'asc' ? 1 : -1
  const primary = compareRows[sort]
  return [...rows].sort(
    (a, b) =>
      sign * primary(a, b) ||
      compareRows.quality(b, a) ||
      compareRows.name(a, b) ||
      Number(b.location !== '') - Number(a.location !== '') ||
      Number(b.lock) - Number(a.lock) ||
      compareText(a.ownerName, b.ownerName),
  )
}

const compareGroups: Record<WeaponSort, (a: WeaponGroup, b: WeaponGroup) => number> = {
  quality: (a, b) => compareRows.quality(a.best, b.best),
  level: (a, b) => compareRows.level(a.best, b.best),
  refinement: (a, b) => a.best.refinement - b.best.refinement,
  count: (a, b) => a.count - b.count,
  name: (a, b) => compareText(a.name, b.name),
  type: (a, b) => typeIndex(a.type) - typeIndex(b.type),
}

/** Ties: quality (best copy, best first), then equipped copies, then name. */
export function sortGroups(
  groups: readonly WeaponGroup[],
  sort: WeaponSort,
  direction: SortDirection,
): WeaponGroup[] {
  const sign = direction === 'asc' ? 1 : -1
  const primary = compareGroups[sort]
  return [...groups].sort(
    (a, b) =>
      sign * primary(a, b) ||
      compareGroups.quality(b, a) ||
      b.owners.length - a.owners.length ||
      compareGroups.name(a, b),
  )
}

export interface RaritySection {
  /** 0 for weapons the game data doesn't know. */
  rarity: number
  rows: WeaponRow[]
  copies: number
}

/**
 * Sorted rows split by rarity, keeping their order inside each section:
 * the Bag's sections, highest rarity first (lowest first for Quality
 * ascending, so the order reads the same way).
 */
export function raritySections(sorted: readonly WeaponRow[], lowestFirst = false): RaritySection[] {
  const byRarity = new Map<number, RaritySection>()
  for (const row of sorted) {
    const rarity = row.rarity ?? 0
    let section = byRarity.get(rarity)
    if (!section) {
      section = { rarity, rows: [], copies: 0 }
      byRarity.set(rarity, section)
    }
    section.rows.push(row)
    section.copies += row.count
  }
  // Unknown weapons (rarity 0) always last.
  const rank = (r: number) => (r === 0 ? -Infinity : lowestFirst ? -r : r)
  return [...byRarity.values()].sort((a, b) => rank(b.rarity) - rank(a.rarity))
}

// ------------------------------------------------------------- stored state
// The page keeps filters per account and sort/view per device (lib/storage);
// these turn whatever was stored into valid values. No storage here: the
// Planner's model imports this module, and its tests run without a DOM.

export type WeaponView = 'bag' | 'weapon' | 'list'

const STATUS: readonly StatusFilter[] = ['all', 'equipped', 'unequipped']
const LOCKS: readonly LockFilter[] = ['all', 'locked', 'unlocked']
const LEVELS: readonly LevelFilter[] = ['all', 'max', 'levelled', 'base']

function oneOf<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

/** Whatever was stored, as valid filters (old or hand-edited values fall back). */
export function sanitizeWeaponFilters(value: unknown): WeaponFilters {
  if (!value || typeof value !== 'object') return { ...NO_WEAPON_FILTERS }
  const v = value as Record<string, unknown>
  return {
    query: typeof v.query === 'string' ? v.query.slice(0, 100) : '',
    status: oneOf(v.status, STATUS, 'all'),
    lock: oneOf(v.lock, LOCKS, 'all'),
    rarity: oneOf<RarityFilter>(v.rarity, ['all', ...WEAPON_RARITIES], 'all'),
    type: oneOf<WeaponType | 'all'>(v.type, ['all', ...WEAPON_TYPES], 'all'),
    level: oneOf(v.level, LEVELS, 'all'),
    refinable: v.refinable === true,
  }
}

export interface WeaponPrefs {
  sort: WeaponSort
  direction: SortDirection
  view: WeaponView
}

/** Stored sort and view, valid. Older saves: "rarity" is now Quality, "grid" the Bag. */
export function sanitizeWeaponPrefs(value: unknown): WeaponPrefs {
  const saved = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const sort = oneOf<WeaponSort>(
    saved.sort === 'rarity' ? 'quality' : saved.sort,
    WEAPON_SORTS.map((s) => s.value),
    'quality',
  )
  return {
    sort,
    direction: oneOf<SortDirection>(saved.direction, ['asc', 'desc'], 'desc'),
    view: oneOf<WeaponView>(saved.view, ['bag', 'weapon', 'list'], 'bag'),
  }
}
