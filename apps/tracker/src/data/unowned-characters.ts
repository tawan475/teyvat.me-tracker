import { CHARACTER_KEYS } from '@gdt/game-data/catalog'
import { normalizeSearch } from '@/lib/search'
import type { CharacterFilters, Element, WeaponType } from './characters'
import { characterMeta } from './game-meta'

/**
 * The Characters page's "Don't have" (the user's ask, 2026-11-02): every
 * released character the account doesn't own, under the same search,
 * element, rarity and weapon filters as the roster. The Traveler (always
 * owned) and the Manekin pair (Miliastra Wonderland only) are left out.
 * Filters an unowned character can't meet (build, talents, favourites)
 * leave the list empty. Pure.
 */
export interface UnownedCharacter {
  key: string
  name: string
  rarity: number
  element: Element | null
  weapon: WeaponType
}

const SKIPPED = /^(Traveler|Manekin)/

export function unownedCharacters(
  owned: ReadonlySet<string>,
  filters: CharacterFilters,
  nameOf: (key: string) => string,
  keys: readonly string[] = CHARACTER_KEYS,
): UnownedCharacter[] {
  if (filters.build !== 'all' || filters.talents !== 'all' || filters.favorites) return []
  const words = normalizeSearch(filters.query).split(/\s+/).filter(Boolean)
  const out: UnownedCharacter[] = []
  for (const key of keys) {
    if (owned.has(key) || SKIPPED.test(key)) continue
    const meta = characterMeta(key)
    if (!meta) continue
    const [rarity, element, weapon] = meta
    if (filters.element !== 'all' && element !== filters.element) continue
    if (filters.rarity !== 'all' && rarity !== filters.rarity) continue
    if (filters.weaponType !== 'all' && weapon !== filters.weaponType) continue
    const name = nameOf(key)
    if (words.length) {
      const haystack = normalizeSearch(`${name} ${key}`)
      if (!words.every((word) => haystack.includes(word))) continue
    }
    out.push({ key, name, rarity, element, weapon })
  }
  return out.sort((a, b) => b.rarity - a.rarity || a.name.localeCompare(b.name))
}
