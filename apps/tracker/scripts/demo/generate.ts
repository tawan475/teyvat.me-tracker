/**
 * The public demo account's data (docs/plans/open-site.md §2, "The demo's
 * data"): GOOD files, a wish history and planner goals, all made up here
 * from the game data. Nothing is captured from anyone: names, rolls,
 * pulls and times come from a seeded random generator, so a rerun on the
 * same day and game data makes the same account.
 *
 * Pure: `demo-good.ts` writes and imports what this returns.
 */

import { loadAchievements, loadPlanner, type PlannerData } from '@gdt/game-data'
import { loadEndgame } from '@gdt/game-data/endgame'
import type {
  Good,
  GoodArtifact,
  GoodCharacter,
  GoodSubstat,
  GoodWeapon,
  GiCharacter,
  GiEndgame,
  GiTasks,
} from '@gdt/shared'
import banners from '../../src/data/wish-banners.json' with { type: 'json' }
import wishItems from '../../../../packages/shared/src/wish/items.json' with { type: 'json' }

/**
 * The masked identity: no real name, and a UID whose owner agreed to it (the
 * user's call, 2026-11-06: 812345678, the placeholder of tests and fixtures,
 * turned out to be a stranger's real account, which a Discord user spotted).
 */
export const DEMO_UID = '888888888'
export const DEMO_NAME = 'Demo'
const NICKNAME = 'Traveler'
const SIGNATURE = 'Exploring Teyvat, one domain at a time.'

const DAY = 86_400_000

// ------------------------------------------------------------------- random

/** mulberry32: small, fast, good enough for made-up rolls. */
function rng(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!,
    chance: (p: number) => next() < p,
  }
}
type Rng = ReturnType<typeof rng>

// ---------------------------------------------------------------- the roster

interface Build {
  key: string
  level: number
  /** Ascension phase (cap 20/40/50/60/70/80/90 for 0…6). */
  ascension: number
  constellation: number
  talent: [number, number, number]
  weapon: { key: string; level: number; ascension: number; refinement: number }
  /** Artifact sets worn: 4 pieces of the first, the rest from the second (filler when absent). */
  sets: string[]
  /** How good the worn pieces are: 0 filler … 1 well rolled. */
  quality: number
  friendship: number
  /** Days before the newest capture the character joined. */
  joined: number
}

/**
 * Furina is the worked example (the plan): 70/80, talents 6/6/6, C0, a 4★
 * sword, two good Golden Troupe pieces and three filler ones. Two 4★ are
 * fully built; the rest sit at levels from 20 to 90.
 */
const ROSTER: Build[] = [
  {
    key: 'Furina',
    level: 70,
    ascension: 5,
    constellation: 0,
    talent: [6, 6, 6],
    weapon: { key: 'FleuveCendreFerryman', level: 70, ascension: 5, refinement: 2 },
    sets: ['GoldenTroupe'],
    quality: 0.55,
    friendship: 6,
    joined: 120,
  },
  {
    key: 'Xiangling',
    level: 90,
    ascension: 6,
    constellation: 6,
    talent: [9, 9, 10],
    weapon: { key: 'TheCatch', level: 90, ascension: 6, refinement: 5 },
    sets: ['EmblemOfSeveredFate'],
    quality: 0.9,
    friendship: 10,
    joined: 900,
  },
  {
    key: 'Bennett',
    level: 90,
    ascension: 6,
    constellation: 6,
    talent: [6, 10, 10],
    weapon: { key: 'FavoniusSword', level: 90, ascension: 6, refinement: 5 },
    sets: ['NoblesseOblige'],
    quality: 0.8,
    friendship: 10,
    joined: 880,
  },
  {
    key: 'RaidenShogun',
    level: 90,
    ascension: 6,
    constellation: 2,
    talent: [6, 9, 10],
    weapon: { key: 'EngulfingLightning', level: 90, ascension: 6, refinement: 1 },
    sets: ['EmblemOfSeveredFate'],
    quality: 0.85,
    friendship: 10,
    joined: 700,
  },
  {
    key: 'KaedeharaKazuha',
    level: 80,
    ascension: 6,
    constellation: 0,
    talent: [1, 8, 8],
    weapon: { key: 'IronSting', level: 80, ascension: 6, refinement: 5 },
    sets: ['ViridescentVenerer'],
    quality: 0.6,
    friendship: 9,
    joined: 640,
  },
  {
    key: 'Nahida',
    level: 80,
    ascension: 5,
    constellation: 0,
    talent: [6, 8, 6],
    weapon: { key: 'AThousandFloatingDreams', level: 80, ascension: 6, refinement: 1 },
    sets: ['DeepwoodMemories'],
    quality: 0.7,
    friendship: 8,
    joined: 400,
  },
  {
    key: 'Zhongli',
    level: 60,
    ascension: 4,
    constellation: 0,
    talent: [1, 6, 6],
    weapon: { key: 'FavoniusLance', level: 60, ascension: 4, refinement: 3 },
    sets: ['TenacityOfTheMillelith'],
    quality: 0.35,
    friendship: 7,
    joined: 500,
  },
  {
    key: 'Yelan',
    level: 60,
    ascension: 4,
    constellation: 1,
    talent: [4, 6, 6],
    weapon: { key: 'FavoniusWarbow', level: 50, ascension: 3, refinement: 2 },
    sets: ['EmblemOfSeveredFate', 'HeartOfDepth'],
    quality: 0.4,
    friendship: 6,
    joined: 300,
  },
  {
    key: 'Fischl',
    level: 80,
    ascension: 6,
    constellation: 6,
    talent: [6, 8, 8],
    weapon: { key: 'TheStringless', level: 80, ascension: 5, refinement: 3 },
    sets: ['GoldenTroupe', 'GladiatorsFinale'],
    quality: 0.5,
    friendship: 10,
    joined: 950,
  },
  {
    key: 'Sucrose',
    level: 40,
    ascension: 1,
    constellation: 3,
    talent: [1, 3, 3],
    weapon: { key: 'ThrillingTalesOfDragonSlayers', level: 1, ascension: 0, refinement: 1 },
    sets: [],
    quality: 0,
    friendship: 4,
    joined: 820,
  },
  {
    key: 'Kaeya',
    level: 20,
    ascension: 0,
    constellation: 2,
    talent: [1, 1, 1],
    weapon: { key: 'HarbingerOfDawn', level: 1, ascension: 0, refinement: 1 },
    sets: [],
    quality: 0,
    friendship: 3,
    joined: 960,
  },
  {
    key: 'TravelerHydro',
    level: 60,
    ascension: 4,
    constellation: 3,
    talent: [4, 6, 5],
    weapon: { key: 'SacrificialSword', level: 60, ascension: 4, refinement: 1 },
    sets: ['NoblesseOblige', 'GladiatorsFinale'],
    quality: 0.3,
    friendship: 10,
    joined: 970,
  },
]

/** Weapons nobody wears: spares at R1-R5, some never levelled. */
const SPARE_WEAPONS: GoodWeapon[] = [
  w('SacrificialFragments', 40, 1, 2),
  w('FavoniusCodex', 1, 0, 1),
  w('TheWidsith', 70, 4, 3),
  w('Rainslasher', 1, 0, 4),
  w('SacrificialGreatsword', 20, 0, 1),
  w('DragonsBane', 50, 2, 5),
  w('LionsRoar', 1, 0, 2),
  w('TheFlute', 1, 0, 3),
  w('SacrificialBow', 1, 0, 1),
  w('PrototypeAmber', 1, 0, 1),
  w('WolfsGravestone', 1, 0, 1),
  w('SkywardSpine', 20, 0, 1),
  w('CoolSteel', 1, 0, 5),
  w('SkyriderSword', 1, 0, 3),
  w('DebateClub', 1, 0, 5),
  w('BlackTassel', 1, 0, 4),
  w('Slingshot', 1, 0, 2),
  w('MagicGuide', 1, 0, 5),
]

function w(key: string, level: number, ascension: number, refinement: number): GoodWeapon {
  return { key, level, ascension, refinement, location: '', lock: false }
}

/** Sets the bag's spare pieces come from (most of them filler). */
const SPARE_SETS = [
  'GoldenTroupe',
  'GoldenTroupe',
  'EmblemOfSeveredFate',
  'NoblesseOblige',
  'ViridescentVenerer',
  'DeepwoodMemories',
  'GladiatorsFinale',
  'WanderersTroupe',
  'MarechausseeHunter',
  'HeartOfDepth',
  'TenacityOfTheMillelith',
  'CrimsonWitchOfFlames',
  'BlizzardStrayer',
  'ThunderingFury',
]
const FOUR_STAR_SETS = ['Instructor', 'TheExile', 'Berserker', 'Gambler', 'Scholar']

// --------------------------------------------------------------- artifacts

const SLOTS = ['flower', 'plume', 'sands', 'goblet', 'circlet'] as const
type Slot = (typeof SLOTS)[number]

const MAIN_STATS: Record<Slot, [string, number][]> = {
  flower: [['hp', 1]],
  plume: [['atk', 1]],
  sands: [
    ['hp_', 27],
    ['atk_', 27],
    ['def_', 27],
    ['enerRech_', 10],
    ['eleMas', 10],
  ],
  goblet: [
    ['hp_', 19],
    ['atk_', 19],
    ['def_', 19],
    ['eleMas', 3],
    ['hydro_dmg_', 5],
    ['pyro_dmg_', 5],
    ['electro_dmg_', 5],
    ['dendro_dmg_', 5],
    ['anemo_dmg_', 5],
    ['cryo_dmg_', 5],
    ['geo_dmg_', 5],
    ['physical_dmg_', 5],
  ],
  circlet: [
    ['hp_', 22],
    ['atk_', 22],
    ['def_', 22],
    ['critRate_', 10],
    ['critDMG_', 10],
    ['heal_', 10],
    ['eleMas', 4],
  ],
}

/** Substat weights (the game's: flat stats and the three percents most common). */
const SUBSTATS: [string, number][] = [
  ['hp', 6],
  ['atk', 6],
  ['def', 6],
  ['hp_', 4],
  ['atk_', 4],
  ['def_', 4],
  ['enerRech_', 4],
  ['eleMas', 4],
  ['critRate_', 3],
  ['critDMG_', 3],
]

/** A 5★ substat's highest roll; a 4★'s is 80% of it. */
const MAX_ROLL: Record<string, number> = {
  hp: 298.75,
  atk: 19.45,
  def: 23.15,
  hp_: 5.83,
  atk_: 5.83,
  def_: 7.29,
  eleMas: 23.31,
  enerRech_: 6.48,
  critRate_: 3.89,
  critDMG_: 7.77,
}
const FLAT = new Set(['hp', 'atk', 'def', 'eleMas'])
const TIERS = [0.7, 0.8, 0.9, 1]

function weighted<T>(r: Rng, list: readonly [T, number][]): T {
  const total = list.reduce((sum, [, weight]) => sum + weight, 0)
  let roll = r.next() * total
  for (const [value, weight] of list) {
    roll -= weight
    if (roll < 0) return value
  }
  return list.at(-1)![0]
}

/** What a good build wants to see rolled: crit for most, the character's own stat for some. */
const WANTED = ['critRate_', 'critDMG_', 'enerRech_', 'atk_', 'hp_']

function makeArtifact(
  r: Rng,
  options: {
    set: string
    slot: Slot
    rarity: number
    level: number
    location?: string
    quality?: number
    main?: string
  },
): GoodArtifact {
  const { set, slot, rarity, level } = options
  const quality = options.quality ?? 0
  const main = options.main ?? weighted(r, MAIN_STATS[slot])
  const scale = rarity === 5 ? 1 : 0.8
  const rolls = new Map<string, number>()
  const pickSub = () => {
    for (;;) {
      // A good piece leans toward the stats builds want.
      const key = quality > 0 && r.chance(quality * 0.6) ? r.pick(WANTED) : weighted(r, SUBSTATS)
      if (key !== main && !rolls.has(key)) return key
    }
  }
  const roll = (key: string) => {
    const value = MAX_ROLL[key]! * scale * r.pick(TIERS)
    rolls.set(key, (rolls.get(key) ?? 0) + value)
  }
  const initial = rarity === 5 ? (r.chance(0.25) ? 4 : 3) : r.chance(0.4) ? 3 : 2
  for (let i = 0; i < initial; i++) roll(pickSub())
  let totalRolls = initial
  for (let step = 4; step <= level; step += 4) {
    if (rolls.size < 4) roll(pickSub())
    else {
      const keys = [...rolls.keys()]
      const wanted = keys.filter((k) => WANTED.includes(k))
      roll(quality > 0 && wanted.length && r.chance(quality) ? r.pick(wanted) : r.pick(keys))
    }
    totalRolls++
  }
  const substats: GoodSubstat[] = [...rolls].map(([key, value]) => ({
    key,
    value: FLAT.has(key) ? Math.round(value) : Math.round(value * 10) / 10,
  }))
  return {
    setKey: set,
    slotKey: slot,
    level,
    rarity,
    mainStatKey: main,
    location: options.location ?? '',
    lock: level >= 16 || r.chance(0.2),
    substats,
    totalRolls,
  }
}

/** The main stat a worn piece of `slot` carries for this character. */
function wornMain(r: Rng, slot: Slot, element: string | null, good: boolean): string | undefined {
  if (!good) return undefined
  if (slot === 'goblet' && element) return `${element.toLowerCase()}_dmg_`
  if (slot === 'circlet') return r.pick(['critRate_', 'critDMG_'])
  if (slot === 'sands') return r.pick(['atk_', 'enerRech_', 'hp_'])
  return undefined
}

// ---------------------------------------------------------------- materials

/**
 * The bag: some of everything the planner knows, and, for Furina's goals,
 * less than they need, so the planner's Today view and Crafting card have
 * work on them.
 */
function makeMaterials(r: Rng, planner: PlannerData): Record<string, number> {
  const bag: Record<string, number> = {}
  for (const family of planner.families) {
    family.members.forEach((member, tier) => {
      if (!r.chance(0.55)) return
      const top = family.members.length - 1
      bag[member.key] = r.int(0, tier === top ? 4 : Math.max(2, 30 - tier * 8))
    })
  }
  // Furina's books, gems, boss drops and specialty: a share of what 90/90, 9/9/9 needs.
  const short: Record<string, number> = {
    GuideToJustice: 14,
    TeachingsOfJustice: 6,
    PhilosophiesOfJustice: 3,
    VarunadaLazuriteChunk: 2,
    VarunadaLazuriteGemstone: 0,
    WaterThatFailedToTranscend: 9,
    LakelightLily: 41,
    WhopperflowerNectar: 22,
    ShimmeringNectar: 17,
    EnergyNectar: 6,
    LightlessMass: 1,
    CrownOfInsight: 1,
  }
  Object.assign(bag, short)
  Object.assign(bag, {
    Mora: 1_284_310,
    HerosWit: 64,
    AdventurersExperience: 41,
    WanderersAdvice: 57,
    MysticEnhancementOre: 88,
    FineEnhancementOre: 54,
    EnhancementOre: 31,
    Primogem: 3_180,
    IntertwinedFate: 6,
    AcquaintFate: 14,
    MasterlessStardust: 245,
    MasterlessStarglitter: 37,
    DreamSolvent: 3,
    FragileResin: 2,
    CondensedResin: 1,
    StrangeKnot: 0,
  })
  for (const [key, value] of Object.entries(bag)) if (value <= 0) delete bag[key]
  return bag
}

// --------------------------------------------------------------- the history

/**
 * How the account looked `steps` captures before the newest: Furina was
 * levelled during the six weeks, one more character joined, pieces were
 * found and Mora spent. `step` 0 is the newest.
 */
interface Moment {
  furina: { level: number; ascension: number; talent: [number, number, number] }
  newcomerLevel: number | null
  mora: number
  primogem: number
  artifactShare: number
  ar: number
  arExp: number
}

const MOMENTS: Moment[] = [
  // Newest first.
  {
    furina: { level: 70, ascension: 5, talent: [6, 6, 6] },
    newcomerLevel: 40,
    mora: 1_284_310,
    primogem: 3_180,
    artifactShare: 1,
    ar: 55,
    arExp: 9_210,
  },
  {
    furina: { level: 70, ascension: 5, talent: [6, 6, 6] },
    newcomerLevel: 20,
    mora: 1_356_900,
    primogem: 2_540,
    artifactShare: 0.97,
    ar: 55,
    arExp: 7_480,
  },
  {
    furina: { level: 70, ascension: 5, talent: [6, 6, 5] },
    newcomerLevel: 20,
    mora: 1_502_115,
    primogem: 1_920,
    artifactShare: 0.95,
    ar: 55,
    arExp: 5_990,
  },
  {
    furina: { level: 70, ascension: 5, talent: [6, 5, 5] },
    newcomerLevel: 1,
    mora: 1_690_440,
    primogem: 12_460,
    artifactShare: 0.93,
    ar: 55,
    arExp: 4_105,
  },
  {
    furina: { level: 60, ascension: 4, talent: [6, 5, 5] },
    newcomerLevel: null,
    mora: 1_915_230,
    primogem: 11_120,
    artifactShare: 0.9,
    ar: 55,
    arExp: 2_860,
  },
  {
    furina: { level: 60, ascension: 4, talent: [6, 5, 5] },
    newcomerLevel: null,
    mora: 1_803_700,
    primogem: 9_860,
    artifactShare: 0.88,
    ar: 55,
    arExp: 1_420,
  },
  {
    furina: { level: 50, ascension: 3, talent: [4, 4, 4] },
    newcomerLevel: null,
    mora: 2_066_015,
    primogem: 8_310,
    artifactShare: 0.85,
    ar: 54,
    arExp: 22_330,
  },
  {
    furina: { level: 50, ascension: 3, talent: [4, 4, 4] },
    newcomerLevel: null,
    mora: 1_947_380,
    primogem: 6_960,
    artifactShare: 0.83,
    ar: 54,
    arExp: 19_870,
  },
  {
    furina: { level: 40, ascension: 1, talent: [1, 4, 4] },
    newcomerLevel: null,
    mora: 2_210_660,
    primogem: 5_420,
    artifactShare: 0.8,
    ar: 54,
    arExp: 16_050,
  },
]

/** Days before the newest capture each one was taken (six weeks, newest first). */
const CAPTURE_DAYS = [0, 3, 7, 11, 16, 22, 28, 35, 42]

// ------------------------------------------------------------------ wishes

export interface WishRecord {
  id: string
  uid: string
  gacha_type: string
  time: string
  name: string
  item_type: string
  rank_type: string
  item_id: string
}

interface Banner {
  kind: string
  start: string
  end: string
  serverTime: number
  featured5: string[]
  featured4: string[]
}

function bannerList(): Banner[] {
  const file = banners as unknown as { columns: string[]; banners: unknown[][] }
  const at = (name: string) => file.columns.indexOf(name)
  return file.banners.map((row) => ({
    kind: row[at('kind')] as string,
    start: row[at('start')] as string,
    end: row[at('end')] as string,
    serverTime: row[at('serverTime')] as number,
    featured5: row[at('featured5')] as string[],
    featured4: row[at('featured4')] as string[],
  }))
}

/** "YYYY-MM-DD HH:MM:SS" on the Asia server's clock (UTC+8). */
function asiaTime(ms: number): string {
  return new Date(ms + 8 * 3_600_000).toISOString().slice(0, 19).replace('T', ' ')
}
function fromAsia(text: string): number {
  return Date.parse(`${text.replace(' ', 'T')}Z`) - 8 * 3_600_000
}

const STANDARD_5 = ['Diluc', 'Jean', 'Keqing', 'Mona', 'Qiqi', 'Tighnari', 'Dehya']

interface WishItem {
  name: string
  type: 'Character' | 'Weapon'
  rarity: number
  id: number
}

function wishCatalog(): {
  byKey: Map<string, WishItem>
  threeStar: WishItem[]
  fourStar: WishItem[]
} {
  const file = wishItems as unknown as {
    characters: [string, string, number, number][]
    weapons: [string, string, number, number][]
  }
  const byKey = new Map<string, WishItem>()
  for (const [key, name, rarity, id] of file.characters)
    byKey.set(key, { name, type: 'Character', rarity, id })
  for (const [key, name, rarity, id] of file.weapons)
    byKey.set(key, { name, type: 'Weapon', rarity, id })
  const all = [...byKey.values()]
  return {
    byKey,
    threeStar: all.filter((i) => i.type === 'Weapon' && i.rarity === 3),
    fourStar: all.filter((i) => i.rarity === 4),
  }
}

/**
 * ~300 pulls on the two newest character banners and the standard one,
 * rolled with the game's published odds and pity (soft pity from 74, a 4★
 * at least every 10), so the pity and 50/50 figures look like a real
 * history without being anyone's.
 */
function makeWishes(r: Rng, newest: number): { records: WishRecord[]; newcomer: string | null } {
  const { byKey, threeStar, fourStar } = wishCatalog()
  const past = bannerList()
    .filter((b) => b.kind === 'character' && fromAsia(b.start) < newest - 2 * DAY)
    .sort((a, b) => a.start.localeCompare(b.start))
  const windows = past.slice(-2)
  let serial = 1_700_000_000_000_000_000n + BigInt(Math.floor(newest / 1000)) * 1000n
  const records: WishRecord[] = []
  let newcomer: string | null = null

  const pullRun = (
    gachaType: string,
    count: number,
    from: number,
    to: number,
    featured5: string[],
    featured4: string[],
    state: { pity5: number; pity4: number; guaranteed: boolean },
  ) => {
    const span = Math.max(1, to - from)
    // Pulls come in sessions of 1 or 10 over the window.
    let made = 0
    while (made < count) {
      const ten = r.chance(0.6) && count - made >= 10
      const n = ten ? 10 : 1
      const at = from + Math.floor((made / count) * span) + r.int(0, 3_600_000)
      for (let i = 0; i < n; i++) {
        state.pity5++
        state.pity4++
        const rate5 = state.pity5 < 74 ? 0.006 : 0.006 + (state.pity5 - 73) * 0.06
        let item: WishItem
        if (r.next() < rate5) {
          state.pity5 = 0
          const won = state.guaranteed || r.chance(0.5)
          const key = won && featured5.length ? featured5[0]! : r.pick(STANDARD_5)
          state.guaranteed = !won && featured5.length > 0
          item = byKey.get(key) ?? byKey.get('Diluc')!
          if (won && featured5.length && gachaType === '301') newcomer = key
        } else if (state.pity4 >= 10 || r.next() < 0.051) {
          state.pity4 = 0
          const key = featured4.length && r.chance(0.5) ? r.pick(featured4) : null
          item = (key && byKey.get(key)) || r.pick(fourStar)
        } else {
          item = r.pick(threeStar)
        }
        serial += BigInt(r.int(1, 40))
        records.push({
          id: serial.toString(),
          uid: DEMO_UID,
          gacha_type: gachaType,
          time: asiaTime(at),
          name: item.name,
          item_type: item.type,
          rank_type: String(item.rarity),
          item_id: String(item.id),
        })
      }
      made += n
    }
  }

  const character = { pity5: 31, pity4: 2, guaranteed: false }
  for (const [index, banner] of windows.entries()) {
    const from = fromAsia(banner.start) + DAY
    const to = Math.min(fromAsia(banner.end), newest) - DAY
    pullRun('301', index === 0 ? 110 : 140, from, to, banner.featured5, banner.featured4, character)
  }
  pullRun('200', 50, newest - 70 * DAY, newest - 2 * DAY, [], [], {
    pity5: 12,
    pity4: 5,
    guaranteed: false,
  })
  records.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
  return { records, newcomer }
}

// --------------------------------------------------------------- the planner

export interface DemoTarget {
  kind: 'character' | 'weapon'
  key: string
  owner: string
  id?: string
  target: Record<string, unknown>
}

// --------------------------------------------------------------- the account

export interface DemoAccount {
  /** Oldest first, each with its `timestamp`. */
  goods: Good[]
  wishes: WishRecord[]
  targets: DemoTarget[]
  /** Achievements marked done by hand (the capture has the rest). */
  achievementMarks: number[]
  settings: Record<string, unknown>
}

export async function generateDemo(
  options: { now?: number; seed?: number } = {},
): Promise<DemoAccount> {
  // The newest capture: yesterday evening, so "today" on the planner is fresh.
  const now = options.now ?? Date.now()
  const newest = Math.floor((now - DAY) / 3_600_000) * 3_600_000
  const r = rng(options.seed ?? 20_261_106)
  const [planner, achievementData, endgame] = await Promise.all([
    loadPlanner(),
    loadAchievements(),
    loadEndgame(),
  ])
  for (const build of ROSTER) {
    if (!planner.characters.has(build.key)) throw new Error(`Unknown character ${build.key}`)
    if (!planner.weapons.has(build.weapon.key))
      throw new Error(`Unknown weapon ${build.weapon.key}`)
  }

  const { records: wishes, newcomer: pulled } = makeWishes(r, newest)
  // The newest banner's 5★, when won and not already on the roster, joined
  // three weeks ago: the planner's second goal.
  const newcomer =
    pulled && planner.characters.has(pulled) && !ROSTER.some((b) => b.key === pulled)
      ? pulled
      : null

  // Every piece the account will hold, with the capture it first shows in.
  const pieces: { artifact: GoodArtifact; from: number }[] = []
  for (const build of ROSTER) {
    if (build.sets.length === 0) continue
    const info = planner.characters.get(build.key)!
    SLOTS.forEach((slot, index) => {
      // Furina: two good Golden Troupe pieces, three filler ones (the plan).
      const furina = build.key === 'Furina'
      const set = furina
        ? index < 2
          ? 'GoldenTroupe'
          : r.pick(['WanderersTroupe', 'GladiatorsFinale', 'MarechausseeHunter'])
        : index < 4 || build.sets.length === 1
          ? build.sets[0]!
          : build.sets[1]!
      const good = furina ? index < 2 : build.quality >= 0.5 || r.chance(build.quality)
      const level = build.quality >= 0.5 || furina ? 20 : r.pick([12, 16, 20])
      pieces.push({
        artifact: makeArtifact(r, {
          set,
          slot,
          rarity: 5,
          level,
          location: build.key,
          quality: furina && index >= 2 ? 0 : build.quality,
          main: wornMain(r, slot, info.element, good),
        }),
        from: build.key === 'Furina' && index < 2 ? 4 : 8,
      })
    })
  }
  // The bag: mostly unlevelled filler, some +20 left over, a few 4★.
  for (let i = 0; i < 112; i++) {
    const four = r.chance(0.15)
    const levelRoll = r.next()
    const level = four
      ? r.pick([0, 0, 4, 8, 16])
      : levelRoll < 0.6
        ? 0
        : levelRoll < 0.75
          ? r.pick([4, 8])
          : levelRoll < 0.9
            ? r.pick([12, 16])
            : 20
    pieces.push({
      artifact: makeArtifact(r, {
        set: four ? r.pick(FOUR_STAR_SETS) : r.pick(SPARE_SETS),
        slot: r.pick(SLOTS),
        rarity: four ? 4 : 5,
        level,
        quality: r.chance(0.15) ? 0.6 : 0,
      }),
      // Spread over the six weeks: newer pieces show up in later captures.
      from: r.int(0, 8),
    })
  }
  // A few strong spares sit on the wrong character (the plan): a +20 crit circlet on Kaeya.
  pieces.push({
    artifact: makeArtifact(r, {
      set: 'GoldenTroupe',
      slot: 'circlet',
      rarity: 5,
      level: 20,
      location: 'Kaeya',
      quality: 0.9,
      main: 'critDMG_',
    }),
    from: 2,
  })

  const allAchievements = achievementData.achievements.filter((a) => !a.disused && a.version)
  const done = allAchievements
    .filter((a) => (a.prevStage === 0 ? r.chance(0.45) : r.chance(0.25)))
    .map((a) => a.id)
  const doneSet = new Set(done)
  // A multi-tier achievement's later tier only once the one before it is done.
  const achievements = done.filter((id) => {
    const a = achievementData.byId.get(id)!
    return a.prevStage === 0 || doneSet.has(a.prevStage)
  })
  const notDone = allAchievements.filter((a) => !doneSet.has(a.id) && a.prevStage === 0)
  const achievementMarks = [notDone[3], notDone[17], notDone[41]]
    .filter((a) => a !== undefined)
    .map((a) => a.id)

  const goods: Good[] = []
  for (let step = MOMENTS.length - 1; step >= 0; step--) {
    const moment = MOMENTS[step]!
    const at = newest - CAPTURE_DAYS[step]! * DAY - step * 2_380_000
    const characters: GoodCharacter[] = []
    const extras: Record<string, GiCharacter> = {}
    const weapons: GoodWeapon[] = []
    for (const build of ROSTER) {
      const state =
        build.key === 'Furina'
          ? moment.furina
          : { level: build.level, ascension: build.ascension, talent: build.talent }
      characters.push({
        key: build.key,
        level: state.level,
        ascension: state.ascension,
        constellation: build.constellation,
        talent: { auto: state.talent[0], skill: state.talent[1], burst: state.talent[2] },
      })
      extras[build.key] = {
        friendship: build.friendship,
        obtainedAt: Math.floor((newest - build.joined * DAY) / 1000),
      }
      weapons.push({ ...build.weapon, location: build.key, lock: build.weapon.refinement > 1 })
    }
    if (newcomer && moment.newcomerLevel !== null) {
      characters.push({
        key: newcomer,
        level: moment.newcomerLevel,
        ascension: moment.newcomerLevel > 20 ? 1 : 0,
        constellation: 0,
        talent: { auto: 1, skill: 1, burst: 1 },
      })
      extras[newcomer] = { friendship: 1, obtainedAt: Math.floor((newest - 20 * DAY) / 1000) }
    }
    weapons.push(...SPARE_WEAPONS)
    const artifacts = pieces.filter((p) => p.from >= step).map((p) => p.artifact)

    const materials = makeMaterials(rng(91_000 + step), planner)
    Object.assign(materials, { Mora: moment.mora, Primogem: moment.primogem })

    const good: Good = {
      format: 'GOOD',
      version: 2,
      source: 'Teyvat.me demo',
      characters,
      artifacts,
      weapons,
      materials,
      timestamp: at,
      gi_achievements: achievements.slice(0, Math.round(achievements.length * (1 - step * 0.012))),
      gi_player: {
        uid: Number(DEMO_UID),
        ar: moment.ar,
        arExp: moment.arExp,
        wl: 8,
        wlLimit: 8,
        resin: 74 + step * 13,
        nickname: NICKNAME,
        signature: SIGNATURE,
      },
      gi_characters: extras,
      gi_wardrobe: {
        teams: {
          '1': { name: 'Furina Hyperbloom', characters: ['Furina', 'Nahida', 'Fischl', 'Bennett'] },
          '2': {
            name: 'Raiden National',
            characters: ['RaidenShogun', 'Xiangling', 'Bennett', 'KaedeharaKazuha'],
          },
          '3': { name: 'Overworld', characters: ['Zhongli', 'Yelan', 'Sucrose', 'TravelerHydro'] },
        },
        currentTeam: 1,
      },
    }
    if (step === 0) {
      good.gi_tasks = makeTasks(r, newest, endgame)
      good.gi_endgame = makeEndgame(endgame, newest)
    }
    goods.push(good)
  }

  const targets: DemoTarget[] = [
    {
      kind: 'character',
      key: 'Furina',
      owner: '',
      target: {
        level: 90,
        ascension: 6,
        talents: { auto: 9, skill: 9, burst: 9 },
        active: true,
        priority: 1,
        artifacts: {
          sets: [{ key: 'GoldenTroupe' }],
          sands: ['hp_'],
          goblet: ['hp_'],
          circlet: ['critRate_', 'critDMG_'],
        },
      },
    },
    {
      kind: 'weapon',
      key: 'SplendorOfTranquilWaters',
      owner: 'Furina',
      id: 'demosplendor',
      target: { level: 90, ascension: 6, refinement: 1, active: true },
    },
    ...(newcomer
      ? [
          {
            kind: 'character' as const,
            key: newcomer,
            owner: '',
            target: {
              level: 80,
              ascension: 6,
              talents: { auto: 6, skill: 8, burst: 8 },
              active: true,
              priority: 2,
            },
          },
        ]
      : []),
    {
      kind: 'character',
      key: 'Yelan',
      owner: '',
      target: {
        level: 80,
        ascension: 6,
        talents: { auto: 6, skill: 8, burst: 8 },
        active: true,
        priority: newcomer ? 3 : 2,
      },
    },
    {
      kind: 'character',
      key: 'Zhongli',
      owner: '',
      target: {
        level: 80,
        ascension: 6,
        talents: { auto: 1, skill: 8, burst: 8 },
        active: true,
        priority: 4,
      },
    },
  ]

  return {
    goods,
    wishes,
    targets,
    achievementMarks,
    settings: { favoriteCharacters: ['Furina', 'RaidenShogun'], traveler: 'F' },
  }
}

/** The planner's tasks as the newest login left them (gi_tasks contract v1). */
function makeTasks(
  r: Rng,
  newest: number,
  endgame: Awaited<ReturnType<typeof loadEndgame>>,
): GiTasks {
  const s = Math.floor(newest / 1000)
  const start = s - 6 * 3600
  const abyss = endgame.abyss.find((p) => fromAsia(p.start) <= newest)
  return {
    commissions: { finished: 2, total: 4 },
    // Floors 9 and 10 full, floor 11 two chambers in: the plan's "floor 11".
    ...(abyss
      ? {
          abyss: {
            start: Math.floor(fromAsia(abyss.start) / 1000),
            end: Math.floor(fromAsia(abyss.end) / 1000),
            stars: 24,
            maxStars: 36,
          },
        }
      : {}),
    expeditions: [
      { character: 'Sucrose', id: 1001, start, hours: 20, doneAt: start + 20 * 3600 },
      {
        character: 'Kaeya',
        id: 1102,
        start: start + 600,
        hours: 20,
        doneAt: start + 600 + 20 * 3600,
      },
    ],
    realm: { value: 2_190 + r.int(0, 40), limit: 2_400 },
    welkin: { days: 12 },
    resin: { value: 74, nextAt: s + 240 },
  }
}

/**
 * A modest endgame (the plan): Abyss through floor 11, the Theater season
 * running cleared on Hard, one Stygian record at difficulty 4 (not Dire).
 */
function makeEndgame(data: Awaited<ReturnType<typeof loadEndgame>>, newest: number): GiEndgame {
  const started = (start: string) =>
    Date.parse(`${start.replace(' ', 'T')}Z`) - 8 * 3_600_000 <= newest
  const theater = data.theater.find((s) => started(s.start))
  const stygian = data.stygian.find((s) => started(s.start))
  const out: GiEndgame = {}
  if (theater) out.theater = { season: theater.id, level: 3, acts: 8, stars: 8, maxStars: 10 }
  const difficulty =
    stygian?.difficulties.find((d) => d.difficulty === 4) ?? stygian?.difficulties[3]
  if (stygian && difficulty) {
    const teams = [
      ['Furina', 'Nahida', 'Fischl', 'Bennett'],
      ['RaidenShogun', 'Xiangling', 'Bennett', 'KaedeharaKazuha'],
      ['Yelan', 'Xiangling', 'Bennett', 'Zhongli'],
    ]
    out.stygian = {
      records: [
        {
          season: stygian.id,
          difficulty: difficulty.difficulty,
          at: Math.floor(newest / 1000) - 3 * 86_400,
          coop: false,
          fights: difficulty.bosses.map((_, i) => ({
            time: [142, 168, 205][i % 3]!,
            done: true,
            team: teams[i % 3]!,
            strike: {
              value: [118_420, 96_310, 154_870][i % 3]!,
              by: teams[i % 3]![i === 1 ? 1 : 0]!,
            },
            damage: { value: [1_480_200, 1_912_640, 1_337_090][i % 3]!, by: teams[i % 3]![0]! },
          })),
        },
      ],
    }
  }
  return out
}
