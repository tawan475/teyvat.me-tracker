import { calculateCV, calculateRV, type ArtifactIdentity } from './artifact'
import type { GoodSubstat } from './good'
import { isRollsText, needsFill, type RollsText } from './rolls'

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
 *  elixirCrafted (0/1), unactivatedSubstats, rolls?]
 * `rolls` (a RollsText) only when the piece's rolls are known.
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
  RollsText?,
]

/** A catalog artifact with its derived crit and roll values. */
export interface CatalogEntry extends ArtifactIdentity {
  id: number
  cv: number
  rv: number
  /** The piece's rolls, when known. Not part of its identity. */
  rolls?: RollsText
}

/**
 * The catalog by id. One id can come twice (two chunks after an old merge):
 * the identity is the last row's; the rolls the better of the two by
 * `needsFill` (ordered beats `~`, `~` beats none, ordered is never replaced).
 */
export function catalogFromRows(rows: readonly CatalogRow[]): Map<number, CatalogEntry> {
  const catalog = new Map<number, CatalogEntry>()
  for (const r of rows) {
    const previous = catalog.get(r[0])?.rolls
    const incoming = isRollsText(r[10]) ? r[10] : undefined
    const rolls = needsFill(previous, incoming) ? incoming : previous
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
      ...(rolls !== undefined ? { rolls } : {}),
    })
  }
  return catalog
}

/** The rolls a catalog knows, by id: what decodeSnapshot / decodeArtifacts take. */
export function catalogRolls(
  catalog: ReadonlyMap<number, { rolls?: RollsText }>,
): Map<number, RollsText> {
  const rolls = new Map<number, RollsText>()
  for (const [id, entry] of catalog) if (entry.rolls !== undefined) rolls.set(id, entry.rolls)
  return rolls
}
