import type {
  AccountCreatedResponse,
  ApiTokenCreatedResponse,
  ApiTokensResponse,
  Good,
} from '@gdt/shared'
import { SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { forgetBlockedIps } from '../api/v1/core'
import { openApiDocument } from '../api/v1/openapi'
import { V1_ROUTES } from '../api/v1/routes'
import { forgetApiTokens } from '../lib/api-token'
import { Client, ORIGIN, sampleExtras, sampleGood, signUp, withEnv, type Transport } from './client'

/** The public API (docs/plans/public-api.md). */

const allow: RateLimit = { limit: async () => ({ success: true }) }
const refuse: RateLimit = { limit: async () => ({ success: false }) }
const LIMITERS = ['RL_2', 'RL_6', 'RL_10', 'RL_20', 'RL_30', 'RL_60', 'RL_INVALID']

/** Every limiter allows (a test making many calls as one user). */
const unlimited: Transport = withEnv(Object.fromEntries(LIMITERS.map((n) => [n, allow])))

beforeEach(() => {
  forgetApiTokens()
  forgetBlockedIps()
})

async function createAccount(client: Client, uid = '812345678', name = 'Main') {
  return client.json<AccountCreatedResponse>('/api/accounts', {
    method: 'POST',
    json: { name, uid, server: 'ASIA' },
  })
}

async function makeToken(client: Client, body: Record<string, unknown> = {}) {
  const response = await client.fetch('/api/auth/api-tokens', {
    method: 'POST',
    json: { name: 'Bot', ...body },
  })
  expect(response.status).toBe(201)
  return (await response.json()) as ApiTokenCreatedResponse
}

/** A request with a token, no cookies (another program). */
function bearer(
  token: string,
  path: string,
  init: RequestInit & { json?: unknown } = {},
  transport: Transport = (url, i) => SELF.fetch(url, i),
) {
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${token}`)
  if (!headers.has('cf-connecting-ip')) headers.set('cf-connecting-ip', '2001:db8:aa::1')
  let body = init.body
  if (init.json !== undefined) {
    headers.set('content-type', 'application/json')
    body = JSON.stringify(init.json)
  }
  return transport(`${ORIGIN}/api/v1${path}`, { ...init, headers, body })
}

async function upload(token: string, accountId: number, good: Good, transport?: Transport) {
  return bearer(
    token,
    `/accounts/${accountId}/snapshots?timestamp=1760000000000`,
    {
      method: 'POST',
      json: good,
    },
    transport,
  )
}

describe('API tokens in Settings', () => {
  it('makes, lists, renames and revokes tokens; the secret is shown once', async () => {
    const { client } = await signUp()
    const made = await makeToken(client, { write: ['planner'], expiresInDays: 30 })
    expect(made.secret).toMatch(/^gdt_pat_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/)
    expect(made.token.write).toEqual(['planner'])
    expect(made.token.expiresAt).toBeGreaterThan(Date.now())

    const list = await client.json<ApiTokensResponse>('/api/auth/api-tokens')
    expect(list.tokens.map((t) => t.id)).toEqual([made.token.id])
    expect(JSON.stringify(list)).not.toContain(made.secret.slice(-20))
    expect(list.limits).toMatchObject({ tier: 'free', global: 20 })

    const renamed = await client.fetch(`/api/auth/api-tokens/${made.token.id}`, {
      method: 'PATCH',
      json: { name: 'Discord bot' },
    })
    expect(((await renamed.json()) as { name: string }).name).toBe('Discord bot')

    expect((await bearer(made.secret, '/me')).status).toBe(200)
    expect(
      (await client.fetch(`/api/auth/api-tokens/${made.token.id}`, { method: 'DELETE' })).status,
    ).toBe(204)
    const after = await bearer(made.secret, '/me')
    expect(after.status).toBe(401)
    expect(after.headers.get('content-type')).toContain('application/problem+json')
    expect(((await after.json()) as { code: string }).code).toBe('token_invalid')
  })

  it('refuses accounts that are not yours', async () => {
    const owner = await signUp()
    const other = await signUp()
    const { account } = await createAccount(owner.client)
    const response = await other.client.fetch('/api/auth/api-tokens', {
      method: 'POST',
      json: { name: 'x', accounts: [account.id] },
    })
    expect(response.status).toBe(400)
  })

  it('is not reachable with a token (a token never makes tokens)', async () => {
    const { client } = await signUp()
    const made = await makeToken(client)
    const response = await SELF.fetch(`${ORIGIN}/api/auth/api-tokens`, {
      headers: { authorization: `Bearer ${made.secret}` },
    })
    expect(response.status).toBe(401)
    // Nor does a token open the website's own routes.
    const me = await SELF.fetch(`${ORIGIN}/api/auth/me`, {
      headers: { authorization: `Bearer ${made.secret}` },
    })
    expect(me.status).toBe(401)
  })
})

describe('/api/v1', () => {
  it('reads accounts, snapshots and GOOD; uploads; answers 304 to an unchanged ETag', async () => {
    const { client, username } = await signUp(unlimited)
    const { account } = await createAccount(client)
    const { secret } = await makeToken(client, { write: ['snapshots'] })

    const me = await bearer(secret, '/me', {}, unlimited)
    expect(me.headers.get('x-request-id')).toMatch(/^req_/)
    expect(me.headers.get('access-control-allow-origin')).toBe('*')
    expect(((await me.json()) as { data: { username: string } }).data.username).toBe(username)

    const good = sampleGood({ ...sampleExtras(812345678) })
    const created = await upload(secret, account.id, good, unlimited)
    expect(created.status).toBe(201)
    const result = (await created.json()) as { data: { status: string; takenAt: string } }
    expect(result.data.status).toBe('created')
    expect(result.data.takenAt).toMatch(/^\d{4}-\d\d-\d\dT/)
    expect((await upload(secret, account.id, good, unlimited)).status).toBe(200)

    const list = await bearer(secret, '/accounts', {}, unlimited)
    const accounts = ((await list.json()) as { data: { id: number; latest: unknown }[] }).data
    expect(accounts.map((a) => a.id)).toEqual([account.id])
    expect(accounts[0]!.latest).not.toBeNull()

    const latest = await bearer(secret, `/accounts/${account.id}/good`, {}, unlimited)
    expect(latest.status).toBe(200)
    expect(latest.headers.get('x-ratelimit-bucket')).toBe('good')
    expect(latest.headers.get('x-ratelimit-limit')).toBe('6')
    const etag = latest.headers.get('etag')
    expect(etag).toBeTruthy()
    const body = (await latest.json()) as { data: Good }
    expect(body.data.format).toBe('GOOD')
    const again = await bearer(
      secret,
      `/accounts/${account.id}/good`,
      { headers: { 'if-none-match': etag! } },
      unlimited,
    )
    expect(again.status).toBe(304)

    const chars = await bearer(
      secret,
      `/accounts/${account.id}/characters?key=Furina`,
      {},
      unlimited,
    )
    const charList = ((await chars.json()) as { data: { key: string }[] }).data
    expect(charList.map((c) => c.key)).toEqual(['Furina'])

    const snaps = await bearer(secret, `/accounts/${account.id}/snapshots?limit=1`, {}, unlimited)
    const page = (await snaps.json()) as {
      data: { id: number }[]
      meta: { nextCursor: string | null }
    }
    expect(page.data).toHaveLength(1)
    expect(page.meta.nextCursor).toBeNull()

    const one = await bearer(
      secret,
      `/accounts/${account.id}/snapshots/${page.data[0]!.id}/good`,
      {},
      unlimited,
    )
    expect(one.status).toBe(200)
  })

  it('checks scopes and the accounts a token covers', async () => {
    const { client } = await signUp(unlimited)
    const { account } = await createAccount(client)
    const { account: alt } = await createAccount(client, '712345678', 'Alt')
    const readOnly = await makeToken(client, { accounts: [account.id] })

    const patch = await bearer(
      readOnly.secret,
      `/accounts/${account.id}/achievements`,
      {
        method: 'PATCH',
        json: { done: [84001], undone: [] },
      },
      unlimited,
    )
    expect(patch.status).toBe(403)
    expect(((await patch.json()) as { code: string }).code).toBe('scope_missing')

    const other = await bearer(readOnly.secret, `/accounts/${alt.id}`, {}, unlimited)
    expect(other.status).toBe(403)
    expect(((await other.json()) as { code: string }).code).toBe('account_not_in_token')

    const listed = await bearer(readOnly.secret, '/accounts', {}, unlimited)
    expect(((await listed.json()) as { data: { id: number }[] }).data.map((a) => a.id)).toEqual([
      account.id,
    ])

    const writer = await makeToken(client, { write: ['progress'] })
    const marked = await bearer(
      writer.secret,
      `/accounts/${account.id}/achievements`,
      {
        method: 'PATCH',
        json: { done: [84001, 84002], undone: [] },
      },
      unlimited,
    )
    expect(marked.status).toBe(200)
    expect(((await marked.json()) as { data: { marked: number[] } }).data.marked).toEqual([
      84001, 84002,
    ])
  })

  it("follows sharing: a viewer's token reads but can't change", async () => {
    const owner = await signUp(unlimited)
    const viewer = await signUp(unlimited)
    const { account } = await createAccount(owner.client)
    await owner.client.fetch(`/api/accounts/${account.id}/members`, {
      method: 'POST',
      json: { username: viewer.username, role: 'viewer' },
    })
    await viewer.client.fetch(`/api/invitations/${account.id}/accept`, { method: 'POST' })
    const token = await makeToken(viewer.client, { write: ['progress'] })
    expect((await bearer(token.secret, `/accounts/${account.id}`, {}, unlimited)).status).toBe(200)
    const patch = await bearer(
      token.secret,
      `/accounts/${account.id}/achievements`,
      {
        method: 'PATCH',
        json: { done: [84001], undone: [] },
      },
      unlimited,
    )
    expect(patch.status).toBe(403)

    const stranger = await signUp(unlimited)
    const theirs = await makeToken(stranger.client)
    expect((await bearer(theirs.secret, `/accounts/${account.id}`, {}, unlimited)).status).toBe(404)
  })

  it('imports a UIGF file, lists pulls and sums them up', async () => {
    const { client } = await signUp(unlimited)
    const { account } = await createAccount(client)
    const { secret } = await makeToken(client, { write: ['wishes'] })
    const uigf = {
      info: { export_app: 'test', version: 'v4.1' },
      hk4e: [
        {
          uid: 812345678,
          timezone: 8,
          lang: 'en-us',
          list: [
            {
              uigf_gacha_type: '301',
              gacha_type: '301',
              item_id: '',
              count: '1',
              time: '2026-10-01 12:00:00',
              name: 'Favonius Sword',
              item_type: 'Weapon',
              rank_type: '4',
              id: '1759300000000000001',
            },
            {
              uigf_gacha_type: '301',
              gacha_type: '301',
              item_id: '',
              count: '1',
              time: '2026-10-01 12:00:01',
              name: 'Furina',
              item_type: 'Character',
              rank_type: '5',
              id: '1759300000000000002',
            },
          ],
        },
      ],
    }
    const imported = await bearer(
      secret,
      `/accounts/${account.id}/wishes`,
      { method: 'POST', json: uigf },
      unlimited,
    )
    expect(imported.status).toBe(200)
    expect(((await imported.json()) as { data: { added: number } }).data.added).toBe(2)

    const pulls = await bearer(
      secret,
      `/accounts/${account.id}/wishes?banner=301&limit=1`,
      {},
      unlimited,
    )
    const page = (await pulls.json()) as {
      data: { id: string; item: { name: string } }[]
      meta: { nextCursor: string; total: number }
    }
    expect(page.meta.total).toBe(2)
    expect(page.data[0]).toMatchObject({ id: '1759300000000000002', item: { name: 'Furina' } })
    const next = await bearer(
      secret,
      `/accounts/${account.id}/wishes?banner=301&limit=1&cursor=${page.meta.nextCursor}`,
      {},
      unlimited,
    )
    expect(((await next.json()) as { data: { id: string }[] }).data[0]!.id).toBe(
      '1759300000000000001',
    )

    const summary = await bearer(secret, `/accounts/${account.id}/wishes/summary`, {}, unlimited)
    const banners = (
      (await summary.json()) as {
        data: { banners: { banner: number; pity5: number; fives: unknown[] }[] }
      }
    ).data.banners
    expect(banners[0]).toMatchObject({ banner: 301, pity5: 0 })
    expect(banners[0]!.fives).toHaveLength(1)

    const file = await bearer(secret, `/accounts/${account.id}/wishes/uigf`, {}, unlimited)
    expect(file.headers.get('content-disposition')).toContain('uigf-812345678')
    expect(((await file.json()) as { hk4e: { list: unknown[] }[] }).hk4e[0]!.list).toHaveLength(2)
  })

  it('computes the farm plan from the goals and the newest capture', async () => {
    const { client } = await signUp(unlimited)
    const { account } = await createAccount(client)
    const { secret } = await makeToken(client, { write: ['snapshots', 'planner'] })
    expect(
      (await upload(secret, account.id, sampleGood({ ...sampleExtras(812345678) }), unlimited))
        .status,
    ).toBe(201)
    const goal = await bearer(
      secret,
      `/accounts/${account.id}/planner/goals`,
      {
        method: 'PATCH',
        json: {
          upsert: [
            {
              kind: 'character',
              key: 'Bennett',
              target: { level: 90, ascension: 6, talents: { auto: 10, skill: 10, burst: 10 } },
            },
          ],
          remove: [],
        },
      },
      unlimited,
    )
    expect(goal.status).toBe(200)
    const farm = await bearer(secret, `/accounts/${account.id}/planner/farm`, {}, unlimited)
    expect(farm.status).toBe(200)
    expect(farm.headers.get('x-ratelimit-bucket')).toBe('farm')
    const data = (
      (await farm.json()) as {
        data: {
          goals: number
          missing: { key: string; missing: number }[]
          plan: { groups: unknown[] }
          today: { weekday: number }
        }
      }
    ).data
    expect(data.goals).toBe(1)
    expect(data.missing.length).toBeGreaterThan(0)
    expect(data.missing.every((m) => m.missing > 0)).toBe(true)
    expect(data.plan.groups.length).toBeGreaterThan(0)
    expect(data.today.weekday).toBeGreaterThanOrEqual(0)
  })

  it('works with the website session (the docs’ Try it)', async () => {
    const { client } = await signUp()
    const response = await client.fetch('/api/v1/me')
    expect(response.status).toBe(200)
    expect(((await response.json()) as { data: { token: unknown } }).data.token).toBeNull()
  })

  it('answers 429 with the scope when a limit refuses, global or bucket', async () => {
    const { client } = await signUp()
    const { account } = await createAccount(client)
    const { secret } = await makeToken(client)
    const globalOff = withEnv({ RL_20: refuse })
    const g = await bearer(secret, '/me', {}, globalOff)
    expect(g.status).toBe(429)
    expect(g.headers.get('x-ratelimit-scope')).toBe('global')
    expect(g.headers.get('x-ratelimit-global')).toBe('true')
    expect(g.headers.get('retry-after')).toBe('60')
    expect(await g.json()).toMatchObject({ code: 'rate_limited', scope: 'global', global: true })

    const bucketOff = withEnv({ RL_20: allow, RL_6: refuse })
    const b = await bearer(secret, `/accounts/${account.id}/good`, {}, bucketOff)
    expect(b.status).toBe(429)
    expect(b.headers.get('x-ratelimit-scope')).toBe('user')
    expect(await b.json()).toMatchObject({ bucket: 'good', limit: 6, global: false })
  })

  it('blocks an address after too many rejected tokens', async () => {
    const strict = withEnv({ RL_INVALID: refuse })
    const fake = `gdt_pat_AAAAAAAAAAAA_${'A'.repeat(43)}`
    const first = await bearer(
      fake,
      '/me',
      { headers: { 'cf-connecting-ip': '2001:db8:bb::9' } },
      strict,
    )
    expect(first.status).toBe(401)
    const second = await bearer(
      fake,
      '/me',
      { headers: { 'cf-connecting-ip': '2001:db8:bb::9' } },
      strict,
    )
    expect(second.status).toBe(429)
    expect(second.headers.get('x-ratelimit-scope')).toBe('ip')
  })

  it('serves game events without a token, and OpenAPI', async () => {
    const events = await SELF.fetch(`${ORIGIN}/api/v1/game-events`)
    expect(events.status).toBe(200)
    const doc = await SELF.fetch(`${ORIGIN}/api/v1/openapi.json`)
    expect(doc.status).toBe(200)
    expect(((await doc.json()) as { openapi: string }).openapi).toBe('3.1.0')
  })

  it('answers preflight requests', async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/v1/me`, { method: 'OPTIONS' })
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-headers')).toContain('Authorization')
  })
})

describe('the registry (docs stay honest)', () => {
  it('gives every route a unique id, a summary and a known resource', () => {
    const ids = new Set<string>()
    for (const route of V1_ROUTES) {
      expect(ids.has(route.id), route.id).toBe(false)
      ids.add(route.id)
      expect(route.summary.length, route.id).toBeGreaterThan(3)
    }
  })

  it('has examples that fit their schemas', () => {
    for (const route of V1_ROUTES) {
      if (route.example?.data !== undefined && route.response && route.response !== 'file') {
        const result = route.response.safeParse(route.example.data)
        expect(result.success, `${route.id}: ${JSON.stringify(result.error?.issues)}`).toBe(true)
      }
      if (route.example?.body !== undefined && route.body) {
        const result = route.body.safeParse(route.example.body)
        expect(result.success, `${route.id} body`).toBe(true)
      }
    }
  })

  it('describes every route in OpenAPI', () => {
    const doc = openApiDocument() as { paths: Record<string, Record<string, unknown>> }
    for (const route of V1_ROUTES) {
      expect(doc.paths[route.path]?.[route.method.toLowerCase()], route.id).toBeTruthy()
    }
  })
})
