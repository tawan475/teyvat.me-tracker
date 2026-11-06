/**
 * Import limits. The browser validates against these before uploading and the
 * worker enforces them, so they live here once.
 *
 * Bulk imports are orchestrated by the browser one file per request, so the
 * file count only bounds a single batch in the UI. The size cap is per file; a
 * real GOOD export is ~600 KB.
 */
export const MAX_IMPORT_FILES = 250
export const MAX_IMPORT_FILE_SIZE_MB = 10
export const MAX_IMPORT_FILE_SIZE_BYTES = MAX_IMPORT_FILE_SIZE_MB * 1024 * 1024

/**
 * The most of each kind of item one GOOD file may carry: about 1.5× what the
 * game itself holds, so no real export comes near them, while a file of
 * made-up items is refused before anything is stored (normalizeGood throws a
 * GoodLimitError; the Worker answers 422). One real account at 7.1 exported
 * 103 characters, 1,121 weapons, 1,743 artifacts, 1,547 material keys and
 * 1,840 achievements. When a game data bump brings the game's own count
 * within 1.2× of a cap, the tracker's `good-limits.test.ts` fails: raise the
 * cap then.
 */
export const GOOD_LIMITS = {
  /** 130 playable characters in the 7.1 game data (`@gdt/game-data` catalog.json) × 1.5. */
  characters: 200,
  /** The game's weapon inventory holds 2,000. */
  weapons: 3_000,
  /** The game's artifact inventory holds 2,700 (raised from 2,400 in 7.0). */
  artifacts: 4_050,
  /** 7,394 material ids in the 7.1 game data (`@gdt/game-data` materials.json) × 1.5. */
  materialKeys: 11_100,
  /**
   * 2,012 achievement ids in the 7.1 game data (`@gdt/game-data`
   * achievements.json) × 1.5. Also for `gi_achievement_times`.
   */
  achievements: 3_020,
  /**
   * Entries in `gi_anecdotes`: 161 anecdotes in the 7.1 game data
   * (`@gdt/game-data` anecdotes.json) × about 12 (irminsul's bound too).
   */
  anecdotes: 2_000,
  /**
   * Item ids in `gi_collections.spincrystals`: 206 Radiant Spincrystals in
   * the 7.1 game data (`@gdt/game-data` materials.json, icon
   * `UI_ItemIcon_BGM_Common`) × about 10.
   */
  spincrystals: 2_000,
  // gi_collections' other parts and gi_wardrobe (Capture 1.4.0). Past one of
  // these a part is dropped (the rest of the upload is kept), unlike the caps
  // above, which refuse the file.
  /** Codex ids in one Archive tab: the largest real one is 1,006 (materials). */
  archiveTab: 10_000,
  /** Living Beings with a defeat count: 538 codex entries at 7.1, 502 in a real capture. */
  defeats: 3_000,
  /** Adventurer Handbook chapters (22 real) and targets (244 real). */
  handbookChapters: 200,
  handbookTargets: 3_000,
  /** Aranara collection entries (11 real). */
  aranara: 2_000,
  /** TCG cards owned (104 real); decks (4 real); a deck's 3 characters and 30 cards. */
  tcgCards: 5_000,
  tcgDecks: 100,
  deckCharacters: 10,
  deckCards: 60,
  /** Owned ids of one wardrobe kind (24 weapon skins real), and saved teams (14 real). */
  wardrobeOwned: 3_000,
  teams: 200,
  teamCharacters: 8,
  /** Unlocked cooking recipes: 284 in the 7.1 game data, 252 in a real capture. */
  recipes: 2_000,
  // gi_exploration (Capture 1.6.0): past one of these a part is dropped.
  /** Cities with a Statue or a reputation (16 real) and offerings (22 real). */
  explorationCities: 500,
  offerings: 500,
  /** Scenes with map points (8 real) and one scene's points (~893 in Teyvat) or areas (65). */
  scenes: 500,
  scenePoints: 20_000,
  /** Exploration areas (71 real). */
  exploreAreas: 3_000,
  // Capture 1.7.0: past one of these a part is dropped.
  /** Hangout chapters (19 real), endings per chapter (6 real), pictures per chapter. */
  hangouts: 500,
  hangoutEndings: 100,
  hangoutPictures: 500,
  /** Monsters seen (~2,300 real) and furnishing blueprints (1,171 real). */
  monstersSeen: 20_000,
  blueprints: 20_000,
  /** Bosses and elites with respawn spots (103 real), spots per one (211 in all). */
  respawns: 3_000,
  respawnSpots: 200,
  /** Unfinished achievements with progress (15 real), events (15 real) and one event's counters. */
  achievementProgress: 5_000,
  events: 500,
  eventCounters: 1_000,
  // Capture 1.8.0-1.11.0: past one of these a part is dropped.
  /** Recipes of one kind (crafting 578, forging 46, processing 44 real). */
  craftingRecipes: 5_000,
  /** TCG challenge levels played, challenges per level, bosses, Tavern characters and levels each. */
  tcgLevels: 2_000,
  tcgChallenges: 100,
  tcgBosses: 1_000,
  tavern: 1_000,
  /** Music game beatmaps, sign-in calendars, realms and their blocks, Miliastra cosmetics. */
  beatmaps: 5_000,
  signIns: 500,
  signInDays: 100,
  realms: 100,
  realmBlocks: 100,
  miliastra: 20_000,
  /** Furnishing sets (97 real), companion rewards (41), NPCs met (158), domains cleared (13), tribal chapters (18). */
  furnishingSets: 5_000,
  companionRewards: 5_000,
  npcsMet: 20_000,
  /** Parent quests touched, per list (a player near 100% had ~2,400 of 4,000 at 7.1). */
  quests: 20_000,
  domainsCleared: 5_000,
  tribalChapters: 1_000,
  /**
   * Capture 1.17.12's gi_endgame: Stygian records (one per season and run
   * kind: 13 seasons × 2 at 7.1) and fights per record (3 bosses). The
   * Theater's acts (≤ 12) and a team (≤ 4) are the game's fixed sizes,
   * checked in normalize.ts.
   */
  stygianRecords: 200,
  stygianFights: 6,
  /** Capture 1.17.21's Spiral Abyss record book: periods (24 at 7.2, the last two years) and picks per period (4). */
  abyssPeriods: 200,
  abyssPicked: 32,
  /** UTF-16 units of a deck or team name the player typed. */
  playerText: 100,
  /** An artifact has at most 4 substats (and unactivated ones). */
  substats: 6,
  /**
   * Characters in a key no dictionary knows (stored spelled out), and in
   * `source`. The longest key in a real export so far is 63 characters (a
   * material); the dictionaries' longest character, weapon and set keys are
   * 17, 31 and 34. Four material keys the game has are longer (up to 90): a
   * key the material dictionary knows passes at any length.
   */
  keyLength: 64,
} as const

/**
 * Coerces one untrusted timestamp candidate into epoch milliseconds.
 *
 * Accepts what the uploaders actually produce: an epoch-milliseconds number
 * (the GOOD payload's own `timestamp`) or a string holding either epoch
 * milliseconds or a parseable date (the multipart `timestamp` field). Anything
 * else is `null` so the caller can fall through.
 */
function toEpochMs(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return validMs(value.getTime())
  if (typeof value === 'number') return Number.isFinite(value) ? validMs(value) : null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    const numeric = Number(trimmed)
    return validMs(Number.isNaN(numeric) ? Date.parse(trimmed) : numeric)
  }
  return null
}

function validMs(ms: number): number | null {
  return Number.isNaN(new Date(ms).getTime()) ? null : ms
}

/**
 * When an imported snapshot was taken, in epoch milliseconds.
 *
 * Precedence: the uploader's explicit `timestamp` field, then the GOOD
 * payload's own `timestamp` (irminsul writes the capture time into every
 * file), then `now`.
 */
export function resolveImportTimestamp(
  explicit: unknown,
  payload: unknown,
  now: number = Date.now(),
): number {
  return toEpochMs(explicit) ?? toEpochMs(payload) ?? now
}
