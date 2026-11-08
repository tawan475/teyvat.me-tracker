import { characterInfo } from '@gdt/game-data/catalog'
import { toGoodKey } from '@gdt/game-data/good-key'
import { nameOf, type CollectionCatalog } from '@/data/collection-names'

/**
 * The Serenitea Pot's furnishing sets and companions (Capture 1.11.0's
 * `gi_collections.furnishingSets` and `companionRewards`), against the game
 * data's `furnitureSets` and `companionRewards` (one row per companion and
 * gift set: HomeWorldEvent's `eventID`, the id the capture sends).
 */

export interface SetCompanion {
  /** The reward's event id. */
  event: number
  /** The companion's avatar id. */
  character: number
  name: string
  /** The GOOD key of the companion's portrait; '' when the game data knows none. */
  key: string
  claimed: boolean
}

export interface FurnishingSetCard {
  id: number
  name: string
  icon: string
  learned: boolean
  /** Companions that give a reward for this set (none: not a gift set). */
  companions: SetCompanion[]
  claimed: number
}

export interface CompanionCard {
  character: number
  name: string
  key: string
  /** Gift sets this companion rewards, and those claimed. */
  total: number
  claimed: number
}

const num = (value: unknown) => (typeof value === 'number' ? value : 0)
const str = (value: unknown) => (typeof value === 'string' ? value : '')

function companionKey(catalog: CollectionCatalog, character: number): string {
  const english = (catalog.english.companions.get(character) as { name?: string } | undefined)?.name
  const key = english ? toGoodKey(english) : ''
  return key && characterInfo(key) ? key : ''
}

/** Every furnishing set in the game's order, learned or not, each with its gift companions. */
export function furnishingSetCards(
  catalog: CollectionCatalog,
  learned: readonly number[] | null,
  claimed: readonly number[] | null,
): FurnishingSetCard[] {
  const have = new Set(learned ?? [])
  const got = new Set(claimed ?? [])
  const bySet = new Map<number, SetCompanion[]>()
  for (const row of catalog.data.companionRewards) {
    const set = num(row.set)
    const character = num(row.character)
    const list = bySet.get(set) ?? []
    list.push({
      event: row.id,
      character,
      name: nameOf(catalog, 'companions', character),
      key: companionKey(catalog, character),
      claimed: got.has(row.id),
    })
    bySet.set(set, list)
  }
  return catalog.data.furnitureSets.map((row) => {
    const companions = bySet.get(row.id) ?? []
    return {
      id: row.id,
      name: nameOf(catalog, 'furnitureSets', row.id),
      icon: str(row.icon),
      learned: have.has(row.id),
      companions,
      claimed: companions.filter((c) => c.claimed).length,
    }
  })
}

/** Every companion with a gift set reward, in the game data's order: their rewards claimed. */
export function companionCards(
  catalog: CollectionCatalog,
  claimed: readonly number[] | null,
): CompanionCard[] {
  const got = new Set(claimed ?? [])
  const cards = new Map<number, CompanionCard>()
  for (const row of catalog.data.companionRewards) {
    const character = num(row.character)
    let card = cards.get(character)
    if (!card) {
      card = {
        character,
        name: nameOf(catalog, 'companions', character),
        key: companionKey(catalog, character),
        total: 0,
        claimed: 0,
      }
      cards.set(character, card)
    }
    card.total++
    if (got.has(row.id)) card.claimed++
  }
  return [...cards.values()]
}

/**
 * Whether a companion is one of `owned` (GOOD keys of the account's
 * characters). A companion whose key the game data doesn't know counts as
 * owned: hiding it could hide a character the account has.
 */
export function isOwnedCompanion(key: string, owned: ReadonlySet<string>): boolean {
  return !key || owned.has(key)
}

/** The companions the account owns ("Owned only"). */
export function ownedCompanions(
  cards: readonly CompanionCard[],
  owned: ReadonlySet<string>,
): CompanionCard[] {
  return cards.filter((c) => isOwnedCompanion(c.key, owned))
}

/**
 * Every set card with only the owned companions on it, `claimed` recounted.
 * The cards stay (the furniture is worth having whoever rewards it).
 */
export function setsWithOwnedCompanions(
  sets: readonly FurnishingSetCard[],
  owned: ReadonlySet<string>,
): FurnishingSetCard[] {
  return sets.map((set) => {
    const companions = set.companions.filter((c) => isOwnedCompanion(c.key, owned))
    if (companions.length === set.companions.length) return set
    return { ...set, companions, claimed: companions.filter((c) => c.claimed).length }
  })
}
