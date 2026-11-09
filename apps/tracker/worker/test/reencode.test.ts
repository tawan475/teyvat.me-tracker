import { env, SELF } from 'cloudflare:test'
import {
  BlobDecoder,
  deflate,
  type AccountResponse,
  type RawBlob,
  type SnapshotResponse,
} from '@gdt/shared'
import { describe, expect, it } from 'vitest'
import { reencodeAccount } from '../services/reencode'
import { toBytes } from '../services/storage'
import { ORIGIN, bigGood, irminsulForm, signUp } from './client'

// The in-place re-encode of JSON-layout blobs a binary form now holds
// (worker/services/reencode.ts): same values, every GOOD file the same.

const T = 1_794_000_000
const TASKS = 10

async function account() {
  const { client } = await signUp()
  const { account, importKey } = await client.json<{
    account: AccountResponse
    importKey: string
  }>('/api/accounts', { method: 'POST', json: { name: 'Main' } })
  const big = bigGood()
  for (let i = 0; i < 4; i++) {
    const good = {
      ...big,
      gi_tasks: {
        commissions: { finished: i, total: 4, claimed: i === 3 },
        resin: { value: 40 + i, nextAt: T + 480 * i },
        transformer: { usedAt: T - 86_400, readyAt: T + 86_400 * 6 },
      },
    }
    const response = await SELF.fetch(`${ORIGIN}/api/genshin-accounts-public/import-by-key`, {
      method: 'POST',
      headers: { 'x-import-key': importKey },
      body: irminsulForm(good, 1_000 * (i + 1)),
    })
    expect(response.ok).toBe(true)
  }
  return { client, accountId: account.id, base: `/api/accounts/${account.id}` }
}

async function blobs(accountId: number): Promise<RawBlob[]> {
  const { results } = await env.DB.prepare(
    'SELECT id, kind, base_id, data FROM section_blobs WHERE account_id = ?1 ORDER BY id',
  )
    .bind(accountId)
    .all<Record<string, unknown>>()
  return results.map((row) => ({
    id: row.id as number,
    code: row.kind as number,
    baseId: (row.base_id as number | null) ?? null,
    data: toBytes(row.data),
  }))
}

/** Rewrites the account's tasks blobs as older builds stored them: JSON, the later ones compressed against the first. */
async function asOldJson(accountId: number) {
  const all = await blobs(accountId)
  const decoder = new BlobDecoder((id) => all.find((b) => b.id === id))
  const tasks = all.filter((b) => b.code === TASKS)
  expect(tasks.length).toBeGreaterThan(1)
  const text = (id: number) => new TextEncoder().encode(JSON.stringify(decoder.decode(id).value))
  const root = tasks[0]!
  const rootPayload = new Uint8Array([0x00, ...text(root.id)])
  const rows = tasks.map((blob, i) => {
    const body = text(blob.id)
    const data =
      i === 0
        ? new Uint8Array([0x01, ...deflate(body)])
        : new Uint8Array([0x02, ...deflate(body, rootPayload)])
    return { id: blob.id, data, base: i === 0 ? null : root.id }
  })
  await env.DB.batch(
    rows.map((row) =>
      env.DB.prepare('UPDATE section_blobs SET data = ?1, base_id = ?2 WHERE id = ?3').bind(
        row.data,
        row.base,
        row.id,
      ),
    ),
  )
  return tasks.length
}

async function goods(client: Awaited<ReturnType<typeof account>>['client'], base: string) {
  const list = await client.json<SnapshotResponse[]>(`${base}/snapshots`)
  const out: Record<number, string> = {}
  for (const { id } of list)
    out[id] = await (await client.fetch(`${base}/snapshots/${id}/good`)).text()
  return out
}

describe('re-encoding JSON blobs in place', () => {
  it('stores them in binary, every GOOD file the same, the account smaller', async () => {
    const { client, accountId, base } = await account()
    const count = await asOldJson(accountId)
    const before = await goods(client, base)
    const storedBefore = (await client.json<AccountResponse>(base)).storedBytes

    const dry = await reencodeAccount(env.DB, accountId, { dryRun: true })
    expect(dry).toMatchObject({ applied: false, reason: 'dry run', blobs: count })
    expect(dry.after).toBeLessThan(dry.before)

    const done = await reencodeAccount(env.DB, accountId)
    expect(done).toMatchObject({ applied: true, blobs: count })
    const tasks = (await blobs(accountId)).filter((b) => b.code === TASKS)
    for (const blob of tasks) expect(blob.data[0]! & 0xf0).toBe(0x10)

    expect(await goods(client, base)).toEqual(before)
    const storedAfter = (await client.json<AccountResponse>(base)).storedBytes
    expect(storedBefore - storedAfter).toBe(done.before - done.after)

    expect(await reencodeAccount(env.DB, accountId)).toMatchObject({ reason: 'nothing to do' })
  })

  it('writes nothing when a blob changed between the read and the write', async () => {
    const { client, accountId, base } = await account()
    await asOldJson(accountId)
    const before = await goods(client, base)
    // Just before the write batch (the read is the first), the first tasks
    // blob is stored again another way: the same value, not deflated.
    let batches = 0
    const racing = {
      prepare: (sql: string) => env.DB.prepare(sql),
      batch: async (statements: D1PreparedStatement[]) => {
        if (++batches === 2) {
          const all = await blobs(accountId)
          const root = all.find((b) => b.code === TASKS && b.baseId === null)!
          const value = new BlobDecoder((id) => all.find((b) => b.id === id)).decode(root.id).value
          const stored = new Uint8Array([0x00, ...new TextEncoder().encode(JSON.stringify(value))])
          await env.DB.prepare('UPDATE section_blobs SET data = ?1 WHERE id = ?2')
            .bind(stored, root.id)
            .run()
        }
        return env.DB.batch(statements)
      },
    } as unknown as D1Database
    const result = await reencodeAccount(racing, accountId)
    expect(result).toMatchObject({ applied: false, reason: 'changed meanwhile' })
    // Nothing written: still JSON, every file the same.
    const tasks = (await blobs(accountId)).filter((b) => b.code === TASKS)
    for (const blob of tasks) expect(blob.data[0]! & 0xf0).toBe(0x00)
    expect(await goods(client, base)).toEqual(before)
  })
})
