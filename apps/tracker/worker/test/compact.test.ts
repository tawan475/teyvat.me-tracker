import type {
  AccountCreatedResponse,
  CompactResponse,
  SnapshotResponse,
  UsageResponse,
} from '@gdt/shared'
import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { Client, ORIGIN, irminsulForm, sampleGood, signUp } from './client'

const HOUR = 3_600_000
const DAY = 24 * HOUR
// A Monday, 00:00 UTC.
const MONDAY = Date.UTC(2026, 10, 2)

async function createAccount(client: Client) {
  return client.json<AccountCreatedResponse>('/api/accounts', {
    method: 'POST',
    json: { name: 'Main', uid: '812345678', server: 'ASIA' },
  })
}

/** An upload whose Mora differs per call, so every one stores a snapshot. */
function upload(key: string, timestamp: number, mora: number) {
  return SELF.fetch(`${ORIGIN}/api/genshin-accounts-public/import-by-key`, {
    method: 'POST',
    headers: { 'x-import-key': key },
    body: irminsulForm(sampleGood({ materials: { Mora: mora } }), timestamp),
  })
}

async function sectionRows(accountId: number): Promise<number> {
  const row = await env.DB.prepare('SELECT count(*) AS n FROM section_blobs WHERE account_id = ?1')
    .bind(accountId)
    .first<{ n: number }>()
  return row!.n
}

describe('compact snapshots', () => {
  it('keeps one a day on the caller’s clock, deletes the rest at once, and frees their sections', async () => {
    const { client } = await signUp()
    const { account, importKey } = await createAccount(client)
    const times = [1, 5, 23, 24 + 2, 24 + 20, 48 + 3].map((h) => MONDAY + h * HOUR)
    for (const [i, at] of times.entries())
      expect((await upload(importKey, at, 1000 + i)).status).toBe(201)
    const before = await sectionRows(account.id)

    const dry = await client.json<CompactResponse>(
      `/api/accounts/${account.id}/snapshots/compact`,
      {
        method: 'POST',
        json: { keep: 'day', offsetMinutes: 0, dryRun: true },
      },
    )
    expect(dry).toEqual({ kept: 3, removed: 3, dryRun: true })
    expect(
      (await client.json<SnapshotResponse[]>(`/api/accounts/${account.id}/snapshots`)).length,
    ).toBe(6)

    const done = await client.json<CompactResponse>(
      `/api/accounts/${account.id}/snapshots/compact`,
      {
        method: 'POST',
        json: { keep: 'day', offsetMinutes: 0 },
      },
    )
    expect(done).toEqual({ kept: 3, removed: 3, dryRun: false })
    const left = await client.json<SnapshotResponse[]>(`/api/accounts/${account.id}/snapshots`)
    expect(left.map((s) => s.takenAt).sort()).toEqual([times[2], times[4], times[5]])
    // Gone for good, not in the trash; sections nobody references any more are collected.
    const trash = await env.DB.prepare(
      'SELECT count(*) AS n FROM snapshots WHERE account_id = ?1 AND deleted_at IS NOT NULL',
    )
      .bind(account.id)
      .first<{ n: number }>()
    expect(trash!.n).toBe(0)
    expect(await sectionRows(account.id)).toBeLessThan(before)
    const counters = await env.DB.prepare(
      'SELECT snapshot_count, stored_bytes FROM genshin_accounts WHERE id = ?1',
    )
      .bind(account.id)
      .first<{ snapshot_count: number; stored_bytes: number }>()
    expect(counters!.snapshot_count).toBe(3)
    const blobBytes = await env.DB.prepare(
      'SELECT coalesce(sum(length(data)), 0) AS n FROM section_blobs WHERE account_id = ?1',
    )
      .bind(account.id)
      .first<{ n: number }>()
    expect(counters!.stored_bytes).toBe(blobBytes!.n)

    // A week keeps one of the Monday–Wednesday run: the newest.
    const week = await client.json<CompactResponse>(
      `/api/accounts/${account.id}/snapshots/compact`,
      {
        method: 'POST',
        json: { keep: 'week', offsetMinutes: 0 },
      },
    )
    expect(week).toEqual({ kept: 1, removed: 2, dryRun: false })

    // Not for a viewer, nor a stranger.
    const stranger = await signUp()
    const refused = await stranger.client.fetch(`/api/accounts/${account.id}/snapshots/compact`, {
      method: 'POST',
      json: { keep: 'day', offsetMinutes: 0 },
    })
    expect(refused.status).toBe(404)
  })

  it('tells the user what they store against their quota, split by kind', async () => {
    const { client, me } = await signUp()
    const { account, importKey } = await createAccount(client)
    expect((await upload(importKey, MONDAY, 1)).status).toBe(201)
    const usage = await client.json<UsageResponse>('/api/me/usage')
    expect(usage.accounts).toHaveLength(1)
    expect(usage.accounts[0]).toMatchObject({ id: account.id, snapshots: 1, wishPulls: 0 })
    expect(usage.sectionBytes).toBeGreaterThan(0)
    expect(usage.storedBytes).toBe(usage.sectionBytes + usage.catalogBytes + usage.wishBytes)
    expect(usage.storageQuota).toBeGreaterThan(usage.storedBytes)
    await env.DB.prepare('UPDATE users SET storage_quota = 12345 WHERE id = ?1').bind(me.id).run()
    expect((await client.json<UsageResponse>('/api/me/usage')).storageQuota).toBe(12345)
  })
})
