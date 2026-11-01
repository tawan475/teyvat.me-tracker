/**
 * The share card's art set by the player, per character and per browser:
 * their own character art and background (image files kept in IndexedDB
 * `gdt-card-art`, never sent anywhere), and where the art sits (moved and
 * sized from the game's place, for their art or the game's). The page card
 * (ShareCard) and the PNG (share-card-canvas) read the same `CardArt`; the
 * placement itself is card-art-place.ts.
 */

import { onBeforeUnmount, shallowRef, watch, type ShallowRef } from 'vue'
import { ART_FILE_MAX, NO_ART, clampPlace, type ArtPlace, type CardArt } from './card-art-place'

export * from './card-art-place'

// ------------------------------------------------------------------ storage

interface Stored extends ArtPlace {
  key: string
  splash?: Blob
  background?: Blob
}

const DB = 'gdt-card-art'
const STORE = 'art'
let opened: Promise<IDBDatabase> | null = null

function db(): Promise<IDBDatabase> {
  opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'key' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB'))
  })
  // Private windows or blocked storage: try again next time, the card stays the game's.
  opened.catch(() => (opened = null))
  return opened
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>) {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const request = work(d.transaction(STORE, mode).objectStore(STORE))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('IndexedDB'))
      }),
  )
}

const read = (key: string) => run<Stored | undefined>('readonly', (s) => s.get(key))
const write = (value: Stored) => run<IDBValidKey>('readwrite', (s) => s.put(value))
const remove = (key: string) => run<undefined>('readwrite', (s) => s.delete(key))

/** A file the player picked, if it is a picture this browser can draw (else why not). */
export async function checkPicture(file: File): Promise<'ok' | 'tooBig' | 'notImage'> {
  if (file.size > ART_FILE_MAX) return 'tooBig'
  if (!file.type.startsWith('image/')) return 'notImage'
  try {
    const bitmap = await createImageBitmap(file)
    bitmap.close()
    return 'ok'
  } catch {
    return 'notImage'
  }
}

// ------------------------------------------------------------------ the card's art

export interface CardArtControl {
  art: ShallowRef<CardArt>
  /** Whether anything differs from the game's card. */
  custom: () => boolean
  setPicture: (part: 'splash' | 'background', file: File | null) => Promise<void>
  move: (dx: number, dy: number) => void
  resize: (by: number) => void
  resetPlace: () => void
}

/** The art of the character `key()` names, kept in step with what is stored for it. */
export function useCardArt(key: () => string | null): CardArtControl {
  const art = shallowRef<CardArt>(NO_ART)
  let stored: Stored | null = null
  /** An object URL per picture shown, kept while the picture is (a move doesn't reload it). */
  let urls = new Map<Blob, string>()

  function show(next: Stored | null) {
    const kept = new Map<Blob, string>()
    for (const blob of [next?.splash, next?.background]) {
      const url = blob && urls.get(blob)
      if (blob && url) kept.set(blob, url)
    }
    for (const [blob, url] of urls) if (!kept.has(blob)) URL.revokeObjectURL(url)
    urls = kept
    stored = next
    const url = (blob?: Blob) => {
      if (!blob) return null
      let made = urls.get(blob)
      if (!made) urls.set(blob, (made = URL.createObjectURL(blob)))
      return made
    }
    art.value = next
      ? {
          splash: url(next.splash),
          background: url(next.background),
          x: next.x,
          y: next.y,
          scale: next.scale,
        }
      : NO_ART
  }

  let loading = 0
  watch(
    key,
    (k) => {
      const ticket = ++loading
      show(null)
      if (!k) return
      read(k)
        .then((found) => ticket === loading && show(found ?? null))
        .catch(() => undefined)
    },
    { immediate: true },
  )
  onBeforeUnmount(() => show(null))

  async function save(change: Partial<Stored>) {
    const k = key()
    if (!k) return
    const next: Stored = { key: k, x: 0, y: 0, scale: 1, ...stored, ...change }
    for (const part of ['splash', 'background'] as const) if (!next[part]) delete next[part]
    const empty = !next.splash && !next.background && !next.x && !next.y && next.scale === 1
    show(empty ? null : next)
    await (empty ? remove(k) : write(next)).catch(() => undefined)
  }

  /** Moves are saved a moment after the last arrow press (the card moves at once). */
  let pending: ReturnType<typeof setTimeout> | undefined
  function place(next: ArtPlace) {
    const clamped = clampPlace(next)
    art.value = { ...art.value, ...clamped }
    clearTimeout(pending)
    pending = setTimeout(() => void save(clamped), 300)
  }

  return {
    art,
    custom: () => art.value !== NO_ART,
    setPicture: (part, file) => save({ [part]: file ?? undefined }),
    move: (dx, dy) => place({ ...art.value, x: art.value.x + dx, y: art.value.y + dy }),
    resize: (by) => place({ ...art.value, scale: art.value.scale + by }),
    resetPlace: () => {
      clearTimeout(pending)
      void save({ x: 0, y: 0, scale: 1 })
    },
  }
}
