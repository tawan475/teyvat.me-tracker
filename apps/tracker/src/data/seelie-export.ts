/**
 * A Seelie account export of the planner (seelie.me, Settings -> Import
 * Account), so a player can move between the two: goals, extra item needs,
 * custom characters, notes and paused goals, the inventory, tasks, the resin
 * tracker, AR, World Level, server and Traveler.
 *
 * Seelie's account import writes only the keys a file has, so the ones left
 * out here (achievements, furnishings, sync state…) stay as they are there.
 * What Seelie can't hold is left out: weapon refinement goals of weapons it
 * doesn't forge are still written as `craft` (it ignores them), hand ticks on
 * single artifact slots, paused item needs, custom weapons, and built-in
 * tasks it has no counterpart for (Battle Pass, reputation, Parametric
 * Transformer).
 * `import(export(x))` gives back x otherwise (see the tests).
 */

import type { PlannerData } from '@gdt/game-data'
import type { CharacterState, WeaponState } from '@gdt/game-data/planner-math'
import type {
  ArtifactGoal,
  CustomCharacter,
  GenshinServer,
  ManualResin,
  PlannerTarget,
  PlannerTask,
} from '@gdt/shared'
import { seelieSlotOf } from '@/components/planner/seelie-items'
import {
  SEELIE_ELEMENT_GEMS,
  seelieArtifactSlug,
  seelieCharacterSlug,
  seelieStat,
  seelieWeaponSlug,
} from '@/components/planner/seelie-slugs'
import { BUILTIN_TASKS, serverClockText } from '@/components/planner/tasks'

export interface SeelieExportInput {
  planner: Pick<PlannerData, 'materialsByKey'>
  targets: readonly PlannerTarget[]
  /** A character's (or custom character's) current state: the capture's with hand-set states. */
  characterNow: (kind: 'character' | 'custom', key: string) => CharacterState
  /** A weapon goal's current state (its copy's, with hand-set states). */
  weaponNow: (goal: { id: string; key: string; owner: string }) => WeaponState
  /** A character's constellation (the capture's or the goal's, the higher); 0 when absent. */
  constellation?: (key: string) => number
  /** The planner's bag: the capture with the hand edits. */
  bag: Readonly<Record<string, number>>
  tasks: readonly PlannerTask[]
  /** The resin reading the tracker counts from (hand-set or the capture's). */
  resin: ManualResin | null
  settings: { ar: number | null; wl: number | null; traveler: 'F' | 'M' }
  server: GenshinServer | null
  now: number
}

export interface SeelieGoalOut {
  type: 'character' | 'talent' | 'weapon' | 'artifact'
  id: number
  [field: string]: unknown
}

/** Seelie's account shape, the keys written. */
export interface SeelieExport {
  goals: SeelieGoalOut[]
  inactive: Record<string, true>
  notes: Record<string, string>
  custom_items: { type: string; item: string; tier: number; value: number }[]
  customs: Record<string, Record<string, unknown>>
  inventory: { type: string; item: string; tier: number; value: number }[]
  tasks: Record<string, unknown>[]
  resin: { amount: number; time: string | null }
  ar?: number
  wl?: number
  server?: string
  gender: 'female' | 'male'
}

const isCustomKey = (key: string) => /^[a-z]/.test(key)

/** Seelie's id for a custom character of ours (`customKeyFromSeelie` reads it back). */
export const seelieCustomId = (key: string) => `custom-${key}`

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

export function buildSeelieExport(input: SeelieExportInput): SeelieExport {
  const { planner, targets } = input
  const out: SeelieExport = {
    goals: [],
    inactive: {},
    notes: {},
    custom_items: [],
    customs: {},
    inventory: [],
    tasks: [],
    resin: input.resin
      ? { amount: input.resin.value, time: new Date(input.resin.at).toUTCString() }
      : { amount: 0, time: null },
    gender: input.settings.traveler === 'M' ? 'male' : 'female',
  }
  if (input.settings.ar !== null) out.ar = input.settings.ar
  if (input.settings.wl !== null) out.wl = input.settings.wl
  if (input.server) out.server = input.server === 'SAR' ? 'asia' : input.server.toLowerCase()

  let id = 0
  const goal = (fields: Omit<SeelieGoalOut, 'id'>) => {
    const g = { ...fields, id: ++id } as SeelieGoalOut
    out.goals.push(g)
    return g
  }
  const slotItem = (key: string | undefined) => {
    const m = key ? planner.materialsByKey.get(key) : undefined
    return (m && seelieSlotOf(m)?.item) ?? null
  }
  const ownerSlug = (owner: string) =>
    owner === '' ? null : isCustomKey(owner) ? seelieCustomId(owner) : seelieCharacterSlug(owner)

  for (const t of targets) {
    if (t.kind !== 'character' && t.kind !== 'custom') continue
    const slug = t.kind === 'custom' ? seelieCustomId(t.key) : seelieCharacterSlug(t.key)
    if (t.kind === 'custom') out.customs[slug] = customOut(t.target.custom, slotItem)
    const now = input.characterNow(t.kind, t.key)
    const target = t.target
    goal({
      type: 'character',
      character: slug,
      cons: clamp(Math.max(target.constellation ?? 0, input.constellation?.(t.key) ?? 0), 0, 6),
      current: { level: now.level, asc: now.ascension },
      goal: { level: target.level, asc: target.ascension },
    })
    goal({
      type: 'talent',
      character: slug,
      normal: { current: now.talents.auto, goal: target.talents.auto },
      skill: { current: now.talents.skill, goal: target.talents.skill },
      burst: { current: now.talents.burst, goal: target.talents.burst },
    })
    const artifacts = artifactOut(target.artifacts)
    if (artifacts) goal({ type: 'artifact', character: slug, ...artifacts })
    if (target.active === false) out.inactive[slug] = true
    if (target.note) out.notes[slug] = target.note
  }

  for (const t of targets) {
    // Seelie has no custom weapons.
    if (t.kind !== 'weapon' || t.target.custom) continue
    const now = input.weaponNow({ id: t.id, key: t.key, owner: t.owner })
    const g = goal({
      type: 'weapon',
      character: ownerSlug(t.owner),
      weapon: seelieWeaponSlug(t.key),
      current: { level: now.level, asc: now.ascension, craft: now.refinement },
      goal: { level: t.target.level, asc: t.target.ascension, craft: t.target.refinement },
    })
    if (t.target.active === false) out.inactive[String(g.id)] = true
  }

  for (const t of targets) {
    if (t.kind !== 'item' || t.target.active === false) continue
    const m = planner.materialsByKey.get(t.key)
    const slot = m ? seelieSlotOf(m) : null
    if (slot) out.custom_items.push({ ...slot, value: t.target.count })
  }

  for (const [key, count] of Object.entries(input.bag)) {
    const n = Math.trunc(count)
    if (!(n > 0)) continue
    const m = planner.materialsByKey.get(key)
    const slot = m ? seelieSlotOf(m) : null
    if (slot) out.inventory.push({ ...slot, value: n })
  }

  out.tasks = tasksOut(input.tasks, input.server, input.now)
  return out
}

function customOut(
  custom: CustomCharacter,
  slotItem: (key: string | undefined) => string | null,
): Record<string, unknown> {
  const element = custom.element.toLowerCase()
  return {
    custom: 'character',
    name: custom.name,
    tier: custom.rarity,
    element,
    weapon: custom.weapon,
    element_1: SEELIE_ELEMENT_GEMS[element] ?? null,
    element_2: slotItem(custom.boss),
    local: slotItem(custom.local),
    common: slotItem(custom.common),
    talent: slotItem(custom.book),
    boss: slotItem(custom.weekly),
  }
}

function artifactOut(goal: ArtifactGoal | undefined) {
  if (!goal) return null
  const stats = {
    sands: seelieStat(goal.sands),
    goblet: seelieStat(goal.goblet),
    circlet: seelieStat(goal.circlet),
  }
  if (goal.sets.length === 0 && !stats.sands && !stats.goblet && !stats.circlet) return null
  const done: Record<string, true> = {}
  for (const s of goal.sets) if (s.done) done[seelieArtifactSlug(s.key)] = true
  return { artifacts: goal.sets.map((s) => seelieArtifactSlug(s.key)), ...stats, done }
}

/** Custom tasks keep Seelie's number when they came from it (`seelie<n>`); others get the next ones. */
function tasksOut(tasks: readonly PlannerTask[], server: GenshinServer | null, now: number) {
  const out: Record<string, unknown>[] = []
  const customs = tasks
    .flatMap((t, i) => (t.kind === 'custom' ? [{ t, i }] : []))
    .sort((a, b) => (a.t.position ?? a.i) - (b.t.position ?? b.i) || a.i - b.i)
  const own = (taskId: string) => {
    const m = /^seelie(\d{1,9})$/.exec(taskId)
    return m ? Number(m[1]) : null
  }
  let next = Math.max(0, ...customs.map(({ t }) => own(t.id) ?? 0))
  const used = new Set<number>()
  for (const { t } of customs) {
    let n = own(t.id)
    if (n === null || used.has(n)) n = ++next
    used.add(n)
    out.push({
      id: n,
      task: t.task.name,
      recurring: clamp(t.task.every, 1, 7),
      notes: t.task.note ?? null,
      mode: t.task.mode,
      next: t.due,
    })
  }
  for (const t of tasks) {
    if (t.kind !== 'builtin' || !t.next || t.next <= now) continue
    const key = BUILTIN_TASKS.find((b) => b.id === t.id)?.seelie
    if (key) out.push({ id: key, next: serverClockText(t.next, server), done: null })
  }
  return out
}

/** Seelie's own export name, `YYYY-MM-DD-HH-mm-main-seelie-gi.json` (local time). */
export function seelieExportFileName(now: number): string {
  const d = new Date(now)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}-${pad(d.getMinutes())}-main-seelie-gi.json`
}
