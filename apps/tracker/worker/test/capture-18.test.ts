import { type AccountCreatedResponse, type Good, type ImportResponse } from '@gdt/shared'
import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import {
  synthetic17,
  synthetic18,
  syntheticCollections,
  syntheticExploration,
} from '../../../../packages/shared/test/synthetic'
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

describe("Teyvat.me Capture 1.8.0-1.11.0's keys", () => {
  const new18 = synthetic18(14)
  const collections = { ...syntheticCollections(14), ...synthetic17(14).collections }
  const base = {
    gi_tasks: { welkin: { days: 30 } },
    gi_collections: collections,
    gi_exploration: syntheticExploration(14),
  }
  const full = {
    gi_tasks: { ...base.gi_tasks, ...new18.tasks },
    gi_collections: {
      ...collections,
      ...new18.collections,
      tcg: { ...collections.tcg!, ...new18.tcg },
    },
    gi_exploration: { ...base.gi_exploration, ...new18.exploration },
    gi_teapot: new18.teapot,
    gi_miliastra: new18.miliastra,
  }

  it('stores them, a relogin with nothing new stores 0 bytes, and exports them', async () => {
    const { client, account, importKey } = await setup()
    const first = await send(importKey, sampleGood(full), 1_000)
    expect(first.status).toBe('created')
    const again = await send(importKey, sampleGood(full), 2_000)
    expect(again).toMatchObject({ status: 'unchanged', storedSize: 0 })
    const exported = await client.json<Good>(
      `/api/accounts/${account.id}/snapshots/${first.snapshotId}/good`,
    )
    expect(exported.gi_collections!.tcg).toEqual(full.gi_collections.tcg)
    expect(exported.gi_collections!.crafting).toEqual(new18.collections.crafting)
    expect(exported.gi_tasks!.signIns).toEqual(new18.tasks.signIns)
    expect(exported.gi_exploration!.tribalChapters).toEqual(new18.exploration.tribalChapters)
    expect(exported.gi_teapot).toEqual(new18.teapot)
    // Miliastra cosmetics are not kept (dropped.ts).
    expect(exported.gi_miliastra).toBeUndefined()
  })

  it('keeps re-uploading a capture a no-op when it was stored before 1.8.0', async () => {
    const { importKey } = await setup()
    const created = await send(importKey, sampleGood(base), 1_000)
    const again = await send(importKey, sampleGood(full), 1_000)
    expect(again).toMatchObject({ status: 'unchanged', snapshotId: created.snapshotId })
  })
})
