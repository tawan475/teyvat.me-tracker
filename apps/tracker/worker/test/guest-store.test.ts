import { SELF } from 'cloudflare:test'
import {
  asLeyline,
  catalogFromRows,
  decodeBundle,
  decodeSnapshot,
  storedSnapshotOf,
  type AccountResponse,
  type CatalogRow,
  type Good,
  type ImportResponse,
  type SnapshotResponse,
  type WishHistoryResponse,
} from '@gdt/shared'
import { MATERIALS } from '@gdt/shared/dictionary/materials'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GUEST_ACCOUNT_ID, isGuestPath } from '@/local/guest-id'
import { ORIGIN, bigGood, irminsulForm, signUp, type Client } from './client'
import { loadGuestModules, type GuestStore } from './guest-modules'

// Guest mode (docs/plans/open-site.md §4): the guest account's API answered
// in the browser from its own store. These run the same captures through the
// Worker and through the guest store and expect the same answers.

const BASE = `/api/accounts/${GUEST_ACCOUNT_ID}`

const { memoryBackend, LocalStore, setGuestStore, localFetch } = await loadGuestModules()

let store: GuestStore
beforeEach(() => {
  store = new LocalStore(memoryBackend())
  setGuestStore(store)
})
afterEach(() => setGuestStore(null))

/** One request to the guest's API, as api/http.ts hands it over. */
async function local(
  rest: string,
  init: { method?: string; json?: unknown; body?: BodyInit } = {},
) {
  return localFetch(`${BASE}${rest}`, init)
}
async function localJson<T>(rest: string, init: Parameters<typeof local>[1] = {}): Promise<T> {
  const response = await local(rest, init)
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
  return (await response.json()) as T
}
const importLocal = (good: unknown, at: number) =>
  localJson<ImportResponse>(`/import?timestamp=${at}`, {
    method: 'POST',
    body: JSON.stringify(good),
  })

/** The same capture sequence storage-v2.test.ts runs: every section shape, out of order. */
function sequence(): [Good, number][] {
  const big = bigGood()
  const played = bigGood({
    artifacts: big.artifacts.map((a, i) => (i === 5 || i === 9 ? { ...a, lock: !a.lock } : a)),
    materials: { ...big.materials, Mora: 5, Crystalfly: 9 },
    gi_achievement_times: { ...big.gi_achievement_times, '84584': 1_791_189_294 },
  })
  const { '81001': _, ...fewer } = big.gi_achievement_times!
  const older = bigGood({
    artifacts: big.artifacts.slice(1),
    gi_achievement_times: { ...fewer, '81002': 1_700_000_001 },
  })
  const relogin = { ...played, gi_player: { ...played.gi_player!, resin: 1 } }
  const levelled = {
    ...relogin,
    artifacts: [
      ...relogin.artifacts.slice(0, 3),
      { ...relogin.artifacts[3]!, level: 16, substats: [{ key: 'critDMG_', value: 14.8 }] },
      ...relogin.artifacts.slice(4),
    ],
    materials: { ...relogin.materials, BrandNewMaterial: 2 },
    characters: relogin.characters.map((c) => ({ ...c, level: 90 })),
  }
  return [
    [big, 1_000],
    [played, 3_000],
    [older, 2_000],
    [relogin, 4_000],
    [levelled, 5_000],
  ]
}

async function serverAccount() {
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
  return { client, account, upload }
}

/** Every snapshot's GOOD as the browser decodes it from a GDT2 bundle, oldest first. */
function decodedFiles(bundle: ArrayBuffer, rows: CatalogRow[]) {
  return decodeBundle(bundle).then((decoded) => {
    const catalog = catalogFromRows(rows)
    return decoded.snapshots.map((s) =>
      JSON.stringify(
        asLeyline(
          decodeSnapshot(
            storedSnapshotOf(s, (key) => decoded.texts.get(key)!),
            catalog,
            MATERIALS,
          ),
        ),
      ),
    )
  })
}

async function serverExports(client: Client, id: number) {
  const base = `/api/accounts/${id}`
  const list = await client.json<SnapshotResponse[]>(`${base}/snapshots`)
  const rows = await client.json<CatalogRow[]>(`${base}/catalog`)
  const files = await decodedFiles(
    await (await client.fetch(`${base}/bundle?format=2`)).arrayBuffer(),
    rows,
  )
  const goods = []
  for (const { id: snapshot } of [...list].reverse()) {
    goods.push(await (await client.fetch(`${base}/snapshots/${snapshot}/good`)).text())
  }
  return { list, rows, files, goods }
}

async function localExports() {
  const list = await localJson<SnapshotResponse[]>('/snapshots')
  const rows = await localJson<CatalogRow[]>('/catalog')
  const files = await decodedFiles(await (await local('/bundle?format=2')).arrayBuffer(), rows)
  const goods = []
  for (const { id } of [...list].reverse()) {
    goods.push(await (await local(`/snapshots/${id}/good`)).text())
  }
  return { list, rows, files, goods }
}

describe('guest store', () => {
  it('tells the guest account paths apart by their text', () => {
    expect(isGuestPath(`${BASE}/snapshots`)).toBe(true)
    expect(isGuestPath(BASE)).toBe(true)
    expect(isGuestPath('/api/accounts/-12/snapshots')).toBe(false)
    expect(isGuestPath('/api/accounts/1/snapshots')).toBe(false)
  })

  it('stores, serves and decodes every capture as the server does', async () => {
    const { client, account, upload } = await serverAccount()
    for (const [good, at] of sequence()) {
      const [there, here] = [await upload(good, at), await importLocal(good, at)]
      expect(here.status).toBe(there.status)
      expect(here.storedSize).toBe(there.storedSize)
      expect(here.contentKey).toBe(there.contentKey)
    }
    const [there, here] = [await serverExports(client, account.id), await localExports()]
    const strip = (list: SnapshotResponse[]) =>
      list.map(({ id: _id, createdAt: _at, ...rest }) => rest)
    expect(strip(here.list)).toEqual(strip(there.list))
    expect(here.rows.map((r) => r.slice(1))).toEqual(there.rows.map((r) => r.slice(1)))
    expect(here.files).toEqual(there.files)
    expect(here.goods).toEqual(there.goods)
    expect(here.files).toEqual(here.goods)

    // The account as the list would show it, filled from the capture's player.
    const guest = await localJson<AccountResponse>('')
    expect(guest).toMatchObject({
      id: GUEST_ACCOUNT_ID,
      snapshotCount: 5,
      liveSync: false,
      access: 'owner',
      uid: String(sequence()[0]![0].gi_player!.uid),
    })
  })

  it('answers re-uploads, later sightings and clashes as the server does', async () => {
    const [[big, at], [played]] = sequence() as [[Good, number], [Good, number]]
    const first = await importLocal(big, at)
    expect(first.status).toBe('created')
    // The same capture again: nothing.
    expect(await importLocal(big, at)).toMatchObject({
      status: 'unchanged',
      snapshotId: first.snapshotId,
    })
    // The same inventory later: the snapshot's last sighting moves.
    expect(await importLocal(big, at + 500)).toMatchObject({ status: 'unchanged' })
    const [row] = await localJson<SnapshotResponse[]>('/snapshots')
    expect(row).toMatchObject({ takenAt: at, lastSeenAt: at + 500 })
    // Another inventory at a stored time: 409, nothing stored.
    const clash = await local(`/import?timestamp=${at}`, {
      method: 'POST',
      body: JSON.stringify(played),
    })
    expect(clash.status).toBe(409)
    expect(await clash.json()).toMatchObject({ error: { code: 'duplicate_capture' } })
    expect((await localJson<SnapshotResponse[]>('/snapshots')).length).toBe(1)
    // Not GOOD: the server's codes.
    const bad = await local('/import', { method: 'POST', body: '{nope' })
    expect(bad.status).toBe(400)
    expect(await bad.json()).toMatchObject({ error: { code: 'invalid_json' } })
  })

  it('deletes snapshots with the sections only they used, and compacts', async () => {
    for (const [good, at] of sequence()) await importLocal(good, at)
    const before = store.blobs.size
    const list = await localJson<SnapshotResponse[]>('/snapshots')
    const deleted = await localJson<{ deleted: number }>('/snapshots/delete', {
      method: 'POST',
      json: { ids: [list[0]!.id] },
    })
    expect(deleted.deleted).toBe(1)
    expect(store.blobs.size).toBeLessThan(before)
    // What is left still decodes whole.
    const left = await localExports()
    expect(left.files).toEqual(left.goods)
    expect(left.list.length).toBe(4)
    // One per day keeps the newest only (every capture is on 1970-01-01).
    const compact = await localJson<{ kept: number; removed: number }>('/snapshots/compact', {
      method: 'POST',
      json: { keep: 'day', offsetMinutes: 0 },
    })
    expect(compact).toMatchObject({ kept: 1, removed: 3 })
    const after = await localExports()
    expect(after.files).toEqual(after.goods)
    const gone = await local('/snapshots/999', { method: 'DELETE' })
    expect(gone.status).toBe(404)
  })

  it('keeps marks, the plan and settings as the server routes do', async () => {
    const [big, at] = sequence()[0]!
    await importLocal(big, at)
    expect(
      await localJson('/achievement-marks', { method: 'PATCH', json: { done: [84500, 84501] } }),
    ).toEqual({ done: [84500, 84501] })
    expect(
      await localJson('/achievement-marks', { method: 'PATCH', json: { undone: [84500] } }),
    ).toEqual({ done: [84501] })
    expect((await local('/anecdote-marks', { method: 'PATCH', json: { done: [5] } })).status).toBe(
      400,
    )

    // Settings: stored as patched, read over the defaults.
    const settings = await localJson<{ settings: { traveler: string } }>('/settings', {
      method: 'PATCH',
      json: { traveler: 'M' },
    })
    expect(settings.settings.traveler).toBe('M')
    expect(store.state.get('settings')).toEqual({ settings: { traveler: 'M' } })

    // Hand edits count against the newest capture's last sighting; a newer one is a 409.
    const state = await localJson<{ capturedAt: number }>('/planner-state')
    expect(state.capturedAt).toBe(at)
    const edited = await localJson<{ adjustments: { key: string; delta: number }[] }>(
      '/planner-state',
      { method: 'PATCH', json: { base: at, inventory: [{ key: 'Mora', add: 100 }] } },
    )
    expect(edited.adjustments).toMatchObject([{ key: 'Mora', delta: 100, base: at }])
    await importLocal(sequence()[1]![0], at + 1_000)
    const stale = await local('/planner-state', {
      method: 'PATCH',
      json: { base: at, inventory: [{ key: 'Mora', add: 1 }] },
    })
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ error: { code: 'capture_changed' } })
    // On the new capture the old edit is replaced.
    const fresh = await localJson<{ adjustments: { key: string; delta: number }[] }>(
      '/planner-state',
      { method: 'PATCH', json: { base: at + 1_000, inventory: [{ key: 'Crystalfly', add: 2 }] } },
    )
    expect(fresh.adjustments.map((a) => a.key)).toEqual(['Crystalfly'])

    // What only a server does: refused, nothing sent.
    const presence = await local('/presence')
    expect(presence.status).toBe(403)
    expect(await presence.json()).toMatchObject({ error: { code: 'guest_needs_account' } })
  })

  it('merges wish history like the server', async () => {
    const records = (from: number, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: String(1_790_000_000_000_000_000n + BigInt(from + i)),
        gacha_type: '301',
        time: `2026-01-01 00:${String(Math.floor((from + i) / 60)).padStart(2, '0')}:${String((from + i) % 60).padStart(2, '0')}`,
        name: 'Debate Club',
        item_type: 'Weapon',
        rank_type: '3',
      }))
    const first = await localJson<{ added: number; known: number }>('/wishes/import', {
      method: 'POST',
      json: { uid: '812345678', records: records(0, 600) },
    })
    expect(first).toMatchObject({ added: 600, known: 0 })
    const again = await localJson<{ added: number; known: number }>('/wishes/import', {
      method: 'POST',
      json: { uid: '812345678', records: records(590, 20) },
    })
    expect(again).toMatchObject({ added: 10, known: 10 })
    const history = await localJson<WishHistoryResponse>('/wishes')
    expect(history.chunks.length).toBe(2)
    expect(history.version).toBe(2)
    expect(await localJson('/wishes', { method: 'DELETE' })).toEqual({ deleted: 2 })
    expect((await localJson<WishHistoryResponse>('/wishes')).chunks).toEqual([])
  })

  it('re-reads what another tab wrote before writing', async () => {
    const backend = memoryBackend()
    const one = new LocalStore(backend)
    const two = new LocalStore(backend)
    await one.ready()
    await two.ready()
    await one.transact((tx) => tx.setState('a', 1))
    // The second tab still holds the old copy, until its next write reads the new one.
    await two.transact((tx) => {
      expect(two.state.get('a')).toBe(1)
      tx.setState('b', 2)
    })
    const three = await new LocalStore(backend).ready()
    expect([three.state.get('a'), three.state.get('b')]).toEqual([1, 2])
    // A write that fails leaves the store as stored.
    await expect(
      one.transact((tx) => {
        tx.setState('c', 3)
        throw new Error('no')
      }),
    ).rejects.toThrow('no')
    await one.ready()
    expect(one.state.has('c')).toBe(false)
  })
})
