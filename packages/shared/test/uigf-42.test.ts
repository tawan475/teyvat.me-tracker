import { describe, expect, it } from 'vitest'
import { buildUigf, buildUigfExport, parseWishFile, resolveWishItem, type WishPull } from '../src'

// Made-up files and pulls, written from uigf.org's UIGF v4.2 page; UID 812345678.
const UID = '812345678'
const T = Date.UTC(2026, 0, 2, 3, 4, 5) / 1000

function pull(n: number, name: string, extra: Partial<WishPull> = {}): WishPull {
  return {
    id: 10n ** 18n + BigInt(n),
    time: T + n,
    gachaType: 301,
    item: resolveWishItem({ name, itemType: 'Character', rank: 5 }),
    ...extra,
  }
}

const record = (n: number, name: string) => ({
  uigf_gacha_type: '301',
  gacha_type: '301',
  item_id: '',
  count: '1',
  time: '2026-01-02 03:04:05',
  name,
  item_type: 'Character',
  rank_type: '5',
  id: String(10n ** 18n + BigInt(n)),
})

const ugc = (n: number) => ({
  id: String(10n ** 18n + BigInt(n)),
  schedule_id: '1',
  item_type: 'Outfit',
  item_id: '1001',
  item_name: 'Made-up outfit',
  rank_type: '5',
  time: '2026-01-02 03:04:05',
  op_gacha_type: '1000',
})

const info = { export_timestamp: 0, export_app: 'Test', export_app_version: '1', version: 'v4.2' }

describe('UIGF v4.2 import', () => {
  it('reads hk4e and counts the hk4e_ugc records it skips', () => {
    const file = parseWishFile(
      JSON.stringify({
        info,
        hk4e: [{ uid: UID, timezone: 8, lang: 'en-us', list: [record(1, 'Diluc')] }],
        hk4e_ugc: [
          { uid: UID, timezone: 8, list: [ugc(1), ugc(2)] },
          { uid: '812345679', timezone: 8, list: [ugc(3)] },
        ],
      }),
    )
    expect(file.format).toBe('uigf')
    expect(file.accounts).toHaveLength(1)
    expect(file.accounts[0]!.records.map((r) => r.name)).toEqual(['Diluc'])
    expect(file.miliastraSkipped).toBe(3)
  })

  it('counts a hk4e_ugc block laid out as the published schema has it (one object)', () => {
    const file = parseWishFile(
      JSON.stringify({
        info,
        hk4e: [{ uid: UID, timezone: 8, list: [] }],
        hk4e_ugc: { uid: UID, timezone: 8, list: [ugc(1), ugc(2)] },
      }),
    )
    expect(file.miliastraSkipped).toBe(2)
  })

  it('says nothing of Miliastra for a file without the block', () => {
    const file = parseWishFile(
      JSON.stringify({ info, hk4e: [{ uid: UID, timezone: 8, list: [] }] }),
    )
    expect('miliastraSkipped' in file).toBe(false)
  })

  it("still reads what today's export (v4.1) writes", () => {
    const v41 = buildUigf([{ uid: UID, timezone: 8, pulls: [pull(1, 'Diluc')] }], {
      name: 'Teyvat.me',
      version: '1',
      now: 0,
    }) as { info: { version: string } }
    expect(v41.info.version).toBe('v4.1')
    const back = parseWishFile(JSON.stringify(v41))
    expect(back.accounts[0]!.records).toHaveLength(1)
    expect(back.accounts[0]!.records[0]!.name).toBe('Diluc')
  })
})

describe('UIGF v4.2 export', () => {
  const unknownName = 'Made-up New Character'
  const pulls = [pull(1, 'Diluc'), pull(2, unknownName), pull(3, 'Another Made-up One')]

  it('writes v4.2 with every field the spec requires', () => {
    const { file, missingItemId } = buildUigfExport(
      [{ uid: UID, timezone: 8, pulls }],
      { name: 'Teyvat.me', version: '1.19.2', now: 1_700_000_000_000 },
      {
        version: 'v4.2',
        itemId: (p) => (p.item.name === unknownName ? 10000999 : undefined),
        missingItemId: 'leave-out',
      },
    )
    const json = file as {
      info: Record<string, unknown>
      hk4e: { uid: unknown; timezone: unknown; list: Record<string, string>[] }[]
    }
    expect(json.info).toEqual({
      export_timestamp: 1_700_000_000,
      export_app: 'Teyvat.me',
      export_app_version: '1.19.2',
      version: 'v4.2',
    })
    expect(json.info.version).toMatch(/^v\d+\.\d+$/)
    expect('hk4e_ugc' in json).toBe(false)
    const account = json.hk4e[0]!
    expect(Number.isInteger(account.timezone)).toBe(true)
    expect(String(account.uid)).toBe(UID)
    expect(missingItemId).toBe(1)
    expect(account.list.map((r) => r.name)).toEqual(['Diluc', unknownName])
    for (const r of account.list) {
      expect(['100', '200', '301', '302', '500']).toContain(r.uigf_gacha_type)
      expect(['100', '200', '301', '302', '400', '500']).toContain(r.gacha_type)
      expect(r.item_id).toMatch(/^\d+$/)
      expect(r.time).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
      expect(r.id).toMatch(/^[0-9]{1,19}$/)
      for (const value of Object.values(r)) expect(typeof value).toBe('string')
    }
    expect(account.list[1]!.item_id).toBe('10000999')
  })

  it('keeps the old behaviour by default: v4.1, an empty item_id for an unknown item', () => {
    const file = buildUigf([{ uid: UID, timezone: 8, pulls }], {
      name: 'T',
      version: '1',
      now: 0,
    }) as {
      info: { version: string }
      hk4e: { list: { item_id: string }[] }[]
    }
    expect(file.info.version).toBe('v4.1')
    expect(file.hk4e[0]!.list.map((r) => r.item_id)).toEqual([
      expect.stringMatching(/^\d+$/),
      '',
      '',
    ])
  })

  it('v4.1 and v4.2 differ only in the version string', () => {
    const app = { name: 'T', version: '1', now: 0 }
    const a = buildUigf([{ uid: UID, timezone: 8, pulls }], app) as { info: object }
    const b = buildUigf([{ uid: UID, timezone: 8, pulls }], app, { version: 'v4.2' }) as {
      info: object
    }
    expect({ ...b, info: { ...b.info, version: 'v4.1' } }).toEqual(a)
  })
})
