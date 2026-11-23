import type { ArchiveTab, WardrobeKind } from '@gdt/shared'
import type { CollectionData, CollectionSection, CollectionTexts } from '@gdt/game-data/collections'
import { wikiPage } from '@/lib/wiki'
import { WIKI_QUEST_TITLES } from '@/lib/wiki-quest-titles'

/**
 * What the Collections tabs list, from the game data's collections
 * (`@gdt/game-data/collections`): every entry's name in the language on
 * screen (English where it has none), its icon and its order, by the id
 * the capture sends. Pure; the tabs load it through use-catalog.ts.
 *
 * Still id-only, as the game data has no names for them: Aranara entries
 * (the notebook names none), TCG levels and boss duels.
 */
export interface CollectionCatalog {
  data: CollectionData
  text: CollectionTexts
  english: CollectionTexts
}

/** One entry the way the grids show it. */
export interface CatalogEntry {
  id: number
  name: string
  /** A game image name (nanoka / gi-cdn), '' for none. */
  icon: string
  order: number
}

/** What stands in for a name the game data does not have. */
export const idLabel = (id: number): string => `#${id}`

/** An entry's name in the language on screen, else English, else its id. */
export function nameOf(
  catalog: CollectionCatalog,
  section: CollectionSection,
  id: number,
  column = 'name',
): string {
  const pick = (texts: CollectionTexts) =>
    (texts[section].get(id) as Record<string, string> | undefined)?.[column] || ''
  return pick(catalog.text) || pick(catalog.english) || idLabel(id)
}

/**
 * The Fandom wiki page of an entry, titled with its English name ("Glug in One
 * Go"); undefined when the game data has none.
 */
export function wikiGuide(
  catalog: CollectionCatalog,
  section: CollectionSection,
  id: number,
  /** A subpage family, as the wiki files tutorials (`Tutorial/`) and viewpoints (`Viewpoint/`). */
  prefix = '',
): string | undefined {
  const english = (catalog.english[section].get(id) as Record<string, string> | undefined)?.name
  if (!english) return undefined
  // A quest whose name is another page (a constellation, a character…) or split into parts.
  const quest = section === 'quests' || section === 'worldQuests'
  return wikiPage(prefix + ((quest && WIKI_QUEST_TITLES[english]) || english))
}

const str = (value: unknown) => (typeof value === 'string' ? value : '')
const num = (value: unknown) => (typeof value === 'number' ? value : 0)

/** A section's entries, in the game's order (then by id). */
export function entriesOf(
  catalog: CollectionCatalog,
  section: CollectionSection,
  icon: 'icon' | 'image' | null = 'icon',
): CatalogEntry[] {
  return (catalog.data[section] as unknown as Record<string, unknown>[])
    .map((row) => ({
      id: row.id as number,
      name: nameOf(catalog, section, row.id as number),
      icon: icon ? str(row[icon]) : '',
      order: num(row.order),
    }))
    .sort((a, b) => a.order - b.order || a.id - b.id)
}

/** Each Archive tab's game data section, and which column holds its picture. */
export const ARCHIVE_SECTIONS: Readonly<
  Record<ArchiveTab, { section: CollectionSection; icon: 'icon' | 'image' | null }>
> = {
  quests: { section: 'quests', icon: null },
  weapons: { section: 'weapons', icon: 'icon' },
  livingBeings: { section: 'livingBeings', icon: 'icon' },
  materials: { section: 'materials', icon: 'icon' },
  books: { section: 'books', icon: 'icon' },
  tutorials: { section: 'tutorials', icon: 'icon' },
  viewpoints: { section: 'viewpoints', icon: 'image' },
  artifacts: { section: 'artifacts', icon: 'icon' },
}

/** Every entry of an Archive tab. */
export const archiveEntries = (catalog: CollectionCatalog, tab: ArchiveTab): CatalogEntry[] =>
  entriesOf(catalog, ARCHIVE_SECTIONS[tab].section, ARCHIVE_SECTIONS[tab].icon)

/** A main quest's chapter ("Prologue: Act I · The Outlander Who Caught the Wind"), '' for none. */
export function questChapter(catalog: CollectionCatalog, questCodexId: number): string {
  const row = catalog.data.quests.find((q) => q.id === questCodexId)
  if (!row) return ''
  const chapter = num(row.chapter)
  const number = nameOf(catalog, 'chapters', chapter, 'number')
  const name = nameOf(catalog, 'chapters', chapter, 'name')
  return [number, name].filter((part) => !part.startsWith('#')).join(' · ')
}

/** A Living Being: name, icon and what the game counts for it ("kill", "capture"…). */
export function livingBeing(catalog: CollectionCatalog, id: number) {
  const row = catalog.data.livingBeings.find((b) => b.id === id)
  return {
    name: nameOf(catalog, 'livingBeings', id),
    icon: str(row?.icon),
    count: str(row?.count),
  }
}

/**
 * Handbook chapters by id, and targets by the key the capture sends: the
 * target's id (60001…), else the quest it belongs to (one quest can carry
 * several targets: the first in the game's order names it).
 */
export function handbookNames(catalog: CollectionCatalog) {
  const byId = new Map<number, { name: string; icon: string }>()
  const byQuest = new Map<number, { name: string; icon: string }>()
  for (const row of catalog.data.handbookTargets) {
    const entry = { name: nameOf(catalog, 'handbookTargets', row.id), icon: str(row.icon) }
    byId.set(row.id, entry)
    if (!byQuest.has(num(row.quest))) byQuest.set(num(row.quest), entry)
  }
  return {
    chapter: (id: number) => nameOf(catalog, 'handbookChapters', id),
    target: (key: number) => byId.get(key) ?? byQuest.get(key) ?? { name: idLabel(key), icon: '' },
  }
}

/** TCG cards a player can own: character cards (ids below 10,000) and action cards. */
export function tcgEntries(catalog: CollectionCatalog, kind: 'characters' | 'actions') {
  return entriesOf(catalog, kind === 'characters' ? 'tcgCharacters' : 'tcgCards', null)
}

/** A TCG card's name (character or action card). */
export const tcgCardName = (catalog: CollectionCatalog, id: number): string =>
  nameOf(catalog, id < 10_000 ? 'tcgCharacters' : 'tcgCards', id)

/** The wardrobe kinds' game data sections. */
export const WARDROBE_SECTIONS: Readonly<Record<WardrobeKind, CollectionSection>> = {
  outfits: 'outfits',
  gliders: 'gliders',
  weaponSkins: 'weaponSkins',
  trails: 'trails',
}

/** Weapon appearances never listed (the user's call): the quest's Exaiphanes Blade. */
const NEVER_LISTED: ReadonlySet<number> = new Set([390002, 390003])

/**
 * Every item of a wardrobe kind a player can own, as the game's wardrobe lists
 * them: not the default outfits every character starts with, and hidden ones
 * (event items the game lists once owned; debug ones nobody owns) only when
 * `owned` has them. Owned ids the game data lacks aren't listed (bare codes).
 */
export function wardrobeEntries(
  catalog: CollectionCatalog,
  kind: WardrobeKind,
  owned: ReadonlySet<number> = new Set(),
): CatalogEntry[] {
  const section = WARDROBE_SECTIONS[kind]
  const rows = catalog.data[section] as unknown as Record<string, unknown>[]
  const left = new Set(
    rows
      .filter(
        (row) =>
          (kind === 'outfits' && num(row.isDefault) === 1) ||
          (num(row.hidden) === 1 && !owned.has(row.id as number)),
      )
      .map((row) => row.id as number),
  )
  return entriesOf(catalog, section).filter(
    (entry) => !left.has(entry.id) && !NEVER_LISTED.has(entry.id),
  )
}

/** Recipes: name, icon, rarity and the proficiency that masters it, in the game's order. */
export function recipeEntries(catalog: CollectionCatalog) {
  return catalog.data.recipes.map((row) => ({
    id: row.id,
    name: nameOf(catalog, 'recipes', row.id),
    icon: str(row.icon),
    rarity: num(row.rarity),
    max: num(row.maxProficiency),
  }))
}

/** How many Aranara the notebook lists (it names none of them). */
export const aranaraTotal = (catalog: CollectionCatalog): number => catalog.data.aranara.length
