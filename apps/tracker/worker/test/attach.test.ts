import {
  decodeBundle,
  decodeExtras,
  type AccountCreatedResponse,
  type AttachResponse,
  type ExtrasSection,
  type Good,
  type ImportResponse,
} from '@gdt/shared'
import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { syntheticEndgame } from '../../../../packages/shared/test/synthetic'
import { ORIGIN, irminsulForm, sampleGood, signUp } from './client'

const UID = 812345678
const SESSION = '01J9ZK5Q8W3E7R2T'

function importByKey(key: string, good: unknown, timestamp?: number) {
  return SELF.fetch(`${ORIGIN}/api/genshin-accounts-public/import-by-key`, {
    method: 'POST',
    headers: { 'x-import-key': key },
    body: irminsulForm(good, timestamp),
  })
}

async function setup() {
  const { client } = await signUp()
  const { account, importKey } = await client.json<AccountCreatedResponse>('/api/accounts', {
    method: 'POST',
    json: { name: 'Main', uid: String(UID), server: 'ASIA' },
  })
  return { client, account, importKey }
}

const login = (session = SESSION) => ({
  gi_capture: { v: 1, reason: 'login', session, world: 1, journal: { seq: 0 } },
})

function attach(key: string, body: unknown, headers: Record<string, string> = {}) {
  return SELF.fetch(`${ORIGIN}/api/irminsul/attach`, {
    method: 'POST',
    headers: { 'x-import-key': key, 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

async function storedEndgame(client: { fetch: (path: string) => Promise<Response> }, id: number) {
  const { snapshots, texts } = await decodeBundle(
    await (await client.fetch(`/api/accounts/${id}/bundle?sections=extras&format=2`)).arrayBuffer(),
  )
  return snapshots.map((s) =>
    s.extras ? decodeExtras(JSON.parse(texts.get(s.extras)!) as ExtrasSection).endgame : null,
  )
}

describe("Teyvat.me Capture 1.17.21's attach (POST /api/irminsul/attach)", () => {
  const endgame = syntheticEndgame(11)
  const book = {
    periods: [
      {
        season: 123,
        floor: 12,
        chamber: 3,
        stars: 36,
        strike: { value: 6_424_192, by: 'Mavuika' },
        picked: [{ key: 'Mavuika', times: 17 }],
      },
    ],
  }

  it("writes the posted parts into the session's newest snapshot and keeps the rest", async () => {
    const { client, account, importKey } = await setup()
    const theaterOnly = { ...login(), gi_endgame: { theater: endgame.theater } }
    const first = (await (
      await importByKey(importKey, sampleGood(theaterOnly), 1_000)
    ).json()) as ImportResponse
    expect(first.status).toBe('created')
    const response = await attach(importKey, {
      v: 1,
      uid: UID,
      session: SESSION,
      gi_endgame: { stygian: endgame.stygian, abyss: book },
    })
    expect(response.status, await response.clone().text()).toBe(200)
    const answer = (await response.json()) as AttachResponse
    expect(answer).toMatchObject({ ok: true, snapshotId: first.snapshotId, takenAt: 1_000 })
    expect(answer.stored).toBeGreaterThan(0)
    expect(answer.dataVersion).toBeGreaterThan(0)
    // The snapshot now holds the login's theater and the attached parts.
    expect(await storedEndgame(client, account.id)).toEqual([
      { theater: endgame.theater, stygian: endgame.stygian, abyss: book },
    ])
    const exported = await client.json<Good>(
      `/api/accounts/${account.id}/snapshots/${first.snapshotId}/good`,
    )
    expect(exported.gi_endgame).toEqual({
      theater: endgame.theater,
      stygian: endgame.stygian,
      abyss: book,
    })
    // The same data again stores nothing; a changed part replaces the whole part.
    const again = (await (
      await attach(importKey, { v: 1, uid: UID, session: SESSION, gi_endgame: { abyss: book } })
    ).json()) as AttachResponse
    expect(again).toMatchObject({ ok: true, stored: 0, dataVersion: 0 })
    const cleared = { ...endgame.theater, acts: 10 }
    const third = (await (
      await attach(importKey, {
        v: 1,
        uid: UID,
        session: SESSION,
        gi_endgame: { theater: cleared },
      })
    ).json()) as AttachResponse
    expect(third.dataVersion).toBeGreaterThan(answer.dataVersion)
    expect((await storedEndgame(client, account.id))[0]!.theater).toEqual(cleared)
    // The login's own file re-uploaded at its time is still a no-op (the
    // content key is the login's), and the list still has one snapshot.
    const re = (await (
      await importByKey(importKey, sampleGood(theaterOnly), 1_000)
    ).json()) as ImportResponse
    expect(re.status).toBe('unchanged')
    expect(await storedEndgame(client, account.id)).toHaveLength(1)
  })

  it('refuses another session, an account without a snapshot and bad data', async () => {
    const { importKey } = await setup()
    const none = await attach(importKey, {
      v: 1,
      uid: UID,
      session: SESSION,
      gi_endgame: { abyss: book },
    })
    expect(none.status).toBe(404)
    expect(((await none.json()) as { error: { code: string } }).error.code).toBe('no_snapshot')
    await importByKey(
      importKey,
      sampleGood({ ...login('01J9ZK5Q8W3E7R2U'), gi_endgame: endgame }),
      1_000,
    )
    const other = await attach(importKey, {
      v: 1,
      uid: UID,
      session: SESSION,
      gi_endgame: { abyss: book },
    })
    expect(other.status).toBe(409)
    expect(((await other.json()) as { error: { code: string } }).error.code).toBe(
      'session_mismatch',
    )
    const bad = await attach(importKey, {
      v: 1,
      uid: UID,
      session: '01J9ZK5Q8W3E7R2U',
      gi_endgame: { abyss: { periods: [{ season: 'x' }] } },
    })
    expect(bad.status).toBe(400)
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe('invalid_endgame')
    const shape = await attach(importKey, { v: 2, uid: UID, session: SESSION, gi_endgame: {} })
    expect(shape.status).toBe(400)
    // An account key uploads to its account whatever the UID says (as imports
    // do): the newest snapshot is still the other session's.
    const unknown = await attach(importKey, {
      v: 1,
      uid: 823456789,
      session: SESSION,
      gi_endgame: { abyss: book },
    })
    expect(unknown.status).toBe(409)
    const noKey = await SELF.fetch(`${ORIGIN}/api/irminsul/attach`, { method: 'POST', body: '{}' })
    expect(noKey.status).toBe(401)
  })
})
