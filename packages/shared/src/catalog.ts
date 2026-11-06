import { calculateCV, calculateRV, type ArtifactIdentity } from './artifact'
import type { GoodSubstat } from './good'

/**
 * A substat as stored in the artifact catalog and sent on the wire:
 * [key, value] or [key, value, initialValue]. About half the size of the
 * GOOD object form, and the catalog is most of an account's storage.
 */
export type CompactSubstat = [string, number] | [string, number, number]

export function compactSubstats(substats: readonly GoodSubstat[]): CompactSubstat[] {
  return substats.map((s) =>
    s.initialValue === undefined ? [s.key, s.value] : [s.key, s.value, s.initialValue],
  )
}

export function expandSubstats(compact: readonly CompactSubstat[]): GoodSubstat[] {
  return compact.map((s) =>
    s.length === 3 ? { key: s[0], value: s[1], initialValue: s[2] } : { key: s[0], value: s[1] },
  )
}

/**
 * One artifact catalog row on the wire, positional because an account's
 * catalog is thousands of rows:
 * [id, setKey, slotKey, level, rarity, mainStatKey, substats, totalRolls,
 *  elixirCrafted (0/1), unactivatedSubstats]
 */
export type CatalogRow = [
  number,
  string,
  string,
  number,
  number,
  string,
  CompactSubstat[],
  number,
  0 | 1,
  CompactSubstat[],
]

/** A catalog artifact with its derived crit and roll values. */
export interface CatalogEntry extends ArtifactIdentity {
  id: number
  cv: number
  rv: number
}

export function catalogFromRows(rows: readonly CatalogRow[]): Map<number, CatalogEntry> {
  const catalog = new Map<number, CatalogEntry>()
  for (const r of rows) {
    const substats = expandSubstats(r[6])
    catalog.set(r[0], {
      id: r[0],
      setKey: r[1],
      slotKey: r[2],
      level: r[3],
      rarity: r[4],
      mainStatKey: r[5],
      substats,
      totalRolls: r[7],
      elixirCrafted: r[8] === 1,
      unactivatedSubstats: expandSubstats(r[9]),
      // Derived on read, never stored, so a formula change applies everywhere.
      cv: calculateCV(substats),
      rv: calculateRV(substats),
    })
  }
  return catalog
}
