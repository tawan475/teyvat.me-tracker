import { env, SELF } from 'cloudflare:test'
import {
  decodeBundle,
  decodeSectionBlob,
  type AccountResponse,
  type CatalogRow,
  type DecodedBlob,
} from '@gdt/shared'
import { describe, expect, it } from 'vitest'
import { zipEntryNames } from '@/data/export-zip'
import { rawExportFiles, writeRawZip, type RawCatalog } from '@/data/raw-export'
import { inflateAll } from '@/data/raw-export/inflate'
import { ORIGIN, bigGood, irminsulForm, signUp } from './client'

// The Snapshots page's raw download for developers (src/data/raw-export.ts):
// the stored blobs and catalog chunks as they are, and inflate.mjs, which
// must turn them into readable JSON: every section decoded, the catalog, and
// each snapshot as the same Leyline file the site's Download gives.

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

/** What the codec decodes a stored blob to (a delta names its base as the bundle reader does). */
function codecValues(files: Map<string, Uint8Array>, sections: SectionEntry[]) {
  const byId = new Map(sections.map((s) => [s.id, s]))
  const decoded = new Map<number, DecodedBlob>()
  const decode = (id: number): DecodedBlob => {
    const known = decoded.get(id)
    if (known) return known
    const entry = byId.get(id)!
    const code = (KIND_CODES[entry.kind] ?? 0) | (entry.delta ? 0x10 : 0)
    const base = entry.base === null ? null : decode(entry.base)
    const blob = decodeSectionBlob(
      code,
      files.get(entry.file)!,
      base,
      entry.base === null ? null : `#${entry.base}`,
    )
    decoded.set(id, blob)
    return blob
  }
  return new Map(sections.map((s) => [s.id, decode(s.id).value]))
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

async function run(files: readonly { name: string; data: Uint8Array }[]) {
  const read = new Map(files.map((f) => [f.name, f.data]))
  const written = new Map<string, Uint8Array>()
  const done = await inflateAll({
    read: (path) => {
      const data = read.get(path)
      if (!data) throw new Error(`No ${path}`)
      return data
    },
    write: (path, bytes) => void written.set(path, bytes),
  })
  return { read, written, done }
}

const parse = (bytes: Uint8Array | undefined) =>
  bytes === undefined ? undefined : (JSON.parse(new TextDecoder().decode(bytes)) as unknown)

describe('raw download', () => {
  it('holds every stored blob and catalog chunk, and its script inflates them all', async () => {
    const { client, base, bundle, catalog, rows } = await account()
    const files = rawExportFiles({ bundle, catalog, ids: null })
    const names = files.map((f) => f.name)
    expect(names.slice(0, 5)).toEqual([
      'README.md',
      'inflate.mjs',
      'snapshots.json',
      'sections.json',
      'catalog.json',
    ])

    const { read, written, done } = await run(files)
    const sections = parse(read.get('sections.json')) as SectionEntry[]
    const snapshots = parse(read.get('snapshots.json')) as { id: number; takenAt: number }[]
    expect(snapshots).toHaveLength(3)
    expect(done.sections).toBe(sections.length)
    expect(done.snapshots).toBe(3)

    // Every section decodes to what the codec reads, written as readable JSON
    // (no line past 100 characters but an unbreakable one).
    const expected = codecValues(read, sections)
    for (const entry of sections) {
      const out = written.get(`inflated/sections/${entry.id}.json`)
      expect(parse(out), `section ${entry.id}`).toEqual(expected.get(entry.id))
      const lines = new TextDecoder().decode(out).split('\n')
      expect(lines.length, `section ${entry.id} lines`).toBeGreaterThan(1)
    }
    // Some were compressed against a base: the dictionary path ran.
    expect(sections.some((s) => s.base !== null)).toBe(true)

    // The catalog: every identity the catalog route serves, by id.
    const catalogOut = parse(written.get('inflated/catalog.json')) as { id: number }[]
    expect(catalogOut.map((a) => a.id)).toEqual(rows.map((r) => r[0]))
    expect(done.artifacts).toBe(rows.length)

    // Each snapshot: the Leyline file the site's own Download gives for it.
    const leyline = [...written.keys()].filter((k) => k.startsWith('inflated/snapshots/'))
    expect(leyline).toHaveLength(3)
    // Named like the site's zip (these captures share a second: `_<id>` added).
    const leylineNames = zipEntryNames(snapshots)
    for (const snapshot of snapshots) {
      const name = `inflated/snapshots/${leylineNames.get(snapshot.id)}`
      const site = await (await client.fetch(`${base}/snapshots/${snapshot.id}/good`)).json()
      expect(leyline, `snapshot ${snapshot.id}`).toContain(name)
      expect(parse(written.get(name)), `snapshot ${snapshot.id}`).toEqual(site)
    }
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
    expect((await run(one)).done.snapshots).toBe(1)
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
