import { env, SELF } from 'cloudflare:test'
import {
  decodeBundle,
  decodeCatalogChunk,
  decodeSectionBlob,
  type AccountResponse,
  type CatalogRow,
  type DecodedBlob,
} from '@gdt/shared'
import { inflateSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { rawExportFiles, writeRawZip, type RawCatalog } from '@/data/raw-export'
import { inflateAll } from '@/data/raw-export/inflate.mjs'
import { ORIGIN, bigGood, irminsulForm, signUp } from './client'

// The Snapshots page's raw download for developers (src/data/raw-export.ts):
// the stored blobs and catalog chunks as they are, and inflate.mjs, which
// must inflate every one of them back to the payload the codec reads.

async function account() {
  const { client } = await signUp()
  const { account, importKey } = await client.json<{
    account: AccountResponse
    importKey: string
  }>('/api/accounts', { method: 'POST', json: { name: 'Main' } })
  const big = bigGood()
  const goods = [
    big,
    bigGood({ materials: { ...big.materials, Mora: 5 } }),
    bigGood({ artifacts: big.artifacts.slice(2), materials: { ...big.materials, Mora: 9 } }),
  ]
  for (const [i, good] of goods.entries()) {
    const response = await SELF.fetch(`${ORIGIN}/api/genshin-accounts-public/import-by-key`, {
      method: 'POST',
      headers: { 'x-import-key': importKey },
      body: irminsulForm(good, 1_000 * (i + 1)),
    })
    expect(response.ok).toBe(true)
  }
  const base = `/api/accounts/${account.id}`
  const bundle = new Uint8Array(await (await client.fetch(`${base}/bundle?format=2`)).arrayBuffer())
  const catalog = await client.json<RawCatalog>(`${base}/catalog?raw=1`)
  const rows = await client.json<CatalogRow[]>(`${base}/catalog`)
  return { client, base, bundle, catalog, rows }
}

/** What the codec reads for a stored blob: its payload without the layout byte. */
function codecPayloads(files: Map<string, Uint8Array>, sections: SectionEntry[]) {
  const byId = new Map(sections.map((s) => [s.id, s]))
  const decoded = new Map<number, DecodedBlob>()
  const decode = (id: number): DecodedBlob => {
    const known = decoded.get(id)
    if (known) return known
    const entry = byId.get(id)!
    const code = (KIND_CODES[entry.kind] ?? 0) | (entry.delta ? 0x10 : 0)
    const base = entry.base === null ? null : decode(entry.base)
    const blob = decodeSectionBlob(code, files.get(entry.file)!, base, 'b')
    decoded.set(id, blob)
    return blob
  }
  return new Map(sections.map((s) => [s.id, decode(s.id).payload.subarray(1)]))
}

interface SectionEntry {
  id: number
  kind: string
  delta: boolean
  base: number | null
  file: string
  bytes: number
}

const KIND_CODES: Record<string, number> = {
  characters: 1,
  weapons: 2,
  artifacts: 3,
  materials: 4,
  achievements: 5,
  player: 6,
  achievementTimes: 7,
  characterExtras: 8,
  anecdotes: 9,
  tasks: 10,
  collections: 11,
  collections2: 12,
  wardrobe: 13,
  exploration: 14,
  progress: 15,
  extras: 32,
}

/** A snapshot entry's blob references. */
const REFS = [
  'characters',
  'weapons',
  'artifacts',
  'artifactsBase',
  'materials',
  'materialsKeyframe',
  'achievements',
  'player',
  'achievementTimes',
  'achievementTimesBase',
  'characterExtras',
  'tasks',
  'collections2',
] as const

const inflateRaw = (bytes: Uint8Array, dictionary?: Uint8Array) =>
  inflateSync(bytes, dictionary ? { dictionary } : {})

function run(files: readonly { name: string; data: Uint8Array }[]) {
  const read = new Map(files.map((f) => [f.name, f.data]))
  const written = new Map<string, Uint8Array>()
  const done = inflateAll(
    {
      read: (path) => {
        const data = read.get(path)
        if (!data) throw new Error(`No ${path}`)
        return data
      },
      write: (path, bytes) => void written.set(path, bytes),
    },
    inflateRaw,
  )
  return { read, written, done }
}

describe('raw download', () => {
  it('holds every stored blob and catalog chunk, and its script inflates them all', async () => {
    const { bundle, catalog, rows } = await account()
    const files = rawExportFiles({ bundle, catalog, ids: null })
    const names = files.map((f) => f.name)
    expect(names.slice(0, 5)).toEqual([
      'README.md',
      'inflate.mjs',
      'snapshots.json',
      'sections.json',
      'catalog.json',
    ])

    const { read, written, done } = run(files)
    const sections = JSON.parse(
      new TextDecoder().decode(read.get('sections.json')),
    ) as SectionEntry[]
    const snapshots = JSON.parse(new TextDecoder().decode(read.get('snapshots.json'))) as Record<
      string,
      unknown
    >[]
    expect(snapshots).toHaveLength(3)
    expect(done.sections).toBe(sections.length)

    // Every section inflates to exactly what the codec reads.
    const expected = codecPayloads(read, sections)
    for (const entry of sections) {
      const out =
        written.get(`inflated/sections/${entry.id}.bin`) ??
        written.get(`inflated/sections/${entry.id}.json`)
      expect(out, `section ${entry.id}`).toEqual(expected.get(entry.id))
    }
    // Some were compressed against a base: the script's dictionary path ran.
    expect(sections.some((s) => s.base !== null)).toBe(true)

    // Every catalog chunk inflates to the identities the catalog route serves.
    let identities = 0
    for (const chunk of catalog.chunks) {
      const body = written.get(`inflated/catalog/${chunk.first}-${chunk.last}.bin`)!
      const stored = new Uint8Array(body.length + 1)
      stored[0] = 1 // CHUNK_STORED
      stored.set(body, 1)
      const entries = decodeCatalogChunk(stored)
      expect(entries).toHaveLength(chunk.count)
      identities += entries.length
    }
    expect(identities + catalog.pending.length).toBe(rows.length)
  })

  it('takes only the chosen snapshots and every blob they need', async () => {
    const { bundle, catalog } = await account()
    const all = rawExportFiles({ bundle, catalog, ids: null })
    const snapshots = JSON.parse(
      new TextDecoder().decode(all.find((f) => f.name === 'snapshots.json')!.data),
    ) as { id: number }[]
    const first = snapshots[0]!.id
    const one = rawExportFiles({ bundle, catalog, ids: [first] })
    const sections = JSON.parse(
      new TextDecoder().decode(one.find((f) => f.name === 'sections.json')!.data),
    ) as SectionEntry[]
    const kept = JSON.parse(
      new TextDecoder().decode(one.find((f) => f.name === 'snapshots.json')!.data),
    ) as Record<string, unknown>[]
    expect(kept.map((s) => s.id)).toEqual([first])
    const ids = new Set(sections.map((s) => s.id))
    for (const field of REFS) {
      const ref = kept[0]![field]
      if (typeof ref === 'number') expect(ids.has(ref), field).toBe(true)
    }
    for (const s of sections) if (s.base !== null) expect(ids.has(s.base)).toBe(true)
    expect(sections.length).toBeLessThan(
      (
        JSON.parse(
          new TextDecoder().decode(all.find((f) => f.name === 'sections.json')!.data),
        ) as unknown[]
      ).length,
    )
    // And the script still inflates the smaller set on its own.
    expect(() => run(one)).not.toThrow()
  })

  it('serves GDT3 to the app: the same sections, the manifest deflated', async () => {
    const { client, base, bundle } = await account()
    const gdt3 = new Uint8Array(await (await client.fetch(`${base}/bundle?format=3`)).arrayBuffer())
    expect(new TextDecoder().decode(gdt3.subarray(0, 4))).toBe('GDT3')
    expect(await decodeBundle(gdt3)).toEqual(await decodeBundle(bundle))
    expect(gdt3.length).toBeLessThan(bundle.length)
    // A pack of chosen ids is a bundle of its own.
    const ids = (await decodeBundle(bundle)).snapshots.map((s) => s.id)
    const pack = await decodeBundle(
      await (
        await client.fetch(`${base}/bundle?format=3&ids=${ids.slice(1).join(',')}`)
      ).arrayBuffer(),
    )
    expect(pack.snapshots.map((s) => s.id)).toEqual(ids.slice(1))
  })

  it('zips stored files as they are', async () => {
    const { bundle, catalog } = await account()
    const files = rawExportFiles({ bundle, catalog, ids: null })
    const chunks: Uint8Array[] = []
    const totals = writeRawZip(files, (chunk) => chunks.push(chunk.slice()))
    expect(totals.files).toBe(files.length)
    expect(totals.zipBytes).toBe(chunks.reduce((n, c) => n + c.length, 0))
    // A zip: local file header signature first, end of central directory last.
    expect([...chunks[0]!.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04])
  })

  it('serves the stored catalog only to the account’s readers', async () => {
    const { base } = await account()
    const { client: stranger } = await signUp()
    const response = await stranger.fetch(`${base}/catalog?raw=1`)
    expect(response.status).toBe(404)
    expect(env.DB).toBeDefined()
  })
})
