/**
 * The watched folder's record (folder-watch.ts): what guest mode keeps for
 * the folder, in the guest's IndexedDB beside its data (`gdt-guest`, table
 * `meta`, key `folder`).
 *
 * Guest pages can be open in several tabs, and any of them may delete the
 * guest data while another is still reading the folder. So every write that
 * comes from the folder runs under the guest store's write lock, on what is
 * stored at that moment (LocalStore.locked, the lock a delete holds while
 * it clears the store): a change to the record is made on the record as it
 * is then and written only while there is one (updateRecord), and a file is
 * stored only while its folder is still the one kept (stillKept, asked by
 * the local imports inside their own write). A tab mid-read therefore never
 * writes a record, a snapshot or wishes into a store another tab just
 * cleared.
 */

import type { RefusedFile } from './folder-state'
import { guestStore, type LocalStore } from './local-store'

export type Permission = 'granted' | 'denied' | 'prompt'

/** The parts of FileSystemDirectoryHandle used (the permission calls aren't in TS's DOM lib). */
export interface DirectoryHandle {
  readonly kind: 'directory'
  readonly name: string
  values(): AsyncIterable<FileHandle | DirectoryHandle>
  queryPermission(options: { mode: 'read' }): Promise<Permission>
  requestPermission(options: { mode: 'read' }): Promise<Permission>
}
export interface FileHandle {
  readonly kind: 'file'
  readonly name: string
  getFile(): Promise<File>
}

/** What is kept for the folder (IndexedDB `gdt-guest`, `meta` / `folder`). */
export interface FolderRecord {
  v: 1
  handle: DirectoryHandle
  name: string
  /** When it was picked: tells this folder from one picked since (Change during a read). */
  pickedAt: number
  /** Stopped by the user: the folder is kept (Watch again is one click). */
  stopped: boolean
  /** Whether the first read (every export already there) finished. */
  firstDone: boolean
  /** Every file looked at: name → fileKey. */
  seen: Record<string, string>
  /** The newest file read and its time. */
  last: { name: string; at: number } | null
  /** Files of another UID, listed until dismissed. */
  refused: RefusedFile[]
  /** Snapshots read from a watched folder: id → file name (the Snapshots folder glyph). */
  rows: Record<number, string>
}

const RECORD_KEY = 'folder'

/** The record as stored now; null when there is none (or the store can't be read). */
export async function loadRecord(store: LocalStore = guestStore()): Promise<FolderRecord | null> {
  try {
    const value = (await store.backend.get('meta', RECORD_KEY)) as FolderRecord | undefined
    return value?.v === 1 ? value : null
  } catch {
    return null
  }
}

function save(store: LocalStore, record: FolderRecord): Promise<void> {
  return store.backend.write([{ table: 'meta', key: RECORD_KEY, value: record }])
}

/**
 * A folder was picked: its record replaces the one kept (a folder may be
 * picked before there is any guest data). `make` gets the record it
 * replaces, as stored at that moment.
 */
export function pickRecord(
  make: (before: FolderRecord | null) => FolderRecord,
  store: LocalStore = guestStore(),
): Promise<FolderRecord> {
  return store.locked(async () => {
    const record = make(await loadRecord(store))
    await save(store, record)
    return record
  })
}

/**
 * Changes the record kept: `change` gets it as stored at that moment (and
 * the store, current). Null, and nothing written, when there is none any
 * more: the guest data was deleted, here or in another tab.
 */
export function updateRecord(
  change: (now: FolderRecord, store: LocalStore) => FolderRecord,
  store: LocalStore = guestStore(),
): Promise<FolderRecord | null> {
  return store.locked(async () => {
    const now = await loadRecord(store)
    if (!now) return null
    const next = change(now, store)
    if (next !== now) await save(store, next)
    return next
  })
}

/**
 * For a file read from the folder picked at `pickedAt` (the local imports'
 * `watched`, asked under the write lock before they record anything):
 * whether that folder is still the one kept. Not after the guest data was
 * deleted, nor after another folder was picked.
 */
export function stillKept(
  pickedAt: number,
  store: LocalStore = guestStore(),
): () => Promise<boolean> {
  return async () => (await loadRecord(store))?.pickedAt === pickedAt
}
