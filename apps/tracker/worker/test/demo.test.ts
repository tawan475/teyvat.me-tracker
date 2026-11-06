import {
  decodeBundle,
  type AccountCreatedResponse,
  type AccountResponse,
  type SnapshotResponse,
} from '@gdt/shared'
import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { ORIGIN, irminsulForm, sampleGood, signUp } from './client'

const get = (path: string, headers: Record<string, string> = {}) =>
  SELF.fetch(`${ORIGIN}${path}`, { headers })

/** An account with two captures and a planner goal, named as the demo. */
async function demoAccount() {
  const { client } = await signUp()
  const { account, importKey } = await client.json<AccountCreatedResponse>('/api/accounts', {
    method: 'POST',
    json: { name: 'Demo', uid: '812345678', server: 'ASIA' },
  })
  for (const at of [1_000, 2_000]) {
    const good = sampleGood({ timestamp: at })
    good.materials = { ...good.materials, Mora: at }
    const response = await SELF.fetch(`${ORIGIN}/api/genshin-accounts-public/import-by-key`, {
      method: 'POST',
      headers: { 'x-import-key': importKey },
      body: irminsulForm(good, at),
    })
    expect(response.ok).toBe(true)
  }
  await client.json(`/api/accounts/${account.id}/planner-targets`, {
    method: 'PATCH',
    json: {
      upsert: [
        {
          kind: 'character',
          key: 'Furina',
          target: { level: 90, ascension: 6, talents: { auto: 9, skill: 9, burst: 9 } },
        },
      ],
    },
  })
  await env.DB.prepare(
    `INSERT INTO site_settings (key, value, updated_at) VALUES ('demo.account', ?1, 0)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
  )
    .bind(String(account.id))
    .run()
  return { client, account }
}

describe('the public demo (/api/demo)', () => {
  it('404s while no demo account is set', async () => {
    await env.DB.prepare(`DELETE FROM site_settings WHERE key = 'demo.account'`).run()
    const response = await get('/api/demo/snapshots')
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: { code: 'demo_missing' } })
  })

  it('serves the named account to anyone, with no cookie, cached for a day', async () => {
    const { account } = await demoAccount()

    const listed = (await (await get('/api/demo/account')).json()) as AccountResponse
    expect(listed).toMatchObject({ id: account.id, name: 'Demo', snapshotCount: 2 })

    const response = await get('/api/demo/snapshots')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('public, max-age=86400')
    const etag = response.headers.get('etag')!
    // The browser's store reads the version out of it (account-data.ts `stored`).
    expect(etag).toMatch(new RegExp(`a${account.id}\\.v\\d+\\.demo\\.snapshots`))
    const snapshots = (await response.json()) as SnapshotResponse[]
    expect(snapshots).toHaveLength(2)

    // The same version again: a 304 with no body.
    const again = await get('/api/demo/snapshots', { 'if-none-match': etag })
    expect(again.status).toBe(304)

    const bundle = await decodeBundle(
      await (await get('/api/demo/bundle?sections=materials&format=2')).arrayBuffer(),
    )
    expect(bundle.snapshots).toHaveLength(2)
    expect((await get('/api/demo/catalog')).status).toBe(200)

    const targets = (await (await get('/api/demo/planner-targets')).json()) as {
      targets: { key: string }[]
    }
    expect(targets.targets.map((t) => t.key)).toEqual(['Furina'])
    const settings = (await (await get('/api/demo/settings')).json()) as {
      settings: { traveler: string }
    }
    expect(settings.settings.traveler).toBe('F')
    for (const path of [
      'achievement-marks',
      'anecdote-marks',
      'quest-marks',
      'planner-state',
      'planner-tasks',
      'wishes',
    ]) {
      expect((await get(`/api/demo/${path}`)).status, path).toBe(200)
    }

    const good = await get(`/api/demo/snapshots/${snapshots[0]!.id}/good`)
    expect(good.headers.get('content-disposition')).toMatch(/^attachment/)
    expect(((await good.json()) as { materials: Record<string, number> }).materials.Mora).toBe(
      2_000,
    )
    expect((await get('/api/demo/latest/good')).status).toBe(200)
  })

  it('writes nothing: there are no write routes', async () => {
    await demoAccount()
    for (const path of ['/api/demo/planner-targets', '/api/demo/settings', '/api/demo/snapshots']) {
      const response = await SELF.fetch(`${ORIGIN}${path}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-gdt-csrf': '1' },
        body: '{}',
      })
      expect(response.status, path).toBe(404)
    }
  })
})
