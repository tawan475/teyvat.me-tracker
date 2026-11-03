import {
  decodeBundle,
  decodeExtras,
  type AccountCreatedResponse,
  type ExtrasSection,
  type Good,
  type ImportResponse,
} from '@gdt/shared'
import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { synthetic18, syntheticEndgame } from '../../../../packages/shared/test/synthetic'
import { ORIGIN, irminsulForm, sampleGood, signUp } from './client'

function importByKey(key: string, good: unknown, timestamp?: number) {
  return SELF.fetch(`${ORIGIN}/api/genshin-accounts-public/import-by-key`, {
    method: 'POST',
    headers: { 'x-import-key': key },
    body: irminsulForm(good, timestamp),
  })
}

async function setup() {
  const { client } = await signUp()
  const { account, importKey } = await client.json<AccountCreatedResponse>('/api/accounts', {
    method: 'POST',
    json: { name: 'Alt', uid: '812345678', server: 'ASIA' },
  })
  return { client, account, importKey }
}

const send = async (key: string, good: unknown, at: number) =>
  (await (await importByKey(key, good, at)).json()) as ImportResponse

describe("Teyvat.me Capture 1.17.12's gi_endgame", () => {
  const endgame = syntheticEndgame(21)
  const new18 = synthetic18(21)
  const base = { gi_teapot: new18.teapot, gi_miliastra: new18.miliastra }
  const full = { ...base, gi_endgame: endgame }

  it('stores it, a relogin with nothing new stores 0 bytes, and exports it', async () => {
    const { client, account, importKey } = await setup()
    const first = await send(importKey, sampleGood(full), 1_000)
    expect(first.status).toBe('created')
    const again = await send(importKey, sampleGood(full), 2_000)
    expect(again).toMatchObject({ status: 'unchanged', storedSize: 0 })
    const exported = await client.json<Good>(
      `/api/accounts/${account.id}/snapshots/${first.snapshotId}/good`,
    )
    expect(exported.gi_endgame).toEqual(endgame)
    expect(exported.gi_teapot).toEqual(new18.teapot)
    // The bundle the app reads carries the extras section of that snapshot.
    const { snapshots, texts } = await decodeBundle(
      await (
        await client.fetch(`/api/accounts/${account.id}/bundle?sections=extras&format=2`)
      ).arrayBuffer(),
    )
    expect(snapshots).toHaveLength(1)
    const extras = texts.get(snapshots[0]!.extras!)
    expect(extras).toBeDefined()
    expect(decodeExtras(JSON.parse(extras!) as ExtrasSection).endgame).toEqual(endgame)
  })

  it('stores a changed Theater run as a new snapshot, the records alone too', async () => {
    const { client, account, importKey } = await setup()
    const first = await send(importKey, sampleGood({ gi_endgame: endgame }), 1_000)
    expect(first.status).toBe('created')
    const cleared = {
      gi_endgame: { ...endgame, theater: { ...endgame.theater, acts: 10 } },
    }
    const second = await send(importKey, sampleGood(cleared), 2_000)
    expect(second.status).toBe('created')
    expect(second.storedSize).toBeGreaterThan(0)
    const exported = await client.json<Good>(
      `/api/accounts/${account.id}/snapshots/${second.snapshotId}/good`,
    )
    expect(exported.gi_endgame!.theater!.acts).toBe(10)
    expect(exported.gi_endgame!.stygian).toEqual(endgame.stygian)
  })

  it('keeps re-uploading a capture a no-op when it was stored before 1.17.12', async () => {
    const { importKey } = await setup()
    const created = await send(importKey, sampleGood(base), 1_000)
    const again = await send(importKey, sampleGood(full), 1_000)
    expect(again).toMatchObject({ status: 'unchanged', snapshotId: created.snapshotId })
    // Also when the endgame alone would make the extras section.
    const bare = await send(importKey, sampleGood(), 3_000)
    const withEndgame = await send(importKey, sampleGood({ gi_endgame: endgame }), 3_000)
    expect(withEndgame).toMatchObject({ status: 'unchanged', snapshotId: bare.snapshotId })
  })
})
