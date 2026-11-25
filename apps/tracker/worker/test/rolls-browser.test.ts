/**
 * Exact artifact rolls on the browser side (package T4): the snapshot decode
 * the pages use, past builds, the zip export and the raw download's script
 * give every artifact the `gi_rolls` the server's GOOD export gives it.
 */
import {
  asLeyline,
  catalogFromRows,
  catalogRolls,
  decodeBundle,
  rollValue,
  type AccountResponse,
  type CatalogEntry,
  type CatalogRow,
  type Good,
  type GoodArtifact,
  type ImportResponse,
  type KeyDictionary,
  type SnapshotResponse,
} from '@gdt/shared'
import { MATERIALS } from '@gdt/shared/dictionary/materials'
import { env, SELF } from 'cloudflare:test'
import { afterEach, describe, expect, it } from 'vitest'
import { decodeFromSections } from '@/data/export-zip'
import { rawExportFiles, type RawCatalog } from '@/data/raw-export'
import { inflateAll } from '@/data/raw-export/inflate'
import { ORIGIN, irminsulForm, sampleExtras, sampleGood, signUp } from './client'

type Loose = Record<string, any>

// Loaded untyped: these modules reach the DOM's types (the API client, IndexedDB).
const load = (name: string): Promise<Record<string, unknown>> =>
  import(/* @vite-ignore */ `@/data/${name}`)
const accountData = (await load('account-data')) as {
  decodeBundleSnapshot(
    snapshot: unknown,
    bundle: { snapshots: unknown[]; texts: Map<string, string> },
    catalog: ReadonlyMap<number, CatalogEntry>,
    materials: KeyDictionary,
  ): Good
}
const builds = (await load('character-builds')) as {
  wornArtifact(piece: CatalogEntry, location: string, flags: number): GoodArtifact
}

const KEYS = ['critRate_', 'critDMG_', 'atk_', 'eleMas'] as const
const shown = (key: string, n: number) =>
  key.endsWith('_') ? Math.round(n * 10) / 10 : Math.round(n)

/** A made-up 5★ +20 and its gi_rolls, from `pairs` (line, tier) in game order. */
function piece(pairs: [number, number][], slotKey: string, location = ''): Loose {
  const substats = KEYS.map((key, line) => {
    const tiers = pairs.filter(([l]) => l === line).map(([, t]) => t)
    const sum = tiers.reduce((total, t) => total + rollValue(key, 5, t)!, 0)
    return { key, value: shown(key, sum), initialValue: shown(key, rollValue(key, 5, tiers[0]!)!) }
  })
  return {
    setKey: 'GladiatorsFinale',
    slotKey,
    level: 20,
    rarity: 5,
    mainStatKey: 'hp',
    location,
    lock: false,
    astralMark: false,
    elixirCrafted: false,
    totalRolls: pairs.length,
    substats,
    unactivatedSubstats: [],
    gi_rolls: pairs.map(([l, t]) => `${l}${t}`).join(''),
  }
}

const P1 = piece(
  [
    [0, 4],
    [1, 3],
    [2, 2],
    [3, 1],
    [0, 4],
    [1, 2],
    [2, 4],
    [3, 3],
    [1, 4],
  ],
  'flower',
)
const P2 = piece(
  [
    [0, 1],
    [1, 1],
    [2, 1],
    [3, 1],
    [0, 2],
    [0, 3],
    [1, 4],
    [2, 2],
    [3, 4],
  ],
  'plume',
)
const { gi_rolls: _, ...P3 } = piece(
  [
    [0, 3],
    [1, 3],
    [2, 3],
    [3, 3],
    [3, 1],
    [2, 1],
    [1, 1],
    [0, 1],
    [0, 2],
  ],
  'sands',
)

async function setSwitch(value: string | null): Promise<void> {
  if (value === null) {
    await env.DB.prepare("DELETE FROM site_settings WHERE key = 'rolls.store'").run()
  } else {
    await env.DB.prepare(
      `INSERT INTO site_settings (key, value, updated_at) VALUES ('rolls.store', ?1, 0)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    )
      .bind(value)
      .run()
  }
}
afterEach(() => setSwitch(null))

/** An account holding one capture with P1 and P2 (rolls) and P3 (none). */
async function stored() {
  await setSwitch('1')
  const { client } = await signUp()
  const { account, importKey } = await client.json<{
    account: AccountResponse
    importKey: string
  }>('/api/accounts', { method: 'POST', json: { name: 'Main' } })
  const base = sampleGood(sampleExtras()) as Loose
  const good = { ...base, artifacts: [...base.artifacts, P1, P2, P3] }
  const response = await SELF.fetch(`${ORIGIN}/api/genshin-accounts-public/import-by-key`, {
    method: 'POST',
    headers: { 'x-import-key': importKey },
    body: irminsulForm(good, 1_000),
  })
  expect(((await response.json()) as ImportResponse).status).toBe('created')
  const path = `/api/accounts/${account.id}`
  const [snapshot] = await client.json<SnapshotResponse[]>(`${path}/snapshots`)
  const server = JSON.parse(
    await (await client.fetch(`${path}/snapshots/${snapshot!.id}/good`)).text(),
  ) as Good
  const rows = await client.json<CatalogRow[]>(`${path}/catalog`)
  const bundle = await (await client.fetch(`${path}/bundle?format=3`)).arrayBuffer()
  const raw = await client.json<RawCatalog>(`${path}/catalog?raw=1`)
  return { server, rows, bundle, raw }
}

/** The artifacts' gi_rolls, by slot. */
const rollsBySlot = (good: Good) =>
  Object.fromEntries(
    good.artifacts
      .filter((a) => a.setKey === 'GladiatorsFinale')
      .map((a) => [a.slotKey, a.gi_rolls ?? null]),
  )

describe('exact rolls in the browser', () => {
  it("decodes a snapshot's artifacts with the rolls the server's GOOD export gives", async () => {
    const { server, rows, bundle } = await stored()
    expect(rollsBySlot(server)).toEqual({ flower: P1.gi_rolls, plume: P2.gi_rolls, sands: null })

    const decoded = await decodeBundle(bundle)
    const catalog = catalogFromRows(rows)
    const good = accountData.decodeBundleSnapshot(decoded.snapshots[0], decoded, catalog, MATERIALS)
    expect(asLeyline(good)).toEqual(server)

    // The zip export (src/workers/export.worker.ts's decode).
    const zipped = decodeFromSections(
      decoded.snapshots[0]!,
      decoded.texts,
      catalog,
      MATERIALS,
      catalogRolls(catalog),
    )
    expect(JSON.parse(JSON.stringify(zipped))).toEqual(server)
  })

  it("writes the raw download's snapshots and catalog with the rolls", async () => {
    const { server, bundle, raw } = await stored()
    const files = rawExportFiles({ bundle: new Uint8Array(bundle), catalog: raw, ids: null })
    const read = new Map(files.map((f) => [f.name, f.data]))
    const written = new Map<string, unknown>()
    await inflateAll({
      read: (path) => read.get(path)!,
      write: (path, bytes) => {
        if (path.startsWith('inflated/snapshots/') || path === 'inflated/catalog.json') {
          written.set(path, JSON.parse(new TextDecoder().decode(bytes)))
        }
      },
    })
    const [snapshot] = [...written].filter(([path]) => path.startsWith('inflated/snapshots/'))
    expect(snapshot![1]).toEqual(server)
    const catalog = written.get('inflated/catalog.json') as Loose[]
    const listed = Object.fromEntries(
      catalog.filter((a) => a.setKey === 'GladiatorsFinale').map((a) => [a.slotKey, a.rolls]),
    )
    expect(listed).toEqual({ flower: P1.gi_rolls, plume: P2.gi_rolls, sands: undefined })
  })

  it('gives past builds the rolls that still fit their piece', async () => {
    const { rows } = await stored()
    const catalog = catalogFromRows(rows)
    const entry = [...catalog.values()].find((e) => e.slotKey === 'flower' && e.rolls)!
    expect(builds.wornArtifact(entry, 'Furina', 1)).toMatchObject({
      location: 'Furina',
      lock: true,
      gi_rolls: P1.gi_rolls,
    })
    // Without rolls, with rolls that no longer fit, or with no order across lines: none.
    const { rolls: _r, ...bare } = entry
    expect(builds.wornArtifact(bare, 'Furina', 0)).not.toHaveProperty('gi_rolls')
    expect(builds.wornArtifact({ ...entry, rolls: P2.gi_rolls }, 'Furina', 0)).not.toHaveProperty(
      'gi_rolls',
    )
    const unordered = `~${[...(P1.gi_rolls as string).match(/../g)!].sort().join('')}`
    expect(builds.wornArtifact({ ...entry, rolls: unordered }, 'Furina', 0)).not.toHaveProperty(
      'gi_rolls',
    )
  })
})
