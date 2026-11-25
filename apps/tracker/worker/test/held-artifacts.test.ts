/**
 * docs/plans/lighter-upload.md, step 1: an upload whose artifact list this
 * account already has a section of (same fingerprint) is stored without
 * reading the list. Every test holds the result against the ordinary path.
 */
import {
  encodeArtifacts,
  normalizeArtifactList,
  prepareSnapshot,
  resolveDeferredArtifacts,
  type AccountCreatedResponse,
  type Good,
  type ImportResponse,
  type LiveJournalResponse,
  type SnapshotResponse,
} from '@gdt/shared'
import { MATERIALS } from '@gdt/shared/dictionary/materials'
import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { importSnapshot, parseUpload } from '../services/import'
import { Client, ORIGIN, bigGood, irminsulForm, sampleExtras, signUp } from './client'

const UID = 812345678
const SESSION = '01J9ZK5Q8W3E7R2T'
const TOP = BigInt(UID) << 32n
const guid = (n: number) => (TOP + BigInt(n)).toString()

type Loose = Record<string, any>

/** A capture as Capture sends it: a guid on every item, a gi_capture. */
function capture(world = 1): Loose {
  const good = bigGood(sampleExtras(UID)) as Loose
  return {
    ...good,
    artifacts: good.artifacts.map((a: object, i: number) => ({ ...a, gi_guid: guid(1000 + i) })),
    weapons: good.weapons.map((w: object, i: number) => ({ ...w, gi_guid: guid(500 + i) })),
    gi_capture: { v: 1, reason: 'login', session: SESSION, world, journal: { seq: 0 } },
  }
}

/** The same list in another order, as Capture's hash maps give it on another login. */
const shuffled = <T>(list: T[]): T[] =>
  list
    .map((item, i) => [((i * 7919) % 104_729) + i / 1e6, item] as const)
    .sort((a, b) => a[0] - b[0])
    .map(([, item]) => item)

async function account(client: Client) {
  return client.json<AccountCreatedResponse>('/api/accounts', {
    method: 'POST',
    json: { name: 'Main', uid: String(UID), server: 'ASIA' },
  })
}

const upload = (good: unknown, timestamp: number) => {
  const text = JSON.stringify(good)
  return { text, rawSize: text.length, timestamp }
}

/** The steps of a play day: what each upload changed against the one before. */
function steps(): Loose[] {
  const first = capture(1)
  // The same pieces in another order, a count moved.
  const second = {
    ...capture(2),
    artifacts: shuffled(first.artifacts),
    materials: { ...first.materials, Mora: 4_242 },
  }
  // A piece levelled.
  const third = capture(3)
  third.artifacts[7] = { ...third.artifacts[7], level: 16, substats: [{ key: 'atk_', value: 5.8 }] }
  third.materials = second.materials
  // Those pieces again, a piece's wearer aside: only a count moved.
  const fourth = { ...capture(4), artifacts: shuffled(third.artifacts), materials: { Mora: 99 } }
  return [first, second, third, fourth, { ...fourth }]
}

describe('an upload whose artifact list is stored already', () => {
  it('reads a deferred list exactly as an upload read in full', async () => {
    const good = capture()
    const deferred = await prepareSnapshot(good, { materials: MATERIALS, deferArtifacts: true })
    expect(deferred.deferred?.fingerprint).toMatch(/^[0-9a-f]{32}$/)
    expect(deferred.good.artifacts).toEqual([])
    const full = await prepareSnapshot(good, { materials: MATERIALS })
    expect(await resolveDeferredArtifacts(deferred)).toEqual(full)

    // The order the list came in is not part of what it is.
    const again = await prepareSnapshot(
      { ...good, artifacts: shuffled(good.artifacts) },
      { materials: MATERIALS, deferArtifacts: true },
    )
    expect(again.deferred?.fingerprint).toBe(deferred.deferred?.fingerprint)
    const other = capture()
    other.artifacts[3].lock = !other.artifacts[3].lock
    const changed = await prepareSnapshot(other, { materials: MATERIALS, deferArtifacts: true })
    expect(changed.deferred?.fingerprint).not.toBe(deferred.deferred?.fingerprint)
  })

  // A stored fingerprint stands for "this list, read by this code". When this
  // test fails, the reading changed: fix the expectation AND raise
  // ARTIFACTS_READING (packages/shared/src/codec/parts.ts), so every account's
  // next upload is read in full once instead of standing on an old reading.
  it('pins how an artifact is read (raise ARTIFACTS_READING when this changes)', () => {
    const raw = [
      {
        setKey: 'GoldenTroupe',
        slotKey: 'flower',
        level: 20,
        rarity: 5,
        mainStatKey: 'hp',
        location: 'Furina',
        lock: true,
        astralMark: true,
        gi_exp: 120,
        totalRolls: 9,
        elixerCrafted: true,
        substats: [
          { key: 'critRate_', value: 3.9, initialValue: 3.9 },
          { key: '', value: 1 },
        ],
        unactivatedSubstats: [{ key: 'hp', value: 299 }],
        gi_guid: '7',
        somethingNew: 1,
        // Rolls that do not fit the piece are dropped.
        gi_rolls: '04',
      },
      { gi_guid: '8' },
      {
        setKey: 'GoldenTroupe',
        slotKey: 'plume',
        level: 4,
        rarity: 5,
        mainStatKey: 'atk',
        totalRolls: 5,
        substats: [
          { key: 'critRate_', value: 6.6, initialValue: 2.7 },
          { key: 'hp', value: 239, initialValue: 239 },
          { key: 'def', value: 21, initialValue: 21 },
          { key: 'eleMas', value: 23, initialValue: 23 },
        ],
        gi_rolls: '0112233404',
        gi_guid: '9',
      },
    ]
    const { artifacts, guids } = normalizeArtifactList(raw)
    expect(guids).toEqual(['7', '8', '9'])
    expect(JSON.stringify(artifacts)).toBe(
      '[{"identity":{"setKey":"GoldenTroupe","slotKey":"flower","level":20,"rarity":5,' +
        '"mainStatKey":"hp","substats":[{"key":"critRate_","value":3.9,"initialValue":3.9}],' +
        '"totalRolls":9,"elixirCrafted":true,"unactivatedSubstats":[{"key":"hp","value":299}]},' +
        '"state":{"location":"Furina","lock":true,"astralMark":true,"exp":120}},' +
        '{"identity":{"setKey":"","slotKey":"","level":0,"rarity":0,"mainStatKey":"",' +
        '"substats":[],"totalRolls":0,"elixirCrafted":false,"unactivatedSubstats":[]},' +
        '"state":{"location":"","lock":false,"astralMark":false}},' +
        '{"identity":{"setKey":"GoldenTroupe","slotKey":"plume","level":4,"rarity":5,' +
        '"mainStatKey":"atk","substats":[{"key":"critRate_","value":6.6,"initialValue":2.7},' +
        '{"key":"hp","value":239,"initialValue":239},{"key":"def","value":21,"initialValue":21},' +
        '{"key":"eleMas","value":23,"initialValue":23}],"totalRolls":5,"elixirCrafted":false,' +
        '"unactivatedSubstats":[]},"state":{"location":"","lock":false,"astralMark":false},' +
        '"rolls":"0112233404"}]',
    )
    const section = encodeArtifacts(artifacts.map((a, i) => ({ id: i + 1, state: a.state })))
    expect(JSON.stringify(section)).toBe('{"i":[1,1,1],"l":[36,0,0],"f":[483,0,0]}')
  })

  it('reads a list in full when it cannot be told apart by guid, or would be refused', async () => {
    const options = { materials: MATERIALS, deferArtifacts: true }
    const good = capture()
    const noGuid = { ...good, artifacts: good.artifacts.map(({ gi_guid: _, ...a }: Loose) => a) }
    expect((await prepareSnapshot(noGuid, options)).deferred).toBeUndefined()
    const twice = { ...good, artifacts: [...good.artifacts, good.artifacts[0]] }
    expect((await prepareSnapshot(twice, options)).deferred).toBeUndefined()
    const none = { ...good, artifacts: [] }
    expect((await prepareSnapshot(none, options)).deferred).toBeUndefined()
    // Over a limit: the ordinary path names what is wrong.
    const long = capture()
    long.artifacts[0].setKey = 'x'.repeat(65)
    await expect(prepareSnapshot(long, options)).rejects.toMatchObject({ code: 'key_too_long' })
    const many = capture()
    many.artifacts[0].substats = Array.from({ length: 7 }, () => ({ key: 'hp', value: 1 }))
    await expect(prepareSnapshot(many, options)).rejects.toMatchObject({ code: 'too_many_items' })
    // No characters beside a bag: still refused as a capture taken mid-login.
    await expect(prepareSnapshot({ ...good, characters: [] }, options)).rejects.toMatchObject({
      code: 'partial_capture',
    })
  })

  it('stores the same snapshots as reading every list would', async () => {
    const a = await signUp()
    const b = await signUp()
    const held = (await account(a.client)).account
    const plain = (await account(b.client)).account
    const flags: boolean[] = []
    for (const [i, good] of steps().entries()) {
      const at = 1_000 * (i + 1)
      const fast = await importSnapshot(env.DB, { id: held.id, uid: String(UID) }, upload(good, at))
      flags.push(fast.heldArtifacts)
      // The ordinary path: the file parsed without setting its list aside.
      const text = JSON.stringify(good)
      const slow = await importSnapshot(
        env.DB,
        { id: plain.id, uid: String(UID) },
        { text, rawSize: text.length, timestamp: at },
        undefined,
        await prepareSnapshot(JSON.parse(text), { materials: MATERIALS }),
      )
      expect(slow.heldArtifacts).toBe(false)
      expect(fast.response.status).toBe(slow.response.status)
      expect(fast.prepared.summary).toEqual(slow.prepared.summary)
    }
    // First upload and the levelled piece are read; the rest stand on a stored section.
    expect(flags).toEqual([false, true, false, true, true])

    const listOf = (client: Client, id: number) =>
      client.json<SnapshotResponse[]>(`/api/accounts/${id}/snapshots`)
    const [fastList, slowList] = [await listOf(a.client, held.id), await listOf(b.client, plain.id)]
    expect(fastList).toHaveLength(4)
    expect(fastList.map((s) => [s.takenAt, s.summary])).toEqual(
      slowList.map((s) => [s.takenAt, s.summary]),
    )
    // What each snapshot gives back is the same file either way.
    const sorted = (good: Good) => ({
      ...good,
      artifacts: [...good.artifacts].map((x) => JSON.stringify(x)).sort(),
    })
    for (const [i, snapshot] of fastList.entries()) {
      const fast = await a.client.json<Good>(
        `/api/accounts/${held.id}/snapshots/${snapshot.id}/good`,
      )
      const slow = await b.client.json<Good>(
        `/api/accounts/${plain.id}/snapshots/${slowList[i]!.id}/good`,
      )
      expect(fast.artifacts).toHaveLength(slow.artifacts.length)
      expect(sorted(fast)).toEqual(sorted(slow))
    }
    // Both accounts store the catalog once: no piece twice, none missing.
    const pieces = (id: number) =>
      env.DB.prepare('SELECT sum(count) AS n FROM artifact_chunks WHERE account_id = ?1')
        .bind(id)
        .first<{ n: number }>()
    expect((await pieces(held.id))!.n).toBe((await pieces(plain.id))!.n)
  })

  it('reads the list after all once the stored section is gone', async () => {
    const { client } = await signUp()
    const { account: target } = await account(client)
    const to = { id: target.id, uid: String(UID) }
    const good = capture()
    expect((await importSnapshot(env.DB, to, upload(good, 1_000))).heldArtifacts).toBe(false)
    // The mark names a section that is no longer there (the daily collection took it).
    await env.DB.prepare('UPDATE part_marks SET blob_id = 999999999 WHERE account_id = ?1')
      .bind(target.id)
      .run()
    const next = await importSnapshot(
      env.DB,
      to,
      upload({ ...good, materials: { Mora: 1 } }, 2_000),
    )
    expect(next.heldArtifacts).toBe(false)
    expect(next.response.status).toBe('created')
    // ...and the upload after that stands on the section it stored.
    const third = await importSnapshot(
      env.DB,
      to,
      upload({ ...good, materials: { Mora: 2 } }, 3_000),
    )
    expect(third.heldArtifacts).toBe(true)
    const list = await client.json<SnapshotResponse[]>(`/api/accounts/${target.id}/snapshots`)
    expect(list.map((s) => s.summary.artifacts)).toEqual([1002, 1002, 1002])
  })

  it('does not read the catalog or a row per artifact when the list is stored', async () => {
    const DIAG = 'test-diag-key-test-diag-key-test-diag-key'
    const { client } = await signUp()
    const { importKey } = await account(client)
    const costed = async (good: unknown, timestamp: number) => {
      const response = await SELF.fetch(`${ORIGIN}/api/genshin-accounts-public/import-by-key`, {
        method: 'POST',
        headers: { 'x-import-key': importKey, 'x-diag-key': DIAG },
        body: irminsulForm(good, timestamp),
      })
      expect(response.status).toBe(201)
      const header = response.headers.get('x-gdt-d1') ?? ''
      return Object.fromEntries(
        header.split(';').map((part) => {
          const [k, v] = part.trim().split('=')
          return [k, Number(v)]
        }),
      )
    }
    const good = capture()
    await costed(good, 1_000)
    const again = await costed({ ...good, materials: { Mora: 5 } }, 2_000)
    expect(again['round-trips']).toBe(2)
    // A piece changed: the list and the catalog's chunks are read.
    const changed = capture()
    changed.artifacts[0].level = 4
    const read = await costed({ ...changed, materials: { Mora: 6 } }, 3_000)
    expect(read['round-trips']).toBe(3)
    expect(again['rows-read']).toBeLessThan(read['rows-read']!)
  })

  it('keeps the journal able to find a touched piece', async () => {
    const { client } = await signUp()
    const { account: target, importKey } = await account(client)
    const send = async (good: unknown, timestamp: number) => {
      const response = await SELF.fetch(`${ORIGIN}/api/genshin-accounts-public/import-by-key`, {
        method: 'POST',
        headers: { 'x-import-key': importKey },
        body: irminsulForm(good, timestamp),
      })
      expect(response.status, await response.clone().text()).toBeLessThan(300)
      return (await response.json()) as ImportResponse
    }
    const touch = async (base: string, piece: number) => {
      const response = await SELF.fetch(`${ORIGIN}/api/irminsul/changes`, {
        method: 'POST',
        headers: { 'x-import-key': importKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          format: 'GOOD-X-delta',
          v: 1,
          uid: UID,
          session: SESSION,
          seq: 1,
          base,
          at: 1_792_000_000_000,
          changes: [['set', ['artifacts', guid(piece), 'lock'], true]],
        }),
      })
      expect(response.status, await response.clone().text()).toBe(200)
      return client.json<LiveJournalResponse>(`/api/accounts/${target.id}/live`)
    }
    const good = capture()
    const first = await send(good, 1_000)
    const before = await touch(first.live!.base, 1005)
    expect(before.items).toEqual([['artifacts', guid(1005), expect.any(Number)]])

    // The same pieces again (a count moved): the stored index stands.
    const second = await send({ ...capture(2), materials: { Mora: 7 } }, 2_000)
    expect(second.live!.base).not.toBe(first.live!.base)
    expect((await touch(second.live!.base, 1005)).items).toEqual(before.items)

    // The same pieces and another weapon: the index is made again, whole.
    const third = capture(3)
    third.materials = { Mora: 8 }
    third.weapons = [...third.weapons, { ...third.weapons[0], level: 1, gi_guid: guid(900) }]
    const after = await send(third, 3_000)
    expect((await touch(after.live!.base, 1010)).items).toEqual([
      ['artifacts', guid(1010), expect.any(Number)],
    ])
  })

  it('takes a parsed upload through parseUpload with its list set aside', async () => {
    const parsed = await parseUpload(JSON.stringify(capture()))
    expect(parsed.deferred).toBeDefined()
    // A file from another tool (no guids) is read as ever.
    const plain = await parseUpload(JSON.stringify(bigGood()))
    expect(plain.deferred).toBeUndefined()
    expect(plain.good.artifacts.length).toBeGreaterThan(1000)
  })
})
