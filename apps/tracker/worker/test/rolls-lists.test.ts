/**
 * GGScanner's per-substat roll lists through the Worker, the guest store and
 * the browser's readers (package T5): stored as `~` rolls, replaced by
 * ordered rolls of the same tiers and never the reverse, given back as
 * per-substat lists, and the zip export's own wiring.
 */
import {
  artifactKeyString,
  catalogFromRows,
  decodeBundle,
  decodeCatalogChunk,
  prepareSnapshot,
  rollValue,
  type AccountCreatedResponse,
  type CatalogEntry,
  type CatalogRow,
  type Good,
  type GoodArtifact,
  type ImportResponse,
  type SnapshotResponse,
} from '@gdt/shared'
import { MATERIALS } from '@gdt/shared/dictionary/materials'
import { env, SELF } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GUEST_ACCOUNT_ID } from '@/local/guest-id'
import { zipDecoder } from '@/data/export-zip'
import { toBytes } from '../services/storage'
import { Client, ORIGIN, irminsulForm, sampleExtras, sampleGood, signUp, withEnv } from './client'
import { loadGuestModules, type GuestStore } from './guest-modules'

const UID = 812345678
type Loose = Record<string, any>

const KEYS = ['critRate_', 'critDMG_', 'atk_', 'eleMas'] as const
const shown = (key: string, n: number) =>
  key.endsWith('_') ? Math.round(n * 10) / 10 : Math.round(n)
const pairsOf = (text: string) =>
  text.match(/../g)!.map((p) => [Number(p[0]), Number(p[1])] as [number, number])

/** A made-up 5★ +20 with Capture's gi_rolls (pairs in game order). */
function ordered(text: string, slotKey = 'flower'): Loose {
  const pairs = pairsOf(text)
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
    gi_rolls: text,
  }
}

/** The same piece as GGScanner writes it: no gi_rolls, each line's values (float noise added). */
function listed(text: string, slotKey = 'flower'): Loose {
  const { gi_rolls: _, ...piece } = ordered(text, slotKey)
  const pairs = pairsOf(text)
  return {
    ...piece,
    substats: piece.substats.map((s: Loose, line: number) => ({
      ...s,
      rolls: pairs.filter(([l]) => l === line).map(([, t]) => rollValue(s.key, 5, t)! + 0.003),
    })),
  }
}

const bare = (piece: Loose): Loose => {
  const { gi_rolls: _, ...rest } = piece
  return { ...rest, substats: rest.substats.map(({ rolls: _r, ...s }: Loose) => s) }
}

/** `~` form of an ordered text: pairs grouped by line, each line in its own order. */
const unordered = (text: string) =>
  '~' +
  pairsOf(text)
    .map((p, i) => [p, i] as const)
    .sort((a, b) => a[0][0] - b[0][0] || a[1] - b[1])
    .map(([[l, t]]) => `${l}${t}`)
    .join('')

// Made-up pieces. A2 is A's tiers per line in another order across lines.
// C and C3 are one identity with other tiers: crit rate 1, 2, 4 and 1, 3, 3
// add up to the same 9.7 from the same first roll.
const A = '041322310412243314'
const A2 = '041322311204243314'
const B = '011121310203142234'
const C = '011223340204121324'
const C3 = '011223340303121324'

function file(artifacts: Loose[], mora = 1): Loose {
  const base = sampleGood(sampleExtras(UID)) as Loose
  return {
    ...base,
    source: 'yas-GOODScanner',
    artifacts: [...base.artifacts, ...artifacts],
    materials: { ...base.materials, Mora: mora },
  }
}

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

const guest = await loadGuestModules()
let store: GuestStore
beforeEach(() => {
  store = new guest.LocalStore(guest.memoryBackend())
  guest.setGuestStore(store)
})
afterEach(async () => {
  guest.setGuestStore(null)
  await setSwitch(null)
})

async function serverAccount() {
  const { client } = await signUp()
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
    const text = await response.text()
    expect(response.status, text).toBeLessThan(300)
    return JSON.parse(text) as ImportResponse
  }
  return { client, id: account.id, upload }
}

const importGuest = async (good: unknown, at: number) => {
  const response = await guest.localFetch(
    `/api/accounts/${GUEST_ACCOUNT_ID}/import?timestamp=${at}`,
    { method: 'POST', body: JSON.stringify(good) },
  )
  expect(response.ok).toBe(true)
  return (await response.json()) as ImportResponse
}
const guestRows = async () =>
  (await (
    await guest.localFetch(`/api/accounts/${GUEST_ACCOUNT_ID}/catalog`, {})
  ).json()) as CatalogRow[]

/** The made-up pieces' rolls in a catalog answer, by slot. */
const rollsOf = (rows: CatalogRow[]) =>
  Object.fromEntries(
    rows.filter((r) => r[1] === 'GladiatorsFinale').map((r) => [r[2], r[10] ?? null]),
  )

/** Every stored rolls text in the account's chunks, by slot. */
async function storedBySlot(accountId: number) {
  const { results } = await env.DB.prepare(
    'SELECT data FROM artifact_chunks WHERE account_id = ?1 ORDER BY id',
  )
    .bind(accountId)
    .all<{ data: unknown }>()
  const out: Record<string, string | null> = {}
  for (const row of results) {
    for (const entry of decodeCatalogChunk(toBytes(row.data))) {
      if (entry.identity.setKey === 'GladiatorsFinale') {
        out[entry.identity.slotKey] = entry.rolls ?? null
      }
    }
  }
  return out
}

/** Runs one upload through the Worker and the guest store; both answer alike. */
async function both(server: Awaited<ReturnType<typeof serverAccount>>, good: Loose, at: number) {
  const [there, here] = [await server.upload(good, at), await importGuest(good, at)]
  expect(here.status).toBe(there.status)
  return there.status
}

describe("GGScanner's roll lists, stored", () => {
  it('stores and fills `~` rolls, lets ordered ones of the same tiers replace them, never the reverse', async () => {
    await setSwitch('1')
    const server = await serverAccount()
    // New: the flower with its lists, the plume without any.
    expect(await both(server, file([listed(A), bare(listed(B, 'plume'))]), 1_000)).toBe('created')
    let want: Record<string, string | null> = { flower: unordered(A), plume: null }
    expect(await storedBySlot(server.id)).toEqual(want)
    expect(rollsOf(await guestRows())).toEqual(want)

    // Seen again later with the plume's lists: filled as `~`.
    expect(await both(server, file([listed(A), listed(B, 'plume')]), 2_000)).toBe('unchanged')
    want = { flower: unordered(A), plume: unordered(B) }
    expect(await storedBySlot(server.id)).toEqual(want)
    expect(rollsOf(await guestRows())).toEqual(want)

    // Capture's ordered rolls of the same tiers replace the `~` ones (here the
    // flower's in another order across lines: still its tiers per line).
    expect(await both(server, file([ordered(A2), ordered(B, 'plume')], 2), 3_000)).toBe('created')
    want = { flower: A2, plume: B }
    expect(await storedBySlot(server.id)).toEqual(want)
    expect(rollsOf(await guestRows())).toEqual(want)

    // Lists again: ordered rolls are never replaced by `~` ones.
    expect(await both(server, file([listed(A), listed(B, 'plume')], 3), 4_000)).toBe('created')
    expect(await storedBySlot(server.id)).toEqual(want)
    expect(rollsOf(await guestRows())).toEqual(want)

    // Server and guest give the same catalog and the same GOOD.
    const rows = await server.client.json<CatalogRow[]>(`/api/accounts/${server.id}/catalog`)
    const here = await guestRows()
    expect(here.map((r) => r.slice(1))).toEqual(rows.map((r) => r.slice(1)))
  })

  it('does not count `~` rolls that agree with stored ordered ones as a conflict', async () => {
    await setSwitch('1')
    const server = await serverAccount()
    await server.upload(file([ordered(C)]), 1_000)
    const warn = vi.spyOn(console, 'warn')
    const conflicts = () => warn.mock.calls.filter(([name]) => name === 'rolls_conflict')
    try {
      // The same tiers per line: no conflict, in a stored snapshot and a sighting.
      await server.upload(file([listed(C)], 2), 2_000)
      await server.upload(file([listed(C)], 2), 3_000)
      // And within one upload: the same piece twice, ordered then listed.
      await server.upload(file([ordered(C), listed(C)], 3), 4_000)
      expect(conflicts()).toEqual([])
      // Other tiers of the same identity still count, `~` or ordered.
      await server.upload(file([listed(C3)], 4), 5_000)
      expect(conflicts()).toEqual([
        ['rolls_conflict', JSON.stringify({ accountId: server.id, count: 1 })],
      ])
      await server.upload(file([ordered(C3)], 5), 6_000)
      expect(conflicts()).toHaveLength(2)
      // Within one upload too: the stored rolls first, then other tiers.
      await server.upload(file([ordered(C), listed(C3)], 6), 7_000)
      expect(conflicts().at(-1)).toEqual([
        'rolls_conflict',
        JSON.stringify({ accountId: server.id, count: 1 }),
      ])
      expect(conflicts()).toHaveLength(3)
    } finally {
      warn.mockRestore()
    }
    expect(await storedBySlot(server.id)).toEqual({ flower: C })
  })

  it('stores nothing from lists while the switch is off, as for gi_rolls', async () => {
    const server = await serverAccount()
    await server.upload(file([listed(A)]), 1_000)
    expect(await storedBySlot(server.id)).toEqual({ flower: null })
  })
})

describe("GGScanner's roll lists, given back", () => {
  it('exports per-substat lists and no gi_rolls; importing the export stores the same rolls', async () => {
    await setSwitch('1')
    const first = await serverAccount()
    await first.upload(file([listed(A), listed(B, 'plume'), ordered(C, 'sands')]), 1_000)
    const [snapshot] = await first.client.json<SnapshotResponse[]>(
      `/api/accounts/${first.id}/snapshots`,
    )
    const exported = JSON.parse(
      await (
        await first.client.fetch(`/api/accounts/${first.id}/snapshots/${snapshot!.id}/good`)
      ).text(),
    ) as Good
    const mine = exported.artifacts.filter((a) => a.setKey === 'GladiatorsFinale')
    const bySlot = (slot: string) => mine.find((a) => a.slotKey === slot)!
    for (const slot of ['flower', 'plume']) {
      expect(bySlot(slot)).not.toHaveProperty('gi_rolls')
      expect(bySlot(slot).substats.every((s) => Array.isArray(s.rolls))).toBe(true)
    }
    // The values are the table's tiers, in each line's order.
    expect(bySlot('flower').substats.map((s) => s.rolls)).toEqual(
      listed(A).substats.map((s: Loose) => s.rolls.map((v: number) => Math.round(v * 100) / 100)),
    )
    // Ordered rolls stay gi_rolls, with no lists.
    expect(bySlot('sands').gi_rolls).toBe(C)
    expect(bySlot('sands').substats.some((s) => 'rolls' in s)).toBe(false)
    // The other artifacts are as without rolls.
    expect(
      exported.artifacts
        .filter((a) => a.setKey !== 'GladiatorsFinale')
        .some((a) => a.substats.some((s) => 'rolls' in s)),
    ).toBe(false)

    const second = await serverAccount()
    await second.upload(exported, 1_000)
    expect(await storedBySlot(second.id)).toEqual(await storedBySlot(first.id))
    expect(await storedBySlot(second.id)).toEqual({
      flower: unordered(A),
      plume: unordered(B),
      sands: C,
    })
    // And the guest store reads the same export to the same rolls.
    await importGuest(exported, 1_000)
    expect(rollsOf(await guestRows())).toEqual(await storedBySlot(first.id))
  })

  it('keeps gi_rolls and per-substat lists in /api/v1 answers (the schemas let them through)', async () => {
    await setSwitch('1')
    const server = await serverAccount()
    await server.upload(file([listed(A), ordered(C, 'sands')]), 1_000)
    const [snapshot] = await server.client.json<SnapshotResponse[]>(
      `/api/accounts/${server.id}/snapshots`,
    )
    const site = JSON.parse(
      await (
        await server.client.fetch(`/api/accounts/${server.id}/snapshots/${snapshot!.id}/good`)
      ).text(),
    ) as Good
    const mine = (artifacts: GoodArtifact[]) =>
      artifacts.filter((a) => a.setKey === 'GladiatorsFinale')
    const want = mine(site.artifacts)
    expect(want.find((a) => a.slotKey === 'sands')!.gi_rolls).toBe(C)
    expect(want.find((a) => a.slotKey === 'flower')!.substats.every((s) => s.rolls)).toBe(true)

    const made = await server.client.fetch('/api/auth/api-tokens', {
      method: 'POST',
      json: { name: 'Bot' },
    })
    expect(made.status).toBe(201)
    const { secret } = (await made.json()) as { secret: string }
    const allow: RateLimit = { limit: async () => ({ success: true }) }
    const unlimited = withEnv(
      Object.fromEntries(
        ['RL_2', 'RL_6', 'RL_10', 'RL_20', 'RL_30', 'RL_60', 'RL_INVALID'].map((n) => [n, allow]),
      ),
    )
    const v1 = async <T>(path: string) => {
      const response = await unlimited(`${ORIGIN}/api/v1/accounts/${server.id}${path}`, {
        headers: { authorization: `Bearer ${secret}`, 'cf-connecting-ip': '2001:db8:aa::1' },
      })
      expect(response.status, path).toBe(200)
      return ((await response.json()) as { data: T }).data
    }
    expect(mine((await v1<Good>('/good')).artifacts)).toEqual(want)
    expect(mine((await v1<Good>(`/snapshots/${snapshot!.id}/good`)).artifacts)).toEqual(want)
    expect(mine(await v1<GoodArtifact[]>('/artifacts?key=GladiatorsFinale'))).toEqual(want)
  })
})

// Loaded untyped: these modules reach the DOM's types.
const load = (name: string): Promise<Record<string, unknown>> =>
  import(/* @vite-ignore */ `@/data/${name}`)
const builds = (await load('character-builds')) as {
  wornArtifact(piece: CatalogEntry, location: string, flags: number): GoodArtifact
}

describe('the zip export and past builds', () => {
  async function account(client: Client, id: number) {
    const path = `/api/accounts/${id}`
    const [snapshot] = await client.json<SnapshotResponse[]>(`${path}/snapshots`)
    const server = JSON.parse(
      await (await client.fetch(`${path}/snapshots/${snapshot!.id}/good`)).text(),
    ) as Good
    const rows = await client.json<CatalogRow[]>(`${path}/catalog`)
    const decoded = await decodeBundle(
      await (await client.fetch(`${path}/bundle?format=3`)).arrayBuffer(),
    )
    return { server, rows, decoded }
  }

  it("decodes each snapshot with the rolls the server's GOOD export gives (export.worker's zipDecoder)", async () => {
    await setSwitch('1')
    const { client, id, upload } = await serverAccount()
    await upload(file([ordered(A), listed(B, 'plume')]), 1_000)
    const { server, rows, decoded } = await account(client, id)
    const mine = server.artifacts.filter((a) => a.setKey === 'GladiatorsFinale')
    expect(mine.find((a) => a.slotKey === 'flower')!.gi_rolls).toBe(A)
    expect(mine.find((a) => a.slotKey === 'plume')!.substats[0]!.rolls).toBeDefined()

    const decode = zipDecoder(decoded.texts, rows, MATERIALS)
    expect(JSON.parse(JSON.stringify(decode(decoded.snapshots[0]!)))).toEqual(server)
  })

  it('gives past builds per-substat lists for `~` rolls that still fit', async () => {
    await setSwitch('1')
    const { client, id, upload } = await serverAccount()
    await upload(file([listed(A)]), 1_000)
    const { rows } = await account(client, id)
    const entry = [...catalogFromRows(rows).values()].find((e) => e.rolls)!
    expect(entry.rolls).toBe(unordered(A))
    const worn = builds.wornArtifact(entry, 'Furina', 0)
    expect(worn).not.toHaveProperty('gi_rolls')
    expect(worn.substats.map((s) => s.rolls)).toEqual(
      listed(A).substats.map((s: Loose) => s.rolls.map((v: number) => Math.round(v * 100) / 100)),
    )
    // The catalog entry keeps its own substats, without lists.
    expect(entry.substats.some((s) => 'rolls' in s)).toBe(false)
    // Rolls that no longer fit: neither shape.
    const stale = builds.wornArtifact({ ...entry, rolls: unordered(B) }, 'Furina', 0)
    expect(stale).not.toHaveProperty('gi_rolls')
    expect(stale.substats.some((s) => 'rolls' in s)).toBe(false)
  })
})

// The made-up pieces are real identities the reader would take apart.
it('the made-up pieces read as intended', async () => {
  const prepared = await prepareSnapshot(
    file([listed(A), ordered(A2), listed(C), ordered(C3), listed(B, 'plume')]),
    { materials: MATERIALS },
  )
  const mine = prepared.good.artifacts.slice(-5)
  expect(mine.map((a) => a.rolls)).toEqual([unordered(A), A2, unordered(C), C3, unordered(B)])
  const key = (i: number) => artifactKeyString(mine[i]!.identity)
  expect(key(0)).toBe(key(1))
  expect(key(2)).toBe(key(3))
  expect(key(0)).not.toBe(key(2))
})
