/**
 * The Characters page's model: one pass over a GOOD inventory joins every
 * character with the weapon and artifacts it wears, adds rarity / element /
 * weapon type from the game data (game-meta.ts), and derives what the cards
 * show (set bonuses, crit value, what is left to build). Pure functions; the
 * view only filters and sorts the result.
 */

import {
  calculateCV,
  calculateRV,
  type Good,
  type GoodArtifact,
  type GoodWeapon,
} from '@gdt/shared'
import { characterName } from '@/i18n/game-names'
import { maxLevel } from '@/utils/artifact-rolls'
import { formatSetName } from '@/utils/artifact-stats'
import { ARTIFACT_MAIN_STATS, ARTIFACT_SET_THRESHOLDS } from './artifact-stats'
import { characterMeta, weaponMeta, type Element, type WeaponType } from './game-meta'
import { WEAPON_TYPE_LABELS, itemName } from './weapons'
import { compareText, normalizeSearch } from '@/lib/search'
import { labelTable } from '@/i18n/labels'
import { t } from '@/i18n'

export { WEAPON_TYPES, WEAPON_TYPE_LABELS, itemName } from './weapons'

export type { Element, WeaponType }

export const SLOT_ORDER = ['flower', 'plume', 'sands', 'goblet', 'circlet'] as const
export type SlotKey = (typeof SLOT_ORDER)[number]

/** "Flower", "Plume", … in the language on screen. */
export const SLOT_LABELS = labelTable<SlotKey>('slot')

/** In-game order. */
export const ELEMENTS: readonly Element[] = [
  'pyro',
  'hydro',
  'anemo',
  'electro',
  'dendro',
  'cryo',
  'geo',
]

/** "Pyro", "Hydro", … in the language on screen. */
export const ELEMENT_LABELS = labelTable<Element>('element')

/** The level every build aims for (95 and 100 are extras). */
export const TARGET_LEVEL = 90

export interface EquippedWeapon extends GoodWeapon {
  name: string
  rarity: number | null
  type: WeaponType | null
}

export interface EquippedArtifact extends GoodArtifact {
  slotKey: SlotKey
  /** Main stat at this level and rarity; null when the table has no value. */
  mainStatValue: number | null
  cv: number
  rv: number
  maxed: boolean
}

export interface SetCount {
  setKey: string
  name: string
  count: number
  /** The highest rarity among these pieces (the icon's cell art). */
  rarity: number
  /** Piece counts at which the set grants a bonus (usually 2 and 4). */
  thresholds: readonly number[]
  /** The thresholds this character reaches. */
  active: number[]
}

/** Something left to do on a build. */
export type GapKind = 'level' | 'weapon' | 'artifacts' | 'set'

export interface Gap {
  kind: GapKind
  /** Short, for a tooltip: "Lv 80", "Weapon Lv 70", "3/5 artifacts". */
  text: string
}

export interface CharacterView {
  key: string
  name: string
  rarity: number | null
  element: Element | null
  weaponType: WeaponType | null
  level: number
  ascension: number
  constellation: number
  talent: { auto: number; skill: number; burst: number }
  talentTotal: number
  /** Talents at 10 (each took a Crown of Insight). */
  crowns: number
  weapon: EquippedWeapon | null
  /** One entry per slot, in SLOT_ORDER; null for an empty slot. */
  artifacts: (EquippedArtifact | null)[]
  artifactCount: number
  /** Every set worn, most pieces first. */
  sets: SetCount[]
  /** Sets that grant at least one bonus. */
  activeSets: SetCount[]
  /** Set bonuses granted: 2 for a 4-piece or 2 + 2. */
  bonusCount: number
  hasFourPiece: boolean
  /** Crit value summed over the equipped artifacts' substats. */
  cv: number
  /** Crit rate and crit damage from artifacts (main stats included). */
  critRate: number
  critDmg: number
  gaps: Gap[]
  /** Friendship level 1-10, from irminsul's `gi_characters`; null when unknown. */
  friendship: number | null
  /** When the character joined the account (epoch ms), from `gi_characters`; null when unknown. */
  obtainedAt: number | null
  /**
   * EXP toward the next level and friendship EXP toward the next friendship
   * level (Teyvat.me Capture); null when the snapshot holds no EXP at all.
   */
  exp: number | null
  friendshipExp: number | null
  /** Normalised name, element, weapon and set names, for search. */
  haystack: string
}

export interface Roster {
  characters: CharacterView[]
  total: number
  c6: number
  /** Characters at level 90 or above. */
  level90: number
  /** Talents at 10, over the whole roster. */
  crowns: number
  /** Characters with nothing left to build. */
  ready: number
  /** Whether the snapshot knows any friendship level / obtained date (irminsul's extras). */
  hasFriendship: boolean
  hasObtained: boolean
}

const DEFAULT_THRESHOLDS = [2, 4] as const

export { normalizeSearch }

export function weaponInfo(key: string): { rarity: number | null; type: WeaponType | null } {
  const meta = weaponMeta(key)
  return { rarity: meta?.[0] ?? null, type: meta?.[1] ?? null }
}

export function mainStatValue(artifact: Pick<GoodArtifact, 'rarity' | 'mainStatKey' | 'level'>) {
  return ARTIFACT_MAIN_STATS[artifact.rarity]?.[artifact.mainStatKey]?.[artifact.level] ?? null
}

function isSlot(slot: string): slot is SlotKey {
  return (SLOT_ORDER as readonly string[]).includes(slot)
}

function countSets(pieces: readonly EquippedArtifact[]): SetCount[] {
  const counts = new Map<string, { count: number; rarity: number }>()
  for (const piece of pieces) {
    const seen = counts.get(piece.setKey)
    counts.set(piece.setKey, {
      count: (seen?.count ?? 0) + 1,
      rarity: Math.max(seen?.rarity ?? 0, piece.rarity),
    })
  }
  return [...counts]
    .map(([setKey, { count, rarity }]) => {
      const thresholds = ARTIFACT_SET_THRESHOLDS[setKey] ?? DEFAULT_THRESHOLDS
      return {
        setKey,
        name: formatSetName(setKey),
        count,
        rarity,
        thresholds,
        active: thresholds.filter((t) => count >= t),
      }
    })
    .sort((a, b) => b.count - a.count || compareText(a.name, b.name))
}

/** A gap whose text follows the language on screen (read where it renders). */
function gap(kind: GapKind, text: () => string): Gap {
  return {
    kind,
    get text() {
      return text()
    },
  }
}

function findGaps(
  level: number,
  weapon: EquippedWeapon | null,
  equipped: readonly EquippedArtifact[],
  bonusCount: number,
): Gap[] {
  const gaps: Gap[] = []
  if (level < TARGET_LEVEL) gaps.push(gap('level', () => t('characters.gap.level', { level })))
  if (!weapon) gaps.push(gap('weapon', () => t('characters.gap.noWeapon')))
  else if (weapon.level < TARGET_LEVEL) {
    const weaponLevel = weapon.level
    gaps.push(gap('weapon', () => t('characters.gap.weaponLevel', { level: weaponLevel })))
  }
  const unlevelled = equipped.filter((p) => !p.maxed).length
  if (equipped.length < SLOT_ORDER.length) {
    const count = equipped.length
    gaps.push(gap('artifacts', () => t('characters.gap.artifactCount', { count })))
  } else if (unlevelled > 0) {
    gaps.push(gap('artifacts', () => t('characters.gap.belowMax', { n: unlevelled }, unlevelled)))
  }
  if (equipped.length > 0 && bonusCount < 2) {
    gaps.push(gap('set', () => t('characters.gap.noSet')))
  }
  return gaps
}

/** Joins characters with what they wear. Run once per inventory. */
/**
 * A character the account doesn't own, as the dialog shows it bare (the
 * user's ask, 2026-11-04): C0, every talent at 1, no gear, no level or
 * friendship — what is left is the kit's text, scaling and guides. Null for
 * a key the game data doesn't know.
 */
export function bareCharacter(key: string): CharacterView | null {
  if (!characterMeta(key)) return null
  const roster = buildRoster({
    characters: [
      { key, level: 1, ascension: 0, constellation: 0, talent: { auto: 1, skill: 1, burst: 1 } },
    ],
    weapons: [],
    artifacts: [],
  })
  return roster.characters[0] ?? null
}

export function buildRoster(
  good: Pick<Good, 'characters' | 'weapons' | 'artifacts' | 'gi_characters'>,
): Roster {
  // EXP is stored only when above 0, so a snapshot with any knows the rest are 0.
  const knowsExp = Object.values(good.gi_characters ?? {}).some(
    (e) => (e.exp ?? 0) > 0 || (e.friendshipExp ?? 0) > 0,
  )
  const weapons = new Map<string, GoodWeapon>()
  for (const weapon of good.weapons) {
    if (weapon.location && !weapons.has(weapon.location)) weapons.set(weapon.location, weapon)
  }

  const artifacts = new Map<string, Map<SlotKey, EquippedArtifact>>()
  for (const artifact of good.artifacts) {
    if (!artifact.location || !isSlot(artifact.slotKey)) continue
    let slots = artifacts.get(artifact.location)
    if (!slots) artifacts.set(artifact.location, (slots = new Map()))
    if (slots.has(artifact.slotKey)) continue
    slots.set(artifact.slotKey, {
      ...artifact,
      slotKey: artifact.slotKey,
      mainStatValue: mainStatValue(artifact),
      cv: calculateCV(artifact.substats),
      rv: calculateRV(artifact.substats),
      maxed: artifact.level >= maxLevel(artifact.rarity),
    })
  }

  const characters = good.characters.map((c): CharacterView => {
    const meta = characterMeta(c.key)
    // GOOD names the Traveler by element (`TravelerCryo`) but their gear's
    // location plainly `Traveler`.
    const traveler = c.key.startsWith('Traveler')
    const location = (map: Map<string, unknown>) =>
      traveler && !map.has(c.key) ? 'Traveler' : c.key
    const worn = weapons.get(location(weapons))
    const weapon: EquippedWeapon | null = worn
      ? { ...worn, name: itemName(worn.key), ...weaponInfo(worn.key) }
      : null
    const slots = artifacts.get(location(artifacts))
    const pieces = SLOT_ORDER.map((slot) => slots?.get(slot) ?? null)
    const equipped = pieces.filter((p): p is EquippedArtifact => p !== null)
    const sets = countSets(equipped)
    const activeSets = sets.filter((s) => s.active.length > 0)
    const bonusCount = activeSets.reduce((sum, s) => sum + s.active.length, 0)
    const name = characterName(c.key)
    const element = meta?.[1] ?? null
    const weaponType = meta?.[2] ?? weapon?.type ?? null
    let critRate = 0
    let critDmg = 0
    for (const piece of equipped) {
      if (piece.mainStatKey === 'critRate_') critRate += piece.mainStatValue ?? 0
      if (piece.mainStatKey === 'critDMG_') critDmg += piece.mainStatValue ?? 0
      for (const sub of piece.substats) {
        if (sub.key === 'critRate_') critRate += sub.value
        if (sub.key === 'critDMG_') critDmg += sub.value
      }
    }
    const talent = { ...c.talent }
    const extra = good.gi_characters?.[c.key]
    return {
      key: c.key,
      name,
      rarity: meta?.[0] ?? null,
      element,
      weaponType,
      level: c.level,
      ascension: c.ascension,
      constellation: c.constellation,
      talent,
      talentTotal: talent.auto + talent.skill + talent.burst,
      crowns: [talent.auto, talent.skill, talent.burst].filter((t) => t >= 10).length,
      weapon,
      artifacts: pieces,
      artifactCount: equipped.length,
      sets,
      activeSets,
      bonusCount,
      hasFourPiece: sets.some((s) => s.count >= 4),
      cv: Number(equipped.reduce((sum, p) => sum + p.cv, 0).toFixed(1)),
      critRate: Number(critRate.toFixed(1)),
      critDmg: Number(critDmg.toFixed(1)),
      gaps: findGaps(c.level, weapon, equipped, bonusCount),
      // The game shows the Traveler, Manekin and Manekina no friendship level.
      friendship: noFriendship(c.key) ? null : (extra?.friendship ?? null),
      exp: knowsExp ? (extra?.exp ?? 0) : null,
      friendshipExp: knowsExp && !noFriendship(c.key) ? (extra?.friendshipExp ?? 0) : null,
      obtainedAt: extra?.obtainedAt !== undefined ? extra.obtainedAt * 1000 : null,
      haystack: normalizeSearch(
        [
          name,
          c.key,
          element ? ELEMENT_LABELS[element] : '',
          weaponType ? WEAPON_TYPE_LABELS[weaponType] : '',
          weapon?.name ?? '',
          ...activeSets.map((s) => s.name),
        ].join(' '),
      ),
    }
  })

  return {
    characters,
    total: characters.length,
    c6: characters.filter((c) => c.constellation >= 6).length,
    level90: characters.filter((c) => c.level >= TARGET_LEVEL).length,
    crowns: characters.reduce((sum, c) => sum + c.crowns, 0),
    ready: characters.filter((c) => c.gaps.length === 0).length,
    hasFriendship: characters.some((c) => c.friendship !== null),
    hasObtained: characters.some((c) => c.obtainedAt !== null),
  }
}

const STAT_ORDER = [
  'hp',
  'hp_',
  'atk',
  'atk_',
  'def',
  'def_',
  'eleMas',
  'enerRech_',
  'critRate_',
  'critDMG_',
  'heal_',
]

/**
 * What the equipped artifacts add up to, main stats included where the table
 * knows them (inactive substats are not counted).
 */
export function artifactTotals(character: CharacterView): { key: string; value: number }[] {
  const totals = new Map<string, number>()
  const add = (key: string, value: number) => totals.set(key, (totals.get(key) ?? 0) + value)
  for (const piece of character.artifacts) {
    if (!piece) continue
    if (piece.mainStatValue !== null) add(piece.mainStatKey, piece.mainStatValue)
    for (const sub of piece.substats) add(sub.key, sub.value)
  }
  const rank = (key: string) => {
    const index = STAT_ORDER.indexOf(key)
    return index === -1 ? STAT_ORDER.length : index
  }
  return [...totals]
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key))
}

// ------------------------------------------------------------ filter & sort

export type CharacterSort =
  | 'default'
  | 'level'
  | 'constellation'
  | 'talents'
  | 'cv'
  | 'rarity'
  | 'element'
  | 'name'
  | 'friendship'
  | 'obtained'
export type SortDirection = 'asc' | 'desc'

export interface SortOption {
  value: CharacterSort
  label: string
  natural: SortDirection
}

export const CHARACTER_SORTS: SortOption[] = [
  // The game's order: level (high first), element, date obtained (oldest first).
  {
    value: 'default',
    get label() {
      return t('characters.sort.default')
    },
    natural: 'desc',
  },
  {
    value: 'level',
    get label() {
      return t('characters.sort.level')
    },
    natural: 'desc',
  },
  {
    value: 'constellation',
    get label() {
      return t('characters.sort.constellation')
    },
    natural: 'desc',
  },
  {
    value: 'talents',
    get label() {
      return t('characters.sort.talents')
    },
    natural: 'desc',
  },
  {
    value: 'cv',
    get label() {
      return t('characters.sort.cv')
    },
    natural: 'desc',
  },
  {
    value: 'rarity',
    get label() {
      return t('characters.sort.rarity')
    },
    natural: 'desc',
  },
  {
    value: 'element',
    get label() {
      return t('characters.sort.element')
    },
    natural: 'asc',
  },
  {
    value: 'name',
    get label() {
      return t('characters.sort.name')
    },
    natural: 'asc',
  },
  {
    value: 'friendship',
    get label() {
      return t('characters.sort.friendship')
    },
    natural: 'desc',
  },
  {
    value: 'obtained',
    get label() {
      return t('characters.sort.obtained')
    },
    natural: 'desc',
  },
]

/** The sorts this roster can use: friendship and obtained only when a snapshot knows them. */
export function characterSorts(
  roster: Pick<Roster, 'hasFriendship' | 'hasObtained'>,
): SortOption[] {
  return CHARACTER_SORTS.filter(
    (s) =>
      (s.value !== 'friendship' || roster.hasFriendship) &&
      (s.value !== 'obtained' || roster.hasObtained),
  )
}

export type BuildFilter = 'all' | 'ready' | 'needs' | GapKind
export type TalentFilter = 'all' | 'nine' | 'crowned' | 'below'

export const BUILD_OPTIONS: { value: BuildFilter; label: string }[] = [
  {
    value: 'all',
    get label() {
      return t('characters.build.all')
    },
  },
  {
    value: 'ready',
    get label() {
      return t('characters.build.ready')
    },
  },
  {
    value: 'needs',
    get label() {
      return t('characters.build.needs')
    },
  },
  {
    value: 'level',
    get label() {
      return t('characters.build.level')
    },
  },
  {
    value: 'weapon',
    get label() {
      return t('characters.build.weapon')
    },
  },
  {
    value: 'artifacts',
    get label() {
      return t('characters.build.artifacts')
    },
  },
  {
    value: 'set',
    get label() {
      return t('characters.build.set')
    },
  },
]

export const TALENT_OPTIONS: { value: TalentFilter; label: string }[] = [
  {
    value: 'all',
    get label() {
      return t('characters.talentFilter.all')
    },
  },
  {
    value: 'nine',
    get label() {
      return t('characters.talentFilter.nine')
    },
  },
  {
    value: 'crowned',
    get label() {
      return t('characters.talentFilter.crowned')
    },
  },
  {
    value: 'below',
    get label() {
      return t('characters.talentFilter.below')
    },
  },
]

export interface CharacterFilters {
  query: string
  element: Element | 'all'
  rarity: 'all' | 5 | 4
  weaponType: WeaponType | 'all'
  build: BuildFilter
  talents: TalentFilter
  /** Only the favourites. */
  favorites: boolean
}

export const NO_CHARACTER_FILTERS: CharacterFilters = {
  query: '',
  element: 'all',
  rarity: 'all',
  weaponType: 'all',
  build: 'all',
  talents: 'all',
  favorites: false,
}

export function hasCharacterFilters(f: CharacterFilters): boolean {
  return (
    f.query.trim() !== '' ||
    f.element !== 'all' ||
    f.rarity !== 'all' ||
    f.weaponType !== 'all' ||
    f.build !== 'all' ||
    f.talents !== 'all' ||
    f.favorites
  )
}

/** Favourite characters' keys (account setting `favoriteCharacters`). */
export type Favorites = ReadonlySet<string>

const NO_FAVORITES: Favorites = new Set()

/** `list` with `key` in it (`on`) or not, each key once, the others in their order. */
export function withFavorite(list: readonly string[], key: string, on: boolean): string[] {
  const rest = list.filter((k) => k !== key)
  return on ? [...rest, key] : rest
}

function buildMatches(c: CharacterView, build: BuildFilter): boolean {
  if (build === 'all') return true
  if (build === 'ready') return c.gaps.length === 0
  if (build === 'needs') return c.gaps.length > 0
  return c.gaps.some((g) => g.kind === build)
}

function talentsMatch(c: CharacterView, talents: TalentFilter): boolean {
  const { auto, skill, burst } = c.talent
  const lowest = Math.min(auto, skill, burst)
  if (talents === 'nine') return lowest >= 9
  if (talents === 'crowned') return c.crowns > 0
  if (talents === 'below') return lowest < 9
  return true
}

/** Facets whose chips show "matches if you pick this" counts. */
export type CharacterFacet = 'element' | 'rarity'

export function filterCharacters(
  list: readonly CharacterView[],
  f: CharacterFilters,
  except?: CharacterFacet,
  favorites: Favorites = NO_FAVORITES,
): CharacterView[] {
  const words = normalizeSearch(f.query).split(' ').filter(Boolean)
  return list.filter(
    (c) =>
      (!f.favorites || favorites.has(c.key)) &&
      (except === 'element' || f.element === 'all' || c.element === f.element) &&
      (except === 'rarity' || f.rarity === 'all' || c.rarity === f.rarity) &&
      (f.weaponType === 'all' || c.weaponType === f.weaponType) &&
      buildMatches(c, f.build) &&
      talentsMatch(c, f.talents) &&
      words.every((w) => c.haystack.includes(w)),
  )
}

/** Per-value counts of one facet, with every other filter applied. */
export function facetCounts<K>(
  list: readonly CharacterView[],
  f: CharacterFilters,
  facet: CharacterFacet,
  value: (c: CharacterView) => K,
  favorites: Favorites = NO_FAVORITES,
): Map<K, number> {
  const counts = new Map<K, number>()
  for (const c of filterCharacters(list, f, facet, favorites)) {
    const k = value(c)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return counts
}

const elementRank = (e: Element | null) => (e ? ELEMENTS.indexOf(e) : ELEMENTS.length)

/** Oldest obtained first, unknown dates last (a tie-break, whatever the direction). */
const obtainedOrder = (a: CharacterView, b: CharacterView) =>
  (a.obtainedAt ?? Number.MAX_SAFE_INTEGER) - (b.obtainedAt ?? Number.MAX_SAFE_INTEGER)

/**
 * The game's own character list (sorted by Level): Geo, Anemo, Cryo, Electro,
 * Dendro, Hydro, Pyro (the game's element ids, high first), element-changing
 * characters last.
 */
const GAME_ELEMENTS: readonly Element[] = [
  'geo',
  'anemo',
  'cryo',
  'electro',
  'dendro',
  'hydro',
  'pyro',
]
const gameElementRank = (e: Element | null) => (e ? GAME_ELEMENTS.indexOf(e) : GAME_ELEMENTS.length)
/** Newest obtained first, unknown dates last. */
const newestFirst = (a: CharacterView, b: CharacterView) =>
  (b.obtainedAt ?? Number.MIN_SAFE_INTEGER) - (a.obtainedAt ?? Number.MIN_SAFE_INTEGER)

const compareBy: Record<CharacterSort, (a: CharacterView, b: CharacterView) => number> = {
  // Descending is the game's order: level high first, then 5★ before 4★, the
  // game's element order, and the newest obtained first.
  default: (a, b) =>
    a.level - b.level ||
    a.ascension - b.ascension ||
    (a.rarity ?? 0) - (b.rarity ?? 0) ||
    gameElementRank(b.element) - gameElementRank(a.element) ||
    newestFirst(b, a),
  level: (a, b) => a.level - b.level || a.ascension - b.ascension,
  constellation: (a, b) => a.constellation - b.constellation,
  talents: (a, b) => a.talentTotal - b.talentTotal,
  cv: (a, b) => a.cv - b.cv,
  rarity: (a, b) => (a.rarity ?? 0) - (b.rarity ?? 0),
  // Ascending follows the game's element order.
  element: (a, b) => elementRank(a.element) - elementRank(b.element),
  name: (a, b) => compareText(a.name, b.name),
  friendship: (a, b) => (a.friendship ?? 0) - (b.friendship ?? 0),
  obtained: (a, b) => (a.obtainedAt ?? 0) - (b.obtainedAt ?? 0),
}

/** Playable characters the game gives no friendship level: the Traveler, Manekin and Manekina. */
export const noFriendship = (key: string): boolean =>
  key.startsWith('Traveler') || key === 'Manekin' || key === 'Manekina'

/** Sorts on a value a character may lack; those characters go last either way. */
const unknownFor: Partial<Record<CharacterSort, (c: CharacterView) => boolean>> = {
  friendship: (c) => c.friendship === null,
  obtained: (c) => c.obtainedAt === null,
}

/**
 * Sorts by `sort` in `direction`; ties fall back to the game's own order:
 * level (high first), element (the game's order), date obtained (oldest
 * first), then rarity and name for rosters without dates.
 * `pinned` (the favourites) come first whatever the sort, in that same order
 * among themselves; the rest follow.
 */
export function sortCharacters(
  list: readonly CharacterView[],
  sort: CharacterSort,
  direction: SortDirection,
  pinned: Favorites = NO_FAVORITES,
): CharacterView[] {
  const sign = direction === 'asc' ? 1 : -1
  const primary = compareBy[sort]
  const unknown = unknownFor[sort]
  return [...list].sort(
    (a, b) =>
      Number(pinned.has(b.key)) - Number(pinned.has(a.key)) ||
      (unknown ? Number(unknown(a)) - Number(unknown(b)) : 0) ||
      sign * primary(a, b) ||
      compareBy.level(b, a) ||
      compareBy.element(a, b) ||
      obtainedOrder(a, b) ||
      compareBy.rarity(b, a) ||
      compareBy.name(a, b),
  )
}
