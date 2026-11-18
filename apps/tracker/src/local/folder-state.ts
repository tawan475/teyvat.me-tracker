/**
 * Guest mode's watched folder, as pages see it (folder-watch.ts reads the
 * folder and keeps this current). Kept apart from the reader, which pulls in
 * the local import: a page imports this to know whether a folder is set and
 * which snapshots came from it, without that code.
 */

import { reactive, ref } from 'vue'
import { readStorage, writeStorage } from '@/lib/storage'

/** Whether this browser has the folder picker (a feature check, never the browser's name). */
export function folderSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

/** A file of another UID, refused (guest mode keeps one Genshin account). */
export interface RefusedFile {
  name: string
  uid: string
  own: string
}

export type FolderStatus =
  | 'none'
  | 'unsupported'
  | 'reading'
  | 'watching'
  | 'paused'
  | 'missing'
  | 'stopped'

export interface FolderView {
  status: FolderStatus
  /** The folder's name (never its path: the page has none). */
  name: string | null
  last: { name: string; at: number } | null
  /** While reading: files done of the batch. */
  progress: { done: number; total: number } | null
  /** The read in progress is the first one (the Overview shows it in place of its empty state). */
  first: boolean
  refused: RefusedFile[]
  rows: Readonly<Record<number, string>>
}

export const folder = reactive<FolderView>({
  status: folderSupported() ? 'none' : 'unsupported',
  name: null,
  last: null,
  progress: null,
  first: false,
  refused: [],
  rows: {},
})

/** Whether a folder is set (the Snapshots strip shows; no picker and never set: no strip). */
export function folderSet(view: FolderView = folder): boolean {
  return view.status !== 'none' && view.status !== 'unsupported'
}

const TOASTS_KEY = 'guest:folder-toasts'

/** Settings › Sync: a toast when files are read (per browser; problems always show). */
export const folderToasts = ref(readStorage(TOASTS_KEY) !== 'off')

export function setFolderToasts(on: boolean): void {
  folderToasts.value = on
  writeStorage(TOASTS_KEY, on ? null : 'off')
}
