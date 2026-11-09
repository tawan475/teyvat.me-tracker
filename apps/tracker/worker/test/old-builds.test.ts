import { SELF } from 'cloudflare:test'
import { decodeBundle, readBundleV2Raw, type AccountResponse } from '@gdt/shared'
import { describe, expect, it } from 'vitest'
import { ORIGIN, bigGood, irminsulForm, signUp } from './client'

// The second binary forms of tasks and player (2026-11-09): builds cached
// from before them ask GDT2 and their decoders refuse those forms, so a
// GDT2 answer re-sends them (and blobs compressed against them) as JSON.

const T = 1_794_000_000

async function account() {
  const { client } = await signUp()
  const { account, importKey } = await client.json<{
    account: AccountResponse
    importKey: string
  }>('/api/accounts', { method: 'POST', json: { name: 'Main' } })
  const big = bigGood()
  for (const [i, extra] of [0, 1, 2].entries()) {
    const good = {
      ...big,
      gi_player: {
        ...big.gi_player!,
        profilePicture: { id: 1_000_001 + extra },
        birthday: { month: 2, day: 29 },
      },
      gi_tasks: {
        commissions: { finished: 2 + extra, total: 4, claimed: extra === 2 },
        resin: { value: 40 + extra, nextAt: T + 480 * extra },
        transformer: { usedAt: T - 86_400, readyAt: T + 86_400 * 6 },
      },
    }
    const response = await SELF.fetch(`${ORIGIN}/api/genshin-accounts-public/import-by-key`, {
      method: 'POST',
      headers: { 'x-import-key': importKey },
      body: irminsulForm(good, 1_000 * (i + 1)),
    })
    expect(response.ok).toBe(true)
  }
  return { client, base: `/api/accounts/${account.id}` }
}

const TASKS = 10
const PLAYER = 6

describe('builds from before the second tasks/player forms', () => {
  it('get them as JSON, decoding to exactly what a new build reads', async () => {
    const { client, base } = await account()
    const bytes = async (format: number) =>
      new Uint8Array(await (await client.fetch(`${base}/bundle?format=${format}`)).arrayBuffer())
    const gdt3 = await bytes(3)
    const gdt2 = await bytes(2)

    // Stored (and served to new builds) in binary.
    const stored = readBundleV2Raw(gdt3).blobs.filter((b) => b.code === TASKS || b.code === PLAYER)
    expect(stored.length).toBeGreaterThan(0)
    expect(stored.every((b) => (b.data[0]! & 0xf0) === 0x10)).toBe(true)

    // An old build gets JSON, standalone, for every one of them.
    const old = readBundleV2Raw(gdt2).blobs.filter((b) => b.code === TASKS || b.code === PLAYER)
    expect(old.length).toBe(stored.length)
    for (const blob of old) {
      expect(blob.data[0]! & 0xf0).toBe(0x00)
      expect(blob.baseId).toBeNull()
    }

    // Same data either way.
    expect(await decodeBundle(gdt2)).toEqual(await decodeBundle(gdt3))
  })
})
