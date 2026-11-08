/**
 * User and account settings. Stored as JSON on the server, cached in
 * localStorage on the client; both sides merge what they load against these
 * defaults, so a missing or partial stored object is always valid.
 */

export type TimelineGroupBy = 'hour' | 'day' | 'month' | 'year'

export interface MaterialsGraphSettings {
  selectedKeys: string[]
  groupBy: TimelineGroupBy
  limit: number
}

export interface AccountSettings {
  materialsGraph: MaterialsGraphSettings
  /** Which twin the Traveler is (GOOD doesn't say): portraits only. */
  traveler: 'F' | 'M'
  /** Adventure Rank and World Level, for the planner's drop estimates; null = not set. */
  ar: number | null
  wl: number | null
  planner: PlannerSettings
  /**
   * Original Resin set by hand in the planner's resin tracker, regenerating
   * from `at`. A capture whose resin was read after `at` replaces it; null:
   * the capture's count.
   */
  resin: ManualResin | null
  /**
   * Characters pinned to the top of the Characters page, as GOOD keys (each
   * Traveler by its element key, `TravelerAnemo`). Order carries no meaning.
   */
  favoriteCharacters: string[]
}

/** At most this many favourite characters (more than the game has). */
export const MAX_FAVORITE_CHARACTERS = 200

export interface ManualResin {
  value: number
  /** When it was set (ms since epoch). */
  at: number
}

export interface PlannerSettings {
  /** Cover missing gems by converting spare ones with Dust of Azoth. */
  azoth: boolean
  /** Apply owned characters' crafting/ascension mora passives (Raiden, Wanderer). */
  passives: boolean
  /** Original Resin refreshes a day (0–6, 60 resin each): the Farm view's days count them. */
  refreshes: number
  /**
   * The resin tracker's quick buttons, in the order shown: amounts to add
   * (−40 spends a boss run), up to four, chosen as chips in Planner settings.
   */
  resinSteps: number[]
  /**
   * The amounts the resin tracker lists "when resin reaches" for (1–200,
   * ascending, up to 12), chosen in Planner settings like Seelie's recovery
   * times (Discord users' ask, 2026-11-05: the fixed 40 … 200 list missed
   * 20 and 140). Empty: no list. Absent in settings saved before it: the
   * default.
   */
  resinMarks: number[]
  /** Show the Crafting checklist on the Farm view (most craft on demand, so it can be hidden). */
  crafting: boolean
  /**
   * Count ascension gemstones in the plan. Off: gems drop out of every cost,
   * so bosses are farmed for their boss materials only (gems come from
   * elsewhere: the shop, events, Dust of Azoth).
   */
  gems: boolean
  /**
   * Convert a weekly boss's spare drops into the one needed with Dream
   * Solvent (the game's Alchemy conversion). Off: every weekly drop is farmed
   * as it is (a Discord user's ask, 2026-11-05). Absent in settings saved
   * before it: read as on.
   */
  solvent: boolean
}

/**
 * The site's languages: every language Genshin Impact ships, English first
 * (BCP 47 codes; the game data, vue-i18n, Intl and <html lang> use the same).
 */
export const SITE_LANGUAGES = [
  'en',
  'zh-CN',
  'zh-TW',
  'ja',
  'ko',
  'es',
  'fr',
  'ru',
  'th',
  'vi',
  'de',
  'id',
  'pt',
  'it',
  'tr',
] as const
export type SiteLanguage = (typeof SITE_LANGUAGES)[number]

export interface UserSettings {
  /** `system` follows the OS (the default). */
  theme: 'system' | 'light' | 'dark'
  use24Hour: boolean
  /** The site's language: `system` follows the browser (the default). */
  language: 'system' | SiteLanguage
  /**
   * The phone tab bar's pages (`shell.nav` keys of an account's sections, at
   * most TAB_BAR_MAX), shown in the sidebar's order; "More" holds the rest.
   */
  tabBar: string[]
  /**
   * The Overview's progression graphs, in the order shown (the Graphs
   * dialog); null: the defaults (mora and primogems).
   */
  progressionGraphs: ProgressionGraph[] | null
}

/** Pages the phone tab bar holds besides "More". */
export const TAB_BAR_MAX = 4

/**
 * One graph on the Overview's progression card: the figure it shows (a
 * progression figure key; one this build doesn't know is skipped), where its
 * y axis starts (`auto` = the lowest value, `zero`, or a number) and ends
 * (`auto` = the highest value, `bag` = the game's bag limit for artifacts and
 * weapons, or a number), and whether its delta graph (change per snapshot or
 * period) is drawn under it.
 */
export interface ProgressionGraph {
  figure: string
  from: 'auto' | 'zero' | number
  to: 'auto' | 'bag' | number
  delta: boolean
}

/** Graphs the progression card holds at most. */
export const MAX_PROGRESSION_GRAPHS = 12

/** What a PATCH may carry: any subset, nested objects included. */
export type UserSettingsPatch = Partial<UserSettings>
export interface AccountSettingsPatch {
  materialsGraph?: Partial<MaterialsGraphSettings>
  traveler?: AccountSettings['traveler']
  ar?: number | null
  wl?: number | null
  planner?: Partial<PlannerSettings>
  resin?: ManualResin | null
  favoriteCharacters?: string[]
}

export const USER_SETTINGS_DEFAULTS: UserSettings = {
  theme: 'system',
  use24Hour: false,
  language: 'system',
  tabBar: ['overview', 'characters', 'materials', 'planner'],
  progressionGraphs: null,
}

export const MATERIALS_GRAPH_DEFAULTS: MaterialsGraphSettings = {
  // A saved empty list means the user cleared it, so the default lives here.
  selectedKeys: ['Mora', 'Primogem'],
  groupBy: 'day',
  limit: 365,
}

export const ACCOUNT_SETTINGS_DEFAULTS: AccountSettings = {
  materialsGraph: MATERIALS_GRAPH_DEFAULTS,
  traveler: 'F',
  ar: null,
  wl: null,
  planner: {
    azoth: false,
    passives: true,
    refreshes: 0,
    resinSteps: [-40, -20, 60, -30],
    resinMarks: [40, 200],
    crafting: true,
    gems: true,
    solvent: true,
  },
  resin: null,
  favoriteCharacters: [],
}

/**
 * Recursively merges `patch` over `base`. Plain objects merge key by key;
 * arrays and scalars replace; `undefined` in the patch leaves the base value.
 */
export function deepMerge<T extends object>(base: T, patch: object): T {
  const result = { ...base } as Record<string, unknown>

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    const existing = result[key]
    if (isPlainObject(value) && isPlainObject(existing)) {
      result[key] = deepMerge(existing, value)
    } else {
      result[key] = value
    }
  }

  return result as T
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
