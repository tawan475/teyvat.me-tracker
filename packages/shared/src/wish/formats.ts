/**
 * Wish history files of other sites, in and out:
 * - UIGF v4 (uigf.org; Snap Hutao, Starward, genshin-wish-export and most
 *   tools): `{info, hk4e: [{uid, timezone, lang, list}]}`. Reading also takes
 *   v3 and older (`{info: {uid, lang, region_time_zone}, list}`).
 * - paimon.moe's importer CSV (`paimonmoe,importer,version,1,0`, then
 *   `gacha_type,time,name,item_type,rank_type` rows; what its Local
 *   Importer reads), and paimon.moe's own backup (Settings → Export: its
 *   local save, `wish-counter-<banner>` keys of `{pulls: [{type, id, time,
 *   code}]}` with its own item ids).
 * Neither paimon.moe format has record ids: their pulls get synthetic ids
 * (pulls.ts) and are matched by banner, time and item.
 */

import { uigfGachaType, formatWishTime, isSyntheticWishId, type WishPull } from './pulls'
import { wishItemByLooseKey, wishItemTypeLabel } from './items'
import type { WishRecord } from './records'

export class WishFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WishFileError'
  }
}

/** One account's records in a file. */
export interface WishFileAccount {
  uid: string | null
  /** Hours from UTC of the records' times; null when the file does not say. */
  timezone: number | null
  lang: string | null
  records: WishRecord[]
}

export interface WishFile {
  format: 'uigf' | 'paimon-csv' | 'paimon-backup'
  accounts: WishFileAccount[]
}

const str = (value: unknown): string =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''

/** Reads any supported file from its text. */
export function parseWishFile(text: string): WishFile {
  const trimmed = text.replace(/^﻿/, '').trimStart()
  if (trimmed.startsWith(PAIMON_CSV_HEADER)) return parsePaimonCsv(trimmed)
  let json: unknown
  try {
    json = JSON.parse(trimmed)
  } catch {
    throw new WishFileError('Not a UIGF JSON or paimon.moe file')
  }
  if (json && typeof json === 'object' && ('hk4e' in json || 'list' in json)) {
    return parseUigf(json as Record<string, unknown>)
  }
  if (json && typeof json === 'object' && hasPaimonCounters(json as Record<string, unknown>)) {
    return parsePaimonBackup(json as Record<string, unknown>)
  }
  throw new WishFileError('Not a UIGF JSON or paimon.moe file')
}

// ------------------------------------------------------------------ UIGF

function uigfRecord(item: Record<string, unknown>, uid: string | null): WishRecord {
  return {
    id: str(item.id),
    ...(uid ? { uid } : {}),
    // gacha_type is the game's (400 stays 400); uigf_gacha_type the banner.
    gacha_type: str(item.gacha_type) || str(item.uigf_gacha_type),
    time: str(item.time),
    name: str(item.name),
    item_type: str(item.item_type),
    rank_type: str(item.rank_type),
    item_id: str(item.item_id),
  }
}

function uigfTimezone(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isInteger(n) && n >= -12 && n <= 14 ? n : null
}

export function parseUigf(json: Record<string, unknown>): WishFile {
  const info = (json.info ?? {}) as Record<string, unknown>
  if (Array.isArray(json.hk4e)) {
    return {
      format: 'uigf',
      accounts: json.hk4e.map((entry: Record<string, unknown>) => {
        const uid = str(entry.uid) || null
        const list = Array.isArray(entry.list) ? entry.list : []
        return {
          uid,
          timezone: uigfTimezone(entry.timezone),
          lang: str(entry.lang) || null,
          records: list.map((item: Record<string, unknown>) => uigfRecord(item, uid)),
        }
      }),
    }
  }
  if (Array.isArray(json.list)) {
    const uid = str(info.uid) || null
    return {
      format: 'uigf',
      accounts: [
        {
          uid,
          timezone: uigfTimezone(info.region_time_zone),
          lang: str(info.lang) || null,
          records: json.list.map((item: Record<string, unknown>) => uigfRecord(item, uid)),
        },
      ],
    }
  }
  throw new WishFileError('Not a UIGF file')
}

export interface WishExportAccount {
  uid: string
  timezone: number
  /** Every banner's pulls, each banner in pull order. */
  pulls: readonly WishPull[]
}

/** UIGF v4.1. Oldest first; `count` is always 1; synthetic ids are exported as they are. */
export function buildUigf(
  accounts: readonly WishExportAccount[],
  app: { name: string; version: string; now?: number },
): unknown {
  return {
    info: {
      export_timestamp: Math.floor((app.now ?? Date.now()) / 1000),
      export_app: app.name,
      export_app_version: app.version,
      version: 'v4.1',
    },
    hk4e: accounts.map((account) => ({
      uid: /^\d+$/.test(account.uid) ? Number(account.uid) : account.uid,
      timezone: account.timezone,
      lang: 'en-us',
      list: account.pulls.map((pull) => ({
        uigf_gacha_type: String(uigfGachaType(pull.gachaType)),
        gacha_type: String(pull.gachaType),
        item_id: pull.item.itemId ? String(pull.item.itemId) : '',
        count: '1',
        time: formatWishTime(pull.time),
        name: pull.item.name,
        item_type: wishItemTypeLabel(pull.item.kind),
        rank_type: pull.item.rank ? String(pull.item.rank) : '',
        id: pull.id.toString(),
      })),
    })),
  }
}

// ------------------------------------------------------------ paimon.moe CSV

export const PAIMON_CSV_HEADER = 'paimonmoe,importer,version,1,0'

/** Splits one CSV line (quotes as RFC 4180 writes them). */
function csvCells(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      cells.push(cell)
      cell = ''
    } else cell += c
  }
  cells.push(cell)
  return cells
}

export function parsePaimonCsv(text: string): WishFile {
  const lines = text.split(/\r?\n/)
  if (lines[0]?.trim() !== PAIMON_CSV_HEADER) throw new WishFileError('Not a paimon.moe CSV')
  const records: WishRecord[] = []
  for (const line of lines.slice(1)) {
    if (line.trim() === '') continue
    const [gachaType, time, name, itemType, rank] = csvCells(line)
    records.push({
      gacha_type: (gachaType ?? '').trim(),
      time: (time ?? '').trim(),
      name: (name ?? '').trim(),
      item_type: (itemType ?? '').trim(),
      rank_type: (rank ?? '').trim(),
    })
  }
  return { format: 'paimon-csv', accounts: [{ uid: null, timezone: null, lang: 'en-us', records }] }
}

const csvCell = (value: string) =>
  /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value

/**
 * The CSV paimon.moe's Local Importer reads: banners 100, 200, 301 (with
 * 400 rows), 302, 500, each newest first, as the game's API lists them
 * (paimon.moe reverses each banner as it reads).
 */
export function buildPaimonCsv(pulls: readonly WishPull[]): string {
  const order = [100, 200, 301, 302, 500]
  const rows = [...pulls]
    .sort(
      (a, b) =>
        order.indexOf(uigfGachaType(a.gachaType)) - order.indexOf(uigfGachaType(b.gachaType)) ||
        b.time - a.time ||
        (b.id < a.id ? -1 : b.id > a.id ? 1 : 0),
    )
    .map((pull) =>
      [
        String(pull.gachaType),
        formatWishTime(pull.time),
        pull.item.name,
        wishItemTypeLabel(pull.item.kind),
        pull.item.rank ? String(pull.item.rank) : '',
      ]
        .map(csvCell)
        .join(','),
    )
  return `${PAIMON_CSV_HEADER}\n${rows.join('\n')}${rows.length ? '\n' : ''}`
}

// ---------------------------------------------------------- paimon.moe backup

/** paimon.moe's save keys per banner (an account other than its first prefixes `<name>-`). */
const PAIMON_COUNTERS: Readonly<Record<string, string>> = {
  'wish-counter-beginners': '100',
  'wish-counter-standard': '200',
  'wish-counter-character-event': '301',
  'wish-counter-weapon-event': '302',
  'wish-counter-chronicled': '500',
}

function hasPaimonCounters(json: Record<string, unknown>): boolean {
  return Object.keys(json).some((key) =>
    Object.keys(PAIMON_COUNTERS).some((suffix) => key.endsWith(suffix)),
  )
}

const PAIMON_SERVER_TZ: Readonly<Record<string, number>> = {
  Asia: 8,
  China: 8,
  America: -5,
  Europe: 1,
}

/** paimon.moe's Manual Input pulls: a UTC ISO time ("2020-10-01T00:19:16Z"). */
const PAIMON_UTC_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d+)?Z$/

/**
 * A paimon.moe pull's time on the server's clock: synced pulls are already
 * ("2021-02-04 22:04:56"); a Manual Input one is UTC and moves to `timezone`
 * (kept as the UTC clock when the backup names no server).
 */
function paimonTime(time: string, timezone: number | null): string {
  const m = PAIMON_UTC_TIME.exec(time.trim())
  if (!m) return time
  const utc = Date.parse(`${m[1]}T${m[2]}Z`) / 1000
  return Number.isNaN(utc) ? time : formatWishTime(utc + (timezone ?? 0) * 3600)
}

/**
 * paimon.moe's own backup: one account per key prefix ('' is its first).
 * Its item ids are names in snake case ("hu_tao"); the table's names come
 * back from them. Times are the server's clock, as the API gave them, but
 * Manual Input pulls carry a UTC ISO time (paimonTime).
 */
export function parsePaimonBackup(json: Record<string, unknown>): WishFile {
  const prefixes = new Set<string>()
  for (const key of Object.keys(json)) {
    for (const suffix of Object.keys(PAIMON_COUNTERS)) {
      if (key.endsWith(suffix)) prefixes.add(key.slice(0, key.length - suffix.length))
    }
  }
  const accounts: WishFileAccount[] = []
  for (const prefix of [...prefixes].sort()) {
    const server = str(json[`${prefix}server`])
    const timezone = PAIMON_SERVER_TZ[server] ?? null
    const records: WishRecord[] = []
    for (const [suffix, banner] of Object.entries(PAIMON_COUNTERS)) {
      const counter = json[prefix + suffix] as { pulls?: unknown } | undefined
      const pulls = Array.isArray(counter?.pulls) ? counter.pulls : []
      for (const pull of pulls as Record<string, unknown>[]) {
        const info = wishItemByLooseKey(str(pull.id).replace(/[_-]/g, ' '))
        records.push({
          gacha_type: str(pull.code) || banner,
          time: paimonTime(str(pull.time), timezone),
          name: info?.name ?? str(pull.id),
          item_type: info ? wishItemTypeLabel(info.kind) : str(pull.type),
          rank_type: info ? String(info.rarity) : '',
        })
      }
    }
    const uid = str(json[`${prefix}wish-uid`]) || null
    accounts.push({
      uid,
      timezone,
      lang: 'en-us',
      records,
    })
  }
  return { format: 'paimon-backup', accounts }
}

/** True for a pull exported with a made-up id (paimon.moe sources). */
export const hasSyntheticId = (pull: WishPull) => isSyntheticWishId(pull.id)
