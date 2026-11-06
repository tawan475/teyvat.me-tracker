/**
 * The artifacts page's data: rows derived once per inventory, then filtered
 * and sorted with plain functions. Nothing here touches Vue, storage or the
 * network (artifact-prefs.ts stores the page's choices).
 */

import { calculateCV, calculateRV, type GoodArtifact, type LiveArtifact } from '@gdt/shared'
import { characterName } from '@/i18n/game-names'
import { inferArtifactRolls, maxLevel, type InferredRoll } from '@/utils/artifact-rolls'
import { formatSetName, formatSlotName, formatStatName } from '@/utils/artifact-stats'
import { artifactPotential, type Potential } from './artifact-potential'
import { compareText } from '@/lib/search'
import { t } from '@/i18n'
import { yieldToMain } from '@/lib/yield'

export const SLOT_KEYS = ['flower', 'plume', 'sands', 'goblet', 'circlet'] as const
export type SlotKey = (typeof SLOT_KEYS)[number]

/** Every rarity an artifact can have, highest first (chips, the Bag's groups). */
export const ARTIFACT_RARITIES = [5, 4, 3, 2, 1] as const

/** Substats the filter knows, in its chip order; a row's mask has bit i for SUBSTAT_KEYS[i]. */
export const SUBSTAT_KEYS = [
  'critRate_',
  'critDMG_',
  'atk_',
  'hp_',
  'def_',
  'eleMas',
  'enerRech_',
  'atk',
  'hp',
  'def',
] as const

/** Bits of the substats `keys` (unknown keys add nothing). */
export function substatMask(keys: Iterable<string>): number {
  let mask = 0
  for (const key of keys) {
    const bit = SUBSTAT_KEYS.indexOf(key as (typeof SUBSTAT_KEYS)[number])
    if (bit >= 0) mask |= 1 << bit
  }
  return mask
}

export interface ArtifactRow {
  /** Position in the snapshot: stable for one inventory, used as the list key. */
  id: number
  /**
   * The account catalog's id for this exact piece (-1 when unknown). A piece
   * that levels up gets a new one, so higher means newer or changed.
   */
  catalogId: number
  artifact: GoodArtifact
  setName: string
  /** Wearer's name, '' when unequipped. */
  ownerName: string
  /** Index into SLOT_KEYS (5 for anything unexpected), for sorting. */
  slotIndex: number
  cv: number
  rv: number
  /** Inferred rolls per substat, same order as `artifact.substats`. */
  rolls: InferredRoll[][]
  /** Total rolls: the exported count when known, else the inferred sum. */
  rollCount: number
  /** Active substat lines (a 3-liner at +0 has 3). */
  lines: number
  /** Substats it has or will open (the unactivated line counts), as SUBSTAT_KEYS bits. */
  subMask: number
  potential: Potential
  equipped: boolean
  /** Unlocked, unequipped 3★ or 4★: what the game lets you feed to others. */
  feedable: boolean
  maxed: boolean
  /** Lower-case text the search box matches against. */
  haystack: string
}

const rowCache = new WeakMap<readonly GoodArtifact[], ArtifactRow[]>()

export function isFeedable(artifact: GoodArtifact): boolean {
  return (
    !artifact.lock && artifact.location === '' && (artifact.rarity === 3 || artifact.rarity === 4)
  )
}

/**
 * Derives everything the page filters, sorts and shows. Cached per artifact
 * array. `catalogIds` (same order) come with the inventory.
 */
export function buildArtifactRows(
  artifacts: readonly GoodArtifact[],
  catalogIds: readonly number[] = [],
): ArtifactRow[] {
  const hit = rowCache.get(artifacts)
  if (hit) return hit
  const rows = artifacts.map((artifact, id): ArtifactRow => {
    const rolls = inferArtifactRolls(artifact)
    const setName = formatSetName(artifact.setKey)
    const slotIndex = SLOT_KEYS.indexOf(artifact.slotKey as SlotKey)
    const inferred = rolls.reduce((sum, r) => sum + r.length, 0)
    const ownerName = artifact.location ? characterName(artifact.location) : ''
    const rv = calculateRV(artifact.substats)
    const inactive = artifact.unactivatedSubstats ?? []
    return {
      id,
      catalogId: catalogIds[id] ?? -1,
      artifact,
      setName,
      ownerName,
      slotIndex: slotIndex === -1 ? SLOT_KEYS.length : slotIndex,
      cv: calculateCV(artifact.substats),
      rv,
      rolls,
      rollCount: artifact.totalRolls && artifact.totalRolls > 0 ? artifact.totalRolls : inferred,
      lines: artifact.substats.length,
      subMask: substatMask([...artifact.substats, ...inactive].map((s) => s.key)),
      potential: artifactPotential(artifact, rv),
      equipped: artifact.location !== '',
      feedable: isFeedable(artifact),
      maxed: artifact.level >= maxLevel(artifact.rarity),
      haystack: [
        setName,
        artifact.setKey,
        ownerName,
        formatSlotName(artifact.slotKey),
        formatStatName(artifact.mainStatKey),
      ]
        .join(' ')
        .toLowerCase(),
    }
  })
  rowCache.set(artifacts, rows)
  return rows
}

/**
 * The inventory once its rows are derived (`buildArtifactRows`), in a task
 * before the one that renders them: thousands of pieces' CV, RV and rolls.
 * The same promise per inventory promise, so a page whose data is loaded
 * still renders on its first frame (see use-resource).
 */
interface RowsSource {
  good: { artifacts: readonly GoodArtifact[] }
  artifactIds: readonly number[]
}
const withRowsCache = new WeakMap<Promise<unknown>, Promise<unknown>>()
export function withArtifactRows<T extends RowsSource | null>(load: Promise<T>): Promise<T> {
  let entry = withRowsCache.get(load) as Promise<T> | undefined
  if (!entry) {
    entry = load.then(async (inventory) => {
      if (inventory) {
        await yieldToMain()
        buildArtifactRows(inventory.good.artifacts, inventory.artifactIds)
      }
      return inventory
    })
    withRowsCache.set(load, entry)
  }
  return entry
}

/** "Gladiator's Finale · Flower +20 · HP · CV 32.6 · RV 640% · Hu Tao · Locked", for tooltips. */
export function artifactLabel(row: ArtifactRow, isNew = false): string {
  const a = row.artifact
  return [
    row.setName,
    `${formatSlotName(a.slotKey)} +${a.level}`,
    `${a.rarity}★`,
    formatStatName(a.mainStatKey),
    `CV ${row.cv.toFixed(1)}`,
    `RV ${row.rv}%`,
    row.ownerName,
    a.lock ? t('artifacts.label.locked') : '',
    a.astralMark ? t('artifacts.label.astralMark') : '',
    isNew ? t('artifacts.label.new') : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

// ------------------------------------------------------------------ filters

export type LockFilter = 'any' | 'locked' | 'unlocked'
export type EquipFilter = 'any' | 'equipped' | 'inventory'
export type AstralFilter = 'any' | 'marked' | 'unmarked'
export type ElixirFilter = 'any' | 'yes' | 'no'
/** Active substat lines: 0 for any. */
export type LinesFilter = 0 | 3 | 4
export type ArtifactSort = 'quality' | 'cv' | 'rv' | 'potential' | 'level' | 'set' | 'recent'

export interface ArtifactFilters {
  search: string
  sets: string[]
  slots: SlotKey[]
  /** '' for any main stat. */
  mainStat: string
  /** Substats a piece must all have (an unactivated line counts). */
  substats: string[]
  lines: LinesFilter
  rarities: number[]
  levelMin: number
  levelMax: number
  lock: LockFilter
  equipped: EquipFilter
  /** Worn by any of these characters (keys); empty for anyone. */
  owners: string[]
  astral: AstralFilter
  elixir: ElixirFilter
  /** Only pieces the previous capture didn't have (new or levelled since). */
  fresh: boolean
  /** Keep only the top {@link BEST_PER_SLOT} of each slot (by the sort), grouped by slot. */
  best: boolean
  sort: ArtifactSort
  descending: boolean
}

export const LEVEL_MIN = 0
export const LEVEL_MAX = 20

export function defaultFilters(): ArtifactFilters {
  return {
    search: '',
    sets: [],
    slots: [],
    mainStat: '',
    substats: [],
    lines: 0,
    rarities: [],
    levelMin: LEVEL_MIN,
    levelMax: LEVEL_MAX,
    lock: 'any',
    equipped: 'any',
    owners: [],
    astral: 'any',
    elixir: 'any',
    fresh: false,
    best: false,
    sort: 'cv',
    descending: true,
  }
}

/** Every filter back to "any", keeping the sort. */
export function clearedFilters(current: ArtifactFilters): ArtifactFilters {
  return { ...defaultFilters(), sort: current.sort, descending: current.descending }
}

const fullLevels = (f: ArtifactFilters) => f.levelMin === LEVEL_MIN && f.levelMax === LEVEL_MAX

/**
 * The "4★/3★ Artifact" preset: unlocked, unequipped 3★–4★ (the same rule as
 * the snapshot summary's artifact3/artifact4 counts). It combines with the
 * other filters, so "4★/3★ of this set" works.
 */
export function isFeedablePreset(f: ArtifactFilters): boolean {
  return (
    f.lock === 'unlocked' &&
    f.equipped === 'inventory' &&
    f.rarities.length === 2 &&
    f.rarities.includes(3) &&
    f.rarities.includes(4)
  )
}

/** Turns the preset on, or off again (back to any lock, location and rarity). */
export function toggleFeedablePreset(f: ArtifactFilters): ArtifactFilters {
  return isFeedablePreset(f)
    ? { ...f, lock: 'any', equipped: 'any', rarities: [] }
    : { ...f, lock: 'unlocked', equipped: 'inventory', rarities: [4, 3] }
}

/** The "+0 5★" preset: unequipped 5★ at level 0, locked or not. */
export function isZeroPreset(f: ArtifactFilters): boolean {
  return (
    f.equipped === 'inventory' &&
    f.rarities.length === 1 &&
    f.rarities[0] === 5 &&
    f.levelMin === 0 &&
    f.levelMax === 0
  )
}

export function toggleZeroPreset(f: ArtifactFilters): ArtifactFilters {
  return isZeroPreset(f)
    ? { ...f, equipped: 'any', rarities: [], levelMin: LEVEL_MIN, levelMax: LEVEL_MAX }
    : { ...f, lock: 'any', equipped: 'inventory', rarities: [5], levelMin: 0, levelMax: 0 }
}

/** The "Spare 5★" preset: unequipped 5★ at any level, locked or not. */
export function isSparePreset(f: ArtifactFilters): boolean {
  return (
    f.lock === 'any' &&
    f.equipped === 'inventory' &&
    f.rarities.length === 1 &&
    f.rarities[0] === 5 &&
    fullLevels(f)
  )
}

/** Turns the preset on (replacing the other presets' fields), or off again. */
export function toggleSparePreset(f: ArtifactFilters): ArtifactFilters {
  return isSparePreset(f)
    ? { ...f, lock: 'any', equipped: 'any', rarities: [] }
    : {
        ...f,
        lock: 'any',
        equipped: 'inventory',
        rarities: [5],
        levelMin: LEVEL_MIN,
        levelMax: LEVEL_MAX,
      }
}

export function isSpare(row: ArtifactRow): boolean {
  return !row.equipped && row.artifact.rarity === 5
}

/** Pieces per slot the "Best" preset keeps. */
export const BEST_PER_SLOT = 8

/**
 * The first `perSlot` rows of each slot, slot by slot (flower first). The
 * input is already sorted, so each slot keeps its best by the current sort.
 */
export function bestPerSlot(
  sorted: readonly ArtifactRow[],
  perSlot = BEST_PER_SLOT,
): ArtifactRow[] {
  const buckets: ArtifactRow[][] = Array.from({ length: SLOT_KEYS.length + 1 }, () => [])
  for (const row of sorted) {
    const bucket = buckets[row.slotIndex]!
    if (bucket.length < perSlot) bucket.push(row)
  }
  return buckets.flat()
}

export type Facet =
  | 'search'
  | 'sets'
  | 'slots'
  | 'mainStat'
  | 'substats'
  | 'lines'
  | 'rarities'
  | 'level'
  | 'lock'
  | 'equipped'
  | 'owners'
  | 'astral'
  | 'elixir'
  | 'fresh'

/** How many filters narrow the list (a set or slot list counts once). */
export function activeFilterCount(f: ArtifactFilters): number {
  let count = 0
  if (f.search.trim()) count++
  if (f.sets.length) count++
  if (f.slots.length) count++
  if (f.mainStat) count++
  if (f.substats.length) count++
  if (f.lines) count++
  if (f.rarities.length) count++
  if (!fullLevels(f)) count++
  if (f.lock !== 'any') count++
  if (f.equipped !== 'any') count++
  if (f.owners.length) count++
  if (f.astral !== 'any') count++
  if (f.elixir !== 'any') count++
  if (f.fresh) count++
  if (f.best) count++
  return count
}

/** True when the piece is not in the previous capture (`previous` null: none is). */
export function isNewPiece(row: ArtifactRow, previous: ReadonlySet<number> | null): boolean {
  return previous !== null && row.catalogId >= 0 && !previous.has(row.catalogId)
}

/**
 * The row in `rows` that is the same piece as `was` (from an older read of
 * the inventory), or null when it is gone. Found by its catalog id, else by
 * the game's item id (`gi_guid`: a piece that levelled up has a new catalog
 * id). Keeps the artifact dialog on its piece across a live update.
 */
export function samePiece(rows: readonly ArtifactRow[], was: ArtifactRow): ArtifactRow | null {
  if (was.catalogId >= 0) {
    const byCatalog = rows.find((r) => r.catalogId === was.catalogId)
    if (byCatalog) return byCatalog
  }
  const guid = (was.artifact as LiveArtifact).gi_guid
  return guid ? (rows.find((r) => (r.artifact as LiveArtifact).gi_guid === guid) ?? null) : null
}

/**
 * Compiles the filters into one predicate. `except` leaves a facet out, which
 * is how each filter's option counts reflect all the other filters.
 * `previous` is the previous capture's catalog ids, for "New".
 */
export function compileFilter(
  f: ArtifactFilters,
  except?: Facet,
  previous: ReadonlySet<number> | null = null,
): (row: ArtifactRow) => boolean {
  const terms = except === 'search' ? [] : f.search.toLowerCase().split(/\s+/).filter(Boolean)
  const sets = except === 'sets' || f.sets.length === 0 ? null : new Set(f.sets)
  const slots = except === 'slots' || f.slots.length === 0 ? null : new Set<string>(f.slots)
  const mainStat = except === 'mainStat' ? '' : f.mainStat
  const subMask = except === 'substats' ? 0 : substatMask(f.substats)
  const lines = except === 'lines' ? 0 : f.lines
  const rarities = except === 'rarities' || f.rarities.length === 0 ? null : new Set(f.rarities)
  const levelMin = except === 'level' ? LEVEL_MIN : f.levelMin
  const levelMax = except === 'level' ? LEVEL_MAX : f.levelMax
  const lock = except === 'lock' ? 'any' : f.lock
  const equipped = except === 'equipped' ? 'any' : f.equipped
  const owners = except === 'owners' || f.owners.length === 0 ? null : new Set(f.owners)
  const astral = except === 'astral' ? 'any' : f.astral
  const elixir = except === 'elixir' ? 'any' : f.elixir
  const fresh = except !== 'fresh' && f.fresh

  return (row) => {
    const a = row.artifact
    if (sets && !sets.has(a.setKey)) return false
    if (slots && !slots.has(a.slotKey)) return false
    if (mainStat && a.mainStatKey !== mainStat) return false
    if ((row.subMask & subMask) !== subMask) return false
    if (lines && row.lines !== lines) return false
    if (rarities && !rarities.has(a.rarity)) return false
    if (a.level < levelMin || a.level > levelMax) return false
    if (lock !== 'any' && a.lock !== (lock === 'locked')) return false
    if (equipped !== 'any' && row.equipped !== (equipped === 'equipped')) return false
    if (owners && !owners.has(a.location)) return false
    if (astral !== 'any' && !!a.astralMark !== (astral === 'marked')) return false
    if (elixir !== 'any' && !!a.elixirCrafted !== (elixir === 'yes')) return false
    if (fresh && !isNewPiece(row, previous)) return false
    for (const term of terms) if (!row.haystack.includes(term)) return false
    return true
  }
}

/** An option in a picker (sets, characters). */
export interface SetOption {
  key: string
  name: string
  /** Matches with every other filter applied. */
  count: number
}

/** Option counts for one facet, over the rows every other filter lets through. */
export function facetCounts<K>(
  rows: readonly ArtifactRow[],
  f: ArtifactFilters,
  facet: Facet,
  key: (row: ArtifactRow) => K,
  previous: ReadonlySet<number> | null = null,
): Map<K, number> {
  const matches = compileFilter(f, facet, previous)
  const counts = new Map<K, number>()
  for (const row of rows) {
    if (!matches(row)) continue
    const k = key(row)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return counts
}

// --------------------------------------------------------------------- sort

export const SORT_OPTIONS: { value: ArtifactSort; label: string; title: string }[] = [
  {
    value: 'quality',
    get label() {
      return t('artifacts.sort.quality')
    },
    get title() {
      return t('artifacts.sortTitle.quality')
    },
  },
  {
    value: 'cv',
    get label() {
      return t('artifacts.sort.cv')
    },
    get title() {
      return t('artifacts.sortTitle.cv')
    },
  },
  {
    value: 'rv',
    get label() {
      return t('artifacts.sort.rv')
    },
    get title() {
      return t('artifacts.sortTitle.rv')
    },
  },
  {
    value: 'potential',
    get label() {
      return t('artifacts.sort.potential')
    },
    get title() {
      return t('artifacts.sortTitle.potential')
    },
  },
  {
    value: 'level',
    get label() {
      return t('artifacts.sort.level')
    },
    get title() {
      return t('artifacts.sortTitle.level')
    },
  },
  {
    value: 'set',
    get label() {
      return t('artifacts.sort.set')
    },
    get title() {
      return t('artifacts.sortTitle.set')
    },
  },
  {
    value: 'recent',
    get label() {
      return t('artifacts.sort.recent')
    },
    get title() {
      return t('artifacts.sortTitle.recent')
    },
  },
]

/** Natural direction: numbers high to low, names A to Z. */
export function defaultDescending(sort: ArtifactSort): boolean {
  return sort !== 'set'
}

type Compare = (a: ArtifactRow, b: ArtifactRow) => number

const byCv: Compare = (a, b) => b.cv - a.cv
const byRv: Compare = (a, b) => b.rv - a.rv
const byLevel: Compare = (a, b) => b.artifact.level - a.artifact.level
const byRarity: Compare = (a, b) => b.artifact.rarity - a.artifact.rarity
const bySet: Compare = (a, b) => compareText(a.setName, b.setName) || a.slotIndex - b.slotIndex
const byRecent: Compare = (a, b) => b.catalogId - a.catalogId
const byExpected: Compare = (a, b) =>
  b.potential.expectedCv - a.potential.expectedCv || b.potential.bestCv - a.potential.bestCv
/** Equipped first, by wearer. */
const byLocation: Compare = (a, b) =>
  Number(b.equipped) - Number(a.equipped) || compareText(a.ownerName, b.ownerName)
const byLineCount: Compare = (a, b) =>
  b.lines +
  (b.artifact.unactivatedSubstats?.length ?? 0) -
  (a.lines + (a.artifact.unactivatedSubstats?.length ?? 0))

const ORDER: Record<ArtifactSort, Compare[]> = {
  // The game's "Quality": rarity, level, set, location, lines, then newest.
  quality: [byRarity, byLevel, bySet, byLocation, byLineCount, byRecent],
  cv: [byCv, byRv, byLevel],
  rv: [byRv, byCv, byLevel],
  potential: [byExpected, byCv, byLevel],
  level: [byLevel, byRarity, byCv],
  set: [bySet, byCv],
  recent: [byRecent],
}

/**
 * A sorted copy. Filtering a sorted list keeps it sorted, so this runs only
 * when the sort changes, not on every filter change.
 */
export function sortRows(
  rows: readonly ArtifactRow[],
  sort: ArtifactSort,
  descending: boolean,
): ArtifactRow[] {
  const steps = ORDER[sort]
  // Each comparator is written for its natural direction.
  const flip = descending === defaultDescending(sort) ? 1 : -1
  return [...rows].sort((a, b) => {
    for (const step of steps) {
      const result = step(a, b)
      if (result !== 0) return result * flip
    }
    return a.id - b.id
  })
}

/** Sorted rows split by rarity, order kept inside each: highest rarity first. */
export function rarityGroups(
  sorted: readonly ArtifactRow[],
): { rarity: number; rows: ArtifactRow[] }[] {
  const groups = new Map<number, ArtifactRow[]>()
  for (const row of sorted) {
    const list = groups.get(row.artifact.rarity)
    if (list) list.push(row)
    else groups.set(row.artifact.rarity, [row])
  }
  return [...groups].sort((a, b) => b[0] - a[0]).map(([rarity, rows]) => ({ rarity, rows }))
}

// ------------------------------------------------------------- set summary

/** One set across the current matches: how many pieces, and the best per slot. */
export interface SetSummary {
  key: string
  name: string
  count: number
  /** Pieces per slot, in SLOT_KEYS order. */
  slotCounts: number[]
  /** Highest-CV piece per slot (ties by RV), null where the set has none. */
  best: (ArtifactRow | null)[]
  /** The best pieces' CV added up: roughly "how good a full set could be". */
  score: number
}

/** Sets in `rows`, best score first. */
export function summarizeSets(rows: readonly ArtifactRow[]): SetSummary[] {
  const bySet = new Map<string, SetSummary>()
  for (const row of rows) {
    const key = row.artifact.setKey
    let summary = bySet.get(key)
    if (!summary) {
      summary = {
        key,
        name: row.setName,
        count: 0,
        slotCounts: SLOT_KEYS.map(() => 0),
        best: SLOT_KEYS.map(() => null),
        score: 0,
      }
      bySet.set(key, summary)
    }
    summary.count++
    if (row.slotIndex >= SLOT_KEYS.length) continue
    summary.slotCounts[row.slotIndex]!++
    const current = summary.best[row.slotIndex]
    if (!current || row.cv > current.cv || (row.cv === current.cv && row.rv > current.rv)) {
      summary.best[row.slotIndex] = row
    }
  }
  const list = [...bySet.values()]
  for (const summary of list) {
    summary.score = Number(summary.best.reduce((sum, row) => sum + (row?.cv ?? 0), 0).toFixed(1))
  }
  return list.sort((a, b) => b.score - a.score || b.count - a.count || compareText(a.name, b.name))
}

/** Position by CV among pieces of the same slot and rarity (1 = highest). */
export function cvRank(
  rows: readonly ArtifactRow[],
  row: ArtifactRow,
): { position: number; of: number } {
  let higher = 0
  let of = 0
  const { slotKey, rarity } = row.artifact
  for (const other of rows) {
    if (other.artifact.slotKey !== slotKey || other.artifact.rarity !== rarity) continue
    of++
    if (other.cv > row.cv) higher++
  }
  return { position: higher + 1, of }
}

// ------------------------------------------------------------- stored state

const ARTIFACT_SORTS: readonly ArtifactSort[] = SORT_OPTIONS.map((o) => o.value)

function oneOf<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

function level(value: unknown, fallback: number): number {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= LEVEL_MIN &&
    value <= LEVEL_MAX
    ? value
    : fallback
}

/** Whatever was stored, as valid filters (old or hand-edited values fall back). */
export function sanitizeFilters(value: unknown): ArtifactFilters {
  const base = defaultFilters()
  if (!value || typeof value !== 'object') return base
  const v = value as Record<string, unknown>
  const levelMin = level(v.levelMin, base.levelMin)
  const levelMax = level(v.levelMax, base.levelMax)
  // "Rarity" was a sort before Quality replaced it.
  const sort = oneOf(v.sort === 'rarity' ? 'quality' : v.sort, ARTIFACT_SORTS, base.sort)
  return {
    search: typeof v.search === 'string' ? v.search.slice(0, 100) : '',
    sets: stringList(v.sets),
    slots: stringList(v.slots).filter((s): s is SlotKey => SLOT_KEYS.includes(s as SlotKey)),
    mainStat: typeof v.mainStat === 'string' ? v.mainStat : '',
    substats: stringList(v.substats).filter((s) =>
      SUBSTAT_KEYS.includes(s as (typeof SUBSTAT_KEYS)[number]),
    ),
    lines: oneOf<LinesFilter>(v.lines, [0, 3, 4], 0),
    rarities: Array.isArray(v.rarities)
      ? v.rarities.filter((r): r is number => typeof r === 'number' && r >= 1 && r <= 5)
      : [],
    levelMin: Math.min(levelMin, levelMax),
    levelMax: Math.max(levelMin, levelMax),
    lock: oneOf<LockFilter>(v.lock, ['any', 'locked', 'unlocked'], 'any'),
    equipped: oneOf<EquipFilter>(v.equipped, ['any', 'equipped', 'inventory'], 'any'),
    owners: stringList(v.owners),
    astral: oneOf<AstralFilter>(v.astral, ['any', 'marked', 'unmarked'], 'any'),
    elixir: oneOf<ElixirFilter>(v.elixir, ['any', 'yes', 'no'], 'any'),
    fresh: v.fresh === true,
    best: v.best === true,
    sort,
    descending: typeof v.descending === 'boolean' ? v.descending : defaultDescending(sort),
  }
}

export type ArtifactView = 'cards' | 'bag' | 'table' | 'sets'
export const ARTIFACT_VIEWS: readonly ArtifactView[] = ['cards', 'bag', 'table', 'sets']

export function sanitizeView(value: unknown): ArtifactView {
  return oneOf(value, ARTIFACT_VIEWS, 'cards')
}
