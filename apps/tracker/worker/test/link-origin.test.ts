import { describe, expect, it } from 'vitest'
import {
  BRAND,
  linkOrigin,
  OLD_SITE_ORIGIN,
  pageOrigin,
  passwordChangedMail,
  SITE_ORIGIN,
  verifyEmailMail,
} from '../lib/email'
import { configuredOrigin, ownOrigin, siteName } from '../lib/site'
import { relyingParty } from '../lib/webauthn'

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

describe('siteName', () => {
  it("is Teyvat.me, or a self-host's SITE_NAME in its mails", () => {
    expect(siteName({})).toBe('Teyvat.me')
    expect(siteName({ SITE_NAME: '  ' })).toBe('Teyvat.me')
    expect(siteName({ SITE_NAME: 'Our <Tracker>' })).toBe('Our <Tracker>')
    expect(BRAND).toBe('Teyvat.me')
    const ours = verifyEmailMail('a@example.com', 'https://tracker.example', 'tok', 'Our <Tracker>')
    expect(ours.text).toContain('your Our <Tracker> account')
    expect(ours.text).not.toContain('Teyvat.me')
    expect(ours.html).toContain('Our &lt;Tracker&gt;')
    expect(ours.html).not.toContain('Teyvat.me')
    // teyvat.me's mails stay as they were.
    const prod = passwordChangedMail('a@example.com', SITE_ORIGIN, 'player01')
    expect(prod.text).toContain('player01 on Teyvat.me was just changed')
    expect(prod.text.endsWith('— Teyvat.me')).toBe(true)
  })

  it("is not the passkey's name: a self-host's passkeys still say Teyvat.me", () => {
    const ours = { SITE_URL: 'https://tracker.example', SITE_NAME: 'Our Tracker' }
    expect(relyingParty(ours, 'https://tracker.example/api/x')).toEqual({
      id: 'tracker.example',
      origin: 'https://tracker.example',
      name: 'Teyvat.me',
    })
    expect(relyingParty({}, 'https://teyvat.me/api/x')?.name).toBe('Teyvat.me')
  })
})
