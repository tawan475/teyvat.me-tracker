/**
 * A whole history is read as packs of PACK_SIZE snapshots, oldest first,
 * each kept on the device under a key made of what decides its content (its
 * snapshots' ids and last-seen times), not under the account's data
 * version: a new capture changes only the last pack, so only that one is
 * downloaded again (docs/plans/storage-efficiency.md, phase 3). A pack is
 * self-contained (the server sends every blob its snapshots need), so packs
 * decode on their own and their texts merge. Pure.
 */

import type { BundleSnapshot } from '@gdt/shared'

export const PACK_SIZE = 64

export interface PackSnapshot {
  id: number
  takenAt: number
  lastSeenAt: number
}

export interface BundlePack {
  /** Snapshot ids, oldest first. */
  ids: number[]
  /** Changes whenever the pack's content could: its ids or a last-seen time. */
  key: string
}

/** FNV-1a over a string, two 32-bit lanes: a short, stable key (not a security hash). */
function fnv(text: string): string {
  let a = 0x811c9dc5
  let b = 0x01000193 ^ text.length
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193) >>> 0
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0
  }
  return a.toString(36) + b.toString(36)
}

/** The history (any order) in packs, oldest first, as the bundle orders it (taken time, then id). */
export function bundlePacks(list: readonly PackSnapshot[], size = PACK_SIZE): BundlePack[] {
  const ordered = [...list].sort((a, b) => a.takenAt - b.takenAt || a.id - b.id)
  const packs: BundlePack[] = []
  for (let i = 0; i < ordered.length; i += size) {
    const part = ordered.slice(i, i + size)
    packs.push({
      ids: part.map((s) => s.id),
      key: `${part.length}-${fnv(part.map((s) => `${s.id}.${s.lastSeenAt}`).join(','))}`,
    })
  }
  return packs
}

/**
 * The pack keys' removal epoch: none before any part was removed from the
 * history (the keys as they were), else `r<time>:`. A removal rewrites
 * snapshots in place (same ids and last-seen times), so a pack kept from
 * before it holds the removed part: another epoch's packs are never read.
 */
export function packEpoch(partsRemovedAt: number | undefined): string {
  return partsRemovedAt ? `r${partsRemovedAt}:` : ''
}

/** The removal epoch a kept pack's key (`pack:<account>:<epoch>…`) names. */
export function packEpochOf(key: string, accountId: number): string {
  const rest = key.slice(`pack:${accountId}:`.length)
  return /^r\d+:/.exec(rest)?.[0] ?? ''
}

/** Decoded packs as one bundle: snapshots in pack order, texts merged. */
export function mergeDecoded(
  packs: readonly { snapshots: BundleSnapshot[]; texts: Map<string, string> }[],
): { snapshots: BundleSnapshot[]; texts: Map<string, string> } {
  if (packs.length === 1) return packs[0]!
  const snapshots: BundleSnapshot[] = []
  const texts = new Map<string, string>()
  for (const pack of packs) {
    snapshots.push(...pack.snapshots)
    for (const [key, value] of pack.texts) texts.set(key, value)
  }
  return { snapshots, texts }
}
