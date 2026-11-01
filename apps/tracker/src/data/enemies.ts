/**
 * The enemy encyclopedia: the game's Living Beings archive with each
 * monster's stats (`@gdt/game-data/enemies`), in the language on screen.
 * Collections → Living Beings lists it (with the capture's defeat counts),
 * and an entry opens as a dialog (`?enemy=<id>`), also from the Endgame page.
 */

import {
  ENEMY_FACTIONS,
  loadEnemies,
  loadEnemyNames,
  type Enemies,
  type Enemy,
  type EnemyFaction,
  type EnemyNames,
} from '@gdt/game-data/enemies'
import type { Locale } from '@/i18n/locale'

export { ENEMY_FACTIONS, type Enemy, type EnemyFaction }

export interface EnemyData {
  enemies: Enemies
  names: EnemyNames
}

const cache = new Map<Locale, Promise<EnemyData>>()

/** The archive and its names in a language; the same promise per language. */
export function loadEnemyData(lang: Locale): Promise<EnemyData> {
  let found = cache.get(lang)
  if (!found) {
    found = Promise.all([loadEnemies(), loadEnemyNames(lang)]).then(([enemies, names]) => ({
      enemies,
      names,
    }))
    found.catch(() => cache.delete(lang))
    cache.set(lang, found)
  }
  return found
}

/** Entries matching a search (name or special names, any case) and a faction ('all' for every one). */
export function filterEnemies(
  list: readonly Enemy[],
  names: EnemyNames,
  faction: EnemyFaction | 'all',
  query: string,
): Enemy[] {
  const q = query.trim().toLocaleLowerCase()
  return list.filter((e) => {
    if (faction !== 'all' && e.faction !== faction) return false
    if (!q) return true
    if (names.name(e.id).toLocaleLowerCase().includes(q)) return true
    return names.special(e.id).some((s) => s.toLocaleLowerCase().includes(q))
  })
}

/** How many entries each faction has (the chips' counts). */
export function factionCounts(list: readonly Enemy[]): Record<EnemyFaction, number> {
  const counts = Object.fromEntries(ENEMY_FACTIONS.map((f) => [f, 0])) as Record<
    EnemyFaction,
    number
  >
  for (const e of list) counts[e.faction]++
  return counts
}
