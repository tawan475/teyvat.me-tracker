import { WEAPON_KEYS } from '@gdt/game-data/catalog'
import { normalizeSearch } from '@/lib/search'
import { weaponMeta, type WeaponType } from './game-meta'
import type { WeaponFilters } from './weapons'

/**
 * The Weapons page's "Don't have" (the user's ask, 2026-11-04, like the
 * roster's): every weapon the game data knows that the account doesn't own,
 * under the page's search, type and rarity filters. Filters an unowned
 * weapon can't meet (equipped/spare, lock, level, refinable) leave the list
 * empty. Pure.
 */
export interface UnownedWeapon {
  key: string
  name: string
  rarity: number
  type: WeaponType
}

export function unownedWeapons(
  owned: ReadonlySet<string>,
  filters: WeaponFilters,
  nameOf: (key: string) => string,
  keys: readonly string[] = WEAPON_KEYS,
): UnownedWeapon[] {
  if (filters.status !== 'all' || filters.lock !== 'all' || filters.level !== 'all') return []
  if (filters.refinable) return []
  const words = normalizeSearch(filters.query).split(/\s+/).filter(Boolean)
  const out: UnownedWeapon[] = []
  for (const key of keys) {
    if (owned.has(key)) continue
    const meta = weaponMeta(key)
    if (!meta) continue
    const [rarity, type] = meta
    if (filters.rarity !== 'all' && rarity !== filters.rarity) continue
    if (filters.type !== 'all' && type !== filters.type) continue
    const name = nameOf(key)
    if (words.length) {
      const haystack = normalizeSearch(`${name} ${key}`)
      if (!words.every((word) => haystack.includes(word))) continue
    }
    out.push({ key, name, rarity, type })
  }
  return out.sort((a, b) => b.rarity - a.rarity || a.name.localeCompare(b.name))
}
