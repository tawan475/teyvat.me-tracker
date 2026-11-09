import { env, SELF } from 'cloudflare:test'
import {
  catalogFromRows,
  decodeBundle,
  asLeyline,
  decodeSnapshot,
  inflateBundle,
  readBundle,
  storedSnapshotOf,
  type AccountResponse,
  type CatalogRow,
  type Good,
  type ImportResponse,
  type SnapshotResponse,
} from '@gdt/shared'
import { MATERIALS } from '@gdt/shared/dictionary/materials'
import { describe, expect, it } from 'vitest'
import { BUNDLE_IDS_SQL, V2_BLOBS_SQL, V2_META_SQL } from '../services/export'
import { LATEST_BLOBS_SQL, NEAREST_SQL } from '../services/import'
import { reorderAccount } from '../services/reorder'
import { COLLECT_SECTION_BLOBS, runMaintenance, TRASH_DAYS } from '../services/maintenance'
import type { RepackResult } from '../services/repack'
import {
  ORIGIN,
  bigGood,
  irminsulForm,
  sampleExtras,
  sampleGood,
  signUp,
  type Client,
} from './client'

// Storage format v2 on the schema without v1 (migration 0017). The tests of
// repack converting v1 rows, and of the two formats side by side, are in the
// commit that brought storage v2: they need the v1 columns this schema lacks.

const DIAG = 'test-diag-key-test-diag-key-test-diag-key'

async function setUp() {
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

/** Captures that exercise every section shape: deltas of each kind, out of order, a relogin. */
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

/** Every snapshot's GOOD file as the server, an older app (GDT1) and this app (GDT2) get it. */
async function exportsOf(client: Client, accountId: number) {
  const base = `/api/accounts/${accountId}`
  const list = await client.json<SnapshotResponse[]>(`${base}/snapshots`)
  const catalogRows = await client.json<CatalogRow[]>(`${base}/catalog`)
  const catalog = catalogFromRows(catalogRows)
  const goods: Record<number, string> = {}
  for (const { id } of list) {
    goods[id] = await (await client.fetch(`${base}/snapshots/${id}/good`)).text()
  }
  const gdt1 = readBundle(await (await client.fetch(`${base}/bundle`)).arrayBuffer())
  const texts1 = await inflateBundle(gdt1.blobs)
  const files1 = Object.fromEntries(
    gdt1.manifest.snapshots.map((s) => [
      s.id,
      // As the browser's export writes them (export-zip: Leyline).
      JSON.stringify(
        asLeyline(
          decodeSnapshot(
            storedSnapshotOf(s, (key) => texts1.get(key)!),
            catalog,
            MATERIALS,
          ),
        ),
      ),
    ]),
  )
  const gdt2 = await decodeBundle(
    await (await client.fetch(`${base}/bundle?format=2`)).arrayBuffer(),
  )
  const files2 = Object.fromEntries(
    gdt2.snapshots.map((s) => [
      s.id,
      JSON.stringify(
        asLeyline(
          decodeSnapshot(
            storedSnapshotOf(s, (key) => gdt2.texts.get(key)!),
            catalog,
            MATERIALS,
          ),
        ),
      ),
    ]),
  )
  return { list: JSON.stringify(list), catalog: JSON.stringify(catalogRows), goods, files1, files2 }
}

async function adminRepack(query = 'limit=500', key = DIAG): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/admin/repack?${query}`, {
    method: 'POST',
    headers: { 'x-diag-key': key },
  })
}

async function chunkCount(accountId: number): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT count(*) AS n FROM artifact_chunks WHERE account_id = ?1',
  )
    .bind(accountId)
    .first<{ n: number }>()
  return row!.n
}

describe('storage v2 without v1', () => {
  it('stores, serves and exports every snapshot the same to every reader', async () => {
    const { client, account, upload } = await setUp()
    const ids: number[] = []
    for (const [good, at] of sequence()) {
      const result = await upload(good, at)
      expect(result.status).toBe('created')
      ids.push(result.snapshotId)
    }
    const all = await exportsOf(client, account.id)
    for (const [i, [good, at]] of sequence().entries()) {
      expect(all.files1[ids[i]!], `capture ${i}`).toBe(all.goods[ids[i]!])
      expect(all.files2[ids[i]!], `capture ${i}`).toBe(all.goods[ids[i]!])
      expect(JSON.parse(all.goods[ids[i]!]!)).toMatchObject({
        timestamp: at,
        gi_player: good.gi_player,
      })
    }
    // A capture uploaded again is a no-op.
    const [[played, at]] = [sequence()[1]!]
    expect(await upload(played, at)).toMatchObject({ status: 'unchanged', snapshotId: ids[1] })
  })

  it('serves bundles of some sections, as the app pages ask for them', async () => {
    const { client, account, upload } = await setUp()
    for (const [good, at] of sequence()) expect((await upload(good, at)).status).toBe('created')
    const base = `/api/accounts/${account.id}/bundle?format=2`
    const full = await decodeBundle(await (await client.fetch(base)).arrayBuffer())
    const latest = full.snapshots.at(-1)!
    for (const [query, slots] of [
      ['&sections=materials', ['materials', 'materialsKeyframe']],
      ['&sections=player', ['player']],
      ['&sections=characters', ['characters']],
      [
        '&sections=achievements,achievementTimes',
        ['achievements', 'achievementTimes', 'achievementTimesBase'],
      ],
      [`&ids=${latest.id}&sections=artifacts`, ['artifacts', 'artifactsBase']],
    ] as const) {
      const part = await decodeBundle(await (await client.fetch(base + query)).arrayBuffer())
      for (const snapshot of part.snapshots) {
        const whole = full.snapshots.find((s) => s.id === snapshot.id)!
        for (const slot of slots) {
          const key = snapshot[slot] as string | null | undefined
          if (!key) continue
          expect(part.texts.get(key), `${query} ${slot}`).toBe(
            full.texts.get(whole[slot] as string),
          )
        }
      }
    }
  })

  it('keeps the catalog in a few chunks: imports add small ones, repack merges them', async () => {
    const { client, account, upload } = await setUp()
    const good = sampleGood(sampleExtras())
    for (let i = 0; i < 6; i++) {
      const extra = { ...good.artifacts[1]!, substats: [{ key: 'hp', value: 1000 + i }] }
      await upload({ ...good, artifacts: [...good.artifacts, extra] }, 1_000 + i)
    }
    const before = await exportsOf(client, account.id)
    expect(await chunkCount(account.id)).toBe(6)
    const result = (await (await adminRepack()).json()) as RepackResult
    expect(result.remaining).toMatchObject({ snapshots: 0, legacyBlobs: 0, legacyArtifacts: 0 })
    expect(result.d1.rowsWritten).toBeGreaterThan(0)
    expect(await chunkCount(account.id)).toBe(1)
    const after = await exportsOf(client, account.id)
    expect(after.catalog).toBe(before.catalog)
    expect(after.goods).toEqual(before.goods)
  })

  it('collects v2 sections only once nothing needs them', async () => {
    const { client, account, upload } = await setUp()
    const big = bigGood()
    const a = await upload(big, 1_000)
    const b = await upload({ ...big, materials: { ...big.materials, Mora: 3 } }, 2_000)
    await client.fetch(`/api/accounts/${account.id}/snapshots/${a.snapshotId}`, {
      method: 'DELETE',
    })
    const kept = await exportsOf(client, account.id)
    await runMaintenance(env.DB, Date.now() + (TRASH_DAYS + 1) * 86_400_000)
    // b's materials delta needs a's keyframe: still there after a is purged.
    expect((await exportsOf(client, account.id)).goods[b.snapshotId]).toBe(kept.goods[b.snapshotId])
  })

  it('opens the admin routes only to the diag key', async () => {
    expect((await adminRepack('limit=1', 'wrong')).status).toBe(404)
    expect((await SELF.fetch(`${ORIGIN}/api/admin/repack`)).status).toBe(404)
    const status = await SELF.fetch(`${ORIGIN}/api/admin/repack`, {
      headers: { 'x-diag-key': DIAG },
    })
    expect(status.status).toBe(200)
    expect(await status.json()).toEqual({
      remaining: { snapshots: 0, legacyBlobs: 0, legacyArtifacts: 0, smallChunkAccounts: 0 },
    })
  })
})

/**
 * Without the plain (account_id, taken_at) index that 0017 dropped, every
 * per-account read of snapshots still goes through an index (the partial
 * one over live rows, or the primary key); only maintenance reads the whole
 * table, as it always did. The statements are the Worker's, by shape.
 */
/**
 * Twelve daily captures of an account that plays: each day moves a few more
 * materials and flips a few more locks, so the last day shares little with
 * the first (what a backfilled history looks like).
 */
function history(): [Good, number][] {
  const big = bigGood()
  return Array.from({ length: 12 }, (_, day) => {
    const materials = Object.fromEntries(
      Object.entries(big.materials).map(([key, count], i) => [
        key,
        i % 12 < day ? count + day * 7 : count,
      ]),
    )
    const artifacts = big.artifacts.map((a, i) => (i % 40 < day ? { ...a, lock: !a.lock } : a))
    return [bigGood({ materials, artifacts }), 1_000 + day * 86_400_000] as [Good, number]
  })
}

describe('history imported after newer captures', () => {
  it('is stored against its neighbour in time, as cheaply as in order', async () => {
    const days = history()
    const stored = async (order: [Good, number][]) => {
      const { client, account, upload } = await setUp()
      for (const [good, at] of order) await upload(good, at)
      const list = await client.json<SnapshotResponse[]>(`/api/accounts/${account.id}/snapshots`)
      expect(list).toHaveLength(days.length)
      return {
        bytes: list.reduce((sum, s) => sum + s.storedSize, 0),
        files: await exportsOf(client, account.id),
      }
    }
    const inOrder = await stored(days)
    // The newest capture first, then the rest of the history oldest first
    // (an import of older files after the capture app had been running).
    const late = await stored([days.at(-1)!, ...days.slice(0, -1)])
    // Each file decodes the same whichever order it came in.
    expect(Object.values(late.files.files2).sort()).toEqual(
      Object.values(inOrder.files.files2).sort(),
    )
    // Planned against the newest capture, the older days cost 1.4x what in
    // order costs here (4x on a real account's history); against their
    // neighbour in time, about the same.
    expect(late.bytes).toBeLessThan(inOrder.bytes * 1.3)
  })
})

describe('time-order repack', () => {
  /** An account whose every day was stored alone (nearly whole), as a backfill planned against far captures was. */
  async function storedApart() {
    const set = await setUp()
    for (const [good, at] of history()) {
      await env.DB.prepare(
        'UPDATE snapshots SET deleted_at = 1 WHERE account_id = ?1 AND deleted_at IS NULL',
      )
        .bind(set.account.id)
        .run()
      await set.upload(good, at)
    }
    await env.DB.prepare('UPDATE snapshots SET deleted_at = NULL WHERE account_id = ?1')
      .bind(set.account.id)
      .run()
    return set
  }
  const counted = (accountId: number) =>
    env.DB.prepare(
      `SELECT stored_bytes AS counter,
         (SELECT coalesce(sum(length(data)), 0) FROM section_blobs WHERE account_id = ?1) AS actual
       FROM genshin_accounts WHERE id = ?1`,
    )
      .bind(accountId)
      .first<{ counter: number; actual: number }>()

  it('re-encodes the history oldest first; every file reads the same', async () => {
    const { client, account } = await storedApart()
    const before = await exportsOf(client, account.id)
    const result = await reorderAccount(env.DB, account.id)
    expect(result).toMatchObject({ applied: true, snapshots: 12 })
    expect(result.after).toBeLessThan(result.before * 0.6)
    const after = await exportsOf(client, account.id)
    expect(after.goods).toEqual(before.goods)
    expect(after.files1).toEqual(before.files1)
    expect(after.files2).toEqual(before.files2)
    expect(after.catalog).toEqual(before.catalog)
    // Each snapshot's stored size is now what it adds in time order.
    const list = await client.json<SnapshotResponse[]>(`/api/accounts/${account.id}/snapshots`)
    expect(list.reduce((sum, s) => sum + s.storedSize, 0)).toBe(result.after)
    // The rows nothing points at go with the daily collection; the counter
    // then matches what is stored.
    await runMaintenance(env.DB)
    const { counter, actual } = (await counted(account.id))!
    expect(counter).toBe(actual)
    expect(actual).toBeLessThan(result.before)
    // Done once: a second run finds nothing to gain.
    expect(await reorderAccount(env.DB, account.id)).toMatchObject({ applied: false })
    // And uploads go on from the new layout.
    const next = bigGood({ materials: { ...bigGood().materials, Mora: 77 } })
    const res = await client.fetch(`/api/accounts/${account.id}/import?timestamp=${2e12}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(next),
    })
    expect(res.status, await res.clone().text()).toBeLessThan(300)
    const latest = await exportsOf(client, account.id)
    expect(Object.keys(latest.goods)).toHaveLength(13)
  })
})

describe('snapshot query plans', () => {
  async function plan(sql: string, ...params: unknown[]): Promise<string> {
    const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .bind(...params)
      .all<{ detail: string }>()
    return results.map((row) => row.detail).join(' | ')
  }
  const LIVE = 'snapshots_account_taken_live_unique'

  it.each([
    [
      'latest (import, recompute)',
      `SELECT id FROM snapshots WHERE account_id = ?1 AND deleted_at IS NULL
       ORDER BY taken_at DESC, id DESC LIMIT 1`,
      [1],
    ],
    ['nearest capture (import)', NEAREST_SQL, [1, 2]],
    [
      'same capture time',
      `SELECT id FROM snapshots WHERE account_id = ?1 AND taken_at = ?2 AND deleted_at IS NULL`,
      [1, 2],
    ],
    [
      'snapshot list',
      `SELECT id, meta FROM snapshots WHERE account_id = ?1 AND deleted_at IS NULL
       ORDER BY taken_at DESC, id DESC`,
      [1],
    ],
    [
      'bundle',
      `SELECT id, meta FROM snapshots WHERE account_id = ?1 AND deleted_at IS NULL
       AND (?2 IS NULL OR id IN (SELECT value FROM json_each(?2))) ORDER BY taken_at, id LIMIT ?3`,
      [1, null, 10],
    ],
    [
      'one GOOD file',
      `SELECT id, meta FROM snapshots WHERE account_id = ?1 AND deleted_at IS NULL
       AND (?2 IS NULL OR id = ?2) ORDER BY taken_at DESC, id DESC LIMIT 1`,
      [1, 5],
    ],
    [
      'delete some',
      `UPDATE snapshots SET deleted_at = ?3 WHERE account_id = ?1 AND deleted_at IS NULL
       AND id IN (SELECT value FROM json_each(?2))`,
      [1, '[1,2]', 9],
    ],
  ] as const)('%s reads through an index', async (_, sql, params) => {
    const detail = await plan(sql, ...params)
    expect(detail).toMatch(new RegExp(`${LIVE}|INTEGER PRIMARY KEY|USING INDEX`))
    expect(detail).not.toMatch(/SCAN snapshots(?! USING)/)
  })

  it.each([
    ["a bundle's blobs and their bases", V2_BLOBS_SQL, [1, '[1,2,3]']],
    ["a bundle's delta keyframes", V2_META_SQL, [1, '[1,2,3]']],
    ["the import's neighbour blobs", LATEST_BLOBS_SQL, [1, 2]],
    ['a bundle of chosen snapshots', BUNDLE_IDS_SQL('id, meta'), [1, '[1,2]', 10]],
  ] as const)(
    '%s are read by primary key, never by scanning the account',
    async (_, sql, params) => {
      const detail = await plan(sql, ...params)
      expect(detail).toMatch(/USING INTEGER PRIMARY KEY/)
      // The (account_id, hash) index read every blob of the account.
      expect(detail).not.toMatch(/section_blobs_account_hash_unique/)
      expect(detail).not.toMatch(/SCAN (section_blobs|snapshots)(?! USING)/)
    },
  )

  it('reads by primary key where rows are joined by id', async () => {
    expect(
      await plan(
        `SELECT s.meta FROM genshin_accounts AS a
         LEFT JOIN snapshots AS s ON s.id = a.latest_snapshot_id WHERE a.user_id = ?1`,
        1,
      ),
    ).toMatch(/SEARCH s USING INTEGER PRIMARY KEY/)
  })

  it('scans the whole table only in maintenance', async () => {
    expect(await plan(COLLECT_SECTION_BLOBS)).toMatch(/SCAN/)
  })
})
