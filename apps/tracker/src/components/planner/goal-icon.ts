import { characterIcon } from '@/lib/assets'
import { plannerWeaponIcon } from './custom-registry'
import type { GoalEntry } from './model'

/** A goal card's portrait: the character's (a custom one's own picture), or its weapon's. */
export function goalIcon(entry: GoalEntry): string {
  const ch = entry.character
  if (ch) return ch.custom ? (ch.custom.image ?? '') : characterIcon(ch.key)
  const w = entry.weapons[0]
  return w ? plannerWeaponIcon(w.key, w.target.ascension) : ''
}
