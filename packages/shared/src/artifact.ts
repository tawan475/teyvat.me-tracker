import type { GoodSubstat } from './good'
import { sha256Hex128 } from './hash'

export const MAX_SUBSTATS: Readonly<Record<string, number>> = {
  hp: 298.75,
  hp_: 5.83,
  atk: 19.45,
  atk_: 5.83,
  def: 23.15,
  def_: 7.29,
  eleMas: 23.31,
  enerRech_: 6.48,
  critRate_: 3.89,
  critDMG_: 7.77,
}

export function calculateCV(substats: readonly { key: string; value: number }[]): number {
  let cv = 0
  for (const s of substats) {
    if (s.key === 'critRate_') cv += s.value * 2
    if (s.key === 'critDMG_') cv += s.value
  }
  return Number(cv.toFixed(2))
}

export function calculateRV(substats: readonly { key: string; value: number }[]): number {
  let rv = 0
  for (const s of substats) {
    const max = MAX_SUBSTATS[s.key]
    if (max && s.value) rv += (s.value / max) * 100
  }
  return Math.round(rv / 10) * 10
}

/**
 * Everything about an artifact that does not change while it sits in the
 * inventory. Levelling or rolling a substat produces a different identity, so
 * a catalog row keyed by this is immutable.
 *
 * `location`, `lock` and `astralMark` are deliberately absent: they change
 * without the artifact changing, so they are stored per snapshot
 * ({@link ArtifactState}) and history keeps the state each snapshot saw.
 */
export interface ArtifactIdentity {
  setKey: string
  slotKey: string
  level: number
  rarity: number
  mainStatKey: string
  substats: GoodSubstat[]
  totalRolls: number
  elixerCrafted: boolean
  unactivatedSubstats: GoodSubstat[]
}

export interface ArtifactState {
  location: string
  lock: boolean
  astralMark: boolean
  /** EXP toward the next level; absent = 0 or unknown. */
  exp?: number
}

/**
 * The canonical text an artifact's identity hashes over. Keys are written in a
 * fixed order and substats keep the game's order, so the same artifact always
 * yields the same text. Changing this changes every hash: it is part of the
 * storage format.
 */
export function artifactIdentityText(identity: ArtifactIdentity): string {
  return JSON.stringify([
    identity.setKey,
    identity.slotKey,
    identity.level,
    identity.rarity,
    identity.mainStatKey,
    identity.substats.map(substatTuple),
    identity.totalRolls,
    identity.elixerCrafted ? 1 : 0,
    identity.unactivatedSubstats.map(substatTuple),
  ])
}

function substatTuple(s: GoodSubstat): [string, number, number | null] {
  return [s.key, s.value, s.initialValue ?? null]
}

/**
 * Hashes already made in this isolate, by identity text. An upload holds the
 * same ~2,000 artifacts as the last one, so a warm Worker hashes only the
 * new ones (hashing all of them was a quarter of an import's encoding time).
 * Emptied when full; ~60 B of text and 32 of hash each, so ~5 MB at most.
 */
const identityHashes = new Map<string, string>()
const IDENTITY_HASHES_MAX = 50_000

export async function hashArtifactIdentity(identity: ArtifactIdentity): Promise<string> {
  const text = artifactIdentityText(identity)
  const known = identityHashes.get(text)
  if (known !== undefined) return known
  const hash = await sha256Hex128(text)
  if (identityHashes.size >= IDENTITY_HASHES_MAX) identityHashes.clear()
  identityHashes.set(text, hash)
  return hash
}
