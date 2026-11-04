import type { ArtifactIdentity, ArtifactState } from '../artifact'
import type { KeyDictionary } from '../dictionary'
import type {
  GiAnecdote,
  GiAnecdotes,
  GiCharacter,
  GiAranaraState,
  GiCollections,
  GiExpedition,
  GiPlayer,
  GiProfilePicture,
  GiProgress,
  GiProgressState,
  GiTasks,
  GiEndgame,
  GiEvent,
  GiExploration,
  GiHangout,
  GiMiliastra,
  GiSignIn,
  GiFateStock,
  GiStygianFight,
  GiStygianRecord,
  GiTheaterRun,
  GiTeapot,
  GiTribalState,
  GiWardrobe,
  GiWardrobeKind,
  GoodCharacter,
  GoodSubstat,
  GoodWeapon,
} from '../good'
import {
  ARANARA_STATES,
  ARCHIVE_TABS,
  PROGRESS_STATES,
  ENDING_STATES,
  HANGOUT_STATES,
  TRIBAL_STATES,
  WARDROBE_KINDS,
  type ArchiveTab,
} from '../good'
import { GOOD_LIMITS } from '../import'
import { readCapture, type GiCapture } from '../live/capture'

export interface ArtifactOccurrence {
  identity: ArtifactIdentity
  state: ArtifactState
}

/** An uploaded GOOD file after every field has been checked and coerced. */
export interface NormalizedGood {
  format: string
  version: number
  source: string
  /** The payload's own `timestamp`, unvalidated; see `resolveImportTimestamp`. */
  timestamp: unknown
  characters: GoodCharacter[]
  weapons: GoodWeapon[]
  artifacts: ArtifactOccurrence[]
  materials: Map<string, number>
  /** Sorted, de-duplicated; `null` when the file carried none, so export omits the field. */
  achievements: number[] | null
  // irminsul's own keys. Each is `null` when the file had none (or nothing in
  // it passed the checks), so export omits it.
  /** `gi_player`, fields that pass their range check only, in a fixed order. */
  player: GiPlayer | null
  /** `gi_achievement_times`: [achievement id, unix seconds], sorted by id. */
  achievementTimes: [number, number][] | null
  /** `gi_characters`: GOOD key -> values that pass their check, sorted by key. */
  characterExtras: Map<string, GiCharacter> | null
  /**
   * `gi_anecdotes`, the parts that pass their checks: entries by ascending
   * id, areas sorted and unique, `reward` / `wish` only when whole.
   */
  anecdotes: GiAnecdotes | null
  /**
   * Live sync (irminsul's `gi_guid` on items, `gi_capture`): never stored in
   * a section and never part of a hash. `itemGuids` lists each kept
   * artifact's and weapon's guid in the order of `artifacts` / `weapons`
   * (null for an item without a valid one); absent when no item had one.
   */
  itemGuids?: { artifacts: (string | null)[]; weapons: (string | null)[] }
  capture?: GiCapture | null
  /** `gi_tasks`, the parts that pass their checks whole (see toTasks). */
  tasks: GiTasks | null
  /** `gi_collections`, the parts that pass their checks whole (see toCollections). */
  collections: GiCollections | null
  /** `gi_wardrobe`, the parts that pass their checks whole (see toWardrobe). */
  wardrobe: GiWardrobe | null
  /** `gi_exploration`, the parts that pass their checks whole (see toExploration). */
  exploration: GiExploration | null
  /** `gi_achievement_progress`, kept only when every entry passes. */
  achievementProgress: Record<string, { progress: number; total: number }> | null
  /** `gi_events`, kept only when every event passes. */
  events: Record<string, GiEvent> | null
  /** `gi_teapot`, the parts that pass whole. */
  teapot: GiTeapot | null
  /** `gi_miliastra`, the parts that pass whole. */
  miliastra: GiMiliastra | null
  /** `gi_endgame`, the parts (theater, stygian) that pass whole. */
  endgame: GiEndgame | null
}

export class GoodFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GoodFormatError'
  }
}

/**
 * A GOOD file over one of GOOD_LIMITS: more items than the game can hold, or
 * a key longer than any real one. `code` is what the API answers with (422).
 */
export class GoodLimitError extends GoodFormatError {
  constructor(
    readonly code: 'too_many_items' | 'key_too_long',
    message: string,
  ) {
    super(message)
    this.name = 'GoodLimitError'
  }
}

export interface NormalizeOptions {
  /**
   * The material dictionary (kept out of the main entry point): a material
   * key it knows may be longer than GOOD_LIMITS.keyLength. Without it, every
   * key is held to that length.
   */
  materials?: KeyDictionary
}

type Json = Record<string, unknown>

/**
 * Validates an untrusted, already-parsed GOOD payload. Malformed entries are
 * dropped rather than failing the whole import, and missing fields take their
 * GOOD defaults, so files from other scanners still import. A file over
 * GOOD_LIMITS fails as a whole (GoodLimitError).
 */
export function normalizeGood(input: unknown, options: NormalizeOptions = {}): NormalizedGood {
  if (!isObject(input)) throw new GoodFormatError('GOOD payload must be a JSON object')
  // Every GOOD exporter writes this marker; without it, arbitrary JSON would be
  // stored as an empty snapshot.
  if (input.format !== 'GOOD')
    throw new GoodFormatError('Not a GOOD file (missing "format": "GOOD")')

  const achievementsRaw = Array.isArray(input.gi_achievements)
    ? input.gi_achievements
    : Array.isArray(input.achievements)
      ? input.achievements
      : null
  checkCounts(input, achievementsRaw)

  const good: NormalizedGood = {
    format: 'GOOD',
    version: num(input.version, 1),
    source: str(input.source) || 'Unknown',
    timestamp: input.timestamp,
    characters: objects(input.characters).flatMap(toCharacter),
    weapons: objects(input.weapons).flatMap(toWeapon),
    artifacts: objects(input.artifacts).map(toArtifact),
    materials: toMaterials(input.materials),
    achievements: achievementsRaw && toAchievements(achievementsRaw),
    player: toPlayer(input.gi_player),
    achievementTimes: toAchievementTimes(input.gi_achievement_times),
    characterExtras: toCharacterExtras(input.gi_characters),
    anecdotes: toAnecdotes(input.gi_anecdotes),
    tasks: toTasks(input.gi_tasks),
    collections: toCollections(input.gi_collections),
    wardrobe: toWardrobe(input.gi_wardrobe),
    exploration: toExploration(input.gi_exploration),
    achievementProgress: toAchievementProgress(input.gi_achievement_progress),
    events: toEvents(input.gi_events),
    teapot: toTeapot(input.gi_teapot),
    miliastra: toMiliastra(input.gi_miliastra),
    endgame: toEndgame(input.gi_endgame),
  }
  const itemGuids = toItemGuids(input)
  if (itemGuids) good.itemGuids = itemGuids
  if (input.gi_capture !== undefined) good.capture = readCapture(input.gi_capture)
  checkKeys(good, options)
  return good
}

// ---------------------------------------------------------------- GOOD_LIMITS
// Counted on the raw file, before any entry is looked at, so an oversized one
// costs no more work than reading it did.

function checkCounts(input: Json, achievements: unknown[] | null): void {
  const count = (value: unknown) =>
    Array.isArray(value) ? value.length : isObject(value) ? Object.keys(value).length : 0
  const caps: [string, number, number][] = [
    ['characters', count(input.characters), GOOD_LIMITS.characters],
    ['weapons', count(input.weapons), GOOD_LIMITS.weapons],
    ['artifacts', count(input.artifacts), GOOD_LIMITS.artifacts],
    ['materials', count(input.materials), GOOD_LIMITS.materialKeys],
    ['achievements', count(achievements), GOOD_LIMITS.achievements],
    ['achievement times', count(input.gi_achievement_times), GOOD_LIMITS.achievements],
    ['character extras', count(input.gi_characters), GOOD_LIMITS.characters],
    [
      'anecdotes',
      count(isObject(input.gi_anecdotes) ? input.gi_anecdotes.anecdotes : null),
      GOOD_LIMITS.anecdotes,
    ],
  ]
  for (const [what, n, max] of caps) {
    if (n > max) {
      throw new GoodLimitError(
        'too_many_items',
        `This file has ${formatCount(n)} ${what}; at most ${formatCount(max)} are accepted.`,
      )
    }
  }
  for (const artifact of objects(input.artifacts)) {
    const n = Math.max(count(artifact.substats), count(artifact.unactivatedSubstats))
    if (n > GOOD_LIMITS.substats) {
      throw new GoodLimitError(
        'too_many_items',
        `An artifact in this file has ${formatCount(n)} substats; at most ${GOOD_LIMITS.substats} are accepted.`,
      )
    }
  }
}

/** Every key that would be stored spelled out, and `source`, within GOOD_LIMITS.keyLength. */
function checkKeys(good: NormalizedGood, { materials }: NormalizeOptions): void {
  const check = (what: string, key: string) => {
    if (key.length <= GOOD_LIMITS.keyLength) return
    throw new GoodLimitError(
      'key_too_long',
      `A ${what} in this file is ${formatCount(key.length)} characters long ` +
        `("${key.slice(0, 24)}…"); at most ${GOOD_LIMITS.keyLength} are accepted.`,
    )
  }
  check('source', good.source)
  for (const c of good.characters) check('character key', c.key)
  for (const w of good.weapons) {
    check('weapon key', w.key)
    check('weapon location', w.location)
  }
  for (const { identity: a, state } of good.artifacts) {
    check('artifact set key', a.setKey)
    check('artifact slot key', a.slotKey)
    check('artifact main stat key', a.mainStatKey)
    check('artifact location', state.location)
    for (const s of a.substats) check('substat key', s.key)
    for (const s of a.unactivatedSubstats) check('substat key', s.key)
  }
  for (const key of good.materials.keys()) {
    if (!materials?.ids.has(key)) check('material key', key)
  }
  for (const key of good.characterExtras?.keys() ?? []) check('character key', key)
}

function formatCount(n: number): string {
  return n.toLocaleString('en-US')
}

function toCharacter(raw: Json): GoodCharacter[] {
  const key = str(raw.key)
  if (!key) return []
  const talent = isObject(raw.talent) ? raw.talent : {}
  return [
    {
      key,
      level: num(raw.level, 1),
      constellation: num(raw.constellation, 0),
      ascension: num(raw.ascension, 0),
      talent: {
        auto: num(talent.auto, 1),
        skill: num(talent.skill, 1),
        burst: num(talent.burst, 1),
      },
    },
  ]
}

function toWeapon(raw: Json): GoodWeapon[] {
  const key = str(raw.key)
  if (!key) return []
  return [
    {
      key,
      level: num(raw.level, 1),
      ascension: num(raw.ascension, 0),
      refinement: num(raw.refinement, 1),
      location: str(raw.location),
      lock: Boolean(raw.lock),
      ...itemExp(raw),
    },
  ]
}

/** Above any EXP an item holds toward its next level (a 5★ weapon's 89 → 90 is ~1.1M). */
const MAX_ITEM_EXP = 5_000_000

/** `gi_exp` when it is a real, non-zero EXP; 0 and unknown are both left out. */
function itemExp(raw: Json): { gi_exp?: number } {
  return isIntIn(raw.gi_exp, 1, MAX_ITEM_EXP) ? { gi_exp: raw.gi_exp } : {}
}

function toArtifact(raw: Json): ArtifactOccurrence {
  return {
    identity: {
      setKey: str(raw.setKey),
      slotKey: str(raw.slotKey),
      level: num(raw.level, 0),
      rarity: num(raw.rarity, 0),
      mainStatKey: str(raw.mainStatKey),
      substats: toSubstats(raw.substats),
      totalRolls: num(raw.totalRolls, 0),
      elixerCrafted: Boolean(raw.elixerCrafted),
      unactivatedSubstats: toSubstats(raw.unactivatedSubstats),
    },
    state: {
      location: str(raw.location),
      lock: Boolean(raw.lock),
      astralMark: Boolean(raw.astralMark),
      ...(isIntIn(raw.gi_exp, 1, MAX_ITEM_EXP) ? { exp: raw.gi_exp } : {}),
    },
  }
}

const GUID = /^\d{1,20}$/

/** Each kept item's `gi_guid`, aligned with what toArtifact / toWeapon keep. */
function toItemGuids(input: Json): NormalizedGood['itemGuids'] | null {
  const guid = (raw: Json) =>
    typeof raw.gi_guid === 'string' && GUID.test(raw.gi_guid) ? raw.gi_guid : null
  const artifacts = objects(input.artifacts).map(guid)
  const weapons = objects(input.weapons).flatMap((raw) => (str(raw.key) ? [guid(raw)] : []))
  return artifacts.some(Boolean) || weapons.some(Boolean) ? { artifacts, weapons } : null
}

function toSubstats(raw: unknown): GoodSubstat[] {
  return objects(raw).flatMap((s) => {
    const key = str(s.key)
    if (!key) return []
    const substat: GoodSubstat = { key, value: num(s.value, 0) }
    if (typeof s.initialValue === 'number' && Number.isFinite(s.initialValue)) {
      substat.initialValue = s.initialValue
    }
    return [substat]
  })
}

function toMaterials(raw: unknown): Map<string, number> {
  const materials = new Map<string, number>()
  if (!isObject(raw)) return materials
  for (const [key, count] of Object.entries(raw)) {
    if (key && typeof count === 'number' && Number.isFinite(count) && count >= 0) {
      materials.set(key, count)
    }
  }
  return materials
}

function toAchievements(raw: unknown[]): number[] {
  const ids = raw.filter((v): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0)
  return [...new Set(ids)].sort((a, b) => a - b)
}

// ------------------------------------------------------------ irminsul's keys
// irminsul range-checks these before sending; they are checked again because
// any client can upload, and a value outside its range is dropped (the field,
// not the file).

/** 2020-09-15 UTC, two weeks before the game launched (irminsul's bound too). */
const EARLIEST_GAME_TIME = 1_600_128_000
/** Unix seconds as irminsul sends them: an unsigned 32-bit number. */
const LATEST_GAME_TIME = 0xffff_ffff

/**
 * Each `gi_player` field and its valid range, in the order a stored player
 * section lists them. Append only: the order is part of the stored form.
 */
const PLAYER_FIELDS: readonly [keyof GiPlayer, number, number][] = [
  ['uid', 100_000_000, 9_999_999_999], // 9 or 10 digits, like an account's UID
  ['ar', 1, 60],
  ['arExp', 0, 10_000_000],
  ['wl', 0, 9],
  ['wlLimit', 0, 9],
  ['resin', 0, 2_000], // refills can take it past the natural cap
  ['storyKeys', 0, 1_000],
  ['maxStamina', 1, 100_000],
]

/** The profile fields (Teyvat.me Capture 1.14+), stored after `gameData`. Append only. */
const PROFILE_KEYS = ['nickname', 'signature', 'nameCard', 'profilePicture', 'birthday'] as const

/** The order of a stored player section's keys: PLAYER_FIELDS, `gameData`, then the profile. */
export const PLAYER_KEY_ORDER: readonly string[] = [
  ...PLAYER_FIELDS.map(([field]) => field),
  'gameData',
  ...PROFILE_KEYS,
]

/** `profilePicture`'s ids and their ranges, in stored order. */
const PICTURE_FIELDS: readonly [keyof GiProfilePicture, number, number][] = [
  ['id', 1, 99_999_999],
  ['avatarId', 10_000_000, 10_999_999],
  ['costumeId', 1, 99_999_999],
  ['frameId', 1, 99_999_999],
]

/**
 * A name or signature as the game allows them, with a margin. Control
 * characters are refused, except line breaks where `lines` (the signature box
 * allows them).
 */
function profileText(value: unknown, min: number, max: number, lines = false): string | undefined {
  if (typeof value !== 'string' || value.length < min || value.length > max) return undefined
  // eslint-disable-next-line no-control-regex
  const control = lines ? /[\u0000-\u0009\u000b-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/
  return control.test(value) ? undefined : value
}

function toPlayer(raw: unknown): GiPlayer | null {
  if (!isObject(raw)) return null
  const player: Record<string, unknown> = {}
  for (const [field, min, max] of PLAYER_FIELDS) {
    const value = raw[field]
    if (isIntIn(value, min, max)) player[field] = value
  }
  if (typeof raw.gameData === 'string' && /^[0-9a-f]{1,64}$/.test(raw.gameData)) {
    player.gameData = raw.gameData
  }
  const nickname = profileText(raw.nickname, 1, 64)
  if (nickname !== undefined) player.nickname = nickname
  const signature = profileText(raw.signature, 0, 256, true)
  if (signature !== undefined) player.signature = signature
  if (isIntIn(raw.nameCard, 210_000, 219_999)) player.nameCard = raw.nameCard
  if (isObject(raw.profilePicture)) {
    const picture: Record<string, number> = {}
    for (const [field, min, max] of PICTURE_FIELDS) {
      const value = raw.profilePicture[field]
      if (isIntIn(value, min, max)) picture[field] = value
    }
    if (Object.keys(picture).length > 0) player.profilePicture = picture
  }
  if (
    isObject(raw.birthday) &&
    isIntIn(raw.birthday.month, 1, 12) &&
    isIntIn(raw.birthday.day, 1, 31)
  ) {
    player.birthday = { month: raw.birthday.month, day: raw.birthday.day }
  }
  // A key that only names the game data says nothing about the account.
  const known = Object.keys(player).filter((key) => key !== 'gameData')
  return known.length > 0 ? (player as GiPlayer) : null
}

function toAchievementTimes(raw: unknown): [number, number][] | null {
  if (!isObject(raw)) return null
  const times: [number, number][] = []
  for (const [key, value] of Object.entries(raw)) {
    if (!/^[1-9]\d{0,8}$/.test(key)) continue
    if (isIntIn(value, EARLIEST_GAME_TIME, LATEST_GAME_TIME)) times.push([Number(key), value])
  }
  return times.length > 0 ? times.sort((a, b) => a[0] - b[0]) : null
}

/** Above any character's EXP toward their next level, and any friendship step. */
const MAX_CHARACTER_EXP = 20_000_000
const MAX_FRIENDSHIP_EXP = 1_000_000

function toCharacterExtras(raw: unknown): Map<string, GiCharacter> | null {
  if (!isObject(raw)) return null
  const extras = new Map<string, GiCharacter>()
  for (const key of Object.keys(raw).sort()) {
    const value = raw[key]
    if (!key || !isObject(value)) continue
    const extra: GiCharacter = {}
    if (isIntIn(value.friendship, 1, 10)) extra.friendship = value.friendship
    if (isIntIn(value.obtainedAt, EARLIEST_GAME_TIME, LATEST_GAME_TIME)) {
      extra.obtainedAt = value.obtainedAt
    }
    // 0 is left out like unknown: it is what the stored rows default to.
    if (isIntIn(value.exp, 1, MAX_CHARACTER_EXP)) extra.exp = value.exp
    if (isIntIn(value.friendshipExp, 1, MAX_FRIENDSHIP_EXP))
      extra.friendshipExp = value.friendshipExp
    if (Object.keys(extra).length > 0) extras.set(key, extra)
  }
  return extras.size > 0 ? extras : null
}

/** The ranges irminsul's `gi_anecdotes` contract gives (and keeps to on its side). */
const ANECDOTE_ID = [100_000, 199_999] as const
const ANECDOTE_STATE = [0, 15] as const
const ANECDOTE_FINISH_COUNT = [0, 100_000] as const
const ANECDOTE_AREA = [1, 64] as const
/** Areas the book can have: the 7.1 game has 8. */
const MAX_ANECDOTE_AREAS = 64
/** A reward exchange per 10 recorded anecdotes; the game keeps 1,000 unclaimed. */
const ANECDOTE_REWARD_INDEX = [0, 100_000] as const
const ANECDOTE_REWARD_PROGRESS = [0, 1_000] as const
const ANECDOTE_REWARD_TARGET = [1, 1_000] as const
/** The AnecdoteExtra NPC ids are 98xx; room for more. */
const ANECDOTE_NPC = [1, 999_999] as const

function toAnecdotes(raw: unknown): GiAnecdotes | null {
  if (!isObject(raw)) return null
  const entries: [number, GiAnecdote][] = []
  if (isObject(raw.anecdotes)) {
    for (const [key, value] of Object.entries(raw.anecdotes)) {
      if (!/^[1-9]\d{5}$/.test(key) || !isObject(value)) continue
      const id = Number(key)
      if (!isIntIn(id, ...ANECDOTE_ID)) continue
      // `state` omitted on the wire is 0; irminsul writes it anyway.
      const state = value.state === undefined ? 0 : value.state
      const finishCount = value.finishCount === undefined ? 0 : value.finishCount
      if (!isIntIn(state, ...ANECDOTE_STATE)) continue
      if (!isIntIn(finishCount, ...ANECDOTE_FINISH_COUNT)) continue
      entries.push([id, { state, finishCount }])
    }
  }
  entries.sort((a, b) => a[0] - b[0])
  const areas = Array.isArray(raw.unlockedAreas)
    ? [...new Set(raw.unlockedAreas.filter((v): v is number => isIntIn(v, ...ANECDOTE_AREA)))]
        .sort((a, b) => a - b)
        .slice(0, MAX_ANECDOTE_AREAS)
    : []
  const anecdotes: GiAnecdotes = {
    anecdotes: Object.fromEntries(entries.map(([id, entry]) => [String(id), entry])),
    unlockedAreas: areas,
  }
  const reward = raw.reward
  if (
    isObject(reward) &&
    isIntIn(reward.index, ...ANECDOTE_REWARD_INDEX) &&
    isIntIn(reward.progress, ...ANECDOTE_REWARD_PROGRESS) &&
    isIntIn(reward.target, ...ANECDOTE_REWARD_TARGET)
  ) {
    anecdotes.reward = { index: reward.index, progress: reward.progress, target: reward.target }
  }
  const wish = raw.wish
  if (isObject(wish) && isIntIn(wish.lastWishTime, 0, LATEST_GAME_TIME)) {
    anecdotes.wish = isIntIn(wish.npcId, ...ANECDOTE_NPC)
      ? { npcId: wish.npcId, lastWishTime: wish.lastWishTime }
      : { lastWishTime: wish.lastWishTime }
  }
  const empty = entries.length === 0 && areas.length === 0 && !anecdotes.reward && !anecdotes.wish
  return empty ? null : anecdotes
}

/** Times in `gi_tasks`: 2015-01-01 .. 2100-01-01 (the contract's window). */
const TASK_TIME = [1_420_070_400, 4_102_444_800] as const
/** The most expeditions `gi_tasks` lists (the game has five slots). */
const MAX_EXPEDITIONS = 20
/** A GOOD key, as irminsul writes one. */
const GOOD_KEY = /^[A-Za-z0-9]{1,64}$/

/**
 * irminsul's `gi_tasks` (contract v1). Each part is kept only when every
 * value in it is in range; the rest of the key still counts. Rewritten in a
 * fixed key order, so equal content hashes equal.
 */
function toTasks(raw: unknown): GiTasks | null {
  if (!isObject(raw)) return null
  const tasks: GiTasks = {}
  const c = raw.commissions
  if (isObject(c) && isIntIn(c.total, 1, 10) && isIntIn(c.finished, 0, c.total)) {
    tasks.commissions = {
      finished: c.finished,
      total: c.total,
      // Capture 1.16.0.
      ...(typeof c.claimed === 'boolean' ? { claimed: c.claimed } : {}),
    }
  }
  const a = raw.abyss
  if (
    isObject(a) &&
    isIntIn(a.start, ...TASK_TIME) &&
    isIntIn(a.end, a.start + 1, Math.min(a.start + 62 * 86_400, TASK_TIME[1])) &&
    isIntIn(a.maxStars, 1, 108) &&
    isIntIn(a.stars, 0, a.maxStars)
  ) {
    tasks.abyss = { start: a.start, end: a.end, stars: a.stars, maxStars: a.maxStars }
  }
  const e = raw.expeditions
  if (Array.isArray(e) && e.length <= MAX_EXPEDITIONS) {
    const out: GiExpedition[] = []
    for (const x of e) {
      if (
        !isObject(x) ||
        !isIntIn(x.id, 1, 999_999) ||
        !isIntIn(x.start, ...TASK_TIME) ||
        !isIntIn(x.hours, 1, 100) ||
        !isIntIn(x.doneAt, x.start, TASK_TIME[1]) ||
        (x.character !== undefined &&
          (typeof x.character !== 'string' || !GOOD_KEY.test(x.character)))
      ) {
        out.length = 0
        break
      }
      out.push({
        ...(typeof x.character === 'string' ? { character: x.character } : {}),
        id: x.id,
        start: x.start,
        hours: x.hours,
        doneAt: x.doneAt,
      })
    }
    // One bad entry and the list is not believed (a partial list would say
    // fewer are out than are).
    if (out.length === e.length) {
      tasks.expeditions = out.sort(
        (p, q) => p.doneAt - q.doneAt || (p.character ?? '').localeCompare(q.character ?? ''),
      )
    }
  }
  const r = raw.realm
  if (isObject(r) && isIntIn(r.limit, 1, 100_000) && isIntIn(r.value, 0, r.limit)) {
    tasks.realm = { value: r.value, limit: r.limit }
  }
  const w = raw.welkin
  if (isObject(w) && isIntIn(w.days, 0, 400)) tasks.welkin = { days: w.days }
  const p = raw.wishPath
  if (
    isObject(p) &&
    typeof p.weapon === 'string' &&
    GOOD_KEY.test(p.weapon) &&
    isIntIn(p.max, 1, 3) &&
    isIntIn(p.points, 0, p.max)
  ) {
    tasks.wishPath = { weapon: p.weapon, points: p.points, max: p.max }
  }
  const n = raw.resin
  if (isObject(n) && isIntIn(n.value, 0, 2_000) && isIntIn(n.nextAt, ...TASK_TIME)) {
    tasks.resin = { value: n.value, nextAt: n.nextAt }
  }
  // Capture 1.7.0.
  const b = raw.weeklyBosses
  if (
    isObject(b) &&
    isIntIn(b.limit, 0, 100) &&
    isIntIn(b.left, 0, b.limit) &&
    isIntIn(b.cost, 0, 1_000) &&
    isIntIn(b.fullCost, 0, 1_000)
  ) {
    tasks.weeklyBosses = {
      left: b.left,
      limit: b.limit,
      cost: b.cost,
      fullCost: b.fullCost,
      // Capture 1.14.0: present means `left` really is the count left.
      ...(isIntIn(b.used, 0, b.limit) ? { used: b.used } : {}),
    }
  }
  const spots = idEntries(raw.respawns, 1, 99_999_999, GOOD_LIMITS.respawns)
  if (spots) {
    const times = spots.map(([id, list]) => [id, timeList(list)] as const)
    if (times.every(([, list]) => list)) tasks.respawns = byId(times as [number, number[]][])
  }
  const ranks = idList(raw.arRewards, 1, 100, 100)
  if (ranks) tasks.arRewards = ranks
  // Capture 1.9.0.
  const calendars = idEntries(raw.signIns, 1, 99_999_999, GOOD_LIMITS.signIns)
  if (calendars) {
    const out: [number, GiSignIn][] = []
    for (const [id, c] of calendars) {
      if (
        !isObject(c) ||
        !isIntIn(c.days, 0, GOOD_LIMITS.signInDays) ||
        !isIntIn(c.lastAt, 0, TASK_TIME[1]) ||
        !isIntIn(c.start, 0, TASK_TIME[1]) ||
        !isIntIn(c.end, 0, TASK_TIME[1])
      ) {
        break
      }
      const claimed = idList(c.claimed, 0, GOOD_LIMITS.signInDays, GOOD_LIMITS.signInDays)
      if (!claimed) break
      out.push([id, { days: c.days, claimed, lastAt: c.lastAt, start: c.start, end: c.end }])
    }
    if (out.length === calendars.length) tasks.signIns = byId(out)
  }
  // Capture 1.16.0.
  const s = raw.resinSpent
  if (
    isObject(s) &&
    isIntIn(s.value, 0, 2_000) &&
    isIntIn(s.day, 1, 7) &&
    isIntIn(s.at, ...TASK_TIME)
  ) {
    tasks.resinSpent = { value: s.value, day: s.day, at: s.at }
  }
  // Capture 1.17.2: one bad Fate and the part is not believed.
  const g = raw.bargains
  if (
    isObject(g) &&
    isIntIn(g.at, ...TASK_TIME) &&
    typeof g.bought === 'boolean' &&
    Array.isArray(g.fates) &&
    g.fates.length <= BARGAIN_FATES
  ) {
    const fates: GiFateStock[] = []
    for (const f of g.fates as unknown[]) {
      if (
        !isObject(f) ||
        !FATES.has(f.item as string) ||
        !FATE_CURRENCIES.has(f.currency as string) ||
        !isIntIn(f.cost, 1, 10_000) ||
        !isIntIn(f.bought, 0, 1_000) ||
        (f.limit !== undefined && !isIntIn(f.limit, f.bought, 1_000))
      ) {
        break
      }
      fates.push({
        item: f.item as string,
        currency: f.currency as string,
        cost: f.cost,
        bought: f.bought,
        ...(f.limit !== undefined ? { limit: f.limit } : {}),
      })
    }
    if (fates.length === g.fates.length) tasks.bargains = { at: g.at, bought: g.bought, fates }
  }
  return Object.keys(tasks).length > 0 ? tasks : null
}

/** What `gi_tasks.bargains` lists (Capture 1.17.2). */
const FATES = new Set(['IntertwinedFate', 'AcquaintFate'])
const FATE_CURRENCIES = new Set(['MasterlessStardust', 'MasterlessStarglitter'])
/** Two Fates for two currencies, with room for the game to add some. */
const BARGAIN_FATES = 16

/**
 * One part of `gi_tasks` as the live journal sets it (`gi_tasks.<part>`,
 * Capture 1.16.0), checked as a snapshot's would be; undefined when the part
 * is unknown or out of range.
 */
export function normalizeTaskPart(part: string, value: unknown): unknown {
  if (part === '__proto__' || part === 'constructor' || part === 'prototype') return undefined
  const tasks = toTasks({ [part]: value })
  return tasks ? (tasks as Record<string, unknown>)[part] : undefined
}

/** Item ids in `gi_collections`: the game's item ids have six digits. */
const COLLECTION_ITEM = [100_000, 999_999] as const

/**
 * Teyvat.me Capture's `gi_collections`. Each part is kept only when every
 * entry in it passes (a partial list would say the player lacks what they
 * have); the rest of the key still counts. Lists are rewritten ascending, so
 * equal content hashes equal.
 */
/** Unix times, ascending (duplicates kept: two spots can respawn together); null when any is bad. */
function timeList(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length > GOOD_LIMITS.respawnSpots) return null
  if (!raw.every((at) => isIntIn(at, ...TASK_TIME))) return null
  return [...(raw as number[])].sort((a, b) => a - b)
}

function toCollections(raw: unknown): GiCollections | null {
  if (!isObject(raw)) return null
  const collections: GiCollections = {}
  const spincrystals = idList(raw.spincrystals, ...COLLECTION_ITEM, GOOD_LIMITS.spincrystals)
  if (spincrystals) collections.spincrystals = spincrystals
  const archive = toArchive(raw.archive)
  if (archive) collections.archive = archive
  const defeats = toDefeats(raw.defeats)
  if (defeats) collections.defeats = defeats
  const handbook = toHandbook(raw.handbook)
  if (handbook) collections.handbook = handbook
  const aranara = toAranara(raw.aranara)
  if (aranara) collections.aranara = aranara
  const tcg = toTcg(raw.tcg)
  if (tcg) collections.tcg = tcg
  const recipes = toRecipes(raw.recipes)
  if (recipes) collections.recipes = recipes
  // Capture 1.7.0.
  const hangouts = toHangouts(raw.hangouts)
  if (hangouts) collections.hangouts = hangouts
  const seen = idList(raw.monstersSeen, 1, 999_999_999, GOOD_LIMITS.monstersSeen)
  if (seen) collections.monstersSeen = seen
  const blueprints = idList(raw.blueprints, ...COLLECTION_ITEM, GOOD_LIMITS.blueprints)
  if (blueprints) collections.blueprints = blueprints
  // Capture 1.8.0-1.11.0.
  if (isObject(raw.crafting)) {
    const crafting: NonNullable<GiCollections['crafting']> = {}
    for (const kind of ['crafting', 'forging', 'processing'] as const) {
      const ids = idList(raw.crafting[kind], 1, 99_999_999, GOOD_LIMITS.craftingRecipes)
      if (ids) crafting[kind] = ids
    }
    if (Object.keys(crafting).length > 0) collections.crafting = crafting
  }
  const songs = idEntries(raw.musicGame, 1, 999_999_999, GOOD_LIMITS.beatmaps)
  if (
    songs &&
    songs.every(
      ([, s]) =>
        isObject(s) &&
        typeof s.claimed === 'boolean' &&
        (s.score === undefined || isIntIn(s.score, ...COUNT)),
    )
  ) {
    collections.musicGame = byId(
      (songs as [number, { score?: number; claimed: boolean }][]).map(([id, s]) => [
        id,
        s.score === undefined ? { claimed: s.claimed } : { score: s.score, claimed: s.claimed },
      ]),
    )
  }
  const lists = [
    ['furnishingSets', GOOD_LIMITS.furnishingSets],
    ['companionRewards', GOOD_LIMITS.companionRewards],
    ['npcsMet', GOOD_LIMITS.npcsMet],
  ] as const
  for (const [key, cap] of lists) {
    const ids = idList(raw[key], 0, 999_999_999, cap)
    if (ids) collections[key] = ids
  }
  // Capture 1.17.
  const quests = toQuests(raw.quests)
  if (quests) collections.quests = quests
  return Object.keys(collections).length > 0 ? collections : null
}

/** Parent quests: both lists pass (MainQuest ids), or the part goes; a finished id is not active too. */
function toQuests(raw: unknown): GiCollections['quests'] | null {
  if (!isObject(raw)) return null
  const finished = idList(raw.finished, 1, 999_999, GOOD_LIMITS.quests)
  if (!finished) return null
  if (raw.active === undefined) return { finished }
  const active = idList(raw.active, 1, 999_999, GOOD_LIMITS.quests)
  if (!active) return null
  const done = new Set(finished)
  const open = active.filter((id) => !done.has(id))
  return open.length > 0 ? { finished, active: open } : { finished }
}

/** Each Archive tab's codex id block (the game numbers codex entries by tab). */
const ARCHIVE_BLOCKS: Readonly<Record<ArchiveTab, readonly [number, number]>> = {
  quests: [10_000_000, 19_999_999],
  livingBeings: [20_000_000, 29_999_999],
  artifacts: [30_000_000, 39_999_999],
  weapons: [30_000_000, 39_999_999],
  materials: [40_000_000, 49_999_999],
  books: [50_000_000, 59_999_999],
  tutorials: [60_000_000, 69_999_999],
  viewpoints: [70_000_000, 79_999_999],
}

/** Ids, each a whole number in [min, max], none twice, at most `cap`: ascending; else null. */
function idList(raw: unknown, min: number, max: number, cap: number): number[] | null {
  if (!Array.isArray(raw) || raw.length > cap) return null
  const ids = new Set<number>()
  for (const id of raw) {
    if (!isIntIn(id, min, max) || ids.has(id)) return null
    ids.add(id)
  }
  return [...ids].sort((a, b) => a - b)
}

const DECIMAL_ID = /^(0|[1-9][0-9]{0,14})$/

/** An object keyed by decimal ids in [min, max], at most `cap` of them, by id; else null. */
function idEntries(
  raw: unknown,
  min: number,
  max: number,
  cap: number,
): [number, unknown][] | null {
  if (!isObject(raw)) return null
  const entries = Object.entries(raw)
  if (entries.length > cap) return null
  const out: [number, unknown][] = []
  for (const [key, value] of entries) {
    const id = DECIMAL_ID.test(key) ? Number(key) : NaN
    if (!isIntIn(id, min, max)) return null
    out.push([id, value])
  }
  return out.sort((a, b) => a[0] - b[0])
}

/** A record from entries sorted by id, keyed by the decimal ids. */
const byId = <T>(entries: [number, T][]): Record<string, T> =>
  Object.fromEntries(entries.map(([id, value]) => [String(id), value]))

function toArchive(raw: unknown): GiCollections['archive'] | null {
  if (!isObject(raw)) return null
  const archive: NonNullable<GiCollections['archive']> = {}
  for (const tab of ARCHIVE_TABS) {
    const ids = idList(raw[tab], ...ARCHIVE_BLOCKS[tab], GOOD_LIMITS.archiveTab)
    if (ids) archive[tab] = ids
  }
  return Object.keys(archive).length > 0 ? archive : null
}

const COUNT = [0, 1_000_000_000] as const

function toDefeats(raw: unknown): GiCollections['defeats'] | null {
  const entries = idEntries(raw, ...ARCHIVE_BLOCKS.livingBeings, GOOD_LIMITS.defeats)
  if (!entries) return null
  const out: [number, { defeated: number; captured?: number }][] = []
  for (const [id, value] of entries) {
    if (!isObject(value) || !isIntIn(value.defeated, ...COUNT)) return null
    if (value.captured !== undefined && !isIntIn(value.captured, ...COUNT)) return null
    out.push([
      id,
      value.captured
        ? { defeated: value.defeated, captured: value.captured }
        : { defeated: value.defeated },
    ])
  }
  return byId(out)
}

function toProgress(value: unknown): GiProgress | null {
  if (
    !isObject(value) ||
    !isIntIn(value.progress, ...COUNT) ||
    !isIntIn(value.total, ...COUNT) ||
    !(PROGRESS_STATES as readonly unknown[]).includes(value.state)
  ) {
    return null
  }
  return { progress: value.progress, total: value.total, state: value.state as GiProgressState }
}

function toHandbook(raw: unknown): GiCollections['handbook'] | null {
  if (!isObject(raw)) return null
  const chapters = idEntries(raw.chapters, 1, 999_999, GOOD_LIMITS.handbookChapters)
  const targets = idEntries(raw.targets, 1, 999_999_999, GOOD_LIMITS.handbookTargets)
  if (!chapters || !targets) return null
  const c: [number, GiProgress][] = []
  for (const [id, value] of chapters) {
    const progress = toProgress(value)
    if (!progress) return null
    c.push([id, progress])
  }
  const t: [number, GiProgress & { chapter: number }][] = []
  for (const [id, value] of targets) {
    const progress = toProgress(value)
    if (!progress || !isObject(value) || !isIntIn(value.chapter, 1, 999_999)) return null
    t.push([id, { ...progress, chapter: value.chapter }])
  }
  return { chapters: byId(c), targets: byId(t) }
}

function toAranara(raw: unknown): GiCollections['aranara'] | null {
  const types = idEntries(raw, 1, 1_000, GOOD_LIMITS.aranara)
  if (!types) return null
  const out: [number, Record<string, GiAranaraState>][] = []
  let total = 0
  for (const [type, value] of types) {
    const entries = idEntries(value, 1, 99_999_999, GOOD_LIMITS.aranara)
    if (!entries || (total += entries.length) > GOOD_LIMITS.aranara) return null
    if (entries.some(([, state]) => !(ARANARA_STATES as readonly unknown[]).includes(state))) {
      return null
    }
    out.push([type, byId(entries as [number, GiAranaraState][])])
  }
  return out.length > 0 ? byId(out) : null
}

/** A TCG card id (character cards below 10000, action cards above). */
const CARD_ID = [1, 999_999] as const

type TcgDeck = { name: string; characters: number[]; cards: number[]; valid: boolean }

function toTcg(raw: unknown): GiCollections['tcg'] | null {
  if (!isObject(raw)) return null
  const cards = idEntries(raw.cards, ...CARD_ID, GOOD_LIMITS.tcgCards)
  if (!cards) return null
  const c: [number, { count: number; proficiency?: number }][] = []
  for (const [id, value] of cards) {
    if (!isObject(value) || !isIntIn(value.count, 0, 10_000)) return null
    if (value.proficiency !== undefined && !isIntIn(value.proficiency, ...COUNT)) return null
    c.push([
      id,
      value.proficiency
        ? { count: value.count, proficiency: value.proficiency }
        : { count: value.count },
    ])
  }
  const tcg: NonNullable<GiCollections['tcg']> = { cards: byId(c) }
  if (raw.decks !== undefined) {
    const decks = idEntries(raw.decks, 0, 1_000_000, GOOD_LIMITS.tcgDecks)
    if (!decks) return null
    const cardList = (value: unknown, cap: number) =>
      Array.isArray(value) && value.length <= cap && value.every((id) => isIntIn(id, ...CARD_ID))
        ? [...(value as number[])]
        : null
    const d: [number, TcgDeck][] = []
    for (const [id, value] of decks) {
      if (!isObject(value) || !isPlayerText(value.name) || typeof value.valid !== 'boolean') {
        return null
      }
      // In the deck's own order (a deck holds a card up to twice).
      const characters = cardList(value.characters, GOOD_LIMITS.deckCharacters)
      const deckCards = cardList(value.cards, GOOD_LIMITS.deckCards)
      if (!characters || !deckCards) return null
      d.push([id, { name: value.name, characters, cards: deckCards, valid: value.valid }])
    }
    tcg.decks = byId(d)
  }
  if (raw.currentDeck !== undefined) {
    if (!isIntIn(raw.currentDeck, 0, 1_000_000)) return null
    tcg.currentDeck = raw.currentDeck
  }
  // Capture 1.8.0: each kept only when all of it passes (the rest of the TCG stays).
  const levels = idLists(raw.levels, GOOD_LIMITS.tcgLevels, GOOD_LIMITS.tcgChallenges)
  if (levels) tcg.levels = levels
  const bosses = idList(raw.bosses, 0, 999_999_999, GOOD_LIMITS.tcgBosses)
  if (bosses) tcg.bosses = bosses
  const tavern = idLists(raw.tavern, GOOD_LIMITS.tavern, GOOD_LIMITS.tcgChallenges)
  if (tavern) tcg.tavern = tavern
  return tcg
}

/** Unlocked recipes: recipe id -> proficiency (whole numbers; 0 when none yet). */
function toRecipes(raw: unknown): GiCollections['recipes'] | null {
  const entries = idEntries(raw, 1, 999_999, GOOD_LIMITS.recipes)
  if (!entries || entries.some(([, proficiency]) => !isIntIn(proficiency, 0, 100_000))) {
    return null
  }
  return byId(entries as [number, number][])
}

/** id -> ascending id list, by id; null when any entry fails. */
function idLists(raw: unknown, cap: number, each: number): Record<string, number[]> | null {
  const entries = idEntries(raw, 0, 999_999_999, cap)
  if (!entries) return null
  const out: [number, number[]][] = []
  for (const [id, list] of entries) {
    const ids = idList(list, 0, 999_999_999, each)
    if (!ids) return null
    out.push([id, ids])
  }
  return byId(out)
}

/** Hangout Events by chapter: all of it passes, or the part goes. */
function toHangouts(raw: unknown): GiCollections['hangouts'] | null {
  const chapters = idEntries(raw, 1, 99_999_999, GOOD_LIMITS.hangouts)
  if (!chapters) return null
  const out: [number, GiHangout][] = []
  for (const [id, value] of chapters) {
    if (!isObject(value) || !isIntIn(value.picturesTotal, 0, GOOD_LIMITS.hangoutPictures))
      return null
    if (
      value.state !== undefined &&
      !(HANGOUT_STATES as readonly unknown[]).includes(value.state)
    ) {
      return null
    }
    const endings = idEntries(value.endings, 1, 999_999_999, GOOD_LIMITS.hangoutEndings)
    if (!endings || endings.some(([, s]) => !(ENDING_STATES as readonly unknown[]).includes(s))) {
      return null
    }
    const pictures = idList(value.pictures, 0, 999_999_999, GOOD_LIMITS.hangoutPictures)
    if (!pictures) return null
    out.push([
      id,
      {
        ...(value.state !== undefined ? { state: value.state as GiHangout['state'] } : {}),
        endings: byId(endings as [number, GiHangout['endings'][string]][]),
        pictures,
        picturesTotal: value.picturesTotal,
      },
    ])
  }
  return byId(out)
}

/** Text the player typed (a deck or team name): kept as is, only bounded. */
function isPlayerText(value: unknown): value is string {
  return typeof value === 'string' && value.length <= GOOD_LIMITS.playerText
}

/** Cosmetic ids (outfits, gliders, weapon skins, trails). */
const COSMETIC_ID = [1, 99_999_999] as const

const byKey = ([a]: [string, unknown], [b]: [string, unknown]) => (a < b ? -1 : a > b ? 1 : 0)

function toWardrobeKind(raw: unknown): GiWardrobeKind | null {
  if (!isObject(raw)) return null
  const owned = idList(raw.owned, ...COSMETIC_ID, GOOD_LIMITS.wardrobeOwned)
  if (!owned || !isObject(raw.worn)) return null
  const worn = Object.entries(raw.worn)
  if (worn.length > GOOD_LIMITS.characters) return null
  if (worn.some(([key, id]) => !GOOD_KEY.test(key) || !isIntIn(id, ...COSMETIC_ID))) return null
  const kind: GiWardrobeKind = {
    owned,
    worn: Object.fromEntries(worn.sort(byKey)) as Record<string, number>,
  }
  if (raw.expires !== undefined) {
    const expires = idEntries(raw.expires, ...COSMETIC_ID, GOOD_LIMITS.wardrobeOwned)
    if (!expires || expires.some(([, at]) => !isIntIn(at, ...TASK_TIME))) return null
    kind.expires = byId(expires as [number, number][])
  }
  return kind
}

/**
 * Teyvat.me Capture's `gi_wardrobe` (1.4.0). Each part is kept only when all
 * of it passes; team names are the player's text, kept as is.
 */
function toWardrobe(raw: unknown): GiWardrobe | null {
  if (!isObject(raw)) return null
  const wardrobe: GiWardrobe = {}
  for (const kind of WARDROBE_KINDS) {
    const value = toWardrobeKind(raw[kind])
    if (value) wardrobe[kind] = value
  }
  const teams = idEntries(raw.teams, 0, 1_000, GOOD_LIMITS.teams)
  const isTeam = (team: unknown): team is { name: string; characters: string[] } =>
    isObject(team) &&
    isPlayerText(team.name) &&
    Array.isArray(team.characters) &&
    team.characters.length <= GOOD_LIMITS.teamCharacters &&
    team.characters.every((key) => typeof key === 'string' && GOOD_KEY.test(key))
  if (teams && teams.every(([, team]) => isTeam(team))) {
    wardrobe.teams = byId(
      (teams as [number, { name: string; characters: string[] }][]).map(([slot, team]) => [
        slot,
        { name: team.name, characters: [...team.characters] },
      ]),
    )
  }
  if (isIntIn(raw.currentTeam, 0, 1_000)) wardrobe.currentTeam = raw.currentTeam
  return Object.keys(wardrobe).length > 0 ? wardrobe : null
}

/**
 * One part of `gi_wardrobe` as live sync sends it (Capture 1.17.1: the saved
 * teams whole, the team in use), or undefined when a snapshot's check would
 * drop it.
 */
export function normalizeWardrobePart(part: string, value: unknown): unknown {
  if (part === '__proto__' || part === 'constructor' || part === 'prototype') return undefined
  const wardrobe = toWardrobe({ [part]: value })
  return wardrobe ? (wardrobe as Record<string, unknown>)[part] : undefined
}

/** The game's config ids (cities, offerings, scenes, map points, areas). */
const GAME_ID = [0, 99_999_999] as const
/** A level (Statue, offering, reputation): the game's go to 50 at most. */
const LEVEL = [0, 1_000] as const

/** Entries whose values are all whole numbers in `range`, by id; null when any is not. */
function numberEntries(raw: unknown, range: readonly [number, number], cap: number) {
  const entries = idEntries(raw, ...GAME_ID, cap)
  return entries && entries.every(([, value]) => isIntIn(value, ...range))
    ? byId(entries as [number, number][])
    : null
}

/**
 * Teyvat.me Capture's `gi_exploration` (1.6.0). Each part is kept only when
 * all of it passes; rewritten in id order, so equal content hashes equal.
 */
function toExploration(raw: unknown): GiExploration | null {
  if (!isObject(raw)) return null
  const exploration: GiExploration = {}
  const statues = idEntries(raw.statues, ...GAME_ID, GOOD_LIMITS.explorationCities)
  if (
    statues &&
    statues.every(
      ([, s]) => isObject(s) && isIntIn(s.level, ...LEVEL) && isIntIn(s.oculi, ...COUNT),
    )
  ) {
    exploration.statues = byId(
      (statues as [number, { level: number; oculi: number }][]).map(([id, s]) => [
        id,
        { level: s.level, oculi: s.oculi },
      ]),
    )
  }
  const offerings = numberEntries(raw.offerings, LEVEL, GOOD_LIMITS.offerings)
  if (offerings) exploration.offerings = offerings
  const scenes = idEntries(raw.scenes, ...GAME_ID, GOOD_LIMITS.scenes)
  if (scenes) {
    const out: [number, { points: number[]; areas: number[] }][] = []
    for (const [id, scene] of scenes) {
      if (!isObject(scene)) break
      const points = idList(scene.points, ...GAME_ID, GOOD_LIMITS.scenePoints)
      const areas = idList(scene.areas, ...GAME_ID, GOOD_LIMITS.scenePoints)
      if (!points || !areas) break
      out.push([id, { points, areas }])
    }
    if (out.length === scenes.length) exploration.scenes = byId(out)
  }
  const explore = numberEntries(raw.explore, COUNT, GOOD_LIMITS.exploreAreas)
  if (explore) exploration.explore = explore
  const reputation = numberEntries(raw.reputation, LEVEL, GOOD_LIMITS.explorationCities)
  if (reputation) exploration.reputation = reputation
  // Capture 1.11.0.
  const cleared = idList(raw.domainsCleared, ...GAME_ID, GOOD_LIMITS.domainsCleared)
  if (cleared) exploration.domainsCleared = cleared
  const chapters = idEntries(raw.tribalChapters, ...GAME_ID, GOOD_LIMITS.tribalChapters)
  if (
    chapters &&
    chapters.every(
      ([, c]) =>
        isObject(c) &&
        (TRIBAL_STATES as readonly unknown[]).includes(c.state) &&
        (c.startedAt === undefined || isIntIn(c.startedAt, ...TASK_TIME)),
    )
  ) {
    exploration.tribalChapters = byId(
      (chapters as [number, { state: GiTribalState; startedAt?: number }][]).map(([id, c]) => [
        id,
        c.startedAt === undefined ? { state: c.state } : { state: c.state, startedAt: c.startedAt },
      ]),
    )
  }
  return Object.keys(exploration).length > 0 ? exploration : null
}

/** `gi_achievement_progress` (Capture 1.7.0): unfinished achievements' progress. */
function toAchievementProgress(raw: unknown): NormalizedGood['achievementProgress'] {
  const entries = idEntries(raw, 1, 9_999_999, GOOD_LIMITS.achievementProgress)
  if (!entries) return null
  const ok = entries.every(
    ([, v]) => isObject(v) && isIntIn(v.total, 0, COUNT[1]) && isIntIn(v.progress, ...COUNT),
  )
  if (!ok) return null
  return byId(
    (entries as [number, { progress: number; total: number }][]).map(([id, v]) => [
      id,
      { progress: v.progress, total: v.total },
    ]),
  )
}

/** `gi_events` (Capture 1.7.0): events by activity id with their counters. */
function toEvents(raw: unknown): NormalizedGood['events'] {
  const events = idEntries(raw, 1, 99_999_999, GOOD_LIMITS.events)
  if (!events) return null
  const out: [number, GiEvent][] = []
  for (const [id, e] of events) {
    if (
      !isObject(e) ||
      !isIntIn(e.schedule, 0, 99_999_999) ||
      !isIntIn(e.start, 0, TASK_TIME[1]) ||
      !isIntIn(e.end, 0, TASK_TIME[1])
    ) {
      return null
    }
    const event: GiEvent = { schedule: e.schedule, start: e.start, end: e.end }
    if (e.progress !== undefined) {
      const counters = idEntries(e.progress, 0, 999_999_999, GOOD_LIMITS.eventCounters)
      if (!counters) return null
      const rows: [number, NonNullable<GiEvent['progress']>[string]][] = []
      for (const [watcher, c] of counters) {
        if (
          !isObject(c) ||
          !isIntIn(c.progress, ...COUNT) ||
          !isIntIn(c.total, ...COUNT) ||
          typeof c.claimed !== 'boolean'
        ) {
          return null
        }
        rows.push([watcher, { progress: c.progress, total: c.total, claimed: c.claimed }])
      }
      event.progress = byId(rows)
    }
    out.push([id, event])
  }
  return byId(out)
}

/** `gi_teapot` (Capture 1.8.0): comfort by realm. */
function toTeapot(raw: unknown): GiTeapot | null {
  if (!isObject(raw)) return null
  const realms = idEntries(raw.comfort, ...GAME_ID, GOOD_LIMITS.realms)
  if (!realms) return null
  const out: [number, { mansion: number; blocks: number[] }][] = []
  for (const [id, r] of realms) {
    if (!isObject(r) || !isIntIn(r.mansion, ...COUNT)) return null
    const blocks = r.blocks
    if (
      !Array.isArray(blocks) ||
      blocks.length > GOOD_LIMITS.realmBlocks ||
      !blocks.every((b) => isIntIn(b, ...COUNT))
    ) {
      return null
    }
    out.push([id, { mansion: r.mansion, blocks: [...(blocks as number[])] }])
  }
  return { comfort: byId(out) }
}

/** `gi_miliastra` (Capture 1.9.0): cosmetics owned and when (0: no time sent). */
function toMiliastra(raw: unknown): GiMiliastra | null {
  if (!isObject(raw)) return null
  const cosmetics = idEntries(raw.cosmetics, 0, 999_999_999, GOOD_LIMITS.miliastra)
  if (!cosmetics || !cosmetics.every(([, at]) => at === 0 || isIntIn(at, ...TASK_TIME))) {
    return null
  }
  return { cosmetics: byId(cosmetics as [number, number][]) }
}

/** The game's fixed sizes in gi_endgame (contract v1): see GOOD_LIMITS.stygianRecords. */
const THEATER_SEASON = [1, 10_000] as const
const STYGIAN_SEASON = [1, 100_000_000] as const
const ENDGAME_DIFFICULTY = [1, 200] as const
const THEATER_ACTS = 12
/** Stars: one per act and extra bout (12 at Lunar Mode), with room. */
const THEATER_STARS = 50
const TEAM_SIZE = 4
/** A fight's seconds: the game's timer stops well under a day. */
const FIGHT_TIME = [0, 86_400] as const

/**
 * `gi_endgame` (Capture 1.17.12): the Theater run and the Stygian records,
 * each kept only when all of it passes (one bad record drops the list).
 */
function toEndgame(raw: unknown): GiEndgame | null {
  if (!isObject(raw)) return null
  const endgame: GiEndgame = {}
  const theater = toTheaterRun(raw.theater)
  if (theater) endgame.theater = theater
  const records = toStygianRecords(isObject(raw.stygian) ? raw.stygian.records : undefined)
  if (records) endgame.stygian = { records }
  return Object.keys(endgame).length > 0 ? endgame : null
}

function toTheaterRun(raw: unknown): GiTheaterRun | null {
  if (
    !isObject(raw) ||
    !isIntIn(raw.season, ...THEATER_SEASON) ||
    !isIntIn(raw.acts, 0, THEATER_ACTS) ||
    (raw.difficulty !== undefined && !isIntIn(raw.difficulty, ...ENDGAME_DIFFICULTY)) ||
    (raw.level !== undefined && !isIntIn(raw.level, 1, 50)) ||
    (raw.stars !== undefined && !isIntIn(raw.stars, 0, THEATER_STARS)) ||
    (raw.maxStars !== undefined && !isIntIn(raw.maxStars, 1, THEATER_STARS))
  ) {
    return null
  }
  return {
    season: raw.season,
    ...(raw.difficulty !== undefined ? { difficulty: raw.difficulty } : {}),
    ...(raw.level !== undefined ? { level: raw.level } : {}),
    acts: raw.acts,
    ...(raw.stars !== undefined ? { stars: raw.stars } : {}),
    ...(raw.maxStars !== undefined ? { maxStars: raw.maxStars } : {}),
  }
}

/** The records in the order sent (one per season and run kind, oldest first). */
function toStygianRecords(raw: unknown): GiStygianRecord[] | null {
  if (!Array.isArray(raw) || raw.length > GOOD_LIMITS.stygianRecords) return null
  const out: GiStygianRecord[] = []
  for (const r of raw) {
    if (
      !isObject(r) ||
      !isIntIn(r.season, ...STYGIAN_SEASON) ||
      !isIntIn(r.difficulty, ...ENDGAME_DIFFICULTY) ||
      !isIntIn(r.at, ...TASK_TIME) ||
      typeof r.coop !== 'boolean' ||
      !Array.isArray(r.fights) ||
      r.fights.length > GOOD_LIMITS.stygianFights
    ) {
      return null
    }
    const fights: GiStygianFight[] = []
    for (const f of r.fights) {
      if (
        !isObject(f) ||
        !isIntIn(f.time, ...FIGHT_TIME) ||
        typeof f.done !== 'boolean' ||
        !Array.isArray(f.team) ||
        f.team.length > TEAM_SIZE ||
        !f.team.every((key) => typeof key === 'string' && GOOD_KEY.test(key))
      ) {
        return null
      }
      fights.push({ time: f.time, done: f.done, team: [...(f.team as string[])] })
    }
    out.push({ season: r.season, difficulty: r.difficulty, at: r.at, coop: r.coop, fights })
  }
  return out
}

function isIntIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

function isObject(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function objects(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter(isObject) : []
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
