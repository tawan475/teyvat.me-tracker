import {
  applyLiveBatch,
  offMask,
  type AccountCreatedResponse,
  type Good,
  type GoodDelta,
  type ImportResponse,
  type LiveChangesResponse,
  type LiveJournalResponse,
  type SnapshotResponse,
} from '@gdt/shared'
import { env, SELF } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GUEST_ACCOUNT_ID } from '@/local/guest-id'
import { readJournal, storeBatch } from '../services/live-sync'
import { ORIGIN, irminsulForm, sampleExtras, sampleGood, signUp, type Client } from './client'
import { loadGuestModules, type GuestStore } from './guest-modules'

// The bag copies (issue 12, 2026-11-19): Original Resin and Realm Currency are
// player properties Capture also writes into the materials bag. Its Account
// numbers switch covers the first, its Serenitea Pot switch the second: with
// the switch off the count is not shared. Capture leaves the key out; a build
// that still sends it is read as if it had, at import (the Worker and the
// guest store alike) and in the live journal's batches.

const UID = 812345678
const SESSION = '01J9ZK5Q8W3E7R2T'
const NUMBERS = 'gi_player.numbers'
const TEAPOT = 'gi_teapot'
const BAG = { Mora: 1_000_000, Primogem: 16_000, OriginalResin: 160, RealmCurrency: 900 }

/**
 * A capture as a Capture build that still sends the copies writes it. No
 * artifacts: their catalog ids are part of a content key, and the server's
 * count on across accounts where a guest's start at 1.
 */
function capture(off: string[] | undefined, materials: Record<string, number> = BAG): Good {
  return {
    ...sampleGood({ ...sampleExtras(UID), materials, artifacts: [] }),
    gi_capture: { v: 1, reason: 'login', session: SESSION, world: 1, journal: { seq: 0 } },
    ...(off ? { gi_off: off } : {}),
  } as Good
}

async function setup() {
  const { client, me } = await signUp()
  const { account, importKey } = await client.json<AccountCreatedResponse>('/api/accounts', {
    method: 'POST',
    json: { name: 'Main', uid: String(UID), server: 'ASIA' },
  })
  const upload = async (good: unknown, at: number) => {
    const response = await SELF.fetch(`${ORIGIN}/api/genshin-accounts-public/import-by-key`, {
      method: 'POST',
      headers: { 'x-import-key': importKey },
      body: irminsulForm(good, at),
    })
    expect(response.status, await response.clone().text()).toBeLessThan(300)
    return (await response.json()) as ImportResponse
  }
  return { client, userId: me.id, account, importKey, upload }
}

/** A stored snapshot's materials, as its GOOD export lists them. */
async function storedBag(client: Client, accountId: number, snapshotId: number) {
  const good = await client.json<Good>(`/api/accounts/${accountId}/snapshots/${snapshotId}/good`)
  return good.materials
}

describe('the bag copies at import', () => {
  it('drops the count of a part that is off before anything is stored', async () => {
    const { client, account, upload } = await setup()
    const numbersOff = await upload(capture([NUMBERS]), 1_000)
    expect(numbersOff.status).toBe('created')
    expect(await storedBag(client, account.id, numbersOff.snapshotId)).toEqual({
      Mora: BAG.Mora,
      Primogem: BAG.Primogem,
      RealmCurrency: BAG.RealmCurrency,
    })

    const teapotOff = await upload(capture([TEAPOT]), 2_000)
    expect(await storedBag(client, account.id, teapotOff.snapshotId)).toEqual({
      Mora: BAG.Mora,
      Primogem: BAG.Primogem,
      OriginalResin: BAG.OriginalResin,
    })

    const bothOff = await upload(capture([TEAPOT, NUMBERS]), 3_000)
    expect(await storedBag(client, account.id, bothOff.snapshotId)).toEqual({
      Mora: BAG.Mora,
      Primogem: BAG.Primogem,
    })

    // The figures count what was stored.
    const list = await client.json<SnapshotResponse[]>(`/api/accounts/${account.id}/snapshots`)
    expect(list.map((s) => [s.off, s.summary.materials])).toEqual([
      [[TEAPOT, NUMBERS], 2],
      [[TEAPOT], 3],
      [[NUMBERS], 3],
    ])
  })

  it('leaves a file alone whose gi_off shares the part, or that has none', async () => {
    const { client, account, upload } = await setup()
    const shared = await upload(capture([]), 1_000)
    expect(await storedBag(client, account.id, shared.snapshotId)).toEqual(BAG)
    const others = await upload(capture(['gi_tasks', 'gi_player.profile']), 2_000)
    expect(await storedBag(client, account.id, others.snapshotId)).toEqual(BAG)
    // No gi_off (an older Capture, another tool): the same content as the first.
    const none = await upload(capture(undefined), 3_000)
    expect(await storedBag(client, account.id, none.snapshotId)).toEqual(BAG)
    expect(none.contentKey).toBe(shared.contentKey)
  })

  it('a build that leaves the copy out itself uploads the same snapshot', async () => {
    const { upload } = await setup()
    const { OriginalResin: _resin, ...withoutResin } = BAG
    const sent = await upload(capture([NUMBERS]), 1_000)
    // Capture's fixed build: the key is not in the file at all.
    const left = await upload(capture([NUMBERS], withoutResin), 1_000)
    expect(left).toMatchObject({
      status: 'unchanged',
      snapshotId: sent.snapshotId,
      contentKey: sent.contentKey,
    })
  })
})

describe('the bag copies in the guest store', () => {
  const guestModules = loadGuestModules()
  let store: GuestStore
  beforeEach(async () => {
    const { LocalStore, memoryBackend, setGuestStore } = await guestModules
    store = new LocalStore(memoryBackend())
    setGuestStore(store)
  })
  afterEach(async () => (await guestModules).setGuestStore(null))

  async function local<T>(rest: string, init: { method?: string; body?: BodyInit } = {}) {
    const { localFetch } = await guestModules
    const response = await localFetch(`/api/accounts/${GUEST_ACCOUNT_ID}${rest}`, init)
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
    return (await response.json()) as T
  }
  const importLocal = (good: unknown, at: number) =>
    local<ImportResponse>(`/import?timestamp=${at}`, { method: 'POST', body: JSON.stringify(good) })

  it('stores each capture as the server does', async () => {
    const { client, account, upload } = await setup()
    const { RealmCurrency: _realm, ...withoutRealm } = BAG
    const shots: [Good, number][] = [
      [capture(undefined), 1_000],
      [capture([NUMBERS]), 2_000],
      [capture([NUMBERS, TEAPOT]), 3_000],
      [capture([TEAPOT]), 4_000],
      // The same capture from a build that leaves the copy out: nothing new.
      [capture([TEAPOT], withoutRealm), 4_000],
      [capture([]), 5_000],
    ]
    for (const [good, at] of shots) {
      const [there, here] = [await upload(good, at), await importLocal(good, at)]
      expect(here.status).toBe(there.status)
      expect(here.contentKey).toBe(there.contentKey)
      expect(here.storedSize).toBe(there.storedSize)
      expect((await local<Good>(`/snapshots/${here.snapshotId}/good`)).materials).toEqual(
        await storedBag(client, account.id, there.snapshotId),
      )
    }
    const here = await local<SnapshotResponse[]>('/snapshots')
    const there = await client.json<SnapshotResponse[]>(`/api/accounts/${account.id}/snapshots`)
    const figures = (list: SnapshotResponse[]) => list.map((s) => [s.off, s.summary.materials])
    expect(figures(here)).toEqual(figures(there))
    expect(figures(here)).toEqual([
      [[], 4],
      [[TEAPOT], 3],
      [[NUMBERS, TEAPOT], 2],
      [[NUMBERS], 3],
      [undefined, 4],
    ])
  })
})

describe('the bag copies in live batches', () => {
  function delta(base: string, seq: number, changes: GoodDelta['changes']): GoodDelta {
    return {
      format: 'GOOD-X-delta',
      v: 1,
      uid: UID,
      session: SESSION,
      seq,
      base,
      at: 1_792_000_000_000 + seq,
      changes,
    }
  }
  async function send(key: string, body: GoodDelta): Promise<LiveChangesResponse> {
    const response = await SELF.fetch(`${ORIGIN}/api/irminsul/changes`, {
      method: 'POST',
      headers: { 'x-import-key': key, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    expect(response.status, await response.clone().text()).toBe(200)
    return (await response.json()) as LiveChangesResponse
  }
  const baseOff = (accountId: number) =>
    env.LIVE_DB.prepare('SELECT base_off FROM live_journals WHERE account_id = ?1')
      .bind(accountId)
      .first<{ base_off: number }>()
      .then((row) => row?.base_off)
  const MORA: GoodDelta['changes'][number] = ['set', ['materials', 'Mora'], 7]
  const RESIN: GoodDelta['changes'][number] = ['set', ['materials', 'OriginalResin'], 120]
  const REALM: GoodDelta['changes'][number] = ['set', ['materials', 'RealmCurrency'], 950]

  it('a change to a count the base snapshot left out is not stored', async () => {
    const { client, account, importKey, upload } = await setup()
    const answer = await upload(capture([NUMBERS]), 1_000)
    const base = answer.live!.base
    expect(await baseOff(account.id)).toBe(offMask([NUMBERS]))

    expect(await send(importKey, delta(base, 1, [MORA, RESIN, REALM]))).toMatchObject({
      ok: true,
      seq: 1,
    })
    const journal = await client.json<LiveJournalResponse>(`/api/accounts/${account.id}/live`)
    expect(journal.seq).toBe(1)
    expect(journal.changes).toEqual([MORA, REALM])

    // Deleting the key is a change to it too; a batch of nothing else still moves the seq.
    await send(importKey, delta(base, 2, [['del', ['materials', 'OriginalResin']]]))
    const after = await client.json<LiveJournalResponse>(`/api/accounts/${account.id}/live`)
    expect(after.seq).toBe(2)
    expect(after.changes).toEqual([MORA, REALM])
  })

  it('pushes what it stored: the batch applied in a tab gives what a read answers', async () => {
    const { userId, account, upload } = await setup()
    const base = (await upload(capture([NUMBERS, TEAPOT]), 1_000)).live!.base
    expect(await baseOff(account.id)).toBe(offMask([NUMBERS, TEAPOT]))
    const owner = { id: account.id, userId }
    let journal = (await readJournal(env.LIVE_DB, account.id)).response
    const steps: GoodDelta['changes'][] = [[RESIN, MORA], [REALM], [REALM, RESIN], [MORA]]
    for (const [i, changes] of steps.entries()) {
      const stored = await storeBatch(env.LIVE_DB, owner, delta(base, i + 1, changes))
      expect(stored.batch!.changes).toEqual(changes.filter((change) => change === MORA))
      const read = (await readJournal(env.LIVE_DB, account.id)).response
      expect(applyLiveBatch(journal, stored.seq, stored.batch!)).toEqual(read)
      journal = read
    }
    expect(journal.changes).toEqual([MORA])
    // Stored bytes hold nothing of the two counts: only the one Mora change is there.
    const row = await env.LIVE_DB.prepare(
      'SELECT tail_changes, changes FROM live_journals WHERE account_id = ?1',
    )
      .bind(account.id)
      .first<{ tail_changes: number; changes: number }>()
    expect(row).toEqual({ tail_changes: 1, changes: 1 })
  })

  it('keeps them while the part is shared, and follows the next snapshot', async () => {
    const { client, account, importKey, upload } = await setup()
    // No gi_off at all (an older Capture): everything is kept.
    let base = (await upload(capture(undefined), 1_000)).live!.base
    expect(await baseOff(account.id)).toBe(0)
    await send(importKey, delta(base, 1, [MORA, RESIN, REALM]))
    let journal = await client.json<LiveJournalResponse>(`/api/accounts/${account.id}/live`)
    expect(journal.changes).toEqual([MORA, RESIN, REALM])

    // The switch goes off: Capture's resync snapshot opens a journal that drops it.
    base = (await upload(capture([TEAPOT]), 2_000)).live!.base
    expect(await baseOff(account.id)).toBe(offMask([TEAPOT]))
    await send(importKey, delta(base, 1, [MORA, RESIN, REALM]))
    journal = await client.json<LiveJournalResponse>(`/api/accounts/${account.id}/live`)
    expect(journal.changes).toEqual([MORA, RESIN])

    // And on again ([]: everything shared).
    base = (await upload(capture([]), 3_000)).live!.base
    expect(await baseOff(account.id)).toBe(0)
    await send(importKey, delta(base, 1, [REALM]))
    journal = await client.json<LiveJournalResponse>(`/api/accounts/${account.id}/live`)
    expect(journal.changes).toEqual([REALM])
  })
})
