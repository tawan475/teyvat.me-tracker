/**
 * paimon.moe's Excel export (Wish Counter → Export → Excel): one sheet per
 * banner ("Character Event", "Weapon Event", "Standard", "Beginners' Wish",
 * "Chronicled Wish"), each `Type, Name, Time, ⭐, Pity, #Roll, Group, Banner,
 * Part` oldest first, plus "Banner List" and "Information" sheets. Like its
 * CSV it has no record ids or UID, so its pulls get synthetic ids and the
 * same pulls read from the CSV or the backup are known already.
 *
 * The workbook is read with a small reader of its own (shared strings,
 * inline strings, numbers, Excel's day serials for times): enough for what
 * paimon.moe writes and what Excel re-saves.
 */

import { strFromU8, unzipSync } from 'fflate'
import { WishFileError, parseWishFile, type WishFile } from './formats'
import type { WishRecord } from './records'

/** paimon.moe's sheet name (lowercased start) → UIGF banner type. */
const SHEET_BANNERS: readonly [prefix: string, type: string][] = [
  ['character', '301'],
  ['weapon', '302'],
  ['standard', '200'],
  ['beginner', '100'],
  ['chronicled', '500'],
]

const XML_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

function unescapeXml(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' ? parseInt(body.slice(2), 16) : Number(body.slice(1))
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return XML_ENTITIES[body] ?? whole
  })
}

/** The text of every `<t>` in a run (rich text joins its runs). */
function textOf(xml: string): string {
  let out = ''
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)) out += unescapeXml(m[1]!)
  return out
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag)
  return m ? unescapeXml(m[1]!) : null
}

/** "C14" → column index 2. */
function columnIndex(ref: string): number {
  let n = 0
  for (const c of ref) {
    if (c < 'A' || c > 'Z') break
    n = n * 26 + (c.charCodeAt(0) - 64)
  }
  return n - 1
}

/** An Excel day serial (1900 system) → "YYYY-MM-DD HH:mm:ss", to the second. */
function serialToTime(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400) * 1000
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
}

interface Workbook {
  /** Sheet name → that sheet's rows of cell texts (empty cells ''). */
  sheets: Map<string, string[][]>
}

function readWorkbook(bytes: Uint8Array): Workbook {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch {
    throw new WishFileError('Not an Excel workbook')
  }
  const text = (path: string): string | null => {
    const file = files[path] ?? files[path.replace(/^\//, '')]
    return file ? strFromU8(file) : null
  }
  const workbook = text('xl/workbook.xml')
  const rels = text('xl/_rels/workbook.xml.rels')
  if (!workbook || !rels) throw new WishFileError('Not an Excel workbook')

  const targets = new Map<string, string>()
  for (const tag of rels.matchAll(/<Relationship\s[^>]*>/g)) {
    const id = attr(tag[0], 'Id')
    const target = attr(tag[0], 'Target')
    if (id && target) {
      targets.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target}`)
    }
  }

  const shared: string[] = []
  const sharedXml = text('xl/sharedStrings.xml')
  if (sharedXml) {
    for (const si of sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textOf(si[1]!))
  }

  const sheets = new Map<string, string[][]>()
  for (const tag of workbook.matchAll(/<sheet\s[^>]*>/g)) {
    const name = attr(tag[0], 'name')
    const rid = attr(tag[0], 'r:id')
    const path = rid ? targets.get(rid) : undefined
    const xml = path ? text(path) : null
    if (!name || !xml) continue
    const rows: string[][] = []
    for (const row of xml.matchAll(/<row\s[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = []
      for (const cell of row[1]!.matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(`<c ${cell[1]}`, 'r')
        const column = ref ? columnIndex(ref) : cells.length
        const type = attr(`<c ${cell[1]}`, 't')
        const style = attr(`<c ${cell[1]}`, 's')
        const body = cell[2] ?? ''
        let value = ''
        if (type === 's') {
          const v = /<v>([^<]*)<\/v>/.exec(body)
          value = v ? (shared[Number(v[1])] ?? '') : ''
        } else if (type === 'inlineStr') {
          value = textOf(body)
        } else {
          const v = /<v>([^<]*)<\/v>/.exec(body)
          value = v ? unescapeXml(v[1]!) : ''
          // A re-saved workbook may hold the time as a day serial with a
          // date style; paimon.moe writes it as text. Only serials of a
          // date-like size are turned into times (counts stay counts).
          if (
            type === null &&
            style !== null &&
            /^\d+\.\d+$/.test(value) &&
            Number(value) > 30000
          ) {
            value = serialToTime(Number(value))
          }
        }
        while (cells.length < column) cells.push('')
        cells[column] = value
      }
      rows.push(cells)
    }
    sheets.set(name, rows)
  }
  return { sheets }
}

/** The column of a header named one of `names` (case-insensitive), else `fallback`. */
function column(header: readonly string[], names: readonly string[], fallback: number): number {
  const i = header.findIndex((h) => names.includes(h.trim().toLowerCase()))
  return i >= 0 ? i : fallback
}

/** Reads paimon.moe's Excel export. */
export function parsePaimonXlsx(bytes: Uint8Array): WishFile {
  const { sheets } = readWorkbook(bytes)
  const records: WishRecord[] = []
  let bannerSheets = 0
  for (const [name, rows] of sheets) {
    const banner = SHEET_BANNERS.find(([prefix]) => name.trim().toLowerCase().startsWith(prefix))
    if (!banner) continue
    bannerSheets++
    const header = rows[0] ?? []
    const typeAt = column(header, ['type'], 0)
    const nameAt = column(header, ['name'], 1)
    const timeAt = column(header, ['time'], 2)
    const rankAt = column(header, ['⭐', 'rank', 'rarity', 'stars'], 3)
    for (const row of rows.slice(1)) {
      const time = (row[timeAt] ?? '').trim()
      const itemName = (row[nameAt] ?? '').trim()
      if (!time && !itemName) continue
      const rank = (row[rankAt] ?? '').trim()
      records.push({
        gacha_type: banner[1],
        time,
        name: itemName,
        item_type: (row[typeAt] ?? '').trim(),
        rank_type: /^\d+$/.test(rank) ? rank : '',
      })
    }
  }
  if (bannerSheets === 0) throw new WishFileError("Not paimon.moe's Excel export")
  return {
    format: 'paimon-xlsx',
    accounts: [{ uid: null, timezone: null, lang: 'en-us', records }],
  }
}

/** Excel's file signature (a zip). */
export const isZipFile = (bytes: Uint8Array): boolean =>
  bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4

/**
 * Reads any supported file from its bytes: paimon.moe's Excel export (a
 * zip), else the text formats (`parseWishFile`).
 */
export function parseWishBytes(bytes: Uint8Array): WishFile {
  if (isZipFile(bytes)) return parsePaimonXlsx(bytes)
  return parseWishFile(strFromU8(bytes))
}
