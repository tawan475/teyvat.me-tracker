/**
 * UIAF, the achievement file of UIGF-Org (https://uigf.org/en/standards/uiaf.html,
 * v1.1; Snap.Hutao.Remastered, cocogoat and the other tools listed there read
 * and write it):
 *
 *   { info: { export_app, export_app_version?, uiaf_version, export_timestamp? },
 *     list: [{ id, current, status, timestamp }] }
 *
 * `status`: 0 invalid, 1 unfinished, 2 finished, 3 reward claimed (v1.1;
 * v1.0 had no status and listed finished achievements). `current` is the
 * progress value, `timestamp` the finish time in unix seconds,
 * `UIAF_UNKNOWN_TIME` when unknown. Ids are the game's own achievement ids.
 *
 * Plain TypeScript, no zod: the tracker may import it from a startup path
 * (`@gdt/shared/achievements/uiaf`).
 */

/** 9999-12-31 23:59:59: the spec's "finish time unknown". */
export const UIAF_UNKNOWN_TIME = 253402271999
/** A file larger than this is refused (about 50× a whole account's list). */
export const UIAF_MAX_BYTES = 5 * 1024 * 1024
/** A list longer than this is refused (about 3× the game's achievements). */
export const UIAF_MAX_ENTRIES = 10_000
/** The highest id read (the game's ids are five digits). */
export const UIAF_MAX_ID = 2 ** 31

export const UIAF_VERSIONS = ['v1.0', 'v1.1'] as const
export type UiafVersion = (typeof UIAF_VERSIONS)[number]

export type UiafStatus = 0 | 1 | 2 | 3

export interface UiafEntry {
  id: number
  current: number
  status: UiafStatus
  timestamp: number
}

export interface UiafInfo {
  export_app: string
  export_app_version?: string
  uiaf_version: UiafVersion
  export_timestamp?: number
}

export interface UiafFile {
  info: UiafInfo
  list: UiafEntry[]
}

export type UiafErrorCode =
  /** Not a UIAF file at all (no `info.uiaf_version`, or a UIGF file). */
  | 'not_uiaf'
  /** A UIAF version this reader does not know. */
  | 'version'
  /** Larger than UIAF_MAX_BYTES. */
  | 'too_big'
  /** More than UIAF_MAX_ENTRIES entries. */
  | 'too_many'
  /** Not JSON, or `list` is not a list. */
  | 'malformed'

export class UiafError extends Error {
  constructor(
    readonly code: UiafErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'UiafError'
  }
}

export interface ParsedUiaf {
  version: UiafVersion
  app: string
  appVersion: string | null
  /** `info.export_timestamp` (unix seconds) when the file has a usable one. */
  exportedAt: number | null
  /** One entry per id (duplicates merged: the highest status wins), sorted by id. */
  entries: UiafEntry[]
  /** Ids finished (status 2 or 3, or an entry without a status), sorted. */
  finished: number[]
  /** Entries with status 1: unfinished. */
  unfinished: number
  /** Entries with status 0: invalid by the file's own word. */
  invalid: number
  /** Entries left out because a field had the wrong type or range. */
  malformed: number
  /** Entries whose id an earlier entry already had. */
  duplicates: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * True for an object shaped as UIAF: `info.uiaf_version` is a string and
 * `list` a list. A UIGF file (`info.uigf_version` / `info.version`, or a
 * `hk4e` block) is never UIAF, even with a `list`.
 */
export function isUiaf(json: unknown): json is Record<string, unknown> {
  if (!isRecord(json) || !isRecord(json.info) || !Array.isArray(json.list)) return false
  const info = json.info
  if (typeof info.uiaf_version !== 'string') return false
  if ('uigf_version' in info || 'srgf_version' in info) return false
  return !('hk4e' in json || 'hkrpg' in json || 'nap' in json || 'hk4e_ugc' in json)
}

const nonNegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

function readEntry(raw: unknown): UiafEntry | null {
  if (!isRecord(raw)) return null
  const { id, current, status, timestamp } = raw
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0 || id > UIAF_MAX_ID)
    return null
  // Read leniently, written strictly: a missing counter or time is "unknown".
  if (current !== undefined && !nonNegative(current)) return null
  if (timestamp !== undefined && !nonNegative(timestamp)) return null
  let read: UiafStatus
  if (status === undefined)
    read = 2 // v1.0 listed finished achievements
  else if (status === 0 || status === 1 || status === 2 || status === 3) read = status
  else return null
  return {
    id,
    current: current === undefined ? 0 : Math.floor(current),
    status: read,
    timestamp: timestamp === undefined ? UIAF_UNKNOWN_TIME : Math.floor(timestamp),
  }
}

const byteLength = (text: string) => new TextEncoder().encode(text).length

/**
 * Reads a UIAF file from its text or its parsed JSON. Throws UiafError for
 * anything that is not a UIAF v1.0/v1.1 file or breaks a limit; an entry
 * with a field of the wrong type is left out and counted (`malformed`).
 */
export function parseUiaf(input: string | unknown): ParsedUiaf {
  let json: unknown = input
  if (typeof input === 'string') {
    if (byteLength(input) > UIAF_MAX_BYTES) throw new UiafError('too_big', 'The file is too big')
    try {
      json = JSON.parse(input.replace(/^﻿/, ''))
    } catch {
      throw new UiafError('malformed', 'Not a JSON file')
    }
  }
  if (!isUiaf(json)) throw new UiafError('not_uiaf', 'Not a UIAF file')
  const info = json.info as Record<string, unknown>
  const version = UIAF_VERSIONS.find((v) => v === info.uiaf_version)
  if (!version) throw new UiafError('version', `UIAF ${String(info.uiaf_version)} is not read`)
  const list = json.list as unknown[]
  if (list.length > UIAF_MAX_ENTRIES)
    throw new UiafError('too_many', `More than ${UIAF_MAX_ENTRIES} entries`)

  const byId = new Map<number, UiafEntry>()
  let malformed = 0
  let duplicates = 0
  for (const raw of list) {
    const entry = readEntry(raw)
    if (!entry) {
      malformed++
      continue
    }
    const held = byId.get(entry.id)
    if (!held) {
      byId.set(entry.id, entry)
      continue
    }
    duplicates++
    if (entry.status > held.status) byId.set(entry.id, entry)
    else if (entry.status === held.status && entry.current > held.current)
      byId.set(entry.id, { ...held, current: entry.current })
  }

  const entries = [...byId.values()].sort((a, b) => a.id - b.id)
  const exported = info.export_timestamp
  return {
    version,
    app: typeof info.export_app === 'string' ? info.export_app : '',
    appVersion: typeof info.export_app_version === 'string' ? info.export_app_version : null,
    exportedAt: nonNegative(exported) ? Math.floor(exported) : null,
    entries,
    finished: entries.filter((e) => e.status >= 2).map((e) => e.id),
    unfinished: entries.filter((e) => e.status === 1).length,
    invalid: entries.filter((e) => e.status === 0).length,
    malformed,
    duplicates,
  }
}

/** UIAF v1.1, entries sorted by id (one per id: the first given wins). */
export function buildUiaf(
  rows: readonly UiafEntry[],
  app: { name: string; version?: string; now?: number },
): UiafFile {
  const seen = new Set<number>()
  const list: UiafEntry[] = []
  for (const row of [...rows].sort((a, b) => a.id - b.id)) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    list.push({ id: row.id, current: row.current, status: row.status, timestamp: row.timestamp })
  }
  return {
    info: {
      export_app: app.name,
      ...(app.version !== undefined ? { export_app_version: app.version } : {}),
      uiaf_version: 'v1.1',
      export_timestamp: Math.floor((app.now ?? Date.now()) / 1000),
    },
    list,
  }
}
