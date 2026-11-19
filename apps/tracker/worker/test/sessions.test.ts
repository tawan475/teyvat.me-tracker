import type { MeResponse, SessionResponse } from '@gdt/shared'
import { env, SELF } from 'cloudflare:test'
import { and, eq, isNull } from 'drizzle-orm'
import { sign } from 'hono/jwt'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '../db/client'
import { authTokens, userSessions, users } from '../db/schema'
import { randomToken, sha256Hex } from '../lib/crypto'
import { MAX_SESSIONS } from '../lib/session'
import { SESSION_KEEP_DAYS, SIGNUP_IP_DAYS, runMaintenance } from '../services/maintenance'
import { Client, ORIGIN, signUp, withEnv } from './client'

const db = getDb(env.DB)
const DAY = 86_400_000
const PHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

afterEach(() => {
  vi.useRealTimers()
})

/** Signs in as `username` from a new device, with this IP and user agent. */
async function device(username: string, password: string, ip = '203.0.113.7', ua = PHONE_UA) {
  const client = new Client()
  const response = await client.fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'cf-connecting-ip': ip, 'user-agent': ua },
    json: { login: username, password },
  })
  expect(response.status).toBe(200)
  return client
}

const list = (client: Client) => client.json<SessionResponse[]>('/api/auth/sessions')

async function status(client: Client, path: string, init: RequestInit & { json?: unknown } = {}) {
  const response = await client.fetch(path, init)
  const body = (await response.json().catch(() => null)) as { error?: { code: string } } | null
  return { status: response.status, code: body?.error?.code }
}

const refresh = (client: Client) => status(client, '/api/auth/refresh', { method: 'POST' })

const rowsOf = (userId: number) =>
  db.select().from(userSessions).where(eq(userSessions.userId, userId)).orderBy(userSessions.id)

const activeRowsOf = (userId: number) =>
  db
    .select()
    .from(userSessions)
    .where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt)))

/** A session token as the Worker signs them; without `sid` it is one from before session rows. */
function token(
  typ: 'access' | 'refresh',
  claims: { sub: number; ver: number; sid?: number; iat: number; exp?: number },
) {
  const exp = claims.exp ?? claims.iat + (typ === 'access' ? 900 : 30 * 86_400)
  return sign({ ...claims, sub: String(claims.sub), typ, exp }, env.JWT_SECRET, 'HS256')
}

describe('session list', () => {
  it('lists each signed-in device with its IP, this one marked', async () => {
    const { client, username, password, me } = await signUp()
    const phone = await device(username, password)

    const sessions = await list(client)
    expect(sessions).toHaveLength(2)
    // The most recently seen first.
    const [newest, first] = sessions
    expect(newest).toMatchObject({
      current: false,
      method: 'password',
      ip: '203.0.113.7',
      userAgent: PHONE_UA,
      country: null,
      city: null,
    })
    expect(first).toMatchObject({ current: true, method: 'password' })
    expect(first!.ip).toMatch(/^2001:db8::/)
    expect(first!.lastSeenAt).toBeGreaterThan(Date.now() - 60_000)
    const fromPhone = await list(phone)
    expect(fromPhone.find((s) => s.current)!.id).toBe(newest!.id)

    // The sign-up's IP is kept on the user.
    const [user] = await db.select().from(users).where(eq(users.id, me.id))
    expect(user!.signupIp).toBe(first!.ip)
    expect(user!.lastActiveAt).toBeGreaterThan(Date.now() - 60_000)
    expect((await new Client().fetch('/api/auth/sessions')).status).toBe(401)
  })

  it("signs one device out: no refresh, no sensitive route, data reads until the token's end", async () => {
    const { client, username, password } = await signUp()
    const phone = await device(username, password)
    const phoneId = (await list(phone)).find((s) => s.current)!.id

    expect((await client.fetch(`/api/auth/sessions/${phoneId}`, { method: 'DELETE' })).status).toBe(
      204,
    )
    expect((await list(client)).map((s) => s.id)).not.toContain(phoneId)
    // The sensitive routes check the row; plain reads only the token (≤15 minutes).
    expect(await status(phone, '/api/auth/sessions')).toEqual({
      status: 401,
      code: 'session_revoked',
    })
    expect(
      await status(phone, '/api/auth/profile', {
        method: 'PATCH',
        json: { username: `x${username}` },
      }),
    ).toMatchObject({ status: 401, code: 'session_revoked' })
    expect((await phone.fetch('/api/auth/me')).status).toBe(200)
    expect(await refresh(phone)).toEqual({ status: 401, code: 'session_revoked' })
    expect(phone.cookie('gdt_rt')).toBeUndefined()
    // Again: nothing left to sign out.
    expect((await client.fetch(`/api/auth/sessions/${phoneId}`, { method: 'DELETE' })).status).toBe(
      404,
    )
    expect(await refresh(client)).toEqual({ status: 204, code: undefined })
  })

  it("can't touch another user's sessions", async () => {
    const mine = await signUp()
    const theirs = await signUp()
    const [their] = await list(theirs.client)
    const response = await mine.client.fetch(`/api/auth/sessions/${their!.id}`, {
      method: 'DELETE',
    })
    expect(response.status).toBe(404)
    expect((await mine.client.fetch('/api/auth/sessions/nope', { method: 'DELETE' })).status).toBe(
      404,
    )
    expect(await refresh(theirs.client)).toMatchObject({ status: 204 })
  })

  it('signing this device out from the list is a sign-out', async () => {
    const { client } = await signUp()
    const [mine] = await list(client)
    expect(
      (await client.fetch(`/api/auth/sessions/${mine!.id}`, { method: 'DELETE' })).status,
    ).toBe(204)
    expect(client.cookie('gdt_rt')).toBeUndefined()
    expect(client.cookie('gdt_s')).toBeUndefined()
  })

  it('signs every other device out and keeps this one', async () => {
    const { client, username, password } = await signUp()
    const phone = await device(username, password)
    const [mine] = (await list(client)).filter((s) => s.current)

    const response = await client.fetch('/api/auth/sessions/revoke-others', { method: 'POST' })
    expect(response.status).toBe(204)
    expect(await refresh(phone)).toMatchObject({ status: 401, code: 'session_revoked' })
    // The same session goes on, with new tokens.
    expect((await list(client)).map((s) => s.id)).toEqual([mine!.id])
    expect(await refresh(client)).toMatchObject({ status: 204 })
    expect((await list(client))[0]).toMatchObject({ id: mine!.id, current: true })
  })

  it('refuses a copied refresh token once its device signed out', async () => {
    const { client } = await signUp()
    const copied = client.cookie('gdt_rt')!
    expect((await client.fetch('/api/auth/logout', { method: 'POST' })).status).toBe(204)
    const replay = await SELF.fetch(`${ORIGIN}/api/auth/refresh`, {
      method: 'POST',
      headers: { cookie: `gdt_rt=${copied}` },
    })
    expect(replay.status).toBe(401)
    expect(await replay.json()).toMatchObject({ error: { code: 'session_revoked' } })
  })

  it('ends the session this browser held when it signs in again', async () => {
    const { client, username, password, me } = await signUp()
    const before = await activeRowsOf(me.id)
    expect(before).toHaveLength(1)
    await client.json('/api/auth/login', { method: 'POST', json: { login: username, password } })
    const after = await activeRowsOf(me.id)
    expect(after).toHaveLength(1)
    expect(after[0]!.id).not.toBe(before[0]!.id)
  })
})

describe('password changes', () => {
  it('keep this session (same row) and end the others', async () => {
    const { client, username, password } = await signUp()
    const phone = await device(username, password)
    const [mine] = (await list(client)).filter((s) => s.current)
    const changed = await client.fetch('/api/auth/password', {
      method: 'POST',
      json: { currentPassword: password, newPassword: 'another horse battery staple' },
    })
    expect(changed.status).toBe(204)
    expect(await refresh(phone)).toMatchObject({ status: 401 })
    expect(await refresh(client)).toMatchObject({ status: 204 })
    expect(await list(client)).toEqual([expect.objectContaining({ id: mine!.id, current: true })])
  })

  it('a reset link signs this browser in with a `reset` session and ends the rest', async () => {
    const { username, password, me } = await signUp()
    const phone = await device(username, password)
    const link = randomToken(32)
    await db.insert(authTokens).values({
      userId: me.id,
      kind: 'reset_password',
      tokenHash: await sha256Hex(link),
      expiresAt: Date.now() + DAY,
    })
    const browser = new Client()
    const reset = await browser.fetch('/api/auth/reset-password', {
      method: 'POST',
      json: { token: link, password: 'a reset new password' },
    })
    expect(reset.status).toBe(200)
    expect(await refresh(phone)).toMatchObject({ status: 401 })
    expect(await list(browser)).toEqual([
      expect.objectContaining({ current: true, method: 'reset' }),
    ])
  })
})

describe('refresh', () => {
  it('slides the expiry and records where the device is now', async () => {
    const { client, me } = await signUp()
    const [row] = await rowsOf(me.id)
    await db
      .update(userSessions)
      .set({ expiresAt: Date.now() + 60_000, lastSeenAt: 1, ip: '198.51.100.1' })
      .where(eq(userSessions.id, row!.id))
    expect(
      (
        await client.fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'cf-connecting-ip': '198.51.100.2' },
        })
      ).status,
    ).toBe(204)
    const [slid] = await rowsOf(me.id)
    expect(slid!.expiresAt).toBeGreaterThan(Date.now() + 29 * DAY)
    expect(slid!.lastSeenAt).toBeGreaterThan(Date.now() - 60_000)
    expect(slid).toMatchObject({ ip: '198.51.100.2', createdIp: row!.createdIp })

    // A row past its expiry is over, whatever the token says.
    await db
      .update(userSessions)
      .set({ expiresAt: Date.now() - 1 })
      .where(eq(userSessions.id, row!.id))
    expect(await refresh(client)).toEqual({ status: 401, code: 'session_revoked' })
  })

  it('keeps at most MAX_SESSIONS open, ending the least recently seen', async () => {
    const { client, username, password, me } = await signUp()
    const now = Date.now()
    // Seen after the sign-up's own, in order.
    const { results: seeded } = await env.DB.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < ?2 - 1)
       INSERT INTO user_sessions (user_id, method, created_at, last_seen_at, expires_at)
       SELECT ?1, 'password', ?3, ?3 + i, ?3 + ?4 FROM n ORDER BY i RETURNING id`,
    )
      .bind(me.id, MAX_SESSIONS, now, DAY)
      .all<{ id: number }>()
    seeded.sort((a, b) => a.id - b.id)
    await device(username, password)
    const active = await activeRowsOf(me.id)
    expect(active).toHaveLength(MAX_SESSIONS)
    const ids = active.map((row) => row.id)
    // The sign-up's own (seen before any seeded one) and the oldest seeded one went.
    expect(ids).not.toContain(seeded[0]!.id)
    expect(ids).toContain(seeded[MAX_SESSIONS - 1]!.id)
    expect(await refresh(client)).toMatchObject({ status: 401 })
  })
})

describe('tokens from before session rows', () => {
  it('a refresh token without a session row is refused', async () => {
    const { me } = await signUp()
    const now = Math.floor(Date.now() / 1000)
    const old = new Client()
    old.setCookie(
      'gdt_rt',
      await token('refresh', { sub: me.id, ver: 0, iat: now - 60 }),
      '/api/auth',
    )
    expect(await refresh(old)).toEqual({ status: 401, code: 'session_revoked' })
    expect(old.cookie('gdt_rt')).toBeUndefined()
    expect((await rowsOf(me.id)).filter((row) => row.method === 'legacy')).toEqual([])
  })

  it('an access token without a session reads data, but must refresh for sensitive routes', async () => {
    const { me } = await signUp()
    const now = Math.floor(Date.now() / 1000)
    const client = new Client()
    client.setCookie('gdt_at', await token('access', { sub: me.id, ver: 0, iat: now }), '/api')
    expect(await client.json<MeResponse>('/api/auth/me')).toMatchObject({ id: me.id })
    expect(await status(client, '/api/auth/sessions')).toEqual({
      status: 401,
      code: 'token_expired',
    })
    expect(await status(client, '/api/me/import-key', { method: 'POST' })).toEqual({
      status: 401,
      code: 'token_expired',
    })
  })
})

describe('retention', () => {
  it('deletes sessions a week after they ended, and sign-up IPs after 90 days', async () => {
    const { client, username, password, me } = await signUp()
    const phone = await device(username, password)
    const phoneId = (await list(phone)).find((s) => s.current)!.id
    await client.fetch(`/api/auth/sessions/${phoneId}`, { method: 'DELETE' })

    await runMaintenance(env.DB, Date.now() + DAY)
    expect((await rowsOf(me.id)).map((row) => row.id)).toContain(phoneId)

    const later = Date.now() + (SESSION_KEEP_DAYS + 1) * DAY
    const result = await runMaintenance(env.DB, later)
    expect(result.sessions).toBeGreaterThanOrEqual(1)
    const left = await rowsOf(me.id)
    expect(left.map((row) => row.id)).not.toContain(phoneId)
    // The open session (expiring in 30 days) stays.
    expect(left).toHaveLength(1)

    expect((await db.select().from(users).where(eq(users.id, me.id)))[0]!.signupIp).not.toBeNull()
    await runMaintenance(env.DB, Date.now() + (SIGNUP_IP_DAYS + 1) * DAY)
    const [user] = await db.select().from(users).where(eq(users.id, me.id))
    expect(user!.signupIp).toBeNull()
    // Past their expiry, the open ones go too.
    expect(await rowsOf(me.id)).toEqual([])
  })
})
