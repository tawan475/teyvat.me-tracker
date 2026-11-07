import {
  toBase64Url,
  type MeResponse,
  type PasskeyCreationOptions,
  type PasskeyRequestOptions,
  type PasskeyResponse,
  type SessionResponse,
} from '@gdt/shared'
import { env } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { getDb } from '../db/client'
import { passkeyChallenges, userIdentities, users } from '../db/schema'
import {
  checkChallenge,
  decodeCbor,
  derToRaw,
  makeChallenge,
  relyingParty,
  LOGIN_TTL_MS,
} from '../lib/webauthn'
import { runMaintenance } from '../services/maintenance'
import { Client, ORIGIN, signUp } from './client'

const db = getDb(env.DB)
const encoder = new TextEncoder()

// ------------------------------------------------------------ a software authenticator

function head(major: number, n: number): number[] {
  if (n < 24) return [(major << 5) | n]
  if (n < 0x100) return [(major << 5) | 24, n]
  if (n < 0x10000) return [(major << 5) | 25, n >> 8, n & 0xff]
  return [(major << 5) | 26, (n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

/** Just enough CBOR for an attestation object and a COSE key. */
function cbor(value: unknown): Uint8Array {
  const out: number[] = []
  const put = (v: unknown): void => {
    if (typeof v === 'number') out.push(...(v >= 0 ? head(0, v) : head(1, -1 - v)))
    else if (typeof v === 'string') {
      const bytes = encoder.encode(v)
      out.push(...head(3, bytes.length), ...bytes)
    } else if (v instanceof Uint8Array) out.push(...head(2, v.length), ...v)
    else if (Array.isArray(v)) {
      out.push(...head(4, v.length))
      v.forEach(put)
    } else if (v instanceof Map) {
      out.push(...head(5, v.size))
      for (const [k, item] of v) {
        put(k)
        put(item)
      }
    } else throw new Error(`cbor: ${typeof v}`)
  }
  put(value)
  return new Uint8Array(out)
}

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

const sha256 = async (bytes: Uint8Array) =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))

const fromJwk = (text: string) =>
  Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0))

/** WebCrypto's r || s as the DER an authenticator sends. */
function rawToDer(raw: Uint8Array): Uint8Array {
  const ints = [raw.subarray(0, 32), raw.subarray(32)].map((part) => {
    let int = part
    while (int.length > 1 && int[0] === 0 && !(int[1]! & 0x80)) int = int.subarray(1)
    if (int[0]! & 0x80) int = concat(new Uint8Array([0]), int)
    return concat(new Uint8Array([0x02, int.length]), int)
  })
  const body = concat(...ints)
  return concat(new Uint8Array([0x30, body.length]), body)
}

const UP_UV = 0x05
const UP_UV_AT = 0x45

class SoftAuthenticator {
  readonly credentialId = crypto.getRandomValues(new Uint8Array(32))
  signCount = 0
  userHandle: string | null = null

  private constructor(
    private readonly keys: CryptoKeyPair,
    /** Counts each use, as security keys do; platform passkeys keep 0. */
    private readonly counting: boolean,
  ) {}

  static async make(counting = false): Promise<SoftAuthenticator> {
    const keys = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair
    return new SoftAuthenticator(keys, counting)
  }

  get id(): string {
    return toBase64Url(this.credentialId)
  }

  private async cose(): Promise<Uint8Array> {
    const jwk = (await crypto.subtle.exportKey('jwk', this.keys.publicKey)) as JsonWebKey
    return cbor(
      new Map<number, unknown>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, fromJwk(jwk.x!)],
        [-3, fromJwk(jwk.y!)],
      ]),
    )
  }

  private count(): Uint8Array {
    if (this.counting) this.signCount++
    const bytes = new Uint8Array(4)
    new DataView(bytes.buffer).setUint32(0, this.signCount)
    return bytes
  }

  async register(
    options: PasskeyCreationOptions,
    tweak: { origin?: string; rpId?: string; flags?: number; challenge?: string } = {},
  ) {
    this.userHandle = options.user.id
    const clientData = encoder.encode(
      JSON.stringify({
        type: 'webauthn.create',
        challenge: tweak.challenge ?? options.challenge,
        origin: tweak.origin ?? ORIGIN,
        crossOrigin: false,
      }),
    )
    const idLength = new Uint8Array([0, this.credentialId.length])
    const authData = concat(
      await sha256(encoder.encode(tweak.rpId ?? options.rp.id)),
      new Uint8Array([tweak.flags ?? UP_UV_AT]),
      this.count(),
      new Uint8Array(16),
      idLength,
      this.credentialId,
      await this.cose(),
    )
    const attestationObject = cbor(
      new Map<string, unknown>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authData],
      ]),
    )
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key' as const,
      response: {
        clientDataJSON: toBase64Url(clientData),
        attestationObject: toBase64Url(attestationObject),
        transports: ['internal'],
      },
    }
  }

  async assert(
    options: PasskeyRequestOptions,
    tweak: { origin?: string; rpId?: string; flags?: number; userHandle?: string | null } = {},
  ) {
    const clientData = encoder.encode(
      JSON.stringify({
        type: 'webauthn.get',
        challenge: options.challenge,
        origin: tweak.origin ?? ORIGIN,
        crossOrigin: false,
      }),
    )
    const authData = concat(
      await sha256(encoder.encode(tweak.rpId ?? options.rpId)),
      new Uint8Array([tweak.flags ?? UP_UV]),
      this.count(),
    )
    const signed = concat(authData, await sha256(clientData))
    const raw = new Uint8Array(
      await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, this.keys.privateKey, signed),
    )
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key' as const,
      response: {
        clientDataJSON: toBase64Url(clientData),
        authenticatorData: toBase64Url(authData),
        signature: toBase64Url(rawToDer(raw)),
        userHandle: tweak.userHandle === undefined ? this.userHandle : tweak.userHandle,
      },
    }
  }
}

// ------------------------------------------------------------ helpers

async function call(client: Client, path: string, init: RequestInit & { json?: unknown } = {}) {
  const response = await client.fetch(path, init)
  const body = (await response.json().catch(() => null)) as
    | ({ error?: { code: string } } & Record<string, unknown>)
    | null
  return { status: response.status, code: body?.error?.code, body }
}

const creationOptions = (client: Client) =>
  client.json<PasskeyCreationOptions>('/api/auth/passkeys/options', { method: 'POST' })

const requestOptions = (client: Client) =>
  client.json<PasskeyRequestOptions>('/api/auth/passkeys/login/options', { method: 'POST' })

/** A signed-up user with one passkey on `authenticator`. */
async function withPasskey(authenticator?: SoftAuthenticator, name?: string) {
  const user = await signUp()
  const key = authenticator ?? (await SoftAuthenticator.make())
  const credential = await key.register(await creationOptions(user.client))
  const added = await call(user.client, '/api/auth/passkeys', {
    method: 'POST',
    json: { credential, ...(name ? { name } : {}) },
  })
  expect(added.status).toBe(201)
  return { ...user, key, passkey: added.body as unknown as PasskeyResponse }
}

/** Signs in with `key` from a new browser. */
async function passkeyLogin(
  key: SoftAuthenticator,
  tweak?: Parameters<SoftAuthenticator['assert']>[1],
) {
  const client = new Client()
  const credential = await key.assert(await requestOptions(client), tweak)
  return {
    client,
    ...(await call(client, '/api/auth/passkeys/login', { method: 'POST', json: { credential } })),
  }
}

// ------------------------------------------------------------ tests

describe('lib/webauthn', () => {
  it('names the relying party on teyvat.me and localhost only', () => {
    expect(relyingParty('https://teyvat.me/api/x')).toMatchObject({
      id: 'teyvat.me',
      origin: 'https://teyvat.me',
    })
    expect(relyingParty('http://localhost:5173/api/x')).toMatchObject({
      id: 'localhost',
      origin: 'http://localhost:5173',
    })
    expect(relyingParty('https://genshin-tracker.475.dev/api/x')).toBeNull()
    expect(relyingParty('http://teyvat.me/api/x')).toBeNull()
  })

  it('refuses a challenge past its time, for another purpose or user, or changed', async () => {
    const now = Date.now()
    const secret = env.JWT_SECRET
    const challenge = await makeChallenge(secret, 'register', 7, 60_000, now)
    await expect(checkChallenge(secret, challenge, 'register', 7, now)).resolves.toBeGreaterThan(
      now,
    )
    await expect(checkChallenge(secret, challenge, 'register', 7, now + 61_000)).rejects.toThrow(
      'passkey expired',
    )
    await expect(checkChallenge(secret, challenge, 'register', 8, now)).rejects.toThrow(
      'passkey challenge',
    )
    await expect(checkChallenge(secret, challenge, 'login', null, now)).rejects.toThrow(
      'passkey challenge',
    )
    const flipped = challenge.slice(0, 3) + (challenge[3] === 'A' ? 'B' : 'A') + challenge.slice(4)
    await expect(checkChallenge(secret, flipped, 'register', 7, now)).rejects.toThrow(
      'passkey challenge',
    )
    const login = await makeChallenge(secret, 'login', null, LOGIN_TTL_MS, now)
    await expect(checkChallenge('x'.repeat(40), login, 'login', null, now)).rejects.toThrow()
  })

  it('reads CBOR maps and DER signatures with high-bit integers', () => {
    const map = decodeCbor(
      cbor(
        new Map<unknown, unknown>([
          [1, 'a'],
          ['k', new Uint8Array([9])],
        ]),
      ),
    )
    expect(map.value).toEqual(
      new Map<unknown, unknown>([
        [1, 'a'],
        ['k', new Uint8Array([9])],
      ]),
    )
    const raw = new Uint8Array(64).fill(0x80)
    raw[32] = 0
    raw[33] = 0x11
    expect(derToRaw(rawToDer(raw))).toEqual(raw)
    expect(() => decodeCbor(new Uint8Array([0x5f]))).toThrow('passkey malformed')
  })
})

describe('passkeys', () => {
  it('adds a passkey, lists it and signs in with it as a passkey session', async () => {
    const { client, username, key, passkey, me } = await withPasskey(undefined, 'Windows Hello')
    expect(passkey).toMatchObject({ name: 'Windows Hello', lastUsedAt: null })
    const listed = await client.json<PasskeyResponse[]>('/api/auth/passkeys')
    expect(listed).toEqual([passkey])

    const options = await creationOptions(client)
    expect(options.excludeCredentials.map((c) => c.id)).toEqual([key.id])
    expect(options.rp).toEqual({ id: 'teyvat.me', name: 'Teyvat.me' })
    expect(options.user.name).toBe(username)
    expect(options.user.id).not.toContain(String(me.id))

    const login = await passkeyLogin(key)
    expect(login.status).toBe(200)
    expect((login.body as unknown as MeResponse).username).toBe(username)
    const sessions = await login.client.json<SessionResponse[]>('/api/auth/sessions')
    expect(sessions.find((s) => s.current)?.method).toBe('passkey')
    const [used] = await login.client.json<PasskeyResponse[]>('/api/auth/passkeys')
    expect(used!.lastUsedAt).toBeTypeOf('number')
  })

  it('names a passkey "Passkey" when neither the user nor its AAGUID does', async () => {
    const { passkey } = await withPasskey()
    expect(passkey.name).toBe('Passkey')
  })

  it('answers each challenge once', async () => {
    const { key } = await withPasskey()
    const client = new Client()
    const credential = await key.assert(await requestOptions(client))
    const first = await call(client, '/api/auth/passkeys/login', {
      method: 'POST',
      json: { credential },
    })
    expect(first.status).toBe(200)
    const again = await call(new Client(), '/api/auth/passkeys/login', {
      method: 'POST',
      json: { credential },
    })
    expect(again).toMatchObject({ status: 401, code: 'passkey_challenge' })
  })

  it('refuses a sign count that did not climb', async () => {
    const counting = await SoftAuthenticator.make(true)
    await withPasskey(counting)
    expect((await passkeyLogin(counting)).status).toBe(200)
    counting.signCount -= 1 // a copy of the authenticator, one use behind
    expect(await passkeyLogin(counting)).toMatchObject({ status: 401, code: 'passkey_counter' })
    expect((await passkeyLogin(counting)).status).toBe(200)
  })

  it('refuses another origin, another RP ID, no user verification and a bad signature', async () => {
    const { key } = await withPasskey()
    expect(await passkeyLogin(key, { origin: 'https://evil.example' })).toMatchObject({
      status: 401,
      code: 'passkey_origin',
    })
    expect(await passkeyLogin(key, { rpId: 'evil.example' })).toMatchObject({
      status: 401,
      code: 'passkey_rp',
    })
    expect(await passkeyLogin(key, { flags: 0x01 })).toMatchObject({
      status: 401,
      code: 'passkey_user_verification',
    })
    const client = new Client()
    const credential = await key.assert(await requestOptions(client))
    const signature = credential.response.signature
    credential.response.signature =
      signature.slice(0, 10) + (signature[10] === 'A' ? 'B' : 'A') + signature.slice(11)
    expect(
      await call(client, '/api/auth/passkeys/login', { method: 'POST', json: { credential } }),
    ).toMatchObject({ status: 401, code: 'passkey_signature' })
  })

  it('refuses an unknown passkey and a user handle that is not its own', async () => {
    const stranger = await SoftAuthenticator.make()
    stranger.userHandle = 'AAAA'
    expect(await passkeyLogin(stranger)).toMatchObject({ status: 401, code: 'passkey_unknown' })
    const { key } = await withPasskey()
    expect(await passkeyLogin(key, { userHandle: 'BBBB' })).toMatchObject({
      status: 401,
      code: 'passkey_unknown',
    })
    // Some authenticators send no user handle: still fine.
    expect((await passkeyLogin(key, { userHandle: null })).status).toBe(200)
  })

  it("won't keep a passkey made for another user's challenge, or the same passkey twice", async () => {
    const alice = await signUp()
    const bob = await signUp()
    const key = await SoftAuthenticator.make()
    const credential = await key.register(await creationOptions(alice.client))
    expect(
      await call(bob.client, '/api/auth/passkeys', { method: 'POST', json: { credential } }),
    ).toMatchObject({ status: 400, code: 'passkey_challenge' })
    expect(
      await call(alice.client, '/api/auth/passkeys', { method: 'POST', json: { credential } }),
    ).toMatchObject({ status: 201 })
    const again = await key.register(await creationOptions(alice.client))
    expect(
      await call(alice.client, '/api/auth/passkeys', {
        method: 'POST',
        json: { credential: again },
      }),
    ).toMatchObject({ status: 409, code: 'passkey_exists' })
    expect(
      await call(new Client(), '/api/auth/passkeys/options', { method: 'POST' }),
    ).toMatchObject({ status: 401 })
  })

  it('renames and removes only your own passkeys', async () => {
    const owner = await withPasskey()
    const other = await signUp()
    const path = `/api/auth/passkeys/${owner.passkey.id}`
    expect(
      await call(other.client, path, { method: 'PATCH', json: { name: 'Mine now' } }),
    ).toMatchObject({ status: 404 })
    expect(await call(other.client, path, { method: 'DELETE' })).toMatchObject({ status: 404 })
    const renamed = await call(owner.client, path, { method: 'PATCH', json: { name: '  iPhone ' } })
    expect(renamed.body).toMatchObject({ name: 'iPhone' })
    expect(await call(owner.client, path, { method: 'DELETE' })).toMatchObject({ status: 204 })
    expect(await passkeyLogin(owner.key)).toMatchObject({ status: 401, code: 'passkey_unknown' })
  })

  it('never removes the last way in', async () => {
    const { client, me, passkey } = await withPasskey()
    await db.update(users).set({ passwordHash: '' }).where(eq(users.id, me.id))
    const path = `/api/auth/passkeys/${passkey.id}`
    expect(await call(client, path, { method: 'DELETE' })).toMatchObject({
      status: 409,
      code: 'last_sign_in',
    })

    // A Discord identity is another way in: now the passkey can go, then the identity can't.
    await db.insert(userIdentities).values({
      userId: me.id,
      provider: 'discord',
      providerUserId: `discord-${me.id}`,
    })
    expect(await call(client, path, { method: 'DELETE' })).toMatchObject({ status: 204 })
    expect(await call(client, '/api/auth/identities/discord', { method: 'DELETE' })).toMatchObject({
      status: 409,
      code: 'last_sign_in',
    })

    // With a passkey again, the identity can be unlinked.
    await withPasskeyFor(client)
    expect(await call(client, '/api/auth/identities/discord', { method: 'DELETE' })).toMatchObject({
      status: 204,
    })
  })

  it('refuses a suspended user', async () => {
    const { key, me } = await withPasskey()
    await db.update(users).set({ suspendedAt: Date.now() }).where(eq(users.id, me.id))
    expect(await passkeyLogin(key)).toMatchObject({ status: 403, code: 'account_suspended' })
  })

  it('says passkeys are on in the sign-in options, and maintenance drops answered challenges', async () => {
    const options = await new Client().json<{ passkeys: boolean }>('/api/auth/oauth/providers')
    expect(options.passkeys).toBe(true)
    await db.insert(passkeyChallenges).values({ challengeHash: 'old', expiresAt: Date.now() - 1 })
    await runMaintenance(env.DB)
    expect(
      await db.select().from(passkeyChallenges).where(eq(passkeyChallenges.challengeHash, 'old')),
    ).toEqual([])
  })
})

/** Adds one more passkey for the signed-in `client`. */
async function withPasskeyFor(client: Client): Promise<void> {
  const key = await SoftAuthenticator.make()
  const credential = await key.register(await creationOptions(client))
  expect(
    (await call(client, '/api/auth/passkeys', { method: 'POST', json: { credential } })).status,
  ).toBe(201)
}
