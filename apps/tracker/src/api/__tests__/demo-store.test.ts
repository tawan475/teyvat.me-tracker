import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  demoMarks,
  demoRead,
  demoSettings,
  demoState,
  demoTargets,
  demoTasks,
  resetDemoState,
} from '../demo-store'
import { accountPath, accountRead, accountWrite, isDemoAccount, setDemoAccount } from '../inspect'

/** What /api/demo serves (the seeded account), by path. */
const SERVED: Record<string, unknown> = {
  '/api/demo/settings': {
    settings: { traveler: 'F', favoriteCharacters: [], planner: { gems: true } },
  },
  '/api/demo/achievement-marks': { done: [5, 9] },
  '/api/demo/planner-targets': {
    targets: [
      {
        kind: 'character',
        key: 'Furina',
        owner: '',
        target: { level: 90, ascension: 6, talents: { auto: 9, skill: 9, burst: 9 }, active: true },
        updatedAt: 1,
      },
      {
        kind: 'weapon',
        id: 'demosplendor',
        key: 'SplendorOfTranquilWaters',
        owner: 'Furina',
        target: { level: 90, ascension: 6, refinement: 1, active: true },
        updatedAt: 1,
      },
    ],
  },
  '/api/demo/planner-state': { capturedAt: 1_000, adjustments: [], overrides: [] },
  '/api/demo/planner-tasks': { tasks: [] },
}

const fetched: { url: string; method: string }[] = []

beforeEach(() => {
  resetDemoState()
  fetched.length = 0
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    fetched.push({ url, method: init.method ?? 'GET' })
    const body = SERVED[url]
    return body === undefined
      ? new Response('{}', { status: 404 })
      : new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  setDemoAccount(null)
})

describe('the demo account in the API layer', () => {
  it("routes the demo account's reads to /api/demo and keeps its writes in the tab", async () => {
    setDemoAccount(221)
    expect(isDemoAccount(221)).toBe(true)
    expect(isDemoAccount(7)).toBe(false)
    expect(accountPath(221, 'snapshots')).toBe('/api/demo/snapshots')
    expect(accountRead(221, 'catalog')).toBe('/api/demo/catalog')
    expect(accountPath(7, 'snapshots')).toBe('/api/accounts/7/snapshots')

    const sent = vi.fn(async () => 'sent')
    expect(await accountWrite(221, sent, async () => 'kept')).toBe('kept')
    expect(sent).not.toHaveBeenCalled()
    // A write with no tab-side version (an upload, a deletion) is refused, never sent.
    await expect(accountWrite(221, sent)).rejects.toMatchObject({ code: 'demo_read_only' })
    expect(sent).not.toHaveBeenCalled()
    expect(await accountWrite(7, sent)).toBe('sent')
  })
})

describe('the demo store', () => {
  it('reads once, then answers from the tab; nothing is ever sent', async () => {
    await demoRead('achievement-marks')
    expect(await demoMarks('achievement-marks', { done: [3, 9], undone: [5] })).toEqual({
      done: [3, 9],
    })
    expect(await demoRead('achievement-marks')).toEqual({ done: [3, 9] })
    expect(fetched).toEqual([{ url: '/api/demo/achievement-marks', method: 'GET' }])
  })

  it('applies `done` before `undone`, as the server does', async () => {
    expect(await demoMarks('achievement-marks', { done: [12], undone: [12] })).toEqual({
      done: [5, 9],
    })
  })

  it('merges settings like the server (arrays replace, objects merge)', async () => {
    const { settings } = await demoSettings({
      favoriteCharacters: ['Furina'],
      planner: { solvent: false },
    } as never)
    expect(settings).toMatchObject({
      traveler: 'F',
      favoriteCharacters: ['Furina'],
      planner: { gems: true, solvent: false },
    })
  })

  it('upserts and removes goals, a weapon goal by its id, in the server order', async () => {
    const { targets } = await demoTargets({
      upsert: [
        {
          kind: 'character',
          key: 'Bennett',
          target: { level: 90, ascension: 6, talents: { auto: 1, skill: 9, burst: 9 } },
        },
        {
          kind: 'weapon',
          key: 'FavoniusSword',
          owner: 'Bennett',
          target: { level: 90, ascension: 6, refinement: 5 },
        },
      ],
      remove: [
        { kind: 'weapon', key: 'SplendorOfTranquilWaters', owner: 'Furina', id: 'demosplendor' },
      ],
    })
    expect(targets.map((t) => `${t.kind}:${t.key}`)).toEqual([
      'character:Bennett',
      'character:Furina',
      'weapon:FavoniusSword',
    ])
    const weapon = targets.find((t) => t.kind === 'weapon')!
    expect(weapon.kind === 'weapon' && /^[0-9a-f]{12}$/.test(weapon.id)).toBe(true)
    expect(weapon.target).toMatchObject({ active: true })
  })

  it('keeps hand edits: a set count, added amounts, an override that goes with its goal', async () => {
    let state = await demoState({
      base: 1_000,
      inventory: [
        { key: 'Mora', set: 500_000 },
        { key: 'HerosWit', add: -10 },
      ],
      current: [
        {
          kind: 'character',
          key: 'Furina',
          current: { level: 80, ascension: 6, talents: { auto: 6, skill: 6, burst: 6 } },
        },
        // No goal for Bennett: nothing to land on.
        {
          kind: 'character',
          key: 'Bennett',
          current: { level: 80, ascension: 6, talents: { auto: 6, skill: 6, burst: 6 } },
        },
      ],
    })
    expect(state.adjustments.map((a) => [a.key, a.delta, a.set])).toEqual([
      ['HerosWit', -10, null],
      ['Mora', 0, 500_000],
    ])
    expect(state.overrides.map((o) => o.key)).toEqual(['Furina'])

    // Adding up to nothing drops the edit.
    state = await demoState({ base: 1_000, inventory: [{ key: 'HerosWit', add: 10 }] })
    expect(state.adjustments.map((a) => a.key)).toEqual(['Mora'])

    // Removing the goal drops its override.
    await demoTargets({ remove: [{ kind: 'character', key: 'Furina' }] })
    expect((await demoRead<{ overrides: unknown[] }>('planner-state')).overrides).toEqual([])
  })

  it('keeps tasks: built-in first, custom ones by position', async () => {
    const { tasks } = await demoTasks({
      upsert: [
        {
          kind: 'custom',
          id: 'second',
          task: { name: 'B', every: 1, mode: 'original' },
          due: '2026-11-06',
          position: 2,
        },
        {
          kind: 'custom',
          id: 'firstone',
          task: { name: 'A', every: 1, mode: 'original' },
          due: '2026-11-06',
          position: 1,
        },
        { kind: 'builtin', id: 'commissions', next: 5 },
      ],
    })
    expect(tasks.map((t) => t.id)).toEqual(['commissions', 'firstone', 'second'])
    const after = await demoTasks({ remove: [{ kind: 'builtin', id: 'commissions' }] })
    expect(after.tasks.map((t) => t.id)).toEqual(['firstone', 'second'])
  })
})
