import { SELF } from 'cloudflare:test'
import {
  asLeyline,
  catalogFromRows,
  decodeBundle,
  BlobDecoder,
  decodeSnapshot,
  holdsPartKeys,
  kindCode,
  storedSnapshotOf,
  type AccountResponse,
  type AccountSettingsResponse,
  type CatalogRow,
  type Good,
  type ImportResponse,
  type PartsResponse,
  type RemovePartResponse,
  type SnapshotResponse,
  type WishHistoryResponse,
} from '@gdt/shared'
import { MATERIALS } from '@gdt/shared/dictionary/materials'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { synthetic18 } from '../../../../packages/shared/test/synthetic'
import { GUEST_ACCOUNT_ID, isGuestPath } from '@/local/guest-id'
import { ORIGIN, bigGood, irminsulForm, signUp, type Client } from './client'
import { loadGuestModules, type GuestFolderRecord, type GuestStore } from './guest-modules'

// Guest mode (docs/plans/open-site.md §4): the guest account's API answered
// in the browser from its own store. These run the same captures through the
// Worker and through the guest store and expect the same answers.

const BASE = `/api/accounts/${GUEST_ACCOUNT_ID}`

const guestModules = await loadGuestModules()
const { memoryBackend, LocalStore, setGuestStore, localFetch } = guestModules

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

  it("refuses a watched folder's file of another UID, where a hand import warns", async () => {
    const [[big, at], [played, later]] = sequence() as [[Good, number], [Good, number]]
    const upload = (good: Good, time: number, folder: boolean) =>
      guestModules.importLocal(store, {
        text: JSON.stringify(good),
        rawSize: 1,
        timestamp: time,
        folder,
      })
    expect(await upload(big, at, true)).toMatchObject({ status: 'created' })
    const other = { ...played, gi_player: { ...played.gi_player!, uid: 712345678 } }
    await expect(upload(other, later, true)).rejects.toMatchObject({
      code: 'guest_other_uid',
      uid: '712345678',
      own: String(big.gi_player!.uid),
    })
    expect((await localJson<SnapshotResponse[]>('/snapshots')).length).toBe(1)
    // By hand: stored, with the warning (as before).
    const byHand = await upload(other, later, false)
    expect(byHand.status).toBe('created')
    expect(byHand.warnings?.[0]?.code).toBe('uid_mismatch')
  })

  it("gives the guest a watched folder's wish file's UID, so a later file of another UID is refused", async () => {
    const [[big, at]] = sequence() as [[Good, number]]
    const wishUid = '712345678'
    expect(String(big.gi_player!.uid)).not.toBe(wishUid)
    const records = (uid: string) => ({
      uid,
      records: [
        {
          id: '1790000000000000001',
          gacha_type: '301',
          time: '2026-01-01 00:00:01',
          name: 'Debate Club',
          item_type: 'Weapon',
          rank_type: '3',
        },
      ],
      folder: true,
    })
    // The folder's oldest file is a wish file: its UID becomes the guest's.
    expect(await guestModules.importWishesLocal(store, records(wishUid))).toMatchObject({
      added: 1,
    })
    expect(await localJson<AccountResponse>('')).toMatchObject({ uid: wishUid })
    // A GOOD export of another UID from the same folder is refused.
    await expect(
      guestModules.importLocal(store, {
        text: JSON.stringify(big),
        rawSize: 1,
        timestamp: at,
        folder: true,
      }),
    ).rejects.toMatchObject({
      code: 'guest_other_uid',
      uid: String(big.gi_player!.uid),
      own: wishUid,
    })
    // So is another UID's wish file.
    await expect(
      guestModules.importWishesLocal(store, records(String(big.gi_player!.uid))),
    ).rejects.toMatchObject({ code: 'guest_other_uid', own: wishUid })
    expect((await localJson<SnapshotResponse[]>('/snapshots')).length).toBe(0)
    // By hand, a wish file of another UID still goes in (the hand import's rule).
    const byHand = { ...records(String(big.gi_player!.uid)), folder: false }
    expect(await guestModules.importWishesLocal(store, byHand)).toMatchObject({ known: 1 })
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

  it('removes a part from history as the server does (issue 12)', async () => {
    const { client, account, upload } = await serverAccount()
    const withParts = (good: Good, i: number): Good => ({
      ...good,
      gi_player: { ...good.gi_player!, nickname: 'player01', nameCard: 210_001 },
      gi_achievement_progress: { '84001': { progress: i, total: 9 } },
      gi_events: { '2001001': { schedule: 7, start: 1_790_000_000, end: 1_800_000_000 } },
      // The teapot, and the jar's realm currency stored with the Planner tasks.
      gi_teapot: synthetic18(31).teapot,
      gi_tasks: { ...good.gi_tasks, welkin: { days: 20 }, realm: { value: 300 + i, limit: 2400 } },
    })
    for (const [i, [good, at]] of sequence().entries()) {
      await upload(withParts(good, i), at)
      await importLocal(withParts(good, i), at)
    }
    const base = `/api/accounts/${account.id}`
    const strip = ({ guard: _g, live: _l, ...rest }: PartsResponse) => rest
    const there = await client.json<PartsResponse>(`${base}/parts`)
    const here = await localJson<PartsResponse>('/parts')
    expect(strip(here)).toEqual(strip(there))
    for (const part of ['achievements', 'profile', 'teapot'] as const) {
      const [serverCounts, localCounts] = [
        await client.json<PartsResponse>(`${base}/parts`),
        await localJson<PartsResponse>('/parts'),
      ]
      const removed = await client.json<RemovePartResponse>(`${base}/parts/remove`, {
        method: 'POST',
        json: { part, confirm: 'REMOVE', guard: serverCounts.guard },
      })
      const removedHere = await localJson<RemovePartResponse>('/parts/remove', {
        method: 'POST',
        json: { part, confirm: 'REMOVE', guard: localCounts.guard },
      })
      const { removedAt: _a, ...a } = removed
      const { removedAt: _b, ...b } = removedHere
      expect(b).toEqual(a)
      // A stale guard is refused with the server's code.
      const stale = await local('/parts/remove', {
        method: 'POST',
        json: { part, confirm: 'REMOVE', guard: '0:0' },
      })
      expect(stale.status).toBe(409)
      expect(await stale.json()).toMatchObject({ error: { code: 'capture_changed' } })
    }
    const [serverAfter, localAfter] = [
      await serverExports(client, account.id),
      await localExports(),
    ]
    expect(localAfter.goods).toEqual(serverAfter.goods)
    expect(localAfter.files).toEqual(localAfter.goods)
    for (const text of localAfter.goods) {
      const good = JSON.parse(text) as Good
      expect(good.gi_achievement_progress).toBeUndefined()
      expect(good.gi_events).toBeDefined()
      expect(good.gi_player?.nickname).toBeUndefined()
      // The teapot went with its realm currency; the other tasks stay.
      expect(good.gi_teapot).toBeUndefined()
      expect(good.gi_tasks?.realm).toBeUndefined()
      expect(good.gi_tasks?.welkin).toEqual({ days: 20 })
    }
    const { settings } = await localJson<AccountSettingsResponse>('/settings')
    expect(Object.keys(settings.parts.removed).sort()).toEqual([
      'achievements',
      'profile',
      'teapot',
    ])
    const hidden = await localJson<AccountSettingsResponse>('/parts/hide', {
      method: 'POST',
      json: { key: 'all' },
    })
    expect(hidden.settings.parts.hidden.all).toEqual(expect.any(Number))
    // A build section's note is hidden the same way (its page's strip).
    const section = await localJson<AccountSettingsResponse>('/parts/hide', {
      method: 'POST',
      json: { key: 'materials' },
    })
    expect(section.settings.parts.hidden.materials).toEqual(expect.any(Number))
    // The characters' extras (friendship, EXP) are no part of their own:
    // not counted, and refused like on the server.
    const counted = await localJson<PartsResponse>('/parts')
    expect(counted.parts).toHaveLength(11)
    const extras = { part: 'characterExtras', confirm: 'REMOVE', guard: counted.guard }
    const [refusedHere, refusedThere] = [
      await local('/parts/remove', { method: 'POST', json: extras }),
      await client.fetch(`${base}/parts/remove`, { method: 'POST', json: extras }),
    ]
    expect(refusedHere.status).toBe(400)
    expect(refusedHere.status).toBe(refusedThere.status)
    const noNote = await local('/parts/hide', { method: 'POST', json: { key: 'characterExtras' } })
    expect(noNote.status).toBe(400)
    for (const text of (await localExports()).goods) {
      expect((JSON.parse(text) as Good).gi_characters).toBeDefined()
    }
  })

  it('leaves no stored base holding a removed part, and stores the next capture anew', async () => {
    const { client, account, upload } = await serverAccount()
    const [big] = sequence()[0]!
    const full = (i: number): Good => ({
      ...big,
      gi_achievement_progress: Object.fromEntries(
        Array.from({ length: 200 }, (_, n) => [String(84_000 + n), { progress: n + i, total: 9 }]),
      ),
      gi_events: { '2001001': { schedule: 7, start: 1_790_000_000, end: 1_800_000_000 } },
    })
    const {
      gi_achievement_progress: _p,
      gi_achievements: _a,
      gi_achievement_times: _t,
      ...off
    } = full(3)
    const shots: [unknown, number][] = [
      [full(1), 1_000],
      [full(2), 2_000],
      [{ ...off, gi_off: ['gi_achievements'] }, 3_000],
    ]
    for (const [good, at] of shots) {
      await upload(good, at)
      await importLocal(good, at)
    }
    const counts = await localJson<PartsResponse>('/parts')
    const serverCounts = await client.json<PartsResponse>(`/api/accounts/${account.id}/parts`)
    const here = await localJson<RemovePartResponse>('/parts/remove', {
      method: 'POST',
      json: { part: 'achievements', confirm: 'REMOVE', guard: counts.guard },
    })
    const there = await client.json<RemovePartResponse>(
      `/api/accounts/${account.id}/parts/remove`,
      {
        method: 'POST',
        json: { part: 'achievements', confirm: 'REMOVE', guard: serverCounts.guard },
      },
    )
    const { removedAt: _x, ...a } = here
    const { removedAt: _y, ...b } = there
    expect(a).toEqual(b)
    const rows = [
      ...(
        store.blobs as Map<
          number,
          { id: number; code: number; baseId: number | null; data: Uint8Array }
        >
      ).values(),
    ]
    const progress = new Set([kindCode('progress', false), kindCode('progress', true)])
    const decoder = new BlobDecoder((id) => (store.blobs as Map<number, never>).get(id))
    const held = rows.filter((r) => progress.has(r.code))
    expect(held.length).toBeGreaterThan(0)
    for (const row of held) expect(holdsPartKeys(decoder.decode(row.id).value, ['a'])).toBe(false)
    // The newest capture again, with the part shared: stored anew, as on the server.
    const back = await importLocal(full(3), 4_000)
    expect(back.status).toBe('created')
    expect((await upload(full(3), 4_000)).status).toBe('created')
  })

  it("answers the account's figures from the captures that shared them, as the list does", async () => {
    const { client, account, upload } = await serverAccount()
    const [big] = sequence()[0]!
    const { characters: _c, gi_characters: _x, ...noRoster } = big
    const { materials: _m, ...noBag } = big
    const shots: [unknown, number][] = [
      [big, 1_000],
      [
        {
          ...noRoster,
          characters: [],
          materials: { ...big.materials, Mora: 77 },
          gi_off: ['characters'],
        },
        2_000,
      ],
      [{ ...noBag, characters: [], materials: {}, gi_off: ['characters', 'materials'] }, 3_000],
    ]
    for (const [good, at] of shots) {
      await upload(good, at)
      await importLocal(good, at)
    }
    const here = (await localJson<AccountResponse>('')).latest!
    const list = await client.json<AccountResponse[]>('/api/accounts')
    const there = list.find((a) => a.id === account.id)!.latest!
    expect(here.sharedSummary).toEqual(there.sharedSummary)
    expect(here.sharedSummary).toMatchObject({
      characters: big.characters.length,
      mora: 77,
    })
    expect(here.summary).toMatchObject({ characters: 0, mora: 0 })
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
    // A capture that left the bag out (Capture's gi_off) replaces none of them.
    const { materials: _m, ...noBag } = sequence()[1]![0]
    await importLocal({ ...noBag, gi_off: ['materials'] }, at + 2_000)
    const kept = await localJson<{ adjustments: { key: string }[] }>('/planner-state', {
      method: 'PATCH',
      json: { base: at + 2_000, bagBase: at + 1_000, inventory: [{ key: 'Mora', add: 3 }] },
    })
    expect(kept.adjustments.map((a) => a.key)).toEqual(['Crystalfly', 'Mora'])

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

describe('a watched folder read in one tab while another changes the guest store', () => {
  const { pickRecord, updateRecord, stillKept, loadRecord } = guestModules
  const TABLES = ['meta', 'blobs', 'snapshots', 'artifacts', 'state']
  const picked = (pickedAt: number) => (before: GuestFolderRecord | null) => ({
    v: 1 as const,
    handle: { kind: 'directory', name: 'captures' },
    name: 'captures',
    pickedAt,
    stopped: false,
    firstDone: false,
    seen: {},
    last: null,
    refused: [],
    rows: before?.rows ?? {},
  })
  const wishes = {
    uid: '812345678',
    records: [
      {
        id: '1790000000000000001',
        gacha_type: '301',
        time: '2026-01-01 00:00:01',
        name: 'Debate Club',
        item_type: 'Weapon',
        rank_type: '3',
      },
    ],
    folder: true,
  }

  /** Two tabs over the one stored copy: `reading` is mid-read of the folder picked at 1,000. */
  async function tabs() {
    const backend = memoryBackend()
    const reading = new LocalStore(backend)
    const other = new LocalStore(backend)
    const record = await pickRecord(picked(1_000), reading)
    const watched = stillKept(record.pickedAt, reading)
    const read = (good: Good, time: number) =>
      guestModules.importLocal(reading, {
        text: JSON.stringify(good),
        rawSize: 1,
        timestamp: time,
        folder: true,
        watched,
      })
    return { backend, reading, other, watched, read }
  }

  it('stores nothing more once the other tab deleted the guest data', async () => {
    const { backend, reading, other, watched, read } = await tabs()
    const [[big, at], [played, later]] = sequence() as [[Good, number], [Good, number]]
    const first = await read(big, at)
    expect(first.status).toBe('created')
    expect(
      await updateRecord((now) => ({ ...now, rows: { [first.snapshotId]: 'a.json' } }), reading),
    ).toMatchObject({ pickedAt: 1_000, rows: { [first.snapshotId]: 'a.json' } })

    // Settings, Delete guest data, in the other tab: the folder's record goes with it.
    await other.clear()
    // The reading tab's next files, and what it read so far, are not written back.
    await expect(read(played, later)).rejects.toMatchObject({ code: 'guest_folder_gone' })
    await expect(
      guestModules.importWishesLocal(reading, { ...wishes, watched }),
    ).rejects.toMatchObject({ code: 'guest_folder_gone' })
    expect(
      await updateRecord((now) => ({ ...now, firstDone: true, seen: { 'a.json': '1' } }), reading),
    ).toBeNull()
    for (const table of TABLES) expect(await backend.entries(table), table).toEqual([])
    await reading.ready()
    expect([reading.account, reading.snapshots.size, reading.state.size]).toEqual([null, 0, 0])
    // By hand (no folder), the emptied store takes a file as before.
    expect(
      await guestModules.importLocal(reading, {
        text: JSON.stringify(played),
        rawSize: 1,
        timestamp: later,
      }),
    ).toMatchObject({ status: 'created' })
  })

  it("stores nothing more of a folder once another was picked, and keeps the new one's record", async () => {
    const { reading, other, watched, read } = await tabs()
    const [[big, at], [played, later]] = sequence() as [[Good, number], [Good, number]]
    const first = await read(big, at)
    await updateRecord((now) => ({ ...now, rows: { [first.snapshotId]: 'a.json' } }), reading)
    // Change, in the other tab: the new folder's record carries the rows read so far.
    const changed = await pickRecord(picked(2_000), other)
    expect(changed.rows).toEqual({ [first.snapshotId]: 'a.json' })
    await expect(read(played, later)).rejects.toMatchObject({ code: 'guest_folder_gone' })
    expect(await watched()).toBe(false)
    expect(await stillKept(2_000, reading)()).toBe(true)
    // What the earlier read adds at its end goes onto the record as it is now,
    // with the store as it is now (the guest data it wrote into is still there).
    const saved = await updateRecord(
      (now, store) => ({ ...now, seen: { 'a.json': store.account ? 'kept' : 'deleted' } }),
      reading,
    )
    expect(saved).toMatchObject({ pickedAt: 2_000, seen: { 'a.json': 'kept' } })
    expect(await loadRecord(other)).toMatchObject({ pickedAt: 2_000, seen: { 'a.json': 'kept' } })
    await other.ready()
    expect(other.snapshots.size).toBe(1)
  })

  it('writes nothing for a change that changes nothing', async () => {
    const { backend, reading } = await tabs()
    const before = await backend.entries('meta')
    expect(await updateRecord((now) => now, reading)).toMatchObject({ pickedAt: 1_000 })
    expect(await backend.entries('meta')).toEqual(before)
  })
})
