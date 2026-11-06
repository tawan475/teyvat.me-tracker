/**
 * The demo account's state for this tab (docs/plans/open-site.md §2, "State
 * in memory only"): its planner goals, hand edits, tasks, marks and settings
 * start as `/api/demo` serves them, and every change a visitor makes is
 * applied here the way the server's routes apply it (worker/routes/progress.ts,
 * accounts.ts `PATCH /:id/settings`), answering what they would answer. So
 * the pages react as on a real account, and nothing is sent: leaving or
 * reloading the page drops it all.
 */

import type {
  AccountSettingsPatch,
  AccountSettingsResponse,
  CurrentOverride,
  InventoryAdjustment,
  PlannerStateResponse,
  PlannerTarget,
  PlannerTargetsResponse,
  PlannerTask,
  PlannerTasksResponse,
  plannerStatePatch,
  plannerTargetsPatch,
  plannerTasksPatch,
} from '@gdt/shared'
import { deepMerge } from '@gdt/shared/settings'
import type { z } from 'zod'
import { ApiRequestError } from './error'

/**
 * One /api/demo read: public, no cookie and no session to refresh, so a
 * plain fetch (not http.ts, which this module stays clear of: its tests run
 * in workerd).
 */
async function served(rest: string): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(`/api/demo/${rest}`)
  } catch {
    throw new ApiRequestError(0, 'network', 'Could not reach the server. Check your connection.')
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string }
    }
    throw new ApiRequestError(
      response.status,
      body.error?.code ?? `http_${response.status}`,
      body.error?.message ?? 'Request failed',
    )
  }
  return response.json()
}

/** What the tab holds, by `/api/demo/<rest>`. */
const held = new Map<string, unknown>()
const loading = new Map<string, Promise<unknown>>()

const copy = <T>(value: T): T => structuredClone(value)

/** Forgets every change (a demo account rebuilt under the tab starts clean). */
export function resetDemoState(): void {
  held.clear()
  loading.clear()
}

/** A resource as the tab has it: the server's until the first change. */
export async function demoRead<T>(rest: string): Promise<T> {
  if (!held.has(rest)) {
    let pending = loading.get(rest)
    if (!pending) {
      pending = served(rest).then((value) => {
        if (!held.has(rest)) held.set(rest, value)
        return value
      })
      pending.catch(() => loading.delete(rest))
      loading.set(rest, pending)
    }
    await pending
  }
  return copy(held.get(rest) as T)
}

async function change<T>(rest: string, apply: (current: T) => T | Promise<T>): Promise<T> {
  const next = await apply(await demoRead<T>(rest))
  held.set(rest, next)
  return copy(next)
}

// ------------------------------------------------------------------ settings

export function demoSettings(patch: AccountSettingsPatch): Promise<AccountSettingsResponse> {
  // Live sync has no switch (the server ignores one too).
  const { liveSync: _ignored, ...rest } = patch as AccountSettingsPatch & { liveSync?: unknown }
  return change<AccountSettingsResponse>('settings', (current) => ({
    settings: deepMerge(current.settings, rest),
  }))
}

// --------------------------------------------------------------------- marks

/** `done` before `undone`, so an id in both ends up unmarked; the full list back. */
export function demoMarks(
  rest: 'achievement-marks' | 'anecdote-marks' | 'quest-marks',
  body: { done?: number[]; undone?: number[] },
): Promise<{ done: number[] }> {
  return change<{ done: number[] }>(rest, (current) => {
    const done = new Set(current.done)
    for (const id of body.done ?? []) done.add(id)
    for (const id of body.undone ?? []) done.delete(id)
    return { done: [...done].sort((a, b) => a - b) }
  })
}

// ------------------------------------------------------------------- planner

type TargetsPatch = z.input<typeof plannerTargetsPatch>
type StatePatch = z.input<typeof plannerStatePatch>
type TasksPatch = z.input<typeof plannerTasksPatch>

/** A weapon goal's id, as the server makes one (12 hex digits). */
function goalId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Goals by kind and key; weapon goals in the order they were made (the server's order). */
function sortTargets(list: PlannerTarget[]): PlannerTarget[] {
  return list
    .map((target, index) => ({ target, index }))
    .sort((a, b) => {
      const kind = a.target.kind.localeCompare(b.target.kind)
      if (kind !== 0) return kind
      if (a.target.kind === 'weapon') return a.index - b.index
      return a.target.key.localeCompare(b.target.key)
    })
    .map((entry) => entry.target)
}

/** Overrides whose goal is gone, or whose weapon goal changed weapon, are dropped (as the rows are). */
function keepOverrides(
  state: PlannerStateResponse,
  targets: PlannerTarget[],
): PlannerStateResponse {
  const overrides = state.overrides.filter((o) =>
    targets.some((t) =>
      o.kind === 'weapon'
        ? t.kind === 'weapon' && (o.id ? t.id === o.id : t.key === o.key && t.owner === o.owner)
        : t.kind === o.kind && t.key === o.key,
    ),
  )
  return { ...state, overrides }
}

export async function demoTargets(body: TargetsPatch): Promise<PlannerTargetsResponse> {
  const now = Date.now()
  const moved = new Set<string>()
  const answer = await change<PlannerTargetsResponse>('planner-targets', ({ targets }) => {
    let list = [...targets]
    for (const ref of body.remove ?? []) {
      list = list.filter((t) =>
        ref.kind === 'weapon'
          ? !(
              t.kind === 'weapon' &&
              (ref.id ? t.id === ref.id : t.key === ref.key && t.owner === ref.owner)
            )
          : !(t.kind === ref.kind && t.key === ref.key),
      )
    }
    for (const input of body.upsert ?? []) {
      if (input.kind === 'weapon') {
        const id =
          input.id ??
          list.find(
            (t): t is Extract<PlannerTarget, { kind: 'weapon' }> =>
              t.kind === 'weapon' && t.key === input.key && t.owner === input.owner,
          )?.id ??
          goalId()
        const index = list.findIndex((t) => t.kind === 'weapon' && t.id === id)
        const row = {
          kind: 'weapon',
          id,
          key: input.key,
          owner: input.owner,
          target: { active: true, ...input.target },
          updatedAt: now,
        } as PlannerTarget
        if (index >= 0) {
          if (list[index]!.key !== input.key) moved.add(id)
          list[index] = row
        } else list.push(row)
      } else {
        const index = list.findIndex((t) => t.kind === input.kind && t.key === input.key)
        const row = {
          kind: input.kind,
          key: input.key,
          owner: '',
          target: { active: true, ...input.target },
          updatedAt: now,
        } as PlannerTarget
        if (index >= 0) list[index] = row
        else list.push(row)
      }
    }
    return { targets: sortTargets(list) }
  })
  if (held.has('planner-state')) {
    const state = held.get('planner-state') as PlannerStateResponse
    const kept = keepOverrides(state, answer.targets)
    held.set('planner-state', {
      ...kept,
      overrides: kept.overrides.filter((o) => !(o.kind === 'weapon' && o.id && moved.has(o.id))),
    })
  }
  return answer
}

const MAX_DELTA = 1_000_000_000_000

export async function demoState(body: StatePatch): Promise<PlannerStateResponse> {
  const now = Date.now()
  const { targets } = await demoRead<PlannerTargetsResponse>('planner-targets')
  return change<PlannerStateResponse>('planner-state', (state) => {
    const adjustments = new Map<string, InventoryAdjustment>(
      state.adjustments.map((a) => [a.key, a]),
    )
    for (const edit of body.inventory ?? []) {
      const before = adjustments.get(edit.key)
      adjustments.set(
        edit.key,
        edit.set !== undefined
          ? {
              key: edit.key,
              delta: edit.add ?? 0,
              set: edit.set ?? null,
              base: body.base,
              updatedAt: now,
            }
          : {
              key: edit.key,
              delta: Math.max(
                -MAX_DELTA,
                Math.min(MAX_DELTA, (before?.delta ?? 0) + (edit.add ?? 0)),
              ),
              set: before?.set ?? null,
              base: body.base,
              updatedAt: now,
            },
      )
    }
    // An edit that adds up to nothing is no edit.
    const kept = [...adjustments.values()]
      .filter((a) => !(a.set === null && a.delta === 0))
      .sort((a, b) => a.key.localeCompare(b.key))

    let overrides = [...state.overrides]
    for (const edit of body.current ?? []) {
      // Goals only: an override for a goal not set has nothing to land on.
      const goals = targets.filter((t) =>
        edit.kind === 'weapon'
          ? t.kind === 'weapon' &&
            (edit.id ? t.id === edit.id : t.key === edit.key && t.owner === edit.owner)
          : t.kind === edit.kind && t.key === edit.key,
      )
      for (const goal of goals) {
        const same = (o: CurrentOverride) =>
          o.kind === goal.kind &&
          o.key === goal.key &&
          (goal.kind !== 'weapon' || (o.kind === 'weapon' && o.id === goal.id))
        overrides = overrides.filter((o) => !same(o))
        if (edit.current) {
          overrides.push(
            (goal.kind === 'weapon'
              ? {
                  kind: 'weapon',
                  id: goal.id,
                  key: goal.key,
                  owner: goal.owner,
                  current: edit.current,
                }
              : {
                  kind: goal.kind,
                  key: goal.key,
                  owner: '',
                  current: edit.current,
                }) as CurrentOverride,
          )
        }
      }
    }
    return { capturedAt: state.capturedAt, adjustments: kept, overrides }
  })
}

/** `remove` before `upsert`; built-in tasks first, custom ones by position, then as made. */
export function demoTasks(body: TasksPatch): Promise<PlannerTasksResponse> {
  const now = Date.now()
  return change<PlannerTasksResponse>('planner-tasks', ({ tasks }) => {
    const list = tasks.filter(
      (t) => !(body.remove ?? []).some((ref) => ref.kind === t.kind && ref.id === t.id),
    )
    for (const input of body.upsert ?? []) {
      const { kind, id, ...data } = input
      const row = { ...data, kind, id, updatedAt: now } as PlannerTask
      const index = list.findIndex((t) => t.kind === kind && t.id === id)
      if (index >= 0) list[index] = row
      else list.push(row)
    }
    const position = (t: PlannerTask) =>
      'position' in t && typeof t.position === 'number' ? t.position : 1_000_000
    return {
      tasks: list
        .map((task, index) => ({ task, index }))
        .sort(
          (a, b) =>
            a.task.kind.localeCompare(b.task.kind) ||
            position(a.task) - position(b.task) ||
            a.index - b.index,
        )
        .map((entry) => entry.task),
    }
  })
}
