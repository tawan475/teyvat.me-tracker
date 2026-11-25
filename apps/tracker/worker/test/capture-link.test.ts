import {
  toBase64Url,
  type AccountCreatedResponse,
  type DeviceAlerts,
  type PresenceResponse,
  type PresenceResponseForAccount,
  type PushConfigResponse,
  type SessionResponse,
} from '@gdt/shared'
import { env, runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { IDLE_NEXT_S, WATCHED_NEXT_S, liveHub, type LiveHub } from '../services/live'
import { RESIN_STEP_MS } from '../services/alerts'
import { parseLiveEvent } from '@/live/policy'
import { PRESENCE_TTL_MS as PAGE_TTL_MS, presenceOf, setPresence } from '@/live/presence-store'
import {
  PRESENCE_REWRITE_MS,
  PRESENCE_TTL_MS,
  heartbeat,
  presenceFor,
  queueCommand,
  type Heartbeat,
  type HubContext,
} from '../services/alert-hub'
import { ORIGIN, irminsulForm, sampleExtras, sampleGood, signUp, withEnv } from './client'

/** Calls the Worker and waits for what it does after answering (the hub's facts). */
const call = withEnv({})

async function setup() {
  const { client, me } = await signUp(call)
  const { account, importKey } = await client.json<AccountCreatedResponse>('/api/accounts', {
    method: 'POST',
    json: { name: 'Main', uid: '812345678', server: 'ASIA' },
  })
  return { client, me, account, importKey }
}

async function subscribe(client: Awaited<ReturnType<typeof setup>>['client']) {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair
  const raw = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer)
  const endpoint = `https://push.example.com/send/${crypto.randomUUID()}`
  const response = await client.fetch('/api/push/subscription', {
    method: 'PUT',
    json: {
      endpoint,
      keys: {
        p256dh: toBase64Url(raw),
        auth: toBase64Url(crypto.getRandomValues(new Uint8Array(16))),
      },
      tz: 'Asia/Bangkok',
    },
  })
  expect(response.status).toBe(204)
  return endpoint
}

const presence = (key: string, body: object) =>
  call(`${ORIGIN}/api/irminsul/presence`, {
    method: 'POST',
    headers: { 'x-import-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({ v: 1, ...body }),
  })

/** A hub over an in-memory storage that counts its writes, on a clock the test moves. */
function fakeHub() {
  const map = new Map<string, unknown>()
  let writes = 0
  const clock = { now: 1_800_000_000_000 }
  const storage = {
    get: async (key: string) => structuredClone(map.get(key)),
    put: async (key: string, value: unknown) => {
      writes++
      map.set(key, structuredClone(value))
    },
    delete: async (key: string) => map.delete(key),
    list: async ({ prefix }: { prefix: string }) =>
      new Map([...map].filter(([key]) => key.startsWith(prefix))),
  }
  const hub = {
    storage: storage as unknown as DurableObjectStorage,
    db: env.DB,
    vars: {},
    now: () => clock.now,
  } as unknown as HubContext
  return { hub, clock, puts: () => writes }
}

/** A push service that takes everything and remembers where it was sent. */
function pushService() {
  const sent: string[] = []
  const fetcher = (async (input: RequestInfo | URL) => {
    sent.push(String(input instanceof Request ? input.url : input))
    return new Response(null, { status: 201 })
  }) as typeof fetch
  return { sent, fetcher }
}

describe('alerts on every device', () => {
  it('is on with the server keys', async () => {
    const config = (await (
      await call(`${ORIGIN}/api/push/config`, {})
    ).json()) as PushConfigResponse
    expect(config.enabled).toBe(true)
    expect(config.publicKey).toMatch(/^B/)
  })

  it('subscribes a browser, keeps its settings and sends its alert when due', async () => {
    const { client, me, account, importKey } = await setup()
    const endpoint = await subscribe(client)
    const [session] = (await client.json<SessionResponse[]>('/api/auth/sessions')).filter(
      (s) => s.current,
    )
    expect(session!.push).toBe(true)
    expect(session!.alerts).toMatchObject({ resin: null, resinFull: true, tz: 'Asia/Bangkok' })

    const patched = await client.json<{ alerts: DeviceAlerts }>(
      `/api/auth/sessions/${session!.id}`,
      {
        method: 'PATCH',
        json: { alerts: { resin: 160, lang: 'en' } },
      },
    )
    expect(patched.alerts).toMatchObject({ resin: 160, resinFull: true, lang: 'en' })

    // A capture: 100 resin, the next one in a minute.
    const now = Date.now()
    const nextAt = Math.floor(now / 1000) + 60
    const upload = await call(`${ORIGIN}/api/genshin-accounts-public/import-by-key`, {
      method: 'POST',
      headers: { 'x-import-key': importKey },
      body: irminsulForm(
        sampleGood({
          gi_player: { ...sampleExtras().gi_player!, resin: 100 },
          gi_tasks: { resin: { value: 100, nextAt } },
        }),
        now,
      ),
    })
    expect(upload.status).toBe(201)

    const hub = liveHub(env, me.id)
    const due = nextAt * 1000 - RESIN_STEP_MS + 60 * RESIN_STEP_MS
    expect(await hub.alarmAt()).toBe(due)

    const service = pushService()
    const report = await runInDurableObject(hub, async (object: LiveHub) => {
      object.clock = () => due + 1_000
      object.fetcher = service.fetcher
      return object.fireNow()
    })
    expect(report).toMatchObject({ sent: 1, quiet: 0 })
    expect(service.sent).toEqual([endpoint])
    // Sent once: the next alarm is resin full, not this one again.
    expect(await hub.alarmAt()).toBe(due + 40 * RESIN_STEP_MS)
    const again = await runInDurableObject(hub, async (object: LiveHub) => object.fireNow())
    expect(again.sent).toBe(0)
    void account
  })

  it('holds alerts while Capture plays the account, and forgets a gone subscription', async () => {
    const { client, me, importKey } = await setup()
    await subscribe(client)
    const now = Date.now()
    await call(`${ORIGIN}/api/genshin-accounts-public/import-by-key`, {
      method: 'POST',
      headers: { 'x-import-key': importKey },
      // 199 resin, the last one in 30 seconds.
      body: irminsulForm(
        sampleGood({
          gi_player: { ...sampleExtras().gi_player!, resin: 199 },
          gi_tasks: { resin: { value: 199, nextAt: Math.floor(now / 1000) + 30 } },
        }),
        now,
      ),
    })
    const hub = liveHub(env, me.id)
    const full = await hub.alarmAt()
    expect(full).toBe((Math.floor(now / 1000) + 30) * 1000)

    expect((await presence(importKey, { state: 'decoding', uid: 812345678 })).status).toBe(200)
    const quiet = await runInDurableObject(hub, async (object: LiveHub) => {
      object.clock = () => full! + 1_000
      object.fetcher = pushService().fetcher
      return object.fireNow()
    })
    expect(quiet).toMatchObject({ sent: 0, quiet: 1 })

    // The phone unsubscribed: the push service answers 410 and the row goes.
    await call(`${ORIGIN}/api/genshin-accounts-public/import-by-key`, {
      method: 'POST',
      headers: { 'x-import-key': importKey },
      body: irminsulForm(
        sampleGood({ ...sampleExtras(), gi_player: { ...sampleExtras().gi_player!, resin: 150 } }),
        now + 1,
      ),
    })
    await presence(importKey, { state: 'stopped', uid: 812345678 })
    const gone = await runInDurableObject(hub, async (object: LiveHub) => {
      object.clock = () => now + 1 + 50 * RESIN_STEP_MS + 1_000
      object.fetcher = (async () => new Response(null, { status: 410 })) as typeof fetch
      return object.fireNow()
    })
    expect(gone.gone).toBe(1)
    const left = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?1',
    )
      .bind(me.id)
      .first<{ n: number }>()
    expect(left!.n).toBe(0)
  })

  it('stops alerting about an account once it is deleted', async () => {
    const { client, me, account } = await setup()
    await subscribe(client)
    const now = Date.now()
    await client.json(`/api/accounts/${account.id}/alert-facts`, {
      method: 'POST',
      json: { resin: { value: 199, at: now } },
    })
    const hub = liveHub(env, me.id)
    expect(await hub.alarmAt()).toBe(now + RESIN_STEP_MS)
    expect((await client.fetch(`/api/accounts/${account.id}`, { method: 'DELETE' })).status).toBe(
      204,
    )
    const service = pushService()
    const report = await runInDurableObject(hub, async (object: LiveHub) => {
      object.clock = () => now + RESIN_STEP_MS + 1_000
      object.fetcher = service.fetcher
      return object.fireNow()
    })
    expect(report.sent).toBe(0)
    expect(service.sent).toEqual([])
    expect(await hub.alarmAt()).toBeNull()
  })

  it('saves the alerts of a Capture device when no browser has push', async () => {
    const { client, me } = await setup()
    const now = Date.now()
    const { results } = await env.DB.prepare(
      `INSERT INTO user_sessions (user_id, method, device_name, created_at, last_seen_at, expires_at,
         upload_mode) VALUES (?1, 'irminsul', 'PC-01', ?2, ?2, ?3, 'uid') RETURNING id`,
    )
      .bind(me.id, now, now + 86_400_000)
      .all<{ id: number }>()
    const saved = await client.fetch(`/api/auth/sessions/${results[0]!.id}`, {
      method: 'PATCH',
      json: { alerts: { resin: 190, resinFull: true } },
    })
    expect(saved.status).toBe(200)
    // The hub itself read the devices (none with push) without an error.
    await liveHub(env, me.id).devicesChanged(me.id)
    const flag = await env.DB.prepare('SELECT alerts_on FROM users WHERE id = ?1')
      .bind(me.id)
      .first<{ alerts_on: number | null }>()
    expect(flag!.alerts_on).toBeNull()
  })

  it('saves the alerts of a Capture device while the hub holds every kind of fact', async () => {
    const { client, me, importKey } = await setup()
    await subscribe(client)
    // Alerts on this browser too, so the hub schedules over real facts.
    const [here] = (await client.json<SessionResponse[]>('/api/auth/sessions')).filter(
      (s) => s.current,
    )
    await client.json(`/api/auth/sessions/${here!.id}`, {
      method: 'PATCH',
      json: {
        alerts: { resin: 160, expeditions: true, welkin: true, commissions: true, bargains: true },
      },
    })
    const now = Date.now()
    const nowS = Math.floor(now / 1000)
    await call(`${ORIGIN}/api/genshin-accounts-public/import-by-key`, {
      method: 'POST',
      headers: { 'x-import-key': importKey },
      body: irminsulForm(
        sampleGood({
          ...sampleExtras(),
          gi_tasks: {
            resin: { value: 109, nextAt: nowS + 200 },
            commissions: { finished: 4, total: 4, claimed: true },
            expeditions: [
              {
                character: 'Xiangling',
                id: 202,
                start: nowS - 3600,
                hours: 20,
                doneAt: nowS + 60_000,
              },
            ],
            realm: { value: 2_040, limit: 2_400 },
            welkin: { days: 40 },
            weeklyBosses: { left: 3, limit: 3, cost: 30, fullCost: 60, used: 0 },
            bargains: { at: nowS - 100, bought: false, fates: [] },
          },
        }),
        now,
      ),
    })
    const { results } = await env.DB.prepare(
      `INSERT INTO user_sessions (user_id, method, device_name, created_at, last_seen_at, expires_at,
         upload_mode) VALUES (?1, 'irminsul', 'PC-01', ?2, ?2, ?3, 'uid') RETURNING id`,
    )
      .bind(me.id, now, now + 86_400_000)
      .all<{ id: number }>()
    const capture = results[0]!.id
    const saved = await client.fetch(`/api/auth/sessions/${capture}`, {
      method: 'PATCH',
      json: { alerts: { resin: 190 } },
    })
    expect(saved.status).toBe(200)
    const full = await client.fetch(`/api/auth/sessions/${capture}`, {
      method: 'PATCH',
      json: { alerts: { resinFull: true } },
    })
    expect(full.status).toBe(200)
    expect(((await full.json()) as { alerts: DeviceAlerts }).alerts).toMatchObject({
      resin: 190,
      resinFull: true,
    })
  })

  it('takes facts from the Planner only for users with alerts', async () => {
    const { client, account } = await setup()
    const before = await client.json<{ alerts: boolean }>(
      `/api/accounts/${account.id}/alert-facts`,
      {
        method: 'POST',
        json: { manual: { value: 20, at: Date.now() } },
      },
    )
    expect(before.alerts).toBe(false)
    await subscribe(client)
    const after = await client.json<{ alerts: boolean }>(
      `/api/accounts/${account.id}/alert-facts`,
      {
        method: 'POST',
        json: { manual: { value: 20, at: Date.now() }, ticks: { commissions: Date.now() } },
      },
    )
    expect(after.alerts).toBe(true)
    const bad = await client.fetch(`/api/accounts/${account.id}/alert-facts`, {
      method: 'POST',
      json: { manual: { value: -1, at: 1 } },
    })
    expect(bad.status).toBe(400)
  })
})

describe('Capture presence and commands', () => {
  it('shows who plays, hands over the website commands once, and ends on stop', async () => {
    const { client, account, importKey } = await setup()
    const first = (await (
      await presence(importKey, {
        state: 'decoding',
        uid: 812345678,
        app: '1.17.4',
        platform: 'windows',
      })
    ).json()) as PresenceResponse
    // With an import key: no whoami.
    expect(first).toEqual({ next: IDLE_NEXT_S, commands: [], alerts: null })

    const shown = await client.json<PresenceResponseForAccount>(
      `/api/accounts/${account.id}/presence`,
    )
    expect(shown.presence).toMatchObject({
      device: 'Capture',
      state: 'decoding',
      platform: 'windows',
    })

    const asked = await client.json<PresenceResponseForAccount>(
      `/api/accounts/${account.id}/capture-command`,
      { method: 'POST', json: { kind: 'snapshot' } },
    )
    expect(asked.pending).toEqual(['snapshot'])
    const beat = (await (
      await presence(importKey, { state: 'decoding', uid: 812345678 })
    ).json()) as PresenceResponse
    expect(beat.commands.map((c) => c.kind)).toEqual(['snapshot'])
    const next = (await (
      await presence(importKey, { state: 'decoding', uid: 812345678 })
    ).json()) as PresenceResponse
    expect(next.commands).toEqual([])

    await presence(importKey, { state: 'stopped', uid: 812345678 })
    const gone = await client.json<PresenceResponseForAccount>(
      `/api/accounts/${account.id}/presence`,
    )
    expect(gone.presence).toBeNull()
    const refused = await client.fetch(`/api/accounts/${account.id}/capture-command`, {
      method: 'POST',
      json: { kind: 'wishes' },
    })
    expect(refused.status).toBe(409)
  })

  it('beats sooner only while a page is in view', async () => {
    const { client, me, importKey } = await setup()
    const beat = async () =>
      (
        (await (
          await presence(importKey, { state: 'decoding', uid: 812345678 })
        ).json()) as PresenceResponse
      ).next
    // Nobody looking: the idle beat, ten minutes.
    expect(IDLE_NEXT_S).toBe(600)
    expect(WATCHED_NEXT_S).toBe(60)
    expect(await beat()).toBe(IDLE_NEXT_S)

    const response = await client.fetch('/api/live', {
      headers: { upgrade: 'websocket', origin: ORIGIN },
    })
    expect(response.status).toBe(101)
    const socket = response.webSocket!
    socket.accept()
    // Just connected: in view.
    expect(await beat()).toBe(WATCHED_NEXT_S)

    // Connected long ago and never pinged since: a hidden tab.
    await runInDurableObject(liveHub(env, me.id), async (_hub: LiveHub, state) => {
      for (const ws of state.getWebSockets()) {
        ws.serializeAttachment({ ...ws.deserializeAttachment(), at: Date.now() - 7 * 60_000 })
      }
    })
    expect(await beat()).toBe(IDLE_NEXT_S)
    socket.close()
  })

  it('writes the kept heartbeat only when it changes or grows old', async () => {
    const { hub, puts, clock } = fakeHub()
    const beat = (over: Partial<Heartbeat> = {}) =>
      heartbeat(hub, {
        sid: 7,
        device: 'PC-01',
        state: 'decoding',
        accountId: 3,
        uid: '812345678',
        platform: 'windows',
        app: '1.18.4',
        ...over,
      })
    const start = clock.now
    expect((await beat()).changed).toEqual([3])
    expect(puts()).toBe(1)
    // The same beat again, a minute later and up to just before the limit: no write.
    clock.now = start + 60_000
    await beat()
    clock.now = start + PRESENCE_REWRITE_MS - 1
    await beat()
    expect(puts()).toBe(1)
    // At the limit: written, with the new time, and told to the pages (a time-only change).
    clock.now = start + PRESENCE_REWRITE_MS
    expect((await beat()).changed).toEqual([3])
    expect(puts()).toBe(2)
    expect((await presenceFor(hub, 3)).presence?.at).toBe(start + PRESENCE_REWRITE_MS)
    // Anything else that changes is written at once: the state, the program, the account.
    clock.now += 1_000
    expect((await beat({ state: 'running' })).changed).toEqual([3])
    expect(puts()).toBe(3)
    clock.now += 1_000
    expect((await beat({ state: 'running', app: '1.18.5' })).changed).toEqual([3])
    expect(puts()).toBe(4)
    clock.now += 1_000
    expect((await beat({ state: 'running', app: '1.18.5', accountId: 4 })).changed.sort()).toEqual([
      3, 4,
    ])
    expect(puts()).toBe(5)
    // A command waits in its own key and still reaches the next beat, which writes nothing.
    expect(await queueCommand(hub, 4, 'wishes')).toMatchObject({ pending: ['wishes'] })
    expect(puts()).toBe(6)
    clock.now += 1_000
    const next = await beat({ state: 'running', app: '1.18.5', accountId: 4 })
    expect(next.commands.map((c) => c.kind)).toEqual(['wishes'])
    expect(puts()).toBe(6)
    // An unwritten beat never makes the entry look gone: it expires PRESENCE_TTL_MS
    // after the last written one, as before.
    const written = clock.now - 1_000
    clock.now = written + PRESENCE_TTL_MS - 1
    expect((await presenceFor(hub, 4)).presence).not.toBeNull()
    clock.now = written + PRESENCE_TTL_MS
    expect((await presenceFor(hub, 4)).presence).toBeNull()
  })

  it('writes every idle beat, of old builds (300 s) and new ones (600 s)', async () => {
    expect(PRESENCE_TTL_MS).toBe(25 * 60_000)
    // The website expires it at the same age.
    expect(PAGE_TTL_MS).toBe(PRESENCE_TTL_MS)
    // Both idle beats are past the rewrite limit, so each is written and told:
    // one lost beat still leaves a live Capture inside the expiry.
    for (const every of [300_000, IDLE_NEXT_S * 1000]) {
      expect(every).toBeGreaterThan(PRESENCE_REWRITE_MS)
      expect(2 * every).toBeLessThan(PRESENCE_TTL_MS)
      const { hub, puts, clock } = fakeHub()
      const beat = () =>
        heartbeat(hub, {
          sid: 9,
          device: 'PC-01',
          state: 'decoding',
          accountId: 5,
          uid: '812345678',
          platform: 'windows',
          app: '1.18.4',
        })
      for (let i = 0; i < 4; i++) {
        expect((await beat()).changed).toEqual([5])
        expect(puts()).toBe(i + 1)
        clock.now += every
      }
      // A beat lost: still there one beat later, gone at the expiry.
      clock.now += every - 1
      expect((await presenceFor(hub, 5)).presence).not.toBeNull()
      clock.now += PRESENCE_TTL_MS - 2 * every + 1
      expect((await presenceFor(hub, 5)).presence).toBeNull()
    }
  })

  it('keeps a page that loaded presence once showing a Capture that beats unchanged', async () => {
    const { client, me, account, importKey } = await setup()
    // The page's store, fed by its socket as live-updates.ts feeds it.
    const tab = await client.fetch('/api/live', {
      headers: { upgrade: 'websocket', origin: ORIGIN },
    })
    expect(tab.status).toBe(101)
    const socket = tab.webSocket!
    socket.accept()
    let told = 0
    socket.addEventListener('message', (message) => {
      const event = parseLiveEvent(String(message.data))
      if (event?.type !== 'presence' || event.accountId !== account.id) return
      told++
      setPresence(event.accountId, { presence: event.presence, pending: event.pending })
    })
    const clock = { now: Date.now() }
    await runInDurableObject(liveHub(env, me.id), async (object: LiveHub) => {
      object.clock = () => clock.now
    })
    const start = clock.now
    const beat = async (state = 'decoding') => {
      const response = await presence(importKey, { state, uid: 812345678 })
      expect(response.status).toBe(200)
      return ((await response.json()) as PresenceResponse).next
    }
    /** Waits until the store holds a presence last seen at `at` (null: none). */
    const shows = async (at: number | null) => {
      for (let i = 0; i < 100; i++) {
        const held = presenceOf(account.id, clock.now)?.presence?.at ?? null
        if (held === at) return
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      expect(presenceOf(account.id, clock.now)?.presence?.at ?? null).toBe(at)
    }

    expect(await beat()).toBe(WATCHED_NEXT_S)
    // The page loads it once.
    setPresence(
      account.id,
      await client.json<PresenceResponseForAccount>(`/api/accounts/${account.id}/presence`),
    )
    await shows(start)
    // Ten minutes in view (60 s beats), then twenty more of idle beats (600 s): nothing changes.
    for (let minute = 1; minute <= 10; minute++) {
      clock.now = start + minute * 60_000
      await beat()
    }
    for (const minute of [20, 30]) {
      clock.now = start + minute * 60_000
      await beat()
    }
    await shows(start + 30 * 60_000)
    // Half an hour later it still plays; the page asked nothing, it was told the rewrites only.
    expect(presenceOf(account.id, clock.now)?.presence?.state).toBe('decoding')
    expect(told).toBeLessThan(12)

    // The app crashes: no word, gone after the expiry, on the page and on the server.
    const last = clock.now
    clock.now = last + PRESENCE_TTL_MS - 1
    expect(presenceOf(account.id, clock.now)).not.toBeNull()
    // (The page keeps an entry exactly PRESENCE_TTL_MS old, the hub doesn't: 1 ms apart.)
    clock.now = last + PRESENCE_TTL_MS + 1
    expect(presenceOf(account.id, clock.now)).toBeNull()
    const server = await client.json<PresenceResponseForAccount>(
      `/api/accounts/${account.id}/presence`,
    )
    expect(server.presence).toBeNull()
    socket.close()
  })

  it('refuses a bad heartbeat', async () => {
    const { importKey } = await setup()
    expect((await presence(importKey, { state: 'dancing' })).status).toBe(400)
    expect((await presence('gdt_import_nope', { state: 'running' })).status).toBe(401)
  })
})
