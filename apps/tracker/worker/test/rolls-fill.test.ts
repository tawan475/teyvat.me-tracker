/**
 * Exact artifact rolls in the Worker (README "Exact artifact rolls"): the
 * `rolls.store` switch, rolls on new catalog entries, the compare-and-swap
 * fill of entries the catalog has, the held-list mark around it, the daily
 * merge carrying rolls, and every reader handing them on.
 */
import {
  artifactKeyString,
  catalogFromRows,
  decodeCatalogChunk,
  encodeCatalogChunk,
  fillCatalogChunk,
  prepareSnapshot,
  readCatalogChunk,
  rollValue,
  type AccountCreatedResponse,
  type AccountResponse,
  type ArtifactIdentity,
  type CatalogRow,
  type Good,
  type SnapshotResponse,
} from '@gdt/shared'
import { MATERIALS } from '@gdt/shared/dictionary/materials'
import { env, SELF } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { D1Meter } from '../lib/meter'
import { loadCatalog } from '../services/export'
import { catalogChunkStatements, importSnapshot } from '../services/import'
import { mergeChunkStatements } from '../services/repack'
import { toBytes } from '../services/storage'
import { Client, ORIGIN, irminsulForm, sampleExtras, sampleGood, signUp } from './client'

const UID = 812345678
const DIAG = 'test-diag-key-test-diag-key-test-diag-key'
const TOP = BigInt(UID) << 32n
const guid = (n: number) => (TOP + BigInt(n)).toString()

type Loose = Record<string, any>

// ------------------------------------------------------------------ pieces

const KEYS = ['critRate_', 'critDMG_', 'atk_', 'eleMas'] as const
const shown = (key: string, n: number) =>
  key.endsWith('_') ? Math.round(n * 10) / 10 : Math.round(n)

/** A made-up 5★ +20 with nine rolls and its gi_rolls, from `pairs` (line, tier) in game order. */
function piece(pairs: [number, number][], slotKey = 'flower'): Loose {
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
    location: '',
    lock: false,
    astralMark: false,
    elixirCrafted: false,
    totalRolls: pairs.length,
    substats,
    unactivatedSubstats: [],
    gi_rolls: pairs.map(([l, t]) => `${l}${t}`).join(''),
  }
}

/** `count` pieces with rolls, every one a distinct identity. Deterministic. */
function rolledPieces(count: number, seed = 1): Loose[] {
  // mulberry32: exact 32-bit steps (a float LCG loses bits and can cycle).
  let state = seed >>> 0
  const next = (n: number) => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) % n
  }
  const seen = new Set<string>()
  const pieces: Loose[] = []
  while (pieces.length < count) {
    const pairs: [number, number][] = KEYS.map((_, line) => [line, 1 + next(4)])
    for (let i = 0; i < 5; i++) pairs.push([next(4), 1 + next(4)])
    const p = piece(pairs, ['flower', 'plume', 'sands', 'goblet', 'circlet'][next(5)])
    const id = JSON.stringify([p.slotKey, p.substats])
    if (seen.has(id)) continue
    seen.add(id)
    pieces.push(p)
  }
  return pieces
}

const withoutRolls = (list: Loose[]) => list.map(({ gi_rolls: _, ...a }) => a)

/** A capture as Capture sends it (a guid on every piece), with these artifacts. */
function capture(artifacts: Loose[], mora = 1, guidFrom = 1000): Loose {
  const base = sampleGood(sampleExtras(UID)) as Loose
  return {
    ...base,
    artifacts: [...base.artifacts, ...artifacts].map((a, i) => ({
      ...a,
      gi_guid: guid(guidFrom + i),
    })),
    materials: { ...base.materials, Mora: mora },
  }
}

// ------------------------------------------------------------------ helpers

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

async function newAccount(client: Client) {
  return client.json<AccountCreatedResponse>('/api/accounts', {
    method: 'POST',
    json: { name: 'Main', uid: String(UID), server: 'ASIA' },
  })
}

type Cost = Record<string, number>

async function upload(key: string, good: unknown, timestamp: number) {
  const response = await SELF.fetch(`${ORIGIN}/api/genshin-accounts-public/import-by-key`, {
    method: 'POST',
    headers: { 'x-import-key': key, 'x-diag-key': DIAG },
    body: irminsulForm(good, timestamp),
  })
  const text = await response.text()
  expect(response.status, text).toBeLessThan(300)
  const header = response.headers.get('x-gdt-d1') ?? ''
  const cost: Cost = Object.fromEntries(
    header.split(';').map((part) => {
      const [k, v] = part.trim().split('=')
      return [k, Number(v)]
    }),
  )
  return { status: (JSON.parse(text) as { status: string }).status, cost }
}

async function chunkRows(accountId: number) {
  const { results } = await env.DB.prepare(
    'SELECT id, first_id, count, data FROM artifact_chunks WHERE account_id = ?1 ORDER BY id',
  )
    .bind(accountId)
    .all<{ id: number; first_id: number; count: number; data: unknown }>()
  return results.map((row) => ({ ...row, data: toBytes(row.data) }))
}

/** Every stored rolls text by catalog id (several copies of an id: the last row's). */
async function storedRolls(accountId: number): Promise<Map<number, string | undefined>> {
  const rolls = new Map<number, string | undefined>()
  for (const row of await chunkRows(accountId)) {
    for (const entry of decodeCatalogChunk(row.data)) rolls.set(entry.id, entry.rolls)
  }
  return rolls
}

async function formats(accountId: number): Promise<number[]> {
  return (await chunkRows(accountId)).map((row) => row.data[0]!)
}

async function markOf(accountId: number) {
  return env.DB.prepare(
    "SELECT hex(fingerprint) AS fingerprint FROM part_marks WHERE account_id = ?1 AND part = 'artifacts'",
  )
    .bind(accountId)
    .first<{ fingerprint: string }>()
}

const fingerprintOf = async (good: unknown) =>
  (
    await prepareSnapshot(good, { materials: MATERIALS, deferArtifacts: true })
  ).deferred!.fingerprint.toUpperCase()

async function dataVersion(accountId: number): Promise<number> {
  const row = await env.DB.prepare('SELECT data_version AS v FROM genshin_accounts WHERE id = ?1')
    .bind(accountId)
    .first<{ v: number }>()
  return row!.v
}

/** The rolls a set of uploaded pieces should have, by packed identity. */
async function rollsByKey(good: Loose): Promise<Map<string, string>> {
  const prepared = await prepareSnapshot(good, { materials: MATERIALS })
  const out = new Map<string, string>()
  for (const a of prepared.good.artifacts) {
    if (a.rolls !== undefined && !out.has(artifactKeyString(a.identity))) {
      out.set(artifactKeyString(a.identity), a.rolls)
    }
  }
  return out
}

/** Every catalog entry with its rolls, by key. */
async function rollsOfKeys(accountId: number): Promise<Map<string, string | undefined>> {
  const out = new Map<string, string | undefined>()
  for (const row of await chunkRows(accountId)) {
    for (const entry of decodeCatalogChunk(row.data)) out.set(entry.key, entry.rolls)
  }
  return out
}

// ------------------------------------------------------------------- switch

describe('the rolls.store switch', () => {
  it('is off by default: rolls are read and dropped, only formats 1/2, no mark', async () => {
    const { client } = await signUp()
    const { account, importKey } = await newAccount(client)
    const good = capture(rolledPieces(40))
    const first = await upload(importKey, good, 1_000)
    expect(first.status).toBe('created')
    expect((await formats(account.id)).every((f) => f === 1 || f === 2)).toBe(true)
    expect([...(await storedRolls(account.id)).values()].every((r) => r === undefined)).toBe(true)
    // A fill was withheld (the new pieces' rolls): the list is not marked held.
    expect(await markOf(account.id)).toBeNull()
    // Again later: seen, still nothing written onto the catalog, still no mark.
    const before = await chunkRows(account.id)
    const again = await upload(importKey, { ...good }, 2_000)
    expect(again.status).toBe('unchanged')
    expect(await chunkRows(account.id)).toEqual(before)
    expect(await markOf(account.id)).toBeNull()

    // Anything but the text "1" is off.
    for (const value of ['0', 'on', 'true', ' ']) {
      await setSwitch(value)
      await upload(importKey, { ...good, materials: { Mora: value.length } }, 3_000 + value.length)
      expect(await chunkRows(account.id)).toHaveLength(before.length)
      expect((await formats(account.id)).every((f) => f === 1 || f === 2)).toBe(true)
    }
  })

  it('costs the same on or off when there is nothing to fill', async () => {
    const run = async () => {
      const { client } = await signUp()
      const { importKey } = await newAccount(client)
      const pieces = withoutRolls(rolledPieces(30))
      const costs: Cost[] = []
      costs.push((await upload(importKey, capture(pieces, 1), 1_000)).cost) // store
      costs.push((await upload(importKey, capture(pieces, 1, 5000), 2_000)).cost) // seen, read
      costs.push((await upload(importKey, capture(pieces, 1, 5000), 3_000)).cost) // held
      costs.push((await upload(importKey, capture(pieces, 1, 5000), 3_000)).cost) // re-upload
      costs.push((await upload(importKey, capture(pieces, 2, 5000), 4_000)).cost) // stored, held
      return costs.map((c) => [c['round-trips'], c['rows-written']])
    }
    const off = await run()
    await setSwitch('1')
    const on = await run()
    expect(on).toEqual(off)
  })
})

// --------------------------------------------------------------------- fill

describe('filling the rolls of pieces the catalog has', () => {
  it('fills on a later upload of the same bag, then marks, then holds', async () => {
    await setSwitch('1')
    const { client } = await signUp()
    const { account, importKey } = await newAccount(client)
    const pieces = rolledPieces(600)
    const plain = capture(withoutRolls(pieces))
    const first = await upload(importKey, plain, 1_000)
    expect(first.status).toBe('created')
    const ids = [...(await storedRolls(account.id)).keys()]
    expect([...(await storedRolls(account.id)).values()].every((r) => r === undefined)).toBe(true)
    const markBefore = await markOf(account.id)
    expect(markBefore!.fingerprint).toBe(await fingerprintOf(plain))
    const version = await dataVersion(account.id)

    // The same bag with rolls: no new snapshot, the same ids, rolls stored.
    const rolled = capture(pieces)
    const filled = await upload(importKey, rolled, 2_000)
    expect(filled.status).toBe('unchanged')
    expect(filled.cost['round-trips']).toBe(2)
    // The seen batch (last_seen_at, data version) and one row per chunk (two chunks).
    expect(filled.cost['rows-written']).toBe(4)
    expect([...(await storedRolls(account.id)).keys()]).toEqual(ids)
    const want = await rollsByKey(rolled)
    const now = await rollsOfKeys(account.id)
    for (const [key, rolls] of want) expect(now.get(key)).toBe(rolls)
    expect(await dataVersion(account.id)).toBeGreaterThan(version)
    expect(await formats(account.id)).toEqual([4, 4])
    // No mark in a batch that carries a fill.
    expect(await markOf(account.id)).toEqual(markBefore)
    const list = await client.json<SnapshotResponse[]>(`/api/accounts/${account.id}/snapshots`)
    expect(list).toHaveLength(1)

    // The next upload of that list: read in full, nothing to fill, the mark.
    const chunks = await chunkRows(account.id)
    const marked = await upload(importKey, { ...rolled }, 3_000)
    expect(marked.status).toBe('unchanged')
    expect(marked.cost['round-trips']).toBe(2)
    expect(marked.cost['rows-written']).toBe(filled.cost['rows-written']! - 2 + 1)
    expect(await chunkRows(account.id)).toEqual(chunks)
    expect((await markOf(account.id))!.fingerprint).toBe(await fingerprintOf(rolled))

    // And the one after that stands on it: the catalog is not read.
    const meter = new D1Meter()
    const held = await importSnapshot(
      env.DB,
      { id: account.id, uid: String(UID) },
      asUpload(rolled, 4_000),
      meter,
    )
    expect(held.response.status).toBe('unchanged')
    expect(held.heldArtifacts).toBe(true)
    expect(meter.roundTrips).toBe(2)
  })

  it('writes nothing on the exact re-upload of a capture, and fills on the next one', async () => {
    await setSwitch('1')
    const { client } = await signUp()
    const { account, importKey } = await newAccount(client)
    const pieces = rolledPieces(30)
    await upload(importKey, capture(withoutRolls(pieces)), 1_000)
    // The same capture time, now with rolls: still one round trip, no row written.
    const again = await upload(importKey, capture(pieces), 1_000)
    expect(again.status).toBe('unchanged')
    expect(again.cost['round-trips']).toBe(1)
    expect(again.cost['rows-written']).toBe(0)
    expect([...(await storedRolls(account.id)).values()].every((r) => r === undefined)).toBe(true)
    // The next ordinary upload fills.
    await upload(importKey, capture(pieces), 2_000)
    expect([...(await storedRolls(account.id)).values()].filter(Boolean)).toHaveLength(30)
  })

  it('writes new pieces with their rolls, at no more rows than without', async () => {
    await setSwitch('1')
    const pieces = rolledPieces(2400)
    const costOf = async (good: Loose) => {
      const { client } = await signUp()
      const { account, importKey } = await newAccount(client)
      const result = await upload(importKey, good, 1_000)
      expect(result.status).toBe('created')
      return { account, cost: result.cost }
    }
    const rolled = await costOf(capture(pieces))
    const plain = await costOf(capture(withoutRolls(pieces)))
    expect(rolled.cost['round-trips']).toBe(plain.cost['round-trips'])
    expect(rolled.cost['rows-written']).toBe(plain.cost['rows-written'])
    expect(await formats(rolled.account.id)).toEqual([4, 4, 4, 4, 4])
    const stored = await rollsOfKeys(rolled.account.id)
    for (const [key, rolls] of await rollsByKey(capture(pieces))) {
      expect(stored.get(key)).toBe(rolls)
    }
  })

  it('costs no writes for rolls that all fail the check, or a gi_rolls of absurd length', async () => {
    await setSwitch('1')
    const pieces = rolledPieces(1500)
    const bad = pieces.map((p) => ({ ...p, gi_rolls: '04'.repeat(9) }))
    // 100 pieces of 40 KB of digits: 4 MB of rolls the reader skips unread.
    const absurd = [
      ...pieces.slice(0, 100).map((p) => ({ ...p, gi_rolls: '01'.repeat(20_000) })),
      ...withoutRolls(pieces.slice(100)),
    ]
    const results: Cost[][] = []
    for (const list of [withoutRolls(pieces), bad, absurd]) {
      const { client } = await signUp()
      const { account, importKey } = await newAccount(client)
      const costs = [(await upload(importKey, capture(withoutRolls(pieces)), 1_000)).cost]
      costs.push((await upload(importKey, capture(list, 1, 9000), 2_000)).cost)
      results.push(costs)
      expect([...(await storedRolls(account.id)).values()].every((r) => r === undefined)).toBe(true)
      // Nothing to fill: the list is marked as ever.
      expect((await markOf(account.id))!.fingerprint).toBe(
        await fingerprintOf(capture(list, 1, 9000)),
      )
    }
    const [plain, ...hostile] = results
    for (const costs of hostile) {
      expect(costs.map((c) => [c['round-trips'], c['rows-written']])).toEqual(
        plain!.map((c) => [c['round-trips'], c['rows-written']]),
      )
    }
  })

  it('marks a list whose only unfilled pieces are refused or conflicting rolls', async () => {
    await setSwitch('1')
    const { client } = await signUp()
    const { account, importKey } = await newAccount(client)
    const pieces = rolledPieces(10)
    const [a, b] = twins()
    const [bare] = withoutRolls(rolledPieces(1, 99))
    await upload(importKey, capture([...pieces, a, bare!]), 1_000)
    const stored = await rollsOfKeys(account.id)
    // b conflicts with a's stored rolls; bare's rolls are refused by the check.
    const next = capture([...pieces, b, { ...bare, gi_rolls: '04'.repeat(9) }], 1, 7000)
    expect((await upload(importKey, next, 2_000)).status).toBe('unchanged')
    expect(await rollsOfKeys(account.id)).toEqual(stored)
    expect((await markOf(account.id))!.fingerprint).toBe(await fingerprintOf(next))
  })
})

/** Two pieces of one identity whose valid rolls differ (the upgrades in another order). */
function twins(): [Loose, Loose] {
  return [
    piece([
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [0, 2],
      [1, 3],
      [2, 4],
      [3, 1],
      [0, 3],
    ]),
    piece([
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [3, 1],
      [2, 4],
      [1, 3],
      [0, 2],
      [0, 3],
    ]),
  ]
}

describe('which rolls win', () => {
  it('keeps the first valid rolls of an identity, in one upload and across two', async () => {
    await setSwitch('1')
    const warn = vi.spyOn(console, 'warn')
    const [a, b] = twins()
    expect(a.substats).toEqual(b.substats)
    expect(a.gi_rolls).not.toBe(b.gi_rolls)
    const { client } = await signUp()
    const { account, importKey } = await newAccount(client)
    await upload(importKey, capture([a, b]), 1_000)
    const key = artifactKeyString(
      (await prepareSnapshot(capture([a]), { materials: MATERIALS })).good.artifacts.at(-1)!
        .identity,
    )
    expect((await rollsOfKeys(account.id)).get(key)).toBe(a.gi_rolls)
    expect(warn).toHaveBeenCalledWith(
      'rolls_conflict',
      JSON.stringify({ accountId: account.id, count: 1 }),
    )
    // A later upload of the other twin alone: the stored rolls stay.
    await upload(importKey, capture([b], 2), 2_000)
    expect((await rollsOfKeys(account.id)).get(key)).toBe(a.gi_rolls)
    warn.mockRestore()

    // The first twin without the key, the second with it: the second's rolls.
    const second = await signUp()
    const { account: other, importKey: otherKey } = await newAccount(second.client)
    const { gi_rolls: _, ...bare } = a
    await upload(otherKey, capture([bare, b]), 1_000)
    expect((await rollsOfKeys(other.id)).get(key)).toBe(b.gi_rolls)
  })
})

// ------------------------------------------------------------- races, marks

/** env.DB whose `at`-th batch first runs `hook` (another writer getting in between). */
function racing(at: number, hook: () => Promise<unknown>): D1Database {
  let calls = 0
  return new Proxy(env.DB, {
    get(target, prop) {
      if (prop === 'batch') {
        return async (statements: D1PreparedStatement[]) => {
          if (++calls === at) await hook()
          return target.batch(statements)
        }
      }
      const value = Reflect.get(target, prop) as unknown
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

const asUpload = (good: unknown, timestamp: number) => {
  const text = JSON.stringify(good)
  return { text, rawSize: text.length, timestamp }
}

/** Rewrites every chunk row of the account as the same entries stored undeflated (other bytes). */
async function touchChunks(accountId: number): Promise<void> {
  for (const row of await chunkRows(accountId)) {
    const parts = readCatalogChunk(row.data)
    const format = row.data[0] === 2 ? 1 : row.data[0] === 4 ? 3 : row.data[0]!
    await env.DB.prepare('UPDATE artifact_chunks SET data = ?2 WHERE id = ?1')
      .bind(row.id, new Uint8Array([format, ...parts.body]))
      .run()
  }
}

describe('the held-list mark around fills', () => {
  it('marks a list read in full and seen again (no rolls), so the next one is held', async () => {
    const { client } = await signUp()
    const { account, importKey } = await newAccount(client)
    const pieces = withoutRolls(rolledPieces(50))
    await upload(importKey, capture(pieces, 1), 1_000)
    // The same bag under other guids: another fingerprint, the same content.
    const moved = capture(pieces, 1, 8000)
    const seen = await upload(importKey, moved, 2_000)
    expect(seen.status).toBe('unchanged')
    expect((await markOf(account.id))!.fingerprint).toBe(await fingerprintOf(moved))
    const held = await importSnapshot(
      env.DB,
      { id: account.id, uid: String(UID) },
      asUpload(moved, 3_000),
    )
    expect(held.heldArtifacts).toBe(true)
  })

  it('loses a swap to a concurrent change without harm: no mark, the next upload fills', async () => {
    await setSwitch('1')
    const warn = vi.spyOn(console, 'warn')
    const { client } = await signUp()
    const { account, importKey } = await newAccount(client)
    const pieces = rolledPieces(40)
    const plain = capture(withoutRolls(pieces))
    await upload(importKey, plain, 1_000)
    const markBefore = await markOf(account.id)
    const rolled = capture(pieces)
    // Seen again, but the chunk changes between the lookup and the seen batch.
    const lost = await importSnapshot(
      racing(2, () => touchChunks(account.id)),
      { id: account.id, uid: String(UID) },
      asUpload(rolled, 2_000),
    )
    expect(lost.response.status).toBe('unchanged')
    expect(warn).toHaveBeenCalledWith(
      'rolls_fill_lost',
      JSON.stringify({ accountId: account.id, lost: 1 }),
    )
    warn.mockRestore()
    expect([...(await storedRolls(account.id)).values()].every((r) => r === undefined)).toBe(true)
    expect(await markOf(account.id)).toEqual(markBefore)
    // The next upload of that list is read in full and fills (no mark yet)...
    await upload(importKey, { ...rolled }, 3_000)
    expect([...(await storedRolls(account.id)).values()].filter(Boolean)).toHaveLength(40)
    expect(await markOf(account.id)).toEqual(markBefore)
    // ...and the one after marks it.
    await upload(importKey, { ...rolled }, 4_000)
    expect((await markOf(account.id))!.fingerprint).toBe(await fingerprintOf(rolled))

    // The same on the store path: a snapshot is stored, its fill lost, no mark.
    const newer = rolledPieces(3, 77)
    const more = capture([...withoutRolls(pieces), ...withoutRolls(newer)], 9)
    await upload(importKey, more, 5_000)
    const moreRolled = capture([...pieces, ...newer], 10)
    const before = await markOf(account.id)
    const stored = await importSnapshot(
      racing(2, () => touchChunks(account.id)),
      { id: account.id, uid: String(UID) },
      asUpload(moreRolled, 6_000),
    )
    expect(stored.response.status).toBe('created')
    expect(await markOf(account.id)).toEqual(before)
  })
})

describe('a fill lands on a chunk from every writer', () => {
  it('a chunk written by another upload between the lookup and the id reservation', async () => {
    await setSwitch('1')
    const { client } = await signUp()
    const { account } = await newAccount(client)
    const pieces = rolledPieces(20)
    const good = capture(pieces)
    const prepared = await prepareSnapshot(good, { materials: MATERIALS })
    const x = prepared.good.artifacts.at(-1)!
    // Another upload stores piece x (without rolls) while this one reads.
    const insertX = () =>
      env.DB.prepare(
        `INSERT INTO artifact_chunks (account_id, first_id, last_id, count, data)
         VALUES (?1, 900001, 900001, 1, ?2)`,
      )
        .bind(account.id, encodeCatalogChunk([{ id: 900001, identity: x.identity }]))
        .run()
    const result = await importSnapshot(
      racing(2, insertX),
      { id: account.id, uid: String(UID) },
      asUpload(good, 1_000),
    )
    expect(result.response.status).toBe('created')
    const rolls = await storedRolls(account.id)
    expect(rolls.get(900001)).toBe(x.rolls)
    // x is stored once: under the other upload's id.
    expect((await rollsOfKeys(account.id)).size).toBe(rolls.size)
    expect(rolls.size).toBe(22)
  })

  it('chunks from the v1 conversion and from the daily merge', async () => {
    await setSwitch('1')
    const pieces = rolledPieces(30)
    const good = capture(pieces)
    const prepared = await prepareSnapshot(good, { materials: MATERIALS })
    const identities = [
      ...new Map(prepared.good.artifacts.map((a) => [artifactKeyString(a.identity), a])).values(),
    ]

    // v1 rows moved into a chunk by catalogChunkStatements.
    const { client } = await signUp()
    const { account } = await newAccount(client)
    const entries: { id: number; identity: ArtifactIdentity }[] = []
    for (const [i, a] of identities.entries()) {
      const row = await env.DB.prepare(
        `INSERT INTO artifacts (account_id, hash, set_key, slot_key, level, rarity, main_stat_key,
           substats, unactivated_substats, total_rolls, elixer_crafted, created_at)
         VALUES (?1, ?2, '', '', 0, 0, '', '[]', '[]', 0, 0, 0) RETURNING id`,
      )
        .bind(account.id, `v1-${i}`)
        .first<{ id: number }>()
      entries.push({ id: row!.id, identity: a.identity })
    }
    await env.DB.batch(catalogChunkStatements(env.DB, account.id, entries))
    expect(await chunkRows(account.id)).toHaveLength(1)
    await importSnapshot(env.DB, { id: account.id, uid: String(UID) }, asUpload(good, 1_000))
    const v1 = await storedRolls(account.id)
    const want = await rollsByKey(good)
    for (const e of entries) {
      expect(v1.get(e.id)).toBe(want.get(artifactKeyString(e.identity)))
    }

    // Two small chunks merged by the maintenance, then filled.
    const other = await signUp()
    const { account: merged, importKey } = await newAccount(other.client)
    await setSwitch(null)
    await upload(importKey, capture(pieces.slice(0, 15)), 1_000)
    await upload(importKey, capture(pieces), 2_000)
    const rows = await chunkRows(merged.id)
    expect(rows).toHaveLength(2)
    await env.DB.batch(mergeChunkStatements(env.DB, merged.id, rows).statements)
    expect(await chunkRows(merged.id)).toHaveLength(1)
    await setSwitch('1')
    await upload(importKey, capture(pieces, 3), 3_000)
    const after = await rollsOfKeys(merged.id)
    for (const [key, rolls] of want) expect(after.get(key)).toBe(rolls)
  })
})

// ------------------------------------------------------------- maintenance

describe('the daily merge of small chunks', () => {
  async function twoChunks() {
    const { client } = await signUp()
    const { account, importKey } = await newAccount(client)
    const pieces = rolledPieces(20, 5)
    await upload(importKey, capture(withoutRolls(pieces.slice(0, 10))), 1_000)
    await upload(importKey, capture(withoutRolls(pieces)), 2_000)
    const rows = await chunkRows(account.id)
    expect(rows).toHaveLength(2)
    return { account, rows, good: capture(pieces) }
  }

  it('writes nothing over a fill that landed after it read the chunks', async () => {
    const { account, rows, good } = await twoChunks()
    const plan = mergeChunkStatements(env.DB, account.id, rows)
    expect(plan.merged).toBe(2)
    // An import fills the second chunk in between.
    const filled = fillCatalogChunk(rows[1]!.data, await rollsByKey(good))
    expect(filled).not.toBe(rows[1]!.data)
    await env.DB.prepare('UPDATE artifact_chunks SET data = ?2 WHERE id = ?1')
      .bind(rows[1]!.id, filled)
      .run()
    await env.DB.batch(plan.statements)
    const now = await chunkRows(account.id)
    expect(now.map((r) => r.id)).toEqual(rows.map((r) => r.id))
    expect(now[1]!.data).toEqual(filled)
  })

  it('carries rolls through, and keeps the copy with rolls of an id held twice', async () => {
    const { account, rows, good } = await twoChunks()
    const want = await rollsByKey(good)
    const filled = fillCatalogChunk(rows[0]!.data, want)
    await env.DB.prepare('UPDATE artifact_chunks SET data = ?2 WHERE id = ?1')
      .bind(rows[0]!.id, filled)
      .run()
    // A second, roll-less copy of the first chunk's entries (an old merge), after it.
    await env.DB.prepare(
      `INSERT INTO artifact_chunks (account_id, first_id, last_id, count, data)
       VALUES (?1, ?2, ?2, ?3, ?4)`,
    )
      .bind(account.id, rows[0]!.first_id, rows[0]!.count, rows[0]!.data)
      .run()
    const read = await chunkRows(account.id)
    expect(read).toHaveLength(3)
    const filledIds = new Set(decodeCatalogChunk(rows[0]!.data).map((e) => e.id))
    // Whichever copy comes first, the merged chunk keeps the rolls.
    for (const order of [read, [read[2]!, read[1]!, read[0]!]]) {
      const plan = mergeChunkStatements(env.DB, account.id, order)
      expect(plan.merged).toBe(3)
    }
    await env.DB.batch(
      mergeChunkStatements(env.DB, account.id, [read[2]!, read[0]!, read[1]!]).statements,
    )
    const now = await chunkRows(account.id)
    expect(now).toHaveLength(1)
    const entries = decodeCatalogChunk(now[0]!.data)
    expect(entries).toHaveLength(22)
    for (const entry of entries) {
      expect(entry.rolls).toBe(filledIds.has(entry.id) ? want.get(entry.key) : undefined)
    }
    expect(entries.filter((e) => e.rolls)).toHaveLength(10)
  })
})

// ----------------------------------------------------------------- reading

describe('reading the rolls back', () => {
  /** The catalog route's answer as it was before rolls: CatalogRow of ten elements. */
  async function oldCatalogJson(accountId: number): Promise<string> {
    const rows: CatalogRow[] = []
    for (const row of await chunkRows(accountId)) {
      for (const { id, identity: a } of decodeCatalogChunk(row.data)) {
        rows.push([
          id,
          a.setKey,
          a.slotKey,
          a.level,
          a.rarity,
          a.mainStatKey,
          a.substats.map((s) =>
            s.initialValue === undefined ? [s.key, s.value] : [s.key, s.value, s.initialValue],
          ),
          a.totalRolls,
          a.elixirCrafted ? 1 : 0,
          a.unactivatedSubstats.map((s) =>
            s.initialValue === undefined ? [s.key, s.value] : [s.key, s.value, s.initialValue],
          ),
        ])
      }
    }
    return JSON.stringify(rows.sort((x, y) => x[0] - y[0]))
  }

  it('gives gi_rolls and the eleventh element for filled pieces, the old bytes for others', async () => {
    const { client } = await signUp()
    const { account, importKey } = await newAccount(client)
    const pieces = rolledPieces(30, 3)
    await upload(importKey, capture(withoutRolls(pieces)), 1_000)
    const base = `/api/accounts/${account.id}`
    const text = async (path: string) => (await client.fetch(path)).text()
    // No rolls: exactly the answer from before.
    expect(await text(`${base}/catalog`)).toBe(await oldCatalogJson(account.id))
    const [snapshot] = await client.json<SnapshotResponse[]>(`${base}/snapshots`)
    const plainGood = await text(`${base}/snapshots/${snapshot!.id}/good`)
    expect(plainGood).not.toContain('gi_rolls')

    await setSwitch('1')
    await upload(importKey, capture(pieces), 2_000)
    const rows = JSON.parse(await text(`${base}/catalog`)) as CatalogRow[]
    expect(rows.filter((r) => r.length === 11)).toHaveLength(30)
    expect(rows.filter((r) => r.length === 10)).toHaveLength(2) // sampleGood's two
    expect([...catalogFromRows(rows).values()].filter((e) => e.rolls)).toHaveLength(30)
    const good = JSON.parse(await text(`${base}/snapshots/${snapshot!.id}/good`)) as Good
    const rolled = good.artifacts.filter((a) => a.gi_rolls)
    expect(rolled.map((a) => a.gi_rolls).sort()).toEqual(pieces.map((p) => p.gi_rolls).sort())
    // Without the key, the file is the one from before.
    expect(
      JSON.stringify({ ...good, artifacts: good.artifacts.map(({ gi_rolls: _, ...a }) => a) }),
    ).toBe(plainGood)
  })

  it('never lets a roll-less copy of an id hide its rolls, whatever the row order', async () => {
    const { client } = await signUp()
    const { account, importKey } = await newAccount(client)
    const pieces = rolledPieces(10, 4)
    await upload(importKey, capture(withoutRolls(pieces)), 1_000)
    const [row] = await chunkRows(account.id)
    const filled = fillCatalogChunk(row!.data, await rollsByKey(capture(pieces)))
    const insert = (data: Uint8Array) =>
      env.DB.prepare(
        `INSERT INTO artifact_chunks (account_id, first_id, last_id, count, data)
         VALUES (?1, ?2, ?2, ?3, ?4)`,
      )
        .bind(account.id, row!.first_id, row!.count, data)
        .run()
    const base = `/api/accounts/${account.id}`
    const [snapshot] = await client.json<SnapshotResponse[]>(`${base}/snapshots`)
    const check = async () => {
      const catalog = await loadCatalog(env.DB, account.id, null)
      expect([...catalog.values()].filter((e) => e.rolls)).toHaveLength(10)
      // The routes' answers are cached by data version: move it.
      await env.DB.prepare(
        'UPDATE genshin_accounts SET data_version = data_version + 1 WHERE id = ?1',
      )
        .bind(account.id)
        .run()
      const rows = await client.json<CatalogRow[]>(`${base}/catalog`)
      expect(rows.filter((r) => r.length === 11)).toHaveLength(10)
      const good = await client.json<Good>(`${base}/snapshots/${snapshot!.id}/good`)
      expect(good.artifacts.filter((a) => a.gi_rolls)).toHaveLength(10)
    }
    await insert(filled) // after the roll-less row
    await check()
    await env.DB.prepare('DELETE FROM artifact_chunks WHERE id = ?1').bind(row!.id).run()
    await insert(row!.data) // the roll-less copy now after the one with rolls
    await check()
  })
})

// --------------------------------------------------------------- account UID

describe("filling the account from a file's UID", () => {
  async function bareAccount(client: Client) {
    const { account } = await newAccount(client)
    await env.DB.prepare(
      'UPDATE genshin_accounts SET uid = NULL, server = NULL, name = NULL WHERE id = ?1',
    )
      .bind(account.id)
      .run()
    return account
  }

  it('names the account only from a gi_player whose own uid is used', async () => {
    const { client } = await signUp()
    const account = await bareAccount(client)
    const file = {
      ...sampleGood(),
      gi_player: { uid: 'not a uid', nickname: 'player01', ar: 60 },
      metadata: { uid: String(UID) },
    }
    const parsed = await prepareSnapshot(file, { materials: MATERIALS })
    expect(parsed.good.player?.uid).toBeUndefined()
    expect(parsed.good.player?.nickname).toBe('player01')
    await importSnapshot(env.DB, { id: account.id, uid: null }, asUpload(file, 1_000))
    expect(await client.json<AccountResponse>(`/api/accounts/${account.id}`)).toMatchObject({
      uid: String(UID),
      server: 'ASIA',
      name: null,
    })
    // The same with a sound gi_player.uid names it, as ever.
    const named = await bareAccount((await signUp()).client)
    const ok = { ...file, gi_player: { ...file.gi_player, uid: UID } }
    await importSnapshot(env.DB, { id: named.id, uid: null }, asUpload(ok, 1_000))
    const row = await env.DB.prepare('SELECT name FROM genshin_accounts WHERE id = ?1')
      .bind(named.id)
      .first<{ name: string }>()
    expect(row!.name).toBe('player01')
  })

  it('fills UID and server on a website upload of a file with only metadata.uid', async () => {
    const { client } = await signUp()
    const account = await bareAccount(client)
    const file = { ...sampleGood(), source: 'yas-GOODScanner', metadata: { uid: String(UID) } }
    const response = await client.fetch(`/api/accounts/${account.id}/import`, {
      method: 'POST',
      body: irminsulForm(file, 1_000),
    })
    expect(response.status, await response.clone().text()).toBe(201)
    expect(await client.json<AccountResponse>(`/api/accounts/${account.id}`)).toMatchObject({
      uid: String(UID),
      server: 'ASIA',
    })
  })
})
