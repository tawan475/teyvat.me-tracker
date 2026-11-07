/**
 * Bringing guest data into an account (docs/plans/open-site.md §4, "ask
 * once"): when a guest signs up or in with data in this browser, Home asks
 * once whether to bring it in, and the answer is kept (`guest:convert`).
 * Yes: the guest's snapshots are replayed oldest first through the website's
 * import queue (data/import-queue.ts, as a folder of GOOD files would be),
 * then the marks, the plan (goals, tasks, hand edits) and the settings, then
 * the wish history. The guest's copy stays in this browser; Manage deletes it.
 */

import {
  MAX_IMPORT_FILES,
  buildUigf,
  parseUigf,
  serverTimezone,
  type AccountSettingsResponse,
  type PlannerStateResponse,
  type PlannerTargetsResponse,
  type PlannerTasksResponse,
  type UigfGachaType,
  type WishPull,
} from '@gdt/shared'
import { watch } from 'vue'
import { api } from '@/api'
import { addFiles, clearFinished, start, summarize, useImportQueue } from '@/data/import-queue'
import { readStorage, writeStorage } from '@/lib/storage'
import { GUEST_ACCOUNT_ID } from './guest-id'
import { buildGood } from './local-read'
import { guestStore, type LocalStore } from './local-store'
import { storedPulls } from './local-wishes'

/** The answer, kept per browser: asked once. */
export const CONVERT_KEY = 'guest:convert'
export type ConvertAnswer = 'yes' | 'no'

export function convertAnswer(): ConvertAnswer | null {
  const value = readStorage(CONVERT_KEY)
  return value === 'yes' || value === 'no' ? value : null
}

export function rememberConvertAnswer(answer: ConvertAnswer): void {
  writeStorage(CONVERT_KEY, answer)
}

/** What the guest holds, for the question. */
export interface GuestSummary {
  snapshots: number
  pulls: number
  /** Planner goals (characters and weapons). */
  goals: number
  uid: string | null
  name: string | null
}

export async function guestSummary(store: LocalStore = guestStore()): Promise<GuestSummary> {
  await store.ready()
  let pulls = 0
  for (const list of storedPulls(store).values()) pulls += list.length
  // The plan is read through the guest routes, as the conversion reads it.
  const goals = await api
    .plannerTargets(GUEST_ACCOUNT_ID)
    .then((answer) => answer.targets.length)
    .catch(() => 0)
  return {
    snapshots: store.snapshots.size,
    pulls,
    goals,
    uid: store.account?.uid ?? null,
    name: store.account?.name ?? null,
  }
}

/**
 * The guest's snapshots as GOOD files, oldest first, each with its capture
 * time (and the newest again at its last sighting, so the account's "last
 * seen", which the plan's hand edits are keyed to, matches the guest's).
 */
export async function guestFiles(store: LocalStore = guestStore()): Promise<File[]> {
  await store.ready()
  const materials = (await import('@gdt/shared/dictionary/materials')).MATERIALS
  const rows = store.newestFirst().reverse()
  const files: File[] = []
  const file = (good: object, at: number) =>
    new File([JSON.stringify({ ...good, timestamp: at })], `guest-${at}.json`, {
      type: 'application/json',
      lastModified: at,
    })
  for (const row of rows) {
    const { good } = await buildGood(store, row.id, materials)
    files.push(file(good, row.takenAt))
    if (row === rows.at(-1) && row.lastSeenAt > row.takenAt) files.push(file(good, row.lastSeenAt))
  }
  return files
}

/** Waits for a queue's run to end (idle or paused). */
function settled(queue: ReturnType<typeof useImportQueue>): Promise<void> {
  return new Promise((resolve) => {
    const stop = watch(
      () => queue.state,
      (state) => {
        if (state === 'idle' || state === 'paused') {
          stop()
          resolve()
        }
      },
      { immediate: true },
    )
  })
}

export interface ConvertProgress {
  done: number
  total: number
  step: 'snapshots' | 'plan' | 'wishes'
}

export interface ConvertResult {
  snapshots: { created: number; unchanged: number; failed: number }
  /** Pulls sent (0 when the guest had none). */
  pulls: number
  /** The plan's hand edits were skipped: the account's newest capture isn't the guest's. */
  editsSkipped: boolean
}

/** Brings the guest's data into account `accountId`. */
export async function convertGuest(
  accountId: number,
  onProgress: (progress: ConvertProgress) => void = () => {},
  store: LocalStore = guestStore(),
): Promise<ConvertResult> {
  await store.ready()
  const files = await guestFiles(store)
  const queue = useImportQueue(accountId)
  const result: ConvertResult = {
    snapshots: { created: 0, unchanged: 0, failed: 0 },
    pulls: 0,
    editsSkipped: false,
  }
  for (let i = 0; i < files.length; i += MAX_IMPORT_FILES) {
    clearFinished(queue)
    addFiles(queue, files.slice(i, i + MAX_IMPORT_FILES))
    const stop = watch(
      () => summarize(queue).done,
      (done) => onProgress({ done: i + done, total: files.length, step: 'snapshots' }),
      { immediate: true },
    )
    start(queue)
    await settled(queue)
    stop()
    const s = summarize(queue)
    result.snapshots.created += s.created
    result.snapshots.unchanged += s.unchanged
    result.snapshots.failed += s.failed
    // A quota or a pause: what is left stays in the queue for the Import page.
    if (queue.state === 'paused') break
  }

  onProgress({ done: files.length, total: files.length, step: 'plan' })
  const [achievements, anecdotes, quests, targets, tasks, state] = await Promise.all([
    api.achievementMarks(GUEST_ACCOUNT_ID),
    api.anecdoteMarks(GUEST_ACCOUNT_ID),
    api.questMarks(GUEST_ACCOUNT_ID),
    api.plannerTargets(GUEST_ACCOUNT_ID),
    api.plannerTasks(GUEST_ACCOUNT_ID),
    api.plannerState(GUEST_ACCOUNT_ID),
  ])
  // Settings as the guest set them (the defaults are the account's already).
  const ownSettings = (store.state.get('settings') as AccountSettingsResponse | undefined)?.settings
  if (ownSettings && Object.keys(ownSettings).length > 0) {
    await api.updateAccountSettings(accountId, ownSettings as never)
  }
  if (achievements.done.length > 0) {
    await api.updateAchievementMarks(accountId, { done: achievements.done })
  }
  if (anecdotes.done.length > 0) {
    await api.updateAnecdoteMarks(accountId, { done: anecdotes.done })
  }
  if (quests.done.length > 0) await api.updateQuestMarks(accountId, { done: quests.done })
  await sendPlan(accountId, targets, tasks, state, result)

  const pulls = storedPulls(store)
  if (pulls.size > 0) {
    onProgress({ done: files.length, total: files.length, step: 'wishes' })
    result.pulls = await sendWishes(accountId, store, pulls)
  }
  return result
}

async function sendPlan(
  accountId: number,
  targets: PlannerTargetsResponse,
  tasks: PlannerTasksResponse,
  state: PlannerStateResponse,
  result: ConvertResult,
): Promise<void> {
  if (targets.targets.length > 0) {
    await api.updatePlannerTargets(accountId, {
      upsert: targets.targets.map((t) =>
        t.kind === 'weapon'
          ? { kind: 'weapon', id: t.id, key: t.key, owner: t.owner, target: t.target }
          : { kind: t.kind, key: t.key, target: t.target },
      ) as never,
    })
  }
  if (tasks.tasks.length > 0) {
    await api.updatePlannerTasks(accountId, {
      upsert: tasks.tasks.map(({ updatedAt: _at, ...task }) => task) as never,
    })
  }
  const edits = state.adjustments.filter((a) => a.base === state.capturedAt)
  if (edits.length === 0 && state.overrides.length === 0) return
  // Hand edits count against the capture they were made on: only when the
  // account's newest capture is the guest's (it is, after a full replay).
  const there = await api.plannerState(accountId)
  if (there.capturedAt === null || there.capturedAt !== state.capturedAt) {
    result.editsSkipped = true
    return
  }
  await api.updatePlannerState(accountId, {
    base: there.capturedAt,
    inventory: edits.map((a) =>
      a.set !== null ? { key: a.key, set: a.set, add: a.delta } : { key: a.key, add: a.delta },
    ),
    current: state.overrides.map((o) =>
      o.kind === 'weapon'
        ? { kind: 'weapon', id: o.id, key: o.key, owner: o.owner, current: o.current }
        : { kind: o.kind, key: o.key, owner: '', current: o.current },
    ) as never,
  })
}

/** The wish history as UIGF records (synthetic ids kept), merged like any import. */
async function sendWishes(
  accountId: number,
  store: LocalStore,
  pulls: Map<UigfGachaType, WishPull[]>,
): Promise<number> {
  const uid = store.account?.uid ?? '0'
  const stored = store.state.get('wishes') as { timezone?: number } | undefined
  const timezone = stored?.timezone ?? serverTimezone(store.account?.server)
  const all = [...pulls.values()].flat()
  const file = parseUigf(
    buildUigf([{ uid, timezone, pulls: all }], { name: 'Teyvat.me', version: 'guest' }) as Record<
      string,
      unknown
    >,
  )
  const records = file.accounts[0]?.records ?? []
  // The site's import takes the history in parts (its body limit).
  const PART = 5000
  for (let i = 0; i < records.length; i += PART) {
    await api.importWishes(accountId, {
      ...(/^\d{9,10}$/.test(uid) ? { uid } : {}),
      timezone,
      records: records.slice(i, i + PART),
    })
  }
  return records.length
}
