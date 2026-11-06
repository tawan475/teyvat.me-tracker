/**
 * Client-side export. The server never builds zips: it sends stored
 * sections (a GDT1 bundle) and the browser rebuilds GOOD files.
 *
 * - One snapshot: the server's own decode, `GET …/snapshots/:id/good`.
 * - Many: a Web Worker decodes and zips (src/workers/export.worker.ts); the
 *   page streams the chunks to a file chosen with showSaveFilePicker where
 *   the browser has it, or collects them into a Blob and downloads that.
 *
 * One export runs at a time. Its state lives here, not in a component, so
 * it keeps going (and stays visible) when the user moves between pages.
 */

import { readonly, ref } from 'vue'
import { api } from '@/api'
import { accountPath } from '@/api/inspect'
import { t } from '@/i18n'
import type { ExportEvent, ExportStart } from './export-protocol'
import { goodFileName } from './export-zip'

export { goodFileName } from './export-zip'

/** Hands a Blob to the browser as a download. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
  // The download has started by now; give slow browsers a minute anyway.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** Downloads one snapshot as a GOOD file. Returns the file's size in bytes. */
export async function downloadSnapshotGood(
  accountId: number,
  snapshot: { id: number; takenAt: number },
): Promise<number> {
  const good = await api.snapshotGood(accountId, snapshot.id)
  const blob = new Blob([JSON.stringify(good)], { type: 'application/json' })
  saveBlob(blob, goodFileName(snapshot.takenAt))
  return blob.size
}

// ---------------------------------------------------------------- zip export

export interface ExportJob {
  accountId: number
  /** Snapshots asked for. */
  requested: number
  fileName: string
  /** Streaming to a file the user picked, or building a download. */
  target: 'file' | 'download'
  phase: 'fetching' | 'zipping' | 'saving'
  fetched: number
  fetchTotal: number | null
  done: number
  total: number
  jsonBytes: number
  zipBytes: number
}

export interface ExportResult {
  fileName: string
  target: 'file' | 'download'
  /** Files in the zip; fewer than requested if some were deleted meanwhile. */
  files: number
  requested: number
  jsonBytes: number
  zipBytes: number
}

const job = ref<ExportJob | null>(null)
let cancelCurrent: (() => void) | null = null
/** True while the save picker is open, before the job exists. */
let starting = false

/** The running export, if any (read-only; update via exportZip/cancelExport). */
export const exportJob = readonly(job)

/** Stops the running export and discards its partial file. */
export function cancelExport(): void {
  cancelCurrent?.()
}

interface SavePickerOptions {
  suggestedName?: string
  types?: { description: string; accept: Record<string, string[]> }[]
}
type SaveFilePicker = (options?: SavePickerOptions) => Promise<FileSystemFileHandle>

function savePicker(): SaveFilePicker | null {
  const picker = (window as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker
  // Cross-origin frames refuse the picker; so do some embedded browsers.
  return picker && window.self === window.top ? picker.bind(window) : null
}

interface FileTarget {
  handle: FileSystemFileHandle
  writable: FileSystemWritableFileStream
}

/**
 * Asks where to save. null: this browser has no save picker (download
 * instead); 'dismissed': the user closed it.
 */
async function pickFile(suggestedName: string): Promise<FileTarget | null | 'dismissed'> {
  const picker = savePicker()
  if (!picker) return null
  let handle: FileSystemFileHandle
  try {
    handle = await picker({
      suggestedName,
      types: [
        { description: t('transfer.export.zipArchive'), accept: { 'application/zip': ['.zip'] } },
      ],
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return 'dismissed'
    return null // Refused by policy or the frame: fall back to a download.
  }
  return { handle, writable: await handle.createWritable() }
}

/** Best effort: the picker creates the file up front, so remove it on failure. */
async function discard({ handle, writable }: FileTarget) {
  await writable.abort().catch(() => {})
  await (handle as { remove?: () => Promise<void> }).remove?.().catch(() => {})
}

function onBeforeUnload(event: BeforeUnloadEvent) {
  event.preventDefault()
}

/**
 * Exports snapshots (all when `ids` is null) as a zip of GOOD files. Must be
 * called from a click handler: the save picker needs the user's gesture.
 * Resolves null when the user dismisses the picker or cancels.
 */
export async function exportZip(options: {
  accountId: number
  ids: number[] | null
  requested: number
  fileName: string
  /** Add live sync's `live/` folder (export-protocol.ts). */
  live?: boolean
}): Promise<ExportResult | null> {
  if (job.value) throw new Error(t('transfer.export.alreadyRunning'))
  if (starting) return null // A second click while the picker is open.

  starting = true
  let target: FileTarget | null | 'dismissed'
  try {
    target = await pickFile(options.fileName)
  } finally {
    starting = false
  }
  if (target === 'dismissed') return null
  const file = target
  const fileName = file?.handle.name ?? options.fileName

  job.value = {
    accountId: options.accountId,
    requested: options.requested,
    fileName,
    target: file ? 'file' : 'download',
    phase: 'fetching',
    fetched: 0,
    fetchTotal: null,
    done: 0,
    total: options.requested,
    jsonBytes: 0,
    zipBytes: 0,
  }
  const worker = new Worker(new URL('../workers/export.worker.ts', import.meta.url), {
    type: 'module',
  })
  window.addEventListener('beforeunload', onBeforeUnload)

  try {
    return await new Promise<ExportResult | null>((resolve, reject) => {
      const parts: Uint8Array<ArrayBuffer>[] = []
      let writing: Promise<void> = Promise.resolve()
      let settled = false

      const fail = (error: unknown) => {
        if (settled) return
        settled = true
        worker.terminate()
        if (file) void discard(file)
        reject(error instanceof Error ? error : new Error(String(error)))
      }

      cancelCurrent = () => {
        if (settled) return
        settled = true
        worker.terminate()
        if (file) void discard(file)
        resolve(null)
      }

      worker.onerror = (event) => {
        event.preventDefault()
        fail(new Error(event.message || t('transfer.export.workerStopped')))
      }
      worker.onmessageerror = () => fail(new Error(t('transfer.export.workerUnreadable')))

      worker.onmessage = async ({ data: message }: MessageEvent<ExportEvent>) => {
        if (settled) return
        const current = job.value!
        switch (message.type) {
          case 'fetching':
            current.fetched = message.loaded
            current.fetchTotal = message.total
            break
          case 'progress':
            current.phase = 'zipping'
            current.done = message.done
            current.total = message.total
            current.jsonBytes = message.jsonBytes
            current.zipBytes = message.zipBytes
            break
          case 'chunk':
            if (file) {
              const data = message.data
              writing = writing.then(() => file.writable.write(data))
              writing.catch(fail)
            } else {
              parts.push(message.data)
            }
            break
          case 'error':
            fail(new Error(message.message))
            break
          case 'done': {
            current.phase = 'saving'
            current.zipBytes = message.zipBytes
            worker.terminate()
            try {
              if (file) {
                await writing
                await file.writable.close()
              } else {
                saveBlob(new Blob(parts, { type: 'application/zip' }), fileName)
              }
            } catch (error) {
              fail(error)
              return
            }
            if (settled) return
            settled = true
            resolve({
              fileName,
              target: file ? 'file' : 'download',
              files: message.files,
              requested: options.requested,
              jsonBytes: message.jsonBytes,
              zipBytes: message.zipBytes,
            })
            break
          }
        }
      }

      const start: ExportStart = {
        type: 'start',
        accountId: options.accountId,
        root: accountPath(options.accountId, '').slice(0, -1),
        ids: options.ids,
        level: 6,
        live: options.live ?? false,
      }
      worker.postMessage(start)
    })
  } finally {
    worker.terminate()
    window.removeEventListener('beforeunload', onBeforeUnload)
    cancelCurrent = null
    job.value = null
  }
}
