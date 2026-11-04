/**
 * GOOD (Genshin Open Object Description), the interchange format shared with
 * Genshin Optimizer and irminsul.
 *
 * The field set mirrors what irminsul emits (`irminsul/src/good.rs`); that file
 * is the wire contract. Fields other scanners add are not stored, nor are
 * fields inside irminsul's `gi_*` keys that this file does not list.
 */

export interface GoodSubstat {
  key: string
  value: number
  initialValue?: number
}

export interface GoodArtifact {
  setKey: string
  slotKey: string
  level: number
  rarity: number
  mainStatKey: string
  location: string
  lock: boolean
  substats: GoodSubstat[]
  totalRolls?: number
  astralMark?: boolean
  elixerCrafted?: boolean
  unactivatedSubstats?: GoodSubstat[]
  /** EXP toward the next level (Teyvat.me Capture); absent = 0 or unknown. */
  gi_exp?: number
}

export interface GoodWeapon {
  key: string
  level: number
  ascension: number
  refinement: number
  location: string
  lock: boolean
  /** EXP toward the next level (Teyvat.me Capture); absent = 0 or unknown. */
  gi_exp?: number
}

export interface GoodCharacter {
  key: string
  level: number
  constellation: number
  ascension: number
  talent: { auto: number; skill: number; burst: number }
}

/**
 * irminsul's `gi_player`: account values GOOD has no place for. The game sends
 * them at login, so they describe the login, not the capture (resin keeps
 * regenerating after it). Every field is optional.
 */
export interface GiPlayer {
  uid?: number
  /** Adventure Rank, 1-60. */
  ar?: number
  /** Adventure EXP toward the next rank. */
  arExp?: number
  /** World Level, 0-9. */
  wl?: number
  /** The highest World Level the account may choose. */
  wlLimit?: number
  /** Original Resin. */
  resin?: number
  storyKeys?: number
  /** In the game's units: 24000 is the 240 it shows. */
  maxStamina?: number
  /** The game-data dump commit the exporting irminsul build carries. */
  gameData?: string
  /** In-game name (Teyvat.me Capture 1.14+, like the rest below). Personal data. */
  nickname?: string
  /** Profile signature; '' when the player set none. Personal data. */
  signature?: string
  /** The name card shown on the profile: its item id (210001…). */
  nameCard?: number
  /** The profile picture: 7.1 sends `id` + `frameId`; older shapes name an avatar and costume. */
  profilePicture?: GiProfilePicture
  /** Absent when the player never set one. */
  birthday?: { month: number; day: number }
}

/** `gi_player.profilePicture`: whichever ids the game sent. */
export interface GiProfilePicture {
  /** A ProfilePictureExcelConfigData id, e.g. 1001. */
  id?: number
  /** An avatar id (10000xxx), older clients only. */
  avatarId?: number
  costumeId?: number
  /** The picture frame, e.g. 100016. */
  frameId?: number
}

/** One character's entry in irminsul's `gi_characters`. */
export interface GiCharacter {
  /** Friendship level, 1-10. */
  friendship?: number
  /** When the character joined the account, unix seconds. */
  obtainedAt?: number
  /** EXP toward the next level; absent = 0 or unknown. */
  exp?: number
  /** Friendship EXP toward the next friendship level; absent = 0 or unknown. */
  friendshipExp?: number
}

/** One anecdote's entry in irminsul's `gi_anecdotes`. */
export interface GiAnecdote {
  /** The server's state: 3 = recorded, 2 = active now, 0 = idle (a loop done before). */
  state: number
  /** Times completed (above 1 only for the repeatable loops). */
  finishCount: number
}

/**
 * irminsul's `gi_anecdotes` (the game's "Travel Accounts"): every anecdote
 * the player has met, by id. An absent id is not met yet, never "not done".
 */
export interface GiAnecdotes {
  /** Keyed by the anecdote id as a decimal string. */
  anecdotes: Record<string, GiAnecdote>
  /** The book's tabs the player has, sorted. */
  unlockedAreas: number[]
  /** The stamp track: `progress` of `target` recorded toward reward number `index`. */
  reward?: { index: number; progress: number; target: number }
  /** The last wish (choosing whom to meet next), unix seconds; `npcId` absent when none. */
  wish?: { npcId?: number; lastWishTime: number }
}

/** One character out on an expedition, in irminsul's `gi_tasks`. */
export interface GiExpedition {
  /** The character's GOOD key; absent when irminsul had no roster. */
  character?: string
  /** The game's expedition id. */
  id: number
  /** Unix seconds. */
  start: number
  hours: number
  /** When it is done (unix seconds): `start + hours`, less what a talent takes off. */
  doneAt: number
}

/**
 * irminsul's `gi_tasks` (contract v1): what the planner's tasks are ticked
 * from, each part the game's state when it last sent it (at login). Times
 * are unix seconds; each part is absent when it was not captured.
 */
export interface GiTasks {
  /** Today's Daily Commissions; `claimed`: Katheryne's reward taken (Capture 1.16.0, absent when not known). */
  commissions?: { finished: number; total: number; claimed?: boolean }
  /** The Spiral Abyss period running: `end` is when the next one begins. */
  abyss?: { start: number; end: number; stars: number; maxStars: number }
  /** Who is out on an expedition (empty: nobody), sorted by `doneAt`. */
  expeditions?: GiExpedition[]
  /** The Serenitea Pot's realm currency waiting in the jar. */
  realm?: { value: number; limit: number }
  /** Blessing of the Welkin Moon days left. */
  welkin?: { days: number }
  /** The weapon banner's Epitomized Path as the Wish screen last showed it (GOOD weapon key). */
  wishPath?: { weapon: string; points: number; max: number }
  /** Original Resin when read, and when the next one comes (unix s; one per 8 minutes). */
  resin?: { value: number; nextAt: number }
  /** This week's discounted weekly boss rewards: left of limit, the resin each costs and its full price (Capture 1.7.0). */
  /**
   * Weekly boss discounts. Before Capture 1.14.0 (no `used`) `left` held the
   * discounts USED: discounts left = limit - left. From 1.14.0 `left` is the
   * count left and `used` beside it. cost / fullCost are the two fixed prices.
   */
  weeklyBosses?: { left: number; limit: number; cost: number; fullCost: number; used?: number }
  /** Bosses and elites by InvestigationMonsterConfigData id: when each spot respawns (unix s, ascending; past = up). */
  respawns?: Record<string, number[]>
  /** Adventure Ranks (2-60) whose reward was claimed; one at or below the AR not listed is unclaimed. */
  arRewards?: number[]
  /** Login events' calendars by config id (Capture 1.9.0): days signed in, days claimed, last sign-in, open/close. */
  signIns?: Record<string, GiSignIn>
  /**
   * Original Resin spent on one game day (Capture 1.16.0): `day` 1 (Monday)
   * to 7 of the game's week, `at` when the game first said it (unix s; the
   * game day it falls in is the one it counts).
   */
  resinSpent?: { value: number; day: number; at: number }
  /**
   * Paimon's Bargains as the game last showed it (Capture 1.17.2): sent when
   * the player opens the shop or buys there, so its counts are that month's
   * as of `at` (unix s). `bought`: anything at all bought there that month.
   */
  bargains?: GiBargains
}

/** `gi_tasks.bargains`. */
export interface GiBargains {
  at: number
  bought: boolean
  /** The Fates for Masterless Stardust and Starglitter. */
  fates: GiFateStock[]
}

/** One Fate on sale in Paimon's Bargains. */
export interface GiFateStock {
  /** `IntertwinedFate` or `AcquaintFate`. */
  item: string
  /** `MasterlessStardust` or `MasterlessStarglitter`. */
  currency: string
  /** Of the currency, per Fate. */
  cost: number
  /** Bought that month. */
  bought: number
  /** A month; absent when it has no limit. */
  limit?: number
}

export interface GiSignIn {
  days: number
  /** Days whose reward was claimed, ascending. */
  claimed: number[]
  /** Unix seconds. */
  lastAt: number
  start: number
  end: number
}

/**
 * Teyvat.me Capture's `gi_collections`: what the player has collected, from
 * the lists the game sends at every login. Each part is absent when it was
 * not captured (absent never means "none"); more parts will follow.
 */
export interface GiCollections {
  /**
   * The Radiant Spincrystals in the Serenitea Pot's music list, by item id
   * (141001 = "Radiant Spincrystal 1"), ascending.
   */
  spincrystals?: number[]
  /** The Archive's unlocked entries by tab, codex ids ascending (Capture 1.4.0). */
  archive?: Partial<Record<ArchiveTab, number[]>>
  /** By Living Beings codex id: enemies defeated, creatures captured (absent at 0). */
  defeats?: Record<string, { defeated: number; captured?: number }>
  /** The Adventurer Handbook: its chapters, and every target keyed by its quest id. */
  handbook?: {
    chapters: Record<string, GiProgress>
    targets: Record<string, GiProgress & { chapter: number }>
  }
  /** Aranara collections, by collection type then id. */
  aranara?: Record<string, Record<string, GiAranaraState>>
  /** Genius Invokation TCG: cards owned, saved decks (`name` is the player's text), the deck in use. */
  tcg?: {
    cards: Record<string, { count: number; proficiency?: number }>
    decks?: Record<string, { name: string; characters: number[]; cards: number[]; valid: boolean }>
    currentDeck?: number
    /** Challenge levels played (GCGLevel id) -> the challenge ids finished in each (Capture 1.8.0). */
    levels?: Record<string, number[]>
    /** Boss challenges unlocked (GCGBossLevel ids, ascending). */
    bosses?: number[]
    /** The Tavern: by character id, the level ids unlocked with them. */
    tavern?: Record<string, number[]>
  }
  /** Every unlocked cooking recipe (Capture 1.5.0): recipe id -> proficiency (0: none yet). */
  recipes?: Record<string, number>
  /** Hangout Events by chapter (Capture 1.7.0): its state, each ending's (CoopReward id) and the pictures found. */
  hangouts?: Record<string, GiHangout>
  /** Monster ids the player has seen (variants too), ascending. */
  monstersSeen?: number[]
  /** Furnishing blueprints learned, by item id, ascending. */
  blueprints?: number[]
  /** Recipes unlocked (Capture 1.8.0): crafting bench (Combine), blacksmith (Forge), processing (Compound). */
  crafting?: { crafting?: number[]; forging?: number[]; processing?: number[] }
  /** The music game by beatmap id (Capture 1.9.0): best score (absent if never played), reward taken. */
  musicGame?: Record<string, { score?: number; claimed: boolean }>
  /** Furnishing sets learned (FurnitureSuite ids, Capture 1.11.0). */
  furnishingSets?: number[]
  /** Companions' Serenitea Pot rewards collected (HomeWorldEvent ids). */
  companionRewards?: number[]
  /** NPCs met (NpcFirstMet ids). */
  npcsMet?: number[]
  /**
   * Every parent quest the player has touched (Capture 1.17, FinishedParentQuestNotify): MainQuest ids
   * finished, and those accepted but not finished, ascending. All kinds (Archon, Story, World, events…).
   */
  quests?: { finished: number[]; active?: number[] }
}

export const HANGOUT_STATES = ['closed', 'locked', 'open', 'accepted'] as const
export type GiHangoutState = (typeof HANGOUT_STATES)[number]
export const ENDING_STATES = ['locked', 'unclaimed', 'claimed'] as const
export type GiEndingState = (typeof ENDING_STATES)[number]

export interface GiHangout {
  state?: GiHangoutState
  endings: Record<string, GiEndingState>
  /** Picture ids found, ascending, of `picturesTotal`. */
  pictures: number[]
  picturesTotal: number
}

/** One event's counters (Capture 1.7.0 `gi_events`), by watcher id. */
export interface GiEvent {
  schedule: number
  /** Unix seconds. */
  start: number
  end: number
  progress?: Record<string, { progress: number; total: number; claimed: boolean }>
}

/** The Archive's tabs, in the order they are stored (append-only). */
export const ARCHIVE_TABS = [
  'quests',
  'weapons',
  'livingBeings',
  'materials',
  'books',
  'tutorials',
  'viewpoints',
  'artifacts',
] as const
export type ArchiveTab = (typeof ARCHIVE_TABS)[number]

/** Progress of a Handbook chapter or target; "complete" = done, its reward not taken yet. */
export interface GiProgress {
  progress: number
  total: number
  state: GiProgressState
}
export const PROGRESS_STATES = ['open', 'complete', 'claimed'] as const
export type GiProgressState = (typeof PROGRESS_STATES)[number]
export const ARANARA_STATES = ['none', 'collectable', 'collected', 'finished'] as const
export type GiAranaraState = (typeof ARANARA_STATES)[number]

/** Owned ids of one kind of cosmetic, and who wears which. */
export interface GiWardrobeKind {
  owned: number[]
  /** By character key, as GOOD's weapon `location` has it ("Traveler" for any Traveler). */
  worn: Record<string, number>
  /** Owned only until then (unix seconds; trial weapon skins). */
  expires?: Record<string, number>
}

/** The wardrobe's kinds of cosmetics, in the order they are stored (append-only). */
export const WARDROBE_KINDS = ['outfits', 'gliders', 'weaponSkins', 'trails'] as const
export type WardrobeKind = (typeof WARDROBE_KINDS)[number]

/** Teyvat.me Capture's `gi_wardrobe` (1.4.0): cosmetics and saved teams, each part optional. */
export interface GiWardrobe {
  outfits?: GiWardrobeKind
  gliders?: GiWardrobeKind
  weaponSkins?: GiWardrobeKind
  trails?: GiWardrobeKind
  /** Saved teams by slot; `name` is the player's own text, `characters` character keys. */
  teams?: Record<string, { name: string; characters: string[] }>
  /** The team slot in use. */
  currentTeam?: number
}

/**
 * Teyvat.me Capture's `gi_exploration` (1.6.0): the world's progress at
 * login, each part optional (absent = not captured, never "none"). Ids are
 * the game's own: cities (CityConfigData), offerings
 * (OfferingOpenStateConfigData), scenes, map points and areas (scene point
 * files), WorldAreaConfigData `areaID1` for exploration.
 */
export interface GiExploration {
  /** Statues of The Seven by city: level (1 = never levelled) and Oculi offered. */
  statues?: Record<string, { level: number; oculi: number }>
  /** Offering (Frostbearing Tree, Sacred Sakura, …) -> its level. */
  offerings?: Record<string, number>
  /** By scene: map points unlocked and areas revealed (ids ascending). */
  scenes?: Record<string, { points: number[]; areas: number[] }>
  /** Exploration area -> raw exploration points (the game's total is in the game data). */
  explore?: Record<string, number>
  /** City -> reputation level. */
  reputation?: Record<string, number>
  /** Domains whose first-clear reward was taken (DungeonEntry ids, ascending; Capture 1.11.0). */
  domainsCleared?: number[]
  /** Natlan's tribal chapters by TribalQuestChapter id: state, and when it started (unix s). */
  tribalChapters?: Record<string, { state: GiTribalState; startedAt?: number }>
}

export const TRIBAL_STATES = ['notOpen', 'locked', 'open', 'finished'] as const
export type GiTribalState = (typeof TRIBAL_STATES)[number]

/** Teyvat.me Capture's `gi_teapot` (1.8.0): the Serenitea Pot. */
export interface GiTeapot {
  /** Comfort by realm (HomeWorldModule id): the mansion's and each outdoor block's. */
  comfort?: Record<string, { mansion: number; blocks: number[] }>
}

/** Teyvat.me Capture's `gi_miliastra` (1.9.0): Miliastra Wonderland. */
export interface GiMiliastra {
  /** Cosmetics owned by id: when obtained (unix s), 0 when the game sent no time. */
  cosmetics?: Record<string, number>
}

/**
 * Teyvat.me Capture's `gi_endgame` (1.17.12): the account's own endgame runs
 * (contract v1: E:/gdt-playground/refs/endgame/CONTRACT.md, `GiEndgame` in
 * teyvat.me-capture/docs/leyline.d.ts). Append fields only.
 */
export interface GiEndgame {
  /** The Imaginarium Theater as of the login: one season's state. */
  theater?: GiTheaterRun
  /** The Stygian Onslaught's own records, as listed when its menu is opened. */
  stygian?: { records: GiStygianRecord[] }
}

export interface GiTheaterRun {
  /** RoleCombatSchedule id (the season running). */
  season: number
  /** RoleCombatDifficulty id chosen; absent until chosen. */
  difficulty?: number
  /** That row's level, 1 Easy … 5 Lunar Mode; absent when the data lacks the row. */
  level?: number
  /** Acts cleared this season (0 before the run is over or the season entered). */
  acts: number
  /** Stars earned this season (appended after contract v1; absent until Capture sends it). */
  stars?: number
  /** Stars possible, when the game says; else the difficulty's acts and extra bouts. */
  maxStars?: number
}

/** One Stygian Onslaught record: a season and a run kind (solo or co-op). */
export interface GiStygianRecord {
  /** LeyLineChallenge schedule id. */
  season: number
  /** 1-6. */
  difficulty: number
  /** Unix seconds the record was set. */
  at: number
  /** A co-op run (the other players' teams and UIDs are never exported). */
  coop: boolean
  fights: GiStygianFight[]
}

export interface GiStygianFight {
  /** Seconds. */
  time: number
  done: boolean
  /** The player's own team, GOOD character keys. */
  team: string[]
  /** The fight's strongest single strike (v1 addition, 2026-11-04). */
  strike?: GiFigure
  /** The highest total damage dealt by one character. */
  damage?: GiFigure
}

/** A damage figure and, when the game names one character for it, whose. */
export interface GiFigure {
  value: number
  /** GOOD character key; absent when the game's two figures name two characters (their pairing is unsure). */
  by?: string
}

export interface Good {
  format: string
  version: number
  source: string
  characters: GoodCharacter[]
  artifacts: GoodArtifact[]
  weapons: GoodWeapon[]
  materials: Record<string, number>
  gi_achievements?: number[]
  /** Epoch milliseconds of the capture; irminsul always sets it. */
  timestamp?: number
  // irminsul's own top-level additions (not GOOD); each is optional.
  gi_player?: GiPlayer
  /** Finish time of achievements, unix seconds, keyed by achievement id. */
  gi_achievement_times?: Record<string, number>
  /** Keyed by the character's GOOD key (Traveler with its element). */
  gi_characters?: Record<string, GiCharacter>
  gi_anecdotes?: GiAnecdotes
  gi_tasks?: GiTasks
  gi_collections?: GiCollections
  gi_wardrobe?: GiWardrobe
  gi_exploration?: GiExploration
  /** Unfinished achievements' progress (Capture 1.7.0). */
  gi_achievement_progress?: Record<string, { progress: number; total: number }>
  /** Events by activity id (NewActivityExcelConfigData), with their counters. */
  gi_events?: Record<string, GiEvent>
  gi_teapot?: GiTeapot
  gi_miliastra?: GiMiliastra
  /** The account's Theater run and Stygian records (Capture 1.17.12). */
  gi_endgame?: GiEndgame
}

/**
 * Converts an in-game name into a GOOD PascalCase key: drop every symbol,
 * capitalise each word, join without spaces.
 *
 * - "Gladiator's Finale" -> "GladiatorsFinale"
 * - "Spirit Locket of Boreas" -> "SpiritLocketOfBoreas"
 * - '"The Catch"' -> "TheCatch"
 */
export function toGoodKey(name: string): string {
  if (!name) return ''
  return name
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('')
}
