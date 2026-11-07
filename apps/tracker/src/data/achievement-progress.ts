/**
 * Achievement progress for the tracker's Achievements page, as pure
 * functions over data the app loads: which achievements are done (captured
 * from snapshots, or marked by hand), stage chains grouped into one entry,
 * counts per category, filters, bulk marking and imports from Seelie,
 * paimon.moe or stardb/irminsul files.
 *
 * Disused achievements (removed from the game) are never counted; ids the
 * data does not know (newer than it) are kept wherever they come from, so
 * they count once the data catches up.
 */

import type { Achievement, AchievementData, AchievementTexts } from '@gdt/game-data'
import type { LiveJournalResponse } from '@gdt/shared'
import {
  isPaimonBackup,
  paimonAccounts,
  paimonAchievements,
  type PaimonAccount,
} from './paimon-backup'

// ------------------------------------------------------------------ captured

/** One snapshot's achievements section, as a bundle lists it. */
export interface AchievementSection {
  takenAt: number
  /** The section's hash; null when the snapshot has no achievements. */
  key: string | null
  /** Its finish-times section (irminsul's `gi_achievement_times`), if any. */
  timesKey?: string | null
}

/** [achievement id, finish time in unix seconds], as a times section decodes. */
export type AchievementTime = readonly [number, number]

export interface CapturedAchievements {
  /**
   * Unfinished achievements' progress from the newest snapshot that has it
   * (Teyvat.me Capture 1.7.0's `gi_achievement_progress`); absent before.
   */
  progress?: ReadonlyMap<number, { progress: number; total: number }>
  /** Ids completed in the newest snapshot that has any. */
  ids: ReadonlySet<number>
  /** When that snapshot was taken; null when no snapshot has achievements. */
  takenAt: number | null
  /** When achievements were first captured: ids seen then were done by that time, maybe long before. */
  firstTakenAt: number | null
  /** The first snapshot (by takenAt) whose list holds each id. */
  firstSeen: ReadonlyMap<number, number>
  /**
   * For each id first seen after the first capture: when the capture before
   * that one was taken, which lacked it. The id was completed in between.
   */
  lastMissing: ReadonlyMap<number, number>
  /**
   * The game's own finish time (epoch ms) where a snapshot carried one, from
   * the newest snapshot that has a time for the id.
   */
  completedAt: ReadonlyMap<number, number>
}

/**
 * The captured achievements with the live journal laid over them (live sync:
 * Capture sends `["set", ["achievements", id], finish time (unix s, 0 =
 * unknown)]` as soon as one is finished, and `del` when one is undone). A
 * journal that does not follow the newest snapshot is ignored. An id the
 * journal finishes counts as first seen at the journal's last batch, after
 * the newest snapshot, which lacked it.
 */
export function withLiveAchievements(
  captured: CapturedAchievements,
  live: LiveJournalResponse | null | undefined,
  snapshotId: number | null,
): CapturedAchievements {
  if (!live?.open || snapshotId === null || live.base?.snapshotId !== snapshotId) return captured
  const changes = (live.changes ?? []).filter(
    ([, path]) => path[0] === 'achievements' && path.length === 2,
  )
  if (changes.length === 0) return captured
  const ids = new Set(captured.ids)
  const completedAt = new Map(captured.completedAt)
  const firstSeen = new Map(captured.firstSeen)
  const lastMissing = new Map(captured.lastMissing)
  const progress = captured.progress ? new Map(captured.progress) : undefined
  const seenAt = live.updatedAt ?? live.base.takenAt
  for (const change of changes) {
    const id = Number(change[1][1])
    if (!Number.isInteger(id) || id <= 0) continue
    if (change[0] === 'del') {
      ids.delete(id)
      completedAt.delete(id)
      continue
    }
    if (change[0] !== 'set') continue
    const time = change[2]
    ids.add(id)
    progress?.delete(id)
    if (typeof time === 'number' && time > 0) completedAt.set(id, time * 1000)
    if (!firstSeen.has(id)) {
      firstSeen.set(id, seenAt)
      if (captured.takenAt !== null) lastMissing.set(id, captured.takenAt)
    }
  }
  return {
    ...captured,
    ids,
    completedAt,
    firstSeen,
    lastMissing,
    ...(progress ? { progress } : {}),
  }
}

/**
 * Walks the snapshots oldest first. Sections are stored once per distinct
 * list, so each is decoded once; an empty list is treated as "not captured"
 * (older irminsul builds wrote `[]` when the menu was never opened).
 */
export function captureAchievements(
  sections: readonly AchievementSection[],
  decode: (key: string) => readonly number[],
  decodeTimes?: (key: string) => readonly AchievementTime[],
): CapturedAchievements {
  const ordered = sections
    .filter((s): s is AchievementSection & { key: string } => s.key !== null)
    .sort((a, b) => a.takenAt - b.takenAt)
  const decoded = new Map<string, readonly number[]>()
  const firstSeen = new Map<number, number>()
  const lastMissing = new Map<number, number>()
  let newest: { takenAt: number; ids: readonly number[] } | null = null
  let firstTakenAt: number | null = null

  for (const section of ordered) {
    let ids = decoded.get(section.key)
    if (!ids) {
      ids = decode(section.key)
      decoded.set(section.key, ids)
      // A list seen before was recorded at its earlier time already.
      for (const id of ids) {
        if (firstSeen.has(id)) continue
        firstSeen.set(id, section.takenAt)
        if (newest) lastMissing.set(id, newest.takenAt)
      }
    }
    if (ids.length === 0) continue
    firstTakenAt ??= section.takenAt
    newest = { takenAt: section.takenAt, ids }
  }

  return {
    ids: new Set(newest?.ids ?? []),
    takenAt: newest?.takenAt ?? null,
    firstTakenAt,
    firstSeen,
    lastMissing,
    completedAt: decodeTimes ? finishTimes(sections, decodeTimes) : new Map(),
  }
}

/** Newest snapshot first, so the first time found for an id is the newest one. */
function finishTimes(
  sections: readonly AchievementSection[],
  decode: (key: string) => readonly AchievementTime[],
): Map<number, number> {
  const keys = sections
    .filter((s): s is AchievementSection & { timesKey: string } => !!s.timesKey)
    .sort((a, b) => b.takenAt - a.takenAt)
    .map((s) => s.timesKey)
  const times = new Map<number, number>()
  for (const key of new Set(keys)) {
    for (const [id, seconds] of decode(key)) if (!times.has(id)) times.set(id, seconds * 1000)
  }
  return times
}

/**
 * When an achievement was completed (`at`, epoch ms), as far as the
 * snapshots tell:
 * - `exact`: the game's own finish time (irminsul's `gi_achievement_times`)
 * - `seen`: between two captures: `since`, the last one without it, and
 *   `at`, the first one with it
 * - `by`: it was already done in the first snapshot with achievements, so
 *   only "by then" is known
 */
export type CompletedOn =
  | { kind: 'exact'; at: number }
  | { kind: 'seen'; at: number; since: number }
  | { kind: 'by'; at: number }

/** What `completedOn` reads. */
export type CompletionTimes = Pick<
  CapturedAchievements,
  'firstSeen' | 'firstTakenAt' | 'lastMissing' | 'completedAt'
>

/** See `CompletedOn`. Null when no snapshot has it. */
export function completedOn(captured: CompletionTimes, id: number): CompletedOn | null {
  const exact = captured.completedAt.get(id)
  if (exact !== undefined) return { at: exact, kind: 'exact' }
  const seen = captured.firstSeen.get(id)
  if (seen === undefined) return null
  const since = captured.lastMissing.get(id)
  return seen === captured.firstTakenAt || since === undefined
    ? { at: seen, kind: 'by' }
    : { at: seen, kind: 'seen', since }
}

// ------------------------------------------------------------------- entries

/** One card on the page: a single achievement, or a stage chain with its tiers. */
export interface AchievementEntry {
  /** The first tier's id. */
  id: number
  goal: number
  /** The first tier's position in its category. */
  order: number
  hidden: boolean
  /** Version it was added in (the oldest tier's). */
  version: string
  /** Lowest tier first; disused tiers left out. */
  tiers: readonly Achievement[]
  /** All tiers' primogems. */
  primogems: number
}

/** "4.10" sorts after "4.9"; "" (no version) first. */
export function compareVersions(a: string, b: string): number {
  const [aMajor = 0, aMinor = 0] = a.split('.').map(Number)
  const [bMajor = 0, bMinor = 0] = b.split('.').map(Number)
  return aMajor - bMajor || aMinor - bMinor
}

/**
 * Active achievements as entries in game order: categories in their order,
 * then by position. A tier whose previous tier is missing or disused starts
 * its own entry.
 */
export function groupAchievements(
  data: Pick<AchievementData, 'achievements' | 'goalById'>,
): AchievementEntry[] {
  const active = new Map<number, Achievement>()
  for (const a of data.achievements) if (!a.disused) active.set(a.id, a)
  const next = new Map<number, Achievement>()
  for (const a of active.values()) if (active.has(a.prevStage)) next.set(a.prevStage, a)

  const entries: AchievementEntry[] = []
  for (const root of active.values()) {
    if (active.has(root.prevStage)) continue
    const tiers: Achievement[] = [root]
    const seen = new Set([root.id])
    for (let tier = next.get(root.id); tier && !seen.has(tier.id); tier = next.get(tier.id)) {
      tiers.push(tier)
      seen.add(tier.id)
    }
    entries.push({
      id: root.id,
      goal: root.goal,
      order: root.order,
      hidden: tiers.some((t) => t.hidden),
      version: tiers.map((t) => t.version).sort(compareVersions)[0] ?? '',
      tiers,
      primogems: tiers.reduce((sum, t) => sum + t.primogems, 0),
    })
  }

  const goalOrder = (goal: number) => data.goalById.get(goal)?.order ?? Number.MAX_SAFE_INTEGER
  return entries.sort(
    (a, b) => goalOrder(a.goal) - goalOrder(b.goal) || a.order - b.order || a.id - b.id,
  )
}

// ---------------------------------------------------------------------- done

export type DoneSource = 'captured' | 'marked'

export interface DoneState {
  /** From the newest snapshot that has achievements. */
  captured: ReadonlySet<number>
  /** Marked done by hand. */
  marked: ReadonlySet<number>
}

/** Captured wins: an id both captured and marked shows as captured (and cannot be unmarked). */
export function doneSource(state: DoneState, id: number): DoneSource | null {
  if (state.captured.has(id)) return 'captured'
  if (state.marked.has(id)) return 'marked'
  return null
}

export function isDone(state: DoneState, id: number): boolean {
  return state.captured.has(id) || state.marked.has(id)
}

export function tiersDone(entry: AchievementEntry, state: DoneState): number {
  let done = 0
  for (const tier of entry.tiers) if (isDone(state, tier.id)) done++
  return done
}

/** `CompletedOn`, or `marked`: done by hand only, so no capture dates it. */
export type DoneOn = CompletedOn | { kind: 'marked' }

/**
 * The completion to show on an entry's row: its highest done tier's (`tier`
 * is that tier's index), or null when nothing is done.
 */
export function entryCompletedOn(
  entry: AchievementEntry,
  state: DoneState,
  captured: CompletionTimes,
): (DoneOn & { tier: number }) | null {
  for (let tier = entry.tiers.length - 1; tier >= 0; tier--) {
    const id = entry.tiers[tier]!.id
    if (!isDone(state, id)) continue
    const done = completedOn(captured, id)
    if (done) return { ...done, tier }
    return doneSource(state, id) === 'marked' ? { kind: 'marked', tier } : null
  }
  return null
}

// --------------------------------------------------------------------- counts

export interface ProgressCount {
  /** Achievements (each tier counts), done and in total. */
  done: number
  total: number
  /** Primogems collected and on offer. */
  primogems: number
  primogemsTotal: number
}

export interface ProgressSummary extends ProgressCount {
  byGoal: ReadonlyMap<number, ProgressCount>
  /** Counted as done because a snapshot has them. */
  captured: number
  /** Counted as done only because they were marked by hand. */
  marked: number
  /** Done ids the data does not know (newer than it): kept, not counted. */
  unknown: number[]
}

export function summarizeAchievements(
  entries: readonly AchievementEntry[],
  state: DoneState,
  known: ReadonlyMap<number, Achievement>,
): ProgressSummary {
  const byGoal = new Map<number, ProgressCount>()
  const summary: ProgressSummary = {
    done: 0,
    total: 0,
    primogems: 0,
    primogemsTotal: 0,
    byGoal,
    captured: 0,
    marked: 0,
    unknown: [],
  }
  for (const entry of entries) {
    let goal = byGoal.get(entry.goal)
    if (!goal)
      byGoal.set(entry.goal, (goal = { done: 0, total: 0, primogems: 0, primogemsTotal: 0 }))
    for (const tier of entry.tiers) {
      const source = doneSource(state, tier.id)
      for (const count of [summary, goal]) {
        count.total++
        count.primogemsTotal += tier.primogems
        if (source) {
          count.done++
          count.primogems += tier.primogems
        }
      }
      if (source === 'captured') summary.captured++
      else if (source === 'marked') summary.marked++
    }
  }
  const unknown = new Set<number>()
  for (const ids of [state.captured, state.marked])
    for (const id of ids) if (!known.has(id)) unknown.add(id)
  summary.unknown = [...unknown].sort((a, b) => a - b)
  return summary
}

// -------------------------------------------------------------------- filters

export type Completion = 'all' | 'done' | 'missing'
export type HiddenFilter = 'all' | 'hidden' | 'visible'

export interface AchievementFilters {
  /** `done`: every tier done; `missing`: some tier left. */
  completion: Completion
  /** Category id; null for all. */
  goal: number | null
  /** Version added; null for all. */
  version: string | null
  hidden: HiddenFilter
  /** Words in a title, description or category name, or an id. */
  query: string
}

export const NO_ACHIEVEMENT_FILTERS: Readonly<AchievementFilters> = {
  completion: 'all',
  goal: null,
  version: null,
  hidden: 'all',
  query: '',
}

/** What the page opens on, and what clearing the filters returns to: what is left. */
export const DEFAULT_ACHIEVEMENT_FILTERS: Readonly<AchievementFilters> = {
  ...NO_ACHIEVEMENT_FILTERS,
  completion: 'missing',
}

/** Whether any filter differs from the defaults (a blank search is none). */
export function hasAchievementFilters(
  filters: AchievementFilters,
  defaults: Readonly<AchievementFilters> = DEFAULT_ACHIEVEMENT_FILTERS,
): boolean {
  return (
    filters.completion !== defaults.completion ||
    filters.goal !== defaults.goal ||
    filters.version !== defaults.version ||
    filters.hidden !== defaults.hidden ||
    filters.query.trim() !== defaults.query.trim()
  )
}

/** The filters kept per device (the search is left out: it is for the moment). */
export type StoredAchievementFilters = Omit<AchievementFilters, 'query'>

/** What to remember of the filters. */
export function storedFilters(filters: AchievementFilters): StoredAchievementFilters {
  const { completion, goal, version, hidden } = filters
  return { completion, goal, version, hidden }
}

/**
 * The filters to open on from what was stored (anything else: the
 * defaults). A category or version the data doesn't have (`known`, once
 * loaded) is dropped.
 */
export function restoreFilters(
  raw: unknown,
  known?: { goals: ReadonlySet<number>; versions: ReadonlySet<string> },
): AchievementFilters {
  const out: AchievementFilters = { ...DEFAULT_ACHIEVEMENT_FILTERS }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  const r = raw as Record<string, unknown>
  if (r.completion === 'all' || r.completion === 'done' || r.completion === 'missing')
    out.completion = r.completion
  if (r.hidden === 'all' || r.hidden === 'hidden' || r.hidden === 'visible') out.hidden = r.hidden
  if (typeof r.goal === 'number' && Number.isInteger(r.goal) && (!known || known.goals.has(r.goal)))
    out.goal = r.goal
  if (typeof r.version === 'string' && (!known || known.versions.has(r.version)))
    out.version = r.version
  return out
}

export function matchesCompletion(
  entry: AchievementEntry,
  completion: Completion,
  state: DoneState,
): boolean {
  if (completion === 'all') return true
  const complete = tiersDone(entry, state) === entry.tiers.length
  return completion === 'done' ? complete : !complete
}

export function matchesQuery(
  entry: AchievementEntry,
  query: string,
  text?: AchievementTexts,
): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  if (words.length === 1 && /^\d+$/.test(words[0]!)) {
    const id = Number(words[0])
    if (entry.tiers.some((t) => t.id === id)) return true
  }
  if (!text) return false
  const parts = [text.goals.get(entry.goal) ?? '']
  for (const tier of entry.tiers) {
    const t = text.achievements.get(tier.id)
    if (t) parts.push(t.title, t.description)
  }
  const haystack = parts.join('\n').toLowerCase()
  return words.every((word) => haystack.includes(word))
}

/** Entries matching every filter, in the order given. */
export function filterAchievements(
  entries: readonly AchievementEntry[],
  filters: AchievementFilters,
  state: DoneState,
  text?: AchievementTexts,
): AchievementEntry[] {
  const query = filters.query.trim()
  return entries.filter(
    (entry) =>
      (filters.goal === null || entry.goal === filters.goal) &&
      (filters.version === null || entry.tiers.some((t) => t.version === filters.version)) &&
      (filters.hidden === 'all' || entry.hidden === (filters.hidden === 'hidden')) &&
      matchesCompletion(entry, filters.completion, state) &&
      matchesQuery(entry, query, text),
  )
}

/**
 * Achievements (tiers) among the entries that fit the completion filter, so
 * a count next to the list agrees with the totals: "Missing" counts the
 * tiers left, not whole chains.
 */
export function countAchievements(
  entries: readonly AchievementEntry[],
  completion: Completion,
  state: DoneState,
): number {
  let count = 0
  for (const entry of entries)
    for (const tier of entry.tiers)
      if (completion === 'all' || isDone(state, tier.id) === (completion === 'done')) count++
  return count
}

/** Every version entries were added in, newest first. */
export function achievementVersions(entries: readonly AchievementEntry[]): string[] {
  const versions = new Set<string>()
  for (const entry of entries)
    for (const tier of entry.tiers) if (tier.version) versions.add(tier.version)
  return [...versions].sort((a, b) => compareVersions(b, a))
}

// ----------------------------------------------------------------- marking

/** Tiers a bulk "mark done" adds: neither captured nor marked yet. */
export function idsToMark(entries: readonly AchievementEntry[], state: DoneState): number[] {
  return entries.flatMap((e) => e.tiers.filter((t) => !isDone(state, t.id)).map((t) => t.id))
}

/** Tiers a bulk unmark removes: marked by hand and not captured. */
export function idsToUnmark(entries: readonly AchievementEntry[], state: DoneState): number[] {
  return entries.flatMap((e) =>
    e.tiers.filter((t) => doneSource(state, t.id) === 'marked').map((t) => t.id),
  )
}

/** Marking a tier marks the tiers below it too: the game awards them in order. */
export function markThrough(entry: AchievementEntry, index: number, state: DoneState): number[] {
  return entry.tiers
    .slice(0, index + 1)
    .filter((t) => !isDone(state, t.id))
    .map((t) => t.id)
}

/** Unmarking a tier unmarks the hand-marked tiers above it too; captured tiers stay. */
export function unmarkFrom(entry: AchievementEntry, index: number, state: DoneState): number[] {
  return entry.tiers
    .slice(index)
    .filter((t) => doneSource(state, t.id) === 'marked')
    .map((t) => t.id)
}

// -------------------------------------------------------------------- imports

/**
 * - `seelie`: a Seelie account export (`achievements: {"80001": {done: true}}`)
 * - `good`: a GOOD file, as irminsul and stardb write it (`gi_achievements: [80001]`)
 * - `list`: a bare JSON array of ids
 * - `paimon`: a paimon.moe backup (`achievement: {"<category>": {"80001": true}}`,
 *   one set per paimon.moe account)
 */
export type AchievementImportFormat = 'seelie' | 'good' | 'list' | 'paimon'

export interface ParsedAchievementImport {
  format: AchievementImportFormat
  /** Completed ids, sorted, without duplicates (paimon.moe: its first account with any). */
  ids: number[]
  /** paimon.moe: each account with its ids (pick one; another UID's are another player's). */
  accounts?: (PaimonAccount & { ids: number[] })[]
}

const isId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function idList(values: unknown[]): number[] {
  return [...new Set(values.filter(isId))].sort((a, b) => a - b)
}

/** Reads completed achievement ids from a parsed JSON file; null when it is none of the formats. */
export function parseAchievementImport(json: unknown): ParsedAchievementImport | null {
  if (Array.isArray(json)) {
    return json.length > 0 && json.every(isId) ? { format: 'list', ids: idList(json) } : null
  }
  if (!isRecord(json)) return null
  if (isPaimonBackup(json)) {
    const accounts = paimonAccounts(json)
      .map((a) => ({ ...a, ids: paimonAchievements(json, a.prefix) }))
      .filter((a) => a.ids.length > 0)
    if (accounts.length === 0) return null
    return { format: 'paimon', ids: accounts[0]!.ids, accounts }
  }
  if (Array.isArray(json.gi_achievements)) {
    return { format: 'good', ids: idList(json.gi_achievements) }
  }
  if (Array.isArray(json.achievements) && json.format === 'GOOD') {
    return { format: 'good', ids: idList(json.achievements) }
  }
  if (isRecord(json.achievements)) {
    const ids = Object.entries(json.achievements)
      .filter(([id, value]) => /^\d+$/.test(id) && isRecord(value) && value.done === true)
      .map(([id]) => Number(id))
    return { format: 'seelie', ids: idList(ids) }
  }
  return null
}

export interface AchievementImportPlan {
  /** Ids to mark: in the file, neither captured nor marked yet. */
  add: number[]
  /** In the file and already done. */
  already: number
  /** Of `add`, ids the data does not know (kept: they count once it does). */
  unknown: number
  /** Of `add`, achievements removed from the game (kept, never counted). */
  disused: number
}

export function planAchievementImport(
  ids: readonly number[],
  state: DoneState,
  known: ReadonlyMap<number, Achievement>,
): AchievementImportPlan {
  const plan: AchievementImportPlan = { add: [], already: 0, unknown: 0, disused: 0 }
  for (const id of new Set(ids)) {
    if (isDone(state, id)) {
      plan.already++
      continue
    }
    plan.add.push(id)
    const achievement = known.get(id)
    if (!achievement) plan.unknown++
    else if (achievement.disused) plan.disused++
  }
  plan.add.sort((a, b) => a - b)
  return plan
}

/** The achievement's page on stardb.gg, which has community guides. */
export function stardbAchievementUrl(id: number): string {
  return `https://stardb.gg/en/genshin/database/achievements/${id}`
}
