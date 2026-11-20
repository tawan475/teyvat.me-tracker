import {
  toBase64Url,
  type AccountCreatedResponse,
  type IrminsulTokenResponse,
  type MeResponse,
  type StaffAuditSummary,
  type StaffCapacityMetrics,
  type StaffFeatureInsights,
  type StaffHealthResponse,
  type StaffPeopleInsights,
  type StaffRetentionInsights,
  type StaffUploadInsights,
  type StaffUserFlagsResponse,
  type StaffUsersResponse,
} from '@gdt/shared'
import { env, SELF } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomToken } from '../lib/crypto'
import { forgetKept } from '../lib/keep'
import { forgetUsage, hourFigures, routeRefusals } from '../services/cf-usage'
import { listJobRuns, recordJob } from '../services/job-runs'
import { forgetMetrics, takeSample } from '../services/metrics'
import { utcDay } from '../services/upload-limits'
import { Client, ORIGIN, irminsulForm, sampleGood, signUp } from './client'

const REDIRECT = 'http://127.0.0.1:53682/callback'
const STATE = 'state-0123456789abcdefghijklmnopqrstuvwxyz'

// Every read is kept in the Worker instance: each test starts without.
const forget = () => {
  forgetKept()
  forgetMetrics()
  forgetUsage()
}
beforeEach(forget)
afterEach(() => vi.unstubAllGlobals())

async function grant(userId: number, role: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO user_roles (user_id, role_id, assigned_at)
     SELECT ?1, id, ?2 FROM roles WHERE name = ?3`,
  )
    .bind(userId, Date.now(), role)
    .run()
}

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

async function clientSignIn(client: Client, device: string, app?: string) {
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
      'cf-connecting-ip': `2001:db8:3::${Math.floor(Math.random() * 0xffff).toString(16)}`,
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
    body: JSON.stringify({ v: 1, state: 'running', ...body }),
  })
}

const clientRow = (userId: number) =>
  env.DB.prepare(
    `SELECT client_version AS version, client_platform AS platform, client_version_at AS at
     FROM user_sessions WHERE user_id = ?1 AND method = 'irminsul' ORDER BY id DESC`,
  )
    .bind(userId)
    .first<{ version: string | null; platform: string | null; at: number | null }>()

describe('staff insights: who may look', () => {
  it('needs site.metrics, and the Overview, Users and Audit parts their own nodes', async () => {
    const plain = await member()
    expect(await status(plain.client, '/api/staff/insights/people')).toBe(404)
    const support = await member('Support')
    for (const page of ['people', 'retention', 'features', 'uploads']) {
      expect(await status(support.client, `/api/staff/insights/${page}`), page).toBe(404)
    }
    // Support sees users, so the moderation counts; not the audit summary.
    expect(await status(support.client, '/api/staff/users/flags')).toBe(200)
    expect(await status(support.client, '/api/staff/audit/summary')).toBe(404)
    expect(await status(support.client, '/api/staff/health')).toBe(200)

    await roleWith('Figures', ['staff.view', 'site.metrics'])
    const figures = await member('Figures')
    for (const page of ['people', 'retention', 'features', 'uploads']) {
      expect(await status(figures.client, `/api/staff/insights/${page}`), page).toBe(200)
    }
    expect(await status(figures.client, '/api/staff/users/flags')).toBe(404)
  })
})

describe('staff insights: people', () => {
  it('counts users by country, with who is active, new, has a client and uploads', async () => {
    const owner = await member('Owner')
    const a = await member()
    const b = await member()
    await env.DB.prepare("UPDATE users SET signup_country = 'ZZ' WHERE id IN (?1, ?2)")
      .bind(a.me.id, b.me.id)
      .run()
    await createAccount(a.client, '812345701')
    await clientSignIn(a.client, 'EXAMPLE1', 'teyvatme')
    await env.DB.prepare(
      'INSERT INTO user_upload_days (user_id, day, snapshots, stored_bytes) VALUES (?1, ?2, 1, 100)',
    )
      .bind(a.me.id, utcDay(Date.now()))
      .run()
    const people = await owner.client.json<StaffPeopleInsights>('/api/staff/insights/people')
    expect(people.basis).toBe('signup')
    expect(people.countries.find((c) => c.code === 'ZZ')).toEqual({
      code: 'ZZ',
      users: 2,
      active7d: 2,
      new30d: 2,
      withClient: 1,
      uploading: 1,
    })
    // Everyone is counted once.
    expect(people.countries.reduce((sum, c) => sum + c.users, 0)).toBe(people.users)
    expect(people.ways.password).toBeGreaterThanOrEqual(3)
    expect(people.ways.oneWay).toBeGreaterThanOrEqual(3)
    expect(people.languages.reduce((sum, l) => sum + l.users, 0)).toBe(people.users)
    expect(people.servers.find((s) => s.key === 'ASIA')!.accounts).toBeGreaterThanOrEqual(1)
    // The other basis reads the newest session's place (none in tests).
    forget()
    const session = await owner.client.json<StaffPeopleInsights>(
      '/api/staff/insights/people?basis=session',
    )
    expect(session.basis).toBe('session')
    expect(session.countries.find((c) => c.code === 'ZZ')).toBeUndefined()
  })

  it("keeps a program's version from its heartbeat, written only when it changes", async () => {
    const owner = await member('Owner')
    const player = await member()
    await createAccount(player.client, '812345711')
    const tokens = await clientSignIn(player.client, 'EXAMPLE1', 'teyvatme')
    expect(await clientRow(player.me.id)).toEqual({ version: null, platform: null, at: null })

    await heartbeat(tokens.access_token, { uid: 812345711, app: '1.18.0', platform: 'windows' })
    const first = (await clientRow(player.me.id))!
    expect(first).toMatchObject({ version: '1.18.0', platform: 'windows' })
    expect(first.at).toBeGreaterThan(0)
    // The same again writes nothing: the first-heard time stays.
    await heartbeat(tokens.access_token, { uid: 812345711, app: '1.18.0', platform: 'windows' })
    expect((await clientRow(player.me.id))!.at).toBe(first.at)
    // An update is a new version, first heard now.
    await new Promise((resolve) => setTimeout(resolve, 5))
    await heartbeat(tokens.access_token, { uid: 812345711, app: '1.18.1', platform: 'windows' })
    const updated = (await clientRow(player.me.id))!
    expect(updated.version).toBe('1.18.1')
    expect(updated.at).toBeGreaterThan(first.at!)

    // Someone still on the older version, and another client by its own name.
    const behind = await member()
    await createAccount(behind.client, '812345712')
    const old = await clientSignIn(behind.client, 'EXAMPLE2', 'teyvatme')
    await heartbeat(old.access_token, { uid: 812345712, app: '1.17.9', platform: 'windows' })
    const other = await member()
    await clientSignIn(other.client, 'EXAMPLE3', 'other-client')

    const { clients } = await owner.client.json<StaffPeopleInsights>('/api/staff/insights/people')
    const desktop = (version: string) =>
      clients.find((c) => c.program === 'teyvat.me-desktop' && c.version === version)!
    expect(desktop('1.18.1')).toMatchObject({ old: false })
    expect(desktop('1.18.1').devices).toBeGreaterThanOrEqual(1)
    // 1.17.9 is behind 1.18.1 although it sorts after it as text.
    expect(desktop('1.17.9')).toMatchObject({ old: true })
    expect(clients.find((c) => c.program === 'other-client')).toMatchObject({
      version: null,
      old: false,
    })
  })
})

describe('staff insights: retention and guests', () => {
  it('follows each sign-up week by who still stores snapshots', async () => {
    const owner = await member('Owner')
    const before = await owner.client.json<StaffRetentionInsights>('/api/staff/insights/retention')
    const player = await member()
    await env.DB.prepare(
      'INSERT INTO user_upload_days (user_id, day, snapshots, stored_bytes) VALUES (?1, ?2, 1, 100)',
    )
      .bind(player.me.id, utcDay(Date.now()))
      .run()
    forget()
    const after = await owner.client.json<StaffRetentionInsights>('/api/staff/insights/retention')
    expect(after.cohorts).toHaveLength(12)
    const week = after.cohorts.at(-1)!
    const was = before.cohorts.at(-1)!
    expect(week.week).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(new Date(`${week.week}T00:00:00Z`).getUTCDay()).toBe(1)
    expect(week.users - was.users).toBe(1)
    expect(week.active[0]! - was.active[0]!).toBe(1)
    // The weeks after this one have not come yet.
    expect(week.active.slice(1).every((value) => value === null)).toBe(true)
    // The oldest week has every week behind it.
    expect(after.cohorts[0]!.active.every((value) => value !== null)).toBe(true)
    expect(after.months.at(-1)!.users).toBeGreaterThanOrEqual(2)
    expect(after.months.at(-1)!.seen7d).toBeGreaterThanOrEqual(2)
  })

  it('remembers a sign-up that came with a guest account', async () => {
    const owner = await member('Owner')
    const before = await owner.client.json<StaffRetentionInsights>('/api/staff/insights/retention')
    const guest = new Client()
    const me = await guest.json<MeResponse>('/api/auth/register', {
      method: 'POST',
      json: {
        username: `guest${crypto.randomUUID().slice(0, 8)}`,
        password: 'correct horse battery staple',
        guest: true,
      },
    })
    const row = await env.DB.prepare('SELECT from_guest FROM users WHERE id = ?1')
      .bind(me.id)
      .first<{ from_guest: number }>()
    expect(row!.from_guest).toBe(1)
    await member()
    forget()
    const after = await owner.client.json<StaffRetentionInsights>('/api/staff/insights/retention')
    expect(after.guests.signups - before.guests.signups).toBe(2)
    expect(after.guests.fromGuest - before.guests.fromGuest).toBe(1)
    expect(after.guests.stillActive - before.guests.stillActive).toBe(1)
  })
})

describe('staff insights: features and uploads', () => {
  it('counts the accounts that use each part, and the ones that changed it lately', async () => {
    const owner = await member('Owner')
    const before = await owner.client.json<StaffFeatureInsights>('/api/staff/insights/features')
    const player = await member()
    const { account } = await createAccount(player.client, '812345721')
    const now = Date.now()
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO planner_targets (account_id, kind, key, owner, target, updated_at)
         VALUES (?1, 'character', 'Amber', '', '{}', ?2)`,
      ).bind(account.id, now - 30 * 86_400_000),
      env.DB.prepare(
        'INSERT INTO achievement_marks (account_id, achievement_id, updated_at) VALUES (?1, 80001, ?2)',
      ).bind(account.id, now),
      env.DB.prepare(
        `INSERT INTO user_sessions (user_id, method, created_at, last_seen_at, expires_at, alerts)
         VALUES (?1, 'password', ?2, ?2, ?3, ?4)`,
      ).bind(
        player.me.id,
        now,
        now + 86_400_000,
        JSON.stringify({ resin: 160, resinFull: false, expeditions: true }),
      ),
    ])
    forget()
    const after = await owner.client.json<StaffFeatureInsights>('/api/staff/insights/features')
    const feature = (data: StaffFeatureInsights, key: string) =>
      data.features.find((f) => f.key === key)!
    expect(after.accounts - before.accounts).toBe(1)
    expect(feature(after, 'plannerGoals').accounts - feature(before, 'plannerGoals').accounts).toBe(
      1,
    )
    // The goal is a month old: not changed in the last 7 days.
    expect(
      feature(after, 'plannerGoals').changed7d - feature(before, 'plannerGoals').changed7d,
    ).toBe(0)
    expect(
      feature(after, 'achievements').changed7d - feature(before, 'achievements').changed7d,
    ).toBe(1)
    expect(after.alerts.devices - before.alerts.devices).toBe(1)
    expect(after.alerts.kinds.resin - before.alerts.kinds.resin).toBe(1)
    expect(after.alerts.kinds.expeditions - before.alerts.kinds.expeditions).toBe(1)
    expect(after.alerts.kinds.resinFull - before.alerts.kinds.resinFull).toBe(0)
    expect(after.api.tokens).toBeGreaterThanOrEqual(0)
  })

  it('finds who is at a daily cap, and what the last day of uploads came from', async () => {
    const owner = await member('Owner')
    const before = await owner.client.json<StaffUploadInsights>('/api/staff/insights/uploads')
    const player = await member()
    const { importKey } = await createAccount(player.client, '812345731')
    const upload = await SELF.fetch(`${ORIGIN}/api/genshin-accounts-public/import-by-key`, {
      method: 'POST',
      headers: { 'x-import-key': importKey },
      body: irminsulForm(sampleGood()),
    })
    expect(upload.status).toBeLessThan(300)
    await env.DB.prepare(
      `INSERT INTO user_upload_days (user_id, day, snapshots, stored_bytes) VALUES (?1, ?2, ?3, 10)
       ON CONFLICT (user_id, day) DO UPDATE SET snapshots = excluded.snapshots`,
    )
      .bind(player.me.id, utcDay(Date.now()), before.limits.dailySnapshots)
      .run()
    forget()
    const after = await owner.client.json<StaffUploadInsights>('/api/staff/insights/uploads')
    expect(after.atCapToday - before.atCapToday).toBe(1)
    expect(after.atCapWeek - before.atCapWeek).toBe(1)
    expect(after.snapshots24h - before.snapshots24h).toBe(1)
    expect(after.sampled - before.sampled).toBe(1)
    expect(after.sources.reduce((sum, s) => sum + s.snapshots, 0)).toBe(after.sampled)
    expect(after.reasons.reduce((sum, r) => sum + r.snapshots, 0)).toBe(after.sampled)
  })
})

describe('staff Overview: health and job runs', () => {
  it('records each scheduled run, and a failure with its error', async () => {
    const result = await recordJob(
      env.DB,
      'events',
      async () => ({ ok: false, counts: { a: 1 } }),
      (r) => ({
        ok: r.ok,
        detail: r,
      }),
    )
    expect(result.ok).toBe(false)
    await expect(
      recordJob(env.DB, 'maintenance', async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    await recordJob(env.DB, 'sample', () => takeSample(env))
    const runs = await listJobRuns(env.DB)
    expect(runs.find((r) => r.job === 'events')).toMatchObject({ ok: false, detail: { ok: false } })
    expect(runs.find((r) => r.job === 'maintenance')).toMatchObject({
      ok: false,
      detail: { error: 'Error: boom' },
    })
    expect(runs.find((r) => r.job === 'sample')!.ok).toBe(true)

    const owner = await member('Owner')
    const health = await owner.client.json<StaffHealthResponse>('/api/staff/health')
    expect(health.features).toMatchObject({ usage: false, usageZone: false, liveDb: true })
    expect(health.lastSampleAt).toBeGreaterThan(0)
    expect(health.liveMigrations).toBeGreaterThan(0)
    expect(health.jobs.map((j) => j.job)).toEqual(
      expect.arrayContaining(['sample', 'events', 'maintenance']),
    )
  })
})

describe('staff Users: moderation filters and country', () => {
  it('flags sign-up bursts, shared UIDs and many accounts, and says why', async () => {
    const owner = await member('Owner')
    const before = await owner.client.json<StaffUserFlagsResponse>('/api/staff/users/flags')
    const trio = [await member(), await member(), await member()]
    const hour = Math.floor(Date.now() / 3_600_000) * 3_600_000
    await env.DB.prepare(
      `UPDATE users SET signup_ip = '2001:db8:9::77', created_at = ?4, signup_country = 'YY'
       WHERE id IN (?1, ?2, ?3)`,
    )
      .bind(trio[0]!.me.id, trio[1]!.me.id, trio[2]!.me.id, hour + 60_000)
      .run()
    // Two of them claim one UID.
    await createAccount(trio[0]!.client, '812345741')
    await createAccount(trio[1]!.client, '812345741')
    forget()
    const flags = await owner.client.json<StaffUserFlagsResponse>('/api/staff/users/flags')
    expect(flags.burst - before.burst).toBe(3)
    expect(flags.sharedUid - before.sharedUid).toBe(2)
    expect(flags.manyAccounts - before.manyAccounts).toBe(0)

    const burst = await owner.client.json<StaffUsersResponse>('/api/staff/users?filter=burst')
    const ids = trio.map((u) => u.me.id)
    expect(burst.users.filter((u) => ids.includes(u.id))).toHaveLength(3)
    expect(burst.users.find((u) => u.id === ids[0])!.flagValue).toBe(3)
    const shared = await owner.client.json<StaffUsersResponse>('/api/staff/users?filter=sharedUid')
    expect(shared.users.find((u) => u.id === ids[0])!.flagValue).toBe('812345741')
    expect(shared.users.map((u) => u.id)).not.toContain(ids[2])

    // The country narrows the list (and its chips) like a search does.
    const country = await owner.client.json<StaffUsersResponse>('/api/staff/users?country=yy')
    expect(country.users.map((u) => u.id).sort()).toEqual([...ids].sort())
    expect(country.counts.all).toBe(3)
    // Other filters carry no reason.
    expect(country.users[0]!.flagValue).toBeUndefined()
  })
})

describe('staff Audit: the summary', () => {
  it('counts the last 30 days of actions per day and per staff member', async () => {
    const owner = await member('Owner')
    await owner.client.fetch('/api/staff/metrics/online')
    const summary = await owner.client.json<StaffAuditSummary>('/api/staff/audit/summary')
    expect(summary.days).toHaveLength(30)
    expect(summary.days.at(-1)!.day).toBe(utcDay(Date.now()))
    expect(Number(summary.days.at(-1)!.other)).toBeGreaterThanOrEqual(1)
    expect(summary.actors.find((a) => a.id === owner.me.id)).toMatchObject({
      label: owner.username,
      actions: 1,
      views: 0,
      deletes: 0,
    })
  })
})

describe("Cloudflare's hourly figures and refusals by route", () => {
  const withUsage = () =>
    ({
      ...env,
      CF_ANALYTICS_TOKEN: 'test-token',
      CF_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
      CF_ZONE_ID: 'fedcba9876543210fedcba9876543210',
    }) as Env

  function cloudflare() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const query = String((JSON.parse(String(init.body)) as { query: string }).query)
        if (query.includes('dimensions')) {
          return Response.json({
            data: {
              viewer: {
                zones: [
                  {
                    httpRequestsAdaptiveGroups: [
                      {
                        count: 17,
                        dimensions: {
                          clientRequestPath: '/api/irminsul/changes',
                          edgeResponseStatus: 409,
                        },
                      },
                      {
                        count: 4,
                        dimensions: {
                          clientRequestPath: '/api/irminsul/changes',
                          edgeResponseStatus: 429,
                        },
                      },
                      {
                        count: 2,
                        dimensions: {
                          clientRequestPath: '/api/accounts/12/bundle',
                          edgeResponseStatus: 500,
                        },
                      },
                      {
                        count: 3,
                        dimensions: {
                          clientRequestPath: '/api/accounts/7/bundle',
                          edgeResponseStatus: 404,
                        },
                      },
                    ],
                  },
                ],
              },
            },
          })
        }
        if (query.includes('zones')) {
          const count = query.includes('edgeResponseStatus: 429')
            ? 4
            : query.includes('_geq: 500')
              ? 2
              : 20
          return Response.json({
            data: { viewer: { zones: [{ httpRequestsAdaptiveGroups: [{ count }] }] } },
          })
        }
        if (query.includes('cpuTimeUs')) {
          return Response.json({ data: null, errors: [{ message: 'unknown field' }] })
        }
        const field = query.includes('sum { errors }') ? 'errors' : 'requests'
        return Response.json({
          data: {
            viewer: {
              accounts: [
                {
                  workersInvocationsAdaptive: [{ sum: { [field]: field === 'errors' ? 3 : 900 } }],
                },
              ],
            },
          },
        })
      }),
    )
  }

  it('groups refused requests by route, ids folded', async () => {
    cloudflare()
    expect(await routeRefusals(env)).toBeNull()
    expect(await routeRefusals(withUsage())).toEqual([
      { route: '/api/irminsul/changes', http4xx: 17, http429: 4, http5xx: 0 },
      { route: '/api/accounts/:id/bundle', http4xx: 3, http429: 0, http5xx: 2 },
    ])
  })

  it('rides in the hourly reading, and Capacity answers the history', async () => {
    cloudflare()
    const hour = Math.floor(Date.now() / 3_600_000) * 3_600_000
    expect(await hourFigures(env, hour)).toBeNull()
    const sample = await takeSample(withUsage(), hour + 1000)
    expect(sample.cf).toEqual({
      requests: 900,
      errors: 3,
      // Cloudflare refused this one: unknown, and the rest are kept.
      cpuMs: null,
      http4xx: 20,
      http429: 4,
      http5xx: 2,
    })
    const owner = await member('Owner')
    const capacity = await owner.client.json<StaffCapacityMetrics>(
      '/api/staff/metrics/capacity?range=24h',
    )
    expect(capacity.range).toBe('24h')
    expect(capacity.routes).toBeNull()
    expect(capacity.history.at(-1)).toMatchObject({ at: hour, cf: { requests: 900, http429: 4 } })
  })
})
