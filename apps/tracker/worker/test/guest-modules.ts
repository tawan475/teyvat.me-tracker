/**
 * Guest mode's browser modules (src/local), for the tests that run them
 * against the Worker. Loaded untyped: their types need the DOM (IndexedDB,
 * BroadcastChannel, the import queue's File and window), which this project
 * (workerd's types) has none of; the app's own project type-checks them.
 */

/** The parts of local-store.ts's LocalStore the tests use. */
export interface GuestStore {
  account: { createdAt: number } | null
  blobs: Map<number, unknown>
  snapshots: Map<number, unknown>
  state: Map<string, unknown>
  ready(): Promise<GuestStore>
  clear(): Promise<void>
  transact<T>(change: (tx: { setState(key: string, value: unknown): void }) => T): Promise<T>
}

/** The parts of folder-record.ts's FolderRecord the tests use. */
export interface GuestFolderRecord {
  v: 1
  handle: unknown
  name: string
  pickedAt: number
  stopped: boolean
  firstDone: boolean
  seen: Record<string, string>
  last: { name: string; at: number } | null
  refused: unknown[]
  rows: Record<number, string>
}

export interface GuestModules {
  memoryBackend(): { entries(table: string): Promise<[unknown, unknown][]> }
  LocalStore: new (backend: unknown) => GuestStore
  setGuestStore(store: GuestStore | null): void
  localFetch(
    path: string,
    init: { method?: string; json?: unknown; body?: BodyInit },
  ): Promise<Response>
  convertGuest(
    accountId: number,
    onProgress: (progress: { done: number; total: number; step: string }) => void,
    store: GuestStore,
  ): Promise<{
    snapshots: { created: number; unchanged: number; failed: number }
    pulls: number
    editsSkipped: boolean
  }>
  guestFiles(store: GuestStore): Promise<{ lastModified: number }[]>
  guestSummary(store: GuestStore): Promise<{ snapshots: number; pulls: number }>
  /** local-import.ts: a GOOD file into the store, `folder` for the watched folder's rule. */
  importLocal(
    store: GuestStore,
    upload: {
      text: string
      rawSize: number
      timestamp?: unknown
      folder?: boolean
      watched?: () => Promise<boolean>
    },
  ): Promise<{ status: string; snapshotId: number; warnings?: { code: string }[] }>
  /** local-wishes.ts: wish records into the store, `folder` for the watched folder's rule. */
  importWishesLocal(
    store: GuestStore,
    input: {
      uid?: string
      records: readonly unknown[]
      folder?: boolean
      watched?: () => Promise<boolean>
    },
  ): Promise<{ added: number; known: number }>
  /** folder-record.ts: the watched folder's record, changed under the store's write lock. */
  loadRecord(store: GuestStore): Promise<GuestFolderRecord | null>
  pickRecord(
    make: (before: GuestFolderRecord | null) => GuestFolderRecord,
    store: GuestStore,
  ): Promise<GuestFolderRecord>
  updateRecord(
    change: (now: GuestFolderRecord, store: GuestStore) => GuestFolderRecord,
    store: GuestStore,
  ): Promise<GuestFolderRecord | null>
  stillKept(pickedAt: number, store: GuestStore): () => Promise<boolean>
}

const load = (name: string): Promise<Record<string, unknown>> =>
  import(/* @vite-ignore */ `@/local/${name}`)

/** `convert`: also the conversion (it reaches the app's stores: mock them first). */
export async function loadGuestModules(convert = false): Promise<GuestModules> {
  const [backend, store, server, imports, wishes, record, conversion] = await Promise.all([
    load('backend'),
    load('local-store'),
    load('server'),
    load('local-import'),
    load('local-wishes'),
    load('folder-record'),
    convert ? load('convert') : Promise.resolve({}),
  ])
  return {
    ...backend,
    ...store,
    ...server,
    ...imports,
    ...wishes,
    ...record,
    ...conversion,
  } as unknown as GuestModules
}
