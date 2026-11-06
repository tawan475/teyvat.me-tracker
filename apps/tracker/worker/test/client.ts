import type { Good, LiveEvent, MeResponse } from '@gdt/shared'
import { createExecutionContext, env, SELF, waitOnExecutionContext } from 'cloudflare:test'
import worker from '../index'
import { readBookmark } from '../lib/d1-session'

export const ORIGIN = 'https://teyvat.me'

let clients = 0

/** How a client reaches the Worker: SELF, or a direct call with a changed env (recovery tests). */
export type Transport = (url: string, init: RequestInit) => Promise<Response>

/**
 * Calls the Worker directly with `overrides` in its env (vars wrangler.jsonc
 * doesn't set), waiting for the work it does after responding.
 */
export function withEnv(overrides: Record<string, unknown>): Transport {
  return async (url, init) => {
    const ctx = createExecutionContext()
    const bindings = { ...env, ...overrides } as unknown as Env
    const response = await worker.fetch(new Request(url, init), bindings, ctx)
    await waitOnExecutionContext(ctx)
    return response
  }
}

/**
 * The email features on (EMAIL_FEATURES=1). SELF runs with them paused, as
 * production does until the var is set.
 */
export const emailOn = (overrides: Record<string, unknown> = {}): Transport =>
  withEnv({ EMAIL_FEATURES: '1', ...overrides })

/** A browser stand-in: keeps cookies per path and sends the CSRF header. */
export class Client {
  private cookies = new Map<string, { value: string; path: string }>()
  /** Each client is its own IP, so rate limits never couple unrelated tests. */
  private ip = `2001:db8::${(++clients).toString(16)}`

  constructor(private readonly transport: Transport = (url, init) => SELF.fetch(url, init)) {}

  cookie(name: string): string | undefined {
    return this.cookies.get(name)?.value
  }

  /** Puts a cookie in the jar (or takes it out with `null`), as tests of tampering need. */
  setCookie(name: string, value: string | null, path = '/'): void {
    if (value === null) this.cookies.delete(name)
    else this.cookies.set(name, { value, path })
  }

  async fetch(path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.set('x-gdt-csrf', '1')
    if (!headers.has('cf-connecting-ip')) headers.set('cf-connecting-ip', this.ip)
    const cookie = [...this.cookies]
      .filter(([, c]) => path.startsWith(c.path))
      .map(([name, c]) => `${name}=${c.value}`)
      .join('; ')
    if (cookie) headers.set('cookie', cookie)
    let body = init.body
    if (init.json !== undefined) {
      headers.set('content-type', 'application/json')
      body = JSON.stringify(init.json)
    }
    const response = await this.transport(ORIGIN + path, { ...init, headers, body })
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attributes] = line.split(';').map((s) => s.trim())
      const [name, ...value] = pair!.split('=')
      const cookiePath =
        attributes.find((a) => a.toLowerCase().startsWith('path='))?.slice(5) ?? '/'
      const expired = attributes.some((a) => /^max-age=0$/i.test(a)) || value.join('=') === ''
      if (expired) this.cookies.delete(name!)
      else this.cookies.set(name!, { value: value.join('='), path: cookiePath })
    }
    return response
  }

  async json<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
    const response = await this.fetch(path, init)
    if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`)
    return response.json() as Promise<T>
  }
}

let counter = 0

/**
 * Registers a fresh user (with an email, which only `emailOn()` keeps);
 * returns a signed-in client and the credentials.
 */
export async function signUp(transport?: Transport): Promise<{
  client: Client
  username: string
  password: string
  me: MeResponse
}> {
  const username = `traveler${++counter}${crypto.randomUUID().slice(0, 6)}`
  const password = 'correct horse battery staple'
  const client = new Client(transport)
  const me = await client.json<MeResponse>('/api/auth/register', {
    method: 'POST',
    json: { username, email: `${username}@example.com`, password },
  })
  return { client, username, password, me }
}

export function sampleGood(overrides: Partial<Good> = {}): Good {
  return {
    format: 'GOOD',
    version: 3,
    source: 'Irminsul',
    characters: [
      {
        key: 'Furina',
        level: 90,
        constellation: 2,
        ascension: 6,
        talent: { auto: 6, skill: 10, burst: 10 },
      },
      {
        key: 'Bennett',
        level: 80,
        constellation: 6,
        ascension: 6,
        talent: { auto: 1, skill: 9, burst: 12 },
      },
    ],
    artifacts: [
      {
        setKey: 'GoldenTroupe',
        slotKey: 'flower',
        level: 20,
        rarity: 5,
        mainStatKey: 'hp',
        location: 'Furina',
        lock: true,
        totalRolls: 9,
        astralMark: true,
        elixirCrafted: false,
        substats: [
          { key: 'critRate_', value: 10.5, initialValue: 3.9 },
          { key: 'critDMG_', value: 21.8, initialValue: 7.8 },
        ],
        unactivatedSubstats: [],
      },
      {
        setKey: 'Adventurer',
        slotKey: 'plume',
        level: 0,
        rarity: 3,
        mainStatKey: 'atk',
        location: '',
        lock: false,
        totalRolls: 1,
        astralMark: false,
        elixirCrafted: false,
        substats: [{ key: 'hp', value: 167 }],
        unactivatedSubstats: [],
      },
    ],
    weapons: [
      {
        key: 'SplendorOfTranquilWaters',
        level: 90,
        ascension: 6,
        refinement: 1,
        location: 'Furina',
        lock: true,
      },
      { key: 'DullBlade', level: 1, ascension: 0, refinement: 1, location: '', lock: false },
    ],
    materials: { Mora: 1_000_000, Primogem: 16_000, Crystalfly: 3 },
    gi_achievements: [81001, 81002],
    timestamp: 1_780_000_000_000,
    ...overrides,
  }
}

/** irminsul's own top-level keys, as it writes them (uid as a number, times in unix seconds). */
export function sampleExtras(
  uid = 812345678,
): Pick<Good, 'gi_player' | 'gi_achievement_times' | 'gi_characters'> {
  return {
    gi_player: { uid, ar: 60, arExp: 0, wl: 8, wlLimit: 9, resin: 124, maxStamina: 24000 },
    gi_achievement_times: { '81001': 1_650_000_000, '81002': 1_700_000_000 },
    gi_characters: {
      Furina: { friendship: 10, obtainedAt: 1_694_000_000 },
      Bennett: { friendship: 7 },
    },
  }
}

/** irminsul's upload: multipart with an optional `timestamp` field and a `file` part. */
export function irminsulForm(good: unknown, timestamp?: number): FormData {
  const form = new FormData()
  if (timestamp !== undefined) form.set('timestamp', String(timestamp))
  form.set(
    'file',
    new File([JSON.stringify(good)], 'irminsul_capture.json', { type: 'application/json' }),
  )
  return form
}

const SLOTS = ['flower', 'plume', 'sands', 'goblet', 'circlet'] as const

/**
 * A larger inventory (with irminsul's extras): a delta only pays off against a
 * base of some size, so tests of delta storage need real-sized sections.
 * Deterministic; times are spread like real ones.
 */
export function bigGood(overrides: Partial<Good> = {}): Good {
  const scatter = (i: number, n: number) => ((i * 2_654_435_761) >>> 7) % n
  const base = sampleGood(sampleExtras())
  const artifacts = Array.from({ length: 1000 }, (_, i) => ({
    setKey: 'GoldenTroupe',
    slotKey: SLOTS[i % 5]!,
    level: 20,
    rarity: 5,
    mainStatKey: 'hp',
    location: ['', '', '', 'Furina', 'Bennett', 'Xiangling'][scatter(i, 6)]!,
    lock: scatter(i, 3) !== 0,
    astralMark: scatter(i, 11) === 0,
    totalRolls: 9,
    elixirCrafted: false,
    substats: [
      { key: 'critRate_', value: 3 + (i % 50) / 10 },
      { key: 'hp', value: 100 + i },
    ],
    unactivatedSubstats: [],
  }))
  const times = Array.from({ length: 600 }, (_, i): [string, number] => [
    String(81000 + i),
    1_650_000_000 + ((i * 7_919_993) % 120_000_000),
  ])
  const materials = Object.fromEntries(
    Array.from({ length: 400 }, (_, i) => [`Material${i}`, ((i * 7919) % 5000) + 1]),
  )
  return {
    ...base,
    artifacts: [...base.artifacts, ...artifacts],
    materials: { ...base.materials, ...materials },
    gi_achievements: times.map(([id]) => Number(id)),
    gi_achievement_times: Object.fromEntries(times),
    ...overrides,
  }
}

/**
 * A live socket message as the event it carries, without the D1 bookmarks
 * every event may add (d1-session.ts), which must be real bookmarks when sent.
 */
export function liveMessage(text: string): LiveEvent {
  const { d1, d1l, ...event } = JSON.parse(text) as LiveEvent
  for (const bookmark of [d1, d1l]) {
    if (bookmark !== undefined && readBookmark(bookmark) !== bookmark) {
      throw new Error(`not a bookmark: ${bookmark}`)
    }
  }
  return event as LiveEvent
}
