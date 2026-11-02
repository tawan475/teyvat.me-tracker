import {
  achievementText,
  indexKeys,
  loadAchievements,
  loadMaterialIndex,
  loadMaterialNames,
} from '@gdt/game-data'
import { loadBag } from '@gdt/game-data/bag'
import { CHARACTER_KEYS, WEAPON_KEYS, characterInfo, weaponInfo } from '@gdt/game-data/catalog'
import { searchWords, type SearchEntry } from '@/data/site-search'
import { loadEnemyData } from '@/data/enemies'
import { itemName } from '@/data/weapons'
import { characterName } from '@/i18n/game-names'
import type { Locale } from '@/i18n/locale'
import {
  characterIcon,
  gameIcon,
  imageUrl,
  loadMaterialIcons,
  materialIcon,
  weaponIcon,
} from '@/lib/assets'
import { WALLET } from '@/components/materials-page/material-meta'
import { keyToName } from '@/lib/format'
import { isPlayerProperty } from '@/utils/materials'

/**
 * The game's half of the site search (data/site-search.ts): every character,
 * weapon, item, enemy and achievement, named in the language on screen and
 * matched in English too. Built once per language when the dialog first
 * opens (the files are the pages' own lazy chunks).
 */

const built = new Map<Locale, Promise<SearchEntry[]>>()

export function loadSearchIndex(lang: Locale): Promise<SearchEntry[]> {
  let entries = built.get(lang)
  if (!entries) {
    entries = build(lang)
    entries.catch(() => built.delete(lang))
    built.set(lang, entries)
  }
  return entries
}

async function build(lang: Locale): Promise<SearchEntry[]> {
  const english = lang === 'en'
  const [
    materialsFile,
    names,
    englishNames,
    enemies,
    englishEnemies,
    achievements,
    text,
    enText,
    bag,
    index,
  ] = await Promise.all([
    import('@gdt/game-data/data/materials.json').then((m) => m.default ?? m),
    loadMaterialNames(lang),
    english ? null : loadMaterialNames('en'),
    loadEnemyData(lang),
    english ? null : loadEnemyData('en'),
    loadAchievements(),
    achievementText(lang),
    english ? null : achievementText('en'),
    loadBag(),
    loadMaterialIndex(),
    loadMaterialIcons(),
  ])
  const entries: SearchEntry[] = []

  // The Traveler's per-element keys are the roster's; the plain one is what the search finds.
  for (const key of CHARACTER_KEYS) {
    if (key.startsWith('Traveler') && key !== 'Traveler') continue
    const name = characterName(key)
    entries.push({
      kind: 'character',
      key,
      name,
      words: searchWords(name, keyToName(key)),
      rarity: characterInfo(key)?.rarity ?? 0,
      icon: characterIcon(key),
    })
  }
  for (const key of WEAPON_KEYS) {
    const name = itemName(key)
    entries.push({
      kind: 'weapon',
      key,
      name,
      words: searchWords(name, keyToName(key)),
      rarity: weaponInfo(key)?.rarity ?? 0,
      icon: weaponIcon(key),
    })
  }
  const { materials } = materialsFile as unknown as { materials: Parameters<typeof indexKeys>[0] }
  const seen = new Set<string>()
  for (const key of indexKeys(materials)) {
    const name = names.name(key)
    // Unnamed keys and old player properties aren't items anyone looks for,
    // nor quest items; outside the bag's tabs only the currencies.
    if (!name || isPlayerProperty(key)) continue
    const tab = bag.tab(key)
    if (tab === 'quest' || (tab == null && !WALLET.has(key))) continue
    // One row per name: the game keeps copies of some items (quest versions).
    const dedupe = `${name}\u0000${materialIcon(key)}`
    if (seen.has(dedupe)) continue
    seen.add(dedupe)
    entries.push({
      kind: 'item',
      key,
      name,
      words: searchWords(name, englishNames?.name(key)),
      rarity: index.rarity(key) ?? 0,
      icon: materialIcon(key),
    })
  }
  for (const enemy of enemies.enemies.enemies) {
    const name = enemies.names.name(enemy.id)
    if (!name) continue
    entries.push({
      kind: 'enemy',
      key: String(enemy.id),
      name,
      words: searchWords(
        name,
        englishEnemies?.names.name(enemy.id),
        ...enemies.names.special(enemy.id),
      ),
      rarity: 0,
      icon: imageUrl(enemy.icon),
    })
  }
  for (const achievement of achievements.achievements) {
    if (achievement.disused) continue
    const title = text.achievements.get(achievement.id)?.title
    if (!title) continue
    entries.push({
      kind: 'achievement',
      key: String(achievement.id),
      name: title,
      words: searchWords(title, enText?.achievements.get(achievement.id)?.title),
      rarity: 0,
      icon: gameIcon(achievements.goalById.get(achievement.goal)?.icon ?? ''),
    })
  }
  return entries
}
