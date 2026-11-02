import { defineAsyncComponent, type Component } from 'vue'
import {
  Archive,
  BookMarked,
  BookOpen,
  CookingPot,
  Hammer,
  Disc3,
  HeartHandshake,
  Layers,
  Map as MapIcon,
  Music,
  PawPrint,
  Shirt,
  Sofa,
  Swords,
  Sprout,
  Trophy,
} from 'lucide-vue-next'
import type { CollectionTopic } from '@gdt/game-data/collections'
import type { CapturedCollections } from '@/data/collections'

/** The collections, in the hub's order; the slug is the URL's last segment (`/collections/archive`). */
export const COLLECTION_TABS = [
  'achievements',
  'world',
  'spincrystals',
  'anecdotes',
  'archive',
  'handbook',
  'living-beings',
  'local-legends',
  'tcg',
  'recipes',
  'crafting',
  'wardrobe',
  'hangouts',
  'blueprints',
  'music',
  'aranara',
] as const
export type CollectionTab = (typeof COLLECTION_TABS)[number]

export const isCollectionTab = (value: unknown): value is CollectionTab =>
  typeof value === 'string' && (COLLECTION_TABS as readonly string[]).includes(value)

/** A tab's label: `collections.tabs.<key>`. */
export const TAB_LABEL = {
  achievements: 'achievements',
  world: 'world',
  spincrystals: 'spincrystals',
  anecdotes: 'anecdotes',
  archive: 'archive',
  handbook: 'handbook',
  'living-beings': 'livingBeings',
  'local-legends': 'localLegends',
  tcg: 'tcg',
  recipes: 'recipes',
  crafting: 'crafting',
  wardrobe: 'wardrobe',
  hangouts: 'hangouts',
  blueprints: 'blueprints',
  music: 'music',
  aranara: 'aranara',
} as const satisfies Record<CollectionTab, string>

/**
 * The captured part a tab shows (its capture time is the tab's); null for
 * Achievements, Anecdotes and Local Legends, which load their own data and
 * hand marks.
 */
export const TAB_PART: Readonly<Record<CollectionTab, keyof CapturedCollections | null>> = {
  achievements: null,
  world: 'exploration',
  spincrystals: 'spincrystals',
  anecdotes: null,
  archive: 'archive',
  handbook: 'handbook',
  'living-beings': 'defeats',
  'local-legends': null,
  tcg: 'tcg',
  recipes: 'recipes',
  crafting: 'crafting',
  wardrobe: 'wardrobe',
  hangouts: 'hangouts',
  blueprints: 'blueprints',
  music: 'musicGame',
  aranara: 'aranara',
}

/** Tabs that list the game data's collections (names, totals): they wait for it. */
export const NEEDS_CATALOG: ReadonlySet<CollectionTab> = new Set([
  'world',
  'archive',
  'handbook',
  'tcg',
  'recipes',
  'crafting',
  'wardrobe',
  'hangouts',
  'blueprints',
  'music',
  'aranara',
])

/** Each tab's component, loaded when the tab is first shown. */
export const TAB_COMPONENTS: Readonly<Record<CollectionTab, Component>> = {
  // Its own page, kept as it was (the user's call), shown here like the rest.
  achievements: defineAsyncComponent(() => import('@/views/account/AchievementsView.vue')),
  world: defineAsyncComponent(() => import('./WorldTab.vue')),
  spincrystals: defineAsyncComponent(() => import('./SpincrystalsTab.vue')),
  anecdotes: defineAsyncComponent(() => import('./AnecdotesTab.vue')),
  archive: defineAsyncComponent(() => import('./ArchiveTab.vue')),
  handbook: defineAsyncComponent(() => import('./HandbookTab.vue')),
  'living-beings': defineAsyncComponent(() => import('./LivingBeingsTab.vue')),
  'local-legends': defineAsyncComponent(() => import('./LocalLegendsTab.vue')),
  tcg: defineAsyncComponent(() => import('./TcgTab.vue')),
  recipes: defineAsyncComponent(() => import('./RecipesTab.vue')),
  crafting: defineAsyncComponent(() => import('./CraftingTab.vue')),
  wardrobe: defineAsyncComponent(() => import('./WardrobeTab.vue')),
  hangouts: defineAsyncComponent(() => import('./HangoutsTab.vue')),
  blueprints: defineAsyncComponent(() => import('./BlueprintsTab.vue')),
  music: defineAsyncComponent(() => import('./MusicTab.vue')),
  aranara: defineAsyncComponent(() => import('./AranaraTab.vue')),
}

/** Each collection's card icon. */
export const TAB_ICON: Readonly<Record<CollectionTab, Component>> = {
  achievements: Trophy,
  world: MapIcon,
  spincrystals: Disc3,
  anecdotes: BookOpen,
  archive: Archive,
  handbook: BookMarked,
  'living-beings': PawPrint,
  'local-legends': Swords,
  tcg: Layers,
  recipes: CookingPot,
  crafting: Hammer,
  wardrobe: Shirt,
  hangouts: HeartHandshake,
  blueprints: Sofa,
  music: Music,
  aranara: Sprout,
}

/**
 * A hub card's game picture (design B4, 2026-10-30): one whole picture in the
 * card's top-right corner, faded toward the bottom-left. Square pictures are
 * the base box × `scale`; tall ones `height` × the base box high, `ratio` wide.
 */
export interface CardArt {
  name: string
  /** Served by gi-cdn by hand (its publish.json `extra`), not nanoka. */
  cdn?: true
  scale?: number
  tall?: { ratio: number; height: number; radius?: number }
  /** Degrees, static. */
  rotate?: number
  /** Its own corner: [top, right] px on phones and from `sm`. */
  place?: { base: [number, number]; sm: [number, number] }
}

export const TAB_ART: Readonly<Record<CollectionTab, CardArt>> = {
  achievements: { name: 'UI_AchievementIcon_1_1' },
  world: { name: 'UI_ItemIcon_107001' },
  spincrystals: { name: 'UI_ItemIcon_BGM_Common', scale: 0.92 },
  anecdotes: { name: 'UI_ItemIcon_220124', rotate: 8 },
  archive: { name: 'UI_ItemIcon_121036' },
  handbook: { name: 'UI_ItemIcon_100226' },
  'living-beings': { name: 'UI_ItemIcon_112007' },
  // Liam, the Fontaine Treasure Hoarder who stands for Local Legends (the user's pick).
  'local-legends': { name: 'UI_MonsterIcon_Male_Standard_Rocky_001' },
  tcg: {
    name: 'UI_Gcg_CardBack_00',
    cdn: true,
    tall: { ratio: 420 / 720, height: 1.14, radius: 6 },
    rotate: 10,
  },
  recipes: { name: 'UI_ItemIcon_Recipe_1004' },
  crafting: { name: 'UI_EquipIcon_Catalyst_Proto' },
  wardrobe: {
    name: 'UI_Gacha_FlycloakIcon_Glider',
    cdn: true,
    tall: { ratio: 223 / 717, height: 1.5 },
    rotate: 55,
    place: { base: [-2, 39], sm: [-8, 66] },
  },
  hangouts: { name: 'UI_ItemIcon_121209', rotate: 6 },
  blueprints: { name: 'UI_ItemIcon_220026' },
  music: { name: 'UI_ItemIcon_220025' },
  aranara: { name: 'UI_ItemIcon_220055' },
}

/** The game data topics each collection's page reads (its chunks only). */
export const TAB_TOPICS: Readonly<Record<CollectionTab, readonly CollectionTopic[]>> = {
  achievements: [],
  world: ['world', 'domains', 'npcs', 'natlan'],
  spincrystals: [],
  anecdotes: [],
  // `world`: the World Quests' region names.
  archive: ['archive', 'world'],
  handbook: ['handbook'],
  // The enemy encyclopedia loads its own data (data/enemies.ts).
  'living-beings': [],
  // Its own enemy data and achievements; the region names come from `world`.
  'local-legends': [],
  tcg: ['tcg'],
  recipes: ['recipes'],
  crafting: ['crafting'],
  wardrobe: ['wardrobe'],
  hangouts: ['hangouts'],
  blueprints: ['home'],
  music: ['music'],
  aranara: ['aranara'],
}

/** What the hub's card figures count against (collection-summary.ts). */
export const HUB_TOPICS: readonly CollectionTopic[] = [
  'world',
  'archive',
  'tcg',
  'recipes',
  'crafting',
  'wardrobe',
  'home',
  'music',
  'aranara',
]
