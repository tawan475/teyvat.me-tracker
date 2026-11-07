/**
 * Guest mode's browser modules (src/local), for the tests that run them
 * against the Worker. Loaded untyped: their types need the DOM (IndexedDB,
 * BroadcastChannel, the import queue's File and window), which this project
 * (workerd's types) has none of; the app's own project type-checks them.
 */

/** The parts of local-store.ts's LocalStore the tests use. */
export interface GuestStore {
  blobs: Map<number, unknown>
  state: Map<string, unknown>
  ready(): Promise<GuestStore>
  transact<T>(change: (tx: { setState(key: string, value: unknown): void }) => T): Promise<T>
}

export interface GuestModules {
  memoryBackend(): unknown
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
}

const load = (name: string): Promise<Record<string, unknown>> =>
  import(/* @vite-ignore */ `@/local/${name}`)

/** `convert`: also the conversion (it reaches the app's stores: mock them first). */
export async function loadGuestModules(convert = false): Promise<GuestModules> {
  const [backend, store, server, conversion] = await Promise.all([
    load('backend'),
    load('local-store'),
    load('server'),
    convert ? load('convert') : Promise.resolve({}),
  ])
  return { ...backend, ...store, ...server, ...conversion } as unknown as GuestModules
}
