import type {
  AccountCreatedResponse,
  AccountSettingsResponse,
  LiveEvent,
  PlannerTasksResponse,
} from '@gdt/shared'
import { env } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { getDb } from '../db/client'
import { genshinAccounts, plannerTasks } from '../db/schema'
import { ORIGIN, liveMessage, signUp, type Client } from './client'

const db = getDb(env.DB)

async function setup() {
  const { client } = await signUp()
  const { account } = await client.json<AccountCreatedResponse>('/api/accounts', {
    method: 'POST',
    json: { name: 'Main', uid: '812345678', server: 'ASIA' },
  })
  const url = `/api/accounts/${account.id}/planner-tasks`
  const patch = (json: object, headers: Record<string, string> = {}) =>
    client.fetch(url, { method: 'PATCH', json, headers })
  const tasks = async () => (await client.json<PlannerTasksResponse>(url)).tasks
  return { client, account, url, patch, tasks }
}

const brief = (list: PlannerTasksResponse['tasks']) => list.map(({ updatedAt: _, ...task }) => task)

const laundry = {
  kind: 'custom',
  id: 'abc123def456',
  task: { name: 'Teapot coins', every: 2, mode: 'original' },
  due: '2026-10-06',
  position: 1,
}

/** Opens the live socket; `next` waits for the next event. */
async function listen(client: Client) {
  const response = await client.fetch('/api/live', {
    headers: { upgrade: 'websocket', origin: ORIGIN },
  })
  expect(response.status).toBe(101)
  const socket = response.webSocket!
  socket.accept()
  const messages: LiveEvent[] = []
  let wake: (() => void) | null = null
  socket.addEventListener('message', (event) => {
    messages.push(liveMessage(String(event.data)))
    wake?.()
  })
  const next = async () => {
    const until = Date.now() + 2000
    while (messages.length === 0 && Date.now() < until) {
      await new Promise<void>((resolve) => {
        wake = resolve
        setTimeout(resolve, 50)
      })
    }
    const message = messages.shift()
    if (!message) throw new Error('No live message')
    return message
  }
  expect((await next()).type).toBe('hello')
  return { socket, messages, next }
}

describe('planner tasks', () => {
  it('stores built-in and custom tasks whole, built-in first, custom by position', async () => {
    const { patch, tasks } = await setup()
    expect(await tasks()).toEqual([])

    const first = await patch({
      upsert: [
        { ...laundry, id: 'zzz999zzz999', task: { ...laundry.task, name: 'Second' }, position: 2 },
        laundry,
        { kind: 'builtin', id: 'abyss', next: 1_800_000_000_000 },
        { kind: 'builtin', id: 'battle-pass', hidden: true },
      ],
    })
    expect(first.status).toBe(200)
    const body = (await first.json()) as PlannerTasksResponse
    expect(brief(body.tasks)).toEqual([
      { kind: 'builtin', id: 'abyss', next: 1_800_000_000_000 },
      { kind: 'builtin', id: 'battle-pass', hidden: true },
      laundry,
      {
        ...laundry,
        id: 'zzz999zzz999',
        task: { ...laundry.task, name: 'Second' },
        position: 2,
      },
    ])
    expect(body.tasks.every((t) => typeof t.updatedAt === 'number')).toBe(true)

    // A row is written whole: fields left out are gone; removals go first.
    await patch({
      upsert: [{ kind: 'builtin', id: 'abyss' }],
      remove: [
        { kind: 'custom', id: 'zzz999zzz999' },
        { kind: 'builtin', id: 'battle-pass' },
      ],
    })
    expect(brief(await tasks())).toEqual([{ kind: 'builtin', id: 'abyss' }, laundry])

    // A Done and its Undo: the same row back and forth.
    await patch({ upsert: [{ ...laundry, due: '2026-10-08' }] })
    expect(brief(await tasks())[1]).toMatchObject({ due: '2026-10-08' })
    await patch({ upsert: [laundry] })
    expect(brief(await tasks())[1]).toEqual(laundry)
    // The file's first test also pays for workerd's start and a sign-up (Argon2id):
    // past the default 5 s on a busy machine.
  }, 20_000)

  it('refuses malformed tasks and other users', async () => {
    const { url, patch } = await setup()
    for (const bad of [
      {},
      { upsert: [], remove: [] },
      { upsert: [{ kind: 'builtin', id: 'Abyss' }] },
      { upsert: [{ kind: 'builtin', id: 'abyss', next: -1 }] },
      { upsert: [{ ...laundry, id: 'short' }] },
      { upsert: [{ ...laundry, due: '2026-13-01' }] },
      { upsert: [{ ...laundry, task: { ...laundry.task, every: 0 } }] },
      { upsert: [{ ...laundry, task: { ...laundry.task, every: 31 } }] },
      { upsert: [{ ...laundry, task: { ...laundry.task, mode: 'whenever' } }] },
      { upsert: [{ ...laundry, task: { ...laundry.task, name: '  ' } }] },
      { upsert: [{ ...laundry, task: { ...laundry.task, note: 'x'.repeat(1001) } }] },
      { upsert: [{ kind: 'event', id: 'banner' }] },
      { remove: [{ kind: 'custom', id: 'abyss' }] },
    ]) {
      expect((await patch(bad)).status, JSON.stringify(bad)).toBe(400)
    }

    const stranger = await signUp()
    expect((await stranger.client.fetch(url)).status).toBe(404)
    const sneaky = await stranger.client.fetch(url, {
      method: 'PATCH',
      json: { upsert: [laundry] },
    })
    expect(sneaky.status).toBe(404)
  })

  it("tells the user's open pages, naming the tab that wrote", async () => {
    const { client, account, patch } = await setup()
    const live = await listen(client)
    await patch({ upsert: [laundry] }, { 'x-gdt-tab': 'tab-2' })
    expect(await live.next()).toEqual<LiveEvent>({
      type: 'planner',
      accountId: account.id,
      tab: 'tab-2',
    })
    expect((await patch({ upsert: [{ kind: 'builtin', id: 'X' }] })).status).toBe(400)
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(live.messages).toEqual([])
    live.socket.close(1000)
  })
})

describe('account settings: hand-set resin and quick buttons', () => {
  it('stores them, merges with the defaults and tells open pages', async () => {
    const { client, account } = await setup()
    const url = `/api/accounts/${account.id}/settings`
    const before = await client.json<AccountSettingsResponse>(url)
    expect(before.settings.resin).toBeNull()
    expect(before.settings.planner.resinSteps).toEqual([-40, -20, 60, -30])
    expect(before.settings.planner.resinMarks).toEqual([40, 200])

    const live = await listen(client)
    const after = await client.json<AccountSettingsResponse>(url, {
      method: 'PATCH',
      json: {
        resin: { value: 120, at: 1_791_000_000_000 },
        planner: { resinSteps: [-20, -40], resinMarks: [20, 140] },
      },
      headers: { 'x-gdt-tab': 'tab-3' },
    })
    expect(after.settings.resin).toEqual({ value: 120, at: 1_791_000_000_000 })
    expect(after.settings.planner).toMatchObject({
      resinSteps: [-20, -40],
      resinMarks: [20, 140],
      refreshes: 0,
    })
    expect(await live.next()).toEqual<LiveEvent>({
      type: 'planner',
      accountId: account.id,
      tab: 'tab-3',
    })

    // Back to the capture's count.
    const cleared = await client.json<AccountSettingsResponse>(url, {
      method: 'PATCH',
      json: { resin: null },
    })
    expect(cleared.settings.resin).toBeNull()
    expect(cleared.settings.planner.resinSteps).toEqual([-20, -40])
    live.socket.close(1000)

    for (const bad of [
      { resin: { value: -1, at: 0 } },
      { resin: { value: 2001, at: 0 } },
      { resin: { value: 10 } },
      { resin: { value: 10, at: 0, extra: 1 } },
      { planner: { resinSteps: [0] } },
      { planner: { resinSteps: [201] } },
      { planner: { resinSteps: [1, 2, 3, 4, 5] } },
      { planner: { resinMarks: [0] } },
      { planner: { resinMarks: [201] } },
      { planner: { resinMarks: [1.5] } },
      { planner: { resinMarks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] } },
    ]) {
      const response = await client.fetch(url, { method: 'PATCH', json: bad })
      expect(response.status, JSON.stringify(bad)).toBe(400)
    }
  })
})

describe('migration 0013 (planner tasks)', () => {
  it('keeps one row per account, kind and id, cascading with the account', async () => {
    const { account } = await setup()
    await db
      .insert(plannerTasks)
      .values({ accountId: account.id, kind: 'builtin', id: 'abyss', data: {} })
    // The same id as another kind is another task.
    await db
      .insert(plannerTasks)
      .values({ accountId: account.id, kind: 'custom', id: 'abyss', data: {} })
    await expect(
      db
        .insert(plannerTasks)
        .values({ accountId: account.id, kind: 'builtin', id: 'abyss', data: {} }),
    ).rejects.toThrow()
    const rows = await db.select().from(plannerTasks).where(eq(plannerTasks.accountId, account.id))
    expect(rows.map((r) => [r.kind, r.id, r.data])).toEqual([
      ['builtin', 'abyss', {}],
      ['custom', 'abyss', {}],
    ])

    await db.delete(genshinAccounts).where(eq(genshinAccounts.id, account.id))
    expect(
      await db.select().from(plannerTasks).where(eq(plannerTasks.accountId, account.id)),
    ).toEqual([])
  })
})
