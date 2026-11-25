import {
  readDeviceAlerts,
  toBase64Url,
  type AccountCreatedResponse,
  type DeviceAlerts,
  type ImportResponse,
  type PresenceResponse,
  type PresenceResponseForAccount,
  type PushConfigResponse,
  type SessionResponse,
} from '@gdt/shared'
import { env, runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { IDLE_NEXT_S, WATCHED_NEXT_S, liveHub, type LiveHub } from '../services/live'
import { RESIN_STEP_MS, alertMessage, type AccountFacts } from '../services/alerts'
import { parseLiveEvent } from '@/live/policy'
import { PRESENCE_TTL_MS as PAGE_TTL_MS, presenceOf, setPresence } from '@/live/presence-store'
import {
  PRESENCE_FORGET_MS,
  PRESENCE_REWRITE_MS,
  PRESENCE_TTL_MS,
  addFacts,
  heartbeat,
  presenceFor,
  queueCommand,
  schedule,
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

describe('alert facts from live batches', () => {
  const SESSION = 'SESSIONFORTEST03'
  const top = 812345678n << 32n

  /** A Capture snapshot that opens the account's journal; then batches on it. */
  async function liveCapture(importKey: string, takenAt: number) {
    const good = sampleGood(sampleExtras())
    const upload = await call(`${ORIGIN}/api/genshin-accounts-public/import-by-key`, {
      method: 'POST',
      headers: { 'x-import-key': importKey },
      body: irminsulForm(
        {
          ...good,
          artifacts: good.artifacts.map((a, i) => ({
            ...a,
            gi_guid: String(top + BigInt(100 + i)),
          })),
          weapons: good.weapons.map((w, i) => ({ ...w, gi_guid: String(top + BigInt(500 + i)) })),
          gi_capture: { v: 1, reason: 'login', session: SESSION, world: 1, journal: { seq: 0 } },
        },
        takenAt,
      ),
    })
    expect(upload.status).toBe(201)
    const base = ((await upload.json()) as ImportResponse).live!.base
    let seq = 0
    /** One batch of `changes` built at `at`, waiting for what it does after answering. */
    return async (changes: unknown[], at = Date.now()) => {
      seq++
      const sent = await call(`${ORIGIN}/api/irminsul/changes`, {
        method: 'POST',
        headers: { 'x-import-key': importKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          format: 'GOOD-X-delta',
          v: 1,
          uid: 812345678,
          session: SESSION,
          seq,
          base,
          at,
          changes,
        }),
      })
      expect(sent.status).toBe(200)
      const answer = (await sent.json()) as { ok: boolean; seq: number; watching?: boolean }
      expect(answer).toMatchObject({ ok: true, seq })
      return answer
    }
  }

  /** What the user's hub was told since it woke, and the account's kept facts. */
  const hubState = (userId: number, accountId: number) =>
    runInDurableObject(liveHub(env, userId), async (hub: LiveHub, state) => ({
      calls: hub.liveBatches,
      facts: hub.factsTold,
      notified: hub.notified,
      kept: await state.storage.get<AccountFacts>(`facts:${accountId}`),
    }))

  const MORA = ['set', ['materials', 'Mora'], 123_456]
  const resin = (value: number) => ['set', ['gi_player', 'resin'], value]

  it('tells the hub only a batch with a fact, in one call, and a rename with the next fact', async () => {
    const { client, me, account, importKey } = await setup()
    await subscribe(client)
    const batch = await liveCapture(importKey, Date.now() - 60_000)
    const start = await hubState(me.id, account.id)
    expect(start.kept).toMatchObject({ name: 'Main' })

    // No page open, nothing an alert reads: no call to the hub at all.
    await batch([MORA])
    expect(await hubState(me.id, account.id)).toEqual(start)

    // Renamed: the name waits for the next batch with a fact.
    await client.fetch(`/api/accounts/${account.id}`, { method: 'PATCH', json: { name: 'Alt' } })
    await batch([MORA])
    expect((await hubState(me.id, account.id)).kept).toMatchObject({ name: 'Main' })

    const now = Date.now()
    await batch([MORA, resin(150)], now)
    const told = await hubState(me.id, account.id)
    expect(told).toMatchObject({ calls: start.calls + 1, facts: start.facts + 1 })
    expect(told.kept).toMatchObject({ name: 'Alt', resin: { value: 150, at: now } })
    // Resin full in 50 steps: the alarm is there.
    const full = now + 50 * RESIN_STEP_MS
    expect(await liveHub(env, me.id).alarmAt()).toBe(full)

    // A page open: the event and the facts go in one call.
    const tab = await client.fetch('/api/live', {
      headers: { upgrade: 'websocket', origin: ORIGIN },
    })
    const socket = tab.webSocket!
    socket.accept()
    const before = await hubState(me.id, account.id)
    // Nothing for alerts: the event alone, and no storage row changes.
    await batch([MORA])
    const quiet = await hubState(me.id, account.id)
    expect(quiet).toMatchObject({
      calls: before.calls + 1,
      facts: before.facts,
      notified: before.notified + 1,
    })
    expect(quiet.kept).toEqual(before.kept)
    // A fact too: still one call.
    await batch([resin(151)], now + RESIN_STEP_MS)
    expect(await hubState(me.id, account.id)).toMatchObject({
      calls: before.calls + 2,
      facts: before.facts + 1,
      notified: before.notified + 2,
    })
    socket.close()

    // The same full time (151 one step later): the alarm stays where it was.
    expect(await liveHub(env, me.id).alarmAt()).toBe(full)

    // Due: sent, with the account's new name in its text.
    const service = pushService()
    const report = await runInDurableObject(liveHub(env, me.id), async (object: LiveHub) => {
      object.clock = () => full + 1_000
      object.fetcher = service.fetcher
      return object.fireNow()
    })
    expect(report).toMatchObject({ sent: 1 })
    const kept = (await hubState(me.id, account.id)).kept!
    const message = alertMessage({ kind: 'resinFull', key: `resinFull:${full}`, at: full }, kept, {
      lang: 'en',
      tz: 'UTC',
      accountId: account.id,
      now: full + 1_000,
    })
    expect(message.body.startsWith('Alt · ')).toBe(true)
  })

  it('a facts write that fails leaves `watching` as the view says', async () => {
    const { client, me, importKey } = await setup()
    await subscribe(client)
    const batch = await liveCapture(importKey, Date.now() - 60_000)
    // A page in view (just connected), and a hub whose facts write throws.
    const tab = await client.fetch('/api/live', {
      headers: { upgrade: 'websocket', origin: ORIGIN },
    })
    const socket = tab.webSocket!
    socket.accept()
    await runInDurableObject(liveHub(env, me.id), (object: LiveHub) => {
      object.alertFacts = async () => {
        throw new Error('storage down')
      }
    })
    expect((await batch([resin(150)])).watching).toBe(true)
    await runInDurableObject(liveHub(env, me.id), (object: LiveHub) => {
      delete (object as { alertFacts?: unknown }).alertFacts
    })
    socket.close()
  })

  it('sets the alarm only when the time it should go off at moves', async () => {
    let sets = 0
    let deletes = 0
    let alarm: number | null = null
    const map = new Map<string, unknown>([
      ['devices', [{ sid: 1, alerts: readDeviceAlerts({ resinFull: true }) }]],
    ])
    const clock = { now: 1_800_000_000_000 }
    const storage = {
      get: async (key: string) => structuredClone(map.get(key)),
      put: async (key: string, value: unknown) => void map.set(key, structuredClone(value)),
      delete: async (key: string) => map.delete(key),
      list: async ({ prefix }: { prefix: string }) =>
        new Map([...map].filter(([key]) => key.startsWith(prefix))),
      getAlarm: async () => alarm,
      setAlarm: async (at: number) => {
        sets++
        alarm = at
      },
      deleteAlarm: async () => {
        deletes++
        alarm = null
      },
    }
    const hub = {
      storage: storage as unknown as DurableObjectStorage,
      db: env.DB,
      vars: {},
      now: () => clock.now,
    } as unknown as HubContext
    const start = clock.now
    const full = start + 50 * RESIN_STEP_MS
    await addFacts(hub, 7, { resin: { value: 150, at: start } })
    expect(await schedule(hub)).toBe(full)
    expect([sets, alarm]).toEqual([1, full])
    // A count on the same grid, and time passing: the same full time, no write.
    await addFacts(hub, 7, { resin: { value: 151, at: start + RESIN_STEP_MS } })
    clock.now += 60_000
    await schedule(hub)
    expect(sets).toBe(1)
    // Resin spent: later.
    await addFacts(hub, 7, { resin: { value: 100, at: start + 2 * RESIN_STEP_MS } })
    await schedule(hub)
    expect([sets, alarm]).toEqual([2, start + 102 * RESIN_STEP_MS])
    // Nothing coming (no device): cleared once, then left alone.
    map.set('devices', [])
    await schedule(hub)
    await schedule(hub)
    expect([deletes, alarm]).toEqual([1, null])
  })
})

describe('presence review cases', () => {
  it('a listing deletes an entry expired for more than a day, and keeps the rest', async () => {
    const { hub, clock } = fakeHub()
    const beat = (sid: number) =>
      heartbeat(hub, {
        sid,
        device: `PC-0${sid}`,
        state: 'decoding',
        accountId: 3,
        uid: '812345678',
        platform: 'windows',
        app: '1.18.4',
      })
    const end = clock.now + PRESENCE_FORGET_MS + 1_000
    // 1: a day and a second past its end. 2: an hour past its end. 3: live.
    await beat(1)
    clock.now = end - PRESENCE_TTL_MS - 3_600_000
    await beat(2)
    clock.now = end - 1_000
    await beat(3)
    clock.now = end
    const kept = () =>
      Promise.all(
        [1, 2, 3].map(async (sid) => (await hub.storage.get(`presence:${sid}`)) !== undefined),
      )
    expect(await kept()).toEqual([true, true, true])
    // The next listing (the page's read) shows the live one and drops the old one.
    expect((await presenceFor(hub, 3)).presence).toMatchObject({ sid: 3 })
    expect(await kept()).toEqual([false, true, true])
    // Just short of a day past its end: kept.
    clock.now = end - PRESENCE_TTL_MS - 3_600_000 + PRESENCE_FORGET_MS - 1
    await presenceFor(hub, 3)
    expect(await hub.storage.get('presence:2')).toBeDefined()
  })
  it('two Captures on one account: a dead one never wins past the live one’s next beat', async () => {
    const { hub, clock } = fakeHub()
    const beat = (sid: number) =>
      heartbeat(hub, {
        sid,
        device: `PC-0${sid}`,
        state: 'decoding',
        accountId: 3,
        uid: '812345678',
        platform: 'windows',
        app: '1.18.4',
      })
    const start = clock.now
    const at = (s: number) => (clock.now = start + s * 1000)
    // B plays from 0, A from 230; both beat every 60 s (a page in view).
    for (let s = 0; s <= 470; s += 10) {
      at(s)
      if (s % 60 === 0) await beat(2)
      if (s >= 200 && (s - 200) % 60 === 30) await beat(1)
    }
    // A's beat at 470 was the last: it dies. With one app the hub would have
    // skipped B's beats since 300, leaving A (470) newer than B until B's 600.
    at(470)
    expect((await presenceFor(hub, 3)).presence?.sid).toBe(1)
    at(480)
    await beat(2)
    // Within one beat of B: the page shows B, and a command goes to B.
    expect((await presenceFor(hub, 3)).presence).toMatchObject({ sid: 2, at: start + 480_000 })
    expect(await queueCommand(hub, 3, 'wishes')).toMatchObject({ pending: ['wishes'] })
    at(540)
    expect((await beat(2)).commands.map((c) => c.kind)).toEqual(['wishes'])
    // Once A expires, B is alone again: its repeats are skipped as before.
    const { hub: alone, puts, clock: c2 } = fakeHub()
    c2.now = start
    await heartbeat(alone, {
      sid: 2,
      device: 'PC-02',
      state: 'decoding',
      accountId: 3,
      uid: '812345678',
      platform: 'windows',
      app: '1.18.4',
    })
    c2.now += 60_000
    await heartbeat(alone, {
      sid: 2,
      device: 'PC-02',
      state: 'decoding',
      accountId: 3,
      uid: '812345678',
      platform: 'windows',
      app: '1.18.4',
    })
    expect(puts()).toBe(1)
  })

  it('a skipped beat, then a lost one, then the retry: never shown as gone', async () => {
    const { client, me, account, importKey } = await setup()
    const clock = { now: Date.now() }
    await runInDurableObject(liveHub(env, me.id), async (object: LiveHub) => {
      object.clock = () => clock.now
    })
    const start = clock.now
    const at = (s: number) => (clock.now = start + s * 1000)
    const beat = async () => {
      const response = await presence(importKey, { state: 'decoding', uid: 812345678 })
      expect(response.status).toBe(200)
      return ((await response.json()) as PresenceResponse).next
    }
    const shown = async () =>
      (await client.json<PresenceResponseForAccount>(`/api/accounts/${account.id}/presence`))
        .presence
    // A page in view: 60 s beats, the first one written.
    const tab = await client.fetch('/api/live', {
      headers: { upgrade: 'websocket', origin: ORIGIN },
    })
    const socket = tab.webSocket!
    socket.accept()
    at(0)
    expect(await beat()).toBe(WATCHED_NEXT_S)
    // The page loads it (its copy says last seen at 0).
    setPresence(account.id, { presence: (await shown())!, pending: [] })
    for (const s of [60, 120, 180, 240]) {
      at(s)
      expect(await beat()).toBe(WATCHED_NEXT_S)
    }
    // The page goes out of view (its socket closes); the next beat, just under
    // the rewrite limit, is skipped and answered with the idle beat.
    socket.close()
    for (let i = 0; i < 100 && (await liveHub(env, me.id).sockets()) > 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    at(PRESENCE_REWRITE_MS / 1000 - 1)
    expect(await beat()).toBe(IDLE_NEXT_S)
    expect((await shown())?.at).toBe(start)
    // The beat 600 s later is lost; Capture retries after min(interval, 300 s)
    // (link.rs MAX_RETRY_SECS). Up to the retry, the app is shown on both sides.
    const retry = PRESENCE_REWRITE_MS / 1000 - 1 + IDLE_NEXT_S + 300
    expect(retry * 1000).toBeLessThan(PRESENCE_TTL_MS)
    at(retry - 0.001)
    expect(await shown()).not.toBeNull()
    expect(presenceOf(account.id, clock.now)).not.toBeNull()
    at(retry)
    expect(await beat()).toBe(IDLE_NEXT_S)
    expect((await shown())?.at).toBe(clock.now)
  })
})
