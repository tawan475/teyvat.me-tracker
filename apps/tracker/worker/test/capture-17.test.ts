import { type AccountCreatedResponse, type Good, type ImportResponse } from '@gdt/shared'
import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { synthetic17, syntheticCollections } from '../../../../packages/shared/test/synthetic'
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

describe("Teyvat.me Capture 1.7.0's keys", () => {
  const new17 = synthetic17(12)
  const base = {
    gi_tasks: { welkin: { days: 30 } },
    gi_collections: syntheticCollections(12),
  }
  const full = {
    gi_tasks: { ...base.gi_tasks, ...new17.tasks },
    gi_collections: { ...base.gi_collections, ...new17.collections },
    gi_achievement_progress: new17.achievementProgress,
    gi_events: new17.events,
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
    // Respawns and events are not kept, monsters seen only as a count (dropped.ts).
    const { respawns: _respawns, ...tasks } = full.gi_tasks
    expect(exported.gi_tasks).toEqual(tasks)
    expect(exported.gi_collections!.hangouts).toEqual(new17.collections.hangouts)
    expect(exported.gi_collections!.blueprints).toEqual(new17.collections.blueprints)
    expect(exported.gi_collections!.monstersSeen).toBeUndefined()
    expect(exported.gi_collections!.monstersSeenCount).toBe(new17.collections.monstersSeen.length)
    expect(exported.gi_achievement_progress).toEqual(new17.achievementProgress)
    expect(exported.gi_events).toBeUndefined()
    expect(Object.keys(exported).at(-1)).toBe('gi_achievement_progress')
  })

  it('keeps re-uploading a capture a no-op when it was stored before 1.7.0', async () => {
    const { importKey } = await setup()
    const created = await send(importKey, sampleGood(base), 1_000)
    const again = await send(importKey, sampleGood(full), 1_000)
    expect(again).toMatchObject({ status: 'unchanged', snapshotId: created.snapshotId })
  })
})
