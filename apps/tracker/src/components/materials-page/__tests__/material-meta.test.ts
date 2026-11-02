import { decodeBag } from '@gdt/game-data/bag'
import bagJson from '@gdt/game-data/data/bag.json'
import materialsJson from '@gdt/game-data/data/materials.json'
import type { BagFile, MaterialIndexFile } from '@gdt/game-data/format'
import { entryId } from '@gdt/game-data/icons'
import { describe, expect, it } from 'vitest'
import { materialItem } from '../material-items'
import {
  bagTabs,
  collectedElsewhere,
  compareInGame,
  loadCatalogKeys,
  loadMaterialMeta,
  materialMeta,
  metaFor,
  tabsHolding,
  type MaterialMeta,
  type TabKey,
} from '../material-meta'

const indexFile = materialsJson as unknown as MaterialIndexFile
const bag = decodeBag(bagJson as unknown as BagFile, indexFile)
const index = {
  id: (key: string) => {
    const entry = Object.hasOwn(indexFile.materials, key) ? indexFile.materials[key] : undefined
    return entry === undefined ? undefined : entryId(entry)
  },
}
const meta = (key: string) => metaFor(bag, index, key)
const item = (key: string, m: MaterialMeta = meta(key)) => ({ key, name: key, ...m })

/** The game's tab keys left to right, then Other. */
const TAB_ORDER: TabKey[] = [...bag.tabs.map((t) => t.key), 'other']

describe('materials in the in-game Inventory tabs', () => {
  it('puts each material in the tab the game shows it in', () => {
    const tabOf = (key: string) => meta(key).tab
    // The game keeps enhancement ores with the weapons and Sanctifying items with the artifacts.
    expect(['MysticEnhancementOre', 'FineEnhancementOre', 'EnhancementOre'].map(tabOf)).toEqual([
      'weapon',
      'weapon',
      'weapon',
    ])
    expect(['SanctifyingEssence', 'SanctifyingUnction'].map(tabOf)).toEqual([
      'artifact',
      'artifact',
    ])
    for (const key of [
      'HerosWit',
      'TeachingsOfFreedom',
      'CrownOfInsight',
      'AgnidusAgateSliver',
      'DvalinsPlume',
      'SlimeCondensate',
    ]) {
      expect(tabOf(key), key).toBe('development')
    }
    expect(tabOf('AdeptusTemptation')).toBe('food')
    for (const key of ['Cecilia', 'IronChunk', 'CrystalChunk', 'RawMeat', 'Medaka']) {
      expect(tabOf(key), key).toBe('material')
    }
    expect(tabOf('WindCatcher')).toBe('gadget')
    expect(tabOf('AncientForgingBlueprint')).toBe('quest')
    expect(tabOf('IntertwinedFate')).toBe('precious')
    // A furnishing blueprint: the game lists blueprints with the precious items.
    expect(tabOf('AdventurerCamp')).toBe('precious')
  })

  it('sends keys in no tab, and keys newer than the data, to Other', () => {
    for (const key of ['Mora', 'Primogem', 'GenesisCrystal', 'OriginalResin', 'CeciliaSeed']) {
      expect(meta(key).tab, key).toBe('other')
    }
    const unknown = meta('SomethingFromAFuturePatch')
    expect(unknown).toEqual({
      tab: 'other',
      order: Number.MAX_SAFE_INTEGER,
      id: Number.MAX_SAFE_INTEGER,
    })
    // Before the data loads, everything is Other (nothing is dropped).
    const fake = { tab: () => null, sortKey: () => 7 }
    expect(metaFor(fake, { id: () => 42 }, 'Mora')).toEqual({ tab: 'other', order: 7, id: 42 })
  })

  it('lists the tabs an account fills, in the game order, Other last', () => {
    const items = ['Mora', 'Cecilia', 'HerosWit', 'MysticEnhancementOre', 'Cecilia'].map((key) =>
      item(key),
    )
    expect(tabsHolding(bag.tabs, items)).toEqual(['weapon', 'development', 'material', 'other'])
    expect(tabsHolding(bag.tabs, [])).toEqual([])
    // Furnishings holds no material a capture can have.
    expect(bag.tabs.find((t) => t.key === 'furnishing')?.size).toBe(0)
  })
})

describe('the in-game order', () => {
  it('orders a tab as the game does', () => {
    const sorted = (keys: string[]) =>
      keys
        .map((key) => item(key))
        .sort(compareInGame)
        .map((i) => i.key)
    // EXP books and ores: highest rarity first.
    expect(sorted(['WanderersAdvice', 'HerosWit', 'AdventurersExperience'])).toEqual([
      'HerosWit',
      'AdventurersExperience',
      'WanderersAdvice',
    ])
    expect(sorted(['EnhancementOre', 'MysticEnhancementOre', 'FineEnhancementOre'])).toEqual([
      'MysticEnhancementOre',
      'FineEnhancementOre',
      'EnhancementOre',
    ])
    // Exactly the data's order inside a tab, so a data fix flows through.
    const development = [
      'AgnidusAgateChunk',
      'TeachingsOfFreedom',
      'HerosWit',
      'DvalinsPlume',
      'SlimeCondensate',
      'SlimeSecretions',
      'CrownOfInsight',
      'PhilosophiesOfFreedom',
    ]
    expect(sorted(development)).toEqual([...development].sort(bag.order))
  })

  it('orders All tab by tab, then the tab order, Other (wallet first, then by id) and unknown keys last', () => {
    const keys = [
      'SomethingFromAFuturePatch',
      'CeciliaSeed',
      'Primogem',
      'IntertwinedFate',
      'AncientForgingBlueprint',
      'WindCatcher',
      'Cecilia',
      'AdeptusTemptation',
      'Mora',
      'HerosWit',
      'SanctifyingEssence',
      'ConquestTalisman',
      'MysticEnhancementOre',
      'AgnidusAgateSliver',
    ]
    const sorted = keys.map((key) => item(key)).sort(compareInGame)
    expect(sorted.map((i) => i.key)).toEqual([
      'MysticEnhancementOre',
      'SanctifyingEssence',
      // Development: EXP books before gems, as in game.
      'HerosWit',
      'AgnidusAgateSliver',
      'AdeptusTemptation',
      'Cecilia',
      'WindCatcher',
      'AncientForgingBlueprint',
      'IntertwinedFate',
      // Other: the wallet's order, then item id, then keys the data doesn't know.
      'Mora',
      'Primogem',
      'ConquestTalisman',
      'CeciliaSeed',
      'SomethingFromAFuturePatch',
    ])
    // Tab by tab, never back.
    const ranks = sorted.map((i) => TAB_ORDER.indexOf(i.tab))
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
  })

  it('keeps every material of a whole tab in the data order across All', () => {
    const all = Object.keys(indexFile.materials)
    const shuffled = [...all].sort((a, b) => (a.length % 7) - (b.length % 7) || b.localeCompare(a))
    const sorted = shuffled.map((key) => item(key)).sort(compareInGame)
    const inTabs = sorted.filter((i) => i.tab !== 'other').map((i) => i.key)
    expect(inTabs).toEqual(all.filter((key) => bag.tab(key)).sort(bag.order))
    const ranks = sorted.map((i) => TAB_ORDER.indexOf(i.tab))
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
  })
})

describe('the page loader', () => {
  it('places keys once the bag and the index are in', async () => {
    expect(materialMeta('HerosWit').tab).toBe('other')
    await loadMaterialMeta()
    expect(bagTabs().map((t) => t.key)).toEqual(bag.tabs.map((t) => t.key))
    expect(materialMeta('HerosWit')).toEqual(meta('HerosWit'))
    const ore = materialItem('MysticEnhancementOre', 12)
    expect(ore).toMatchObject({ tab: 'weapon', count: 12, wallet: false })
    expect(materialItem('IntertwinedFate', 3)).toMatchObject({ tab: 'precious', wallet: true })
    expect(materialItem('Mora', 1)).toMatchObject({ tab: 'other', wallet: true })
  })
})

describe("Don't have", () => {
  it('leaves out what Collections tracks: blueprints, recipes, diagrams, spincrystals', () => {
    expect(collectedElsewhere('RadiantSpincrystal12', 141012)).toBe(true)
    expect(collectedElsewhere('RecipeZharkoye', 109655)).toBe(true)
    expect(collectedElsewhere('DiagramAnemoTreasureCompass', 221009)).toBe(true)
    expect(collectedElsewhere('WineOClock', 350013)).toBe(true)
    expect(collectedElsewhere('AlchemistsCraftingBench', 394306)).toBe(true)
    expect(collectedElsewhere('SilkenFeather', 113061)).toBe(false)
    expect(collectedElsewhere('IntertwinedFate', 223)).toBe(false)
  })

  it('lists the bag catalog without them', async () => {
    const keys = await loadCatalogKeys()
    expect(keys).toContain('SilkenFeather')
    expect(keys.some((key) => key.startsWith('RadiantSpincrystal'))).toBe(false)
    expect(keys.length).toBeLessThan(2500)
  })
})
