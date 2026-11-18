/**
 * Web Push by hand on WebCrypto (docs/plans/capture-link.md): the message is
 * encrypted for the browser as `aes128gcm` (RFC 8291 over RFC 8188) and the
 * request signed with the server's VAPID key (RFC 8292), so any browser's
 * push service takes it with no library and no account anywhere.
 *
 * Keys: Worker secrets `VAPID_PUBLIC_KEY` (base64url of the 65-byte
 * uncompressed P-256 point) and `VAPID_PRIVATE_KEY` (base64url of the 32-byte
 * scalar). Alerts are off until both exist (secrets, so not in `Env`).
 */

import { fromBase64, toBase64Url } from '@gdt/shared'
import { configuredOrigin, SITE_ORIGIN } from './site'

export interface VapidVars {
  VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_KEY?: string
  /** A self-host's origin (lib/site.ts): its contact address for the push services. */
  SITE_URL?: string
}

export interface VapidKeys {
  publicKey: string
  privateKey: string
  /** Who the push services can reach about this sender (RFC 8292 `sub`); teyvat.me if unset. */
  subject?: string
}

/** teyvat.me's contact for the push services. */
const SUBJECT = SITE_ORIGIN

/** The server's keys, or null while alerts are off. */
export function vapidKeys(vars: VapidVars): VapidKeys | null {
  const publicKey = vars.VAPID_PUBLIC_KEY?.trim()
  const privateKey = vars.VAPID_PRIVATE_KEY?.trim()
  if (!publicKey || !privateKey) return null
  if (fromBase64Url(publicKey)?.length !== 65 || fromBase64Url(privateKey)?.length !== 32) {
    return null
  }
  // Push services take an https (or mailto) contact only: a self-host on
  // http://localhost keeps teyvat.me's.
  const subject = configuredOrigin(vars)
  return subject?.startsWith('https:')
    ? { publicKey, privateKey, subject }
    : { publicKey, privateKey }
}

/** A browser's subscription as stored. */
export interface PushTarget {
  endpoint: string
  p256dh: string
  auth: string
}

/** How a send went: `gone` = the subscription is dead (delete it). */
export type PushResult = 'ok' | 'gone' | 'failed'

/**
 * Sends `payload` (JSON text) to one subscription. Never throws: a network
 * error or a refusal is `failed`, a 404/410 `gone`.
 */
export async function sendPush(
  target: PushTarget,
  payload: string,
  keys: VapidKeys,
  options: { ttl?: number; topic?: string; fetcher?: typeof fetch } = {},
): Promise<PushResult> {
  try {
    const body = await encryptPayload(new TextEncoder().encode(payload), target)
    const headers: Record<string, string> = {
      Authorization: await vapidAuthorization(target.endpoint, keys),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(options.ttl ?? 6 * 3600),
      Urgency: 'high',
    }
    // A newer message with the same topic replaces one still waiting.
    if (options.topic) headers.Topic = options.topic.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32)
    const response = await (options.fetcher ?? fetch)(target.endpoint, {
      method: 'POST',
      headers,
      body,
    })
    if (response.status === 404 || response.status === 410) return 'gone'
    return response.ok ? 'ok' : 'failed'
  } catch {
    return 'failed'
  }
}

// ------------------------------------------------------------------ VAPID

/** `Authorization: vapid t=<JWT>, k=<public key>` for the endpoint's origin, valid 12 hours. */
export async function vapidAuthorization(
  endpoint: string,
  keys: VapidKeys,
  now = Date.now(),
): Promise<string> {
  const header = encodeJson({ typ: 'JWT', alg: 'ES256' })
  const claims = encodeJson({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 3600,
    sub: keys.subject ?? SUBJECT,
  })
  const unsigned = `${header}.${claims}`
  const key = await signingKey(keys)
  // WebCrypto's ECDSA signature is r || s, what ES256 wants.
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(unsigned),
  )
  return `vapid t=${unsigned}.${toBase64Url(new Uint8Array(signature))}, k=${keys.publicKey}`
}

function signingKey(keys: VapidKeys): Promise<CryptoKey> {
  const point = fromBase64Url(keys.publicKey)!
  return crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: toBase64Url(point.subarray(1, 33)),
      y: toBase64Url(point.subarray(33, 65)),
      d: keys.privateKey,
      ext: true,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
}

// ------------------------------------------------------------------ aes128gcm

/** Records are one: the payload is far below a record's 4096 bytes. */
const RECORD_SIZE = 4096

/**
 * The payload encrypted for the subscription (RFC 8291): an ephemeral ECDH
 * key with the browser's, its auth secret as the HKDF salt, one record ending
 * in the last-record delimiter 0x02, no padding.
 */
export async function encryptPayload(
  payload: Uint8Array,
  target: Pick<PushTarget, 'p256dh' | 'auth'>,
  random: { salt?: Uint8Array; keyPair?: CryptoKeyPair } = {},
): Promise<Uint8Array> {
  const uaPublic = fromBase64Url(target.p256dh)
  const authSecret = fromBase64Url(target.auth)
  if (uaPublic?.length !== 65 || !authSecret || authSecret.length < 16) {
    throw new Error('Bad subscription keys')
  }
  const ephemeral =
    random.keyPair ??
    ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ])) as CryptoKeyPair)
  const asPublic = new Uint8Array(
    (await crypto.subtle.exportKey('raw', ephemeral.publicKey)) as ArrayBuffer,
  )
  const uaKey = await crypto.subtle.importKey(
    'raw',
    uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: uaKey } as SubtleCryptoDeriveKeyAlgorithm,
      ephemeral.privateKey,
      256,
    ),
  )
  const salt = random.salt ?? crypto.getRandomValues(new Uint8Array(16))
  const { key, nonce } = await contentKeys(
    shared,
    authSecret,
    concat(utf8('WebPush: info\0'), uaPublic, asPublic),
    salt,
  )
  const plain = concat(payload, Uint8Array.of(2))
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']),
      plain,
    ),
  )
  const size = new Uint8Array(4)
  new DataView(size.buffer).setUint32(0, RECORD_SIZE)
  return concat(salt, size, Uint8Array.of(asPublic.length), asPublic, sealed)
}

/** The content encryption key and nonce from the ECDH secret (RFC 8291 §3.4, RFC 8188 §2.2). */
export async function contentKeys(
  shared: Uint8Array,
  authSecret: Uint8Array,
  keyInfo: Uint8Array,
  salt: Uint8Array,
): Promise<{ key: Uint8Array; nonce: Uint8Array }> {
  const ikm = await hkdf(authSecret, shared, keyInfo, 32)
  return {
    key: await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16),
    nonce: await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12),
  }
}

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8),
  )
}

// ------------------------------------------------------------------ bytes

export function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(text)) return null
  const plain = text.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/')
  return fromBase64(plain + '='.repeat((4 - (plain.length % 4)) % 4))
}

const utf8 = (text: string) => new TextEncoder().encode(text)

const encodeJson = (value: unknown) => toBase64Url(utf8(JSON.stringify(value)))

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}
