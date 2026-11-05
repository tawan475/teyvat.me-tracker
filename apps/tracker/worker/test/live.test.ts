import type {
  AccountCreatedResponse,
  AccountResponse,
  ImportKeyResponse,
  ImportResponse,
  LiveEvent,
  SessionResponse,
} from '@gdt/shared'
import { env, runInDurableObject, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { SESSION_ENDED_CLOSE, liveHub, type LiveHub } from '../services/live'
import {
  Client,
  ORIGIN,
  irminsulForm,
  liveMessage,
  sampleExtras,
  sampleGood,
  signUp,
} from './client'

const DIAG = 'test-diag-key-test-diag-key-test-diag-key'
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** An open live socket, with its messages queued for the test to read in order. */
interface Tab {
  socket: WebSocket
  /** The `hello` it opened with. */
  hello: LiveEvent
  /** The next message (event or `pong`), or a failure after `ms`. */
  next(ms?: number): Promise<unknown>
  /** Fails if a message arrives within `ms`. */
  quiet(ms?: number): Promise<void>
  closed: Promise<CloseEvent>
}

async function tabOf(socket: WebSocket): Promise<Tab> {
  socket.accept()
  const queue: unknown[] = []
  let wake: (() => void) | null = null
  socket.addEventListener('message', (event) => {
    const text = String(event.data)
    queue.push(text === 'pong' ? text : liveMessage(text))
    wake?.()
  })
  const closed = new Promise<CloseEvent>((resolve) =>
    socket.addEventListener('close', (event) => resolve(event)),
  )
  const waitFor = (ms: number) =>
    new Promise<boolean>((resolve) => {
      if (queue.length > 0) return resolve(true)
      const timer = setTimeout(() => {
        wake = null
        resolve(false)
      }, ms)
      wake = () => {
        clearTimeout(timer)
        wake = null
        resolve(true)
      }
    })
  const next = async (ms = 2000) => {
    if (!(await waitFor(ms))) throw new Error(`No live message within ${ms} ms`)
    return queue.shift()
  }
  const hello = (await next()) as LiveEvent
  expect(hello.type).toBe('hello')
  return {
    socket,
    hello,
    closed,
    next,
    async quiet(ms = 150) {
      if (await waitFor(ms)) throw new Error(`Unexpected live message: ${JSON.stringify(queue)}`)
    },
  }
}

function upgrade(client: Client) {
  return client.fetch('/api/live', { headers: { upgrade: 'websocket', origin: ORIGIN } })
}

async function openTab(client: Client): Promise<Tab> {
  const response = await upgrade(client)
  expect(response.status).toBe(101)
  return tabOf(response.webSocket!)
}

async function createAccount(client: Client, uid = '812345678') {
  return client.json<AccountCreatedResponse>('/api/accounts', {
    method: 'POST',
    json: { name: 'Main', uid, server: 'ASIA' },
  })
}

function importByKey(key: string, good: unknown, timestamp?: number) {
  return SELF.fetch(`${ORIGIN}/api/genshin-accounts-public/import-by-key`, {
    method: 'POST',
    headers: { 'x-import-key': key },
    body: irminsulForm(good, timestamp),
  })
}

async function versionOf(client: Client, id: number) {
  return (await client.json<AccountResponse>(`/api/accounts/${id}`)).dataVersion
}

async function liveSince(userId: number): Promise<number | null> {
  const row = await env.DB.prepare('SELECT live_since FROM users WHERE id = ?1')
    .bind(userId)
    .first<{ live_since: number | null }>()
  return row!.live_since
}

/** Waits for the hub's flag write that follows a close. */
async function eventually(check: () => Promise<boolean>, ms = 2000) {
  const until = Date.now() + ms
  while (!(await check())) {
    if (Date.now() > until) throw new Error('Condition not met in time')
    await sleep(20)
  }
}

/** Events this user's hub instance sent since it woke (0 for one woken just now). */
function notified(userId: number): Promise<number> {
  return runInDurableObject(liveHub(env, userId), (hub: LiveHub) => hub.notified)
}

describe('live socket', () => {
  it('needs a session, this site as the origin, and an upgrade', async () => {
    const headers = { upgrade: 'websocket', origin: ORIGIN }
    const anonymous = await new Client().fetch('/api/live', { headers })
    expect(anonymous.status).toBe(401)
    expect(anonymous.webSocket).toBeNull()

    const { client } = await signUp()
    const elsewhere = await client.fetch('/api/live', {
      headers: { ...headers, origin: 'https://evil.example' },
    })
    expect(elsewhere.status).toBe(403)
    const noOrigin = await client.fetch('/api/live', { headers: { upgrade: 'websocket' } })
    expect(noOrigin.status).toBe(403)
    const plain = await client.fetch('/api/live', { headers: { origin: ORIGIN } })
    expect(plain.status).toBe(426)

    const tab = await openTab(client)
    tab.socket.send('ping')
    expect(await tab.next()).toBe('pong')
    tab.socket.close(1000)
  })

  it('opens with each account as it is, to tell what a tab missed', async () => {
    const { client } = await signUp()
    const { account, importKey } = await createAccount(client)
    await importByKey(importKey, sampleGood(), 1_000)
    const tab = await openTab(client)
    expect(tab.hello).toEqual<LiveEvent>({
      type: 'hello',
      accounts: [
        {
          id: account.id,
          dataVersion: await versionOf(client, account.id),
          name: 'Main',
          uid: '812345678',
          server: 'ASIA',
        },
      ],
      // Every snapshot opens a journal: where it stands.
      journals: [{ id: account.id, base: expect.any(String), seq: 0 }],
    })
    tab.socket.close(1000)
  })

  it("says where each open live journal stands, and a batch's event carries the batch", async () => {
    const { client } = await signUp()
    const { account, importKey } = await createAccount(client)
    const top = 812345678n << 32n
    const good = sampleGood(sampleExtras())
    const answer = (await (
      await importByKey(
        importKey,
        {
          ...good,
          artifacts: good.artifacts.map((a, i) => ({
            ...a,
            gi_guid: String(top + BigInt(100 + i)),
          })),
          weapons: good.weapons.map((w, i) => ({ ...w, gi_guid: String(top + BigInt(500 + i)) })),
          gi_capture: {
            v: 1,
            reason: 'login',
            session: 'SESSIONFORTEST01',
            world: 1,
            journal: { seq: 0 },
          },
        },
        1_000,
      )
    ).json()) as ImportResponse
    const base = answer.live!.base
    const tab = await openTab(client)
    expect(tab.hello).toMatchObject({ journals: [{ id: account.id, base, seq: 0 }] })

    const sent = await SELF.fetch(`${ORIGIN}/api/irminsul/changes`, {
      method: 'POST',
      headers: { 'x-import-key': importKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        format: 'GOOD-X-delta',
        v: 1,
        uid: 812345678,
        session: 'SESSIONFORTEST01',
        seq: 1,
        base,
        at: 1_792_000_000_001,
        changes: [['set', ['materials', 'Mora'], 7]],
      }),
    })
    expect(sent.status).toBe(200)
    const event = (await tab.next()) as LiveEvent
    expect(event).toMatchObject({
      type: 'live',
      accountId: account.id,
      seq: 1,
      batch: { base, prev: 0, changes: [['set', ['materials', 'Mora'], 7]], items: [] },
    })
    tab.socket.close(1000)
  })

  it("tells every socket of the user about each change, and nobody else's", async () => {
    const { client, me } = await signUp()
    const other = await signUp()
    const [first, second, stranger] = await Promise.all([
      openTab(client),
      openTab(client),
      openTab(other.client),
    ])
    const both = async () => {
      const [a, b] = [await first.next(), await second.next()]
      expect(b).toEqual(a)
      return a
    }

    const { account, importKey } = await createAccount(client)
    expect(await both()).toEqual<LiveEvent>({ type: 'accounts' })

    // irminsul's upload with the account's own key.
    expect((await importByKey(importKey, sampleGood(), 1_000)).status).toBe(201)
    expect(await both()).toEqual<LiveEvent>({
      type: 'data',
      accountId: account.id,
      dataVersion: await versionOf(client, account.id),
      takenAt: 1_000,
    })

    // The same capture again changes nothing and says nothing; seen again later, it does.
    expect((await importByKey(importKey, sampleGood(), 1_000)).status).toBe(200)
    await first.quiet()
    expect((await importByKey(importKey, sampleGood(), 2_000)).status).toBe(200)
    expect(await both()).toMatchObject({ type: 'data', accountId: account.id, takenAt: 2_000 })

    // An upload from the dashboard.
    const manual = await client.fetch(`/api/accounts/${account.id}/import?timestamp=3000`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sampleGood({ materials: { Mora: 5 } })),
    })
    expect(manual.status).toBe(201)
    const { snapshotId } = (await manual.json()) as ImportResponse
    expect(await both()).toEqual<LiveEvent>({
      type: 'data',
      accountId: account.id,
      dataVersion: await versionOf(client, account.id),
      takenAt: 3_000,
    })

    // Deletes, one and many.
    await client.fetch(`/api/accounts/${account.id}/snapshots/${snapshotId}`, { method: 'DELETE' })
    expect(await both()).toEqual<LiveEvent>({
      type: 'data',
      accountId: account.id,
      dataVersion: await versionOf(client, account.id),
    })
    const snapshots = await client.json<{ id: number }[]>(`/api/accounts/${account.id}/snapshots`)
    await client.fetch(`/api/accounts/${account.id}/snapshots/delete`, {
      method: 'POST',
      json: { ids: snapshots.map((s) => s.id) },
    })
    expect(await both()).toMatchObject({ type: 'data', accountId: account.id })

    // Renamed, then removed.
    await client.fetch(`/api/accounts/${account.id}`, { method: 'PATCH', json: { name: 'Alt' } })
    expect(await both()).toEqual<LiveEvent>({ type: 'accounts' })
    await client.fetch(`/api/accounts/${account.id}`, { method: 'DELETE' })
    expect(await both()).toEqual<LiveEvent>({ type: 'accounts' })

    await stranger.quiet()
    expect(await liveHub(env, me.id).sockets()).toBe(2)
    for (const tab of [first, second, stranger]) tab.socket.close(1000)
  })

  it("reaches the user's sockets from their all-accounts key, new accounts included", async () => {
    const { client } = await signUp()
    const tab = await openTab(client)
    const { importKey } = await client.json<ImportKeyResponse>('/api/me/import-key', {
      method: 'POST',
    })
    const response = await importByKey(importKey, sampleGood(sampleExtras(712345678)), 1_000)
    expect(response.status).toBe(201)
    const { account } = (await response.json()) as ImportResponse
    expect(account).toMatchObject({ uid: '712345678', created: true })
    expect(await tab.next()).toEqual<LiveEvent>({
      type: 'data',
      accountId: account!.id,
      dataVersion: await versionOf(client, account!.id),
      takenAt: 1_000,
    })
    tab.socket.close(1000)
  })

  it('tells a dashboard import run once, at its end', async () => {
    const { client } = await signUp()
    const { account } = await createAccount(client)
    const tab = await openTab(client)
    for (const [i, mora] of [1, 2, 3].entries()) {
      const response = await client.fetch(
        `/api/accounts/${account.id}/import?timestamp=${1_000 + i}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-gdt-live': 'quiet' },
          body: JSON.stringify(sampleGood({ materials: { Mora: mora } })),
        },
      )
      expect(response.status).toBe(201)
    }
    await tab.quiet()
    const announced = await client.json<AccountResponse>(`/api/accounts/${account.id}/announce`, {
      method: 'POST',
    })
    expect(announced.snapshotCount).toBe(3)
    expect(await tab.next()).toEqual<LiveEvent>({
      type: 'data',
      accountId: account.id,
      dataVersion: announced.dataVersion,
    })
    tab.socket.close(1000)
  })
})

describe('who is listening', () => {
  it('is marked while the user has a socket open, and cleared after the last one', async () => {
    const { client, me } = await signUp()
    expect(await liveSince(me.id)).toBeNull()
    const first = await openTab(client)
    const since = await liveSince(me.id)
    expect(since).toBeGreaterThan(0)
    const second = await openTab(client)
    expect(await liveSince(me.id)).toBe(since) // set once, not on every connect

    first.socket.close(1000)
    await first.closed
    await sleep(100)
    expect(await liveSince(me.id)).toBe(since)
    second.socket.close(1000)
    await eventually(async () => (await liveSince(me.id)) === null)
  })

  it('costs an upload nothing live when no page is open', async () => {
    const { client, me } = await signUp()
    const { importKey } = await createAccount(client)
    await sleep(100)
    // Creating it (a dashboard action) told the hub, which found nobody.
    const before = await notified(me.id)
    expect(await liveSince(me.id)).toBeNull()
    expect((await importByKey(importKey, sampleGood(), 1_000)).status).toBe(201)
    expect((await importByKey(importKey, sampleGood(), 2_000)).status).toBe(200)
    await sleep(100)
    // The uploads never called it.
    expect(await notified(me.id)).toBe(before)
  })

  it('stops being called once an event finds nobody (a flag left over from a crash)', async () => {
    const { client, me } = await signUp()
    const { importKey } = await createAccount(client)
    await env.DB.prepare('UPDATE users SET live_since = 1 WHERE id = ?1').bind(me.id).run()
    expect((await importByKey(importKey, sampleGood(), 1_000)).status).toBe(201)
    await eventually(async () => (await liveSince(me.id)) === null)
    // The notifications that read the stale flag before it was cleared still
    // arrive (how many depends on timing); once it is cleared, uploads stop.
    const before = await notified(me.id)
    expect(before).toBeGreaterThanOrEqual(1)
    // The same inventory again: "seen again", which notifies too while someone listens.
    expect((await importByKey(importKey, sampleGood(), 2_000)).status).toBe(200)
    expect(await liveSince(me.id)).toBeNull()
    expect(await notified(me.id)).toBe(before)
  })
})

describe('wish history events', () => {
  function syncWishes(key: string, records: unknown[]) {
    return SELF.fetch(`${ORIGIN}/api/wishes/import`, {
      method: 'POST',
      headers: { 'x-import-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ uid: '812345678', timezone: 8, records }),
    })
  }
  const record = (id: string, time: string) => ({
    id,
    gacha_type: '200',
    time,
    name: 'Slingshot',
    item_type: 'Weapon',
    rank_type: '3',
  })

  it('tells the user when pulls arrive, and says nothing for known ones or with no page open', async () => {
    const { client, me } = await signUp()
    const { account, importKey } = await createAccount(client)
    await sleep(100)
    const idle = await notified(me.id)
    expect(
      (await syncWishes(importKey, [record('1790000000000000001', '2026-10-01 10:00:00')])).status,
    ).toBe(200)
    await sleep(100)
    expect(await notified(me.id)).toBe(idle)

    const tab = await openTab(client)
    expect(
      (await syncWishes(importKey, [record('1790000000000000002', '2026-10-01 10:01:00')])).status,
    ).toBe(200)
    expect(await tab.next()).toEqual<LiveEvent>({ type: 'wishes', accountId: account.id })
    expect(
      (await syncWishes(importKey, [record('1790000000000000002', '2026-10-01 10:01:00')])).status,
    ).toBe(200)
    await tab.quiet()
    tab.socket.close(1000)
  })
})

describe('socket handlers', () => {
  it('never throw on a socket that is already closing', async () => {
    const { me } = await signUp()
    const closing = {
      readyState: WebSocket.CLOSING,
      send() {
        throw new TypeError("Can't call WebSocket send() after close().")
      },
      close() {
        throw new TypeError('WebSocket already closed.')
      },
      deserializeAttachment() {
        throw new Error('Attachment unreadable.')
      },
    } as unknown as WebSocket
    await runInDurableObject(liveHub(env, me.id), async (hub: LiveHub) => {
      await expect(hub.webSocketMessage(closing, 'ping')).resolves.toBeUndefined()
      await expect(hub.webSocketMessage(closing, 'other')).resolves.toBeUndefined()
      await expect(hub.webSocketClose(closing, 1006, '')).resolves.toBeUndefined()
      await expect(hub.webSocketError(closing)).resolves.toBeUndefined()
    })
  })
})

describe('ending sessions', () => {
  it('closes the sockets of every session when the user signs out everywhere', async () => {
    const { client, username, password } = await signUp()
    const phone = new Client()
    await phone.json('/api/auth/login', { method: 'POST', json: { login: username, password } })
    const [here, there] = await Promise.all([openTab(client), openTab(phone)])

    expect((await client.fetch('/api/auth/logout-all', { method: 'POST' })).status).toBe(204)
    expect((await here.closed).code).toBe(SESSION_ENDED_CLOSE)
    expect((await there.closed).code).toBe(SESSION_ENDED_CLOSE)
    // The phone's access cookie is still within its 15 minutes, but its session is over.
    const refused = await upgrade(phone)
    expect(refused.status).toBe(401)
    expect(await refused.json()).toMatchObject({ error: { code: 'session_revoked' } })
  })

  it('keeps the device that changed the password connected, with its new session', async () => {
    const { client, me, username, password } = await signUp()
    const other = new Client()
    await other.json('/api/auth/login', { method: 'POST', json: { login: username, password } })
    const [here, there] = await Promise.all([openTab(client), openTab(other)])

    const changed = await client.fetch('/api/auth/password', {
      method: 'POST',
      json: { currentPassword: password, newPassword: 'another horse battery staple' },
    })
    expect(changed.status).toBe(204)
    expect((await there.closed).code).toBe(SESSION_ENDED_CLOSE)
    expect((await upgrade(other)).status).toBe(401)
    // This device's socket stays, at the new version: the next event reaches it.
    expect(await liveHub(env, me.id).sockets()).toBe(1)
    const { importKey } = await createAccount(client)
    expect(await here.next()).toEqual<LiveEvent>({ type: 'accounts' })
    expect((await importByKey(importKey, sampleGood(), 1_000)).status).toBe(201)
    expect(await here.next()).toMatchObject({ type: 'data', takenAt: 1_000 })
    // And its new cookie connects too.
    const again = await openTab(client)
    expect(await liveHub(env, me.id).sockets()).toBe(2)
    here.socket.close(1000)
    again.socket.close(1000)
  })

  it("closes only a signed-out device's socket, and refuses it from then on", async () => {
    const { client, me, username, password } = await signUp()
    const phone = new Client()
    await phone.json('/api/auth/login', { method: 'POST', json: { login: username, password } })
    const [here, there] = await Promise.all([openTab(client), openTab(phone)])
    const sessions = await client.json<SessionResponse[]>('/api/auth/sessions')
    const phoneSession = sessions.find((s) => !s.current)!

    const revoked = await client.fetch(`/api/auth/sessions/${phoneSession.id}`, {
      method: 'DELETE',
    })
    expect(revoked.status).toBe(204)
    expect((await there.closed).code).toBe(SESSION_ENDED_CLOSE)
    // The phone's access cookie is still a valid JWT, but its session is over.
    const refused = await upgrade(phone)
    expect(refused.status).toBe(401)
    expect(await refused.json()).toMatchObject({ error: { code: 'session_revoked' } })
    // This device is untouched.
    await createAccount(client)
    expect(await here.next()).toEqual<LiveEvent>({ type: 'accounts' })
    expect(await liveHub(env, me.id).sockets()).toBe(1)
    here.socket.close(1000)
  })

  it('refuses a connect for a session it was just told is over, before D1 says so', async () => {
    const { client, me } = await signUp()
    const [session] = await client.json<SessionResponse[]>('/api/auth/sessions')
    // As if the revoke reached the hub while this connect's read was in flight.
    await liveHub(env, me.id).revokeSession(me.id, session!.id)
    expect((await upgrade(client)).status).toBe(401)
  })

  it('closes a socket of an ended session at the next event, should the revoke be lost', async () => {
    const { client, me } = await signUp()
    const { importKey } = await createAccount(client)
    const tab = await openTab(client)
    // As if signing out everywhere had not reached the hub.
    await env.DB.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?1')
      .bind(me.id)
      .run()
    expect((await importByKey(importKey, sampleGood(), 1_000)).status).toBe(201)
    expect((await tab.closed).code).toBe(SESSION_ENDED_CLOSE)
  })
})

describe('account list', () => {
  it('is one round trip, and a 304 while nothing changed', async () => {
    const { client } = await signUp()
    const { account, importKey } = await createAccount(client)
    await createAccount(client, '712345678')
    await importByKey(importKey, sampleGood(), 1_000)

    const first = await client.fetch('/api/accounts', { headers: { 'x-diag-key': DIAG } })
    expect(first.status).toBe(200)
    expect(first.headers.get('cache-control')).toBe('private, no-cache')
    const cost = first.headers.get('x-gdt-d1')!
    expect(cost).toMatch(/round-trips=1;/)
    // Each account by the user index, plus the one latest snapshot by key,
    // plus the probe of account_members' user index (accounts shared with them).
    expect(Number(/rows-read=(\d+)/.exec(cost)![1])).toBeLessThanOrEqual(5)
    const etag = first.headers.get('etag')!
    expect(etag).toMatch(/^W\/"l\.[0-9a-f]{24}"$/)
    const list = (await first.json()) as AccountResponse[]
    expect(list.map((a) => a.snapshotCount)).toEqual([1, 0])

    const same = await client.fetch('/api/accounts', { headers: { 'if-none-match': etag } })
    expect(same.status).toBe(304)
    expect(await same.text()).toBe('')

    // A capture seen again moves only the version and the last-seen time.
    await importByKey(importKey, sampleGood(), 2_000)
    const moved = await client.fetch('/api/accounts', { headers: { 'if-none-match': etag } })
    expect(moved.status).toBe(200)
    const after = (await moved.json()) as AccountResponse[]
    expect(after[0]!.dataVersion).toBeGreaterThan(list[0]!.dataVersion)
    expect(after[0]!.latest!.lastSeenAt).toBe(2_000)

    // A rename alone changes it too.
    const etag2 = moved.headers.get('etag')!
    await client.fetch(`/api/accounts/${account.id}`, { method: 'PATCH', json: { name: 'Alt' } })
    expect(
      (await client.fetch('/api/accounts', { headers: { 'if-none-match': etag2 } })).status,
    ).toBe(200)

    // Another user's list is their own, whatever tag they send.
    const other = await signUp()
    const theirs = await other.client.fetch('/api/accounts', { headers: { 'if-none-match': etag } })
    expect(theirs.status).toBe(200)
    expect(await theirs.json()).toEqual([])
  })
})
