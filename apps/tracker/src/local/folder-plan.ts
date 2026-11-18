/**
 * Guest mode's watched folder (issue 12 item 8, design D): the decisions
 * that need no browser. Which files of a listing are new since the last
 * look, in what order they are read, what kind each is (a GOOD export or a
 * UIGF wish file, told from its first bytes), which account of a wish file
 * is the guest's, and what one look's batch adds up to. folder-watch.ts
 * runs them over the File System Access API and the guest store.
 */

/** One `.json` file of the folder, as its listing gives it. */
export interface FolderFile {
  name: string
  size: number
  lastModified: number
}

/** A file's fingerprint: the same name, size and time is the same file (not read again). */
export function fileKey(file: FolderFile): string {
  return `${file.size}:${file.lastModified}`
}

export function isJsonName(name: string): boolean {
  return /\.json$/i.test(name)
}

/** The `.json` files not looked at yet in this state (new, or rewritten since), oldest first. */
export function newFiles<T extends FolderFile>(
  listing: readonly T[],
  seen: Readonly<Record<string, string>>,
): T[] {
  return listing
    .filter((file) => isJsonName(file.name) && seen[file.name] !== fileKey(file))
    .sort((a, b) => a.lastModified - b.lastModified || nameOrder.compare(a.name, b.name))
}

const nameOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * Reading order: by the capture time a file carries (GOOD), else its
 * modified time; ties by name. The first pick reads every export oldest
 * first, so the store folds unchanged inventories as it does for a queue.
 */
export function readOrder<T extends FolderFile & { takenAt: number | null }>(files: T[]): T[] {
  return [...files].sort(
    (a, b) =>
      (a.takenAt ?? a.lastModified) - (b.takenAt ?? b.lastModified) ||
      nameOrder.compare(a.name, b.name),
  )
}

export type FileKind = 'good' | 'wishes' | 'other'

/**
 * What a file is, from its first bytes: GOOD names its format near the top
 * (every exporter writes `format` first or close to it), UIGF opens with
 * `info` and `hk4e` (v4) or `list` (v3). Anything else is left alone.
 */
export function kindOf(head: string): FileKind {
  if (/"format"\s*:\s*"GOOD"/.test(head)) return 'good'
  if (/"(hk4e|list)"\s*:/.test(head) && /"info"\s*:/.test(head)) return 'wishes'
  return 'other'
}

/** A file of the wish history kept is too young to be finished when it doesn't parse. */
export const SETTLE_MS = 10_000

/** The part of a wish file's account the folder reads. */
export interface WishAccount {
  uid: string | null
}

/**
 * The account of a wish file that is the guest's: the one of its UID, else,
 * while the guest has no UID yet, the file's only account. `null`: another
 * player's file (refused, as guest mode keeps one Genshin account).
 */
export function guestWishAccount<T extends WishAccount>(
  accounts: readonly T[],
  uid: string | null,
): T | null {
  if (uid) return accounts.find((account) => account.uid === uid) ?? null
  return accounts.length === 1 ? accounts[0]! : null
}

/** What one look read (or refused). */
export interface BatchResult {
  /** Snapshots stored (new). */
  created: number
  /** GOOD files the store already had (the same capture again). */
  unchanged: number
  /** Wish files read. */
  wishes: number
  /** Files of another UID (`uid`) than the guest's (`own`), refused. */
  refused: { name: string; uid: string; own: string }[]
  /** The newest file read, if any. */
  newest: FolderFile | null
}

export function emptyBatch(): BatchResult {
  return { created: 0, unchanged: 0, wishes: 0, refused: [], newest: null }
}

/** Files the batch read (not counting refused or skipped ones). */
export function readCount(batch: BatchResult): number {
  return batch.created + batch.unchanged + batch.wishes
}

/** The newer of two files (by modified time). */
export function newer(a: FolderFile | null, b: FolderFile): FolderFile {
  return !a || b.lastModified >= a.lastModified ? b : a
}

/**
 * Which toasts a finished look shows: the success one (unless muted, or
 * nothing was read) and the refusal one (never muted), one each per batch.
 */
export function batchToasts(
  batch: BatchResult,
  muted: boolean,
): { read: boolean; refused: boolean } {
  return { read: !muted && readCount(batch) > 0, refused: batch.refused.length > 0 }
}
