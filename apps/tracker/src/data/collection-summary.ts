import { ARCHIVE_TABS, WARDROBE_KINDS } from '@gdt/shared'
import {
  archiveEntries,
  recipeEntries,
  tcgEntries,
  wardrobeEntries,
  aranaraTotal,
  type CollectionCatalog,
} from './collection-names'
import type { CapturedCollections } from './collection-parts'
import { musicSongs, musicSummary } from './music'
import { recipeRows } from './recipes'
import { spincrystalProgress, type Spincrystal } from './spincrystals'
import { explorationPercent, worldModel } from './world'

/**
 * One figure per Collections card, counted the way its page counts: `have`
 * of `total` the game data lists, or a bare `count` where the game has no
 * total (Living Beings). Null when no capture has that part. Pure.
 */
export type CollectionFigure =
  | { have: number; total: number }
  | { count: number }
  /** A share out of 100 (World: average exploration). */
  | { percent: number }

export interface CollectionFigures {
  /** Average exploration of the captured areas (the waypoint count wasn't reliable). */
  world: CollectionFigure | null
  spincrystals: CollectionFigure | null
  archive: CollectionFigure | null
  handbook: CollectionFigure | null
  'living-beings': CollectionFigure | null
  tcg: CollectionFigure | null
  recipes: CollectionFigure | null
  /** Recipes unlocked at the bench and the blacksmith together (processing isn't shown). */
  crafting: CollectionFigure | null
  wardrobe: CollectionFigure | null
  /** Hangout endings reached. */
  hangouts: CollectionFigure | null
  blueprints: CollectionFigure | null
  /** Music game rewards claimed, of the beatmaps with a reward. */
  music: CollectionFigure | null
  aranara: CollectionFigure | null
}

const ofSets = (sets: { owned: ReadonlySet<number>; known: readonly { id: number }[] }[]) => ({
  have: sets.reduce((sum, s) => sum + s.known.filter((entry) => s.owned.has(entry.id)).length, 0),
  total: sets.reduce((sum, s) => sum + s.known.length, 0),
})

export function collectionFigures(
  captured: CapturedCollections,
  catalog: CollectionCatalog | null,
  spincrystals: readonly Spincrystal[] | null,
): CollectionFigures {
  const spin = captured.spincrystals?.value
  const archive = captured.archive?.value
  const handbook = captured.handbook?.value
  const defeats = captured.defeats?.value
  const tcg = captured.tcg?.value
  const recipes = captured.recipes?.value
  const wardrobe = captured.wardrobe?.value
  const aranara = captured.aranara?.value
  const exploration = captured.exploration?.value
  const hangouts = captured.hangouts?.value
  const crafting = captured.crafting?.value
  const blueprints = captured.blueprints?.value
  const music = captured.musicGame?.value
  const withCatalog = <T>(
    value: T | undefined,
    count: (c: CollectionCatalog, v: T) => CollectionFigure,
  ) => (value !== undefined && catalog ? count(catalog, value) : null)

  return {
    world: withCatalog(exploration, (c, v) => ({
      percent: explorationPercent(worldModel(v, c)) ?? 0,
    })),
    spincrystals:
      spin && spincrystals
        ? (({ have, total }) => ({ have, total }))(spincrystalProgress(spincrystals, spin))
        : null,
    archive: withCatalog(archive, (c, v) =>
      ofSets(
        ARCHIVE_TABS.map((tab) => ({
          owned: new Set(v[tab] ?? []),
          known: archiveEntries(c, tab),
        })),
      ),
    ),
    // Chapters claimed, of the chapters the capture lists.
    handbook: handbook
      ? (() => {
          const chapters = Object.values(handbook.chapters ?? {})
          return {
            have: chapters.filter((ch) => ch.state === 'claimed').length,
            total: chapters.length,
          }
        })()
      : null,
    'living-beings':
      defeats !== undefined
        ? // As the page lists them: defeated, or only captured (creatures).
          {
            count: Object.values(defeats).filter((d) => d.defeated > 0 || (d.captured ?? 0) > 0)
              .length,
          }
        : null,
    tcg: withCatalog(tcg, (c, v) => {
      const owned = v.cards ?? {}
      const entries = [...tcgEntries(c, 'characters'), ...tcgEntries(c, 'actions')]
      return {
        have: entries.filter((entry) => owned[String(entry.id)]).length,
        total: entries.length,
      }
    }),
    recipes: withCatalog(recipes, (c, v) => {
      const rows = recipeRows(recipeEntries(c), v).filter((row) => !row.unknown)
      return { have: rows.filter((row) => row.state !== 'locked').length, total: rows.length }
    }),
    wardrobe: withCatalog(wardrobe, (c, v) =>
      ofSets(
        WARDROBE_KINDS.map((kind) => {
          const owned = new Set(v[kind]?.owned ?? [])
          return { owned, known: wardrobeEntries(c, kind, owned) }
        }),
      ),
    ),
    crafting: withCatalog(crafting, (c, v) => {
      const kinds = ['crafting', 'forging'] as const
      const known = kinds.map((k) => new Set(c.data[k].map((r) => r.id)))
      return {
        have: kinds.reduce(
          (sum, k, i) => sum + (v[k] ?? []).filter((id) => known[i]!.has(id)).length,
          0,
        ),
        total: known.reduce((sum, set) => sum + set.size, 0),
      }
    }),
    hangouts: hangouts
      ? (() => {
          const endings = Object.values(hangouts).flatMap((h) => Object.values(h.endings))
          return {
            have: endings.filter((state) => state !== 'locked').length,
            total: endings.length,
          }
        })()
      : null,
    blueprints: withCatalog(blueprints, (c, v) => {
      const known = new Set(c.data.blueprints.map((b) => b.id))
      return { have: v.filter((id) => known.has(id)).length, total: known.size }
    }),
    music: withCatalog(music, (c, v) => {
      const s = musicSummary(musicSongs(c, v))
      return { have: s.rewardsClaimed, total: s.rewards }
    }),
    // Found = collected or done; a collectable one is only open to start (AranaraTab).
    aranara: withCatalog(aranara, (c, v) => ({
      have: Object.values(v).reduce(
        (sum, entries) => sum + Object.values(entries).filter((state) => state === 'collected' || state === 'finished').length,
        0,
      ),
      total: aranaraTotal(c),
    })),
  }
}
