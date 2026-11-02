import {
  toBase64Url,
  type AccountCreatedResponse,
  type ImportResponse,
  type IrminsulDiscovery,
  type IrminsulTokenResponse,
  type IrminsulWhoami,
  type SessionResponse,
  type UploadTarget,
} from '@gdt/shared'
import { env, SELF } from 'cloudflare:test'
import { sign } from 'hono/jwt'
import { describe, expect, it } from 'vitest'
import { randomToken, sha256Hex } from '../lib/crypto'
import { runMaintenance } from '../services/maintenance'
import { UPLOAD_LIMIT_DEFAULTS, utcDay } from '../services/upload-limits'
import {
  Client,
  ORIGIN,
  irminsulForm,
  sampleExtras,
  sampleGood,
  signUp,
  withEnv,
  type Transport,
} from './client'

const DIAG = 'test-diag-key-test-diag-key-test-diag-key'
const REDIRECT = 'http://127.0.0.1:53682/callback'
const STATE = 'state-0123456789abcdefghijklmnopqrstuvwxyz'
const self: Transport = (url, init) => SELF.fetch(url, init)

async function pkce() {
  const verifier = randomToken(32)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: toBase64Url(new Uint8Array(digest)) }
}

interface AuthorizeOptions {
  challenge: string
  upload?: UploadTarget
  redirect?: string
  clientId?: string
  device?: string
}

function authorizeBody(options: AuthorizeOptions) {
  return {
    client_id: options.clientId ?? 'irminsul',
    redirect_uri: options.redirect ?? REDIRECT,
    state: STATE,
    code_challenge: options.challenge,
    code_challenge_method: 'S256',
    device: options.device ?? 'GAMING-PC',
    upload: options.upload ?? { mode: 'uid' },
  }
}

/** The /link page's Allow: the redirect's code. */
async function authorize(client: Client, options: AuthorizeOptions): Promise<string> {
  const { redirect } = await client.json<{ redirect: string }>('/api/oauth/authorize', {
    method: 'POST',
    json: authorizeBody(options),
  })
  const url = new URL(redirect)
  expect(url.origin + url.pathname).toBe(options.redirect ?? REDIRECT)
  expect(url.searchParams.get('state')).toBe(STATE)
  return url.searchParams.get('code')!
}

async function tokenCall(
  params: Record<string, string>,
  as: 'json' | 'form' = 'json',
  transport: Transport = self,
) {
  const response = await transport(`${ORIGIN}/api/oauth/token`, {
    method: 'POST',
    headers: {
      'content-type': as === 'json' ? 'application/json' : 'application/x-www-form-urlencoded',
      'cf-connecting-ip': `2001:db8:1::${Math.floor(Math.random() * 0xffff).toString(16)}`,
    },
    body: as === 'json' ? JSON.stringify(params) : new URLSearchParams(params).toString(),
  })
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

const exchange = (code: string, verifier: string, extra: Record<string, string> = {}) =>
  tokenCall({
    grant_type: 'authorization_code',
    client_id: 'irminsul',
    code,
    code_verifier: verifier,
    redirect_uri: REDIRECT,
    ...extra,
  })

const refresh = (refreshToken: string) =>
  tokenCall({ grant_type: 'refresh_token', client_id: 'irminsul', refresh_token: refreshToken })

/** Signs irminsul in for `client`'s user. */
async function signIn(client: Client, upload: UploadTarget = { mode: 'uid' }, device?: string) {
  const { verifier, challenge } = await pkce()
  const code = await authorize(client, { challenge, upload, device })
  const { status, body } = await exchange(code, verifier)
  expect(status, JSON.stringify(body)).toBe(200)
  return body as unknown as IrminsulTokenResponse
}

function bearer(
  path: string,
  access: string,
  init: RequestInit = {},
  transport: Transport = self,
): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${access}`)
  return transport(`${ORIGIN}${path}`, { ...init, headers })
}

async function whoami(access: string) {
  const response = await bearer('/api/irminsul/whoami', access)
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

const codeOf = async (response: Response) =>
  ((await response.json()) as { error?: { code: string } }).error?.code

function upload(access: string, good: unknown, timestamp?: number, transport: Transport = self) {
  return bearer(
    '/api/irminsul/import',
    access,
    { method: 'POST', body: irminsulForm(good, timestamp) },
    transport,
  )
}

async function createAccount(client: Client, uid = '812345678', name = 'Main') {
  return client.json<AccountCreatedResponse>('/api/accounts', {
    method: 'POST',
    json: { name, uid, server: 'ASIA' },
  })
}

const irminsulRows = (userId: number) =>
  env.DB.prepare(
    `SELECT id, user_agent, device_name, upload_mode, upload_account_id, revoked_at
     FROM user_sessions WHERE user_id = ?1 AND method = 'irminsul' ORDER BY id`,
  )
    .bind(userId)
    .all<Record<string, unknown>>()
    .then((r) => r.results)

describe('discovery', () => {
  it('answers absolute URLs from the request origin', async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/oauth/irminsul`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual<IrminsulDiscovery>({
      authorize_url: `${ORIGIN}/link`,
      token_url: `${ORIGIN}/api/oauth/token`,
      revoke_url: `${ORIGIN}/api/oauth/revoke`,
      client_id: 'irminsul',
      version: 1,
    })
    const local = await SELF.fetch('http://localhost:5181/api/oauth/irminsul')
    expect(((await local.json()) as IrminsulDiscovery).authorize_url).toBe(
      'http://localhost:5181/link',
    )
  })

  it('sends the old address to the site for sign-in, keeping its API', async () => {
    const response = await SELF.fetch('https://genshin-tracker.475.dev/api/oauth/irminsul')
    const body = (await response.json()) as IrminsulDiscovery
    expect(body.authorize_url).toBe('https://teyvat.me/link')
    expect(body.token_url).toBe('https://genshin-tracker.475.dev/api/oauth/token')
    expect(body.revoke_url).toBe('https://genshin-tracker.475.dev/api/oauth/revoke')
  })
})

describe('sign in, upload, refresh, sign out', () => {
  it('names a Teyvat.me sign-in after Teyvat.me', async () => {
    const { client, me } = await signUp()
    const { verifier, challenge } = await pkce()
    const code = await authorize(client, { challenge, device: 'GAMING-PC' })
    expect((await exchange(code, verifier, { app: 'teyvatme' })).status).toBe(200)
    const [row] = await irminsulRows(me.id)
    expect(row).toMatchObject({ user_agent: 'Teyvat.me on GAMING-PC', device_name: 'GAMING-PC' })
  })

  it('runs the whole flow in uid mode', async () => {
    const { client, username, me } = await signUp()
    const { verifier, challenge } = await pkce()
    const code = await authorize(client, { challenge, device: 'GAMING-PC' })
    // Form-encoded, as RFC 6749 has it.
    const exchanged = await tokenCall(
      {
        grant_type: 'authorization_code',
        client_id: 'irminsul',
        code,
        code_verifier: verifier,
        redirect_uri: REDIRECT,
      },
      'form',
    )
    expect(exchanged.status).toBe(200)
    const tokens = exchanged.body as unknown as IrminsulTokenResponse
    expect(tokens).toMatchObject({
      token_type: 'Bearer',
      expires_in: 7200,
      refresh_expires_in: 2_592_000,
      refresh_token: expect.stringMatching(/^gdt_irt_\d+_[A-Za-z0-9_-]{43}$/),
    })
    const [row] = await irminsulRows(me.id)
    expect(row).toMatchObject({
      user_agent: 'Irminsul on GAMING-PC',
      device_name: 'GAMING-PC',
      upload_mode: 'uid',
      upload_account_id: null,
      revoked_at: null,
    })
    const expected: IrminsulWhoami = {
      scope: 'uid',
      user: username,
      accountId: null,
      accountName: null,
      uid: null,
      server: null,
      dashboardUrl: `${ORIGIN}/app`,
      configUrl: `${ORIGIN}/app/settings/devices?device=${row!.id}`,
    }
    expect(tokens.whoami).toEqual(expected)
    expect((await whoami(tokens.access_token)).body).toEqual(expected)

    // A new UID makes its account; another one makes another.
    const first = await upload(tokens.access_token, sampleGood(sampleExtras(812345678)), 1_000)
    expect(first.status).toBe(201)
    const firstBody = (await first.json()) as ImportResponse
    expect(firstBody.account).toMatchObject({ uid: '812345678', created: true })
    const second = await upload(tokens.access_token, sampleGood(sampleExtras(811111111)), 2_000)
    expect(second.status).toBe(201)
    expect(((await second.json()) as ImportResponse).account).toMatchObject({
      uid: '811111111',
      created: true,
    })
    // The same file again stores nothing.
    const again = await upload(tokens.access_token, sampleGood(sampleExtras(812345678)), 1_000)
    expect(again.status).toBe(200)
    expect(((await again.json()) as ImportResponse).account).toMatchObject({
      id: firstBody.account!.id,
      created: false,
    })
    // uid mode needs the file's UID.
    const noUid = await upload(tokens.access_token, sampleGood(), 3_000)
    expect(noUid.status).toBe(422)
    expect(await codeOf(noUid)).toBe('uid_required')

    // Refresh rotates: the new pair works, the old access token still does until it expires.
    const rotated = await refresh(tokens.refresh_token)
    expect(rotated.status).toBe(200)
    const next = rotated.body as unknown as IrminsulTokenResponse
    expect(next.refresh_token).not.toBe(tokens.refresh_token)
    expect(next.whoami).toEqual(expected)
    expect((await whoami(next.access_token)).status).toBe(200)
    const rotatedAgain = await refresh(next.refresh_token)
    expect(rotatedAgain.status).toBe(200)
    const latest = rotatedAgain.body as unknown as IrminsulTokenResponse

    // Revoke ends the session: refresh and the Bearer routes refuse it.
    const revoked = await SELF.fetch(`${ORIGIN}/api/oauth/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: latest.refresh_token, client_id: 'irminsul' }),
    })
    expect(revoked.status).toBe(200)
    expect(await refresh(latest.refresh_token)).toMatchObject({
      status: 400,
      body: { error: 'invalid_grant' },
    })
    const after = await whoami(latest.access_token)
    expect(after).toMatchObject({ status: 401, body: { error: { code: 'session_revoked' } } })
    const refused = await upload(latest.access_token, sampleGood(sampleExtras()), 4_000)
    expect(refused.status).toBe(401)
    expect(await codeOf(refused)).toBe('session_revoked')
    // Revoking again (or anything at all) is still 200.
    for (const token of [latest.refresh_token, 'nonsense', '']) {
      const response = await SELF.fetch(`${ORIGIN}/api/oauth/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }).toString(),
      })
      expect(response.status).toBe(200)
    }
  })

  it('uploads to the chosen account in account mode, whatever the UID', async () => {
    const { client, username } = await signUp()
    const { account } = await createAccount(client, '812345678', 'Main')
    const tokens = await signIn(client, { mode: 'account', account_id: account.id })
    expect(tokens.whoami).toMatchObject({
      scope: 'account',
      user: username,
      accountId: account.id,
      accountName: 'Main',
      uid: '812345678',
      server: 'ASIA',
      dashboardUrl: `${ORIGIN}/app/a/${account.id}`,
    })
    // No UID is fine here; another UID lands on the account too, with a warning.
    const plain = await upload(tokens.access_token, sampleGood(), 1_000)
    expect(plain.status).toBe(201)
    expect(((await plain.json()) as ImportResponse).account!.id).toBe(account.id)
    const other = await upload(tokens.access_token, sampleGood(sampleExtras(811111111)), 2_000)
    expect(other.status).toBe(201)
    const body = (await other.json()) as ImportResponse
    expect(body.account).toMatchObject({ id: account.id, created: false })
    expect(body.warnings?.length).toBeGreaterThan(0)

    // The chosen account deleted: uploads stop until another target is set.
    expect(
      (await client.fetch(`/api/accounts/${account.id}`, { method: 'DELETE' })).status,
    ).toBeLessThan(300)
    const gone = await upload(tokens.access_token, sampleGood(), 3_000)
    expect(gone.status).toBe(409)
    expect(await codeOf(gone)).toBe('upload_target_missing')
    expect((await whoami(tokens.access_token)).body).toMatchObject({
      scope: 'account',
      accountId: null,
      dashboardUrl: `${ORIGIN}/app`,
    })
  })

  it('takes a reused refresh token as stolen and ends the session', async () => {
    const { client } = await signUp()
    const tokens = await signIn(client)
    const rotated = await refresh(tokens.refresh_token)
    expect(rotated.status).toBe(200)
    const next = rotated.body as unknown as IrminsulTokenResponse
    expect(await refresh(tokens.refresh_token)).toMatchObject({
      status: 400,
      body: { error: 'invalid_grant' },
    })
    // The newer one dies with it.
    expect((await refresh(next.refresh_token)).body).toMatchObject({ error: 'invalid_grant' })
    expect((await whoami(next.access_token)).status).toBe(401)
  })
})

describe('Devices panel', () => {
  it('lists irminsul with its target, and only irminsul sessions take a new one', async () => {
    const { client, me } = await signUp()
    const { account } = await createAccount(client)
    const tokens = await signIn(client, { mode: 'uid' }, 'Desk PC')
    const sessions = await client.json<SessionResponse[]>('/api/auth/sessions')
    const desk = sessions.find((s) => s.method === 'irminsul')!
    expect(desk).toMatchObject({
      userAgent: 'Irminsul on Desk PC',
      deviceName: 'Desk PC',
      upload: { mode: 'uid' },
      current: false,
    })
    const browser = sessions.find((s) => s.current)!
    expect(browser.upload).toBeNull()

    const patch = (id: number, body: unknown, as = client) =>
      as.fetch(`/api/auth/sessions/${id}`, { method: 'PATCH', json: body })
    const changed = await patch(desk.id, { upload: { mode: 'account', account_id: account.id } })
    expect(changed.status).toBe(200)
    expect(await changed.json()).toEqual({ upload: { mode: 'account', accountId: account.id } })
    expect((await whoami(tokens.access_token)).body).toMatchObject({
      scope: 'account',
      accountId: account.id,
    })
    const [row] = await irminsulRows(me.id)
    expect(row).toMatchObject({ upload_mode: 'account', upload_account_id: account.id })

    // A browser session has no target; someone else's account is refused.
    expect((await patch(browser.id, { upload: { mode: 'uid' } })).status).toBe(404)
    const stranger = await signUp()
    const theirs = await createAccount(stranger.client, '811111111')
    const foreign = await patch(desk.id, {
      upload: { mode: 'account', account_id: theirs.account.id },
    })
    expect(foreign.status).toBe(400)
    expect(await codeOf(foreign)).toBe('invalid_account')
    // Nor can another user change this one.
    expect((await patch(desk.id, { upload: { mode: 'uid' } }, stranger.client)).status).toBe(404)
    expect((await patch(desk.id, { upload: { mode: 'nope' } })).status).toBe(400)

    // Signing it out from the panel ends it for irminsul.
    expect((await client.fetch(`/api/auth/sessions/${desk.id}`, { method: 'DELETE' })).status).toBe(
      204,
    )
    expect((await refresh(tokens.refresh_token)).body).toMatchObject({ error: 'invalid_grant' })
    expect(await whoami(tokens.access_token)).toMatchObject({ status: 401 })
  })
})

describe('authorize refuses', () => {
  it('a redirect that is not a loopback callback', async () => {
    const { client } = await signUp()
    const { challenge } = await pkce()
    for (const redirect of [
      'https://evil.example/callback',
      'http://127.0.0.1:0/callback',
      'http://127.0.0.1:70000/callback',
      'http://127.0.0.1:8080/other',
      'http://127.0.0.1:8080/callback?x=1',
      'http://127.0.0.2:8080/callback',
      'https://127.0.0.1:8080/callback',
      'http://localhost.evil.example:8080/callback',
    ]) {
      const response = await client.fetch('/api/oauth/authorize', {
        method: 'POST',
        json: authorizeBody({ challenge, redirect }),
      })
      expect(response.status, redirect).toBe(400)
      expect(await codeOf(response), redirect).toBe('invalid_redirect')
    }
    // localhost is a loopback too.
    await authorize(client, { challenge, redirect: 'http://localhost:65535/callback' })
  })

  it('another client, a bad challenge, someone else’s account, no CSRF header, no session', async () => {
    const { client } = await signUp()
    const { challenge } = await pkce()
    const post = (body: unknown, as = client) =>
      as.fetch('/api/oauth/authorize', { method: 'POST', json: body })
    const wrongClient = await post(authorizeBody({ challenge, clientId: 'other' }))
    expect(wrongClient.status).toBe(400)
    expect(await codeOf(wrongClient)).toBe('invalid_request')
    const plain = await post({ ...authorizeBody({ challenge }), code_challenge_method: 'plain' })
    expect(await codeOf(plain)).toBe('invalid_request')
    const short = await post(authorizeBody({ challenge: 'abc' }))
    expect(await codeOf(short)).toBe('invalid_request')

    const stranger = await signUp()
    const { account } = await createAccount(stranger.client)
    const foreign = await post(
      authorizeBody({ challenge, upload: { mode: 'account', account_id: account.id } }),
    )
    expect(foreign.status).toBe(400)
    expect(await codeOf(foreign)).toBe('invalid_account')

    const noCsrf = await SELF.fetch(`${ORIGIN}/api/oauth/authorize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `gdt_at=${client.cookie('gdt_at')}` },
      body: JSON.stringify(authorizeBody({ challenge })),
    })
    expect(noCsrf.status).toBe(403)
    const signedOut = await post(authorizeBody({ challenge }), new Client())
    expect(signedOut.status).toBe(401)
  })
})

describe('token refuses', () => {
  it('a verifier that does not match the challenge, and burns the code', async () => {
    const { client } = await signUp()
    const { verifier, challenge } = await pkce()
    const code = await authorize(client, { challenge })
    const wrong = await exchange(code, (await pkce()).verifier)
    expect(wrong).toMatchObject({ status: 400, body: { error: 'invalid_grant' } })
    expect((await exchange(code, verifier)).body).toMatchObject({ error: 'invalid_grant' })
  })

  it('a wrong, expired or reused code; another redirect; another client; other grants', async () => {
    const { client, me } = await signUp()
    const { verifier, challenge } = await pkce()

    expect((await exchange(randomToken(32), verifier)).body).toMatchObject({
      error: 'invalid_grant',
    })

    const late = await authorize(client, { challenge })
    await env.DB.prepare('UPDATE oauth_codes SET expires_at = ?2 WHERE code_hash = ?1')
      .bind(await sha256Hex(late), Date.now() - 1)
      .run()
    expect((await exchange(late, verifier)).body).toMatchObject({ error: 'invalid_grant' })

    const moved = await authorize(client, { challenge })
    expect(
      (await exchange(moved, verifier, { redirect_uri: 'http://127.0.0.1:1/callback' })).body,
    ).toMatchObject({ error: 'invalid_grant' })

    const otherClient = await authorize(client, { challenge })
    expect(await exchange(otherClient, verifier, { client_id: 'someone' })).toMatchObject({
      status: 400,
      body: { error: 'invalid_request' },
    })

    // Used twice: the second is refused and ends the session the first made.
    const twice = await authorize(client, { challenge })
    const first = await exchange(twice, verifier)
    expect(first.status).toBe(200)
    const tokens = first.body as unknown as IrminsulTokenResponse
    expect((await exchange(twice, verifier)).body).toMatchObject({ error: 'invalid_grant' })
    expect(await whoami(tokens.access_token)).toMatchObject({
      status: 401,
      body: { error: { code: 'session_revoked' } },
    })
    expect((await irminsulRows(me.id)).every((r) => r.revoked_at !== null)).toBe(true)

    expect((await tokenCall({ grant_type: 'password', client_id: 'irminsul' })).body).toMatchObject(
      { error: 'unsupported_grant_type' },
    )
    expect((await tokenCall({ client_id: 'irminsul' })).body).toMatchObject({
      error: 'invalid_request',
    })
    expect((await refresh('gdt_irt_1_nope')).body).toMatchObject({ error: 'invalid_grant' })
    const notJson = await SELF.fetch(`${ORIGIN}/api/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'hi',
    })
    expect(notJson.status).toBe(400)
    expect(await notJson.json()).toMatchObject({ error: 'invalid_request' })
  })
})

describe('staff stops', () => {
  it('a suspended user at every step', async () => {
    const { client, me } = await signUp()
    const tokens = await signIn(client)
    const { verifier, challenge } = await pkce()
    const pending = await authorize(client, { challenge })
    await env.DB.prepare('UPDATE users SET suspended_at = 1 WHERE id = ?1').bind(me.id).run()

    const refused = await client.fetch('/api/oauth/authorize', {
      method: 'POST',
      json: authorizeBody({ challenge }),
    })
    expect(refused.status).toBe(403)
    expect(await codeOf(refused)).toBe('account_suspended')
    expect(await exchange(pending, verifier)).toMatchObject({
      status: 403,
      body: { error: 'account_suspended' },
    })
    expect(await refresh(tokens.refresh_token)).toMatchObject({
      status: 403,
      body: { error: 'account_suspended' },
    })
    expect(await whoami(tokens.access_token)).toMatchObject({
      status: 403,
      body: { error: { code: 'account_suspended' } },
    })
    const upload1 = await upload(tokens.access_token, sampleGood(sampleExtras()), 1_000)
    expect(upload1.status).toBe(403)
    expect(await codeOf(upload1)).toBe('account_suspended')
  })

  it('blocked uploads', async () => {
    const { client, me } = await signUp()
    const tokens = await signIn(client)
    await env.DB.prepare('UPDATE users SET uploads_blocked_at = 1 WHERE id = ?1').bind(me.id).run()
    const refused = await upload(tokens.access_token, sampleGood(sampleExtras()), 1_000)
    expect(refused.status).toBe(403)
    expect(await codeOf(refused)).toBe('uploads_blocked')
  })
})

describe('signing out elsewhere ends irminsul too', () => {
  async function ended(tokens: IrminsulTokenResponse) {
    expect((await refresh(tokens.refresh_token)).body).toMatchObject({ error: 'invalid_grant' })
    expect(await whoami(tokens.access_token)).toMatchObject({
      status: 401,
      body: { error: { code: 'session_revoked' } },
    })
  }

  it('sign out other devices', async () => {
    const { client } = await signUp()
    const tokens = await signIn(client)
    expect(
      (await client.fetch('/api/auth/sessions/revoke-others', { method: 'POST' })).status,
    ).toBe(204)
    await ended(tokens)
  })

  it('a password change', async () => {
    const { client, password } = await signUp()
    const tokens = await signIn(client)
    const changed = await client.fetch('/api/auth/password', {
      method: 'POST',
      json: { currentPassword: password, newPassword: 'another horse battery staple' },
    })
    expect(changed.status).toBe(204)
    await ended(tokens)
  })

  it('sign out everywhere', async () => {
    const { client } = await signUp()
    const tokens = await signIn(client)
    expect((await client.fetch('/api/auth/logout-all', { method: 'POST' })).status).toBe(204)
    await ended(tokens)
  })
})

describe('the two worlds stay apart', () => {
  it('a Bearer token opens no cookie route, a cookie no Bearer route', async () => {
    const { client } = await signUp()
    const tokens = await signIn(client)

    // irminsul's access token as a header, or smuggled into the cookie.
    const asHeader = await bearer('/api/auth/me', tokens.access_token)
    expect(asHeader.status).toBe(401)
    const smuggled = new Client()
    smuggled.setCookie('gdt_at', tokens.access_token, '/api')
    expect((await smuggled.fetch('/api/auth/me')).status).toBe(401)
    expect((await smuggled.fetch('/api/accounts')).status).toBe(401)
    // Nor is its refresh token a browser refresh cookie.
    const refreshCookie = new Client()
    refreshCookie.setCookie('gdt_rt', tokens.refresh_token, '/api/auth')
    expect((await refreshCookie.fetch('/api/auth/refresh', { method: 'POST' })).status).toBe(401)

    // The browser's cookies, or its access token as a Bearer, on irminsul's routes.
    const withCookies = await client.fetch('/api/irminsul/whoami')
    expect(withCookies.status).toBe(401)
    expect(await codeOf(withCookies)).toBe('unauthenticated')
    const browserToken = await bearer('/api/irminsul/whoami', client.cookie('gdt_at')!)
    expect(browserToken.status).toBe(401)
    expect(await codeOf(browserToken)).toBe('invalid_token')
    const uploadWithCookies = await client.fetch('/api/irminsul/import', {
      method: 'POST',
      body: irminsulForm(sampleGood(sampleExtras())),
    })
    expect(uploadWithCookies.status).toBe(401)
  })

  it('an expired or forged access token asks for a refresh', async () => {
    const { client, me } = await signUp()
    const tokens = await signIn(client)
    const sid = Number(/^gdt_irt_(\d+)_/.exec(tokens.refresh_token)![1])
    const now = Math.floor(Date.now() / 1000)
    const claims = { sub: String(me.id), sid, ver: 0, typ: 'irminsul', aud: 'irminsul' }
    const expired = await sign({ ...claims, iat: now - 1000, exp: now - 10 }, env.JWT_SECRET)
    expect(await whoami(expired)).toMatchObject({
      status: 401,
      body: { error: { code: 'token_expired' } },
    })
    const forged = await sign({ ...claims, iat: now, exp: now + 900 }, 'x'.repeat(48))
    expect((await whoami(forged)).body).toMatchObject({ error: { code: 'token_expired' } })
  })
})

describe('upload limits apply as to keys', () => {
  it('the daily and storage quotas', async () => {
    const { client, me } = await signUp()
    const tokens = await signIn(client)
    expect((await upload(tokens.access_token, sampleGood(sampleExtras()), 1_000)).status).toBe(201)

    await env.DB.prepare(
      `INSERT INTO user_upload_days (user_id, day, snapshots, stored_bytes) VALUES (?1, ?2, ?3, 1)
       ON CONFLICT (user_id, day) DO UPDATE SET snapshots = ?3`,
    )
      .bind(me.id, utcDay(Date.now()), UPLOAD_LIMIT_DEFAULTS.dailySnapshots)
      .run()
    const daily = await upload(
      tokens.access_token,
      sampleGood({ ...sampleExtras(), materials: { Mora: 1 } }),
      2_000,
    )
    expect(daily.status).toBe(429)
    expect(await codeOf(daily)).toBe('daily_upload_limit')
    await env.DB.prepare('DELETE FROM user_upload_days WHERE user_id = ?1').bind(me.id).run()

    await env.DB.prepare('UPDATE users SET storage_quota = 1 WHERE id = ?1').bind(me.id).run()
    const full = await upload(
      tokens.access_token,
      sampleGood({ ...sampleExtras(), materials: { Mora: 2 } }),
      3_000,
    )
    expect(full.status).toBe(413)
    expect(await codeOf(full)).toBe('storage_quota')
  })

  it('20 uploads a minute per session', async () => {
    const { client } = await signUp()
    const tokens = await signIn(client)
    const good = sampleGood(sampleExtras())
    for (let i = 0; i < 20; i++) {
      expect((await upload(tokens.access_token, good, 1_000)).status).toBeLessThan(300)
    }
    const limited = await upload(tokens.access_token, good, 1_000)
    expect(limited.status).toBe(429)
    // Another session of the same user has its own budget.
    const other = await signIn(client)
    expect((await upload(other.access_token, good, 1_000)).status).toBe(200)
  })
})

describe('D1 cost', () => {
  /** env.DB that counts every round trip (a batch, or one statement's query). */
  function countingDb() {
    const real = env.DB
    const counter = { trips: 0 }
    const unwrap = new WeakMap<object, D1PreparedStatement>()
    const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
      const wrapped = {
        bind: (...values: unknown[]) => wrap(statement.bind(...values)),
        first: (column?: string) => {
          counter.trips++
          return column === undefined ? statement.first() : statement.first(column)
        },
        all: () => {
          counter.trips++
          return statement.all()
        },
        run: () => {
          counter.trips++
          return statement.run()
        },
        raw: (options?: { columnNames?: boolean }) => {
          counter.trips++
          return statement.raw(options as { columnNames: true })
        },
      }
      unwrap.set(wrapped, statement)
      return wrapped as unknown as D1PreparedStatement
    }
    const db = {
      prepare: (query: string) => wrap(real.prepare(query)),
      batch: (statements: D1PreparedStatement[]) => {
        counter.trips++
        return real.batch(statements.map((s) => unwrap.get(s) ?? s))
      },
      exec: (query: string) => {
        counter.trips++
        return real.exec(query)
      },
      dump: () => real.dump(),
      // Every request runs on a session (d1-session.ts): one counted the same way.
      withSession: () => ({ prepare: db.prepare, batch: db.batch, getBookmark: () => null }),
    }
    return { db: db as unknown as D1Database, counter }
  }

  it('an irminsul upload costs what an import-key upload costs', async () => {
    // Two fresh accounts, one uploaded to by key, the other by token, step by step.
    const { client } = await signUp()
    const { account } = await createAccount(client)
    const tokens = await signIn(client, { mode: 'account', account_id: account.id })
    const other = await signUp()
    const { importKey: otherKey } = await createAccount(other.client)

    const { db, counter } = countingDb()
    const transport = withEnv({ DB: db })
    const measure = async (send: () => Promise<Response>) => {
      counter.trips = 0
      const response = await send()
      const header = response.headers.get('x-gdt-d1') ?? ''
      const metered = Number(/round-trips=(\d+)/.exec(header)?.[1] ?? NaN)
      return { status: response.status, trips: counter.trips, metered }
    }
    const byKey = (key: string, good: unknown, at: number) => () =>
      transport(`${ORIGIN}/api/genshin-accounts-public/import-by-key`, {
        method: 'POST',
        headers: { 'x-import-key': key, 'x-diag-key': DIAG },
        body: irminsulForm(good, at),
      })
    const byToken = (good: unknown, at: number) => () =>
      bearer(
        '/api/irminsul/import',
        tokens.access_token,
        { method: 'POST', headers: { 'x-diag-key': DIAG }, body: irminsulForm(good, at) },
        transport,
      )

    // First upload (new artifacts), a later one, an unchanged re-upload: each the same.
    const steps = [
      [sampleGood(), 1_000],
      [sampleGood({ materials: { Mora: 1 } }), 2_000],
      [sampleGood({ materials: { Mora: 1 } }), 2_000],
    ] as const
    for (const [good, at] of steps) {
      const key = await measure(byKey(otherKey, good, at))
      const token = await measure(byToken(good, at))
      expect(key.metered).toBeGreaterThan(0)
      expect(key.trips).toBeGreaterThan(key.metered)
      expect(token.status).toBe(key.status)
      expect(token.trips).toBe(key.trips)
      expect(token.metered).toBe(key.metered)
    }
  })
})

describe('maintenance', () => {
  it('deletes codes a day after they expired', async () => {
    const { client, me } = await signUp()
    const { challenge } = await pkce()
    await authorize(client, { challenge })
    const count = () =>
      env.DB.prepare('SELECT count(*) AS n FROM oauth_codes WHERE user_id = ?1')
        .bind(me.id)
        .first<{ n: number }>()
        .then((r) => r!.n)
    expect(await count()).toBe(1)
    await runMaintenance(env.DB, Date.now() + 2 * 60_000)
    expect(await count()).toBe(1)
    await runMaintenance(env.DB, Date.now() + 25 * 60 * 60_000)
    expect(await count()).toBe(0)
  })
})
