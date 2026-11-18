/**
 * Guest mode's watched folder (issue 12 item 8, design D): Teyvat.me
 * Capture's local exports read by themselves, with no server at all.
 *
 * The folder is picked with the File System Access API (Chrome, Edge; the
 * offer is hidden where `showDirectoryPicker` is missing) and its handle is
 * kept in the guest's IndexedDB (`gdt-guest`, table `meta`, key `folder`),
 * beside but not inside the guest's data (so a folder alone is not "data to
 * keep" and conversion never sees it). The first pick reads every GOOD
 * export and UIGF wish file already there, oldest first; later looks (page
 * focus, and every 60 s while the page is visible) read the files that are
 * new or rewritten since, through the same local import as a file picked by
 * hand (local-import.ts, local-wishes.ts). Files of another UID are refused
 * (guest mode keeps one Genshin account; a hand import keeps its warning).
 *
 * After a reload the browser forgets the permission ("prompt"): the folder
 * is paused and one toast per visit asks Allow again (the only place that
 * asks; Not now = asked again next visit). One success toast per batch,
 * muted by a per-browser switch in Settings › Sync; refusals, a missing
 * folder and the paused toast always show. Stop keeps the folder.
 */

import { parseWishFile } from '@gdt/shared'
import { readCaptureTime } from '@/data/import-files'
import { t } from '@/i18n'
import { formatDateTime, formatNumber } from '@/lib/format'
import { importingAccounts } from '@/live/holds'
import { appRouter } from '@/router/instance'
import { useFeedback } from '@/stores/feedback'
import { useSession } from '@/stores/session'
import { OtherUidError } from './errors'
import {
  folder,
  folderSupported,
  folderToasts,
  type FolderStatus,
  type RefusedFile,
} from './folder-state'
import { loadGuestAccount } from './guest-account'
import { GUEST_ACCOUNT_ID } from './guest-id'
import {
  SETTLE_MS,
  batchToasts,
  emptyBatch,
  fileKey,
  guestWishAccount,
  isJsonName,
  kindOf,
  newFiles,
  newer,
  readCount,
  readOrder,
  type BatchResult,
  type FileKind,
  type FolderFile,
} from './folder-plan'
import { importLocal } from './local-import'
import { guestStore } from './local-store'
import { importWishesLocal } from './local-wishes'

// ------------------------------------------------- File System Access (Chromium)

type Permission = 'granted' | 'denied' | 'prompt'

/** The parts of FileSystemDirectoryHandle used here (the permission calls aren't in TS's DOM lib). */
interface DirectoryHandle {
  readonly kind: 'directory'
  readonly name: string
  values(): AsyncIterable<FileHandle | DirectoryHandle>
  queryPermission(options: { mode: 'read' }): Promise<Permission>
  requestPermission(options: { mode: 'read' }): Promise<Permission>
}
interface FileHandle {
  readonly kind: 'file'
  readonly name: string
  getFile(): Promise<File>
}
type PickerWindow = Window & {
  showDirectoryPicker(options?: { id?: string; mode?: 'read' }): Promise<DirectoryHandle>
}

// ----------------------------------------------------------------- the record

/** What is kept for the folder (IndexedDB `gdt-guest`, `meta` / `folder`). */
interface FolderRecord {
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

async function loadRecord(): Promise<FolderRecord | null> {
  try {
    const value = (await guestStore().backend.get('meta', RECORD_KEY)) as FolderRecord | undefined
    return value?.v === 1 ? value : null
  } catch {
    return null
  }
}

async function saveRecord(record: FolderRecord | null): Promise<void> {
  await guestStore().backend.write([{ table: 'meta', key: RECORD_KEY, value: record }])
}

function show(record: FolderRecord | null, status?: FolderStatus): void {
  folder.name = record?.name ?? null
  folder.last = record?.last ?? null
  folder.refused = record?.refused ?? []
  folder.rows = record?.rows ?? {}
  if (status) folder.status = status
  else if (!record) folder.status = folderSupported() ? 'none' : 'unsupported'
  if (folder.status !== 'reading') {
    folder.progress = null
    folder.first = false
  }
}

// ------------------------------------------------------------------ toasts

/** Once per visit (page load): the paused and the not-found toasts. */
let pausedShown = false
let missingShown = false
let pausedToast: number | null = null

function snapshotsLink() {
  return {
    label: t('guest.folder.snapshots'),
    run: () => void appRouter()?.push({ name: 'guest-snapshots' }),
  }
}

function signedOut(): boolean {
  return useSession().status !== 'signed-in'
}

function pausedToastNow(force = false): void {
  const feedback = useFeedback()
  // Still up (✕ = Not now dismisses it: then only Watch again shows it again this visit).
  if (pausedToast !== null && feedback.toasts.some((toast) => toast.id === pausedToast)) return
  if (pausedShown && !force) return
  pausedShown = true
  pausedToast = feedback.toast(
    {
      tone: 'pause',
      title: t('guest.folder.toast.paused'),
      detail: folder.name ?? undefined,
      lines: [{ text: t('guest.folder.pausedInfo') }],
      action: { label: t('guest.folder.allow'), run: () => void allowAgain() },
      closeLabel: t('guest.folder.notNow'),
    },
    0,
  )
}

function dropPausedToast(): void {
  if (pausedToast !== null) useFeedback().dismiss(pausedToast)
  pausedToast = null
}

function missingToastNow(): void {
  if (missingShown) return
  missingShown = true
  useFeedback().toast({
    tone: 'danger',
    title: t('guest.folder.missing'),
    detail: folder.name ?? undefined,
    lines: [{ text: t('guest.folder.missingInfo') }],
    action: { label: t('guest.folder.choose'), run: () => void pickFolder() },
  })
}

function batchToastsNow(batch: BatchResult, first: boolean): void {
  const feedback = useFeedback()
  const shown = batchToasts(batch, !folderToasts.value)
  if (shown.read) {
    const n = readCount(batch)
    const parts: string[] = []
    if (batch.created > 0) {
      parts.push(
        t('guest.folder.toast.snapshots', { n: formatNumber(batch.created) }, batch.created),
      )
    }
    if (batch.unchanged > 0) {
      parts.push(t('guest.folder.toast.unchanged', { n: formatNumber(batch.unchanged) }))
    }
    if (batch.wishes > 0) {
      parts.push(t('guest.folder.toast.wishes', { n: formatNumber(batch.wishes) }, batch.wishes))
    }
    const newest = batch.newest
    feedback.toast({
      tone: 'success',
      title: t(
        first ? 'guest.folder.toast.read' : 'guest.folder.toast.newRead',
        { n: formatNumber(n) },
        n,
      ),
      detail: parts.join(' · ') || undefined,
      ...(newest
        ? {
            hint: t('guest.folder.toast.newest', {
              file: newest.name,
              time: formatDateTime(newest.lastModified),
            }),
            lines: [
              { text: newest.name, code: true },
              { text: formatDateTime(newest.lastModified) },
            ],
          }
        : {}),
      action: snapshotsLink(),
    })
  }
  if (shown.refused) {
    const one = batch.refused[0]!
    const info = t('guest.folder.refusedInfo', { uid: one.uid, own: one.own })
    feedback.toast({
      tone: 'danger',
      title: t('guest.folder.toast.refused'),
      detail: t('guest.lock.accounts'),
      hint: `${one.name}: ${info}`,
      lines: [{ text: one.name, code: true }, { text: info }],
      ...(signedOut()
        ? {
            action: {
              label: t('guest.createAccount'),
              run: () => void appRouter()?.push({ name: 'register' }),
            },
          }
        : {}),
    })
  }
}

// ------------------------------------------------------------------ reading

/** A file of the listing, with how to read it again. */
interface Listed extends FolderFile {
  file: File
}

class FolderGone extends Error {}

/** The `.json` files at the folder's top level (Capture writes there). */
async function list(handle: DirectoryHandle): Promise<Listed[]> {
  const out: Listed[] = []
  try {
    for await (const entry of handle.values()) {
      if (entry.kind !== 'file' || !isJsonName(entry.name)) continue
      try {
        const file = await entry.getFile()
        out.push({ name: file.name, size: file.size, lastModified: file.lastModified, file })
      } catch {
        // Removed between the listing and the read: the next look won't list it.
      }
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') throw new FolderGone()
    throw error
  }
  return out
}

/** Reads one file into the guest store; what it was. */
async function readOne(
  item: Listed & { kind: FileKind; takenAt: number | null; fromName: boolean },
  batch: BatchResult,
  rows: Record<number, string>,
): Promise<void> {
  const store = await guestStore().ready()
  if (item.kind === 'good') {
    const text = await item.file.text()
    try {
      const answer = await importLocal(store, {
        text,
        rawSize: item.size,
        timestamp: item.fromName ? (item.takenAt ?? undefined) : undefined,
        folder: true,
      })
      if (answer.status === 'created') {
        batch.created++
        rows[answer.snapshotId] = item.name
      } else batch.unchanged++
    } catch (error) {
      if (error instanceof OtherUidError) {
        batch.refused.push({ name: item.name, uid: error.uid, own: error.own })
        return
      }
      throw error
    }
  } else if (item.kind === 'wishes') {
    const parsed = parseWishFile(await item.file.text())
    if (parsed.format !== 'uigf') return
    const own = store.account?.uid ?? null
    const account = guestWishAccount(parsed.accounts, own)
    if (!account) {
      batch.refused.push({ name: item.name, uid: parsed.accounts[0]?.uid ?? '?', own: own ?? '?' })
      return
    }
    await importWishesLocal(store, {
      ...(account.uid ? { uid: account.uid } : {}),
      ...(account.timezone !== null ? { timezone: account.timezone } : {}),
      records: account.records,
    })
    batch.wishes++
  }
}

/** Whether a failed read is worth another try (a file still being written). */
function unsettled(item: FolderFile, error: unknown): boolean {
  if (Date.now() - item.lastModified > SETTLE_MS) return false
  return error instanceof SyntaxError || (error as { code?: string })?.code === 'invalid_json'
}

let stopRequested = false
let looking: Promise<void> | null = null

/** One look at the folder: reads what is new, oldest first, one toast for the batch. */
function look(): Promise<void> {
  looking ??= withLock(lookNow).finally(() => (looking = null))
  return looking
}

/** One tab reads at a time (the others find nothing new afterwards). */
async function withLock(run: () => Promise<void>): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.locks) return run()
  await navigator.locks.request('gdt-guest-folder', { ifAvailable: true }, async (lock) => {
    if (lock) await run()
  })
}

async function lookNow(): Promise<void> {
  const record = await loadRecord()
  if (!record || record.stopped) {
    show(record, record ? 'stopped' : undefined)
    return
  }
  let permission: Permission
  try {
    permission = await record.handle.queryPermission({ mode: 'read' })
  } catch {
    permission = 'prompt'
  }
  if (permission !== 'granted') {
    show(record, 'paused')
    pausedToastNow()
    return
  }
  dropPausedToast()

  let listing: Listed[]
  try {
    listing = await list(record.handle)
  } catch (error) {
    if (error instanceof FolderGone) {
      show(record, 'missing')
      missingToastNow()
      return
    }
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      show(record, 'paused')
      pausedToastNow()
      return
    }
    throw error
  }
  missingShown = false
  const fresh = newFiles(listing, record.seen)
  if (fresh.length === 0) {
    if (!record.firstDone) await saveRecord({ ...record, firstDone: true })
    show(record, 'watching')
    return
  }

  const first = !record.firstDone
  stopRequested = false
  show(record, 'reading')
  folder.first = first
  folder.progress = { done: 0, total: fresh.length }

  // What each file is and the time it carries (its first and last bytes only).
  const items: (Listed & { kind: FileKind; takenAt: number | null; fromName: boolean })[] = []
  for (const item of fresh) {
    const kind = kindOf(
      await item.file
        .slice(0, 2048)
        .text()
        .catch(() => ''),
    )
    let takenAt: number | null = null
    let fromName = false
    if (kind === 'good') {
      const time = await readCaptureTime(item.file).catch(() => null)
      takenAt = time?.takenAt ?? null
      fromName = time?.fromName === true
    }
    items.push({ ...item, kind, takenAt, fromName })
  }

  const batch = emptyBatch()
  const seen = { ...record.seen }
  const rows = { ...record.rows }
  importingAccounts.add(GUEST_ACCOUNT_ID)
  try {
    for (const item of readOrder(items)) {
      if (stopRequested) break
      try {
        await readOne(item, batch, rows)
        seen[item.name] = fileKey(item)
        if (item.kind !== 'other') batch.newest = newer(batch.newest, item)
      } catch (error) {
        // Not a capture this build can read (or one still being written: tried again next look).
        if (!unsettled(item, error)) seen[item.name] = fileKey(item)
        console.warn('watched folder', item.name, error)
      }
      folder.progress = { done: (folder.progress?.done ?? 0) + 1, total: fresh.length }
    }
  } finally {
    importingAccounts.delete(GUEST_ACCOUNT_ID)
  }

  // Stop or Change meanwhile wrote the record: keep theirs, add what was read.
  const now = (await loadRecord()) ?? record
  const sameFolder = now.pickedAt === record.pickedAt
  const refused = [...now.refused]
  for (const file of batch.refused) {
    if (!refused.some((r) => r.name === file.name)) refused.push(file)
  }
  const saved: FolderRecord = sameFolder
    ? {
        ...now,
        firstDone: now.firstDone || !stopRequested,
        seen: { ...now.seen, ...seen },
        last: batch.newest ? { name: batch.newest.name, at: batch.newest.lastModified } : now.last,
        refused,
        rows: { ...now.rows, ...rows },
      }
    : { ...now, rows: { ...now.rows, ...rows } }
  await saveRecord(saved)
  show(saved, saved.stopped ? 'stopped' : sameFolder ? 'watching' : undefined)
  if (readCount(batch) > 0 || batch.refused.length > 0) {
    await loadGuestAccount().catch(() => undefined)
  }
  batchToastsNow(batch, first)
}

// ------------------------------------------------------------------ actions

/** Watch a folder / Change / Choose folder: the browser's folder picker, then the first read. */
export async function pickFolder(): Promise<void> {
  if (!folderSupported()) return
  let handle: DirectoryHandle
  try {
    handle = await (window as unknown as PickerWindow).showDirectoryPicker({
      id: 'teyvatme-captures',
      mode: 'read',
    })
  } catch {
    // Cancelled (or refused by the browser): nothing changes.
    return
  }
  const before = await loadRecord()
  stopRequested = true
  const record: FolderRecord = {
    v: 1,
    handle,
    name: handle.name,
    pickedAt: Date.now(),
    stopped: false,
    firstDone: false,
    seen: {},
    last: null,
    refused: [],
    rows: before?.rows ?? {},
  }
  await saveRecord(record)
  dropPausedToast()
  missingShown = false
  show(record, 'watching')
  await looking?.catch(() => undefined)
  await look()
}

/** Stop: no confirm (nothing stored goes), an Undo toast; the folder is kept. */
export async function stopWatching(): Promise<void> {
  const record = await loadRecord()
  if (!record) return
  stopRequested = true
  const stopped = { ...record, stopped: true }
  await saveRecord(stopped)
  dropPausedToast()
  show(stopped, 'stopped')
  useFeedback().toast({
    tone: 'info',
    title: t('guest.folder.toast.stopped'),
    detail: t('guest.folder.toast.stoppedDetail'),
    action: { label: t('guest.folder.toast.undo'), run: () => void watchAgain() },
  })
}

/** Watch again (or Undo): the kept folder; a lost permission asks on the paused toast. */
export async function watchAgain(): Promise<void> {
  const record = await loadRecord()
  if (!record) return
  const watching = { ...record, stopped: false }
  await saveRecord(watching)
  show(watching, 'watching')
  let permission: Permission = 'prompt'
  try {
    permission = await record.handle.queryPermission({ mode: 'read' })
  } catch {
    // Treated as not granted.
  }
  if (permission !== 'granted') {
    show(watching, 'paused')
    pausedToastNow(true)
    return
  }
  await look()
}

/** Allow again (the paused toast's button, the only place that asks). */
async function allowAgain(): Promise<void> {
  pausedToast = null
  const record = await loadRecord()
  if (!record) return
  let permission: Permission = 'denied'
  try {
    permission = await record.handle.requestPermission({ mode: 'read' })
  } catch {
    // Treated as refused: still paused, asked again next visit.
  }
  if (permission === 'granted') await look()
}

/** The strip's Dismiss: forget the refused files (they stay unread). */
export async function dismissRefused(): Promise<void> {
  const record = await loadRecord()
  if (!record) return
  const next = { ...record, refused: [] }
  await saveRecord(next)
  folder.refused = []
}

// ------------------------------------------------------------------ watching

let started = false

/** Starts watching for this tab (GuestLayout); later calls re-read the record. */
export async function startFolderWatch(): Promise<void> {
  if (!started) {
    started = true
    window.addEventListener('focus', () => void tick())
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void tick()
    })
    setInterval(() => {
      if (document.visibilityState === 'visible') void tick()
    }, 60_000)
  }
  await tick()
}

/** A look, when there is a folder to look at (not while stopped or waiting on Allow again). */
async function tick(): Promise<void> {
  try {
    const record = await loadRecord()
    if (!record) {
      show(null)
      return
    }
    if (record.stopped) {
      show(record, 'stopped')
      return
    }
    await look()
  } catch (error) {
    console.warn('watched folder', error)
  }
}

/** The guest data was deleted (the record with it): back to no folder. */
export function forgetFolder(): void {
  stopRequested = true
  dropPausedToast()
  show(null)
}
