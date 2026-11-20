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
    // gi_off [] (everything shared) names nothing: no `off` in the list.
    expect('off' in latest).toBe(false)
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
    // What it left out, by name (the public API's `off`).
    expect(latest.off).toEqual(['characters'])

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

  it('answers the switches of the capture the bag is read from (bagOff), in the same statement', async () => {
    // 2026-11-20: a bag count is not shared now when the newest capture's
    // switches cover it, or those of the capture its bag is read from do.
    const NUMBERS = 'gi_player.numbers'
    const { client, accountId, importKey } = await setup()
    await send(importKey, sampleGood(), 1_000)
    const second = await send(
      importKey,
      { ...sampleGood({ materials: { Mora: 5 } }), gi_off: [NUMBERS] },
      2_000,
    )
    // The newest capture shares its Materials: its bag is its own, no bagOff.
    let latest = await latestOf(client, accountId)
    expect(latest.off).toEqual([NUMBERS])
    expect('bagOff' in latest).toBe(false)

    // Materials off, Account numbers on: the bag is the second capture's.
    await send(importKey, without(sampleGood(), ['materials']), 3_000)
    latest = await latestOf(client, accountId)
    expect(latest.off).toEqual(['materials'])
    expect(latest.bagOff).toEqual([NUMBERS])
    expect(latest.sharedSummary).toMatchObject({ mora: 5 })
    // One round trip still, for the list and for the bootstrap.
    expect((await rowsRead(client)).trips).toBe(1)
    const boot = await client.json<BootstrapResponse>('/api/bootstrap')
    expect(boot.accounts.find((a) => a.id === accountId)!.latest).toEqual(latest)
    const one = await client.json<AccountResponse>(`/api/accounts/${accountId}`)
    expect(one.latest).toEqual(latest)

    // A newer capture without Materials: still the newest one that shared them.
    await send(
      importKey,
      { ...without(sampleGood(), ['materials']), gi_off: ['materials', 'gi_teapot'] },
      4_000,
    )
    latest = await latestOf(client, accountId)
    expect(latest.off).toEqual(['materials', 'gi_teapot'])
    expect(latest.bagOff).toEqual([NUMBERS])

    // That capture deleted: the bag is the first one's, stored without a gi_off.
    const gone = await client.fetch(`/api/accounts/${accountId}/snapshots/${second.snapshotId}`, {
      method: 'DELETE',
    })
    expect(gone.ok).toBe(true)
    latest = await latestOf(client, accountId)
    expect(latest.off).toEqual(['materials', 'gi_teapot'])
    expect('bagOff' in latest).toBe(false)

    // A capture that shares the Materials again: nothing to add.
    await send(importKey, { ...sampleGood(), gi_off: ['gi_teapot'] }, 5_000)
    latest = await latestOf(client, accountId)
    expect(latest.off).toEqual(['gi_teapot'])
    expect('bagOff' in latest).toBe(false)
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
