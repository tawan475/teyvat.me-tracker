/**
 * Deterministic synthetic GOOD files for storage tests: an account-sized
 * inventory (keys from the public dictionaries, values made up) and a run of
 * later captures that change it the way play does. Real exports are personal
 * data and never committed; see GDT_GOOD_SAMPLES_DIR in codec.test.ts.
 */

import { CHARACTERS, WEAPONS, type Good, type GoodArtifact } from '../src'
import { ARTIFACT_SETS, SLOT_KEYS, STAT_KEYS, SUBSTAT_KEYS } from '../src/dictionary/artifacts'
import { MATERIALS } from '../src/dictionary/materials'

/** mulberry32: small, fast, good enough for test data. */
export function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const pick = <T>(rand: () => number, items: readonly T[]): T =>
  items[Math.floor(rand() * items.length)]!
export const int = (rand: () => number, min: number, max: number) =>
  min + Math.floor(rand() * (max - min + 1))

const ROLLS: Record<string, number[]> = {
  hp: [209.13, 239, 268.88, 298.75],
  hp_: [4.08, 4.66, 5.25, 5.83],
  atk: [13.62, 15.56, 17.51, 19.45],
  atk_: [4.08, 4.66, 5.25, 5.83],
  def: [16.2, 18.52, 20.83, 23.15],
  def_: [5.1, 5.83, 6.56, 7.29],
  eleMas: [16.32, 18.65, 20.98, 23.31],
  enerRech_: [4.53, 5.18, 5.83, 6.48],
  critRate_: [2.72, 3.11, 3.5, 3.89],
  critDMG_: [5.44, 6.22, 6.99, 7.77],
}
const round1 = (n: number) => Math.round(n * 10) / 10

export function syntheticArtifact(rand: () => number, level = 0): GoodArtifact {
  const keys = [...SUBSTAT_KEYS].sort(() => rand() - 0.5).slice(0, 4)
  const start = rand() < 0.5 ? 3 : 4
  const substats = keys.slice(0, start).map((key) => {
    const value = round1(pick(rand, ROLLS[key]!))
    return { key, value, initialValue: value }
  })
  const unactivatedSubstats = keys.slice(start).map((key) => {
    const value = round1(pick(rand, ROLLS[key]!))
    return { key, value, initialValue: value }
  })
  const artifact: GoodArtifact = {
    setKey: pick(rand, ARTIFACT_SETS),
    slotKey: pick(rand, SLOT_KEYS),
    level: 0,
    rarity: 5,
    mainStatKey: pick(rand, STAT_KEYS),
    location: '',
    lock: rand() < 0.7,
    substats,
    totalRolls: start,
    astralMark: rand() < 0.05,
    elixerCrafted: false,
    unactivatedSubstats,
  }
  return levelUp(rand, artifact, level)
}

/** The artifact after levelling to `level` (a roll every 4 levels). */
export function levelUp(rand: () => number, a: GoodArtifact, level: number): GoodArtifact {
  const out: GoodArtifact = {
    ...a,
    substats: a.substats.map((s) => ({ ...s })),
    unactivatedSubstats: (a.unactivatedSubstats ?? []).map((s) => ({ ...s })),
  }
  for (let l = Math.floor(a.level / 4) + 1; l <= Math.floor(level / 4); l++) {
    const waiting = out.unactivatedSubstats!.shift()
    if (waiting) out.substats.push(waiting)
    else {
      const s = pick(rand, out.substats)
      s.value = round1(s.value + pick(rand, ROLLS[s.key]!))
    }
    out.totalRolls = (out.totalRolls ?? 0) + 1
  }
  out.level = level
  return out
}

export function syntheticGood(seed = 1): Good {
  const rand = random(seed)
  const characters = CHARACTERS.keys
    .filter(() => rand() < 0.8)
    .map((key) => ({
      key,
      level: pick(rand, [1, 20, 40, 50, 60, 70, 80, 90, 90, 90]),
      constellation: int(rand, 0, 6),
      ascension: int(rand, 0, 6),
      talent: { auto: int(rand, 1, 10), skill: int(rand, 1, 10), burst: int(rand, 1, 10) },
    }))
  const owners = characters.map((c) => c.key)
  const weapons = Array.from({ length: 400 }, () => ({
    key: pick(rand, WEAPONS.keys),
    level: pick(rand, [1, 1, 1, 20, 40, 50, 60, 70, 80, 90]),
    ascension: int(rand, 0, 6),
    refinement: int(rand, 1, 5),
    location: rand() < 0.2 ? pick(rand, owners) : '',
    lock: rand() < 0.4,
  }))
  const artifacts = Array.from({ length: 1500 }, () => {
    const a = syntheticArtifact(rand, pick(rand, [0, 0, 0, 4, 8, 12, 16, 20, 20]))
    if (rand() < 0.25) a.location = pick(rand, owners)
    return a
  })
  const materials: Record<string, number> = {}
  for (const key of MATERIALS.keys) if (rand() < 0.2) materials[key] = int(rand, 1, 3000)
  materials.Mora = 12_345_678
  materials.Primogem = 16_000
  const achievements = Array.from({ length: 1500 }, (_, i) => 80000 + i * 3 + int(rand, 0, 2))
  let at = 1_610_000_000
  const times: Record<string, number> = {}
  for (const id of achievements) {
    at += rand() < 0.7 ? int(rand, 1, 600) : int(rand, 3600, 2_000_000)
    times[String(id)] = at
  }
  const extras: Record<string, { friendship?: number; obtainedAt?: number }> = {}
  for (const key of owners) {
    extras[key] = { friendship: int(rand, 1, 10), obtainedAt: 1_601_000_000 + int(rand, 0, 1e8) }
  }
  // About 140 met anecdotes (7.1 has 161): nearly all recorded, two loops idle again.
  const anecdotes: Record<string, { state: number; finishCount: number }> = {}
  for (let series = 1000; series < 1094; series++) {
    for (let n = 1; n <= int(rand, 1, 2); n++) {
      anecdotes[String(series * 100 + n)] =
        rand() < 0.97 ? { state: 3, finishCount: 1 } : { state: 0, finishCount: int(rand, 1, 3) }
    }
  }
  return {
    format: 'GOOD',
    version: 3,
    source: 'Irminsul',
    characters,
    artifacts,
    weapons,
    materials,
    gi_achievements: achievements,
    timestamp: 1_790_000_000_000,
    gi_player: {
      uid: 812345678,
      ar: 60,
      arExp: 0,
      wl: 8,
      wlLimit: 9,
      resin: 120,
      storyKeys: 3,
      maxStamina: 24000,
      gameData: '792978e5503ecfba73dcb3562ed44a0d35a2abe2',
    },
    gi_achievement_times: times,
    gi_characters: extras,
    gi_anecdotes: {
      anecdotes,
      unlockedAreas: [1, 2, 3, 4, 5, 6, 7, 8],
      reward: { index: 12, progress: 4, target: 10 },
      wish: { npcId: 9801, lastWishTime: 1_789_000_000 },
    },
  }
}

/**
 * The next capture: some materials used or gained, a few artifacts levelled
 * or dropped or new, now and then a character or weapon levelled, an
 * achievement done, resin moved. `step` makes each capture different.
 */
export function playOn(good: Good, step: number): Good {
  const rand = random(10_000 + step)
  const materials = { ...good.materials }
  const keys = Object.keys(materials)
  for (let i = 0; i < int(rand, 2, 12); i++) {
    const key = pick(rand, keys)
    materials[key] = Math.max(0, materials[key]! + int(rand, -30, 60))
  }
  materials.Mora = materials.Mora! + int(rand, -200_000, 300_000)
  if (rand() < 0.1) materials[pick(rand, MATERIALS.keys)] = int(rand, 1, 20)

  let artifacts = good.artifacts
  if (rand() < 0.6) {
    artifacts = artifacts.map((a) =>
      rand() < 0.002 && a.level < 20 ? levelUp(rand, a, Math.min(20, a.level + 4)) : a,
    )
    for (let i = 0; i < int(rand, 0, 4); i++) artifacts.push(syntheticArtifact(rand))
    if (rand() < 0.3) artifacts = artifacts.filter(() => rand() > 0.002)
  }
  if (rand() < 0.3) {
    artifacts = artifacts.map((a) => (rand() < 0.01 ? { ...a, lock: !a.lock } : a))
  }

  let characters = good.characters
  if (rand() < 0.15) {
    characters = characters.map((c) =>
      rand() < 0.05 ? { ...c, level: Math.min(90, c.level + 10) } : c,
    )
  }
  let weapons = good.weapons
  if (rand() < 0.1) {
    weapons = weapons.map((w) => (rand() < 0.02 ? { ...w, level: Math.min(90, w.level + 10) } : w))
  }

  let achievements = good.gi_achievements ?? []
  let times = good.gi_achievement_times ?? {}
  if (rand() < 0.2) {
    const id = 90000 + step
    achievements = [...achievements, id]
    times = { ...times, [String(id)]: 1_790_000_000 + step * 3600 }
  }
  const extras = good.gi_characters ?? {}
  let anecdotes = good.gi_anecdotes
  if (anecdotes && rand() < 0.05) {
    const id = String(109_900 + (step % 99))
    const reward = anecdotes.reward ?? { index: 0, progress: 0, target: 10 }
    anecdotes = {
      ...anecdotes,
      anecdotes: { ...anecdotes.anecdotes, [id]: { state: 3, finishCount: 1 } },
      reward: { ...reward, progress: (reward.progress + 1) % 10 },
    }
  }
  return {
    ...good,
    artifacts,
    characters,
    weapons,
    materials,
    gi_achievements: achievements,
    gi_achievement_times: times,
    gi_characters:
      rand() < 0.1
        ? Object.fromEntries(
            Object.entries(extras).map(([k, v]) => [
              k,
              rand() < 0.05 ? { ...v, friendship: Math.min(10, (v.friendship ?? 1) + 1) } : v,
            ]),
          )
        : extras,
    gi_player: { ...good.gi_player!, resin: int(rand, 0, 200) },
    ...(anecdotes ? { gi_anecdotes: anecdotes } : {}),
    timestamp: (good.timestamp ?? 0) + 3_600_000,
  }
}

// ------------------------------------------------------- Capture 1.4.0 parts

/** `n` distinct ids in [from, from + span), ascending. */
function ids(rand: () => number, from: number, span: number, n: number): number[] {
  const out = new Set<number>()
  while (out.size < n) out.add(from + Math.floor(rand() * span))
  return [...out].sort((a, b) => a - b)
}

/**
 * `gi_collections` at a real capture's scale (made-up ids in the right
 * blocks): Archive 488 / 164 / 538 / 1,006 / 243 / 748 / 233 / 111, 502
 * defeats (14 with captures), 22 Handbook chapters and 244 targets, 11
 * Aranara, 104 TCG cards and 4 decks of 3 + 30.
 */
export function syntheticCollections(seed = 1): NonNullable<Good['gi_collections']> {
  const rand = random(seed)
  const living = ids(rand, 20_010_000, 900_000, 538)
  const defeats: Record<string, { defeated: number; captured?: number }> = {}
  living.slice(0, 502).forEach((id, i) => {
    defeats[String(id)] =
      i < 14
        ? { defeated: int(rand, 1, 400), captured: int(rand, 1, 40) }
        : { defeated: int(rand, 1, 9_999) }
  })
  const chapters: Record<
    string,
    { progress: number; total: number; state: 'open' | 'complete' | 'claimed' }
  > = {}
  const targets: Record<
    string,
    { progress: number; total: number; state: 'open' | 'complete' | 'claimed'; chapter: number }
  > = {}
  const chapterIds = Array.from(
    { length: 22 },
    (_, i) => 10_001 + Math.floor(i / 5) * 10_000 + (i % 5),
  )
  for (const [c, chapter] of chapterIds.entries()) {
    const done = c < 15
    chapters[String(chapter)] = {
      progress: done ? 11 : int(rand, 0, 10),
      total: 11,
      state: done ? 'claimed' : 'open',
    }
    for (let t = 0; t < 12 && Object.keys(targets).length < 244; t++) {
      const total = int(rand, 1, 20)
      const progress = done ? total : int(rand, 0, total)
      targets[String(300_000 + c * 100 + t)] = {
        progress,
        total,
        state: done
          ? 'claimed'
          : progress === total
            ? rand() < 0.5
              ? 'complete'
              : 'claimed'
            : 'open',
        chapter,
      }
    }
  }
  const cards: Record<string, { count: number; proficiency?: number }> = {}
  for (const id of [...ids(rand, 1_101, 2_000, 40), ...ids(rand, 211_011, 120_000, 64)]) {
    cards[String(id)] =
      id < 10_000 && rand() < 0.4
        ? { count: 1, proficiency: int(rand, 1, 30) }
        : { count: int(rand, 1, 2) }
  }
  const cardIds = Object.keys(cards).map(Number)
  const decks: Record<
    string,
    { name: string; characters: number[]; cards: number[]; valid: boolean }
  > = {}
  for (let d = 0; d < 4; d++) {
    decks[String(d)] = {
      name: ['Mono Pyro', 'Freeze ★', 'Deck 3', 'あいうえお かきくけこ さしすせそ たちつてと'][d]!,
      characters: cardIds.filter((id) => id < 10_000).slice(d * 3, d * 3 + 3),
      cards: Array.from({ length: 30 }, () =>
        pick(
          rand,
          cardIds.filter((id) => id > 10_000),
        ),
      ),
      valid: d !== 2,
    }
  }
  return {
    spincrystals: ids(rand, 141_001, 306, 120),
    archive: {
      quests: ids(rand, 10_000_000, 900_000, 488),
      weapons: ids(rand, 30_200_000, 90_000, 164),
      livingBeings: living,
      materials: ids(rand, 40_000_000, 900_000, 1_006),
      books: ids(rand, 50_000_000, 900_000, 243),
      tutorials: ids(rand, 60_000_000, 900_000, 748),
      viewpoints: ids(rand, 70_000_000, 900_000, 233),
      artifacts: ids(rand, 30_100_000, 90_000, 111),
    },
    defeats,
    handbook: { chapters, targets },
    aranara: {
      '1': Object.fromEntries(
        ids(rand, 1, 30, 11).map((id, i) => [
          String(id),
          (['none', 'collectable', 'collected', 'finished'] as const)[i % 4]!,
        ]),
      ),
    },
    tcg: { cards, decks, currentDeck: 1 },
  }
}

/** `gi_wardrobe` at a real capture's scale: 20 outfits, 13 gliders worn by 103, 24 weapon skins (20 expiring), 16 trails, 14 teams. */
export function syntheticWardrobe(seed = 1): NonNullable<Good['gi_wardrobe']> {
  const rand = random(seed)
  const characters = CHARACTERS.keys.slice(0, 103)
  const kind = (from: number, n: number, wearers: number, expiring = 0) => {
    const owned = ids(rand, from, 2_000, n)
    return {
      owned,
      worn: Object.fromEntries(characters.slice(0, wearers).map((key) => [key, pick(rand, owned)])),
      ...(expiring > 0
        ? {
            expires: Object.fromEntries(
              owned.slice(0, expiring).map((id) => [String(id), int(rand, 1.79e9, 1.8e9)]),
            ),
          }
        : {}),
    }
  }
  return {
    outfits: kind(200_000, 20, 18),
    gliders: kind(140_000, 13, 103),
    weaponSkins: kind(11_000, 24, 4, 20),
    trails: kind(330_000, 16, 0),
    teams: Object.fromEntries(
      Array.from({ length: 14 }, (_, i) => [
        String(i + 1),
        {
          name: i === 0 ? 'Abyss ★ Floor 12 — second half' : `Team ${i + 1}`,
          characters: characters.slice(i * 4, i * 4 + 4),
        },
      ]),
    ),
    currentTeam: 3,
  }
}

/** `gi_collections.recipes` at a real capture's scale (Capture 1.5.0): 252 unlocked, some mastered. */
export function syntheticRecipes(seed = 1): Record<string, number> {
  const rand = random(seed)
  return Object.fromEntries(
    ids(rand, 1_001, 4_500, 252).map((id) => [String(id), rand() < 0.3 ? 0 : int(rand, 1, 30)]),
  )
}

/**
 * `gi_exploration` at a real capture's scale (Capture 1.6.0; made-up ids):
 * 16 Statues (7 at 10, one at 6 with 2 Oculi, the rest at 1), 22 offerings,
 * 8 scenes (Teyvat with ~893 points and 65 areas), 71 areas, 5 reputations.
 */
export function syntheticExploration(seed = 1): NonNullable<Good['gi_exploration']> {
  const rand = random(seed)
  const cities = [1, 2, 3, 4, 5, 6, 7, 8, 9, 99, 100, 101, 102, 103, 104, 105]
  const scene = (points: number, areas: number) => ({
    points: ids(rand, 1, points * 3, points),
    areas: ids(rand, 1, areas * 2, areas),
  })
  return {
    statues: Object.fromEntries(
      cities.map((city) => [
        String(city),
        city <= 7
          ? { level: 10, oculi: 0 }
          : city === 8
            ? { level: 6, oculi: 2 }
            : { level: 1, oculi: 0 },
      ]),
    ),
    offerings: Object.fromEntries(ids(rand, 1, 60, 22).map((id) => [String(id), int(rand, 5, 50)])),
    scenes: Object.fromEntries([
      ['3', scene(893, 65)],
      ...[5, 6, 10, 11, 101, 102, 103].map((id) => [String(id), scene(int(rand, 10, 47), 3)]),
    ]),
    explore: Object.fromEntries(
      ids(rand, 1, 200, 71).map((id) => [String(id), int(rand, 0, 1_000)]),
    ),
    reputation: Object.fromEntries([1, 2, 3, 4, 5].map((city) => [String(city), int(rand, 8, 10)])),
  }
}

/**
 * Capture 1.7.0's keys at a real capture's scale (made-up ids): 19 Hangout
 * chapters with 5-6 endings and their pictures, ~2,300 monsters seen, 1,171
 * blueprints; weekly bosses, 103 respawning bosses (211 spots), AR rewards;
 * 15 unfinished achievements, 15 events with 81 counters.
 */
export function synthetic17(seed = 1) {
  const rand = random(seed)
  const hangouts = Object.fromEntries(
    Array.from({ length: 19 }, (_, i) => {
      const chapter = 101_401 + i * 100
      const endings = Object.fromEntries(
        Array.from({ length: int(rand, 5, 6) }, (_, n) => [
          String(chapter * 100 + n + 1),
          pick(rand, ['locked', 'unclaimed', 'claimed'] as const),
        ]),
      )
      const total = int(rand, 8, 14)
      return [
        String(chapter),
        {
          ...(rand() < 0.9
            ? { state: pick(rand, ['closed', 'locked', 'open', 'accepted'] as const) }
            : {}),
          endings,
          pictures: ids(rand, chapter * 10, 40, int(rand, 0, total)),
          picturesTotal: total,
        },
      ]
    }),
  )
  const respawns = Object.fromEntries(
    ids(rand, 1_000, 5_000, 103).map((id) => [
      String(id),
      Array.from({ length: int(rand, 1, 4) }, () => int(rand, 1.79e9, 1.8e9)).sort((a, b) => a - b),
    ]),
  )
  return {
    collections: {
      hangouts,
      monstersSeen: ids(rand, 20_010_101, 600_000, 2_300),
      blueprints: ids(rand, 360_101, 20_000, 1_171),
    },
    tasks: {
      weeklyBosses: { left: 3, limit: 3, cost: 30, fullCost: 60 },
      respawns,
      arRewards: ids(rand, 2, 59, 40),
    },
    achievementProgress: Object.fromEntries(
      ids(rand, 80_000, 20_000, 15).map((id) => [String(id), { progress: 0, total: 1 }]),
    ),
    events: Object.fromEntries(
      ids(rand, 2_001_000, 20_000, 15).map((id) => [
        String(id),
        {
          schedule: int(rand, 1, 999_999),
          start: int(rand, 1.79e9, 1.795e9),
          end: int(rand, 1.795e9, 1.8e9),
          progress: Object.fromEntries(
            ids(rand, 1, 900_000, int(rand, 3, 7)).map((w) => [
              String(w),
              { progress: int(rand, 0, 10), total: 10, claimed: rand() < 0.8 },
            ]),
          ),
        },
      ]),
    ),
  }
}

/**
 * Capture 1.8.0-1.11.0's keys at a real capture's scale (made-up ids): 578 /
 * 46 / 44 recipes, TCG levels, bosses and Tavern, the music game, sign-in
 * calendars, 97 furnishing sets, 41 companion rewards, 158 NPCs met, 13
 * domains cleared, 18 tribal chapters; the Serenitea Pot's comfort and
 * Miliastra cosmetics.
 */
export function synthetic18(seed = 1) {
  const rand = random(seed)
  const levels = (n: number) =>
    Object.fromEntries(
      ids(rand, 1_000, 5_000, n).map((id) => [String(id), ids(rand, 1, 20, int(rand, 0, 4))]),
    )
  return {
    collections: {
      crafting: {
        crafting: ids(rand, 1_000, 20_000, 578),
        forging: ids(rand, 11_001, 2_000, 46),
        processing: ids(rand, 1_001, 2_000, 44),
      },
      musicGame: Object.fromEntries(
        ids(rand, 1, 600, 120).map((id) => [
          String(id),
          rand() < 0.2
            ? { claimed: false }
            : { score: int(rand, 0, 1_000_000), claimed: rand() < 0.7 },
        ]),
      ),
      furnishingSets: ids(rand, 1, 300, 97),
      companionRewards: ids(rand, 1, 400, 41),
      npcsMet: ids(rand, 2, 1_052, 158),
    },
    tcg: { levels: levels(40), bosses: ids(rand, 1, 60, 12), tavern: levels(20) },
    tasks: {
      signIns: Object.fromEntries(
        ids(rand, 1, 300, 3).map((id) => [
          String(id),
          {
            days: 7,
            claimed: ids(rand, 1, 7, int(rand, 0, 7)),
            lastAt: int(rand, 1.79e9, 1.8e9),
            start: 1_790_000_000,
            end: 1_791_000_000,
          },
        ]),
      ),
    },
    exploration: {
      domainsCleared: ids(rand, 1_006, 120, 13),
      tribalChapters: Object.fromEntries(
        Array.from({ length: 18 }, (_, i) => [
          String(i + 1),
          i < 10
            ? { state: 'finished' as const, startedAt: int(rand, 1.7e9, 1.8e9) }
            : { state: pick(rand, ['notOpen', 'locked', 'open'] as const) },
        ]),
      ),
    },
    teapot: {
      comfort: Object.fromEntries(
        [1, 2, 3].map((id) => [
          String(id),
          {
            mansion: int(rand, 0, 30_000),
            blocks: Array.from({ length: 4 }, () => int(rand, 0, 20_000)),
          },
        ]),
      ),
    },
    miliastra: {
      cosmetics: Object.fromEntries(
        ids(rand, 1, 9_999, 30).map((id) => [
          String(id),
          rand() < 0.3 ? 0 : int(rand, 1.79e9, 1.8e9),
        ]),
      ),
    },
  }
}

/**
 * Capture 1.17.12's gi_endgame at a long-played account's scale: the Theater
 * run of the season running and a Stygian record per season and run kind
 * (13 seasons × solo and co-op at 7.1), each with the three fights and a
 * team of up to four characters (keys from the dictionary, made up).
 */
export function syntheticEndgame(seed = 1, seasons = 13) {
  const rand = random(seed)
  const characters = CHARACTERS.keys
  const team = () =>
    Array.from({ length: int(rand, 1, 4) }, () => pick(rand, characters)).filter(
      (key, i, all) => all.indexOf(key) === i,
    )
  const records = []
  for (let n = 0; n < seasons; n++) {
    for (const coop of [false, true]) {
      if (coop && rand() < 0.4) continue
      records.push({
        season: 5_269_001 + n,
        difficulty: int(rand, 1, 6),
        at: 1_750_000_000 + n * 3_628_800 + int(rand, 0, 1_000_000),
        coop,
        fights: Array.from({ length: 3 }, (_, i) => ({
          time: int(rand, 20, 180),
          done: i < 2 || rand() < 0.7,
          team: team(),
        })),
      })
    }
  }
  return {
    theater: { season: 31, difficulty: 129, level: 5, acts: int(rand, 0, 10) },
    stygian: { records },
  }
}
