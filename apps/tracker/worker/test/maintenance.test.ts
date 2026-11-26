import { env, SELF } from 'cloudflare:test'
import { readBundle, type AccountResponse, type Good, type ImportResponse } from '@gdt/shared'
import { describe, expect, it } from 'vitest'
import { COLLECT_SECTION_BLOBS, TRASH_DAYS, runMaintenance } from '../services/maintenance'
import { ORIGIN, bigGood, irminsulForm, sampleExtras, sampleGood, signUp } from './client'

describe('maintenance', () => {
  it('keeps a base while deltas use it, after its own snapshot is purged', async () => {
    const { client } = await signUp()
    const { account, importKey } = await client.json<{
      account: AccountResponse
      importKey: string
    }>('/api/accounts', { method: 'POST', json: { name: 'Main' } })
    const upload = async (good: unknown, at: number) =>
      (await (
        await SELF.fetch(`${ORIGIN}/api/genshin-accounts-public/import-by-key`, {
          method: 'POST',
          headers: { 'x-import-key': importKey },
          body: irminsulForm(good, at),
        })
      ).json()) as ImportResponse
    const big = bigGood()
    const played: Good = bigGood({
      artifacts: big.artifacts.map((a, i) => (i === 5 ? { ...a, lock: !a.lock } : a)),
      materials: { ...big.materials, Mora: 5 },
      gi_achievement_times: { ...big.gi_achievement_times, '84584': 1_791_189_294 },
    })
    const base = await upload(big, 1_000)
    const delta = await upload(played, 2_000)
    await client.fetch(`/api/accounts/${account.id}/snapshots/${base.snapshotId}`, {
      method: 'DELETE',
    })
    await runMaintenance(env.DB, Date.now() + (TRASH_DAYS + 1) * 86_400_000)

    const { manifest, blobs } = readBundle(
      await (await client.fetch(`/api/accounts/${account.id}/bundle`)).arrayBuffer(),
    )
    expect(manifest.snapshots.map((s) => s.id)).toEqual([delta.snapshotId])
    const [snapshot] = manifest.snapshots
    for (const hash of [
      snapshot!.artifactsBase!,
      snapshot!.achievementTimesBase!,
      snapshot!.materialsKeyframe,
    ]) {
      expect(blobs.has(hash)).toBe(true)
    }
    const good = await client.json<Good>(
      `/api/accounts/${account.id}/snapshots/${delta.snapshotId}/good`,
    )
    expect(good.gi_achievement_times).toEqual(played.gi_achievement_times)
    expect(good.artifacts).toHaveLength(played.artifacts.length)
  })

  it('purges old trash and the sections only it referenced, keeping shared ones', async () => {
    const { client } = await signUp()
    const { account, importKey } = await client.json<{
      account: AccountResponse
      importKey: string
    }>('/api/accounts', { method: 'POST', json: { name: 'Main' } })
    const upload = async (good: unknown, at: number) =>
      (await (
        await SELF.fetch(`${ORIGIN}/api/genshin-accounts-public/import-by-key`, {
          method: 'POST',
          headers: { 'x-import-key': importKey },
          body: irminsulForm(good, at),
        })
      ).json()) as ImportResponse
    const kept = await upload(sampleGood(sampleExtras()), 1_000)
    // Its own roster and bag: sections only the trashed snapshot references.
    const roster = sampleGood().characters.slice(0, 1)
    const gone = await upload(sampleGood({ characters: roster, materials: { Mora: 7 } }), 2_000)
    await client.fetch(`/api/accounts/${account.id}/snapshots/${gone.snapshotId}`, {
      method: 'DELETE',
    })
    const before = await client.json<AccountResponse>(`/api/accounts/${account.id}`)

    // Within the trash window nothing is purged.
    expect((await runMaintenance(env.DB)).snapshots).toBe(0)

    const later = Date.now() + (TRASH_DAYS + 1) * 86_400_000
    const result = await runMaintenance(env.DB, later)
    expect(result.snapshots).toBeGreaterThanOrEqual(1)
    expect(result.blobs).toBeGreaterThanOrEqual(1)

    const after = await client.json<AccountResponse>(`/api/accounts/${account.id}`)
    expect(after.snapshotCount).toBe(1)
    expect(after.storedBytes).toBeLessThan(before.storedBytes)
    // The surviving snapshot still decodes: its sections were not collected.
    const good = await client.fetch(`/api/accounts/${account.id}/snapshots/${kept.snapshotId}/good`)
    expect(good.status).toBe(200)
    expect(await good.json()).toMatchObject(sampleExtras())
  })

  it('does the other clean-ups when the section collection fails, and says so', async () => {
    const { client } = await signUp()
    const { account, importKey } = await client.json<{
      account: AccountResponse
      importKey: string
    }>('/api/accounts', { method: 'POST', json: { name: 'Main' } })
    const upload = async (good: unknown, at: number) =>
      (await (
        await SELF.fetch(`${ORIGIN}/api/genshin-accounts-public/import-by-key`, {
          method: 'POST',
          headers: { 'x-import-key': importKey },
          body: irminsulForm(good, at),
        })
      ).json()) as ImportResponse
    await upload(sampleGood(sampleExtras()), 1_000)
    const gone = await upload(
      sampleGood({ characters: sampleGood().characters.slice(0, 1), materials: { Mora: 7 } }),
      2_000,
    )
    await client.fetch(`/api/accounts/${account.id}/snapshots/${gone.snapshotId}`, {
      method: 'DELETE',
    })
    const later = Date.now() + (TRASH_DAYS + 1) * 86_400_000
    await env.DB.prepare(
      'INSERT INTO passkey_challenges (challenge_hash, expires_at) VALUES (?1, ?2)',
    )
      .bind('k4-expired', 1)
      .run()
    const blobs = async () =>
      (await env.DB.prepare('SELECT count(*) AS n FROM section_blobs WHERE account_id = ?1')
        .bind(account.id)
        .first<{ n: number }>())!.n
    const blobsBefore = await blobs()

    // The collection alone fails (as a statement past D1's time limit would).
    const failing = new Proxy(env.DB, {
      get(target, name) {
        if (name !== 'prepare') {
          const value: unknown = Reflect.get(target, name, target)
          return typeof value === 'function' ? value.bind(target) : value
        }
        return (sql: string) =>
          sql === COLLECT_SECTION_BLOBS
            ? { all: () => Promise.reject(new Error('D1_ERROR: exceeded the time limit')) }
            : target.prepare(sql)
      },
    })
    const result = await runMaintenance(failing, later)
    expect(result.blobsError).toContain('exceeded the time limit')
    expect(result.blobs).toBe(0)
    expect(result.snapshots).toBeGreaterThanOrEqual(1)
    expect(result.tokens).toBeGreaterThanOrEqual(1)
    const after = await client.json<AccountResponse>(`/api/accounts/${account.id}`)
    expect(after.snapshotCount).toBe(1)
    const challenge = await env.DB.prepare(
      "SELECT 1 FROM passkey_challenges WHERE challenge_hash = 'k4-expired'",
    ).first()
    expect(challenge).toBeNull()
    // Nothing was collected; the next night's run does it.
    expect(await blobs()).toBe(blobsBefore)
    const next = await runMaintenance(env.DB, later)
    expect(next.blobsError).toBeUndefined()
    expect(next.blobs).toBeGreaterThanOrEqual(1)
    expect(await blobs()).toBeLessThan(blobsBefore)
  })
})

describe('response headers', () => {
  it('never lets a cookie-setting response be cached', async () => {
    const { client } = await signUp()
    const response = await client.fetch('/api/auth/refresh', { method: 'POST' })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })
})
