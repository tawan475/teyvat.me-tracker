import {
  GOOD_LIMITS,
  type AccountCreatedResponse,
  type AccountResponse,
  type ImportResponse,
} from '@gdt/shared'
import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { D1Meter } from '../lib/meter'
import { importSnapshot } from '../services/import'
import {
  UPLOAD_LIMIT_DEFAULTS,
  UPLOAD_SETTING_KEYS,
  readUsage,
  secondsToNextUtcDay,
  usageStatement,
  utcDay,
} from '../services/upload-limits'
import { Client, ORIGIN, inOneWindow, irminsulForm, sampleGood, signUp } from './client'

const DIAG = 'test-diag-key-test-diag-key-test-diag-key'
const MB = 1024 * 1024

async function createAccount(client: Client, uid = '812345678') {
  return client.json<AccountCreatedResponse>('/api/accounts', {
    method: 'POST',
    json: { name: 'Main', uid, server: 'ASIA' },
  })
}

async function importByKey(key: string, good: unknown, timestamp: number) {
  const response = await SELF.fetch(`${ORIGIN}/api/genshin-accounts-public/import-by-key`, {
    method: 'POST',
    headers: { 'x-import-key': key, 'x-diag-key': DIAG },
    body: irminsulForm(good, timestamp),
  })
  const cost = Object.fromEntries(
    (response.headers.get('x-gdt-d1') ?? '').split(';').map((part) => {
      const [k, v] = part.trim().split('=')
      return [k, Number(v)]
    }),
  )
  return { response, cost }
}

/** The website's upload (the Import page), one file. */
function importOnSite(client: Client, accountId: number, good: unknown, timestamp: number) {
  return client.fetch(`/api/accounts/${accountId}/import?timestamp=${timestamp}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(good),
  })
}

async function errorOf(response: Response) {
  return ((await response.json()) as { error: { code: string; message: string } }).error
}

async function setup() {
  const { client, me } = await signUp()
  const { account, importKey } = await createAccount(client)
  return { client, userId: me.id, account, importKey }
}

/** Today's row of the user's upload days, as the import batch keeps it. */
async function today(userId: number) {
  return env.DB.prepare(
    'SELECT snapshots, stored_bytes FROM user_upload_days WHERE user_id = ?1 AND day = ?2',
  )
    .bind(userId, utcDay(Date.now()))
    .first<{ snapshots: number; stored_bytes: number }>()
}

/** As if the user had already stored this much today. */
async function setToday(userId: number, snapshots: number, storedBytes: number) {
  await env.DB.prepare(
    `INSERT INTO user_upload_days (user_id, day, snapshots, stored_bytes) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT (user_id, day) DO UPDATE SET snapshots = ?3, stored_bytes = ?4`,
  )
    .bind(userId, utcDay(Date.now()), snapshots, storedBytes)
    .run()
}

async function snapshotCount(accountId: number) {
  const row = await env.DB.prepare(
    'SELECT count(*) AS n FROM snapshots WHERE account_id = ?1 AND deleted_at IS NULL',
  )
    .bind(accountId)
    .first<{ n: number }>()
  return row!.n
}

/** A site_settings override, removed again when `run` ends. Only ever raises a limit. */
async function withSiteSetting<T>(key: string, value: string, run: () => Promise<T>) {
  await env.DB.prepare(
    `INSERT INTO site_settings (key, value, updated_at) VALUES (?1, ?2, ?3)
     ON CONFLICT (key) DO UPDATE SET value = ?2`,
  )
    .bind(key, value, Date.now())
    .run()
  try {
    return await run()
  } finally {
    await env.DB.prepare('DELETE FROM site_settings WHERE key = ?1').bind(key).run()
  }
}

describe('items per file', () => {
  it('refuses a file over a cap with 422, on both routes, and stores nothing', async () => {
    const { client, userId, account, importKey } = await setup()
    const artifact = sampleGood().artifacts[0]!
    const tooMany = sampleGood({
      artifacts: Array.from({ length: GOOD_LIMITS.artifacts + 1 }, () => artifact),
    })

    const { response } = await importByKey(importKey, tooMany, 1_000)
    expect(response.status).toBe(422)
    const error = await errorOf(response)
    expect(error.code).toBe('too_many_items')
    expect(error.message).toBe('This file has 4,051 artifacts; at most 4,050 are accepted.')

    const site = await importOnSite(client, account.id, tooMany, 1_000)
    expect(site.status).toBe(422)
    expect((await errorOf(site)).code).toBe('too_many_items')

    const long = await importByKey(
      importKey,
      sampleGood({ materials: { ['Junk'.repeat(17)]: 1 } }),
      1_000,
    )
    expect(long.response.status).toBe(422)
    expect(await errorOf(long.response)).toMatchObject({
      code: 'key_too_long',
      message: expect.stringContaining('A material key in this file is 68 characters long'),
    })

    expect(await snapshotCount(account.id)).toBe(0)
    expect(await today(userId)).toBeNull()
    const catalog = await env.DB.prepare(
      `SELECT (SELECT count(*) FROM artifacts WHERE account_id = ?1)
            + (SELECT count(*) FROM artifact_chunks WHERE account_id = ?1) AS n`,
    )
      .bind(account.id)
      .first<{ n: number }>()
    expect(catalog!.n).toBe(0)
  })
})

describe('daily upload quota', () => {
  it('counts what an upload stored, and nothing for one that stored nothing', async () => {
    const { client, userId, account, importKey } = await setup()
    const first = await importByKey(importKey, sampleGood(), 1_000)
    expect(first.response.status).toBe(201)
    const stored = (await first.response.json()) as ImportResponse
    const chunks = await env.DB.prepare(
      'SELECT coalesce(sum(length(data)), 0) AS n FROM artifact_chunks WHERE account_id = ?1',
    )
      .bind(account.id)
      .first<{ n: number }>()
    expect(chunks!.n).toBeGreaterThan(0)
    expect(await today(userId)).toEqual({
      snapshots: 1,
      stored_bytes: stored.storedSize + chunks!.n,
    })

    // The same capture again, and the same inventory captured later: no-ops.
    expect((await importByKey(importKey, sampleGood(), 1_000)).response.status).toBe(200)
    expect((await importByKey(importKey, sampleGood(), 2_000)).response.status).toBe(200)
    expect((await today(userId))!.snapshots).toBe(1)

    // The website's upload counts in the same day; a second account too.
    const changed = sampleGood({ materials: { Mora: 1 } })
    expect((await importOnSite(client, account.id, changed, 3_000)).status).toBe(201)
    const other = await createAccount(client, '712345678')
    expect((await importByKey(other.importKey, sampleGood(), 1_000)).response.status).toBe(201)
    expect((await today(userId))!.snapshots).toBe(3)
  })

  it('refuses a new snapshot at the limit with 429 and Retry-After, on both routes', async () => {
    const { client, userId, account, importKey } = await setup()
    expect((await importByKey(importKey, sampleGood(), 1_000)).response.status).toBe(201)
    await setToday(userId, UPLOAD_LIMIT_DEFAULTS.dailySnapshots, 1)

    const before = Date.now()
    const changed = sampleGood({ materials: { Mora: 1 } })
    const { response } = await importByKey(importKey, changed, 2_000)
    expect(response.status).toBe(429)
    const error = await errorOf(response)
    expect(error.code).toBe('daily_upload_limit')
    expect(error.message).toMatch(/^Daily upload limit reached \(1,000 new snapshots or 20 MB/)
    const retryAfter = Number(response.headers.get('retry-after'))
    expect(retryAfter).toBeGreaterThanOrEqual(secondsToNextUtcDay(Date.now()))
    expect(retryAfter).toBeLessThanOrEqual(secondsToNextUtcDay(before))
    // Refused after the first round trip, before writing anything.
    const meter = new D1Meter()
    const text = JSON.stringify(changed)
    await expect(
      importSnapshot(env.DB, account, { text, rawSize: text.length, timestamp: 2_000 }, meter),
    ).rejects.toMatchObject({ status: 429, code: 'daily_upload_limit' })
    expect(meter.roundTrips).toBe(1)
    expect(meter.rowsWritten).toBe(0)

    // New artifacts are refused before they reach the catalog.
    const artifact = { ...sampleGood().artifacts[0]!, substats: [{ key: 'hp', value: 999 }] }
    const withNew = sampleGood({ artifacts: [artifact] })
    expect((await importByKey(importKey, withNew, 3_000)).response.status).toBe(429)
    const site = await importOnSite(client, account.id, withNew, 3_000)
    expect(site.status).toBe(429)
    expect(site.headers.get('retry-after')).toMatch(/^\d+$/)
    const staged = await env.DB.prepare('SELECT count(*) AS n FROM artifacts WHERE account_id = ?1')
      .bind(account.id)
      .first<{ n: number }>()
    expect(staged!.n).toBe(0)

    // What stores nothing still goes through.
    expect((await importByKey(importKey, sampleGood(), 1_000)).response.status).toBe(200)
    expect((await importByKey(importKey, sampleGood(), 4_000)).response.status).toBe(200)
    expect(await snapshotCount(account.id)).toBe(1)
    expect((await today(userId))!.snapshots).toBe(UPLOAD_LIMIT_DEFAULTS.dailySnapshots)
  })

  it('refuses once the day stored its bytes, and only counts today', async () => {
    const { userId, importKey } = await setup()
    // Yesterday's count is not today's.
    await env.DB.prepare(
      'INSERT INTO user_upload_days (user_id, day, snapshots, stored_bytes) VALUES (?1, ?2, ?3, ?4)',
    )
      .bind(userId, utcDay(Date.now() - 86_400_000), 5_000, 500 * MB)
      .run()
    expect((await importByKey(importKey, sampleGood(), 1_000)).response.status).toBe(201)

    await setToday(userId, 2, UPLOAD_LIMIT_DEFAULTS.dailyBytes)
    const { response } = await importByKey(importKey, sampleGood({ materials: { Mora: 1 } }), 2_000)
    expect(response.status).toBe(429)
    expect((await errorOf(response)).code).toBe('daily_upload_limit')
  })

  it('takes its limits from site_settings, ignoring values that are not counts', async () => {
    const { userId, importKey } = await setup()
    expect((await importByKey(importKey, sampleGood(), 1_000)).response.status).toBe(201)
    await setToday(userId, UPLOAD_LIMIT_DEFAULTS.dailySnapshots, 1)
    const next = (timestamp: number) =>
      importByKey(importKey, sampleGood({ materials: { Mora: timestamp } }), timestamp)

    for (const junk of ['', 'lots', '-5', '1.5', '1e400']) {
      await withSiteSetting(UPLOAD_SETTING_KEYS.dailySnapshots, junk, async () => {
        expect((await next(2_000)).response.status, junk).toBe(429)
      })
    }
    await withSiteSetting(UPLOAD_SETTING_KEYS.dailySnapshots, '2000', async () => {
      expect((await next(2_000)).response.status).toBe(201)
    })
    expect((await today(userId))!.snapshots).toBe(UPLOAD_LIMIT_DEFAULTS.dailySnapshots + 1)
    expect((await next(3_000)).response.status).toBe(429)
  })
})

describe('storage quota', () => {
  it("counts every account's sections and catalog chunks against the user's quota", async () => {
    const { client, userId, account, importKey } = await setup()
    expect((await importByKey(importKey, sampleGood(), 1_000)).response.status).toBe(201)
    const other = await createAccount(client, '712345678')
    expect((await importByKey(other.importKey, sampleGood(), 1_000)).response.status).toBe(201)

    const accounts = await client.json<AccountResponse[]>('/api/accounts')
    const chunks = await env.DB.prepare(
      `SELECT coalesce(sum(length(c.data)), 0) AS n FROM artifact_chunks AS c
       JOIN genshin_accounts AS g ON g.id = c.account_id WHERE g.user_id = ?1`,
    )
      .bind(userId)
      .first<{ n: number }>()
    const stored = accounts.reduce((sum, a) => sum + a.storedBytes, 0) + chunks!.n
    const usage = readUsage(
      (await usageStatement(env.DB, account.id, utcDay(Date.now())).first()) ?? undefined,
    )
    expect(usage).toMatchObject({ storedBytes: stored, daySnapshots: 2 })
    expect(usage!.limits).toEqual(UPLOAD_LIMIT_DEFAULTS)

    // A quota of exactly what is stored is full; a byte more is not.
    const setQuota = (quota: number | null) =>
      env.DB.prepare('UPDATE users SET storage_quota = ?1 WHERE id = ?2').bind(quota, userId).run()
    await setQuota(stored)
    const full = await importByKey(importKey, sampleGood({ materials: { Mora: 1 } }), 2_000)
    expect(full.response.status).toBe(413)
    expect(await errorOf(full.response)).toMatchObject({
      code: 'storage_quota',
      message: expect.stringMatching(
        /^Storage full: your accounts store \d+ KB of the \d+ KB allowed/,
      ),
    })
    await setQuota(stored + 1)
    const fits = await importByKey(importKey, sampleGood({ materials: { Mora: 1 } }), 2_000)
    expect(fits.response.status).toBe(201)
  })

  it('refuses at the default quota until a per-user or site override lifts it', async () => {
    const { client, userId, account, importKey } = await setup()
    expect((await importByKey(importKey, sampleGood(), 1_000)).response.status).toBe(201)
    // As if the user's other account held 250 MB.
    const other = await createAccount(client, '712345678')
    await env.DB.prepare('UPDATE genshin_accounts SET stored_bytes = ?1 WHERE id = ?2')
      .bind(250 * MB, other.account.id)
      .run()
    const next = (timestamp: number) =>
      importByKey(importKey, sampleGood({ materials: { Mora: timestamp } }), timestamp)

    const refused = await next(2_000)
    expect(refused.response.status).toBe(413)
    expect((await errorOf(refused.response)).message).toMatch(
      /^Storage full: your accounts store 250 MB of the 200 MB allowed/,
    )
    // The website's upload too; what stores nothing still passes.
    const site = await importOnSite(
      client,
      account.id,
      sampleGood({ materials: { Mora: 1 } }),
      2_000,
    )
    expect(site.status).toBe(413)
    expect((await importByKey(importKey, sampleGood(), 3_000)).response.status).toBe(200)

    await withSiteSetting(UPLOAD_SETTING_KEYS.storageQuota, String(300 * MB), async () => {
      expect((await next(4_000)).response.status).toBe(201)
    })
    expect((await next(5_000)).response.status).toBe(413)

    await env.DB.prepare('UPDATE users SET storage_quota = ?1 WHERE id = ?2')
      .bind(300 * MB, userId)
      .run()
    expect((await next(6_000)).response.status).toBe(201)
    // The per-user value wins over the site's, also when it is lower.
    await withSiteSetting(UPLOAD_SETTING_KEYS.storageQuota, String(1_000 * MB), async () => {
      await env.DB.prepare('UPDATE users SET storage_quota = ?1 WHERE id = ?2')
        .bind(100 * MB, userId)
        .run()
      expect((await next(7_000)).response.status).toBe(413)
    })
  })
})

describe('import key burst', () => {
  it('takes 20 uploads a minute per key, then 429; verify-key keeps working', async () => {
    const { importKey, statuses, limited } = await inOneWindow(async () => {
      const { importKey } = await setup()
      const statuses: number[] = []
      for (let i = 0; i < 20; i++) {
        statuses.push((await importByKey(importKey, sampleGood(), 1_000)).response.status)
      }
      return { importKey, statuses, limited: await importByKey(importKey, sampleGood(), 1_000) }
    })
    const other = await setup()
    expect(statuses).toEqual([201, ...Array<number>(19).fill(200)])
    expect(limited.response.status).toBe(429)
    expect((await errorOf(limited.response)).code).toBe('rate_limited')

    const verify = await SELF.fetch(`${ORIGIN}/api/genshin-accounts-public/verify-key`, {
      headers: { 'x-import-key': importKey },
    })
    expect(verify.status).toBe(200)
    // Per key: another key is not affected.
    expect((await importByKey(other.importKey, sampleGood(), 1_000)).response.status).toBe(201)
  }, 60_000)
})

describe('D1 cost of the limits', () => {
  it('adds no round trip: 3 with new artifacts, 2 without, 1 for a no-op', async () => {
    const { importKey } = await setup()
    const first = await importByKey(importKey, sampleGood(), 1_000)
    expect(first.response.status).toBe(201)
    // lookup (with the usage), catalog, store (with the day's count)
    expect(first.cost['round-trips']).toBe(3)
    const second = await importByKey(importKey, sampleGood({ materials: { Mora: 1 } }), 2_000)
    expect(second.response.status).toBe(201)
    expect(second.cost['round-trips']).toBe(2)
    const again = await importByKey(importKey, sampleGood({ materials: { Mora: 1 } }), 2_000)
    expect(again.response.status).toBe(200)
    expect(again.cost['round-trips']).toBe(1)
    expect(again.cost['rows-written']).toBe(0)
  })
})
