import { readStorage, writeStorage } from '@/lib/storage'

/**
 * The account data this device already downloaded, kept in IndexedDB across
 * visits: a bundle, the artifact catalog or the snapshot list never changes
 * for one data version, so a repeat visit reads it here instead of waiting
 * for the network. Only the newest version per account is kept (a put drops
 * older ones); signing out clears it all. Everything fails soft: without
 * IndexedDB (private windows, blocked storage, quota) reads miss and writes
 * do nothing.
 */

const DB_NAME = 'gdt-data'
const STORE = 'entries'
/** Set while anything is stored, so signing out on a device that never stored skips opening it. */
const FLAG = 'data-cache'

interface Entry {
  key: string
  account: number
  version: number
  value: ArrayBuffer | string
  at: number
  /** A history pack (data/bundle-packs.ts): kept by its content key, whatever the version. */
  pack?: true
}

let opening: Promise<IDBDatabase | null> | null = null

function open(): Promise<IDBDatabase | null> {
  opening ??= new Promise<IDBDatabase | null>((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1)
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(STORE, { keyPath: 'key' })
        store.createIndex('account', 'account')
      }
      request.onsuccess = () => {
        const db = request.result
        // Another tab deleting or upgrading it: let go, open again next time.
        db.onversionchange = () => {
          db.close()
          opening = null
        }
        resolve(db)
      }
      request.onerror = () => resolve(null)
      request.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return opening
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

/** The stored value for `key` at exactly `version` of `account`, if any. */
export async function readCached(
  key: string,
  account: number,
  version: number,
): Promise<ArrayBuffer | string | undefined> {
  try {
    const db = await open()
    if (!db) return undefined
    const entry = await new Promise<Entry | undefined>((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
      request.onsuccess = () => resolve(request.result as Entry | undefined)
      request.onerror = () => reject(request.error)
    })
    return entry && entry.account === account && entry.version === version ? entry.value : undefined
  } catch {
    return undefined
  }
}

/** Stores `value`, dropping what is kept of older versions of the account. */
export async function writeCached(
  key: string,
  account: number,
  version: number,
  value: ArrayBuffer | string,
): Promise<void> {
  try {
    const db = await open()
    if (!db) return
    writeStorage(FLAG, '1')
    const transaction = db.transaction(STORE, 'readwrite')
    const store = transaction.objectStore(STORE)
    // One pass over the account's entries: older versions go, and a newer
    // one already kept means this value is out of date (not stored).
    let newer = false
    const cursors = store.index('account').openCursor(IDBKeyRange.only(account))
    cursors.onsuccess = () => {
      const cursor = cursors.result
      if (cursor) {
        const entry = cursor.value as Entry
        if (!entry.pack) {
          if (entry.version < version) cursor.delete()
          else if (entry.version > version) newer = true
        }
        cursor.continue()
      } else if (!newer) {
        store.put({ key, account, version, value, at: Date.now() } satisfies Entry)
      }
    }
    await done(transaction)
  } catch {
    // Not kept; the next visit downloads it again.
  }
}

/** A history pack kept under `key` (data/bundle-packs.ts), if any. */
export async function readPack(key: string): Promise<ArrayBuffer | undefined> {
  try {
    const db = await open()
    if (!db) return undefined
    const entry = await new Promise<Entry | undefined>((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
      request.onsuccess = () => resolve(request.result as Entry | undefined)
      request.onerror = () => reject(request.error)
    })
    return entry?.pack && entry.value instanceof ArrayBuffer ? entry.value : undefined
  } catch {
    return undefined
  }
}

/** Keeps a history pack; its key names its content, so it never goes stale. */
export async function writePack(key: string, account: number, value: ArrayBuffer): Promise<void> {
  try {
    const db = await open()
    if (!db) return
    writeStorage(FLAG, '1')
    const transaction = db.transaction(STORE, 'readwrite')
    transaction
      .objectStore(STORE)
      .put({ key, account, version: 0, value, at: Date.now(), pack: true } satisfies Entry)
    await done(transaction)
  } catch {
    // Not kept; the next read downloads it again.
  }
}

/** Drops the account's packs under `prefix` that `keep` no longer names. */
export async function prunePacks(
  account: number,
  prefix: string,
  keep: ReadonlySet<string>,
): Promise<void> {
  try {
    const db = await open()
    if (!db) return
    const transaction = db.transaction(STORE, 'readwrite')
    const cursors = transaction
      .objectStore(STORE)
      .index('account')
      .openCursor(IDBKeyRange.only(account))
    cursors.onsuccess = () => {
      const cursor = cursors.result
      if (!cursor) return
      const entry = cursor.value as Entry
      if (entry.pack && entry.key.startsWith(prefix) && !keep.has(entry.key)) cursor.delete()
      cursor.continue()
    }
    await done(transaction)
  } catch {
    // Left for the next prune.
  }
}

/** Signed out: nothing of the account data stays on this device. */
export async function clearCached(): Promise<void> {
  if (readStorage(FLAG) === null) return
  writeStorage(FLAG, null)
  try {
    const db = await open()
    if (!db) return
    const transaction = db.transaction(STORE, 'readwrite')
    transaction.objectStore(STORE).clear()
    await done(transaction)
  } catch {
    // Storage gone already.
  }
}
