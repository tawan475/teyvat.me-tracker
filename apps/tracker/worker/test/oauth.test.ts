import type {
  IdentitiesResponse,
  MeResponse,
  OAuthLinkLoginResponse,
  OAuthPendingResponse,
  OAuthProvider,
  OAuthProvidersResponse,
  OAuthStartResponse,
} from '@gdt/shared'
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { and, eq } from 'drizzle-orm'
import { decode } from 'hono/jwt'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '../db/client'
import { userIdentities, userSessions, users } from '../db/schema'
import worker from '../index'
import { PENDING_COOKIE, STATE_COOKIE, STATE_TTL_S, seal } from '../lib/oauth'
import { Client, ORIGIN, type Transport } from './client'

const db = getDb(env.DB)
const PASSWORD = 'correct horse battery staple'

/** Made-up credentials: tests never see real ones. */
const SECRETS = {
  DISCORD_CLIENT_ID: 'test-discord-client',
  DISCORD_CLIENT_SECRET: 'test-discord-secret',
  GOOGLE_CLIENT_ID: 'test-google-client.apps.example',
  GOOGLE_CLIENT_SECRET: 'test-google-secret',
}

/** Every provider secret unset (even if .dev.vars has some for local testing). */
const NO_SECRETS = Object.fromEntries(Object.keys(SECRETS).map((name) => [name, undefined]))

/** The providers with the email features on (EMAIL_FEATURES=1); they are paused by default. */
const MAIL_ON = { ...SECRETS, EMAIL_FEATURES: '1' }

/** Stands in for the send_email binding. */
class FakeMail {
  sent: EmailMessageBuilder[] = []
  async send(message: EmailMessageBuilder): Promise<EmailSendResult> {
    this.sent.push(message)
    return { messageId: `m${this.sent.length}` }
  }
}

/**
 * Calls the Worker directly with these env changes and waits for its
 * after-response work. Email features paused unless the overrides say "1".
 */
function via(overrides: Record<string, unknown> = SECRETS): Transport {
  return async (url, init) => {
    const ctx = createExecutionContext()
    const bindings = { ...env, EMAIL_FEATURES: undefined, ...overrides } as unknown as Env
    const response = await worker.fetch(new Request(url, init), bindings, ctx)
    await waitOnExecutionContext(ctx)
    return response
  }
}

interface Account {
  id: string
  name: string
  email: string | null
  verified: boolean
}

let accounts = 0
function account(overrides: Partial<Account> = {}): Account {
  const n = ++accounts
  const tag = crypto.randomUUID().slice(0, 6)
  return {
    id: `${Date.now()}${n}${Math.floor(Math.random() * 1000)}`,
    name: `Traveler ${n}${tag}`,
    email: `oauth${n}-${tag}@example.com`,
    verified: true,
    ...overrides,
  }
}

const encoder = new TextEncoder()
const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
const s256 = async (text: string) =>
  b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))))
const randomCode = () => b64url(crypto.getRandomValues(new Uint8Array(16)))

interface Grant {
  account: Account
  challenge: string
  redirectUri: string
  nonce: string | null
}

const DISCORD_TOKEN = 'https://discord.com/api/oauth2/token'
const DISCORD_USER = 'https://discord.com/api/v10/users/@me'
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token'

/**
 * Discord's and Google's side, behind the Worker's `fetch`: codes are single
 * use and bound to the redirect URI and the PKCE challenge, like the real
 * ones; client credentials are checked.
 */
class FakeProviders {
  private codes = new Map<string, Grant>()
  private tokens = new Map<string, Account>()
  /** Overrides for Google's ID token claims (a wrong nonce, audience …). */
  claims: Record<string, unknown> = {}
  requests: string[] = []

  /** The user approves at the provider: the callback query it sends the browser back with. */
  approve(authorizeUrl: string, who: Account): URLSearchParams {
    const url = new URL(authorizeUrl)
    const code = randomCode()
    this.codes.set(code, {
      account: who,
      challenge: url.searchParams.get('code_challenge')!,
      redirectUri: url.searchParams.get('redirect_uri')!,
      nonce: url.searchParams.get('nonce'),
    })
    return new URLSearchParams({ code, state: url.searchParams.get('state')! })
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    this.requests.push(`${request.method} ${request.url}`)
    if (request.method === 'POST' && [DISCORD_TOKEN, GOOGLE_TOKEN].includes(request.url)) {
      const google = request.url === GOOGLE_TOKEN
      const form = new URLSearchParams(new TextDecoder().decode(await request.arrayBuffer()))
      const clientOk = google
        ? form.get('client_id') === SECRETS.GOOGLE_CLIENT_ID &&
          form.get('client_secret') === SECRETS.GOOGLE_CLIENT_SECRET
        : request.headers.get('authorization') ===
          `Basic ${btoa(`${SECRETS.DISCORD_CLIENT_ID}:${SECRETS.DISCORD_CLIENT_SECRET}`)}`
      if (!clientOk) return Response.json({ error: 'invalid_client' }, { status: 401 })
      const code = form.get('code') ?? ''
      const grant = this.codes.get(code)
      this.codes.delete(code)
      if (
        !grant ||
        form.get('grant_type') !== 'authorization_code' ||
        form.get('redirect_uri') !== grant.redirectUri ||
        (await s256(form.get('code_verifier') ?? '')) !== grant.challenge
      ) {
        return Response.json({ error: 'invalid_grant' }, { status: 400 })
      }
      const accessToken = randomCode()
      this.tokens.set(accessToken, grant.account)
      if (!google) {
        return Response.json({ access_token: accessToken, token_type: 'Bearer', expires_in: 3600 })
      }
      const now = Math.floor(Date.now() / 1000)
      const claims = {
        iss: 'https://accounts.google.com',
        aud: SECRETS.GOOGLE_CLIENT_ID,
        sub: grant.account.id,
        email: grant.account.email,
        email_verified: grant.account.verified,
        name: grant.account.name,
        picture: 'https://lh3.googleusercontent.com/a/test',
        nonce: grant.nonce,
        iat: now,
        exp: now + 3600,
        ...this.claims,
      }
      const part = (value: object) => b64url(encoder.encode(JSON.stringify(value)))
      return Response.json({
        access_token: accessToken,
        token_type: 'Bearer',
        id_token: `${part({ alg: 'RS256', typ: 'JWT' })}.${part(claims)}.c2lnbmF0dXJl`,
      })
    }
    if (request.method === 'GET' && request.url === DISCORD_USER) {
      const token = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '')
      const who = this.tokens.get(token)
      if (!who) return Response.json({ message: '401: Unauthorized' }, { status: 401 })
      return Response.json({
        id: who.id,
        username: who.name.toLowerCase().replace(/[^a-z0-9]/g, ''),
        global_name: who.name,
        avatar: 'a1b2c3',
        email: who.email,
        verified: who.verified,
      })
    }
    return new Response('unexpected request', { status: 599 })
  }
}

let providers: FakeProviders

beforeEach(() => {
  providers = new FakeProviders()
  vi.spyOn(globalThis, 'fetch').mockImplementation(providers.fetch)
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function post(client: Client, path: string, json?: unknown) {
  const response = await client.fetch(path, { method: 'POST', json })
  const text = await response.text()
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : null
  return {
    status: response.status,
    body,
    code: (body?.error as { code?: string } | undefined)?.code,
  }
}

/** Where a 302 sends the browser, relative to the site. */
function location(response: Response): string {
  expect(response.status).toBe(302)
  return (response.headers.get('location') ?? '').replace(ORIGIN, '')
}

/** "Continue with …" on the sign-in page: the provider URL to go to. */
async function startSignIn(client: Client, provider: OAuthProvider, next?: string) {
  const { url } = await client.json<OAuthStartResponse>(`/api/auth/oauth/${provider}/start`, {
    method: 'POST',
    json: next ? { next } : {},
  })
  return url
}

/** "Link" in Settings. */
async function startLink(client: Client, provider: OAuthProvider) {
  const { url } = await client.json<OAuthStartResponse>(`/api/auth/oauth/${provider}/link`, {
    method: 'POST',
  })
  return url
}

const callback = (client: Client, provider: OAuthProvider, query: URLSearchParams | string) =>
  client.fetch(`/api/auth/oauth/${provider}/callback?${query}`)

/** A whole round trip at the provider; where the browser lands. */
async function roundTrip(
  client: Client,
  provider: OAuthProvider,
  who: Account,
  start: (client: Client, provider: OAuthProvider) => Promise<string> = startSignIn,
) {
  const url = await start(client, provider)
  return location(await callback(client, provider, providers.approve(url, who)))
}

let counter = 0

async function passwordUser(mail?: FakeMail) {
  const username = `pw${++counter}${crypto.randomUUID().slice(0, 6)}`
  const client = new Client(via(mail ? { ...MAIL_ON, EMAIL: mail } : MAIL_ON))
  const me = await client.json<MeResponse>('/api/auth/register', {
    method: 'POST',
    json: { username, email: `${username}@example.com`, password: PASSWORD },
  })
  return { client, username, me }
}

/** A user made with a provider account: no password. */
async function providerUser(provider: OAuthProvider = 'discord', who = account()) {
  const client = new Client(via())
  expect(await roundTrip(client, provider, who)).toBe('/oauth')
  const pending = await client.json<OAuthPendingResponse>('/api/auth/oauth/pending')
  const created = await post(client, '/api/auth/oauth/pending/register', {
    username: pending.username,
  })
  expect(created.status).toBe(201)
  return { client, who, me: created.body as unknown as MeResponse }
}

const identitiesOf = (userId: number) =>
  db.select().from(userIdentities).where(eq(userIdentities.userId, userId))

const sessionsOf = (userId: number) =>
  db.select().from(userSessions).where(eq(userSessions.userId, userId)).orderBy(userSessions.id)

describe('configuration', () => {
  it('without the secrets every provider is off and nothing can start', async () => {
    const client = new Client(via(NO_SECRETS))
    expect(await client.json<OAuthProvidersResponse>('/api/auth/oauth/providers')).toEqual({
      providers: [],
      emailFeatures: false,
      turnstileSiteKey: null,
      signups: 'open',
      passkeys: true,
    })
    const start = await post(client, '/api/auth/oauth/discord/start', {})
    expect(start).toMatchObject({ status: 404, code: 'provider_unavailable' })
    const back = await callback(client, 'google', 'code=x&state=y')
    expect(location(back)).toBe('/login?oauth_error=state')
    // Half a pair is still off.
    const half = new Client(via({ ...NO_SECRETS, GOOGLE_CLIENT_ID: 'only-the-id' }))
    expect(await half.json<OAuthProvidersResponse>('/api/auth/oauth/providers')).toEqual({
      providers: [],
      emailFeatures: false,
      turnstileSiteKey: null,
      signups: 'open',
      passkeys: true,
    })
    expect(providers.requests).toEqual([])
  })

  it('the dev mock switch does nothing on the real site', async () => {
    const client = new Client(via({ ...NO_SECRETS, OAUTH_DEV_MOCK: '1' }))
    expect(await client.json<OAuthProvidersResponse>('/api/auth/oauth/providers')).toEqual({
      providers: [],
      emailFeatures: false,
      turnstileSiteKey: null,
      signups: 'open',
      passkeys: true,
    })
  })

  it('lists configured providers; sign-in starts with PKCE, state and a fixed redirect', async () => {
    const client = new Client(via())
    expect(await client.json<OAuthProvidersResponse>('/api/auth/oauth/providers')).toEqual({
      providers: ['discord', 'google'],
      emailFeatures: false,
      turnstileSiteKey: null,
      signups: 'open',
      passkeys: true,
    })
    expect(
      await new Client(via(MAIL_ON)).json<OAuthProvidersResponse>('/api/auth/oauth/providers'),
    ).toEqual({
      providers: ['discord', 'google'],
      emailFeatures: true,
      turnstileSiteKey: null,
      signups: 'open',
      passkeys: true,
    })
    const discord = new URL(await startSignIn(client, 'discord'))
    expect(discord.origin + discord.pathname).toBe('https://discord.com/oauth2/authorize')
    expect(Object.fromEntries(discord.searchParams)).toMatchObject({
      response_type: 'code',
      client_id: SECRETS.DISCORD_CLIENT_ID,
      redirect_uri: `${ORIGIN}/api/auth/oauth/discord/callback`,
      scope: 'identify email',
      code_challenge_method: 'S256',
    })
    expect(discord.searchParams.get('state')).toMatch(/^[\w-]{32}$/)
    expect(discord.searchParams.get('code_challenge')).toMatch(/^[\w-]{43}$/)
    expect(discord.searchParams.has('nonce')).toBe(false)
    // The verifier stays in the cookie, which is HttpOnly and scoped to the OAuth routes.
    const cookie = client.cookie(STATE_COOKIE)!
    const flow = decode(cookie).payload
    expect(flow).toMatchObject({ typ: 'oauth_state', provider: 'discord', intent: 'signin' })
    expect(discord.toString()).not.toContain(String(flow.verifier))

    const google = new URL(await startSignIn(client, 'google'))
    expect(google.origin + google.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(Object.fromEntries(google.searchParams)).toMatchObject({
      scope: 'openid email profile',
      redirect_uri: `${ORIGIN}/api/auth/oauth/google/callback`,
    })
    expect(google.searchParams.get('nonce')).toMatch(/^[\w-]{32}$/)
  })

  it('the redirect URI is this site whatever host the request named', async () => {
    const forged: Transport = (url, init) =>
      via()(url.replace(ORIGIN, 'https://evil.example'), init)
    const url = new URL(await startSignIn(new Client(forged), 'discord'))
    expect(url.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/oauth/discord/callback`)
  })

  it('sets the state cookie HttpOnly, Secure, SameSite Lax on the OAuth path', async () => {
    const client = new Client(via())
    const response = await client.fetch('/api/auth/oauth/discord/start', {
      method: 'POST',
      json: {},
    })
    const line = response.headers.getSetCookie().find((c) => c.startsWith(`${STATE_COOKIE}=`))!
    expect(line).toMatch(/Path=\/api\/auth\/oauth/)
    expect(line).toMatch(/HttpOnly/)
    expect(line).toMatch(/Secure/)
    expect(line).toMatch(/SameSite=Lax/)
    // No CSRF header: refused (a cross-site page can't start a round trip).
    const bare = await via()(`${ORIGIN}/api/auth/oauth/discord/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(bare.status).toBe(403)
  })
})

describe('sign in', () => {
  it('a suspended user goes back with `suspended`, signed in nowhere', async () => {
    const { who, me } = await providerUser('discord')
    await db.update(users).set({ suspendedAt: Date.now() }).where(eq(users.id, me.id))
    const client = new Client(via())
    expect(await roundTrip(client, 'discord', who)).toBe('/login?oauth_error=suspended')
    expect((await client.fetch('/api/auth/me')).status).toBe(401)
  })

  it('the sign-up switch: "Discord/Google only" still makes provider accounts, closed not', async () => {
    const setMode = (mode: string | null) =>
      mode === null
        ? env.DB.prepare("DELETE FROM site_settings WHERE key = 'signup.mode'").run()
        : env.DB.prepare(
            `INSERT INTO site_settings (key, value, updated_at) VALUES ('signup.mode', ?1, 0)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
          )
            .bind(mode)
            .run()
    try {
      await setMode('oauth')
      await providerUser('google')
      await setMode('closed')
      const client = new Client(via())
      expect(await roundTrip(client, 'discord', account())).toBe('/oauth')
      const pending = await client.json<OAuthPendingResponse>('/api/auth/oauth/pending')
      const refused = await post(client, '/api/auth/oauth/pending/register', {
        username: pending.username,
      })
      expect(refused).toMatchObject({ status: 403, code: 'signups_closed' })
    } finally {
      await setMode(null)
    }
  })

  it('signs in the linked user like a password login, to `next`', async () => {
    const { who, me } = await providerUser('discord')
    const client = new Client(via())
    const url = await startSignIn(client, 'discord', '/app/a/1/planner')
    const landed = location(await callback(client, 'discord', providers.approve(url, who)))
    expect(landed).toBe('/app/a/1/planner')
    expect(client.cookie(STATE_COOKIE)).toBeUndefined()
    const signedIn = await client.json<MeResponse>('/api/auth/me')
    expect(signedIn).toMatchObject({ id: me.id, hasPassword: false })
    // The refresh cookie works too: a full session.
    expect((await client.fetch('/api/auth/refresh', { method: 'POST' })).status).toBe(204)
    const [row] = await identitiesOf(me.id)
    expect(row!.lastUsedAt).toBeGreaterThan(Date.now() - 60_000)
  })

  it('unlinked: keeps where the sign-in was going for after "create account"', async () => {
    // irminsul's consent page: Continue with Discord, then create an account.
    const next = '/link?client_id=irminsul&state=abcdefghijklmnop'
    const client = new Client(via())
    const url = await startSignIn(client, 'discord', next)
    const landed = location(await callback(client, 'discord', providers.approve(url, account())))
    expect(landed).toBe('/oauth')
    const pending = await client.json<OAuthPendingResponse>('/api/auth/oauth/pending')
    expect(pending.next).toBe(next)
    // Without one there is nowhere to go back to.
    const plain = new Client(via())
    expect(await roundTrip(plain, 'discord', account())).toBe('/oauth')
    const none = await plain.json<OAuthPendingResponse>('/api/auth/oauth/pending')
    expect(none.next).toBeNull()
  })

  it('unlinked: never matched by email; the pending identity is offered, then a new account', async () => {
    const mail = new FakeMail()
    const { me: existing } = await passwordUser()
    // A provider account with the existing user's (confirmed) email still links nothing.
    await db.update(users).set({ emailVerified: true }).where(eq(users.id, existing.id))
    const who = account({ email: existing.email })
    const client = new Client(via({ ...MAIL_ON, EMAIL: mail }))
    const landed = await roundTrip(client, 'google', who)
    // Only a fixed path: the identity is in the cookie, never in the URL.
    expect(landed).toBe('/oauth')
    expect(client.cookie(PENDING_COOKIE)).toBeTruthy()
    expect(client.cookie('gdt_at')).toBeUndefined()
    expect(await identitiesOf(existing.id)).toEqual([])

    const pending = await client.json<OAuthPendingResponse>('/api/auth/oauth/pending')
    expect(pending).toMatchObject({
      provider: 'google',
      displayName: who.name,
      email: who.email,
      emailVerified: true,
    })
    // From the email's name, which another user has: digits make it free.
    expect(pending.username).toMatch(new RegExp(`^${existing.username}[0-9]{4}$`))

    // That email is another user's: offered, but taken.
    const taken = await post(client, '/api/auth/oauth/pending/register', {
      username: `new${crypto.randomUUID().slice(0, 8)}`,
      useEmail: true,
    })
    expect(taken).toMatchObject({ status: 409, code: 'email_taken' })
    const dup = await post(client, '/api/auth/oauth/pending/register', {
      username: existing.username,
    })
    expect(dup).toMatchObject({ status: 409, code: 'username_taken' })

    const username = `new${crypto.randomUUID().slice(0, 8)}`
    const created = await post(client, '/api/auth/oauth/pending/register', { username })
    expect(created.status).toBe(201)
    const me = created.body as unknown as MeResponse
    expect(me).toMatchObject({ username, email: null, hasPassword: false })
    expect(client.cookie(PENDING_COOKIE)).toBeUndefined()
    expect(await client.json<MeResponse>('/api/auth/me')).toMatchObject({ id: me.id })
    const [row] = await identitiesOf(me.id)
    expect(row).toMatchObject({
      provider: 'google',
      providerUserId: who.id,
      email: who.email,
      emailVerified: true,
      displayName: who.name,
      avatarUrl: 'https://lh3.googleusercontent.com/a/test',
    })
    expect(mail.sent).toEqual([])

    // Used up: the same pending identity can't make a second account.
    const again = await post(client, '/api/auth/oauth/pending/register', {
      username: `${username}2`,
    })
    expect(again).toMatchObject({ status: 410, code: 'pending_expired' })
  })

  it('a new account can take the provider email, unconfirmed, with a confirmation mailed', async () => {
    const mail = new FakeMail()
    const who = account()
    const client = new Client(via({ ...MAIL_ON, EMAIL: mail }))
    expect(await roundTrip(client, 'discord', who)).toBe('/oauth')
    const pending = await client.json<OAuthPendingResponse>('/api/auth/oauth/pending')
    const created = await post(client, '/api/auth/oauth/pending/register', {
      username: pending.username,
      useEmail: true,
    })
    expect(created.status).toBe(201)
    // Discord said verified; that does not confirm it here.
    expect(created.body).toMatchObject({ email: who.email, emailVerified: false })
    expect(mail.sent.map((m) => [m.to, m.subject])).toEqual([[who.email, 'Confirm your email']])
  })

  it('while email is paused: no provider email for a new account, no notice on linking', async () => {
    const mail = new FakeMail()
    const client = new Client(via({ ...SECRETS, EMAIL: mail }))
    expect(await roundTrip(client, 'discord', account())).toBe('/oauth')
    const pending = await client.json<OAuthPendingResponse>('/api/auth/oauth/pending')
    const created = await post(client, '/api/auth/oauth/pending/register', {
      username: pending.username,
      useEmail: true,
    })
    expect(created).toMatchObject({ status: 201, body: { email: null, emailFeatures: false } })

    // A confirmed email and a binding: only the pause keeps the notice from going out.
    const { username, me } = await passwordUser()
    await db.update(users).set({ emailVerified: true }).where(eq(users.id, me.id))
    const linking = new Client(via({ ...SECRETS, EMAIL: mail }))
    expect(await roundTrip(linking, 'google', account())).toBe('/oauth')
    const linked = await post(linking, '/api/auth/oauth/pending/login', {
      login: username,
      password: PASSWORD,
    })
    expect(linked.body).toMatchObject({ linked: 'google', problem: null })
    expect(mail.sent).toEqual([])
  })

  it('records how each session signed in, and where a provider sign-up came from', async () => {
    const { me, who } = await providerUser('discord')
    const [user] = await db.select().from(users).where(eq(users.id, me.id))
    expect(user!.signupIp).toMatch(/^2001:db8::/)
    expect(await roundTrip(new Client(via()), 'discord', who)).toBe('/app')
    const { username, me: other } = await passwordUser()
    const linking = new Client(via())
    expect(await roundTrip(linking, 'google', account())).toBe('/oauth')
    await post(linking, '/api/auth/oauth/pending/login', { login: username, password: PASSWORD })
    expect((await sessionsOf(me.id)).map((row) => row.method)).toEqual(['discord', 'discord'])
    expect((await sessionsOf(other.id)).map((row) => row.method)).toEqual(['password', 'password'])
  })

  it('a passwordless account never signs in with a password', async () => {
    const { me } = await providerUser('discord')
    const client = new Client(via())
    for (const password of ['', ' ', PASSWORD, '$argon2id$']) {
      const login = await post(client, '/api/auth/login', { login: me.username, password })
      expect(login.status).toBe(password ? 401 : 400)
    }
    const [row] = await db.select().from(users).where(eq(users.id, me.id))
    expect(row!.passwordHash).toBe('')
  })

  it('unlinked, then sign in with a password: links it to that user', async () => {
    const mail = new FakeMail()
    const { username, me } = await passwordUser(mail)
    await db.update(users).set({ emailVerified: true }).where(eq(users.id, me.id))
    mail.sent.length = 0
    const who = account()
    const client = new Client(via({ ...MAIL_ON, EMAIL: mail }))
    expect(await roundTrip(client, 'discord', who)).toBe('/oauth')

    const wrong = await post(client, '/api/auth/oauth/pending/login', {
      login: username,
      password: 'not the password',
    })
    expect(wrong).toMatchObject({ status: 401, code: 'invalid_credentials' })
    expect(client.cookie(PENDING_COOKIE)).toBeTruthy()

    const linked = await post(client, '/api/auth/oauth/pending/login', {
      login: username,
      password: PASSWORD,
    })
    expect(linked.status).toBe(200)
    const answer = linked.body as unknown as OAuthLinkLoginResponse
    expect(answer).toMatchObject({ linked: 'discord', problem: null })
    expect(answer.me).toMatchObject({ id: me.id, hasPassword: true })
    expect(client.cookie(PENDING_COOKIE)).toBeUndefined()
    const [row] = await identitiesOf(me.id)
    expect(row).toMatchObject({ provider: 'discord', providerUserId: who.id })
    expect(row!.lastUsedAt).not.toBeNull()
    // A notice goes to the confirmed email.
    expect(mail.sent.map((m) => [m.to, m.subject])).toEqual([
      [me.email, 'Discord sign-in added to your account'],
    ])

    // From now on the provider signs straight in.
    const later = new Client(via())
    expect(await roundTrip(later, 'discord', who)).toBe('/app')
    expect(await later.json<MeResponse>('/api/auth/me')).toMatchObject({ id: me.id })
  })

  it('a plain password sign-in drops a provider account left waiting in the browser', async () => {
    const { username, me } = await passwordUser()
    const client = new Client(via())
    expect(await roundTrip(client, 'discord', account())).toBe('/oauth')
    const login = await post(client, '/api/auth/login', { login: username, password: PASSWORD })
    expect(login.status).toBe(200)
    expect(client.cookie(PENDING_COOKIE)).toBeUndefined()
    expect(await identitiesOf(me.id)).toEqual([])
  })

  it('sign in to link after the pending identity ran out: signed in, nothing linked', async () => {
    const { username, me } = await passwordUser()
    const client = new Client(via())
    const result = await post(client, '/api/auth/oauth/pending/login', {
      login: username,
      password: PASSWORD,
    })
    expect(result.body).toMatchObject({ linked: null, problem: 'expired' })
    expect(await client.json<MeResponse>('/api/auth/me')).toMatchObject({ id: me.id })
    expect(await identitiesOf(me.id)).toEqual([])
  })
})

describe('link from Settings', () => {
  it('links to the signed-in user and lists it', async () => {
    const { client, me } = await passwordUser()
    const who = account()
    expect(await roundTrip(client, 'discord', who, startLink)).toBe('/app/settings?linked=discord')
    const list = await client.json<IdentitiesResponse>('/api/auth/identities')
    expect(list.providers).toEqual(['discord', 'google'])
    expect(list.identities).toEqual([
      expect.objectContaining({
        provider: 'discord',
        displayName: who.name,
        email: who.email,
        emailVerified: true,
        avatarUrl: `https://cdn.discordapp.com/avatars/${who.id}/a1b2c3.png?size=64`,
        lastUsedAt: null,
      }),
    ])
    // Linking changes no session.
    const [row] = await db.select().from(users).where(eq(users.id, me.id))
    expect(row!.tokenVersion).toBe(0)
    expect((await client.fetch('/api/auth/refresh', { method: 'POST' })).status).toBe(204)
  })

  it('makes no new session; the callback is refused once that session was signed out', async () => {
    const { client, me } = await passwordUser()
    const before = await sessionsOf(me.id)
    expect(before).toHaveLength(1)
    const url = await startLink(client, 'discord')
    expect(await sessionsOf(me.id)).toEqual(before)
    // The renewed cookie is the same session.
    expect(decode(client.cookie('gdt_at')!).payload.sid).toBe(before[0]!.id)

    // Signed out from another device while at the provider.
    const elsewhere = new Client(via())
    await post(elsewhere, '/api/auth/login', { login: me.username, password: PASSWORD })
    const revoked = await elsewhere.fetch(`/api/auth/sessions/${before[0]!.id}`, {
      method: 'DELETE',
    })
    expect(revoked.status).toBe(204)
    const landed = location(await callback(client, 'discord', providers.approve(url, account())))
    expect(landed).toBe('/app/settings?oauth_error=session')
    expect(await identitiesOf(me.id)).toEqual([])
    expect(providers.requests).toEqual([])
    // Nor can it start another.
    expect(await post(client, '/api/auth/oauth/discord/link')).toMatchObject({
      status: 401,
      code: 'session_revoked',
    })
  })

  it('needs a session to start', async () => {
    const start = await post(new Client(via()), '/api/auth/oauth/discord/link')
    expect(start).toMatchObject({ status: 401 })
  })

  it('refuses the callback when another user is signed in by then', async () => {
    const first = await passwordUser()
    const second = await passwordUser()
    const url = await startLink(first.client, 'discord')
    // Same browser, now signed in as someone else.
    expect(
      (
        await post(first.client, '/api/auth/login', {
          login: second.username,
          password: PASSWORD,
        })
      ).status,
    ).toBe(200)
    const landed = location(
      await callback(first.client, 'discord', providers.approve(url, account())),
    )
    expect(landed).toBe('/app/settings?oauth_error=session')
    expect(await identitiesOf(first.me.id)).toEqual([])
    expect(await identitiesOf(second.me.id)).toEqual([])
    // Refused before the code was spent.
    expect(providers.requests).toEqual([])
  })

  it('refuses the callback after the session was ended everywhere, or without one', async () => {
    const { client, me } = await passwordUser()
    const url = await startLink(client, 'discord')
    // Sign out everywhere from another device: this access cookie is still a valid JWT.
    const elsewhere = new Client(via())
    await post(elsewhere, '/api/auth/login', { login: me.username, password: PASSWORD })
    expect((await post(elsewhere, '/api/auth/logout-all')).status).toBe(204)
    const landed = location(await callback(client, 'discord', providers.approve(url, account())))
    expect(landed).toBe('/app/settings?oauth_error=session')

    const fresh = await passwordUser()
    const url2 = await startLink(fresh.client, 'discord')
    fresh.client.setCookie('gdt_at', null)
    const signedOut = location(
      await callback(fresh.client, 'discord', providers.approve(url2, account())),
    )
    expect(signedOut).toBe('/app/settings?oauth_error=session')
    expect(await identitiesOf(me.id)).toEqual([])
    expect(await identitiesOf(fresh.me.id)).toEqual([])
  })

  it("won't take another user's identity, or a second account of one provider", async () => {
    const owner = await passwordUser()
    const who = account()
    expect(await roundTrip(owner.client, 'discord', who, startLink)).toBe(
      '/app/settings?linked=discord',
    )
    const other = await passwordUser()
    expect(await roundTrip(other.client, 'discord', who, startLink)).toBe(
      '/app/settings?oauth_error=taken',
    )
    expect(await roundTrip(owner.client, 'discord', account(), startLink)).toBe(
      '/app/settings?oauth_error=already',
    )
    // Linking the same account again is fine.
    expect(await roundTrip(owner.client, 'discord', who, startLink)).toBe(
      '/app/settings?linked=discord',
    )
    expect(await identitiesOf(owner.me.id)).toHaveLength(1)
    expect(await identitiesOf(other.me.id)).toEqual([])
  })
})

describe('callback checks', () => {
  it('missing, wrong or another provider’s state goes back with `state`', async () => {
    const who = account()
    const client = new Client(via())
    const url = await startSignIn(client, 'discord')
    const query = providers.approve(url, who)

    const stranger = new Client(via())
    expect(location(await callback(stranger, 'discord', query))).toBe('/login?oauth_error=state')

    const wrong = new URLSearchParams(query)
    wrong.set('state', 'x'.repeat(32))
    expect(location(await callback(client, 'discord', wrong))).toBe('/login?oauth_error=state')
    // The cookie was used up by that attempt.
    expect(location(await callback(client, 'discord', query))).toBe('/login?oauth_error=state')

    const url2 = await startSignIn(client, 'discord')
    expect(location(await callback(client, 'google', providers.approve(url2, who)))).toBe(
      '/login?oauth_error=state',
    )
    // A forged cookie (not signed with the server's key).
    const url3 = await startSignIn(client, 'discord')
    const [header, payload] = client.cookie(STATE_COOKIE)!.split('.')
    client.setCookie(STATE_COOKIE, `${header}.${payload}.AAAA`, '/api/auth/oauth')
    expect(location(await callback(client, 'discord', providers.approve(url3, who)))).toBe(
      '/login?oauth_error=state',
    )
    expect(providers.requests).toEqual([])
  })

  it('an expired state cookie goes back with `expired`', async () => {
    const client = new Client(via())
    const url = await startSignIn(client, 'discord')
    const { typ: _t, iat: _i, exp: _e, ...flow } = decode(client.cookie(STATE_COOKIE)!).payload
    const stale = await seal(
      env,
      'oauth_state',
      flow,
      STATE_TTL_S,
      Date.now() - STATE_TTL_S * 1000 - 1,
    )
    client.setCookie(STATE_COOKIE, stale, '/api/auth/oauth')
    expect(location(await callback(client, 'discord', providers.approve(url, account())))).toBe(
      '/login?oauth_error=expired',
    )
    expect(providers.requests).toEqual([])
  })

  it('a code works once', async () => {
    const who = account()
    const client = new Client(via())
    const url = await startSignIn(client, 'discord')
    const cookie = client.cookie(STATE_COOKIE)!
    const query = providers.approve(url, who)
    expect(location(await callback(client, 'discord', query))).toBe('/oauth')
    // Replayed with the same (kept) state cookie: the provider refuses the code.
    client.setCookie(STATE_COOKIE, cookie, '/api/auth/oauth')
    expect(location(await callback(client, 'discord', query))).toBe('/login?oauth_error=failed')
  })

  it('cancelled at the provider, or a code with the wrong verifier', async () => {
    const client = new Client(via())
    const url = await startSignIn(client, 'discord')
    const state = new URL(url).searchParams.get('state')!
    expect(location(await callback(client, 'discord', `error=access_denied&state=${state}`))).toBe(
      '/login?oauth_error=denied',
    )

    // A code issued for another browser's challenge (an injected code) fails PKCE.
    const victim = new Client(via())
    const victimUrl = await startSignIn(victim, 'discord')
    const attacker = new Client(via())
    const attackerUrl = await startSignIn(attacker, 'discord')
    const stolen = providers.approve(attackerUrl, account())
    stolen.set('state', new URL(victimUrl).searchParams.get('state')!)
    expect(location(await callback(victim, 'discord', stolen))).toBe('/login?oauth_error=failed')
  })

  it("Google's ID token must carry this flow's nonce and this client as audience", async () => {
    for (const claims of [
      { nonce: 'another-nonce' },
      { aud: 'someone-else.apps.example' },
      { iss: 'https://evil.example' },
      { exp: Math.floor(Date.now() / 1000) - 10 },
    ]) {
      providers.claims = claims
      const client = new Client(via())
      expect(await roundTrip(client, 'google', account())).toBe('/login?oauth_error=failed')
    }
    providers.claims = {}
    expect(await roundTrip(new Client(via()), 'google', account())).toBe('/oauth')
  })

  it('errors while linking go back to Settings', async () => {
    const { client } = await passwordUser()
    const url = await startLink(client, 'google')
    const state = new URL(url).searchParams.get('state')!
    expect(location(await callback(client, 'google', `error=access_denied&state=${state}`))).toBe(
      '/app/settings?oauth_error=denied',
    )
  })
})

describe('unlink and passwords', () => {
  it("won't unlink the last way in", async () => {
    const { client, me } = await providerUser('discord')
    const last = await client.fetch('/api/auth/identities/discord', { method: 'DELETE' })
    expect(last.status).toBe(409)
    expect(await last.json()).toMatchObject({ error: { code: 'last_sign_in' } })

    // A second provider: either may go, but not both.
    expect(await roundTrip(client, 'google', account(), startLink)).toBe(
      '/app/settings?linked=google',
    )
    expect((await client.fetch('/api/auth/identities/discord', { method: 'DELETE' })).status).toBe(
      204,
    )
    expect((await client.fetch('/api/auth/identities/google', { method: 'DELETE' })).status).toBe(
      409,
    )
    expect((await client.fetch('/api/auth/identities/discord', { method: 'DELETE' })).status).toBe(
      404,
    )
    expect(await identitiesOf(me.id)).toHaveLength(1)
  })

  it('a user with a password can unlink everything', async () => {
    const { client, me } = await passwordUser()
    await roundTrip(client, 'discord', account(), startLink)
    expect((await client.fetch('/api/auth/identities/discord', { method: 'DELETE' })).status).toBe(
      204,
    )
    expect(await identitiesOf(me.id)).toEqual([])
    expect((await client.fetch('/api/auth/identities/nope', { method: 'DELETE' })).status).toBe(404)
  })

  it('two unlinks at once leave one way in', async () => {
    const { client, me } = await providerUser('discord')
    await roundTrip(client, 'google', account(), startLink)
    const results = await Promise.all(
      (['discord', 'google'] as const).map((p) =>
        client.fetch(`/api/auth/identities/${p}`, { method: 'DELETE' }).then((r) => r.status),
      ),
    )
    expect(results.sort()).toEqual([204, 409])
    expect(await identitiesOf(me.id)).toHaveLength(1)
  })

  it('a passwordless account sets a password with only its session', async () => {
    const mail = new FakeMail()
    const { client, me } = await providerUser('discord')
    await db
      .update(users)
      .set({ email: `${me.username}@example.com`.toLowerCase(), emailVerified: true })
      .where(eq(users.id, me.id))
    const mailing = new Client(via({ ...MAIL_ON, EMAIL: mail }))
    // (Same session, carried over to a transport with email.)
    for (const name of ['gdt_at', 'gdt_rt']) {
      mailing.setCookie(name, client.cookie(name)!, name === 'gdt_at' ? '/api' : '/api/auth')
    }
    const short = await post(mailing, '/api/auth/password/set', { password: 'short' })
    expect(short).toMatchObject({ status: 400, code: 'invalid_request' })
    const set = await post(mailing, '/api/auth/password/set', { password: 'a fresh password' })
    expect(set).toMatchObject({ status: 200, body: { id: me.id, hasPassword: true } })
    expect(mail.sent.map((m) => m.subject)).toEqual(['A password added to your account'])
    // Not a way around "change password": once set, it needs the current one.
    const again = await post(mailing, '/api/auth/password/set', { password: 'another password' })
    expect(again).toMatchObject({ status: 409, code: 'has_password' })
    // No session was ended.
    expect((await mailing.fetch('/api/auth/refresh', { method: 'POST' })).status).toBe(204)

    const login = await post(new Client(via()), '/api/auth/login', {
      login: me.username.toLowerCase(),
      password: 'a fresh password',
    })
    expect(login.status).toBe(200)
    // With a password, the identity can go.
    expect((await client.fetch('/api/auth/identities/discord', { method: 'DELETE' })).status).toBe(
      204,
    )
  })

  it('set password needs a session; change password needs the current one', async () => {
    expect(
      await post(new Client(via()), '/api/auth/password/set', { password: 'whatever pw' }),
    ).toMatchObject({ status: 401 })
    const { client } = await providerUser('google')
    const change = await post(client, '/api/auth/password', {
      currentPassword: 'anything at all',
      newPassword: 'a new password',
    })
    expect(change).toMatchObject({ status: 401, code: 'invalid_credentials' })
  })

  it('/me says whether there is a password; identities need a session', async () => {
    const { client } = await providerUser('discord')
    expect(await client.json<MeResponse>('/api/auth/me')).toMatchObject({ hasPassword: false })
    const { client: withPassword } = await passwordUser()
    expect(await withPassword.json<MeResponse>('/api/auth/me')).toMatchObject({ hasPassword: true })
    expect((await new Client(via()).fetch('/api/auth/identities')).status).toBe(401)
  })
})

describe('deleting a user', () => {
  it('takes their identities with them', async () => {
    const { me } = await providerUser('discord')
    await db.delete(users).where(eq(users.id, me.id))
    expect(
      await db
        .select()
        .from(userIdentities)
        .where(and(eq(userIdentities.userId, me.id), eq(userIdentities.provider, 'discord'))),
    ).toEqual([])
  })
})
