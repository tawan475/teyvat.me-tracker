import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  CHARACTERS,
  CorruptDataError,
  PAIMON_CSV_HEADER,
  WEAPONS,
  WISH_CHUNK_SIZE,
  WISH_ITEMS,
  WishFileError,
  WishRecordError,
  buildPaimonCsv,
  buildUigf,
  chunkPulls,
  comparePulls,
  decodeWishChunk,
  encodeWishChunk,
  isSyntheticWishId,
  mergePulls,
  newestRealId,
  normalizeWishRecords,
  parsePaimonXlsx,
  paddedWishId,
  parseWishBytes,
  parseWishFile,
  parseWishId,
  parseWishTime,
  resolveWishItem,
  syntheticWishId,
  toGoodKey,
  type UigfGachaType,
  type WishPull,
  type WishRecord,
} from '../src'
import { syntheticWishRecords } from './wish-synthetic'

const UID = '811111111'

function pullsOf(records: WishRecord[], timezone = 8): Map<UigfGachaType, WishPull[]> {
  const { banners } = normalizeWishRecords(records, { uid: UID, timezone, target: timezone })
  const out = new Map<UigfGachaType, WishPull[]>()
  for (const [banner, pulls] of banners) out.set(banner, mergePulls(banner, [], pulls).pulls)
  return out
}

function roundTrip(banner: UigfGachaType, pulls: WishPull[]) {
  const chunks = chunkPulls(pulls).map((part) => encodeWishChunk(banner, part))
  const back = chunks.flatMap((data) => decodeWishChunk(banner, data))
  return { chunks, back }
}

/** Pulls without their resolved item details, to compare what is stored. */
const plain = (pulls: readonly WishPull[]) =>
  pulls.map((p) => ({ id: p.id, time: p.time, gachaType: p.gachaType, item: p.item }))

describe('wish items', () => {
  it('names every table key by toGoodKey of its English name', () => {
    for (const item of WISH_ITEMS) {
      expect(toGoodKey(item.name)).toBe(item.key)
      expect([3, 4, 5]).toContain(item.rarity)
    }
  })

  it('stores an item the dictionaries lack yet by name, and reads it back as known', () => {
    const missing = WISH_ITEMS.find(
      (i) => !(i.kind === 'character' ? CHARACTERS : WEAPONS).ids.has(i.key),
    )
    if (!missing) return
    const t = Date.UTC(2026, 9, 1) / 1000
    const pull: WishPull = {
      id: 1790000000000000001n,
      time: t,
      gachaType: missing.kind === 'weapon' ? 302 : 301,
      item: resolveWishItem({ name: missing.name }),
    }
    const banner = pull.gachaType === 302 ? 302 : 301
    expect(decodeWishChunk(banner, encodeWishChunk(banner, [pull]))).toEqual([pull])
  })

  it('resolves by item id, then exact English name; keeps anything else as it came', () => {
    expect(resolveWishItem({ name: 'whatever', itemId: 10000046 })).toMatchObject({
      key: 'HuTao',
      name: 'Hu Tao',
      rank: 5,
      known: true,
    })
    expect(resolveWishItem({ name: "Wolf's Gravestone", itemType: 'Weapon' })).toMatchObject({
      key: 'WolfsGravestone',
      kind: 'weapon',
      known: true,
    })
    // Same key, other spelling: read as that item, stored as it came.
    expect(resolveWishItem({ name: 'wolfs gravestone', rank: 5 })).toMatchObject({
      key: 'WolfsGravestone',
      known: false,
      name: 'wolfs gravestone',
    })
    expect(resolveWishItem({ name: 'Brand New Hero', itemType: 'Character', rank: 5 })).toEqual({
      key: null,
      kind: 'character',
      name: 'Brand New Hero',
      rank: 5,
      itemId: 0,
      known: false,
    })
  })
})

describe('wish ids and times', () => {
  it('reads the API shapes and refuses others', () => {
    expect(parseWishId('1790000000000000001')).toBe(1790000000000000001n)
    expect(parseWishId('9223372036854775808')).toBeNull()
    expect(parseWishId('12a')).toBeNull()
    expect(parseWishTime('2026-10-12 21:04:11')).toBe(Date.UTC(2026, 9, 12, 21, 4, 11) / 1000)
    expect(parseWishTime('2026-02-30 00:00:00')).toBeNull()
    expect(parseWishTime('yesterday')).toBeNull()
  })

  it('keeps synthetic ids below every game id and unique per banner and second', () => {
    const t = Date.UTC(2026, 0, 1) / 1000
    const a = syntheticWishId(301, t, 0)
    expect(isSyntheticWishId(a)).toBe(true)
    expect(a < 10n ** 18n && a >= 10n ** 17n).toBe(true)
    expect(syntheticWishId(302, t, 0)).not.toBe(a)
    expect(syntheticWishId(301, t, 1)).not.toBe(a)
    expect(syntheticWishId(301, t + 1, 0) > syntheticWishId(301, t, 999_999)).toBe(true)
  })
})

describe('wish chunks', () => {
  const records = syntheticWishRecords({
    uid: UID,
    pulls: { 301: 3000, 302: 800, 200: 1000, 100: 20, 500: 180 },
  })

  it('round-trips a 5,000-pull history exactly, compactly', () => {
    const banners = pullsOf(records)
    let bytes = 0
    let count = 0
    for (const [banner, pulls] of banners) {
      const { chunks, back } = roundTrip(banner, pulls)
      expect(plain(back)).toEqual(plain(pulls))
      expect(chunks.length).toBe(Math.ceil(pulls.length / WISH_CHUNK_SIZE))
      bytes += chunks.reduce((sum, c) => sum + c.length, 0)
      count += pulls.length
    }
    expect(count).toBe(5000)
    const perPull = bytes / count
    console.log(`wish history: ${count} pulls in ${bytes} bytes, ${perPull.toFixed(2)} B/pull`)
    expect(perPull).toBeLessThan(4)
  })

  it('keeps 400 apart from 301 and knows items by dictionary id', () => {
    const pulls = pullsOf(records).get(301)!
    expect(pulls.some((p) => p.gachaType === 400)).toBe(true)
    const back = roundTrip(301, pulls).back
    expect(back.filter((p) => p.gachaType === 400).length).toBe(
      pulls.filter((p) => p.gachaType === 400).length,
    )
    expect(back.every((p) => p.item.known)).toBe(true)
  })

  it('stores unknown items as they came, and synthetic ids by their place', () => {
    const t = Date.UTC(2026, 3, 1, 10) / 1000
    const pulls: WishPull[] = [
      {
        id: syntheticWishId(302, t, 0),
        time: t,
        gachaType: 302,
        item: resolveWishItem({ name: '天空之刃', itemType: '武器', rank: 5 }),
      },
      {
        id: syntheticWishId(302, t, 1),
        time: t,
        gachaType: 302,
        item: resolveWishItem({ name: 'Slingshot', itemType: 'Weapon' }),
      },
      {
        id: 1775000000000123456n,
        time: t + 90,
        gachaType: 302,
        item: resolveWishItem({
          name: 'Not Yet Released',
          itemType: 'Weapon',
          rank: 4,
          itemId: 99999,
        }),
      },
    ]
    const back = roundTrip(302, pulls).back
    expect(back).toEqual(pulls)
    expect(back[0]!.item).toMatchObject({ known: false, kind: 'weapon', rank: 5, name: '天空之刃' })
  })

  it('refuses out-of-order pulls, foreign gacha types and corrupt bytes', () => {
    const pulls = pullsOf(records).get(200)!.slice(0, 5)
    expect(() => encodeWishChunk(200, [pulls[1]!, pulls[0]!])).toThrow(RangeError)
    expect(() => encodeWishChunk(302, pulls)).toThrow(RangeError)
    const data = encodeWishChunk(200, pulls)
    expect(() => decodeWishChunk(200, new Uint8Array([9, ...data.subarray(1)]))).toThrow(
      CorruptDataError,
    )
    expect(() => decodeWishChunk(200, data.subarray(0, data.length - 2))).toThrow()
  })

  it('pads ids so text order is number order', () => {
    expect(paddedWishId(10n ** 17n + 5n) < paddedWishId(10n ** 18n)).toBe(true)
    const pulls = pullsOf(records).get(301)!
    expect(newestRealId(pulls)).toBe(pulls.at(-1)!.id)
  })
})

describe('merging wish pulls', () => {
  const records = syntheticWishRecords({ uid: UID, pulls: { 301: 300 } })
  const all = pullsOf(records).get(301)!

  it('dedupes by id, in any order, overlapping what is held', () => {
    const held = all.slice(0, 200)
    const incoming = [...all.slice(150)].reverse()
    const merged = mergePulls(301, held, incoming)
    expect(merged.added).toBe(100)
    expect(merged.known).toBe(50)
    expect(plain(merged.pulls)).toEqual(plain(all))
    expect(mergePulls(301, all, all).added).toBe(0)
  })

  it('replaces id-less pulls by the real ones, and never doubles id-less imports', () => {
    const csv = parseWishFile(buildPaimonCsv(all.slice(0, 120))).accounts[0]!.records
    const fromCsv = normalizeWishRecords(csv, { timezone: 8, target: 8 }).banners.get(301)!
    expect(fromCsv.every((p) => isSyntheticWishId(p.id))).toBe(true)
    const held = mergePulls(301, [], fromCsv)
    expect(held.added).toBe(120)
    // The same file again: nothing new.
    expect(mergePulls(301, held.pulls, fromCsv).added).toBe(0)
    // The real history arrives: the made-up pulls make way.
    const real = mergePulls(301, held.pulls, all)
    expect(real.replaced).toBe(120)
    expect(real.pulls.length).toBe(all.length)
    expect(real.pulls.every((p) => !isSyntheticWishId(p.id))).toBe(true)
  })

  it('keeps a ten-pull in its order through the CSV (newest first) and back', () => {
    const csv = parseWishFile(buildPaimonCsv(all)).accounts[0]!.records
    const back = mergePulls(
      301,
      [],
      normalizeWishRecords(csv, { timezone: 8, target: 8 }).banners.get(301)!,
    )
    expect(back.pulls.map((p) => [p.time, p.item.key, p.gachaType])).toEqual(
      all.map((p) => [p.time, p.item.key, p.gachaType]),
    )
  })
})

describe('wish records', () => {
  it('moves times to the account clock, skips other UIDs and unknown banners', () => {
    const records: WishRecord[] = [
      {
        id: '1790000000000000002',
        uid: UID,
        gacha_type: '301',
        time: '2026-10-12 21:04:11',
        name: 'Bennett',
        item_type: 'Character',
        rank_type: '4',
      },
      {
        id: '1790000000000000003',
        uid: '822222222',
        gacha_type: '301',
        time: '2026-10-12 21:04:11',
        name: 'Bennett',
      },
      {
        id: '1790000000000000004',
        gacha_type: '999',
        time: '2026-10-12 21:04:11',
        name: 'Bennett',
      },
    ]
    const { banners, skipped } = normalizeWishRecords(records, {
      uid: UID,
      timezone: -5,
      target: 8,
    })
    expect(skipped).toBe(2)
    expect(banners.get(301)![0]!.time).toBe(Date.UTC(2026, 9, 13, 10, 4, 11) / 1000)
  })

  it('reads small counters as missing ids (StarDB numbers id-less pulls from 0)', () => {
    const records: WishRecord[] = ['0', '1', '1790000000000000002'].map((id, i) => ({
      id,
      gacha_type: '301',
      time: `2026-10-12 21:04:1${i}`,
      name: 'Bennett',
    }))
    const pulls = normalizeWishRecords(records, { timezone: 8, target: 8 }).banners.get(301)!
    expect(pulls.map((p) => isSyntheticWishId(p.id))).toEqual([true, true, false])
  })

  it('fails the batch on a malformed record', () => {
    expect(() =>
      normalizeWishRecords([{ gacha_type: '301', time: 'soon', name: 'Bennett' }], {
        timezone: 8,
        target: 8,
      }),
    ).toThrow(WishRecordError)
  })
})

describe('wish files', () => {
  const records = syntheticWishRecords({ uid: UID, pulls: { 301: 120, 302: 40, 200: 50 } })
  const banners = pullsOf(records)
  const pulls = [...banners.values()].flat()

  it('round-trips UIGF v4', () => {
    const json = buildUigf([{ uid: UID, timezone: 8, pulls }], {
      name: 'Test',
      version: '1',
      now: 0,
    })
    const file = parseWishFile(JSON.stringify(json))
    expect(file.format).toBe('uigf')
    expect(file.accounts[0]!.uid).toBe(UID)
    const back = pullsOf(file.accounts[0]!.records)
    for (const [banner, list] of banners) expect(plain(back.get(banner)!)).toEqual(plain(list))
  })

  /** A workbook as paimon.moe's Excel export lays it out (plus Excel's own re-save quirks). */
  function paimonXlsx(options: { chronicled?: boolean } = {}): Uint8Array {
    const shared = [
      'Type',
      'Name',
      'Time',
      '⭐',
      'Pity',
      '#Roll',
      'Group',
      'Banner',
      'Part',
      'Weapon',
      'Raven Bow',
      '2021-01-17 20:11:02',
      'Adrift in the Harbor',
      '',
      'Character',
      'Noelle',
      'Hu Tao',
      'Wolf&apos;s Gravestone',
      'Slingshot',
      'Paimon.moe Wish History Export',
      'Version',
      'Export Date',
    ]
    const si = shared.map((t) => `<si><t>${t}</t></si>`).join('')
    const s = (i: number) => `t="s"><v>${i}</v>`
    const n = (v: number | string) => `><v>${v}</v>`
    const header = `<row r="1">${['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']
      .map((c, i) => `<c r="${c}1" ${s(i)}</c>`)
      .join('')}</row>`
    const row = (r: number, cells: string[]) =>
      `<row r="${r}">${cells.map((c, i) => `<c r="${'ABCDEFGHI'[i]}${r}" ${c}</c>`).join('')}</row>`
    const sheet = (rows: string) =>
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${header}${rows}</sheetData></worksheet>`
    const character = sheet(
      row(2, [s(9), s(10), s(11), n(3), n(1), n(1), n(1), s(12), s(13)]) +
        // Same second, listed oldest first (paimon.moe's order); Excel re-saved the time as a day serial.
        row(3, [s(14), s(15), s(11), n(4), n(2), n(2), n(2), s(12), s(13)]) +
        row(4, [s(14), s(16), 's="1"' + n('44214.84169'), n(5), n(3), n(3), n(3), s(12), s(13)]),
    )
    // Rich text and an inline string instead of shared ones.
    const weapon = sheet(
      row(2, [
        s(9),
        't="inlineStr"><is><r><t>Wolf&apos;s</t></r><r><t xml:space="preserve"> Gravestone</t></r></is>',
        s(11),
        n(5),
        n(1),
        n(1),
        n(1),
        s(12),
        s(13),
      ]),
    )
    const standard = sheet(row(2, [s(9), s(18), s(11), n(3), n(1), n(1), n(1), s(13), s(13)]))
    const chronicled = sheet(row(2, [s(14), s(16), s(11), n(5), n(1), n(1), n(1), s(13), s(13)]))
    const names = [
      'Character Event',
      'Weapon Event',
      'Standard',
      'Beginners&apos; Wish',
      'Banner List',
      'Information',
    ]
    const xmls = [character, weapon, standard, sheet(''), sheet(''), sheet('')]
    if (options.chronicled) {
      names.push('Chronicled Wish')
      xmls.push(chronicled)
    }
    const files: Record<string, Uint8Array> = {
      'xl/workbook.xml': strToU8(
        `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names
          .map((name, i) => `<sheet sheetId="${i + 1}" name="${name}" r:id="rId${i + 4}"/>`)
          .join('')}</sheets></workbook>`,
      ),
      'xl/_rels/workbook.xml.rels': strToU8(
        `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x/sharedStrings" Target="sharedStrings.xml"/>${names
          .map(
            (_, i) =>
              `<Relationship Id="rId${i + 4}" Type="x/worksheet" Target="${i === 0 ? '/xl/' : ''}worksheets/sheet${i + 1}.xml"/>`,
          )
          .join('')}</Relationships>`,
      ),
      'xl/sharedStrings.xml': strToU8(
        `<?xml version="1.0"?><sst count="${shared.length}" uniqueCount="${shared.length}">${si}</sst>`,
      ),
    }
    xmls.forEach((xml, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(xml)))
    return zipSync(files)
  }

  it("reads paimon.moe's Excel export", () => {
    const file = parseWishBytes(paimonXlsx({ chronicled: true }))
    expect(file.format).toBe('paimon-xlsx')
    expect(file.accounts).toHaveLength(1)
    const account = file.accounts[0]!
    expect(account).toMatchObject({ uid: null, timezone: null })
    expect(account.records).toEqual([
      {
        gacha_type: '301',
        time: '2021-01-17 20:11:02',
        name: 'Raven Bow',
        item_type: 'Weapon',
        rank_type: '3',
      },
      {
        gacha_type: '301',
        time: '2021-01-17 20:11:02',
        name: 'Noelle',
        item_type: 'Character',
        rank_type: '4',
      },
      {
        gacha_type: '301',
        time: '2021-01-18 20:12:02',
        name: 'Hu Tao',
        item_type: 'Character',
        rank_type: '5',
      },
      {
        gacha_type: '302',
        time: '2021-01-17 20:11:02',
        name: "Wolf's Gravestone",
        item_type: 'Weapon',
        rank_type: '5',
      },
      {
        gacha_type: '200',
        time: '2021-01-17 20:11:02',
        name: 'Slingshot',
        item_type: 'Weapon',
        rank_type: '3',
      },
      {
        gacha_type: '500',
        time: '2021-01-17 20:11:02',
        name: 'Hu Tao',
        item_type: 'Character',
        rank_type: '5',
      },
    ])
    // The same pulls as the CSV lists them (newest first) get the same synthetic ids.
    const fromXlsx = pullsOf(account.records).get(301)!
    const csv = `${PAIMON_CSV_HEADER}
301,2021-01-18 20:12:02,Hu Tao,Character,5
301,2021-01-17 20:11:02,Noelle,Character,4
301,2021-01-17 20:11:02,Raven Bow,Weapon,3
`
    const fromCsv = pullsOf(parseWishFile(csv).accounts[0]!.records).get(301)!
    expect(plain(fromXlsx)).toEqual(plain(fromCsv))
    expect(fromXlsx.map((p) => p.item.name)).toEqual(['Raven Bow', 'Noelle', 'Hu Tao'])
  })

  it('refuses a workbook or zip that is not the export', () => {
    expect(() => parsePaimonXlsx(zipSync({ 'a.txt': strToU8('hi') }))).toThrow(WishFileError)
    expect(() => parseWishBytes(strToU8('PK not a zip'))).toThrow(WishFileError)
    expect(() =>
      parseWishBytes(
        zipSync({
          'xl/workbook.xml': strToU8(
            '<workbook><sheets><sheet name="Totals" r:id="rId4"/></sheets></workbook>',
          ),
          'xl/_rels/workbook.xml.rels': strToU8(
            '<Relationships><Relationship Id="rId4" Target="worksheets/sheet1.xml"/></Relationships>',
          ),
          'xl/worksheets/sheet1.xml': strToU8('<worksheet><sheetData/></worksheet>'),
        }),
      ),
    ).toThrow(WishFileError)
    // Text files still go the text way.
    expect(
      parseWishBytes(
        strToU8(`${PAIMON_CSV_HEADER}
200,2021-01-17 20:11:02,Slingshot,Weapon,3
`),
      ).format,
    ).toBe('paimon-csv')
  })

  it('writes the CSV paimon.moe reads', () => {
    const csv = buildPaimonCsv(pulls)
    expect(csv.startsWith(`${PAIMON_CSV_HEADER}\n`)).toBe(true)
    const rows = csv.trim().split('\n').slice(1)
    expect(rows.length).toBe(pulls.length)
    expect(rows[0]).toMatch(/^200,\d{4}-\d\d-\d\d \d\d:\d\d:\d\d,[^,]+,(Weapon|Character),[345]$/)
  })

  it("reads paimon.moe's backup", () => {
    const backup = {
      'wish-uid': UID,
      server: 'America',
      'wish-counter-character-event': {
        total: 2,
        pulls: [
          { type: 'character', id: 'hu_tao', time: '2026-01-01 10:00:00', pity: 80, code: '301' },
          {
            type: 'weapon',
            id: 'primordial_jade_winged-spear',
            time: '2026-01-01 10:05:00',
            pity: 1,
            code: '400',
          },
        ],
      },
      'wish-counter-standard': {
        pulls: [{ type: 'weapon', id: 'slingshot', time: '2026-01-01 11:00:00' }],
      },
    }
    const file = parseWishFile(JSON.stringify(backup))
    expect(file.format).toBe('paimon-backup')
    const account = file.accounts[0]!
    expect(account).toMatchObject({ uid: UID, timezone: -5 })
    const back = pullsOf(account.records, -5)
    expect(back.get(301)!.map((p) => [p.item.name, p.gachaType])).toEqual([
      ['Hu Tao', 301],
      ['Primordial Jade Winged-Spear', 400],
    ])
    expect(back.get(200)![0]!.item.key).toBe('Slingshot')
  })

  it('reads every account of a paimon.moe backup, pulls without a code too', () => {
    const backup = {
      accounts: 'account2',
      'wish-uid': UID,
      server: 'Asia',
      'wish-counter-weapon-event': {
        total: 2,
        pulls: [
          { type: 'weapon', id: 'raven_bow', time: '2021-03-02 18:31:32', pity: 1 },
          { type: 'weapon', id: 'wolfs_gravestone', time: '2021-03-02 18:31:32', pity: 2, rate: 0 },
        ],
      },
      'account2-wish-uid': 822222222,
      'account2-wish-counter-standard': {
        pulls: [
          { type: 'character', id: 'kuki_shinobu', time: '2024-06-27 00:46:20', code: '200' },
        ],
      },
      'account2-wish-counter-setting': { firstTime: false },
    }
    const file = parseWishFile(JSON.stringify(backup))
    expect(file.accounts.map((a) => [a.uid, a.records.length])).toEqual([
      [UID, 2],
      ['822222222', 1],
    ])
    const main = pullsOf(file.accounts[0]!.records).get(302)!
    expect(main.map((p) => [p.item.name, p.gachaType, p.item.rank])).toEqual([
      ['Raven Bow', 302, 3],
      ["Wolf's Gravestone", 302, 5],
    ])
    expect(pullsOf(file.accounts[1]!.records).get(200)![0]!.item.name).toBe('Kuki Shinobu')
  })

  it("reads paimon.moe's Manual Input pulls (UTC ISO times)", () => {
    const pulls = [
      {
        id: 'cool_steel',
        time: '2020-10-01T00:19:16Z',
        type: 'weapon',
        pity: 1,
        manualInput: true,
      },
      {
        id: 'amber',
        time: '2020-10-01T00:19:16.000Z',
        type: 'character',
        pity: 2,
        manualInput: true,
      },
      { type: 'weapon', id: 'black_tassel', time: '2021-02-04 22:04:56', pity: 1 },
    ]
    const asia = parseWishFile(
      JSON.stringify({ 'wish-uid': UID, server: 'Asia', 'wish-counter-standard': { pulls } }),
    ).accounts[0]!
    expect(asia.records.map((r) => r.time)).toEqual([
      '2020-10-01 08:19:16',
      '2020-10-01 08:19:16',
      '2021-02-04 22:04:56',
    ])
    expect(pullsOf(asia.records, 8).get(200)).toHaveLength(3)
    // No server in the backup: the UTC clock.
    const unknown = parseWishFile(
      JSON.stringify({ 'wish-uid': UID, 'wish-counter-standard': { pulls } }),
    ).accounts[0]!
    expect(unknown.records[0]!.time).toBe('2020-10-01 00:19:16')
  })

  it('refuses what it cannot read', () => {
    expect(() => parseWishFile('hello')).toThrow()
    expect(() => parseWishFile('{"foo":1}')).toThrow()
  })

  it('orders pulls by time, then id', () => {
    const sorted = [...pulls].sort(comparePulls)
    expect(sorted.length).toBe(pulls.length)
  })
})
