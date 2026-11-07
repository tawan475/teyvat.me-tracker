/**
 * Where the guest store (local-store.ts) keeps its rows: IndexedDB in the
 * browser (database `gdt-guest`), a Map in tests (the tests run in workerd,
 * which has no IndexedDB). Both answer the same few calls: read a table
 * whole, read one value, and apply a list of puts and deletes at once.
 */

export const TABLES = ['meta', 'blobs', 'snapshots', 'artifacts', 'state'] as const
export type Table = (typeof TABLES)[number]
export type Key = string | number

/** One change: a value to put, or `null` to delete the key. */
export interface WriteOp {
  table: Table
  key: Key
  value: unknown
}

export interface LocalBackend {
  get(table: Table, key: Key): Promise<unknown>
  /** Every [key, value] of a table. */
  entries(table: Table): Promise<[Key, unknown][]>
  /** All or nothing. */
  write(ops: readonly WriteOp[]): Promise<void>
  /** Deletes everything (the guest data is gone). */
  clear(): Promise<void>
}

/** In memory: tests, and a browser without IndexedDB (nothing outlives the tab). */
export function memoryBackend(): LocalBackend {
  const tables = new Map<Table, Map<Key, unknown>>(TABLES.map((t) => [t, new Map()]))
  const copy = <T>(value: T): T => structuredClone(value)
  return {
    async get(table, key) {
      const value = tables.get(table)!.get(key)
      return value === undefined ? undefined : copy(value)
    },
    async entries(table) {
      return [...tables.get(table)!].map(([k, v]) => [k, copy(v)])
    },
    async write(ops) {
      for (const op of ops) {
        const store = tables.get(op.table)!
        if (op.value === null) store.delete(op.key)
        else store.set(op.key, copy(op.value))
      }
    },
    async clear() {
      for (const store of tables.values()) store.clear()
    },
  }
}

const DB_NAME = 'gdt-guest'

function requestDone<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error ?? new Error('Transaction aborted'))
  })
}

/** IndexedDB, one object store per table (out-of-line keys). */
export function indexedDbBackend(): LocalBackend {
  let opening: Promise<IDBDatabase> | null = null
  const open = () => {
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1)
      request.onupgradeneeded = () => {
        for (const table of TABLES) {
          if (!request.result.objectStoreNames.contains(table)) {
            request.result.createObjectStore(table)
          }
        }
      }
      request.onsuccess = () => {
        const db = request.result
        db.onversionchange = () => {
          db.close()
          opening = null
        }
        resolve(db)
      }
      request.onerror = () => {
        opening = null
        reject(request.error)
      }
      request.onblocked = () => {
        opening = null
        reject(new Error('The guest store is blocked by another tab'))
      }
    })
    return opening
  }
  return {
    async get(table, key) {
      const db = await open()
      return requestDone(db.transaction(table).objectStore(table).get(key))
    },
    async entries(table) {
      const db = await open()
      const store = db.transaction(table).objectStore(table)
      const [keys, values] = await Promise.all([
        requestDone(store.getAllKeys()),
        requestDone(store.getAll()),
      ])
      return keys.map((key, i) => [key as Key, values[i]])
    },
    async write(ops) {
      if (ops.length === 0) return
      const db = await open()
      const tables = [...new Set(ops.map((op) => op.table))]
      const transaction = db.transaction(tables, 'readwrite')
      for (const op of ops) {
        const store = transaction.objectStore(op.table)
        if (op.value === null) store.delete(op.key)
        else store.put(op.value, op.key)
      }
      await transactionDone(transaction)
    },
    async clear() {
      const db = await open()
      const transaction = db.transaction([...TABLES], 'readwrite')
      for (const table of TABLES) transaction.objectStore(table).clear()
      await transactionDone(transaction)
    },
  }
}
