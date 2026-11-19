import type {
  AccountCreatedResponse,
  AccountResponse,
  BootstrapResponse,
  Good,
  ImportResponse,
} from '@gdt/shared'
import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { ORIGIN, irminsulForm, sampleGood, signUp, type Client } from './client'

// The account list's figures when Capture's gi_off left a build section out
// (issue 12): each from the newest capture that shared its section, as the
// account's pages show "now", read in the list's one statement.

const DIAG = 'test-diag-key-test-diag-key-test-diag-key'

async function setup() {
  const { client } = await signUp()
  const { account, importKey } = await client.json<AccountCreatedResponse>('/api/accounts', {
    method: 'POST',
    json: { name: 'Main' },
  })
  return { client, accountId: account.id, importKey }
}

async function send(key: string, good: unknown, at: number): Promise<ImportResponse> {
  const response = await SELF.fetch(`${ORIGIN}/api/genshin-accounts-public/import-by-key`, {
    method: 'POST',
    headers: { 'x-import-key': key },
    body: irminsulForm(good, at),
  })
  expect(response.status, await response.clone().text()).toBeLessThan(300)
  return (await response.json()) as ImportResponse
}

/** A capture with `off` left out, as Capture sends it (the key absent, the name in gi_off). */
function without(good: Good, off: ('characters' | 'weapons' | 'artifacts' | 'materials')[]): Good {
  const out: Record<string, unknown> = { ...good, gi_off: off }
  for (const section of off) {
    // The GOOD sections are required by the normaliser: an off one comes as empty.
    out[section] = section === 'materials' ? {} : []
  }
  return out as unknown as Good
}

async function latestOf(client: Client, accountId: number) {
  const list = await client.json<AccountResponse[]>('/api/accounts')
  return list.find((a) => a.id === accountId)!.latest!
}

async function rowsRead(client: Client): Promise<{ trips: number; rows: number }> {
  const response = await client.fetch('/api/accounts', { headers: { 'x-diag-key': DIAG } })
  expect(response.status).toBe(200)
  const cost = Object.fromEntries(
    (response.headers.get('x-gdt-d1') ?? '').split(';').map((part) => {
      const [k, v] = part.trim().split('=')
      return [k, Number(v)]
    }),
  )
  return { trips: cost['round-trips']!, rows: cost['rows-read']! }
}

describe("the account list's figures with sections left out", () => {
  it('answers no stand-in while every section is shared', async () => {
    const { client, accountId, importKey } = await setup()
    await send(importKey, sampleGood(), 1_000)
    await send(importKey, { ...sampleGood({ materials: { Mora: 5 } }), gi_off: [] }, 2_000)
    const latest = await latestOf(client, accountId)
    expect(latest.sharedSummary).toBeUndefined()
    expect(latest.summary.mora).toBe(5)
  })

  it('takes each figure from the newest capture that shared its section', async () => {
    const { client, accountId, importKey } = await setup()
    await send(importKey, sampleGood({ materials: { Mora: 100, Primogem: 7 } }), 1_000)
    await send(
      importKey,
      without(sampleGood({ materials: { Mora: 200, Primogem: 8 } }), ['characters']),
      2_000,
    )
    let latest = await latestOf(client, accountId)
    // The capture as stored says 0 characters; the list shows the last shared 2.
    expect(latest.summary.characters).toBe(0)
    expect(latest.sharedSummary).toMatchObject({ characters: 2, mora: 200, primogem: 8 })
    expect(latest.sharedSummary!.artifacts).toBe(latest.summary.artifacts)

    // Characters and the bag off: each from its own newest sharer.
    await send(importKey, without(sampleGood(), ['characters', 'materials']), 3_000)
    latest = await latestOf(client, accountId)
    expect(latest.summary).toMatchObject({ characters: 0, mora: 0, primogem: 0, materials: 0 })
    expect(latest.sharedSummary).toMatchObject({ characters: 2, mora: 200, primogem: 8 })

    // The bootstrap answers the same list.
    const boot = await client.json<BootstrapResponse>('/api/bootstrap')
    expect(boot.accounts.find((a) => a.id === accountId)!.latest).toEqual(latest)
  })

  it('follows deletes: a deleted capture stands in for nothing', async () => {
    const { client, accountId, importKey } = await setup()
    const first = await send(importKey, sampleGood(), 1_000)
    await send(importKey, without(sampleGood(), ['characters']), 2_000)
    expect((await latestOf(client, accountId)).sharedSummary!.characters).toBe(2)
    const gone = await client.fetch(`/api/accounts/${accountId}/snapshots/${first.snapshotId}`, {
      method: 'DELETE',
    })
    expect(gone.ok).toBe(true)
    // No capture left shared the characters: 0, as the pages show it.
    expect((await latestOf(client, accountId)).sharedSummary!.characters).toBe(0)
  })

  it('takes a capture imported later between them as the newer stand-in', async () => {
    const { client, accountId, importKey } = await setup()
    await send(importKey, sampleGood({ materials: { Mora: 1 } }), 1_000)
    await send(importKey, without(sampleGood(), ['materials']), 3_000)
    expect((await latestOf(client, accountId)).sharedSummary!.mora).toBe(1)
    await send(importKey, sampleGood({ materials: { Mora: 2 } }), 2_000)
    expect((await latestOf(client, accountId)).sharedSummary!.mora).toBe(2)
  })

  it('costs one round trip, and reads no more rows while everything is shared', async () => {
    const { client, importKey } = await setup()
    await send(importKey, sampleGood(), 1_000)
    const short = await rowsRead(client)
    for (let i = 2; i <= 6; i++) {
      await send(importKey, sampleGood({ materials: { Mora: i } }), i * 1_000)
    }
    const long = await rowsRead(client)
    expect(long).toEqual(short)
    expect(long.trips).toBe(1)

    // A section left out reads back to the capture that shared it, no further.
    for (let i = 7; i <= 9; i++) {
      await send(
        importKey,
        without(sampleGood({ materials: { Mora: i } }), ['characters']),
        i * 1_000,
      )
    }
    const off = await rowsRead(client)
    expect(off.trips).toBe(1)
    expect(off.rows).toBeGreaterThan(long.rows)
    expect(off.rows).toBeLessThanOrEqual(long.rows + 2 * 3)
  })
})
