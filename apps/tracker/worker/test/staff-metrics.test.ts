import {
  toBase64Url,
  type AccountCreatedResponse,
  type IrminsulTokenResponse,
  type StaffActivityMetrics,
  type StaffCapacityMetrics,
  type StaffLiveMetrics,
  type StaffNowMetrics,
  type StaffOnlineResponse,
} from '@gdt/shared'
import { env, SELF } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomToken } from '../lib/crypto'
import { cloudflareUsage, forgetUsage, liveRouteCounts } from '../services/cf-usage'
import { forgetMetrics, takeSample } from '../services/metrics'
import { utcDay } from '../services/upload-limits'
import { Client, ORIGIN, signUp } from './client'

const REDIRECT = 'http://127.0.0.1:53682/callback'
const STATE = 'state-0123456789abcdefghijklmnopqrstuvwxyz'

// Every read is kept a minute in the Worker instance: each test starts without.
beforeEach(() => {
  forgetMetrics()
  forgetUsage()
})
afterEach(() => vi.unstubAllGlobals())

async function grant(userId: number, role: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO user_roles (user_id, role_id, assigned_at)
     SELECT ?1, id, ?2 FROM roles WHERE name = ?3`,
  )
    .bind(userId, Date.now(), role)
    .run()
}

/** A role with exactly `permissions`, below every seeded role. */
async function roleWith(name: string, permissions: string[]): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO roles (name, color, position, permissions, created_at)
     SELECT ?1, '#64748b', (SELECT min(position) - 1 FROM roles), ?2, ?3
     WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = ?1)`,
  )
    .bind(name, JSON.stringify(permissions), Date.now())
    .run()
}

async function member(role?: string) {
  const user = await signUp()
  if (role) await grant(user.me.id, role)
  return user
}

const status = async (client: Client, path: string) => (await client.fetch(path)).status

async function createAccount(client: Client, uid: string) {
  return client.json<AccountCreatedResponse>('/api/accounts', {
    method: 'POST',
    json: { name: 'Main', uid, server: 'ASIA' },
  })
}

/** Signs a client program in for `client`'s user; `app` is the name it gives itself. */
async function captureSignIn(client: Client, device: string, app?: string) {
  const verifier = randomToken(32)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  const { redirect } = await client.json<{ redirect: string }>('/api/oauth/authorize', {
    method: 'POST',
    json: {
      client_id: 'irminsul',
      redirect_uri: REDIRECT,
      state: STATE,
      code_challenge: toBase64Url(new Uint8Array(digest)),
      code_challenge_method: 'S256',
      device,
      upload: { mode: 'uid' },
    },
  })
  const response = await SELF.fetch(`${ORIGIN}/api/oauth/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': `2001:db8:2::${Math.floor(Math.random() * 0xffff).toString(16)}`,
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: 'irminsul',
      code: new URL(redirect).searchParams.get('code'),
      code_verifier: verifier,
      redirect_uri: REDIRECT,
      ...(app === undefined ? {} : { app }),
    }),
  })
  expect(response.status).toBe(200)
  return (await response.json()) as IrminsulTokenResponse
}

function heartbeat(access: string, body: object) {
  return SELF.fetch(`${ORIGIN}/api/irminsul/presence`, {
    method: 'POST',
    headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
    body: JSON.stringify({ v: 1, ...body }),
  })
}

/** A live journal as an upload would leave it. */
async function journal(
  accountId: number,
  userId: number,
  values: { updatedAt?: number; seq?: number; batches?: number; day?: string } = {},
) {
  const now = Date.now()
  await env.LIVE_DB.prepare(
    `INSERT INTO live_journals (account_id, user_id, base_key, base_snapshot_id, session, last_seq,
       opened_at, updated_at, changes, bytes, day, day_batches)
     VALUES (?1, ?2, 'k', 1, '', ?3, ?4, ?5, 12, 340, ?6, ?7)`,
  )
    .bind(
      accountId,
      userId,
      values.seq ?? 5,
      now - 3_600_000,
      values.updatedAt ?? now,
      values.day ?? utcDay(now),
      values.batches ?? 7,
    )
    .run()
}

/** Marks the user as having the site open, as their hub does on its first socket. */
const openSite = (userId: number) =>
  env.DB.prepare('UPDATE users SET live_since = ?2 WHERE id = ?1')
    .bind(userId, Date.now() - 120_000)
    .run()

const sessionClient = (userId: number) =>
  env.DB.prepare(
    "SELECT client FROM user_sessions WHERE user_id = ?1 AND method = 'irminsul' ORDER BY id DESC",
  )
    .bind(userId)
    .first<{ client: string | null }>()

describe('staff metrics: who may look', () => {
  it('is a 404 without site.metrics, and the lists that name users need users.view', async () => {
    const plain = await member()
    expect(await status(plain.client, '/api/staff/metrics/now')).toBe(404)
    // The seeded roles do not hold the new node: the Owner hands it out.
    const support = await member('Support')
    expect(await status(support.client, '/api/staff/metrics/now')).toBe(404)

    await roleWith('Numbers', ['staff.view', 'site.metrics'])
    const numbers = await member('Numbers')
    for (const page of ['now', 'live', 'activity', 'capacity']) {
      expect(await status(numbers.client, `/api/staff/metrics/${page}`), page).toBe(200)
    }
    expect(await status(numbers.client, '/api/staff/metrics/online')).toBe(404)
    const live = await numbers.client.json<StaffLiveMetrics>('/api/staff/metrics/live')
    expect(live.rows).toBeUndefined()

    const owner = await member('Owner')
    expect(await status(owner.client, '/api/staff/metrics/online')).toBe(200)
    expect(
      (await owner.client.json<StaffLiveMetrics>('/api/staff/metrics/live')).rows,
    ).toBeDefined()
  })

  it('keeps a read for a minute: a second look costs nothing new', async () => {
    const owner = await member('Owner')
    const first = await owner.client.json<StaffNowMetrics>('/api/staff/metrics/now')
    await member()
    const second = await owner.client.json<StaffNowMetrics>('/api/staff/metrics/now')
    expect(second.at).toBe(first.at)
    expect(second.users).toBe(first.users)
    forgetMetrics()
    const third = await owner.client.json<StaffNowMetrics>('/api/staff/metrics/now')
    expect(third.users).toBe(first.users + 1)
  })
})

describe('staff metrics: now', () => {
  it('counts site sockets, Capture sign-ins and journals from what the site keeps', async () => {
    const owner = await member('Owner')
    const before = await owner.client.json<StaffNowMetrics>('/api/staff/metrics/now')

    const player = await member()
    const { account } = await createAccount(player.client, '812345601')
    await captureSignIn(player.client, 'EXAMPLE1', 'teyvatme')
    await journal(account.id, player.me.id, { batches: 7 })
    // Set last: a write that tells a hub without sockets clears the mark (it heals itself).
    await openSite(player.me.id)
    // A journal that last moved an hour ago is open, not in game.
    const idle = await member()
    const other = await createAccount(idle.client, '812345602')
    await journal(other.account.id, idle.me.id, { updatedAt: Date.now() - 3_600_000, batches: 3 })

    forgetMetrics()
    const after = await owner.client.json<StaffNowMetrics>('/api/staff/metrics/now')
    expect(after.online - before.online).toBe(1)
    expect(after.captureDevices - before.captureDevices).toBe(1)
    expect(after.captureRunning - before.captureRunning).toBe(1)
    expect(after.journals - before.journals).toBe(2)
    expect(after.inGame - before.inGame).toBe(1)
    expect(after.batchesToday - before.batchesToday).toBe(10)
    expect(after.users - before.users).toBe(2)
    // Signing up stamps last_active_at: both count as active today.
    expect(after.dau - before.dau).toBe(2)
  })

  it('stores one reading an hour for the whole site, and draws the trend from it', async () => {
    const hour = 3_600_000
    const at = Math.floor(Date.now() / hour) * hour
    const count = async () =>
      (await env.DB.prepare('SELECT count(*) AS n FROM site_samples').first<{ n: number }>())!.n
    const rows = await count()
    const sample = await takeSample(env, at + 60_000)
    expect(sample.at).toBe(at)
    expect(sample.users).toBeGreaterThan(0)
    // The same hour again replaces its row.
    await member()
    const again = await takeSample(env, at + 120_000)
    expect(again.users).toBe(sample.users + 1)
    expect(await count()).toBe(rows + 1)

    const owner = await member('Owner')
    const now = await owner.client.json<StaffNowMetrics>('/api/staff/metrics/now?range=7d')
    expect(now.range).toBe('7d')
    expect(now.trend.at(-1)).toMatchObject({ at, users: again.users })
    // An unknown range is the default.
    forgetMetrics()
    expect((await owner.client.json<StaffNowMetrics>('/api/staff/metrics/now?range=x')).range).toBe(
      '24h',
    )
  })
})

describe('staff metrics: online', () => {
  it('lists who is on the site or running a client, with what the client said', async () => {
    const owner = await member('Owner')
    const player = await member()
    const { account } = await createAccount(player.client, '812345611')
    const capture = await captureSignIn(player.client, 'EXAMPLE1', 'teyvatme')
    expect(
      (
        await heartbeat(capture.access_token, {
          state: 'decoding',
          uid: 812345611,
          app: '1.18.1',
          platform: 'windows',
        })
      ).status,
    ).toBe(200)
    await journal(account.id, player.me.id, { batches: 41 })
    await openSite(player.me.id)

    // Another program, signed in and not heard from: its own name, state unknown.
    const other = await member()
    await createAccount(other.client, '812345612')
    await captureSignIn(other.client, 'EXAMPLE2', 'other-client')

    const list = await owner.client.json<StaffOnlineResponse>('/api/staff/metrics/online')
    expect(list.dailyCap).toBe(2000)
    const row = list.rows.find((r) => r.id === player.me.id)!
    expect(row).toMatchObject({
      username: player.username,
      account: { id: account.id, uid: '812345611', server: 'ASIA' },
      batchesToday: 41,
      capture: {
        state: 'decoding',
        device: 'EXAMPLE1',
        program: 'teyvat.me-desktop',
        version: '1.18.1',
      },
    })
    expect(row.siteSince).toBeGreaterThan(0)
    expect(row.lastBatchAt).toBeGreaterThan(0)
    const second = list.rows.find((r) => r.id === other.me.id)!
    // Signed up, no socket: the site is not open.
    expect(second.siteSince).toBeNull()
    expect(second.capture).toMatchObject({
      state: 'seen',
      program: 'other-client',
      version: null,
    })

    // The filters: sending live changes, and the site open.
    forgetMetrics()
    const game = await owner.client.json<StaffOnlineResponse>(
      '/api/staff/metrics/online?filter=game',
    )
    expect(game.rows.map((r) => r.id)).toContain(player.me.id)
    expect(game.rows.map((r) => r.id)).not.toContain(other.me.id)
    expect(game.total).toBe(game.counts.game)
    expect(game.counts.all).toBeGreaterThanOrEqual(game.counts.game)
  })

  it('hides the device name from staff who may not see private details', async () => {
    const player = await member()
    await createAccount(player.client, '812345621')
    await captureSignIn(player.client, 'EXAMPLE3', 'teyvatme')
    await roleWith('Watcher', ['staff.view', 'site.metrics', 'users.view'])
    const watcher = await member('Watcher')
    const list = await watcher.client.json<StaffOnlineResponse>('/api/staff/metrics/online')
    const row = list.rows.find((r) => r.id === player.me.id)!
    expect(row.capture).toMatchObject({ state: 'seen', program: 'teyvat.me', device: null })

    const owner = await member('Owner')
    const full = await owner.client.json<StaffOnlineResponse>('/api/staff/metrics/online')
    expect(full.rows.find((r) => r.id === player.me.id)!.capture!.device).toBe('EXAMPLE3')
  })

  it('logs one look per staff member per ten minutes', async () => {
    const owner = await member('Owner')
    await owner.client.fetch('/api/staff/metrics/online')
    await owner.client.fetch('/api/staff/metrics/online?filter=site')
    const { results } = await env.DB.prepare(
      "SELECT id FROM admin_audit WHERE actor_user_id = ?1 AND action = 'site.metrics_online'",
    )
      .bind(owner.me.id)
      .all()
    expect(results).toHaveLength(1)
  })
})

describe('staff metrics: live sync, activity, capacity', () => {
  it('sums the journals and lists them with their owners', async () => {
    const owner = await member('Owner')
    const before = await owner.client.json<StaffLiveMetrics>('/api/staff/metrics/live')
    const player = await member()
    const { account } = await createAccount(player.client, '812345631')
    await journal(account.id, player.me.id, { batches: 2000, seq: 2100 })
    forgetMetrics()
    const live = await owner.client.json<StaffLiveMetrics>('/api/staff/metrics/live?sort=today')
    expect(live.journals - before.journals).toBe(1)
    expect(live.health.atCap - before.health.atCap).toBe(1)
    expect(live.batchesToday - before.batchesToday).toBe(2000)
    expect(live.health.resyncs24h).toBeNull()
    expect(live.days).toHaveLength(30)
    expect(live.rows![0]).toMatchObject({
      accountId: account.id,
      uid: '812345631',
      owner: { id: player.me.id, username: player.username },
      seq: 2100,
      today: 2000,
      changes: 12,
    })
  })

  it('reads activity from the users, their upload days and the readings', async () => {
    const owner = await member('Owner')
    const player = await member()
    await env.DB.prepare(
      'INSERT INTO user_upload_days (user_id, day, snapshots, stored_bytes) VALUES (?1, ?2, 3, 4096)',
    )
      .bind(player.me.id, utcDay(Date.now()))
      .run()
    await takeSample(env)
    const activity = await owner.client.json<StaffActivityMetrics>(
      '/api/staff/metrics/activity?range=90d',
    )
    expect(activity.range).toBe('90d')
    expect(activity.signups).toHaveLength(90)
    expect(Number(activity.signups.at(-1)!.password)).toBeGreaterThanOrEqual(2)
    expect(activity.uploads).toHaveLength(30)
    expect(Number(activity.uploads.at(-1)!.uploaders)).toBeGreaterThanOrEqual(1)
    expect(Number(activity.uploads.at(-1)!.snapshots)).toBeGreaterThanOrEqual(3)
    expect(activity.active.at(-1)).toMatchObject({ day: utcDay(Date.now()) })
    expect(activity.dau).toBeGreaterThanOrEqual(2)
    const { today, week, month, older } = activity.lastSeen
    expect(today + week + month + older).toBe(activity.users)
  })

  it('answers the database sizes, and no usage while the token is not set', async () => {
    const owner = await member('Owner')
    const capacity = await owner.client.json<StaffCapacityMetrics>('/api/staff/metrics/capacity')
    expect(capacity.usage).toBeNull()
    expect(capacity.databases.map((d) => d.name)).toEqual(['gdt', 'gdt-live'])
    expect(capacity.databases[0]!.limit).toBe(10 * 1024 ** 3)
    expect(capacity.storage.sectionBytes).toBeGreaterThanOrEqual(0)
    expect(capacity.growthPerDay).toBeGreaterThanOrEqual(0)
  })
})

describe('Cloudflare usage', () => {
  const ACCOUNT = '0123456789abcdef0123456789abcdef'
  const ZONE = 'fedcba9876543210fedcba9876543210'
  const withUsage = (extra: Record<string, string> = {}) =>
    ({ ...env, CF_ANALYTICS_TOKEN: 'test-token', CF_ACCOUNT_ID: ACCOUNT, ...extra }) as Env

  it('is off without both secrets', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    expect(await cloudflareUsage(env)).toBeNull()
    expect(await cloudflareUsage({ ...env, CF_ANALYTICS_TOKEN: 'test-token' } as Env)).toBeNull()
    expect(await liveRouteCounts(withUsage())).toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('asks each figure on its own, keeps the answer, and never repeats the token', async () => {
    const asked: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        expect(new Headers(init.headers).get('authorization')).toBe('Bearer test-token')
        const query = String((JSON.parse(String(init.body)) as { query: string }).query)
        asked.push(query)
        expect(query).not.toContain('test-token')
        const sum = (field: string, value: number) =>
          Response.json({
            data: {
              viewer: {
                accounts: [{ [/(\w+)\(limit/.exec(query)![1]!]: [{ sum: { [field]: value } }] }],
              },
            },
          })
        if (query.includes('cpuTimeUs')) {
          return Response.json({ data: null, errors: [{ message: 'unknown field' }] })
        }
        if (query.includes('workersInvocationsAdaptive')) return sum('requests', 12_000_000)
        if (query.includes('rowsRead')) return sum('rowsRead', 310_000_000)
        if (query.includes('rowsWritten')) return sum('rowsWritten', 51_000_000)
        if (query.includes('durableObjectsInvocationsAdaptiveGroups'))
          return sum('requests', 900_000)
        if (query.includes('activeTime')) return sum('activeTime', 8_000_000_000)
        if (query.includes('edgeResponseStatus: 409')) {
          return Response.json({
            data: { viewer: { zones: [{ httpRequestsAdaptiveGroups: [{ count: 17 }] }] } },
          })
        }
        return Response.json({
          data: { viewer: { zones: [{ httpRequestsAdaptiveGroups: [] }] } },
        })
      }),
    )
    const now = Date.UTC(2026, 10, 16, 0, 0, 0)
    const usage = (await cloudflareUsage(withUsage(), now))!
    expect(Object.fromEntries(usage.items.map((i) => [i.key, i.used]))).toEqual({
      requests: 12_000_000,
      // Cloudflare refused this one: unknown, and the rest still show.
      cpuMs: null,
      d1Read: 310_000_000,
      d1Written: 51_000_000,
      doRequests: 900_000,
      doDuration: 1000,
    })
    expect(usage.from).toBe(Date.UTC(2026, 10, 1))
    // $5 + 2M requests over ($0.60) + 1M rows written over ($1.00).
    expect(usage.billUsd).toBe(6.6)
    // Half the month gone: twice the usage by its end.
    expect(usage.projectedUsd).toBeGreaterThan(usage.billUsd)
    expect(asked).toHaveLength(6)
    await cloudflareUsage(withUsage(), now + 60_000)
    expect(asked).toHaveLength(6)

    expect(await liveRouteCounts(withUsage({ CF_ZONE_ID: ZONE }), now)).toEqual({
      resyncs: 17,
      capRefusals: 0,
    })
  })
})

describe('the client program a sign-in names', () => {
  it('is kept as the client gave it, when it is a plain name', async () => {
    const teyvat = await member()
    await captureSignIn(teyvat.client, 'EXAMPLE1', 'teyvatme')
    expect((await sessionClient(teyvat.me.id))?.client).toBe('teyvatme')

    const other = await member()
    await captureSignIn(other.client, 'EXAMPLE1', 'Other-Client')
    expect((await sessionClient(other.me.id))?.client).toBe('other-client')

    // irminsul sends none; a name that is not a plain one is not kept.
    const old = await member()
    await captureSignIn(old.client, 'EXAMPLE1')
    expect((await sessionClient(old.me.id))?.client).toBeNull()
    const odd = await member()
    await captureSignIn(odd.client, 'EXAMPLE1', '<script>alert(1)</script>')
    expect((await sessionClient(odd.me.id))?.client).toBeNull()
  })
})
