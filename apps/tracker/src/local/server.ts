/**
 * The guest account's API, answered in the browser (docs/plans/open-site.md
 * §4). api/http.ts hands every `/api/accounts/-1/…` request here instead of
 * the network, so the pages, the import queue and the export worker talk to
 * the guest account exactly as to one on the server: the same paths, bodies
 * (validated by the same schemas), answers and error codes. Nothing reaches
 * the Worker; what only a server can do answers 403 `guest_needs_account`.
 */

import {
  ACCOUNT_SETTINGS_DEFAULTS,
  accountInput,
  accountSettingsPatch,
  achievementMarksPatch,
  anecdoteMarksPatch,
  compactPlan,
  compactRequest,
  deepMerge,
  plannerStatePatch,
  plannerTargetsPatch,
  plannerTasksPatch,
  questMarksPatch,
  snapshotIdsRequest,
  wishSiteImportRequest,
  SLOTS,
  type AccountSettingsResponse,
  type CompactResponse,
  type KeyDictionary,
  type PlannerStateResponse,
  type Slot,
} from '@gdt/shared'
import type { z } from 'zod'
import {
  demoMarks,
  demoSettings,
  demoState,
  demoTargets,
  demoTasks,
  type StateHolder,
} from '@/api/demo-store'
import { ApiRequestError } from '@/api/error'
import { GUEST_ACCOUNT_ID } from './guest-id'
import { LocalApiError, needsAccount } from './errors'
import { importLocal } from './local-import'
import {
  accountResponse,
  buildBundle,
  buildGood,
  catalogRows,
  listSnapshots,
  unusedBlobs,
} from './local-read'
import { guestStore, type LocalStore } from './local-store'
import { deleteWishesLocal, importWishesLocal, wishHistory } from './local-wishes'

export interface LocalRequest {
  method?: string
  headers?: HeadersInit
  /** A JSON body (http.ts `json`). */
  json?: unknown
  body?: BodyInit | null
}

/** What a resource is before its first change. */
function initial(store: LocalStore, rest: string): unknown {
  switch (rest) {
    case 'settings':
      return { settings: {} }
    case 'achievement-marks':
    case 'anecdote-marks':
    case 'quest-marks':
      return { done: [] }
    case 'planner-targets':
      return { targets: [] }
    case 'planner-state':
      return { capturedAt: capturedAt(store), adjustments: [], overrides: [] }
    case 'planner-tasks':
      return { tasks: [] }
    default:
      throw new Error(`No local resource ${rest}`)
  }
}

/** The planner's capture time: the newest snapshot's last sighting. */
function capturedAt(store: LocalStore): number | null {
  return store.latest()?.lastSeenAt ?? null
}

/** Settings are kept as set (the patches merged), read over the defaults like the server's. */
function present(store: LocalStore, rest: string, value: unknown): unknown {
  if (rest === 'settings') {
    return {
      settings: deepMerge(
        ACCOUNT_SETTINGS_DEFAULTS,
        (value as AccountSettingsResponse).settings ?? {},
      ),
    }
  }
  if (rest === 'planner-state') {
    return { ...(value as PlannerStateResponse), capturedAt: capturedAt(store) }
  }
  return value
}

/**
 * Time travel (docs/plans/time-travel.md §8): the server keeps every version
 * of goals and marks (progress_history); the guest store keeps each version
 * of these resources whole, under `history:<rest>` as `{at, value}` oldest
 * first (changes within a minute fold into one). Recording begins the first
 * time a guest with data opens this build (`history.since`, seeded with
 * what there was), like migration 0038 on the server.
 */
const WITH_HISTORY = new Set([
  'achievement-marks',
  'anecdote-marks',
  'quest-marks',
  'planner-targets',
  'planner-state',
])
const SINCE_KEY = 'history.since'
const FOLD_MS = 60_000
const historyKey = (rest: string) => `history:${rest}`

interface Version {
  at: number
  value: unknown
}

/** Starts the history for a guest who has data and none yet. */
async function startHistory(store: LocalStore): Promise<void> {
  if (store.state.has(SINCE_KEY) || !store.hasData()) return
  await store.transact((tx) => {
    if (store.state.has(SINCE_KEY)) return
    const now = Date.now()
    tx.setState(SINCE_KEY, now)
    for (const rest of WITH_HISTORY) {
      const value = store.state.get(rest)
      if (value !== undefined) tx.setState(historyKey(rest), [{ at: now, value }])
    }
  })
}

/** `rest` as it was at `at`, answered like the server's `?at=`. */
function readAt(store: LocalStore, rest: string, at: number): unknown {
  const since = (store.state.get(SINCE_KEY) as number | undefined) ?? null
  const recorded = since !== null && at >= since
  let value = initial(store, rest)
  if (recorded) {
    for (const version of (store.state.get(historyKey(rest)) ?? []) as Version[]) {
      if (version.at <= at) value = version.value
    }
  }
  const history = { since, recorded }
  if (rest === 'planner-state') {
    // Material edits follow the newest capture: the past has none.
    const overrides = recorded ? ((value as PlannerStateResponse).overrides ?? []) : []
    return { capturedAt: null, adjustments: [], overrides, history }
  }
  if (rest === 'planner-targets') {
    return { targets: recorded ? ((value as { targets?: unknown[] }).targets ?? []) : [], history }
  }
  return { done: recorded ? ((value as { done?: number[] }).done ?? []) : [], history }
}

/** The demo-store emulation's resources, kept in the guest store. */
export function guestHolder(store: LocalStore): StateHolder {
  const current = (rest: string) => store.state.get(rest) ?? initial(store, rest)
  return {
    async read<T>(rest: string): Promise<T> {
      await store.ready()
      return structuredClone(present(store, rest, current(rest))) as T
    },
    async change<T>(rest: string, apply: (value: T) => T | Promise<T>): Promise<T> {
      const next = await store.transact(async (tx) => {
        // Settings are changed as stored (the patches merged, no defaults), as the server keeps them.
        const before = rest === 'settings' ? current(rest) : present(store, rest, current(rest))
        const value = await apply(structuredClone(before) as T)
        tx.setState(rest, value)
        if (WITH_HISTORY.has(rest)) {
          const now = Date.now()
          if (!store.state.has(SINCE_KEY)) tx.setState(SINCE_KEY, now)
          const list = [...((store.state.get(historyKey(rest)) ?? []) as Version[])]
          const last = list.at(-1)
          if (last && now - last.at < FOLD_MS) list[list.length - 1] = { at: last.at, value }
          else list.push({ at: now, value })
          tx.setState(historyKey(rest), list)
        }
        return value
      })
      return structuredClone(present(store, rest, next)) as T
    },
    async capturedAt() {
      await store.ready()
      return capturedAt(store)
    },
  }
}

function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value)
  if (!result.success) throw new LocalApiError(400, 'invalid_request', 'Invalid request')
  return result.data
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

async function bodyText(request: LocalRequest): Promise<string> {
  if (request.json !== undefined) return JSON.stringify(request.json)
  const body = request.body
  if (body === null || body === undefined) return ''
  const headers = new Headers(request.headers)
  let response = new Response(body)
  if (headers.get('content-encoding') === 'gzip' && response.body) {
    response = new Response(response.body.pipeThrough(new DecompressionStream('gzip')))
  }
  return response.text()
}

async function bodyJson(request: LocalRequest): Promise<unknown> {
  if (request.json !== undefined) return request.json
  const text = await bodyText(request)
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    throw new LocalApiError(400, 'invalid_json', 'The body is not valid JSON')
  }
}

let materials: Promise<KeyDictionary> | null = null
const materialsDictionary = () =>
  (materials ??= import('@gdt/shared/dictionary/materials').then((m) => m.MATERIALS))

/** Deletes snapshots and every section only they used. */
function deleteSnapshots(store: LocalStore, ids: readonly number[]): Promise<number> {
  return store.transact((tx) => {
    let deleted = 0
    for (const id of ids) {
      if (!store.snapshots.has(id)) continue
      tx.deleteSnapshot(id)
      deleted++
    }
    if (deleted === 0) return 0
    for (const blob of unusedBlobs(store)) tx.deleteBlob(blob)
    tx.bumpVersion()
    return deleted
  })
}

const MARKS = {
  'achievement-marks': achievementMarksPatch,
  'anecdote-marks': anecdoteMarksPatch,
  'quest-marks': questMarksPatch,
} as const

/** Answers one guest request. */
export async function handleLocal(
  path: string,
  request: LocalRequest,
  store: LocalStore = guestStore(),
): Promise<Response> {
  const url = new URL(path, 'http://local')
  const prefix = `/api/accounts/${GUEST_ACCOUNT_ID}`
  const rest = url.pathname.slice(prefix.length).replace(/^\//, '')
  const method = (request.method ?? 'GET').toUpperCase()
  const holder = guestHolder(store)
  await store.ready()
  await startHistory(store)
  // Time travel: goals and marks as they were.
  const at = url.searchParams.get('at')
  if (at !== null && method === 'GET' && WITH_HISTORY.has(rest)) {
    if (!/^\d{1,15}$/.test(at)) throw new LocalApiError(400, 'bad_at', 'at must be a time in ms')
    return json(readAt(store, rest, Number(at)))
  }

  // The account itself.
  if (rest === '' || rest === 'announce') {
    if (method === 'GET' || (rest === 'announce' && method === 'POST')) {
      return json(accountResponse(store))
    }
    if (method === 'PATCH') {
      const body = parse(accountInput, await bodyJson(request))
      await store.transact((tx) => {
        const account = tx.account()
        if (body.name !== undefined) account.name = body.name
        if (body.uid !== undefined) account.uid = body.uid
        if (body.server !== undefined) account.server = body.server
        tx.saveAccount()
      })
      return json(accountResponse(store))
    }
    if (method === 'DELETE') {
      await store.clear()
      return new Response(null, { status: 204 })
    }
  }

  if (rest === 'settings') {
    if (method === 'GET') return json(await holder.read('settings'))
    if (method === 'PATCH') {
      return json(await demoSettings(parse(accountSettingsPatch, await bodyJson(request)), holder))
    }
  }

  if (rest in MARKS) {
    const name = rest as keyof typeof MARKS
    if (method === 'GET') return json(await holder.read(name))
    if (method === 'PATCH') {
      return json(await demoMarks(name, parse(MARKS[name], await bodyJson(request)), holder))
    }
  }

  if (rest === 'planner-targets') {
    if (method === 'GET') return json(await holder.read(rest))
    if (method === 'PATCH') {
      return json(await demoTargets(parse(plannerTargetsPatch, await bodyJson(request)), holder))
    }
  }
  if (rest === 'planner-state') {
    if (method === 'GET') return json(await holder.read(rest))
    if (method === 'PATCH') {
      return json(await demoState(parse(plannerStatePatch, await bodyJson(request)), holder))
    }
  }
  if (rest === 'planner-tasks') {
    if (method === 'GET') return json(await holder.read(rest))
    if (method === 'PATCH') {
      return json(await demoTasks(parse(plannerTasksPatch, await bodyJson(request)), holder))
    }
  }

  if (rest === 'import' && method === 'POST') {
    const text = await bodyText(request)
    const timestamp = url.searchParams.get('timestamp') ?? undefined
    const answer = await importLocal(store, {
      text,
      rawSize: new TextEncoder().encode(text).length,
      timestamp: timestamp === undefined ? undefined : Number(timestamp),
    })
    requestPersistence()
    return json(answer)
  }

  if (rest === 'snapshots' && method === 'GET') return json(listSnapshots(store))
  if (rest === 'snapshots/delete' && method === 'POST') {
    const { ids } = parse(snapshotIdsRequest, await bodyJson(request))
    return json({ deleted: await deleteSnapshots(store, ids) })
  }
  if (rest === 'snapshots/compact' && method === 'POST') {
    const body = parse(compactRequest, await bodyJson(request))
    const rows = [...store.snapshots.values()].map((row) => ({ id: row.id, takenAt: row.takenAt }))
    const plan = compactPlan(rows, {
      keep: body.keep,
      offsetMinutes: body.offsetMinutes,
      before: body.before ?? null,
    })
    if (body.dryRun || plan.removed.length === 0) {
      return json({
        kept: rows.length - (body.dryRun ? plan.removed.length : 0),
        removed: body.dryRun ? plan.removed.length : 0,
        dryRun: body.dryRun === true,
      } satisfies CompactResponse)
    }
    const removed = await deleteSnapshots(store, plan.removed)
    return json({ kept: rows.length - removed, removed, dryRun: false } satisfies CompactResponse)
  }
  const one = /^snapshots\/(\d+)$/.exec(rest)
  if (one && method === 'DELETE') {
    if ((await deleteSnapshots(store, [Number(one[1])])) === 0) {
      throw new LocalApiError(404, 'not_found', 'Snapshot not found')
    }
    return new Response(null, { status: 204 })
  }

  if (rest === 'catalog' && method === 'GET') return json(catalogRows(store))
  if (rest === 'bundle' && method === 'GET') {
    const ids = url.searchParams.get('ids')
    const sections = url.searchParams.get('sections')
    const wanted = sections
      ? new Set(
          sections.split(',').filter((s): s is Slot => (SLOTS as readonly string[]).includes(s)),
        )
      : new Set<Slot>(SLOTS)
    const bytes = buildBundle(
      store,
      ids ? ids.split(',').map(Number).filter(Number.isSafeInteger) : null,
      wanted,
    )
    return new Response(bytes, {
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(bytes.length),
      },
    })
  }
  const good = /^snapshots\/(\d+)\/good$/.exec(rest)
  if ((good || rest === 'latest/good') && method === 'GET') {
    const built = await buildGood(
      store,
      good ? Number(good[1]) : 'latest',
      await materialsDictionary(),
    )
    return json(built.good)
  }

  if (rest === 'wishes') {
    if (method === 'GET') return json(wishHistory(store))
    if (method === 'DELETE') return json(await deleteWishesLocal(store))
  }
  if (rest === 'wishes/import' && method === 'POST') {
    const body = parse(wishSiteImportRequest, await bodyJson(request))
    return json(await importWishesLocal(store, body))
  }

  // Nothing to time alerts with in a browser: accepted, never sent.
  if (rest === 'alert-facts' && method === 'POST') return json({ ok: true, alerts: false })

  // Capture presence, commands, sharing, keys, live sync: the server's alone.
  throw needsAccount()
}

/** The guest's data is worth keeping: ask the browser not to evict it (once a tab). */
let persistenceAsked = false
function requestPersistence() {
  if (persistenceAsked) return
  persistenceAsked = true
  try {
    void navigator.storage?.persist?.().catch(() => undefined)
  } catch {
    // Not offered: the data still stays unless the browser runs out of room.
  }
}

/** handleLocal, with errors as the Worker's error answers (what http.ts reads). */
export async function localFetch(path: string, request: LocalRequest): Promise<Response> {
  try {
    return await handleLocal(path, request)
  } catch (error) {
    if (error instanceof LocalApiError || error instanceof ApiRequestError) {
      return json({ error: { code: error.code, message: error.message } }, error.status)
    }
    console.error('guest store', error)
    return json(
      { error: { code: 'guest_store_failed', message: 'This browser could not read or save it' } },
      500,
    )
  }
}
