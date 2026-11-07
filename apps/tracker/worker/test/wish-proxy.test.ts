import { WISH_API_HOSTS } from '@gdt/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SELF } from 'cloudflare:test'
import { Client, ORIGIN, signUp } from './client'

const KEY = 'Synthetic0Key+only/for/tests=='
const LINK = `https://webstatic-sea.hoyoverse.com/genshin/event/e20190909gacha-v3/index.html?authkey_ver=1&sign_type=2&auth_appid=webview_gacha&region=os_asia&authkey=${encodeURIComponent(KEY)}&game_biz=hk4e_global#/log`

/** The wish history API, faked: records every URL asked for. */
let asked: URL[] = []
let answer: () => Response
beforeEach(() => {
  asked = []
  answer = () =>
    Response.json({
      retcode: 0,
      message: 'OK',
      data: { page: '1', size: '20', region: 'os_asia', list: [{ id: '1790000000000000001' }] },
    })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    asked.push(new URL(input instanceof Request ? input.url : String(input)))
    return answer()
  })
})
afterEach(() => vi.restoreAllMocks())

function fetchPage(client: Client, body: Record<string, unknown>) {
  return client.fetch('/api/wishes/fetch-page', {
    method: 'POST',
    json: { url: LINK, gachaType: 301, page: 1, endId: '0', ...body },
  })
}

describe('wish link proxy', () => {
  it('asks the wish history API, rebuilt from the link, and answers as it does', async () => {
    const { client } = await signUp()
    const response = await fetchPage(client, {
      gachaType: 302,
      page: 2,
      endId: '1790000000000000009',
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      retcode: 0,
      data: { list: [{ id: '1790000000000000001' }] },
    })
    expect(asked.length).toBe(1)
    const url = asked[0]!
    expect(url.origin).toBe(`https://${WISH_API_HOSTS.global}`)
    expect(url.pathname).toBe('/gacha_info/api/getGachaLog')
    expect(url.searchParams.get('authkey')).toBe(KEY)
    expect(url.searchParams.get('gacha_type')).toBe('302')
    expect(url.searchParams.get('end_id')).toBe('1790000000000000009')
    expect(url.searchParams.get('lang')).toBe('en-us')

    // An API error (an expired key) comes back as it is.
    answer = () => Response.json({ retcode: -101, message: 'authkey timeout', data: null })
    expect(await (await fetchPage(client, {})).json()).toEqual({
      retcode: -101,
      message: 'authkey timeout',
      data: null,
    })
  })

  it('never fetches anywhere else', async () => {
    const { client } = await signUp()
    const elsewhere = `https://evil.example/collect?authkey=${encodeURIComponent(KEY)}&next=http://169.254.169.254/`
    expect((await fetchPage(client, { url: elsewhere })).status).toBe(200)
    expect(asked.map((u) => u.host)).toEqual([WISH_API_HOSTS.global])
    expect(asked[0]!.searchParams.has('next')).toBe(false)
    const cn = `https://webstatic.mihoyo.com/x?authkey=${encodeURIComponent(KEY)}&game_biz=hk4e_cn`
    await fetchPage(client, { url: cn })
    expect(asked[1]!.host).toBe(WISH_API_HOSTS.cn)

    // No authkey: nothing is fetched.
    const none = await fetchPage(client, { url: 'http://169.254.169.254/latest/meta-data' })
    expect(none.status).toBe(400)
    expect(((await none.json()) as { error: { code: string } }).error.code).toBe('invalid_link')
    expect((await fetchPage(client, { gachaType: 999 })).status).toBe(400)
    expect((await fetchPage(client, { endId: '12; DROP' })).status).toBe(400)
    expect(asked.length).toBe(2)
  })

  it('needs a signed-in user, or a page of this site (guest mode), and the CSRF header', async () => {
    const body = JSON.stringify({ url: LINK, gachaType: 301, page: 1, endId: '0' })
    const signedOut = (headers: Record<string, string>) =>
      SELF.fetch(`${ORIGIN}/api/wishes/fetch-page`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'cf-connecting-ip': '203.0.113.9',
          ...headers,
        },
        body,
      })
    // Signed out from this site's own page (the browser sends its Origin): guest mode.
    const own = await signedOut({
      'x-gdt-csrf': '1',
      origin: ORIGIN,
      'sec-fetch-site': 'same-origin',
    })
    expect(own.status).toBe(200)
    expect(asked.length).toBe(1)
    // Not a proxy for anyone else: no Origin (a script), another site's, a cross-site
    // fetch, or no CSRF header (a form) are refused before anything is fetched.
    for (const headers of <Record<string, string>[]>[
      { 'x-gdt-csrf': '1' },
      { 'x-gdt-csrf': '1', origin: 'https://evil.example' },
      { 'x-gdt-csrf': '1', origin: ORIGIN, 'sec-fetch-site': 'cross-site' },
      { origin: ORIGIN },
    ]) {
      expect((await signedOut(headers)).status).toBe(403)
    }
    expect(asked.length).toBe(1)
    // Its answer carries no CORS header for other sites.
    expect(own.headers.get('access-control-allow-origin')).toBeNull()

    const { client } = await signUp()
    // The browser's cookie without the CSRF header (a cross-site form).
    const noCsrf = await SELF.fetch(`${ORIGIN}/api/wishes/fetch-page`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `gdt_at=${client.cookie('gdt_at')}` },
      body,
    })
    expect(noCsrf.status).toBe(403)
    expect(asked.length).toBe(1)
  })

  it('limits signed-out pages per IP', async () => {
    let status = 200
    let n = 0
    for (let attempt = 0; attempt < 2; attempt++) {
      const ip = `198.51.100.${10 + attempt}`
      const minute = Math.floor(Date.now() / 60_000)
      status = 200
      n = 0
      while (status === 200 && n < 200) {
        status = (
          await SELF.fetch(`${ORIGIN}/api/wishes/fetch-page`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-gdt-csrf': '1',
              origin: ORIGIN,
              'cf-connecting-ip': ip,
            },
            body: JSON.stringify({ url: LINK, gachaType: 301, page: 1, endId: '0' }),
          })
        ).status
        n++
      }
      if (Math.floor(Date.now() / 60_000) === minute) break
    }
    expect(status).toBe(429)
    expect(n).toBe(121)
  })

  it('logs no authkey when the API fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client } = await signUp()
    answer = () => {
      throw new TypeError(`fetch failed for ${asked.at(-1)!.href}`)
    }
    const failed = await fetchPage(client, {})
    expect(failed.status).toBe(502)
    const text = await failed.text()
    answer = () => new Response('nope', { status: 503 })
    expect((await fetchPage(client, {})).status).toBe(502)
    answer = () => new Response('<html>', { status: 200 })
    expect((await fetchPage(client, {})).status).toBe(502)
    const logged = JSON.stringify([...warn.mock.calls, ...error.mock.calls])
    for (const secret of [KEY, encodeURIComponent(KEY)]) {
      expect(logged).not.toContain(secret)
      expect(text).not.toContain(secret)
    }
  })

  it('limits pages per user', async () => {
    // The limiter counts in fixed one-minute windows: a run that crosses a
    // minute boundary starts counting again, so it is run again with a new
    // user (a run takes seconds, so the second never crosses one too).
    let status = 200
    let n = 0
    for (let attempt = 0; attempt < 2; attempt++) {
      const { client } = await signUp()
      const minute = Math.floor(Date.now() / 60_000)
      status = 200
      n = 0
      while (status === 200 && n < 200) {
        status = (await fetchPage(client, {})).status
        n++
      }
      if (Math.floor(Date.now() / 60_000) === minute) break
    }
    expect(status).toBe(429)
    expect(n).toBe(121)
    // Another user is not affected.
    expect((await fetchPage((await signUp()).client, {})).status).toBe(200)
  }, 60_000)
})
