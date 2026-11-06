/**
 * Custom characters, pure: a placeholder for a character the game data
 * doesn't have yet (unreleased, or newer than this build), planned like any
 * other and replaced by the real one later, goals kept.
 *
 * A custom character is a planner goal of kind `custom`, keyed by its own
 * id (lowercase first, so never a GOOD key); its target carries what it is
 * (`CustomCharacter`: name, rarity, element, weapon type and materials).
 * The planner costs it as a character of its rarity: every 4★ and 5★
 * character in the data levels and ascends with the same counts, so one of
 * them is the template and each material is swapped for the chosen one of
 * the same kind and tier (the gem from the element). A material not chosen
 * yet is left out of the cost. `withCustomCharacters` puts them into the
 * planner data, so costs, totals, Done and the farm view work unchanged.
 */

import type {
  AscensionPhase,
  ItemCost,
  MaterialFamily,
  PlannerCharacter,
  PlannerData,
  PlannerMaterial,
  TalentLevel,
} from '@gdt/game-data'
import type { CharacterCurrent, CustomCharacter, CustomTarget, currentOverride } from '@gdt/shared'
import type { z } from 'zod'
import type { TargetInput, TargetRef } from './model'

type CurrentChange = z.input<typeof currentOverride>

/** A custom character's id: `c` and 11 base-36 digits. */
export function newCustomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(11))
  return `c${[...bytes].map((b) => (b % 36).toString(36)).join('')}`
}

/** Custom ids start lowercase; GOOD keys never do. */
export const isCustomKey = (key: string) => /^[a-z]/.test(key)

/**
 * A character of `rarity` whose costs every regular one shares: an element,
 * a normal boss drop from the second ascension and a crown at talent 10
 * (not the Traveler or the Manekins).
 */
function template(planner: PlannerData, rarity: number): PlannerCharacter | null {
  for (const c of planner.characters.values()) {
    if (c.rarity !== rarity || c.element === null || isCustomKey(c.key)) continue
    if (!c.ascension[2]?.items.some((i) => i.material.kind === 'boss')) continue
    if (!c.talents.normal[9]?.items.some((i) => i.material.kind === 'crown')) continue
    return c
  }
  return null
}

/** The gem family an element ascends with (from the characters of that element). */
export function gemFamily(planner: PlannerData, element: string): MaterialFamily | null {
  for (const c of planner.characters.values()) {
    if (c.element !== element) continue
    for (const phase of c.ascension) {
      const gem = phase.items.find((i) => i.material.kind === 'gem')
      if (gem?.material.family) return gem.material.family
    }
  }
  return null
}

/** The member of `family` (named by its lowest tier's key) at `tier`. */
function tierOf(planner: PlannerData, familyKey: string | undefined, tier: number) {
  if (!familyKey) return null
  const family = planner.materialsByKey.get(familyKey)?.family
  return family?.members[tier - 1] ?? null
}

/**
 * The planner data's entry for a custom character: the template's costs
 * with its materials swapped for the custom one's (unknown ones dropped).
 */
export function customCharacterData(
  planner: PlannerData,
  key: string,
  custom: CustomCharacter,
): PlannerCharacter | null {
  const base = template(planner, custom.rarity) ?? template(planner, 5)
  if (!base) return null
  const gems = gemFamily(planner, custom.element)
  const single = (k: string | undefined) => (k ? (planner.materialsByKey.get(k) ?? null) : null)
  const swap = (m: PlannerMaterial): PlannerMaterial | null => {
    switch (m.kind) {
      case 'gem':
        return gems?.members[m.tier - 1] ?? null
      case 'boss':
        return single(custom.boss)
      case 'local':
        return single(custom.local)
      case 'weekly':
        return single(custom.weekly)
      case 'common':
        return tierOf(planner, custom.common, m.tier)
      case 'book':
        return tierOf(planner, custom.book, m.tier)
      default:
        return m
    }
  }
  const items = (list: readonly ItemCost[]) =>
    list.flatMap((i) => {
      const material = swap(i.material)
      return material ? [{ material, count: i.count }] : []
    })
  const phase = (p: AscensionPhase): AscensionPhase => ({ ...p, items: items(p.items) })
  const talent = (t: TalentLevel): TalentLevel => ({ ...t, items: items(t.items) })
  return {
    key,
    id: 0,
    rarity: custom.rarity,
    element: custom.element,
    weapon: custom.weapon,
    ascension: base.ascension.map(phase),
    talents: {
      normal: base.talents.normal.map(talent),
      skill: base.talents.skill.map(talent),
      burst: base.talents.burst.map(talent),
    },
    constellation: { c3: null, c5: null },
  }
}

/** The planner data with custom characters in it (the same object when there are none). */
export function withCustomCharacters(
  planner: PlannerData,
  customs: Iterable<readonly [key: string, custom: CustomCharacter]>,
): PlannerData {
  const list = [...customs]
  if (list.length === 0) return planner
  const characters = new Map(planner.characters)
  for (const [key, custom] of list) {
    const data = customCharacterData(planner, key, custom)
    if (data) characters.set(key, data)
  }
  return { ...planner, characters }
}

// ------------------------------------------------------------ choices

export interface CustomChoices {
  /** Talent book families. */
  books: MaterialFamily[]
  /** Common enemy drop families. */
  commons: MaterialFamily[]
  bosses: PlannerMaterial[]
  locals: PlannerMaterial[]
  weeklies: PlannerMaterial[]
}

/** What a custom character's materials can be, newest first (the game numbers items in order). */
export function customChoices(planner: PlannerData): CustomChoices {
  const newest = <T extends { id: number }>(a: T, b: T) => b.id - a.id
  const families = (kind: string) =>
    planner.families
      .filter((f) => f.kind === kind && f.members.length > 0)
      .sort((a, b) => newest(a.members[0]!, b.members[0]!))
  const materials = (kind: string) =>
    [...planner.materialsByKey.values()].filter((m) => m.kind === kind).sort(newest)
  return {
    books: families('book'),
    commons: families('common'),
    bosses: materials('boss'),
    locals: materials('local'),
    weeklies: materials('weekly'),
  }
}

/** "Freedom" for the Teachings / Guide / Philosophies of Freedom, else the lowest tier's name. */
export function familyName(family: MaterialFamily): string {
  const name = family.members[0]?.name ?? family.key
  return family.kind === 'book' ? name.replace(/^Teachings of (the )?/, '') : name
}

// ------------------------------------------------------------ replace

/** A name as it is compared: case, spaces and symbols ignored. */
const nameForm = (name: string) =>
  name
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}]+/gu, '')

/**
 * The released character a custom one turned out to be, or null: the one
 * real character whose name is the custom one's (its GOOD key, or the name
 * `shownName` gives it) with the same rarity, element and weapon type.
 */
export function releasedCharacter(
  planner: PlannerData,
  custom: CustomCharacter,
  shownName: (key: string) => string = () => '',
): string | null {
  const name = nameForm(custom.name)
  if (!name) return null
  let found: string | null = null
  for (const c of planner.characters.values()) {
    if (isCustomKey(c.key)) continue
    if (c.rarity !== custom.rarity || c.element !== custom.element) continue
    if (c.weapon !== custom.weapon) continue
    if (nameForm(c.key) !== name && nameForm(shownName(c.key)) !== name) continue
    if (found) return null // Two alike: not sure which.
    found = c.key
  }
  return found
}

/**
 * The custom goals to swap for the real character now (user's rule: when
 * the account owns it, no click): each custom character whose released one
 * (`releasedCharacter`) the capture has (`owned`) and that is no goal yet
 * (`taken`), one custom goal per real character.
 */
export function releasedSwaps(
  planner: PlannerData,
  customs: Iterable<readonly [key: string, custom: CustomCharacter]>,
  owned: ReadonlySet<string>,
  taken: ReadonlySet<string>,
  shownName?: (key: string) => string,
): { key: string; real: string }[] {
  const swaps: { key: string; real: string }[] = []
  const claimed = new Set(taken)
  for (const [key, custom] of customs) {
    const real = releasedCharacter(planner, custom, shownName)
    if (!real || !owned.has(real) || claimed.has(real)) continue
    claimed.add(real)
    swaps.push({ key, real })
  }
  return swaps
}

/** What a custom character stops being once it is a real one: the profile goes, the goal stays. */
export function realTarget(target: CustomTarget): Omit<CustomTarget, 'custom'> {
  const { custom: _, ...rest } = target
  return rest
}

/**
 * Replacing custom character `key` with the real character `real`: its goal
 * becomes the real one's (the profile dropped), its weapon goals follow
 * (same ids, new owner), and a current state set by hand moves along (it
 * counts only where it is ahead of the real one's capture).
 */
export function replaceCustom(
  key: string,
  target: CustomTarget,
  real: string,
  weapons: readonly { goalId: string; key: string; target: TargetInput['target'] }[],
  current: CharacterCurrent | null,
): { remove: TargetRef[]; upsert: TargetInput[]; current: CurrentChange[] } {
  const upsert: TargetInput[] = [{ kind: 'character', key: real, target: realTarget(target) }]
  for (const w of weapons) {
    upsert.push({
      kind: 'weapon',
      id: w.goalId,
      key: w.key,
      owner: real,
      target: w.target as Extract<TargetInput, { kind: 'weapon' }>['target'],
    })
  }
  return {
    remove: [{ kind: 'custom', key }],
    upsert,
    current: current ? [{ kind: 'character', key: real, current }] : [],
  }
}
