import type { MeResponse, ResetLinkResponse, VerifyEmailResponse } from '@gdt/shared'
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { getDb } from '../db/client'
import { authTokens, users } from '../db/schema'
import worker from '../index'
import { randomToken, sha256Hex } from '../lib/crypto'
import { FORGOT_PASSWORD_ANSWER } from '../routes/recovery'
import { runMaintenance } from '../services/maintenance'
import { Client, ORIGIN, inOneWindow, type Transport } from './client'

const db = getDb(env.DB)
const PASSWORD = 'correct horse battery staple'
const NEW_PASSWORD = 'a brand new password'
const HOUR = 3_600_000

/** Stands in for the send_email binding and keeps what was sent. */
class FakeMail {
  sent: EmailMessageBuilder[] = []
  failing = false

  async send(message: EmailMessageBuilder): Promise<EmailSendResult> {
    if (this.failing) throw Object.assign(new Error('refused'), { code: 'E_RATE_LIMIT_EXCEEDED' })
    this.sent.push(message)
    return { messageId: `m${this.sent.length}` }
  }

  to(address: string): EmailMessageBuilder[] {
    return this.sent.filter((mail) => mail.to === address)
  }
}

/**
 * Calls the Worker directly, with the email features on (EMAIL_FEATURES=1),
 * `EMAIL` bound to `mail` (none: null) and any other env changes, and waits
 * for the work it does after responding.
 */
function via(mail: FakeMail | null, overrides: Record<string, unknown> = {}): Transport {
  return async (url, init) => {
    const ctx = createExecutionContext()
    const bindings = {
      ...env,
      EMAIL_FEATURES: '1',
      ...(mail ? { EMAIL: mail } : {}),
      ...overrides,
    } as unknown as Env
    const response = await worker.fetch(new Request(url, init), bindings, ctx)
    await waitOnExecutionContext(ctx)
    return response
  }
}

/** The same requests, sent as if to another host. */
function viaHost(
  mail: FakeMail,
  origin: string,
  overrides: Record<string, unknown> = {},
): Transport {
  const send = via(mail, overrides)
  return (url, init) => send(url.replace(ORIGIN, origin), init)
}

/** The token of the one link in a mail, checking the text and HTML carry the same link. */
function linkToken(mail: EmailMessageBuilder | undefined, page: string, origin = ORIGIN): string {
  const match = /^(\S+)\?token=([A-Za-z0-9_-]{43})$/m.exec(mail?.text ?? '')
  expect(match?.[1]).toBe(`${origin}${page}`)
  expect(mail?.html).toContain(`href="${match![0]}"`)
  return match![2]!
}

let counter = 0

async function signUpWith(mail: FakeMail | null, withEmail = true) {
  const username = `rec${++counter}${crypto.randomUUID().slice(0, 6)}`
  const email = withEmail ? `${username}@example.com` : null
  const client = new Client(via(mail))
  const me = await client.json<MeResponse>('/api/auth/register', {
    method: 'POST',
    json: { username, email, password: PASSWORD },
  })
  return { client, username, email, me }
}

/** A user whose email is already confirmed. */
async function confirmedUser(mail: FakeMail) {
  const user = await signUpWith(mail)
  await db.update(users).set({ emailVerified: true }).where(eq(users.id, user.me.id))
  mail.sent.length = 0
  return { ...user, email: user.email! }
}

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

const forgot = (mail: FakeMail, login: string) =>
  post(new Client(via(mail)), '/api/auth/forgot-password', { login })

async function expireLink(token: string, at = Date.now() - 1) {
  await db
    .update(authTokens)
    .set({ expiresAt: at })
    .where(eq(authTokens.tokenHash, await sha256Hex(token)))
}

/** A reset link as scripts/admin-reset-link.mjs makes one: not mailed, 24 hours. */
async function adminLink(userId: number, expiresAt = Date.now() + 24 * HOUR) {
  const token = randomToken(32)
  await db
    .insert(authTokens)
    .values({ userId, kind: 'reset_password', tokenHash: await sha256Hex(token), expiresAt })
  return token
}

const linksOf = (userId: number, kind: 'verify_email' | 'reset_password') =>
  db
    .select()
    .from(authTokens)
    .where(and(eq(authTokens.userId, userId), eq(authTokens.kind, kind)))

describe('email confirmation', () => {
  it('mails a link at sign-up and on request; the link confirms the email once', async () => {
    const mail = new FakeMail()
    const { client, username, email, me } = await signUpWith(mail)
    expect(me).toMatchObject({ emailVerified: false, emailEnabled: true })

    expect(mail.sent).toHaveLength(1)
    const [first] = mail.sent
    expect(first).toMatchObject({
      to: email,
      from: { name: 'Teyvat.me', email: 'no-reply@475.dev' },
      subject: 'Confirm your email',
    })
    const token = linkToken(first, '/verify-email')
    // Anyone can type in an address: the mail carries nothing they chose.
    expect(first!.text).not.toContain(username)
    // Only the hash is stored.
    const [row] = await linksOf(me.id, 'verify_email')
    expect(row).toMatchObject({ email, usedAt: null, tokenHash: await sha256Hex(token) })
    expect(row!.expiresAt - row!.createdAt).toBe(24 * HOUR)

    expect((await post(client, '/api/auth/verify-email/send')).status).toBe(204)
    expect(mail.to(email!)).toHaveLength(2)

    // The link works in any browser, signed in or not.
    const elsewhere = new Client(via(mail))
    const confirmed = await post(elsewhere, '/api/auth/verify-email', { token })
    expect(confirmed).toMatchObject({
      status: 200,
      body: { email: email! } satisfies VerifyEmailResponse,
    })
    expect((await client.json<MeResponse>('/api/auth/me')).emailVerified).toBe(true)

    const again = await post(elsewhere, '/api/auth/verify-email', { token })
    expect(again).toMatchObject({ status: 410, code: 'token_used' })
    const sendAgain = await post(client, '/api/auth/verify-email/send')
    expect(sendAgain).toMatchObject({ status: 409, code: 'already_verified' })
  })

  it("a link for the old address doesn't confirm a changed email", async () => {
    const mail = new FakeMail()
    const { client, username, me } = await signUpWith(mail)
    const oldToken = linkToken(mail.sent[0], '/verify-email')

    const changed = await client.fetch('/api/auth/profile', {
      method: 'PATCH',
      json: { email: `${username}@example.org` },
    })
    expect(changed.status).toBe(200)
    // Changing the email mails the new address a link of its own.
    const newToken = linkToken(mail.to(`${username}@example.org`)[0], '/verify-email')

    const stale = await post(client, '/api/auth/verify-email', { token: oldToken })
    expect(stale).toMatchObject({ status: 409, code: 'email_changed' })
    expect((await client.json<MeResponse>('/api/auth/me')).emailVerified).toBe(false)

    expect((await post(client, '/api/auth/verify-email', { token: newToken })).status).toBe(200)
    const [user] = await db.select().from(users).where(eq(users.id, me.id))
    expect(user).toMatchObject({ email: `${username}@example.org`, emailVerified: true })
  })

  it('refuses expired, unknown and malformed links, saying which', async () => {
    const mail = new FakeMail()
    const { client } = await signUpWith(mail)
    const token = linkToken(mail.sent[0], '/verify-email')
    await expireLink(token)

    expect(await post(client, '/api/auth/verify-email', { token })).toMatchObject({
      status: 410,
      code: 'token_expired',
    })
    expect(await post(client, '/api/auth/verify-email', { token: randomToken(32) })).toMatchObject({
      status: 400,
      code: 'token_invalid',
    })
    expect(await post(client, '/api/auth/verify-email', { token: 'abc' })).toMatchObject({
      status: 400,
      code: 'invalid_request',
    })
    // A reset link is not a confirmation link.
    const reset = await adminLink((await client.json<MeResponse>('/api/auth/me')).id)
    expect(await post(client, '/api/auth/verify-email', { token: reset })).toMatchObject({
      status: 400,
      code: 'token_invalid',
    })
  })

  it('mails at most 3 links an hour, and a failed send does not count', async () => {
    const mail = new FakeMail()
    const { client, email } = await signUpWith(mail)

    mail.failing = true
    expect(await post(client, '/api/auth/verify-email/send')).toMatchObject({
      status: 502,
      code: 'email_failed',
    })
    mail.failing = false

    expect((await post(client, '/api/auth/verify-email/send')).status).toBe(204)
    expect((await post(client, '/api/auth/verify-email/send')).status).toBe(204)
    expect(await post(client, '/api/auth/verify-email/send')).toMatchObject({
      status: 429,
      code: 'rate_limited',
    })
    expect(mail.to(email!)).toHaveLength(3)
  })

  it('needs a session and the CSRF header', async () => {
    const mail = new FakeMail()
    const response = await via(mail)(`${ORIGIN}/api/auth/verify-email/send`, {
      method: 'POST',
      headers: { 'x-gdt-csrf': '1' },
    })
    expect(response.status).toBe(401)
    const noCsrf = await via(mail)(`${ORIGIN}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: randomToken(32) }),
    })
    expect(noCsrf.status).toBe(403)
  })
})

describe('forgot password', () => {
  it('answers the same whoever is asked for, and mails only a confirmed email', async () => {
    const mail = new FakeMail()
    const confirmed = await confirmedUser(mail)
    const unconfirmed = await signUpWith(mail)
    const withoutEmail = await signUpWith(mail, false)
    mail.sent.length = 0

    const answers = [
      await forgot(mail, 'nobody-by-this-name'),
      await forgot(mail, 'nobody@example.com'),
      await forgot(mail, unconfirmed.username),
      await forgot(mail, unconfirmed.email!),
      await forgot(mail, withoutEmail.username),
      await forgot(mail, confirmed.username.toUpperCase()),
      await forgot(mail, ` ${confirmed.email.toUpperCase()} `),
    ]
    for (const answer of answers) {
      expect(answer).toEqual({ status: 202, body: FORGOT_PASSWORD_ANSWER, code: undefined })
    }

    // Two links, both to the confirmed address; nothing else was sent or stored.
    expect(mail.sent.map((m) => m.to)).toEqual([confirmed.email, confirmed.email])
    const tokens = mail.sent.map((m) => linkToken(m, '/reset-password'))
    expect(new Set(tokens).size).toBe(2)
    expect(mail.sent[0]).toMatchObject({ subject: 'Reset your password' })
    expect(mail.sent[0]!.text).toContain(confirmed.username)
    expect(await linksOf(unconfirmed.me.id, 'reset_password')).toHaveLength(0)
    const [row] = await linksOf(confirmed.me.id, 'reset_password')
    expect(row!.expiresAt - row!.createdAt).toBe(30 * 60_000)
  })

  it('mails one account at most 3 links an hour', async () => {
    const mail = new FakeMail()
    const { username, email } = await confirmedUser(mail)
    for (let i = 0; i < 5; i++) expect((await forgot(mail, username)).status).toBe(202)
    expect(mail.to(email)).toHaveLength(3)
  })

  it('limits each IP', async () => {
    const mail = new FakeMail()
    const statuses = await inOneWindow(async () => {
      const client = new Client(via(mail))
      const statuses: number[] = []
      for (let i = 0; i < 7; i++) {
        statuses.push((await post(client, '/api/auth/forgot-password', { login: 'x' })).status)
      }
      return statuses
    })
    expect(statuses.slice(0, 5)).toEqual([202, 202, 202, 202, 202])
    expect(statuses.at(-1)).toBe(429)
  })

  it('links point at this site, whatever host the request named', async () => {
    const mail = new FakeMail()
    const { username, email } = await confirmedUser(mail)
    const ask = (transport: Transport) =>
      post(new Client(transport), '/api/auth/forgot-password', { login: username })

    await ask(viaHost(mail, 'https://evil.example'))
    linkToken(mail.to(email)[0], '/reset-password')
    // Loopback (vite dev) keeps its origin: the token stays on the reader's machine.
    await ask(viaHost(mail, 'http://localhost:5173'))
    linkToken(mail.to(email)[1], '/reset-password', 'http://localhost:5173')
    // SITE_URL names the site when the request came elsewhere.
    await ask(viaHost(mail, 'https://evil.example', { SITE_URL: 'https://staging.example/' }))
    linkToken(mail.to(email)[2], '/reset-password', 'https://staging.example')
  })

  it('without the email binding: the same answer, nothing sent, the app is told', async () => {
    const { client, me } = await signUpWith(null) // wrangler.jsonc has no EMAIL yet
    expect(me).toMatchObject({ emailEnabled: false, emailFeatures: true })
    expect(
      await post(new Client(via(null)), '/api/auth/forgot-password', { login: me.username }),
    ).toEqual({
      status: 202,
      body: FORGOT_PASSWORD_ANSWER,
      code: undefined,
    })
    expect(await post(client, '/api/auth/verify-email/send')).toMatchObject({
      status: 503,
      code: 'email_unavailable',
    })
    expect(await linksOf(me.id, 'verify_email')).toHaveLength(0)
    expect(await linksOf(me.id, 'reset_password')).toHaveLength(0)
  })
})

describe('password reset', () => {
  it('sets the password once, ends every session and every other link, and signs in', async () => {
    const mail = new FakeMail()
    const { client: oldSession, username, email, me } = await confirmedUser(mail)
    await forgot(mail, username)
    await forgot(mail, email)
    const [first, second] = mail.to(email).map((m) => linkToken(m, '/reset-password'))
    const [before] = await db.select().from(users).where(eq(users.id, me.id))
    mail.sent.length = 0

    const browser = new Client(via(mail))
    const check = await post(browser, '/api/auth/reset-password/check', { token: first })
    expect(check).toMatchObject({ status: 200, body: { username } satisfies ResetLinkResponse })

    const weak = await post(browser, '/api/auth/reset-password', {
      token: first,
      password: 'short',
    })
    expect(weak).toMatchObject({ status: 400, code: 'invalid_request' })

    const reset = await post(browser, '/api/auth/reset-password', {
      token: first,
      password: NEW_PASSWORD,
    })
    expect(reset).toMatchObject({ status: 200, body: { id: me.id, username } })
    expect((await browser.json<MeResponse>('/api/auth/me')).id).toBe(me.id)

    // Every older session is over: token_version moved on.
    const [after] = await db.select().from(users).where(eq(users.id, me.id))
    expect(after!.tokenVersion).toBe(before!.tokenVersion + 1)
    const refresh = await post(oldSession, '/api/auth/refresh')
    expect(refresh).toMatchObject({ status: 401, code: 'session_revoked' })

    // This link and the other open one are used up.
    for (const token of [first, second]) {
      expect(
        await post(browser, '/api/auth/reset-password', { token, password: NEW_PASSWORD }),
      ).toMatchObject({ status: 410, code: 'token_used' })
    }
    expect(await post(browser, '/api/auth/reset-password/check', { token: second })).toMatchObject({
      status: 410,
      code: 'token_used',
    })

    const login = (password: string) =>
      new Client().fetch('/api/auth/login', { method: 'POST', json: { login: username, password } })
    expect((await login(PASSWORD)).status).toBe(401)
    expect((await login(NEW_PASSWORD)).status).toBe(200)

    // A notice to the confirmed address, with no link that resets anything by itself.
    expect(mail.sent).toHaveLength(1)
    expect(mail.sent[0]).toMatchObject({ to: email, subject: 'Your password was changed' })
    expect(mail.sent[0]!.text).not.toContain('token=')
  })

  it('refuses an expired link; an admin link works for a user without email', async () => {
    const mail = new FakeMail()
    const { me, username } = await signUpWith(mail, false)
    const expired = await adminLink(me.id, Date.now() - 1)
    const browser = new Client(via(mail))
    expect(await post(browser, '/api/auth/reset-password/check', { token: expired })).toMatchObject(
      { status: 410, code: 'token_expired' },
    )
    expect(
      await post(browser, '/api/auth/reset-password', { token: expired, password: NEW_PASSWORD }),
    ).toMatchObject({ status: 410, code: 'token_expired' })

    const token = await adminLink(me.id)
    const reset = await post(browser, '/api/auth/reset-password', { token, password: NEW_PASSWORD })
    expect(reset).toMatchObject({ status: 200, body: { username, email: null } })
    expect(mail.sent).toHaveLength(0) // no address to tell
  })

  it('a password change in settings ends open reset links', async () => {
    const mail = new FakeMail()
    const { client, username, email } = await confirmedUser(mail)
    await forgot(mail, username)
    const token = linkToken(mail.to(email)[0], '/reset-password')

    const changed = await client.fetch('/api/auth/password', {
      method: 'POST',
      json: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
    })
    expect(changed.status).toBe(204)
    expect(
      await post(new Client(via(mail)), '/api/auth/reset-password', {
        token,
        password: 'yet another password',
      }),
    ).toMatchObject({ status: 410, code: 'token_used' })
  })

  it("an email change ends links mailed to the old address, not an admin's", async () => {
    const mail = new FakeMail()
    const { client, username, email, me } = await confirmedUser(mail)
    await forgot(mail, username)
    const mailed = linkToken(mail.to(email)[0], '/reset-password')
    const handed = await adminLink(me.id)

    await client.fetch('/api/auth/profile', {
      method: 'PATCH',
      json: { email: `${username}@example.net` },
    })
    const browser = new Client(via(mail))
    expect(await post(browser, '/api/auth/reset-password/check', { token: mailed })).toMatchObject({
      status: 410,
      code: 'token_used',
    })
    expect((await post(browser, '/api/auth/reset-password/check', { token: handed })).status).toBe(
      200,
    )
  })

  it('maintenance purges links a day after they expired', async () => {
    const { me } = await signUpWith(null)
    const old = await adminLink(me.id, Date.now() - 25 * HOUR)
    const recent = await adminLink(me.id, Date.now() - HOUR)
    expect((await runMaintenance(env.DB)).tokens).toBeGreaterThanOrEqual(1)
    const left = (await linksOf(me.id, 'reset_password')).map((row) => row.tokenHash)
    expect(left).toEqual([await sha256Hex(recent)])
    expect(left).not.toContain(await sha256Hex(old))
  })
})

describe('email features paused (EMAIL_FEATURES unset, as in production)', () => {
  /** Paused, with a mail binding that would send if anything still asked it to. */
  const paused = (mail: FakeMail) => via(mail, { EMAIL_FEATURES: undefined })

  async function pausedUser(mail: FakeMail) {
    const username = `pz${++counter}${crypto.randomUUID().slice(0, 6)}`
    const client = new Client(paused(mail))
    const me = await client.json<MeResponse>('/api/auth/register', {
      method: 'POST',
      json: { username, password: PASSWORD },
    })
    return { client, username, me }
  }

  async function patchProfile(client: Client, json: unknown) {
    const response = await client.fetch('/api/auth/profile', { method: 'PATCH', json })
    const body = (await response.json()) as Record<string, unknown>
    return { status: response.status, body, code: (body.error as { code?: string })?.code }
  }

  it('sign-up drops an email; nothing is stored or mailed', async () => {
    const mail = new FakeMail()
    const username = `pz${++counter}${crypto.randomUUID().slice(0, 6)}`
    const register = (json: object) =>
      post(new Client(paused(mail)), '/api/auth/register', { password: PASSWORD, ...json })

    const created = await register({ username, email: `${username}@example.com` })
    expect(created).toMatchObject({
      status: 201,
      body: { username, email: null, emailEnabled: false, emailFeatures: false },
    })
    // Dropped, not refused: not even checked (a page cached from before still signs up).
    const odd = await register({ username: `${username}b`, email: 'not-an-email' })
    expect(odd).toMatchObject({ status: 201, body: { email: null } })
    // The rest is checked as ever.
    expect(await register({ username: 'x' })).toMatchObject({
      status: 400,
      code: 'invalid_request',
    })
    expect(await register({ username, email: null })).toMatchObject({ status: 409, code: 'taken' })

    const [row] = await db.select().from(users).where(eq(users.usernameKey, username))
    expect(row).toMatchObject({ email: null, emailVerified: false })
    expect(await linksOf(row!.id, 'verify_email')).toHaveLength(0)
    expect(mail.sent).toEqual([])
  })

  it('forgot-password and both verify-email routes are 404, even with a binding', async () => {
    const mail = new FakeMail()
    const { client, username, me } = await pausedUser(mail)
    const email = `${username}@example.com`
    await db.update(users).set({ email }).where(eq(users.id, me.id))
    // A confirmation link from before the pause.
    const token = randomToken(32)
    await db.insert(authTokens).values({
      userId: me.id,
      kind: 'verify_email',
      tokenHash: await sha256Hex(token),
      email,
      expiresAt: Date.now() + HOUR,
    })

    const gone = { status: 404, code: 'email_paused' }
    expect(await post(client, '/api/auth/forgot-password', { login: username })).toMatchObject(gone)
    expect(await post(client, '/api/auth/forgot-password', { login: email })).toMatchObject(gone)
    expect(await post(client, '/api/auth/verify-email/send')).toMatchObject(gone)
    expect(await post(client, '/api/auth/verify-email', { token })).toMatchObject(gone)
    // Before anything else is asked for (a session, the CSRF header).
    expect(await post(new Client(paused(mail)), '/api/auth/verify-email/send')).toMatchObject(gone)
    const noCsrf = await paused(mail)(`${ORIGIN}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: username }),
    })
    expect(noCsrf.status).toBe(404)

    expect(mail.sent).toEqual([])
    expect(await linksOf(me.id, 'reset_password')).toHaveLength(0)
    const [row] = await db.select().from(users).where(eq(users.id, me.id))
    expect(row!.emailVerified).toBe(false)
    // Untouched: once email is back, the link still confirms.
    expect(await post(new Client(via(mail)), '/api/auth/verify-email', { token })).toMatchObject({
      status: 200,
      body: { email },
    })
  })

  it('the profile can remove an email, not add or change one; it still signs in', async () => {
    const mail = new FakeMail()
    const { client, username, me } = await pausedUser(mail)
    const email = `${username}@example.com`
    const refused = { status: 403, code: 'email_paused' }

    expect(await patchProfile(client, { email })).toMatchObject(refused)
    // Refused as a whole: the username stays too.
    expect(await patchProfile(client, { username: `${username}r`, email })).toMatchObject(refused)
    expect((await client.json<MeResponse>('/api/auth/me')).username).toBe(username)

    // An email set before the pause.
    await db.update(users).set({ email, emailVerified: true }).where(eq(users.id, me.id))
    expect(await patchProfile(client, { email: `${username}@example.org` })).toMatchObject(refused)
    // The same address is no change, so the username can still go with it.
    expect(await patchProfile(client, { username: `${username}r`, email })).toMatchObject({
      status: 200,
      body: { username: `${username}r`, email, emailFeatures: false, emailEnabled: false },
    })
    const login = () =>
      post(new Client(paused(mail)), '/api/auth/login', { login: email, password: PASSWORD })
    expect((await login()).status).toBe(200)

    expect(await patchProfile(client, { email: null })).toMatchObject({
      status: 200,
      body: { email: null, emailVerified: false },
    })
    expect((await login()).status).toBe(401)
    expect(await patchProfile(client, { email: '' })).toMatchObject({ status: 200 })
    expect(mail.sent).toEqual([])
  })

  it('an admin reset link still sets the password and signs in; no notice is mailed', async () => {
    const mail = new FakeMail()
    const { client: oldSession, username, me } = await pausedUser(mail)
    // A confirmed email and a binding: only the pause keeps the notice from going out.
    await db
      .update(users)
      .set({ email: `${username}@example.com`, emailVerified: true })
      .where(eq(users.id, me.id))
    const token = await adminLink(me.id)

    const browser = new Client(paused(mail))
    expect(await post(browser, '/api/auth/reset-password/check', { token })).toMatchObject({
      status: 200,
      body: { username } satisfies ResetLinkResponse,
    })
    const reset = await post(browser, '/api/auth/reset-password', { token, password: NEW_PASSWORD })
    expect(reset).toMatchObject({
      status: 200,
      body: { id: me.id, username, emailFeatures: false },
    })
    expect((await browser.json<MeResponse>('/api/auth/me')).id).toBe(me.id)
    expect(await post(oldSession, '/api/auth/refresh')).toMatchObject({
      status: 401,
      code: 'session_revoked',
    })
    const login = await post(new Client(paused(mail)), '/api/auth/login', {
      login: username,
      password: NEW_PASSWORD,
    })
    expect(login.status).toBe(200)
    expect(
      await post(browser, '/api/auth/reset-password', { token, password: NEW_PASSWORD }),
    ).toMatchObject({ status: 410, code: 'token_used' })
    expect(mail.sent).toEqual([])
  })
})
