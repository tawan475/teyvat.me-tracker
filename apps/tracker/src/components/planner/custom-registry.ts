/**
 * The open account's custom characters and weapons by id: their names and
 * pictures, for the planner parts that name or draw a goal by its key
 * alone (cards, avatars, the farm view). `usePlannerModel` keeps it in step
 * with the goals.
 */

import type { PlannerTarget } from '@gdt/shared'
import { shallowRef } from 'vue'
import { characterIcon, weaponIcon } from '@/lib/assets'
import { isCustomKey } from './custom-character'

export interface CustomProfile {
  name: string
  image?: string
}

const profiles = shallowRef<ReadonlyMap<string, CustomProfile>>(new Map())

/** The custom profiles the goals carry (a new map only when one changed). */
export function setCustomProfiles(targets: readonly PlannerTarget[]): void {
  const next = new Map<string, CustomProfile>()
  for (const t of targets) {
    const custom =
      t.kind === 'custom' ? t.target.custom : t.kind === 'weapon' ? t.target.custom : undefined
    if (custom) next.set(t.key, { name: custom.name, image: custom.image })
  }
  const before = profiles.value
  const same =
    before.size === next.size &&
    [...next].every(([k, p]) => before.get(k)?.name === p.name && before.get(k)?.image === p.image)
  if (!same) profiles.value = next
}

export const customProfile = (key: string): CustomProfile | undefined => profiles.value.get(key)

/** A goal weapon's icon: a custom weapon's picture ('' without one), else the game's. */
export function plannerWeaponIcon(key: string, ascension: number): string {
  if (!isCustomKey(key)) return weaponIcon(key, ascension)
  return profiles.value.get(key)?.image ?? ''
}

/** A goal character's icon: a custom character's picture ('' without one), else the game's. */
export function plannerCharacterIcon(key: string): string {
  if (!isCustomKey(key)) return characterIcon(key)
  return profiles.value.get(key)?.image ?? ''
}
