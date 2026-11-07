/**
 * The guest's wish history: worker/services/wishes.ts over the guest store.
 * The same chunks (encodeWishChunk, 512 pulls per banner chunk), merged the
 * same way (mergePulls), so the Wish history pages decode them as they do an
 * account's, and conversion can send them on as records.
 */

import {
  WishRecordError,
  chunkPulls,
  decodeWishChunk,
  encodeWishChunk,
  mergePulls,
  newestRealId,
  normalizeWishRecords,
  serverFromUid,
  serverTimezone,
  toBase64,
  UIGF_GACHA_TYPES,
  type UigfGachaType,
  type WishHistoryResponse,
  type WishImportResponse,
  type WishNewest,
  type WishPull,
  type WishRecord,
} from '@gdt/shared'
import { GUEST_ACCOUNT_ID } from './guest-id'
import { LocalApiError } from './errors'
import type { LocalStore } from './local-store'

/** The state key the history is kept under. */
export const WISHES_KEY = 'wishes'

export interface StoredWishes {
  timezone: number
  version: number
  updatedAt: number
  /** Per banner, its chunks in order. */
  chunks: { banner: UigfGachaType; data: Uint8Array }[]
}

function stored(store: LocalStore): StoredWishes | null {
  return (store.state.get(WISHES_KEY) as StoredWishes | undefined) ?? null
}

/** Every banner's pulls, oldest first. */
export function storedPulls(store: LocalStore): Map<UigfGachaType, WishPull[]> {
  const out = new Map<UigfGachaType, WishPull[]>()
  for (const chunk of stored(store)?.chunks ?? []) {
    const list = out.get(chunk.banner) ?? []
    list.push(...decodeWishChunk(chunk.banner, chunk.data))
    out.set(chunk.banner, list)
  }
  return out
}

export function wishHistory(store: LocalStore): WishHistoryResponse {
  const history = stored(store)
  let bytes = 0
  const chunks = (history?.chunks ?? []).map((c) => {
    bytes += c.data.length
    return { banner: c.banner, data: toBase64(c.data) }
  })
  return {
    timezone: history?.timezone ?? null,
    version: history?.version ?? 0,
    chunks,
    bytes,
    updatedAt: history?.updatedAt ?? null,
  }
}

function newestOf(pulls: ReadonlyMap<UigfGachaType, readonly WishPull[]>): WishNewest {
  const newest: WishNewest = { '100': null, '200': null, '301': null, '302': null, '500': null }
  for (const [banner, list] of pulls) {
    const id = newestRealId(list)
    if (id !== null) newest[String(banner) as keyof WishNewest] = id.toString()
  }
  return newest
}

export interface LocalWishImport {
  uid?: string
  timezone?: number
  records: readonly WishRecord[]
}

export function importWishesLocal(
  store: LocalStore,
  input: LocalWishImport,
): Promise<WishImportResponse> {
  return store.transact((tx) => {
    const account = tx.account()
    const history = stored(store)
    const uid = input.uid ?? account.uid ?? ''
    const timezone =
      history?.timezone ?? input.timezone ?? serverTimezone(account.server ?? serverFromUid(uid))
    let normalized
    try {
      normalized = normalizeWishRecords(input.records, {
        uid: input.uid,
        timezone: input.timezone ?? timezone,
        target: timezone,
      })
    } catch (error) {
      if (error instanceof WishRecordError) {
        throw new LocalApiError(400, 'invalid_records', error.message)
      }
      throw error
    }
    const held = storedPulls(store)
    let added = 0
    let known = 0
    let replaced = 0
    let changed = false
    for (const [banner, incoming] of normalized.banners) {
      const merged = mergePulls(banner, held.get(banner) ?? [], incoming)
      added += merged.added
      known += merged.known
      replaced += merged.replaced
      if (merged.added === 0 && merged.replaced === 0) continue
      held.set(banner, merged.pulls)
      changed = true
    }
    if (changed) {
      const chunks: StoredWishes['chunks'] = []
      for (const banner of UIGF_GACHA_TYPES) {
        for (const pulls of chunkPulls(held.get(banner) ?? [])) {
          chunks.push({ banner, data: encodeWishChunk(banner, pulls) })
        }
      }
      tx.setState(WISHES_KEY, {
        timezone,
        version: (history?.version ?? 0) + 1,
        updatedAt: Date.now(),
        chunks,
      } satisfies StoredWishes)
    }
    return {
      accountId: GUEST_ACCOUNT_ID,
      added,
      known,
      ...(normalized.skipped > 0 ? { skipped: normalized.skipped } : {}),
      ...(replaced > 0 ? { replaced } : {}),
      newest: newestOf(held),
    }
  })
}

export function deleteWishesLocal(store: LocalStore): Promise<{ deleted: number }> {
  return store.transact((tx) => {
    const count = stored(store)?.chunks.length ?? 0
    tx.setState(WISHES_KEY, null)
    return { deleted: count }
  })
}
