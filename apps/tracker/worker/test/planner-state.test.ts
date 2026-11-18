import type { AccountCreatedResponse, LiveEvent } from '@gdt/shared'
import { env, SELF } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { getDb } from '../db/client'
import { genshinAccounts, inventoryAdjustments, plannerTargets } from '../db/schema'
import { ORIGIN, irminsulForm, liveMessage, sampleGood, signUp } from './client'

const db = getDb(env.DB)

interface State {
  capturedAt: number | null
  adjustments: { key: string; delta: number; set: number | null; base: number; updatedAt: number }[]
  overrides: { kind: string; id?: string; key: string; owner: string; current: unknown }[]
}

const furina = { level: 90, ascension: 6, talents: { auto: 6, skill: 9, burst: 10 } }

function importByKey(key: string, good: unknown, timestamp?: number) {
  return SELF.fetch(`${ORIGIN}/api/genshin-accounts-public/import-by-key`, {
    method: 'POST',
    headers: { 'x-import-key': key },
    body: irminsulForm(good, timestamp),
  })
}

async function setup() {
  const { client, me } = await signUp()
  const { account, importKey } = await client.json<AccountCreatedResponse>('/api/accounts', {
    method: 'POST',
    json: { name: 'Main', uid: '812345678', server: 'ASIA' },
  })
  const url = `/api/accounts/${account.id}/planner-state`
  const targets = `/api/accounts/${account.id}/planner-targets`
  const patch = (json: object, headers: Record<string, string> = {}) =>
    client.fetch(url, { method: 'PATCH', json, headers })
  const state = () => client.json<State>(url)
  return { client, me, account, importKey, url, targets, patch, state }
}

const brief = (s: State) =>
  s.adjustments.map(({ key, delta, set, base }) => ({ key, delta, set, base }))

describe('planner hand edits', () => {
  it('edits counts with no capture at all, and adds up relative changes', async () => {
    const { patch, state } = await setup()
    expect(await state()).toEqual({ capturedAt: null, adjustments: [], overrides: [] })

    const first = await patch({
      base: 0,
      inventory: [
        { key: 'HerosWit', set: 40 },
        { key: 'Mora', add: 50_000 },
        { key: 'GuideToFreedom', set: 3, add: 2 },
      ],
    })
    expect(first.status).toBe(200)
    const after = (await first.json()) as State
    expect(after.capturedAt).toBeNull()
    expect(brief(after)).toEqual([
      { key: 'GuideToFreedom', delta: 2, set: 3, base: 0 },
      { key: 'HerosWit', delta: 0, set: 40, base: 0 },
      { key: 'Mora', delta: 50_000, set: null, base: 0 },
    ])

    // Adds stack on a set; back to the capture with nothing added drops the edit.
    await patch({
      base: 0,
      inventory: [
        { key: 'HerosWit', add: -15 },
        { key: 'Mora', add: -50_000 },
        { key: 'GuideToFreedom', set: null },
      ],
    })
    expect(brief(await state())).toEqual([{ key: 'HerosWit', delta: -15, set: 40, base: 0 }])
  })

  it('writes nothing against an old capture, and drops edits a newer capture replaced', async () => {
    const { importKey, patch, state } = await setup()
    expect((await importByKey(importKey, sampleGood(), 1_000)).status).toBe(201)
    expect((await state()).capturedAt).toBe(1_000)

    // Made against no capture (the page had not seen it yet): refused, nothing written.
    const stale = await patch({ base: 0, inventory: [{ key: 'Mora', set: 1 }] })
    expect(stale.status).toBe(409)
    expect(((await stale.json()) as { error: { code: string } }).error.code).toBe('capture_changed')
    expect((await state()).adjustments).toEqual([])

    const spent = await patch({ base: 1_000, inventory: [{ key: 'Mora', add: -500 }] })
    expect(spent.status).toBe(200)
    expect(brief(await state())).toEqual([{ key: 'Mora', delta: -500, set: null, base: 1_000 }])

    // The same bag seen again later counts as a newer capture: the edit is replaced.
    expect((await importByKey(importKey, sampleGood(), 2_000)).status).toBe(200)
    const seenAgain = await state()
    expect(seenAgain.capturedAt).toBe(2_000)
    // Still listed (the page tells what was replaced) until the next write.
    expect(brief(seenAgain)).toEqual([{ key: 'Mora', delta: -500, set: null, base: 1_000 }])
    expect((await patch({ base: 1_000, prune: true })).status).toBe(409)
    const pruned = await patch({ base: 2_000, prune: true })
    expect(pruned.status).toBe(200)
    expect(((await pruned.json()) as State).adjustments).toEqual([])

    // A newer, different capture: an add starts over from it.
    await patch({ base: 2_000, inventory: [{ key: 'Mora', add: -7 }] })
    const changed = sampleGood({ materials: { Mora: 9 } })
    expect((await importByKey(importKey, changed, 3_000)).status).toBe(201)
    const three = await patch({ base: 3_000, inventory: [{ key: 'Mora', add: 1 }] })
    expect(three.status).toBe(200)
    expect(brief((await three.json()) as State)).toEqual([
      { key: 'Mora', delta: 1, set: null, base: 3_000 },
    ])
    // Several imports and writes in one test: allow for a busy machine.
  }, 20_000)

  it("keeps edits through captures that left materials out (Capture's gi_off)", async () => {
    const { importKey, patch, state } = await setup()
    expect((await importByKey(importKey, sampleGood(), 1_000)).status).toBe(201)
    // A Done spends against the capture that brought the bag.
    expect((await patch({ base: 1_000, inventory: [{ key: 'Mora', add: -500 }] })).status).toBe(200)
    // The next login leaves the bag out: no new bag arrived.
    const { materials: _, ...rest } = sampleGood()
    const off = { ...rest, gi_off: ['materials'] }
    expect((await importByKey(importKey, off, 2_000)).status).toBe(201)
    expect((await state()).capturedAt).toBe(2_000)
    // Edits on the newer one, measured against the bag's capture: the Done stays.
    const next = await patch({
      base: 2_000,
      bagBase: 1_000,
      inventory: [{ key: 'HerosWit', set: 9 }],
    })
    expect(next.status).toBe(200)
    expect(brief((await next.json()) as State)).toEqual([
      { key: 'HerosWit', delta: 0, set: 9, base: 2_000 },
      { key: 'Mora', delta: -500, set: null, base: 1_000 },
    ])
    // Seen again with the bag still left out: still kept.
    expect((await importByKey(importKey, off, 3_000)).status).toBe(200)
    const again = await patch({ base: 3_000, bagBase: 1_000, prune: true })
    expect(brief((await again.json()) as State).map((a) => a.key)).toEqual(['HerosWit', 'Mora'])
    // A bag past `base` counts as `base`; without one, the newest replaces older edits.
    const pruned = await patch({ base: 3_000, bagBase: 9_000, prune: true })
    expect(((await pruned.json()) as State).adjustments).toEqual([])
  }, 20_000)

  it("sets and clears a goal's current state, which goal edits leave alone", async () => {
    const { client, targets, patch, state } = await setup()
    await client.json(targets, {
      method: 'PATCH',
      json: {
        upsert: [
          { kind: 'character', key: 'Furina', target: furina },
          {
            kind: 'weapon',
            key: 'FavoniusSword',
            owner: '',
            target: { level: 90, ascension: 6, refinement: 1 },
          },
        ],
      },
    })
    const now = { level: 80, ascension: 6, talents: { auto: 6, skill: 8, burst: 8 } }
    const sword = { level: 90, ascension: 6, refinement: 2 }
    const done = await patch({
      base: 0,
      inventory: [{ key: 'PhilosophiesOfJustice', add: -3 }],
      current: [
        { kind: 'character', key: 'Furina', current: now },
        { kind: 'weapon', key: 'FavoniusSword', owner: '', current: sword },
        // No such goal: nothing to land on.
        { kind: 'character', key: 'Bennett', current: now },
      ],
    })
    expect(done.status).toBe(200)
    expect(((await done.json()) as State).overrides).toEqual([
      { kind: 'character', key: 'Furina', owner: '', current: now },
      // Named the old way (no id): the weapon goal's own id comes back.
      { kind: 'weapon', id: expect.any(String), key: 'FavoniusSword', owner: '', current: sword },
    ])

    // Editing the goal keeps its current state; the goal list never carries it.
    const edited = await client.json<{ targets: Record<string, unknown>[] }>(targets, {
      method: 'PATCH',
      json: { upsert: [{ kind: 'character', key: 'Furina', target: { ...furina, note: 'x' } }] },
    })
    expect(edited.targets.every((t) => !('current' in t))).toBe(true)
    expect((await state()).overrides).toHaveLength(2)

    const cleared = await patch({
      base: 0,
      current: [{ kind: 'weapon', key: 'FavoniusSword', owner: '', current: null }],
    })
    expect(((await cleared.json()) as State).overrides.map((o) => o.key)).toEqual(['Furina'])

    // Removing the goal removes its current state with it.
    await client.json(targets, {
      method: 'PATCH',
      json: { remove: [{ kind: 'character', key: 'Furina' }] },
    })
    expect((await state()).overrides).toEqual([])
  })

  it('validates, and keeps edits to the owner', async () => {
    const { account, url, patch } = await setup()
    for (const bad of [
      {},
      { base: 0 },
      { inventory: [{ key: 'Mora', set: 1 }] },
      { base: -1, inventory: [{ key: 'Mora', set: 1 }] },
      { base: 0, inventory: [{ key: 'Mora' }] },
      { base: 0, inventory: [{ key: 'Mo ra', set: 1 }] },
      { base: 0, inventory: [{ key: 'Mora', set: -1 }] },
      { base: 0, inventory: [{ key: 'Mora', set: 1.5 }] },
      {
        base: 0,
        inventory: [
          { key: 'Mora', add: 1 },
          { key: 'Mora', set: 2 },
        ],
      },
      { base: 0, current: [{ kind: 'character', key: 'Furina', current: { level: 91 } }] },
      { base: 0, current: [{ kind: 'weapon', key: 'FavoniusSword', current: null }] },
    ]) {
      expect((await patch(bad)).status, JSON.stringify(bad)).toBe(400)
    }

    const stranger = await signUp()
    expect((await stranger.client.fetch(url)).status).toBe(404)
    const sneaky = await stranger.client.fetch(url, {
      method: 'PATCH',
      json: { base: 0, inventory: [{ key: 'Mora', set: 1 }] },
    })
    expect(sneaky.status).toBe(404)
    expect(
      await db
        .select()
        .from(inventoryAdjustments)
        .where(eq(inventoryAdjustments.accountId, account.id)),
    ).toEqual([])
  })

  it("tells the user's open pages, naming the tab that wrote", async () => {
    const { client, account, targets, patch } = await setup()
    const response = await client.fetch('/api/live', {
      headers: { upgrade: 'websocket', origin: ORIGIN },
    })
    expect(response.status).toBe(101)
    const socket = response.webSocket!
    socket.accept()
    const messages: LiveEvent[] = []
    let wake: (() => void) | null = null
    socket.addEventListener('message', (event) => {
      const message = liveMessage(String(event.data))
      // Creating the account in setup() announces it in the background
      // (waitUntil); on a slow runner that lands after the socket opens.
      if (message.type === 'accounts') return
      messages.push(message)
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

    await patch({ base: 0, inventory: [{ key: 'Mora', set: 5 }] }, { 'x-gdt-tab': 'tab-1' })
    expect(await next()).toEqual<LiveEvent>({
      type: 'planner',
      accountId: account.id,
      tab: 'tab-1',
    })

    await client.json(targets, {
      method: 'PATCH',
      json: { upsert: [{ kind: 'character', key: 'Furina', target: furina }] },
      headers: { 'x-gdt-tab': 'bad tab id!' },
    })
    expect(await next()).toEqual<LiveEvent>({ type: 'planner', accountId: account.id })

    // A refused write says nothing.
    expect((await patch({ base: 5, inventory: [{ key: 'Mora', set: 1 }] })).status).toBe(409)
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(messages).toEqual([])
    socket.close(1000)
  })
})

describe('migration 0011 (planner hand edits)', () => {
  it('keeps one edit per account and material, cascading with the account', async () => {
    const { account } = await setup()
    await db
      .insert(inventoryAdjustments)
      .values({ accountId: account.id, key: 'Mora', baseSeenAt: 0 })
    await expect(
      db.insert(inventoryAdjustments).values({ accountId: account.id, key: 'Mora', baseSeenAt: 1 }),
    ).rejects.toThrow()
    const [row] = await db
      .select()
      .from(inventoryAdjustments)
      .where(eq(inventoryAdjustments.accountId, account.id))
    expect(row).toMatchObject({ key: 'Mora', delta: 0, setValue: null, baseSeenAt: 0 })

    // planner_targets.current: a nullable column, empty until set.
    await db.insert(plannerTargets).values({
      accountId: account.id,
      kind: 'character',
      key: 'Furina',
      target: { ...furina, active: true },
    })
    const [target] = await db
      .select()
      .from(plannerTargets)
      .where(eq(plannerTargets.accountId, account.id))
    expect(target!.current).toBeNull()

    await db.delete(genshinAccounts).where(eq(genshinAccounts.id, account.id))
    expect(
      await db
        .select()
        .from(inventoryAdjustments)
        .where(eq(inventoryAdjustments.accountId, account.id)),
    ).toEqual([])
  })
})
