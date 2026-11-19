import { SELF } from 'cloudflare:test'
import {
  catalogFromRows,
  decodeBundle,
  type AccountResponse,
  type CatalogRow,
  type Good,
  type ImportResponse,
  type SnapshotResponse,
} from '@gdt/shared'
import { MATERIALS } from '@gdt/shared/dictionary/materials'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { decodeFromSections } from '@/data/export-zip'
import { rawExportFiles, type RawCatalog } from '@/data/raw-export'
import { inflateAll } from '@/data/raw-export/inflate'
import { GUEST_ACCOUNT_ID } from '@/local/guest-id'
import { ORIGIN, bigGood, irminsulForm, signUp, type Client } from './client'
import { loadGuestModules, type GuestStore } from './guest-modules'

// Exports write `gi_off` back (issue 12, the user's answer of 2026-11-19):
// a capture that left a part out is exported with the list it was stored
// with, so the file imports as the same snapshot. Before, the file had none:
// one without its roster was refused as a capture taken halfway through a
// login, and one without its bag was stored as an empty bag. The Worker's
// GOOD route, the browser's zip (decoded from the bundle), the raw download's
// script and the guest store must all write the same file, and a capture that
// shared everything must export as it always did.

const GUEST = `/api/accounts/${GUEST_ACCOUNT_ID}`
const { memoryBackend, LocalStore, setGuestStore, localFetch } = await loadGuestModules()

let store: GuestStore
beforeEach(() => {
  store = new LocalStore(memoryBackend())
  setGuestStore(store)
})
afterEach(() => setGuestStore(null))

async function guest(rest: string, init: { method?: string; body?: BodyInit } = {}) {
  const response = await localFetch(`${GUEST}${rest}`, init)
  if (!response.ok) throw new Error(`${rest}: ${response.status} ${await response.text()}`)
  return response
}
const guestJson = async <T>(rest: string, init: { method?: string; body?: BodyInit } = {}) =>
  (await (await guest(rest, init)).json()) as T
const guestImport = (text: string, at?: number) =>
  guestJson<ImportResponse>(`/import${at === undefined ? '' : `?timestamp=${at}`}`, {
    method: 'POST',
    body: text,
  })

async function serverAccount(client: Client) {
  const { account, importKey } = await client.json<{
    account: AccountResponse
    importKey: string
  }>('/api/accounts', { method: 'POST', json: { name: 'Main' } })
  const base = `/api/accounts/${account.id}`
  /** As Capture uploads. */
  const capture = async (good: unknown, at: number) => {
    const response = await SELF.fetch(`${ORIGIN}/api/genshin-accounts-public/import-by-key`, {
      method: 'POST',
      headers: { 'x-import-key': importKey },
      body: irminsulForm(good, at),
    })
    expect(response.ok).toBe(true)
    return (await response.json()) as ImportResponse
  }
  /** As the website's Import takes a file (the capture time is the file's own). */
  const file = async (text: string) => {
    const response = await client.fetch(`${base}/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: text,
    })
    return { status: response.status, body: (await response.json()) as ImportResponse }
  }
  const good = async (snapshotId: number) =>
    (await client.fetch(`${base}/snapshots/${snapshotId}/good`)).text()
  const list = () => client.json<SnapshotResponse[]>(`${base}/snapshots`)
  /** Every snapshot as the export worker decodes it for the zip, by id. */
  const zipFiles = async () =>
    browserFiles(
      await (await client.fetch(`${base}/bundle?format=3`)).arrayBuffer(),
      await client.json<CatalogRow[]>(`${base}/catalog`),
    )
  /** Every snapshot as the raw download's script writes it, by capture time. */
  const rawFiles = async () => {
    const files = rawExportFiles({
      bundle: new Uint8Array(await (await client.fetch(`${base}/bundle?format=3`)).arrayBuffer()),
      catalog: await client.json<RawCatalog>(`${base}/catalog?raw=1`),
      ids: null,
    })
    const read = new Map(files.map((f) => [f.name, f.data]))
    const written: unknown[] = []
    await inflateAll({
      read: (path) => read.get(path)!,
      write: (path, bytes) => {
        if (path.startsWith('inflated/snapshots/'))
          written.push(JSON.parse(new TextDecoder().decode(bytes)))
      },
    })
    return new Map((written as Good[]).map((good) => [good.timestamp!, good]))
  }
  return { account, base, capture, file, good, list, zipFiles, rawFiles }
}

/** src/workers/export.worker.ts's decode, per snapshot id; and the manifest's entries. */
async function browserFiles(bundle: ArrayBuffer, rows: CatalogRow[]) {
  const decoded = await decodeBundle(bundle)
  const catalog = catalogFromRows(rows)
  return {
    manifest: decoded.snapshots,
    texts: new Map(
      decoded.snapshots.map((snapshot) => [
        snapshot.id,
        JSON.stringify(decodeFromSections(snapshot, decoded.texts, catalog, MATERIALS)),
      ]),
    ),
  }
}
const guestZipFiles = async () =>
  browserFiles(
    await (await guest('/bundle?format=3')).arrayBuffer(),
    await guestJson<CatalogRow[]>('/catalog'),
  )

/**
 * What a list row says of a capture, without what differs between two stores
 * of it (its id, when and from how many bytes it was stored, and the bytes it
 * took: a copy has no earlier capture to be stored against).
 */
const told = ({
  id: _id,
  createdAt: _at,
  rawSize: _raw,
  storedSize: _stored,
  ...rest
}: SnapshotResponse) => rest

const big = bigGood()
const { characters: _c, gi_characters: _x, ...noRoster } = big
const { materials: _m, ...noBag } = big
/** As Capture sends them: the key of a part that is off is left out. */
const CAPTURES: [string, string[], object][] = [
  ['its characters', ['characters'], { ...noRoster, gi_off: ['characters'] }],
  ['its materials', ['materials'], { ...noBag, gi_off: ['materials'] }],
]

describe('exports write gi_off back', () => {
  it.each(CAPTURES)(
    'the Worker: a capture that left %s out exports as a file that imports as the same snapshot',
    async (_name, off, capture) => {
      const { client } = await signUp()
      const first = await serverAccount(client)
      await first.capture(big, 1_000)
      const stored = await first.capture(capture, 2_000)
      expect(stored.status).toBe('created')

      const file = await first.good(stored.snapshotId)
      const parsed = JSON.parse(file) as Good
      expect(parsed.gi_off).toEqual(off)
      // Last, where Capture writes it.
      expect(Object.keys(parsed).at(-1)).toBe('gi_off')

      // The zip (decoded in the browser from the bundle) and the raw
      // download's script write that same file.
      const zip = await first.zipFiles()
      expect(zip.texts.get(stored.snapshotId)).toBe(file)
      expect(zip.manifest.find((s) => s.id === stored.snapshotId)!.off).toEqual(off)
      expect((await first.rawFiles()).get(2_000)).toEqual(parsed)

      // Imported again where it came from: the same capture, nothing stored.
      const before = await first.list()
      const again = await first.file(file)
      expect(again.status).toBe(200)
      expect(again.body).toMatchObject({ status: 'unchanged', snapshotId: stored.snapshotId })
      expect(await first.list()).toEqual(before)

      // Imported into another account: the same snapshot.
      const second = await serverAccount(client)
      const copy = await second.file(file)
      expect(copy.status).toBe(201)
      const [there] = await second.list()
      const here = before.find((s) => s.id === stored.snapshotId)!
      expect(there!.off).toEqual(off)
      expect(told(there!)).toEqual(told(here))
      expect(await second.good(copy.body.snapshotId)).toBe(file)
      expect((await second.file(file)).body.status).toBe('unchanged')
    },
  )

  it.each(CAPTURES)(
    'guest mode: a capture that left %s out exports the file the Worker writes, and takes it back',
    async (_name, off, capture) => {
      const { client } = await signUp()
      const server = await serverAccount(client)
      await server.capture(big, 1_000)
      const there = await server.capture(capture, 2_000)
      await guestImport(JSON.stringify(big), 1_000)
      const here = await guestImport(JSON.stringify(capture), 2_000)

      const file = await (await guest(`/snapshots/${here.snapshotId}/good`)).text()
      expect(file).toBe(await server.good(there.snapshotId))
      expect((JSON.parse(file) as Good).gi_off).toEqual(off)
      const zip = await guestZipFiles()
      expect(zip.texts.get(here.snapshotId)).toBe(file)
      expect(zip.manifest.find((s) => s.id === here.snapshotId)!.off).toEqual(off)

      // Back into the same store: nothing new.
      const before = await guestJson<SnapshotResponse[]>('/snapshots')
      expect(await guestImport(file)).toMatchObject({
        status: 'unchanged',
        snapshotId: here.snapshotId,
      })
      expect(await guestJson<SnapshotResponse[]>('/snapshots')).toEqual(before)

      // Into an empty guest store, and into an account: the same snapshot.
      const fresh = new LocalStore(memoryBackend())
      setGuestStore(fresh)
      const copy = await guestImport(file)
      expect(copy.status).toBe('created')
      const [row] = await guestJson<SnapshotResponse[]>('/snapshots')
      const original = before.find((s) => s.id === here.snapshotId)!
      expect(row!.off).toEqual(off)
      expect(told(row!)).toEqual(told(original))
      expect(await (await guest(`/snapshots/${copy.snapshotId}/good`)).text()).toBe(file)
      expect((await guestImport(file)).status).toBe('unchanged')

      const account = await serverAccount(client)
      const sent = await account.file(file)
      expect(sent.status).toBe(201)
      expect((await account.list())[0]!.off).toEqual(off)
      expect(await account.good(sent.body.snapshotId)).toBe(file)
    },
  )

  it('a capture that shared everything exports as before, with an empty gi_off or none', async () => {
    const { client } = await signUp()
    const plain = await serverAccount(client)
    const listed = await serverAccount(client)
    const a = await plain.capture(big, 1_000)
    const b = await listed.capture({ ...big, gi_off: [] }, 1_000)
    expect((await listed.list())[0]!.off).toEqual([])

    const file = await plain.good(a.snapshotId)
    expect(Object.keys(JSON.parse(file) as object)).not.toContain('gi_off')
    // The same bytes whether the upload said "nothing is off" or said nothing.
    expect(await listed.good(b.snapshotId)).toBe(file)
    for (const [account, id] of [
      [plain, a.snapshotId],
      [listed, b.snapshotId],
    ] as const) {
      const zip = await account.zipFiles()
      expect(zip.texts.get(id)).toBe(file)
      // The bundle's manifest too: no new field for it.
      expect(zip.manifest.every((s) => !('off' in s))).toBe(true)
      expect((await account.rawFiles()).get(1_000)).toEqual(JSON.parse(file))
    }

    for (const good of [big, { ...big, gi_off: [] }]) {
      setGuestStore(new LocalStore(memoryBackend()))
      const here = await guestImport(JSON.stringify(good), 1_000)
      expect(await (await guest(`/snapshots/${here.snapshotId}/good`)).text()).toBe(file)
      const zip = await guestZipFiles()
      expect(zip.texts.get(here.snapshotId)).toBe(file)
      expect(zip.manifest.every((s) => !('off' in s))).toBe(true)
    }
  })
})
