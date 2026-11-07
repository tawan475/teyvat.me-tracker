/**
 * WebAuthn (passkeys) by hand, on WebCrypto: the two ceremonies' checks,
 * a small CBOR reader for the authenticator's data and COSE keys, and
 * stateless challenges.
 *
 * - Registration (`verifyRegistration`) keeps the credential's public key
 *   and nothing of the attestation statement (we ask for `none`): the key,
 *   not the authenticator's maker, is what signs the user in.
 * - Sign-in (`verifyAssertion`) checks the challenge, origin, RP ID hash,
 *   user presence and verification, the signature over
 *   `authenticatorData || SHA-256(clientDataJSON)`, and that the sign
 *   count climbed (authenticators that keep none send 0 every time).
 * - A challenge is 16 random bytes, its expiry and an HMAC over both and
 *   what it is for (registration for one user, or sign-in), so options cost
 *   no storage and work in any number of tabs. Single use is the caller's:
 *   it records the challenge's hash once it is answered (passkey_challenges).
 *
 * The relying party is teyvat.me in production and localhost under
 * `vite dev`; any other host (the old genshin-tracker.475.dev included) has
 * no passkeys: a passkey is bound to one RP ID for good.
 */

import { fromBase64Url, toBase64Url } from '@gdt/shared'

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })

/** COSE algorithms we accept, in order of preference: ES256, EdDSA, RS256. */
export const COSE_ALGORITHMS = [-7, -8, -257] as const

export interface RelyingParty {
  id: string
  /** The one origin client data may name. */
  origin: string
  name: string
}

const RP_NAME = 'Teyvat.me'

/** The relying party for a request to `requestUrl`, or null where passkeys are off. */
export function relyingParty(requestUrl: string): RelyingParty | null {
  const url = new URL(requestUrl)
  if (url.hostname === 'teyvat.me' && url.protocol === 'https:') {
    return { id: 'teyvat.me', origin: 'https://teyvat.me', name: RP_NAME }
  }
  // `vite dev` (and wrangler dev): browsers allow WebAuthn on http://localhost.
  if (url.hostname === 'localhost') return { id: 'localhost', origin: url.origin, name: RP_NAME }
  return null
}

/** Why a ceremony was refused (the routes turn it into `passkey_<reason>`). */
export type PasskeyFailure =
  | 'malformed'
  | 'challenge'
  | 'expired'
  | 'origin'
  | 'rp'
  | 'user_verification'
  | 'algorithm'
  | 'signature'
  | 'counter'

export class PasskeyError extends Error {
  constructor(readonly reason: PasskeyFailure) {
    super(`passkey ${reason}`)
  }
}

const fail = (reason: PasskeyFailure): never => {
  throw new PasskeyError(reason)
}

// ---------------------------------------------------------------- CBOR

const MAX_DEPTH = 16
const MAX_ITEMS = 1024

/** One CBOR item at `pos`: its value and where it ends. Definite lengths only. */
function readItem(bytes: Uint8Array, pos: number, depth: number): [unknown, number] {
  if (depth > MAX_DEPTH || pos >= bytes.length) fail('malformed')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const initial = bytes[pos]!
  const major = initial >> 5
  const info = initial & 31
  pos += 1
  let arg: number
  if (info < 24) arg = info
  else if (info === 24) {
    if (pos + 1 > bytes.length) fail('malformed')
    arg = bytes[pos]!
    pos += 1
  } else if (info === 25) {
    if (pos + 2 > bytes.length) fail('malformed')
    arg = view.getUint16(pos)
    pos += 2
  } else if (info === 26) {
    if (pos + 4 > bytes.length) fail('malformed')
    arg = view.getUint32(pos)
    pos += 4
  } else if (info === 27) {
    if (pos + 8 > bytes.length) fail('malformed')
    const high = view.getUint32(pos)
    if (high > 0x1fffff) fail('malformed')
    arg = high * 2 ** 32 + view.getUint32(pos + 4)
    pos += 8
  } else return fail('malformed')

  switch (major) {
    case 0:
      return [arg, pos]
    case 1:
      return [-1 - arg, pos]
    case 2:
    case 3: {
      if (pos + arg > bytes.length) fail('malformed')
      const slice = bytes.slice(pos, pos + arg)
      if (major === 2) return [slice, pos + arg]
      try {
        return [decoder.decode(slice), pos + arg]
      } catch {
        return fail('malformed')
      }
    }
    case 4: {
      if (arg > MAX_ITEMS) fail('malformed')
      const items: unknown[] = []
      for (let i = 0; i < arg; i++) {
        const [item, next] = readItem(bytes, pos, depth + 1)
        items.push(item)
        pos = next
      }
      return [items, pos]
    }
    case 5: {
      if (arg > MAX_ITEMS) fail('malformed')
      const map = new Map<unknown, unknown>()
      for (let i = 0; i < arg; i++) {
        const [key, afterKey] = readItem(bytes, pos, depth + 1)
        const [value, next] = readItem(bytes, afterKey, depth + 1)
        map.set(key, value)
        pos = next
      }
      return [map, pos]
    }
    case 7:
      if (info === 20) return [false, pos]
      if (info === 21) return [true, pos]
      if (info === 22 || info === 23) return [null, pos]
      return fail('malformed')
    default:
      // Tags (6) never appear in what we read.
      return fail('malformed')
  }
}

/** Decodes one CBOR item from the start of `bytes`; `end` is where it stopped. */
export function decodeCbor(bytes: Uint8Array, start = 0): { value: unknown; end: number } {
  const [value, end] = readItem(bytes, start, 0)
  return { value, end }
}

// ---------------------------------------------------------------- authenticator data

const FLAG_UP = 0x01
const FLAG_UV = 0x04
const FLAG_AT = 0x40

export interface AuthenticatorData {
  rpIdHash: Uint8Array
  flags: number
  signCount: number
  /** With the AT flag (registration): the new credential. */
  credential?: { aaguid: Uint8Array; id: Uint8Array; publicKey: Uint8Array }
}

export function parseAuthenticatorData(bytes: Uint8Array): AuthenticatorData {
  if (bytes.length < 37) fail('malformed')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const flags = bytes[32]!
  const data: AuthenticatorData = {
    rpIdHash: bytes.slice(0, 32),
    flags,
    signCount: view.getUint32(33),
  }
  if (flags & FLAG_AT) {
    if (bytes.length < 55) fail('malformed')
    const idLength = view.getUint16(53)
    const keyStart = 55 + idLength
    if (idLength === 0 || idLength > 1023 || keyStart >= bytes.length) fail('malformed')
    const { end } = decodeCbor(bytes, keyStart)
    data.credential = {
      aaguid: bytes.slice(37, 53),
      id: bytes.slice(55, keyStart),
      publicKey: bytes.slice(keyStart, end),
    }
  }
  return data
}

// ---------------------------------------------------------------- COSE keys

interface ImportedKey {
  algorithm: number
  key: CryptoKey
}

const bytesField = (map: Map<unknown, unknown>, label: number, length?: number): Uint8Array => {
  const value = map.get(label)
  if (!(value instanceof Uint8Array) || (length !== undefined && value.length !== length)) {
    return fail('algorithm')
  }
  return value
}

/** A COSE public key as a WebCrypto verify key (ES256, EdDSA or RS256 only). */
export async function importCoseKey(cose: Uint8Array): Promise<ImportedKey> {
  const { value } = decodeCbor(cose)
  if (!(value instanceof Map)) return fail('algorithm')
  const kty = value.get(1)
  const algorithm = value.get(3)
  try {
    if (algorithm === -7 && kty === 2 && value.get(-1) === 1) {
      const jwk = {
        kty: 'EC',
        crv: 'P-256',
        x: toBase64Url(bytesField(value, -2, 32)),
        y: toBase64Url(bytesField(value, -3, 32)),
      }
      const key = await crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['verify'],
      )
      return { algorithm, key }
    }
    if (algorithm === -8 && kty === 1 && value.get(-1) === 6) {
      const jwk = { kty: 'OKP', crv: 'Ed25519', x: toBase64Url(bytesField(value, -2, 32)) }
      const key = await crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['verify'])
      return { algorithm, key }
    }
    if (algorithm === -257 && kty === 3) {
      const n = bytesField(value, -1)
      if (n.length < 256) fail('algorithm') // 2048-bit keys at least
      const jwk = {
        kty: 'RSA',
        alg: 'RS256',
        n: toBase64Url(n),
        e: toBase64Url(bytesField(value, -2)),
      }
      const key = await crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      )
      return { algorithm, key }
    }
  } catch (error) {
    if (error instanceof PasskeyError) throw error
    return fail('algorithm')
  }
  return fail('algorithm')
}

/** An ECDSA signature's DER (SEQUENCE of two INTEGERs) as WebCrypto's r || s. */
export function derToRaw(der: Uint8Array, size = 32): Uint8Array | null {
  if (der.length < 8 || der[0] !== 0x30) return null
  let pos = 2
  if (der[1]! & 0x80) pos = 2 + (der[1]! & 0x7f)
  const raw = new Uint8Array(size * 2)
  for (let part = 0; part < 2; part++) {
    if (der[pos] !== 0x02) return null
    const length = der[pos + 1]!
    let int = der.subarray(pos + 2, pos + 2 + length)
    if (int.length !== length) return null
    pos += 2 + length
    while (int.length > size && int[0] === 0) int = int.subarray(1)
    if (int.length > size) return null
    raw.set(int, size * (part + 1) - int.length)
  }
  return raw
}

async function verifySignature(
  imported: ImportedKey,
  signature: Uint8Array,
  data: Uint8Array,
): Promise<boolean> {
  try {
    if (imported.algorithm === -7) {
      const raw = derToRaw(signature)
      if (!raw) return false
      return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, imported.key, raw, data)
    }
    if (imported.algorithm === -8) {
      return await crypto.subtle.verify({ name: 'Ed25519' }, imported.key, signature, data)
    }
    return await crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, imported.key, signature, data)
  } catch {
    return false
  }
}

// ---------------------------------------------------------------- challenges

export type ChallengePurpose = 'register' | 'login'

const RANDOM_BYTES = 16
const MAC_BYTES = 16
/** Registering is one dialog away. */
export const REGISTER_TTL_MS = 5 * 60 * 1000
/** The login page's autofill waits for as long as the page is open; it asks again past this. */
export const LOGIN_TTL_MS = 10 * 60 * 1000

async function challengeKey(secret: string): Promise<CryptoKey> {
  if (!secret || secret.length < 32) throw new Error('Server is missing JWT_SECRET')
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(`passkey-challenge:${secret}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
}

async function challengeMac(
  key: CryptoKey,
  purpose: ChallengePurpose,
  userId: number | null,
  body: Uint8Array,
): Promise<Uint8Array> {
  const label = encoder.encode(`${purpose}:${userId ?? 0}:`)
  const input = new Uint8Array(label.length + body.length)
  input.set(label)
  input.set(body, label.length)
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, input)).slice(0, MAC_BYTES)
}

/** A fresh challenge (base64url) for `purpose`, good for `ttlMs`. */
export async function makeChallenge(
  secret: string,
  purpose: ChallengePurpose,
  userId: number | null,
  ttlMs: number,
  now = Date.now(),
): Promise<string> {
  const body = new Uint8Array(RANDOM_BYTES + 4)
  crypto.getRandomValues(body.subarray(0, RANDOM_BYTES))
  new DataView(body.buffer).setUint32(RANDOM_BYTES, Math.ceil((now + ttlMs) / 1000))
  const mac = await challengeMac(await challengeKey(secret), purpose, userId, body)
  const challenge = new Uint8Array(body.length + MAC_BYTES)
  challenge.set(body)
  challenge.set(mac, body.length)
  return toBase64Url(challenge)
}

/** Checks a challenge we made; answers when it expires (ms). Single use is the caller's. */
export async function checkChallenge(
  secret: string,
  challenge: string,
  purpose: ChallengePurpose,
  userId: number | null,
  now = Date.now(),
): Promise<number> {
  const bytes = fromBase64Url(challenge)
  if (!bytes || bytes.length !== RANDOM_BYTES + 4 + MAC_BYTES) return fail('challenge')
  const body = bytes.subarray(0, RANDOM_BYTES + 4)
  const mac = await challengeMac(await challengeKey(secret), purpose, userId, body)
  if (!crypto.subtle.timingSafeEqual(mac, bytes.subarray(RANDOM_BYTES + 4))) fail('challenge')
  const expiresAt = new DataView(body.buffer, body.byteOffset).getUint32(RANDOM_BYTES) * 1000
  if (expiresAt <= now) fail('expired')
  return expiresAt
}

// ---------------------------------------------------------------- ceremonies

interface ClientData {
  type: string
  challenge: string
  origin: string
}

const sha256 = async (bytes: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && crypto.subtle.timingSafeEqual(a, b)

function decodeField(text: string): Uint8Array {
  return fromBase64Url(text) ?? fail('malformed')
}

function readClientData(bytes: Uint8Array, type: string, rp: RelyingParty): ClientData {
  let data: unknown
  try {
    data = JSON.parse(decoder.decode(bytes))
  } catch {
    return fail('malformed')
  }
  const clientData = data as Partial<ClientData> & { crossOrigin?: unknown }
  if (clientData.type !== type || typeof clientData.challenge !== 'string') fail('malformed')
  // An iframe on another site can't sign in here.
  if (clientData.origin !== rp.origin || clientData.crossOrigin === true) fail('origin')
  return clientData as ClientData
}

async function checkRpAndUser(auth: AuthenticatorData, rp: RelyingParty): Promise<void> {
  if (!sameBytes(auth.rpIdHash, await sha256(encoder.encode(rp.id)))) fail('rp')
  if (!(auth.flags & FLAG_UP) || !(auth.flags & FLAG_UV)) fail('user_verification')
}

function uuid(bytes: Uint8Array): string | null {
  if (bytes.every((byte) => byte === 0)) return null
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export interface VerifiedRegistration {
  credentialId: string
  /** The COSE key, base64url. */
  publicKey: string
  algorithm: number
  signCount: number
  aaguid: string | null
  /** The challenge it answered, and when that expires (for the single-use record). */
  challenge: string
  challengeExpiresAt: number
}

export async function verifyRegistration(
  response: { rawId: string; clientDataJSON: string; attestationObject: string },
  expected: { rp: RelyingParty; secret: string; userId: number; now?: number },
): Promise<VerifiedRegistration> {
  const clientData = readClientData(
    decodeField(response.clientDataJSON),
    'webauthn.create',
    expected.rp,
  )
  const challengeExpiresAt = await checkChallenge(
    expected.secret,
    clientData.challenge,
    'register',
    expected.userId,
    expected.now,
  )
  const { value: attestation } = decodeCbor(decodeField(response.attestationObject))
  const authData = attestation instanceof Map ? attestation.get('authData') : undefined
  if (!(authData instanceof Uint8Array)) return fail('malformed')
  const auth = parseAuthenticatorData(authData)
  await checkRpAndUser(auth, expected.rp)
  const credential = auth.credential ?? fail('malformed')
  if (!sameBytes(credential.id, decodeField(response.rawId))) fail('malformed')
  const { algorithm } = await importCoseKey(credential.publicKey)
  return {
    credentialId: toBase64Url(credential.id),
    publicKey: toBase64Url(credential.publicKey),
    algorithm,
    signCount: auth.signCount,
    aaguid: uuid(credential.aaguid),
    challenge: clientData.challenge,
    challengeExpiresAt,
  }
}

export interface VerifiedAssertion {
  signCount: number
  challenge: string
  challengeExpiresAt: number
}

export async function verifyAssertion(
  response: { clientDataJSON: string; authenticatorData: string; signature: string },
  stored: { publicKey: string; signCount: number },
  expected: { rp: RelyingParty; secret: string; now?: number },
): Promise<VerifiedAssertion> {
  const clientDataBytes = decodeField(response.clientDataJSON)
  const clientData = readClientData(clientDataBytes, 'webauthn.get', expected.rp)
  const challengeExpiresAt = await checkChallenge(
    expected.secret,
    clientData.challenge,
    'login',
    null,
    expected.now,
  )
  const authBytes = decodeField(response.authenticatorData)
  const auth = parseAuthenticatorData(authBytes)
  await checkRpAndUser(auth, expected.rp)
  const signed = new Uint8Array(authBytes.length + 32)
  signed.set(authBytes)
  signed.set(await sha256(clientDataBytes), authBytes.length)
  const key = await importCoseKey(decodeField(stored.publicKey))
  if (!(await verifySignature(key, decodeField(response.signature), signed))) fail('signature')
  // A count that did not climb: a copy of the authenticator, or a replay.
  if ((auth.signCount !== 0 || stored.signCount !== 0) && auth.signCount <= stored.signCount) {
    fail('counter')
  }
  return { signCount: auth.signCount, challenge: clientData.challenge, challengeExpiresAt }
}

// ---------------------------------------------------------------- names

/**
 * Names for the passkey providers people use most, by the AAGUID their
 * passkeys carry (the passkey-authenticator-aaguids list), for a passkey's
 * first name. The user can rename it.
 */
const AAGUID_NAMES: Record<string, string> = {
  'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4': 'Google Password Manager',
  'adce0002-35bc-c60a-648b-0b25f1f05503': 'Chrome on Mac',
  'fbfc3007-154e-4ecc-8c0b-6e020557d7bd': 'iCloud Keychain',
  'dd4ec289-e01d-41c9-bb89-70fa845d4bf2': 'iCloud Keychain',
  '08987058-cadc-4b81-b6e1-30de50dcbe96': 'Windows Hello',
  '9ddd1817-af5a-4672-a2b9-3e3dd95000a9': 'Windows Hello',
  '6028b017-b1d4-4c02-b4b3-afcdafc96bb2': 'Windows Hello',
  'bada5566-a7aa-401f-bd96-45619a55120d': '1Password',
  'd548826e-79b4-db40-a3d8-11116f7e8349': 'Bitwarden',
  '53414d53-554e-4700-0000-000000000000': 'Samsung Pass',
}

export const aaguidName = (aaguid: string | null): string | null =>
  aaguid ? (AAGUID_NAMES[aaguid] ?? null) : null

/** What the authenticator stores as the user's id: an HMAC of ours, no personal data. */
export async function userHandle(secret: string, userId: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(`passkey-user:${secret}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(String(userId)))
  return toBase64Url(new Uint8Array(mac).slice(0, 16))
}
