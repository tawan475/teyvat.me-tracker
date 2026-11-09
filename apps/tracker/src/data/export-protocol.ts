/**
 * Messages between the page and src/workers/export.worker.ts.
 *
 * The worker fetches the bundle and catalog itself, decodes each snapshot to
 * GOOD, deflates it into a zip and posts the archive back as chunks. Where
 * the chunks go (a file picked with showSaveFilePicker, or a Blob) is the
 * page's business. Cancelling is `worker.terminate()`: there is nothing in
 * the worker worth shutting down politely.
 */

/** Page -> worker. */
export interface ExportStart {
  type: 'start'
  accountId: number
  /**
   * Where the account's data is read, without the trailing slash:
   * `/api/accounts/<id>`, or `/api/demo` for the public demo account.
   */
  root: string
  /** Snapshots to export, or null for every live snapshot. */
  ids: number[] | null
  /** DEFLATE level for each file, 0-9. */
  level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
  /**
   * Live sync is on for the account: the zip also gets `live/` (the open
   * journal as GOOD-X delta lines, the chart points as CSV, and the newest
   * snapshot with the journal applied: the account as of now).
   */
  live?: boolean
  /**
   * The raw download for developers: the stored sections and catalog chunks
   * as they are, with an inflate script (data/raw-export.ts), not GOOD files.
   */
  raw?: boolean
}

export type ExportCommand = ExportStart

/** Downloading the bundle and catalog. `total` is null when the size is unknown. */
export interface ExportFetching {
  type: 'fetching'
  loaded: number
  total: number | null
}

/** One more snapshot decoded and added to the zip. */
export interface ExportProgress {
  type: 'progress'
  done: number
  total: number
  /** GOOD JSON produced so far. */
  jsonBytes: number
  /** Zip bytes emitted so far. */
  zipBytes: number
}

/** The next piece of the archive, in order. Its buffer is transferred. */
export interface ExportChunk {
  type: 'chunk'
  data: Uint8Array<ArrayBuffer>
}

/** Every chunk has been posted. */
export interface ExportDone {
  type: 'done'
  files: number
  jsonBytes: number
  zipBytes: number
}

export interface ExportFailed {
  type: 'error'
  message: string
}

/** Worker -> page. */
export type ExportEvent = ExportFetching | ExportProgress | ExportChunk | ExportDone | ExportFailed
