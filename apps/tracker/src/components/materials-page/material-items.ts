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
