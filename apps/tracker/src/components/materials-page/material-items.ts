import type { MaterialsHistory } from '@/data/materials-history'
import { isPlayerProperty, materialName, materialRarity } from '@/utils/materials'
import { materialMeta, WALLET, type TabKey } from './material-meta'

/** One material the account has held in any snapshot. */
export interface MaterialItem {
  key: string
  /** The game's name ("Hero's Wit"); the key's words before the names load or for a newer key. */
  name: string
  /** The game's rarity (1-5), the tile's backdrop; null before the index loads or for a newer key. */
  rarity: number | null
  /** The in-game Inventory tab it sits in ('other': none, or newer than the data). */
  tab: TabKey
  /** Place in the game's order across the Inventory (see MaterialMeta). */
  order: number
  /** Item id (orders keys in no tab). */
  id: number
  /** Count in the newest snapshot (0 once spent or dropped). */
  count: number
  /** Currency or wish item (also shown in the wallet strip). */
  wallet: boolean
}

/**
 * A MaterialItem for a key, at the given count. Reactive through the name
 * and rarity: a computed building items rebuilds when the game data arrives.
 */
export function materialItem(key: string, count: number): MaterialItem {
  const meta = materialMeta(key)
  return {
    key,
    name: materialName(key),
    rarity: materialRarity(key),
    tab: meta.tab,
    order: meta.order,
    id: meta.id,
    count,
    wallet: WALLET.has(key),
  }
}

/**
 * Every material in the history, minus the account stats older Irminsul
 * builds stored as materials (world level, stamina, Property ids) and the
 * counts the newest capture's switches cover (`history.hidden`): those are
 * not shared now, so the bag lists none of them, at 0 or as spent either.
 */
export function buildItems(history: MaterialsHistory): MaterialItem[] {
  const items: MaterialItem[] = []
  for (const key of history.series.keys()) {
    if (isPlayerProperty(key) || history.hidden?.includes(key)) continue
    items.push(materialItem(key, history.latest.get(key) ?? 0))
  }
  return items
}

type Hides = Pick<MaterialsHistory, 'hidden'> | null | undefined

/**
 * Whether the newest capture's switches cover `key` (`history.hidden`): the
 * count is not shared now, so the page offers it nowhere.
 */
export function notSharedNow(history: Hides, key: string): boolean {
  return !!history?.hidden?.includes(key)
}

/**
 * `keys` as the bag lists them ("Don't have"): without the counts that are
 * not shared now, like the bag's own lists. The same array when it holds
 * none of them, so nothing recomputes; the keys left out are listed again
 * once a capture shares them. Not for the tracked charts: a pin on such a
 * count keeps its tile (trackedTiles in material-stats).
 */
export function listedKeys<T extends readonly string[]>(keys: T, history: Hides): T | string[] {
  const hidden = history?.hidden
  if (!hidden?.length || !keys.some((key) => hidden.includes(key))) return keys
  return keys.filter((key) => !hidden.includes(key))
}

/**
 * The material the detail dialog shows for `key` (a tile, a tracked chart,
 * the site search's `?m=`): the bag's item, or the key at 0 for one this
 * account never held. Null opens nothing: no key, or a count that is not
 * shared now, whichever way it was asked for.
 */
export function detailItemFor(
  key: string | null,
  byKey: ReadonlyMap<string, MaterialItem>,
  history: Hides,
): MaterialItem | null {
  if (!key || notSharedNow(history, key)) return null
  return byKey.get(key) ?? materialItem(key, 0)
}
