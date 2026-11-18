import { toBase64Url } from '@gdt/shared'
import { describe, expect, it } from 'vitest'
import {
  contentKeys,
  encryptPayload,
  fromBase64Url,
  sendPush,
  vapidAuthorization,
  vapidKeys,
} from '../lib/web-push'

const KEYS = vapidKeys({
  VAPID_PUBLIC_KEY:
    'BPkVtt1GqmmrFtIV1eQhyn5k7HlnDScIkDMkPcTE6N4LJcfLyB2ziqduAlcrZjqGqyNz9wHEAUhB_EIvanrKhT0',
  VAPID_PRIVATE_KEY: 'X6BjtZOdxUO89h7YnqdkocKiyK81WrKLe2QkZzlx8LA',
})!

/** A browser: its ECDH key pair and auth secret, as `PushSubscription.toJSON()` gives them. */
async function browser() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair
  const raw = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer)
  const auth = crypto.getRandomValues(new Uint8Array(16))
  return { pair, raw, auth, p256dh: toBase64Url(raw), authText: toBase64Url(auth) }
}

/** What the browser does with a message (RFC 8291 §3.4 read the other way). */
async function decrypt(body: Uint8Array, ua: Awaited<ReturnType<typeof browser>>) {
  const salt = body.subarray(0, 16)
  const keyLength = body[20]!
  const asPublic = body.subarray(21, 21 + keyLength)
  const sealed = body.subarray(21 + keyLength)
  const serverKey = await crypto.subtle.importKey(
    'raw',
    asPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: serverKey } as SubtleCryptoDeriveKeyAlgorithm,
      ua.pair.privateKey,
      256,
    ),
  )
  const info = new Uint8Array([
    ...new TextEncoder().encode('WebPush: info\0'),
    ...ua.raw,
    ...asPublic,
  ])
  const { key, nonce } = await contentKeys(shared, ua.auth, info, salt)
  const plain = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce },
      await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['decrypt']),
      sealed,
    ),
  )
  expect(plain.at(-1)).toBe(2)
  return new TextDecoder().decode(plain.subarray(0, -1))
}

describe('Web Push', () => {
  it('needs both keys, well formed', () => {
    expect(vapidKeys({})).toBeNull()
    expect(vapidKeys({ VAPID_PUBLIC_KEY: KEYS.publicKey })).toBeNull()
    expect(vapidKeys({ VAPID_PUBLIC_KEY: 'short', VAPID_PRIVATE_KEY: KEYS.privateKey })).toBeNull()
    expect(
      vapidKeys({ VAPID_PUBLIC_KEY: KEYS.publicKey, VAPID_PRIVATE_KEY: KEYS.privateKey }),
    ).toEqual(KEYS)
  })

  it('encrypts a message only that browser reads (aes128gcm)', async () => {
    const ua = await browser()
    const body = await encryptPayload(new TextEncoder().encode('{"title":"Hi"}'), {
      p256dh: ua.p256dh,
      auth: ua.authText,
    })
    // salt 16, record size 4096, key length 65, the server's key.
    expect(new DataView(body.buffer, body.byteOffset).getUint32(16)).toBe(4096)
    expect(body[20]).toBe(65)
    expect(await decrypt(body, ua)).toBe('{"title":"Hi"}')
  })

  it('signs a VAPID token for the endpoint origin that the public key verifies', async () => {
    const now = 1_760_000_000_000
    const header = await vapidAuthorization('https://push.example.com/send/abc', KEYS, now)
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)!
    expect(match[4]).toBe(KEYS.publicKey)
    const claims = JSON.parse(new TextDecoder().decode(fromBase64Url(match[2]!)!))
    expect(claims).toEqual({
      aud: 'https://push.example.com',
      exp: now / 1000 + 12 * 3600,
      sub: 'https://teyvat.me',
    })
    const key = await crypto.subtle.importKey(
      'raw',
      fromBase64Url(KEYS.publicKey)!,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    )
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      fromBase64Url(match[3]!)!,
      new TextEncoder().encode(`${match[1]}.${match[2]}`),
    )
    expect(ok).toBe(true)
  })

  it("gives a self-host's https SITE_URL as the contact, else teyvat.me", async () => {
    const vars = { VAPID_PUBLIC_KEY: KEYS.publicKey, VAPID_PRIVATE_KEY: KEYS.privateKey }
    const subjectOf = async (SITE_URL: string) => {
      const keys = vapidKeys({ ...vars, SITE_URL })!
      const header = await vapidAuthorization('https://push.example.com/send/abc', keys)
      const claims = header.slice('vapid t='.length).split('.')[1]!
      return JSON.parse(new TextDecoder().decode(fromBase64Url(claims)!)).sub
    }
    expect(await subjectOf('https://tracker.example/')).toBe('https://tracker.example')
    expect(await subjectOf('http://localhost:8787')).toBe('https://teyvat.me')
    expect(await subjectOf('https://teyvat.me')).toBe('https://teyvat.me')
  })

  it('posts to the endpoint and reads gone / failed answers', async () => {
    const ua = await browser()
    const target = {
      endpoint: 'https://push.example.com/send/abc',
      p256dh: ua.p256dh,
      auth: ua.authText,
    }
    let seen: Request | undefined
    const answer = (status: number) =>
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        seen = new Request(input, init)
        return new Response(null, { status })
      }) as typeof fetch
    expect(
      await sendPush(target, '{"a":1}', KEYS, { fetcher: answer(201), topic: 'resin:1' }),
    ).toBe('ok')
    expect(seen!.headers.get('content-encoding')).toBe('aes128gcm')
    expect(seen!.headers.get('topic')).toBe('resin1')
    expect(seen!.headers.get('authorization')).toMatch(/^vapid t=/)
    expect(await decrypt(new Uint8Array(await seen!.arrayBuffer()), ua)).toBe('{"a":1}')
    expect(await sendPush(target, '{}', KEYS, { fetcher: answer(410) })).toBe('gone')
    expect(await sendPush(target, '{}', KEYS, { fetcher: answer(404) })).toBe('gone')
    expect(await sendPush(target, '{}', KEYS, { fetcher: answer(500) })).toBe('failed')
    expect(await sendPush({ ...target, p256dh: 'bad' }, '{}', KEYS, { fetcher: answer(201) })).toBe(
      'failed',
    )
  })
})
