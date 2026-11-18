import { describe, expect, it } from 'vitest'
import { linkOrigin, OLD_SITE_ORIGIN, pageOrigin, SITE_ORIGIN } from '../lib/email'
import { configuredOrigin, ownOrigin } from '../lib/site'

const env = {} as Env

describe('linkOrigin', () => {
  it('keeps the site, its old address and loopback', () => {
    expect(SITE_ORIGIN).toBe('https://teyvat.me')
    expect(linkOrigin(env, 'https://teyvat.me/api/auth/x')).toBe('https://teyvat.me')
    expect(linkOrigin(env, `${OLD_SITE_ORIGIN}/api/auth/x`)).toBe(OLD_SITE_ORIGIN)
    expect(linkOrigin(env, 'http://localhost:5173/api/auth/x')).toBe('http://localhost:5173')
  })

  it('never follows a forged host', () => {
    expect(linkOrigin(env, 'https://evil.example/api/auth/x')).toBe(SITE_ORIGIN)
    expect(linkOrigin(env, 'https://teyvat.me.evil.example/api')).toBe(SITE_ORIGIN)
  })
})

describe('pageOrigin', () => {
  it('gives the site for the old address, the request origin otherwise', () => {
    expect(pageOrigin(env, `${OLD_SITE_ORIGIN}/api/irminsul/whoami`)).toBe(SITE_ORIGIN)
    expect(pageOrigin(env, 'https://teyvat.me/api/irminsul/whoami')).toBe(SITE_ORIGIN)
    expect(pageOrigin(env, 'http://localhost:5173/api/x')).toBe('http://localhost:5173')
  })
})

describe('a self-host (SITE_URL set to another site)', () => {
  const site = { SITE_URL: 'https://tracker.example/some/path' } as unknown as Env
  // wrangler's local mode hands the Worker a URL on the route's host (teyvat.me).
  const requests = [
    'http://teyvat.me/api/x',
    'https://teyvat.me/api/x',
    `${OLD_SITE_ORIGIN}/api/x`,
    'http://localhost:8787/api/x',
    'https://evil.example/api/x',
  ]

  it('gives SITE_URL for every link and page, whatever the request says', () => {
    for (const url of requests) {
      expect(linkOrigin(site, url)).toBe('https://tracker.example')
      expect(pageOrigin(site, url)).toBe('https://tracker.example')
      expect(ownOrigin(site, url)).toBe('https://tracker.example')
    }
  })

  it('keeps every rule of teyvat.me when SITE_URL is teyvat.me or unset', () => {
    const prod = { SITE_URL: 'https://teyvat.me' } as unknown as Env
    for (const vars of [env, prod]) {
      expect(configuredOrigin(vars)).toBeNull()
      expect(linkOrigin(vars, 'http://localhost:5173/api/x')).toBe('http://localhost:5173')
      expect(linkOrigin(vars, 'https://evil.example/api/x')).toBe(SITE_ORIGIN)
      expect(pageOrigin(vars, `${OLD_SITE_ORIGIN}/api/x`)).toBe(SITE_ORIGIN)
      expect(ownOrigin(vars, 'http://localhost:5173/api/x')).toBe('http://localhost:5173')
    }
  })

  it('ignores a SITE_URL that is not http(s)', () => {
    expect(configuredOrigin({ SITE_URL: 'ftp://tracker.example' })).toBeNull()
    expect(configuredOrigin({ SITE_URL: 'not a url' })).toBeNull()
  })
})
