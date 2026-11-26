/**
 * The `import_stages` line (lib/import-stages.ts): one per upload on every
 * route that stores snapshots, with exactly the documented keys, numbers and
 * fixed words only, so nothing personal can slip into it later.
 */
import { toBase64Url, type AccountCreatedResponse, type IrminsulTokenResponse } from '@gdt/shared'
import { SELF } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IMPORT_STAGE_KEYS, IMPORT_STAGES, ImportStages } from '../lib/import-stages'
import { D1Meter } from '../lib/meter'
import { randomToken } from '../lib/crypto'
import { ORIGIN, irminsulForm, sampleExtras, sampleGood, signUp, type Client } from './client'

const UID = '812345678'
const REDIRECT = 'http://127.0.0.1:53682/callback'
const STATE = 'state-0123456789abcdefghijklmnopqrstuvwxyz'

let lines: string[] = []
beforeEach(() => {
  lines = []
  const log = console.log.bind(console)
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    if (args[0] === 'import_stages') lines.push(args[1] as string)
    else log(...args)
  })
})
afterEach(() => vi.restoreAllMocks())

/** The lines logged so far, each checked: the documented keys in order, numbers and fixed words. */
function read(): Record<string, number | string>[] {
  return lines.map((text) => {
    const line = JSON.parse(text) as Record<string, number | string>
    expect(Object.keys(line)).toEqual([...IMPORT_STAGE_KEYS])
    for (const [key, value] of Object.entries(line)) {
      if (key === 'route') expect(['capture', 'key', 'web']).toContain(value)
      else if (key === 'status') expect(['created', 'unchanged', 'failed']).toContain(value)
      else {
        expect(typeof value, key).toBe('number')
        expect(Number.isInteger(value), key).toBe(true)
        expect(value as number, key).toBeGreaterThanOrEqual(0)
      }
    }
    expect(text).not.toContain(UID)
    return line
  })
}

async function signInCapture(client: Client): Promise<string> {
  const verifier = randomToken(32)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  const { redirect } = await client.json<{ redirect: string }>('/api/oauth/authorize', {
    method: 'POST',
    json: {
      client_id: 'irminsul',
      redirect_uri: REDIRECT,
      state: STATE,
      code_challenge: toBase64Url(new Uint8Array(digest)),
      code_challenge_method: 'S256',
      device: 'EXAMPLE1',
      upload: { mode: 'uid' },
    },
  })
  const response = await SELF.fetch(`${ORIGIN}/api/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '2001:db8:5::1' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: 'irminsul',
      code: new URL(redirect).searchParams.get('code'),
      code_verifier: verifier,
      redirect_uri: REDIRECT,
    }),
  })
  expect(response.status).toBe(200)
  return ((await response.json()) as IrminsulTokenResponse).access_token
}

describe('import_stages', () => {
  it('lists every stage once, in order', () => {
    expect(IMPORT_STAGE_KEYS.filter((key) => key.endsWith('Ms'))).toEqual([
      ...IMPORT_STAGES.map((stage) => `${stage}Ms`),
      'totalMs',
      'sqlMs',
    ])
    expect(new Set(IMPORT_STAGE_KEYS).size).toBe(IMPORT_STAGE_KEYS.length)
  })

  it('logs once, a failure with its HTTP status only', () => {
    const stages = new ImportStages('key')
    stages.done(new D1Meter(), { error: new Error(`player01 ${UID}`) })
    stages.done(new D1Meter(), { status: 'created' })
    const [line] = read()
    expect(lines).toHaveLength(1)
    expect(line).toMatchObject({ route: 'key', status: 'failed', code: 500 })
  })

  it('is one line per upload on each route that stores snapshots', async () => {
    const { client } = await signUp()
    const { account, importKey } = await client.json<AccountCreatedResponse>('/api/accounts', {
      method: 'POST',
      json: { name: 'Main', uid: UID, server: 'ASIA' },
    })
    const good = sampleGood(sampleExtras(Number(UID)))

    // import-by-key: stored, then the same capture again.
    const byKey = () =>
      SELF.fetch(`${ORIGIN}/api/genshin-accounts-public/import-by-key`, {
        method: 'POST',
        headers: { 'x-import-key': importKey },
        body: irminsulForm(good, 1_000),
      })
    expect((await byKey()).status).toBe(201)
    expect((await byKey()).status).toBe(200)
    // Capture's Bearer route: a later capture of the same inventory.
    const access = await signInCapture(client)
    const bearer = await SELF.fetch(`${ORIGIN}/api/irminsul/import`, {
      method: 'POST',
      headers: { authorization: `Bearer ${access}` },
      body: irminsulForm({ ...good, materials: { ...good.materials, Mora: 7 } }, 2_000),
    })
    expect(bearer.status).toBe(201)
    // The website: a stored file, then one that is refused (a different file at that time).
    const web = (file: unknown) =>
      client.fetch(`/api/accounts/${account.id}/import`, {
        method: 'POST',
        body: irminsulForm(file, 3_000),
      })
    expect((await web(good)).status).toBe(201)
    expect((await web({ ...good, materials: { Mora: 1 } })).status).toBe(409)

    const read5 = read()
    expect(read5.map((line) => [line.route, line.status, line.code])).toEqual([
      ['key', 'created', 0],
      ['key', 'unchanged', 0],
      ['capture', 'created', 0],
      ['web', 'created', 0],
      ['web', 'failed', 409],
    ])
    const [created] = read5

    expect(created).toMatchObject({ v: 1, held: 0, trips: 3, newPieces: good.artifacts.length })
    expect(created!.raw).toBe(JSON.stringify(good).length)
    expect(created!.pieces).toBe(good.artifacts.length)
    expect(created!.stored as number).toBeGreaterThan(0)
    expect(created!.sections as number).toBeGreaterThan(0)
    const stages = IMPORT_STAGES.reduce((sum, stage) => sum + (created![`${stage}Ms`] as number), 0)
    expect(stages).toBeLessThanOrEqual(created!.totalMs as number)
  })
})
