/**
 * The developer page's reference: each `gi_*` key Teyvat.me Capture writes,
 * its shape and a synthetic example. Checked against Capture's
 * `crates/core/src/good.rs` (what it writes) and `normalizeGood` in
 * `packages/shared/src/codec/normalize.ts` (what the tracker keeps): list
 * only what both do. English only, like the page's body (DevelopersView).
 * Examples are made up: placeholder UID and name, no real account. Each is
 * typed against `public/developers/leyline.d.ts` (the types the page serves,
 * the same bytes as Capture's `docs/leyline.d.ts`), so a type-check fails
 * when the page and the types disagree.
 */

import type {
  GoodWeapon,
  ItemExtras,
  Leyline,
  LeylineDelta,
} from '../../../public/developers/leyline'

export interface KeyDoc {
  key: string
  /** One line: what it holds. */
  what: string
  /** Where it is written: every file, or tracker uploads only. */
  uploadsOnly?: boolean
  /** Its fields, TypeScript-style. */
  shape: string
  example: unknown
  /** A line on how the tracker reads it, when that matters. */
  note?: string
}

export const KEY_DOCS: KeyDoc[] = [
  {
    key: 'gi_player',
    what: 'Account values GOOD has no place for, from the login.',
    shape: `{
  uid?: number            // 9 or 10 digits
  ar?: number             // Adventure Rank, 1–60
  arExp?: number          // EXP toward the next rank
  wl?: number             // World Level, 0–9
  wlLimit?: number        // the highest World Level the account may pick
  resin?: number          // Original Resin at login
  storyKeys?: number
  maxStamina?: number     // the game's units: 24000 = 240
  gameData?: string       // the game data commit the GOOD keys came from (hex)
  nickname?: string
  signature?: string      // "" when none is set
  nameCard?: number       // item id, 210001…
  profilePicture?: { id?: number; avatarId?: number; costumeId?: number; frameId?: number }
  birthday?: { month: number; day: number }
}`,
    example: {
      uid: 888888888,
      ar: 60,
      arExp: 0,
      wl: 8,
      wlLimit: 9,
      resin: 160,
      storyKeys: 2,
      maxStamina: 24000,
      nickname: 'player01',
      signature: '',
      nameCard: 210001,
      profilePicture: { id: 1, frameId: 1 },
      birthday: { month: 1, day: 1 },
    } satisfies NonNullable<Leyline['gi_player']>,
    note: 'An upload with an all-accounts key goes to the account whose UID is gi_player.uid.',
  },
  {
    key: 'gi_achievements',
    what: 'Achievement ids done.',
    shape: 'number[]',
    example: [80000, 80001, 81219] satisfies NonNullable<Leyline['gi_achievements']>,
    note: 'An older top-level "achievements" list is read when this key is absent.',
  },
  {
    key: 'gi_achievement_times',
    what: 'When each achievement was done, for those the game timed.',
    shape: 'Record<id, unixSeconds>',
    example: { '80000': 1790000000, '81219': 1790500000 } satisfies NonNullable<
      Leyline['gi_achievement_times']
    >,
  },
  {
    key: 'gi_achievement_progress',
    what: 'How far each unfinished achievement with a total is.',
    shape: 'Record<id, { progress: number; total: number }>',
    example: { '84517': { progress: 3, total: 5 } } satisfies NonNullable<
      Leyline['gi_achievement_progress']
    >,
  },
  {
    key: 'gi_characters',
    what: 'Per character, keyed like characters[].key: friendship and EXP.',
    shape: `Record<CharacterKey, {
  friendship?: number     // 1–10; the Traveler has none
  friendshipExp?: number  // toward the next friendship level
  obtainedAt?: number     // unix seconds
  exp?: number            // toward the next level
}>`,
    example: {
      Furina: { friendship: 10, obtainedAt: 1790000000, exp: 1200 },
    } satisfies NonNullable<Leyline['gi_characters']>,
  },
  {
    key: 'gi_anecdotes',
    what: 'The Travel Accounts book: every anecdote met, the areas, the stamp track, the last wish.',
    shape: `{
  anecdotes: Record<id, { state: number; finishCount: number }>  // 3 recorded, 2 in progress, 0 idle
  unlockedAreas: number[]
  reward?: { index: number; progress: number; target: number }
  wish?: { npcId?: number; lastWishTime: number }
}`,
    example: {
      anecdotes: { '100101': { state: 3, finishCount: 1 }, '100102': { state: 2, finishCount: 0 } },
      unlockedAreas: [1, 2],
      reward: { index: 2, progress: 4, target: 10 },
      wish: { lastWishTime: 1790000000 },
    } satisfies NonNullable<Leyline['gi_anecdotes']>,
    note: 'An anecdote absent from the book was never met; absent is not "not done".',
  },
  {
    key: 'gi_tasks',
    what: 'What a planner can tick, as the game said at login.',
    shape: `{
  commissions?: { finished: number; total: number; claimed?: boolean }
  abyss?: { start: number; end: number; stars: number; maxStars: number }
  expeditions?: { character?: CharacterKey; id: number; start: number; hours: number; doneAt: number }[]
  realm?: { value: number; limit: number }        // Serenitea Pot currency
  welkin?: { days: number }
  wishPath?: { weapon: WeaponKey; points: number; max: number }
  resin?: { value: number; nextAt: number }
  resinSpent?: { value: number; day: number; at: number }   // day 1 = Monday
  weeklyBosses?: { left: number; used?: number; limit: number; cost: number; fullCost: number }
  arRewards?: number[]                            // ranks whose reward was claimed
  respawns?: Record<id, number[]>                 // Handbook boss or elite → respawn times
  signIns?: Record<id, { days: number; claimed: number[]; lastAt: number; start: number; end: number }>
  bargains?: {                                    // Paimon's Bargains, when the shop was opened
    at: number
    bought: boolean                               // anything bought there this month
    fates: { item: 'IntertwinedFate' | 'AcquaintFate';
             currency: 'MasterlessStardust' | 'MasterlessStarglitter';
             cost: number; bought: number; limit?: number }[]   // bought and limit: this month
  }
  transformer?: { usedAt: number; readyAt: number }   // Parametric Transformer: last use, ready again
}`,
    example: {
      commissions: { finished: 4, total: 4, claimed: true },
      abyss: { start: 1792800000, end: 1795392000, stars: 36, maxStars: 36 },
      expeditions: [
        { character: 'Bennett', id: 10101, start: 1792900000, hours: 20, doneAt: 1792972000 },
      ],
      realm: { value: 1800, limit: 2400 },
      welkin: { days: 21 },
      resin: { value: 120, nextAt: 1792900480 },
      bargains: {
        at: 1792900000,
        bought: true,
        fates: [
          {
            item: 'IntertwinedFate',
            currency: 'MasterlessStarglitter',
            cost: 5,
            bought: 2,
            limit: 5,
          },
        ],
      },
      transformer: { usedAt: 1792540000, readyAt: 1793137600 },
    } satisfies NonNullable<Leyline['gi_tasks']>,
    note: 'All times in unix seconds. The tracker keeps a part only when all of it is in range.',
  },
  {
    key: 'gi_collections',
    what: 'What the player has collected. Every part is optional.',
    shape: `{
  spincrystals?: number[]             // item ids
  archive?: { quests?, weapons?, livingBeings?, materials?, books?,
              tutorials?, viewpoints?, artifacts?: number[] }   // codex ids by tab
  defeats?: Record<id, { defeated: number; captured?: number }>
  handbook?: { chapters: Record<id, Progress>; targets: Record<id, Progress & { chapter: number }> }
  aranara?: Record<id, Record<id, 'none' | 'collectable' | 'collected' | 'finished'>>
  tcg?: { cards: Record<id, { count: number; proficiency?: number }>,
          decks?, currentDeck?, levels?, bosses?, tavern? }
  recipes?: Record<id, number>        // recipe → proficiency
  hangouts?: Record<id, { state?; endings: Record<id, 'locked' | 'unclaimed' | 'claimed'>;
                          pictures: number[]; picturesTotal: number }>
  monstersSeen?: number[]
  blueprints?: number[]
  crafting?: { crafting?: number[]; forging?: number[]; processing?: number[] }
  musicGame?: Record<id, { score?: number; claimed: boolean }>
  furnishingSets?: number[]
  companionRewards?: number[]
  npcsMet?: number[]
  quests?: { finished: number[]; active?: number[] }   // parent quest ids
}
Progress = { progress: number; total: number; state: 'open' | 'complete' | 'claimed' }`,
    example: {
      spincrystals: [141001, 141002],
      archive: { books: [50000101, 50000102] },
      defeats: { '20010101': { defeated: 412 } },
      quests: { finished: [1001, 1002], active: [1003] },
    } satisfies NonNullable<Leyline['gi_collections']>,
  },
  {
    key: 'gi_wardrobe',
    what: 'Outfits, gliders, weapon skins and sprint trails owned and worn, and the saved teams.',
    shape: `{
  outfits?: Wardrobe
  gliders?: Wardrobe
  weaponSkins?: Wardrobe
  trails?: Wardrobe
  teams?: Record<slot, { name: string; characters: CharacterKey[] }>
  currentTeam?: number
}
Wardrobe = { owned: number[]; worn: Record<CharacterKey, number>; expires?: Record<id, number> }`,
    example: {
      gliders: { owned: [140001, 140002], worn: { Traveler: 140002 } },
      teams: { '1': { name: 'Team 1', characters: ['Furina', 'Bennett', 'Xiangling', 'Kazuha'] } },
      currentTeam: 1,
    } satisfies NonNullable<Leyline['gi_wardrobe']>,
  },
  {
    key: 'gi_exploration',
    what: 'Statues of The Seven, offerings, map points, exploration, reputation, domains, tribal chapters.',
    shape: `{
  statues?: Record<cityId, { level: number; oculi: number }>
  offerings?: Record<id, number>
  scenes?: Record<sceneId, { points: number[]; areas: number[] }>   // 3 = Teyvat
  explore?: Record<areaId, number>           // the game's raw points
  reputation?: Record<cityId, number>
  domainsCleared?: number[]
  tribalChapters?: Record<id, { state: 'notOpen' | 'locked' | 'open' | 'finished'; startedAt?: number }>
}`,
    example: {
      statues: { '1': { level: 10, oculi: 0 } },
      reputation: { '1': 8 },
      scenes: { '3': { points: [10, 11, 12], areas: [1, 2] } },
    } satisfies NonNullable<Leyline['gi_exploration']>,
  },
  {
    key: 'gi_events',
    what: 'The events running at login and the progress in each.',
    shape: `Record<eventId, {
  schedule: number
  start: number
  end: number
  progress?: Record<id, { progress: number; total: number; claimed: boolean }>
}>`,
    example: {
      '2001': {
        schedule: 2001001,
        start: 1792800000,
        end: 1794600000,
        progress: { '1': { progress: 2, total: 5, claimed: false } },
      },
    } satisfies NonNullable<Leyline['gi_events']>,
  },
  {
    key: 'gi_teapot',
    what: 'The Serenitea Pot: comfort by realm.',
    shape: '{ comfort?: Record<realmId, { mansion: number; blocks: number[] }> }',
    example: { comfort: { '1': { mansion: 12000, blocks: [8000, 4500] } } } satisfies NonNullable<
      Leyline['gi_teapot']
    >,
  },
  {
    key: 'gi_miliastra',
    what: 'Miliastra Wonderland cosmetics owned, and when (0 when the game sent no time).',
    shape: '{ cosmetics?: Record<id, number> }',
    example: { cosmetics: { '1000101': 1790000000, '1000102': 0 } } satisfies NonNullable<
      Leyline['gi_miliastra']
    >,
  },
  {
    key: 'gi_capture',
    uploadsOnly: true,
    what: 'Why this snapshot was taken, and which game login it belongs to (live sync).',
    shape: `{
  v: 1
  reason: 'login' | 'world' | 'manual' | 'collapse' | 'logout' | 'resync' | 'change'
  session: string       // this game login's id
  world: number         // 1 = the login's first world
  journal: { seq: number }
}`,
    example: {
      v: 1,
      reason: 'login',
      session: '01J9ZK5Q8W3E7R2T',
      world: 1,
      journal: { seq: 0 },
    } satisfies NonNullable<Leyline['gi_capture']>,
    note: 'Read, never stored with the snapshot.',
  },
  {
    key: 'gi_guid, gi_exp',
    uploadsOnly: true,
    what: 'On each weapon and artifact: the game’s item id (a decimal string) and EXP toward the next level.',
    shape: '{ gi_guid?: string; gi_exp?: number }   // beside GOOD’s own fields',
    example: {
      key: 'MistsplitterReforged',
      level: 90,
      gi_guid: '3488998120056947072',
      gi_exp: 0,
    } satisfies Partial<GoodWeapon> & ItemExtras,
    note: 'Live sync names items by gi_guid. gi_exp 0 is the same as absent.',
  },
]

/** GOOD_LIMITS that refuse a whole file (422), as the page lists them. */
export const FILE_LIMITS: [string, string][] = [
  ['File size', '10 MB, after gzip'],
  ['characters', '200'],
  ['weapons', '3,000'],
  ['artifacts', '4,050'],
  ['material keys', '11,100'],
  ['gi_achievements, gi_achievement_times', '3,020 each'],
  ['gi_characters', '200'],
  ['gi_anecdotes entries', '2,000'],
  ['Substats per artifact', '6'],
  ['Key length', '64 characters'],
]

/** Live sync's paths (`packages/shared/src/live/delta.ts`). */
export const DELTA_PATHS: [string, string][] = [
  ['materials.<key>', 'count; del = gone (never set 0)'],
  ['characters.<key>', 'add a whole GOOD character; del'],
  ['characters.<key>.level | ascension | constellation', 'number'],
  ['characters.<key>.talent.auto | skill | burst', 'number'],
  ['weapons.<guid>, artifacts.<guid>', 'add a whole item; del (hint {rarity})'],
  ['weapons.<guid>.<field>, artifacts.<guid>.<field>', 'that field’s value'],
  ['gi_player.<field>', 'that field: number, text or object'],
  ['gi_characters.<key>.<field>', 'number; del of the entry drops it'],
  ['achievements.<id>', 'finish time (0 = done, time unknown); del'],
  ['anecdotes.<id>', '{state, finishCount}; del'],
  ['gi_anecdotes.unlockedAreas | reward | wish', 'that value; del'],
  ['gi_tasks.<part>', 'that part whole; del'],
  ['gi_wardrobe.teams | currentTeam', 'that value whole; del'],
]

/** What `POST /api/irminsul/changes` answers. */
export const DELTA_ANSWERS: [string, string][] = [
  ['200 {ok: true, seq, collapse, watching}', 'Stored. collapse: true → upload a snapshot.'],
  ['200 {ok: true, duplicate: true, seq}', 'A retry of a stored batch: carry on.'],
  ['200 {ok: false, live: false}', 'Live sync is off: upload snapshots.'],
  ['409 resync', 'Upload a snapshot, then batches on its live.base.'],
  ['413 / 422', 'Too large: upload a snapshot.'],
  ['429 daily_live_limit', 'Snapshots only until the next UTC day.'],
  ['429 rate_limited, 5xx', 'Keep the changes, retry with backoff.'],
]

export const DELTA_EXAMPLE = {
  format: 'GOOD-X-delta',
  v: 1,
  uid: 888888888,
  session: '01J9ZK5Q8W3E7R2T',
  seq: 1,
  base: '1a2b3c4d5e',
  at: 1792000060000,
  changes: [
    ['set', ['materials', 'Mora'], 48211930],
    ['del', ['materials', 'MysticEnhancementOre']],
    ['set', ['characters', 'Furina', 'talent', 'burst'], 9],
    ['set', ['artifacts', '3488998120056947072', 'level'], 20],
    ['set', ['gi_tasks', 'resin'], { value: 40, nextAt: 1792000540 }],
  ],
} satisfies LeylineDelta

export const FILE_EXAMPLE = {
  format: 'GOOD',
  version: 3,
  source: 'Teyvat.me',
  leyline: 1,
  timestamp: 1792000000000,
  characters: [
    {
      key: 'Furina',
      level: 90,
      constellation: 0,
      ascension: 6,
      talent: { auto: 1, skill: 9, burst: 8 },
    },
  ],
  weapons: [],
  artifacts: [],
  materials: { Mora: 48211930 },
  gi_player: { uid: 888888888, ar: 60, wl: 8 },
  gi_achievements: [80000, 80001],
} satisfies Leyline

/** One line of JSON with a space after each comma and colon. */
function oneLine(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(oneLine).join(', ')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${oneLine(v)}`)
    return entries.length ? `{ ${entries.join(', ')} }` : '{}'
  }
  return JSON.stringify(value)
}

/**
 * JSON as the page shows it: two-space indent, and any array or object whose
 * line fits in 60 characters (indent included) kept on that line.
 */
export function showJson(value: unknown, indent = ''): string {
  const line = oneLine(value)
  if (indent.length + line.length <= 60 || !value || typeof value !== 'object') return line
  const inner = `${indent}  `
  const items = Array.isArray(value)
    ? value.map((v) => inner + showJson(v, inner))
    : Object.entries(value).map(([k, v]) => `${inner}${JSON.stringify(k)}: ${showJson(v, inner)}`)
  const [open, close] = Array.isArray(value) ? ['[', ']'] : ['{', '}']
  return `${open}\n${items.join(',\n')}\n${indent}${close}`
}
