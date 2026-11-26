import { ApiError } from './http'
import type { D1Meter } from './meter'

/**
 * One `import_stages` log line per upload that can store a snapshot (Capture's
 * Bearer route, import-by-key, the website's import): where the request's time
 * went, stage by stage, and the sizes that explain it. Numbers and fixed words
 * only (no account, user, UID, key, name or text from the file), so the line
 * is safe for anyone to read; a test pins the keys (IMPORT_STAGE_KEYS).
 *
 * Each `…Ms` figure is the clock's move since the previous stage ended. A
 * deployed Worker's clock moves only across I/O, so there a figure holds the
 * CPU of the code since the last I/O plus the wait of the I/O that ends its
 * stage (if any); stages with no I/O of their own read 0 and their CPU shows
 * in the next stage that waits on something (`lookup`, `catalog`, `store`,
 * `journal`). Locally (vitest, Node) the clock runs, so every stage reads its
 * own time. `sqlMs` is the part D1 itself spent executing SQL.
 */

/** The stages, in the order an upload passes them. */
export const IMPORT_STAGES = [
  /** Route start to the body read: the key or session lookup, rate limits. */
  'auth',
  /** Reading the body (and gunzip). */
  'body',
  /** JSON.parse and prepareSnapshot (normalise, fingerprint the artifact list). */
  'parse',
  /** Which account the file goes to (a UID change, a new account). */
  'owner',
  /** The static sections encoded and hashed. */
  'prepare',
  /** The first lookup batch. */
  'lookup',
  /** The artifact list read (when not held), the catalog chunks read, ids matched. */
  'artifacts',
  /** Catalog ids reserved for new pieces (a round trip only when there are some). */
  'catalog',
  /** The content hash (and older ones, for a re-upload of the same capture time). */
  'encode',
  /** Neighbour sections decoded, sections planned (encode, delta, deflate), statements built. */
  'plan',
  /** The store batch (or the seen-again batch). */
  'store',
  /** Live sync: the account's journal opened on the snapshot. */
  'journal',
  /** The rest until the answer (live events, alert facts). */
  'after',
] as const

export type ImportStage = (typeof IMPORT_STAGES)[number]

/** The sizes the line carries. */
export interface ImportStageSizes {
  /** The request's declared bytes (content-length). */
  sent: number
  /** The file's bytes, decompressed. */
  raw: number
  /** Artifacts in the file. */
  pieces: number
  /** Catalog chunk rows read. */
  chunkRows: number
  /** Distinct artifact identities in the chunk rows read. */
  identities: number
  /** Pieces the catalog lacked (new catalog entries). */
  newPieces: number
  /** Neighbour section rows fetched (LATEST_BLOBS_SQL) and their bytes. */
  blobRows: number
  blobBytes: number
  /** New section blobs planned, and the bytes the snapshot stores. */
  sections: number
  stored: number
}

/** Where the upload came in. */
export type ImportRoute = 'capture' | 'key' | 'web'

/** Every key of the line, in order. */
export const IMPORT_STAGE_KEYS = [
  'v',
  'route',
  'status',
  'code',
  'held',
  ...IMPORT_STAGES.map((stage) => `${stage}Ms` as const),
  'totalMs',
  'sqlMs',
  'trips',
  'sent',
  'raw',
  'pieces',
  'chunkRows',
  'identities',
  'newPieces',
  'blobRows',
  'blobBytes',
  'sections',
  'stored',
] as const

export class ImportStages {
  private readonly start: number
  private last: number
  private readonly ms = Object.fromEntries(IMPORT_STAGES.map((s) => [s, 0])) as Record<
    ImportStage,
    number
  >
  private readonly sizes: ImportStageSizes = {
    sent: 0,
    raw: 0,
    pieces: 0,
    chunkRows: 0,
    identities: 0,
    newPieces: 0,
    blobRows: 0,
    blobBytes: 0,
    sections: 0,
    stored: 0,
  }
  private held = false
  private logged = false

  constructor(readonly route: ImportRoute) {
    this.start = Date.now()
    this.last = this.start
  }

  /** Ends `stage`: the clock's move since the previous stage ended is its time. */
  lap(stage: ImportStage): void {
    const now = Date.now()
    this.ms[stage] += now - this.last
    this.last = now
  }

  note(sizes: Partial<ImportStageSizes> & { held?: boolean }): void {
    const { held, ...rest } = sizes
    if (held !== undefined) this.held = held
    Object.assign(this.sizes, rest)
  }

  /** Logs the line once: the answer's status, or `failed` with the HTTP status of the error. */
  done(meter: D1Meter, outcome: { status: string } | { error: unknown }): void {
    if (this.logged) return
    this.logged = true
    const failed = 'error' in outcome
    const code = failed ? (outcome.error instanceof ApiError ? outcome.error.status : 500) : 0
    const status = failed ? 'failed' : outcome.status === 'created' ? 'created' : 'unchanged'
    const line: Record<(typeof IMPORT_STAGE_KEYS)[number], number | string> = {
      v: 1,
      route: this.route,
      status,
      code,
      held: this.held ? 1 : 0,
      ...(Object.fromEntries(
        IMPORT_STAGES.map((s) => [`${s}Ms`, Math.round(this.ms[s])]),
      ) as Record<`${ImportStage}Ms`, number>),
      totalMs: Math.round(Date.now() - this.start),
      sqlMs: Math.round(meter.sqlMs),
      trips: meter.roundTrips,
      ...this.sizes,
    }
    console.log('import_stages', JSON.stringify(line))
  }
}
