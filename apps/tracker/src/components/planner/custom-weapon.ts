/**
 * Custom weapons, pure: a placeholder for a weapon the game data doesn't
 * have yet, planned like any other (custom-character.ts does the same for
 * characters).
 *
 * A custom weapon is a weapon goal whose key is its own id (lowercase
 * first, so never a GOOD key) and whose target carries what it is
 * (`CustomWeapon`: name, rarity, type and materials). Every weapon of a
 * rarity levels and ascends with the same counts, so one of them is the
 * template and each material is swapped for the chosen family's member of
 * the same tier. A material not chosen yet is left out of the cost.
 */

import type {
  AscensionPhase,
  ItemCost,
  MaterialFamily,
  PlannerData,
  PlannerMaterial,
  PlannerWeapon,
} from '@gdt/game-data'
import type { CustomWeapon } from '@gdt/shared'
import { isCustomKey } from './custom-character'

/** A weapon of `rarity` with the three ascension families every regular one has. */
function template(planner: PlannerData, rarity: number): PlannerWeapon | null {
  for (const w of planner.weapons.values()) {
    if (w.rarity !== rarity || w.maxLevel !== 90 || isCustomKey(w.key)) continue
    const kinds = new Set(w.ascension.flatMap((p) => p.items.map((i) => i.material.kind)))
    if (kinds.has('weapon') && kinds.has('elite') && kinds.has('common')) return w
  }
  return null
}

/** The planner data's entry for a custom weapon (null when no weapon of its rarity is a template). */
export function customWeaponData(
  planner: PlannerData,
  key: string,
  custom: CustomWeapon,
): PlannerWeapon | null {
  const base = template(planner, custom.rarity)
  if (!base) return null
  const tierOf = (familyKey: string | undefined, tier: number) =>
    (familyKey && planner.materialsByKey.get(familyKey)?.family?.members[tier - 1]) || null
  const swap = (m: PlannerMaterial): PlannerMaterial | null => {
    switch (m.kind) {
      case 'weapon':
        return tierOf(custom.ascension, m.tier)
      case 'elite':
        return tierOf(custom.elite, m.tier)
      case 'common':
        return tierOf(custom.common, m.tier)
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
  return {
    key,
    id: 0,
    rarity: custom.rarity,
    type: custom.type,
    ascension: base.ascension.map(phase),
    maxLevel: base.maxLevel,
  }
}

/** The planner data with custom weapons in it (the same object when there are none). */
export function withCustomWeapons(
  planner: PlannerData,
  customs: Iterable<readonly [key: string, custom: CustomWeapon]>,
): PlannerData {
  const list = [...customs]
  if (list.length === 0) return planner
  const weapons = new Map(planner.weapons)
  for (const [key, custom] of list) {
    const data = customWeaponData(planner, key, custom)
    if (data) weapons.set(key, data)
  }
  return { ...planner, weapons }
}

export interface CustomWeaponChoices {
  /** Weapon ascension material families (the domains'). */
  ascensions: MaterialFamily[]
  /** Elite enemy drop families. */
  elites: MaterialFamily[]
  /** Common enemy drop families. */
  commons: MaterialFamily[]
}

/** What a custom weapon's materials can be, newest first (the game numbers items in order). */
export function customWeaponChoices(planner: PlannerData): CustomWeaponChoices {
  const families = (kind: string) =>
    planner.families
      .filter((f) => f.kind === kind && f.members.length > 0)
      .sort((a, b) => b.members[0]!.id - a.members[0]!.id)
  return {
    ascensions: families('weapon'),
    elites: families('elite'),
    commons: families('common'),
  }
}
