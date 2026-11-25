/**
 * The team randomizer (Fun, docs/plans/fun.md): a pool of characters, the
 * filters that narrow it, and a seeded roll that fills two teams of four
 * under the rules, around locked slots. Pure: the same pool, rules, locks
 * and seed always give the same teams.
 */

import type { BodyType, ModelGender, RoleTag } from '@gdt/game-data/catalog'
import type { Element, WeaponType } from './game-meta'

/** A roll always gives two teams of four (the user's decision, 2026-11-24). */
export const TEAM_COUNT = 2
export const TEAM_SIZE = 4
/** The "5★ limit" rule: how many a team may hold. */
export const MAX_FIVE_STARS = 2

/** What the game data knows of a character, as the randomizer reads it. */
export interface CharacterFacts {
  rarity: number
  /** null: the element-less Traveler. */
  element: Element | null
  weapon: WeaponType | null
  /** CityConfigData id; null for none. */
  region: number | null
  body: BodyType | null
  /** null for the Traveler (either). */
  gender: ModelGender | null
  roles: readonly RoleTag[]
}

export interface PoolCharacter extends CharacterFacts {
  key: string
  name: string
  /** From the account's newest capture; null for a character it does not own. */
  level: number | null
}

export type PoolMode = 'mine' | 'all'

/** What the randomizer needs of an owned character. */
export interface OwnedCharacter {
  key: string
  level: number
}

const TRAVELER_ELEMENT = /^Traveler[A-Z]/
/** Manekin and Manekina exist only in Miliastra Wonderland: never in a party. */
const NEVER = /^Manekin/

/**
 * The characters to roll from. `mine`: the account's own. `all`: every
 * released character, the Traveler once (the account's own Traveler when it
 * has one, so its element is known), with the account's levels where owned.
 * 5★ first, then by name.
 */
export function buildPool(
  mode: PoolMode,
  owned: readonly OwnedCharacter[],
  released: readonly string[],
  facts: (key: string) => CharacterFacts | undefined,
  nameOf: (key: string) => string,
): PoolCharacter[] {
  const mine = new Map(owned.filter((c) => !NEVER.test(c.key)).map((c) => [c.key, c]))
  const keys = new Set<string>(mine.keys())
  if (mode === 'all') {
    const ownsTraveler = [...mine.keys()].some((key) => key.startsWith('Traveler'))
    for (const key of released) {
      if (NEVER.test(key) || TRAVELER_ELEMENT.test(key)) continue
      if (key === 'Traveler' && ownsTraveler) continue
      keys.add(key)
    }
  }
  const out: PoolCharacter[] = []
  for (const key of keys) {
    const known = facts(key)
    if (!known) continue
    const own = mine.get(key)
    out.push({
      ...known,
      key,
      name: nameOf(key),
      level: own?.level ?? null,
    })
  }
  return out.sort((a, b) => b.rarity - a.rarity || a.name.localeCompare(b.name))
}

/** Within a group any of the picks passes; every group with a pick must pass. */
export interface PoolFilters {
  elements: Element[]
  weapons: WeaponType[]
  rarities: number[]
  regions: number[]
  roles: RoleTag[]
  bodies: BodyType[]
  genders: ModelGender[]
  /** 0 for any; a character the account does not own never meets a level. */
  minLevel: number
}

export const NO_FILTERS: PoolFilters = {
  elements: [],
  weapons: [],
  rarities: [],
  regions: [],
  roles: [],
  bodies: [],
  genders: [],
  minLevel: 0,
}

export function hasFilters(f: PoolFilters): boolean {
  return (
    f.elements.length +
      f.weapons.length +
      f.rarities.length +
      f.regions.length +
      f.roles.length +
      f.bodies.length +
      f.genders.length >
      0 || f.minLevel > 0
  )
}

const among = <T>(picks: readonly T[], value: T | null): boolean =>
  picks.length === 0 || (value !== null && picks.includes(value))

export function passes(c: PoolCharacter, f: PoolFilters): boolean {
  return (
    among(f.elements, c.element) &&
    among(f.weapons, c.weapon) &&
    among(f.rarities, c.rarity) &&
    among(f.regions, c.region) &&
    among(f.bodies, c.body) &&
    // The Traveler is either gender: it passes any gender pick.
    (f.genders.length === 0 || c.gender === null || f.genders.includes(c.gender)) &&
    (f.roles.length === 0 || f.roles.some((role) => c.roles.includes(role))) &&
    (f.minLevel === 0 || (c.level !== null && c.level >= f.minLevel))
  )
}

export interface Rules {
  /** A character is in one team only. */
  noRepeats: boolean
  /** Every team has a healer. */
  healer: boolean
  /** No two of a team share an element. */
  elements: boolean
  /** At most MAX_FIVE_STARS 5★ in a team. */
  fiveStars: boolean
}

export const DEFAULT_RULES: Rules = {
  noRepeats: true,
  healer: false,
  elements: false,
  fiveStars: false,
}

/** Teams by slot: a character's key, or null for a slot to fill. */
export type Slots = (string | null)[][]

export const emptySlots = (): Slots =>
  Array.from({ length: TEAM_COUNT }, () => Array<string | null>(TEAM_SIZE).fill(null))

/** `pool`: too few characters; a rule's name: that rule cannot be met; `locks`: the kept slots break a rule. */
export type RollFailure = 'pool' | 'healer' | 'elements' | 'fiveStars' | 'locks'

export type RollResult = { ok: true; teams: string[][] } | { ok: false; reason: RollFailure }

/** mulberry32: a small seeded generator, the same everywhere. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffled<T>(list: readonly T[], random: () => number): T[] {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

const isHealer = (c: Pick<CharacterFacts, 'roles'>) => c.roles.includes('healer')

export interface RollInput {
  /** Who may be picked. */
  pool: readonly PoolCharacter[]
  /** Every character by key: the kept slots' may have left the pool since. */
  everyone: ReadonlyMap<string, PoolCharacter>
  rules: Rules
  /** The slots to keep (locks, or everything but what is rerolled); null to fill. */
  kept: Slots
  seed: number
  /** Not picked while anyone else fits (a reroll gives someone new). */
  avoid?: ReadonlySet<string>
}

/**
 * One try gives up after this many placements and starts over in another
 * order: an unlucky start (the pool's scarce characters together in one team)
 * is cheaper to leave than to back out of.
 */
const NODE_LIMIT = 4_000
const TRIES = 12

function search(input: RollInput, rules: Rules, avoid: ReadonlySet<string>): string[][] | null {
  const random = seededRandom(input.seed)
  for (let i = 0; i < TRIES; i++) {
    const found = attempt(input, rules, avoid, random)
    if (found !== 'limit') return found
  }
  return null
}

/** One try: the teams, null when there are none to find, or 'limit' when it gave up. */
function attempt(
  input: RollInput,
  rules: Rules,
  avoid: ReadonlySet<string>,
  random: () => number,
): string[][] | null | 'limit' {
  const order = shuffled(input.pool, random).filter((c) => !avoid.has(c.key))
  const teams = input.kept.map((team) => [...team])
  const used = new Set<string>()
  for (const key of teams.flat()) if (key) used.add(key)
  const of = (key: string) => input.everyone.get(key)

  /** Whether `c` may join `team` as it stands. */
  const fits = (team: (string | null)[], c: PoolCharacter): boolean => {
    if (team.includes(c.key)) return false
    if (rules.noRepeats && used.has(c.key)) return false
    const members = team.flatMap((key) => (key ? (of(key) ?? []) : []))
    if (rules.elements && c.element && members.some((m) => m.element === c.element)) return false
    if (
      rules.fiveStars &&
      c.rarity >= 5 &&
      members.filter((m) => m.rarity >= 5).length >= MAX_FIVE_STARS
    ) {
      return false
    }
    return true
  }

  // A team that needs a healer gets it first: filled last, one team could
  // have taken the healers the other needs.
  const open: { team: number; slot: number; healer: boolean }[] = []
  teams.forEach((team, t) => {
    const has = team.some((key) => key !== null && isHealer(of(key) ?? { roles: [] }))
    let needs = rules.healer && !has
    team.forEach((key, slot) => {
      if (key !== null) return
      open.push({ team: t, slot, healer: needs })
      needs = false
    })
  })
  open.sort((x, y) => Number(y.healer) - Number(x.healer))
  let nodes = 0
  const place = (index: number): boolean => {
    if (index === open.length) return true
    const { team: t, slot: s, healer } = open[index]!
    const team = teams[t]!
    for (const c of order) {
      if (healer && !isHealer(c)) continue
      if (!fits(team, c)) continue
      if (++nodes > NODE_LIMIT) return false
      team[s] = c.key
      const repeat = used.has(c.key)
      used.add(c.key)
      if (place(index + 1)) return true
      team[s] = null
      if (!repeat) used.delete(c.key)
    }
    return false
  }
  if (!place(0)) return nodes > NODE_LIMIT ? 'limit' : null

  // A needed healer sits in a team's first open slot: mix each
  // team's new picks over its open slots, so no slot is "the healer's".
  input.kept.forEach((kept, t) => {
    const slots = kept.flatMap((key, s) => (key === null ? [s] : []))
    const picks = shuffled(
      slots.map((s) => teams[t]![s]!),
      random,
    )
    slots.forEach((s, i) => (teams[t]![s] = picks[i]!))
  })
  return teams as string[][]
}

/** Whether the kept slots alone already break a rule. */
function keptBreaksRules(input: RollInput): boolean {
  const { rules, kept, everyone } = input
  const seen = new Set<string>()
  for (const team of kept) {
    const keys = team.filter((key): key is string => key !== null)
    if (new Set(keys).size !== keys.length) return true
    for (const key of keys) {
      if (rules.noRepeats && seen.has(key)) return true
      seen.add(key)
    }
    const members = keys.flatMap((key) => everyone.get(key) ?? [])
    const elements = members.flatMap((m) => m.element ?? [])
    if (rules.elements && new Set(elements).size !== elements.length) return true
    if (rules.fiveStars && members.filter((m) => m.rarity >= 5).length > MAX_FIVE_STARS) return true
    if (rules.healer && keys.length === team.length && !members.some(isHealer)) return true
  }
  return false
}

/**
 * Fills the open slots. When it cannot, says why: the first rule whose
 * absence makes it possible, else the pool is too small.
 */
export function fillTeams(input: RollInput): RollResult {
  if (keptBreaksRules(input)) return { ok: false, reason: 'locks' }
  const none: ReadonlySet<string> = new Set()
  const teams =
    (input.avoid?.size ? search(input, input.rules, input.avoid) : null) ??
    search(input, input.rules, none)
  if (teams) return { ok: true, teams }
  for (const rule of ['healer', 'elements', 'fiveStars'] as const) {
    if (input.rules[rule] && search(input, { ...input.rules, [rule]: false }, none)) {
      return { ok: false, reason: rule }
    }
  }
  return { ok: false, reason: 'pool' }
}

/** The slots a reroll of one slot keeps: everything else. */
export function withoutSlot(
  teams: readonly (string | null)[][],
  team: number,
  slot: number,
): Slots {
  return teams.map((row, t) => row.map((key, s) => (t === team && s === slot ? null : key)))
}

/** The slots a reroll of one team keeps: the other teams, and this team's locks. */
export function withoutTeam(
  teams: readonly (string | null)[][],
  team: number,
  locks: readonly (string | null)[][],
): Slots {
  return teams.map((row, t) => (t === team ? [...(locks[t] ?? row.map(() => null))] : [...row]))
}
