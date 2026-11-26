/**
 * The neighbour blobs an upload is stored against (import.ts knownBlobs) are
 * decoded only when read, yet the rows are judged as the old up-front decode
 * judged them: a base missing from the table refuses the upload, and a chain
 * deeper than a base of a base, its bases all there, is read (the old loop
 * decoded every row in row order, bases first). Both built by hand here, as
 * neither arises from the import itself.
 */
import {
  blobUsesBase,
  decodeSectionBlob,
  encodeSectionBlob,
  kindCode,
  sectionHashOf,
  shortHashHex,
  type AccountCreatedResponse,
  type DecodedBlob,
  type Good,
} from '@gdt/shared'
import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { toBytes } from '../services/storage'
import { ORIGIN, bigGood, irminsulForm, sampleExtras, signUp } from './client'

async function setup() {
  const { client } = await signUp()
  const { account, importKey } = await client.json<AccountCreatedResponse>('/api/accounts', {
    method: 'POST',
    json: { name: 'Main' },
  })
  const send = async (good: unknown, at: number) => {
    const response = await SELF.fetch(`${ORIGIN}/api/genshin-accounts-public/import-by-key`, {
      method: 'POST',
      headers: { 'x-import-key': importKey },
      body: irminsulForm(good, at),
    })
    return { code: response.status, body: (await response.json()) as Record<string, any> }
  }
  return { client, account, send }
}

const first = bigGood(sampleExtras())
/** One login later: a character levelled and the bag moved (every built slot changes). */
const later: Good = {
  ...first,
  characters: first.characters.map((c, i) => (i === 0 ? { ...c, level: 70 } : c)),
  weapons: first.weapons.map((w, i) => (i === 0 ? { ...w, level: 50 } : w)),
  materials: { ...first.materials, Mora: 1234 },
}

const snapshotCount = async (accountId: number) =>
  (await env.DB.prepare('SELECT count(*) AS n FROM snapshots WHERE account_id = ?1')
    .bind(accountId)
    .first<{ n: number }>())!.n

describe('the neighbour blobs an upload is stored against', () => {
  it('refuse it when one names a base the table lacks, storing nothing', async () => {
    const { account, send } = await setup()
    const stored = await send(first, 1_000)
    expect(stored.body.status).toBe('created')
    // Its achievements section (which the next upload leaves as it is, so it
    // would never be read) now names a base that is not there.
    await env.DB.prepare(
      `UPDATE section_blobs SET base_id = 2000000000
       WHERE id = (SELECT achievements_ref FROM snapshots WHERE id = ?1)`,
    )
      .bind(stored.body.snapshotId)
      .run()
    const refused = await send(later, 2_000)
    // What the code before decoding on first read answered too.
    expect(refused.code).toBe(500)
    expect(refused.body).toEqual({ error: { code: 'internal', message: 'Something went wrong' } })
    expect(await snapshotCount(account.id)).toBe(1)
  })

  it('read a chain three bases deep whose bases are all there', async () => {
    const { client, account, send } = await setup()
    const stored = await send(first, 1_000)
    expect(stored.body.status).toBe('created')
    // Its characters section, standalone: rebuilt as the top of a chain
    // E <- C1 <- C2 <- C3, each compressed against the one before, the row
    // ids rising up the chain (bases first, as the old decode needed).
    const code = kindCode('characters', false)
    const row = (await env.DB.prepare(
      `SELECT b.id, b.base_id, b.data FROM section_blobs AS b
       JOIN snapshots AS s ON b.id = s.characters_ref WHERE s.id = ?1`,
    )
      .bind(stored.body.snapshotId)
      .first<{ id: number; base_id: number | null; data: unknown }>())!
    expect(row.base_id).toBeNull()
    const roster = decodeSectionBlob(code, toBytes(row.data), null, null).value as unknown[][]
    // Other rosters a level apart: what the chain's lower links hold.
    const variant = (level: number) =>
      roster.map((tuple, i) => (i === 0 ? [tuple[0], level, ...tuple.slice(2)] : tuple))
    const hashOf = async (value: unknown) => shortHashHex(await sectionHashOf('characters', value))
    const values = [variant(11), variant(12), variant(13), roster]
    let base: DecodedBlob | null = null
    let baseId: number | null = null
    for (const [n, value] of values.entries()) {
      const blob = encodeSectionBlob('characters', value, false, base)
      if (base) expect(blobUsesBase(blob.data)).toBe(true)
      if (n === 0) {
        await env.DB.prepare('UPDATE section_blobs SET hash = unhex(?2), data = ?3 WHERE id = ?1')
          .bind(row.id, await hashOf(value), blob.data)
          .run()
        baseId = row.id
      } else {
        const inserted: { id: number } | null = await env.DB.prepare(
          `INSERT INTO section_blobs (account_id, hash, kind, base_id, data)
           VALUES (?1, unhex(?2), ?3, ?4, ?5) RETURNING id`,
        )
          .bind(account.id, await hashOf(value), code, baseId, blob.data)
          .first<{ id: number }>()
        baseId = inserted!.id
      }
      base = decodeSectionBlob(code, blob.data, base, null)
    }
    await env.DB.prepare('UPDATE snapshots SET characters_ref = ?2 WHERE characters_ref = ?1')
      .bind(row.id, baseId)
      .run()

    const changed = await send(later, 2_000)
    expect(changed.code).toBe(201)
    expect(changed.body.status).toBe('created')
    expect(await snapshotCount(account.id)).toBe(2)
    const good = await client.json<Good>(
      `/api/accounts/${account.id}/snapshots/${changed.body.snapshotId}/good`,
    )
    const byKey = <T extends { key: string }>(list: T[]) =>
      [...list].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    expect(byKey(good.characters)).toEqual(byKey(later.characters))
    expect(byKey(good.weapons)).toEqual(byKey(later.weapons))
    expect(good.materials).toEqual(later.materials)
  })
})
