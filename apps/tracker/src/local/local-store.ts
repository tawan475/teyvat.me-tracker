/**
 * The guest account's storage (docs/plans/open-site.md §4): the rows the
 * Worker keeps in D1 for an account, kept in this browser instead. Stored
 * the same way (storage format v2: section blobs by id, a snapshot row naming
 * its blobs, a binary meta; the artifact catalog by id), so the same codec
 * reads and writes them and a guest's history costs what an account's does.
 *
 * Everything is read into memory once (a guest's whole history is a few
 * hundred KB) and written through to the backend (IndexedDB). A write runs
 * under a Web Lock across tabs and first re-reads the store if another tab
 * wrote since (the `rev` counter), then tells the other tabs
 * (BroadcastChannel `gdt-guest`), which re-read it before their next read.
 */

import type { ArtifactIdentity, GenshinServer } from '@gdt/shared'
import { writeStorage } from '@/lib/storage'
import {
  indexedDbBackend,
  memoryBackend,
  type Key,
  type LocalBackend,
  type WriteOp,
} from './backend'

/**
 * localStorage hint (`gdt:guest-data`) that this browser holds guest data:
 * the landing, sign-in and Home read it without opening IndexedDB.
 */
export const GUEST_DATA_FLAG = 'guest-data'

/** The account's own row (genshin_accounts). */
export interface GuestAccountRow {
  name: string | null
  uid: string | null
  server: GenshinServer | null
  createdAt: number
  /** Moves on every change of its snapshots (what the pages' caches key on). */
  dataVersion: number
  nextBlobId: number
  nextSnapshotId: number
  nextArtifactId: number
}

/** A section blob (section_blobs). */
export interface BlobRow {
  id: number
  code: number
  /** 16 hex digits. */
  hash: string
  baseId: number | null
  data: Uint8Array
}

/** A snapshot row (snapshots, v2 columns only). */
export interface SnapshotRow {
  id: number
  takenAt: number
  lastSeenAt: number
  createdAt: number
  rawSize: number
  storedSize: number
  contentKey: number
  /** Blob id per slot, in SLOTS order. */
  refs: (number | null)[]
  /** encodeSnapshotMeta's bytes. */
  meta: Uint8Array
}

/** A catalog entry: its id, packed key (artifactKeyString) and identity. */
export interface ArtifactRow {
  id: number
  key: string
  identity: ArtifactIdentity
}

const CHANNEL = 'gdt-guest'
const LOCK = 'gdt-guest-write'

export class LocalStore {
  account: GuestAccountRow | null = null
  readonly blobs = new Map<number, BlobRow>()
  readonly snapshots = new Map<number, SnapshotRow>()
  readonly artifacts = new Map<number, ArtifactRow>()
  /** Catalog id by packed key. */
  readonly artifactIds = new Map<string, number>()
  readonly state = new Map<string, unknown>()
  private rev = 0
  private loading: Promise<void> | null = null
  private stale = true
  private channel: BroadcastChannel | null = null
  private chain: Promise<unknown> = Promise.resolve()
  private readonly listeners = new Set<() => void>()

  constructor(readonly backend: LocalBackend) {
    try {
      this.channel = new BroadcastChannel(CHANNEL)
      this.channel.onmessage = () => {
        this.stale = true
        for (const listener of this.listeners) listener()
      }
    } catch {
      // No BroadcastChannel (tests): one tab.
    }
  }

  /** Another tab changed the store. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** The store, read in (again, when another tab wrote since). */
  async ready(): Promise<this> {
    if (this.stale) {
      this.loading ??= this.load().finally(() => (this.loading = null))
      await this.loading
    }
    return this
  }

  private async load(): Promise<void> {
    const [meta, blobs, snapshots, artifacts, state] = await Promise.all([
      this.backend.entries('meta'),
      this.backend.entries('blobs'),
      this.backend.entries('snapshots'),
      this.backend.entries('artifacts'),
      this.backend.entries('state'),
    ])
    const metaMap = new Map(meta)
    this.account = (metaMap.get('account') as GuestAccountRow | undefined) ?? null
    this.rev = (metaMap.get('rev') as number | undefined) ?? 0
    this.blobs.clear()
    for (const [, row] of blobs) this.blobs.set((row as BlobRow).id, row as BlobRow)
    this.snapshots.clear()
    for (const [, row] of snapshots) this.snapshots.set((row as SnapshotRow).id, row as SnapshotRow)
    this.artifacts.clear()
    this.artifactIds.clear()
    for (const [, value] of artifacts) {
      const row = value as ArtifactRow
      this.artifacts.set(row.id, row)
      this.artifactIds.set(row.key, row.id)
    }
    this.state.clear()
    for (const [key, value] of state) this.state.set(String(key), value)
    this.stale = false
  }

  /**
   * Runs `change` with the store current and writes what it recorded, all or
   * nothing: one at a time across tabs. A write that fails leaves the store
   * as the backend has it.
   */
  transact<T>(change: (tx: Transaction) => T | Promise<T>): Promise<T> {
    const run = async () => {
      const rev = ((await this.backend.get('meta', 'rev')) as number | undefined) ?? 0
      if (this.stale || rev !== this.rev) await this.load()
      const tx = new Transaction(this)
      let result: T
      try {
        result = await change(tx)
        if (tx.ops.length > 0) {
          tx.ops.push({ table: 'meta', key: 'rev', value: this.rev + 1 })
          await this.backend.write(tx.ops)
          this.rev += 1
          writeStorage(GUEST_DATA_FLAG, '1')
          this.channel?.postMessage('changed')
        }
      } catch (error) {
        // The mirror may hold half a change: read it back as stored.
        if (tx.ops.length > 0) this.stale = true
        throw error
      }
      return result
    }
    const locked = () =>
      typeof navigator !== 'undefined' && navigator.locks
        ? navigator.locks.request(LOCK, run)
        : run()
    // One at a time in this tab too (the lock is per tab for re-entry).
    const next = this.chain.then(locked, locked) as Promise<T>
    this.chain = next.catch(() => undefined)
    return next
  }

  /** Deletes the guest data (the store is empty after). */
  async clear(): Promise<void> {
    await this.transact(async () => {
      await this.backend.clear()
    })
    this.account = null
    this.blobs.clear()
    this.snapshots.clear()
    this.artifacts.clear()
    this.artifactIds.clear()
    this.state.clear()
    this.rev = 0
    writeStorage(GUEST_DATA_FLAG, null)
    this.channel?.postMessage('changed')
  }

  /** Whether there is anything to keep: a snapshot, wishes, a mark, a goal or a setting. */
  hasData(): boolean {
    return this.snapshots.size > 0 || this.state.size > 0
  }

  /** Snapshots newest first (taken, then id), as the server orders them. */
  newestFirst(): SnapshotRow[] {
    return [...this.snapshots.values()].sort((a, b) => b.takenAt - a.takenAt || b.id - a.id)
  }

  latest(): SnapshotRow | null {
    return this.newestFirst()[0] ?? null
  }
}

/** Changes recorded against the mirror, written when the change ends. */
export class Transaction {
  readonly ops: WriteOp[] = []

  constructor(readonly store: LocalStore) {}

  private op(table: WriteOp['table'], key: Key, value: unknown) {
    this.ops.push({ table, key, value })
  }

  /** The account row, made on first use. */
  account(): GuestAccountRow {
    if (!this.store.account) {
      this.store.account = {
        name: null,
        uid: null,
        server: null,
        createdAt: Date.now(),
        dataVersion: 1,
        nextBlobId: 1,
        nextSnapshotId: 1,
        nextArtifactId: 1,
      }
      this.saveAccount()
    }
    return this.store.account
  }

  saveAccount(): void {
    this.op('meta', 'account', this.store.account)
  }

  /** Moves the data version: every page re-reads the snapshots. */
  bumpVersion(): void {
    this.account().dataVersion += 1
    this.saveAccount()
  }

  putBlob(row: BlobRow): void {
    this.store.blobs.set(row.id, row)
    this.op('blobs', row.id, row)
  }

  deleteBlob(id: number): void {
    this.store.blobs.delete(id)
    this.op('blobs', id, null)
  }

  putSnapshot(row: SnapshotRow): void {
    this.store.snapshots.set(row.id, row)
    this.op('snapshots', row.id, row)
  }

  deleteSnapshot(id: number): void {
    this.store.snapshots.delete(id)
    this.op('snapshots', id, null)
  }

  putArtifact(row: ArtifactRow): void {
    this.store.artifacts.set(row.id, row)
    this.store.artifactIds.set(row.key, row.id)
    this.op('artifacts', row.id, row)
  }

  setState(key: string, value: unknown): void {
    if (value === null || value === undefined) this.store.state.delete(key)
    else this.store.state.set(key, value)
    this.op('state', key, value ?? null)
  }
}

let shared: LocalStore | null = null

/** This browser's guest store (IndexedDB; in memory where it is missing). */
export function guestStore(): LocalStore {
  if (!shared) {
    let backend: LocalBackend
    try {
      backend = typeof indexedDB !== 'undefined' ? indexedDbBackend() : memoryBackend()
    } catch {
      backend = memoryBackend()
    }
    shared = new LocalStore(backend)
  }
  return shared
}

/** Tests: a store of their own. */
export function setGuestStore(store: LocalStore | null): void {
  shared = store
}
