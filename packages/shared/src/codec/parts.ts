/**
 * Fingerprints of an upload's big parts as they arrive (docs/plans/
 * lighter-upload.md, step 1): equal lists, read by the same code, have equal
 * fingerprints, so a server that stored a section made from one can point at
 * it again without reading the list. A fingerprint is only ever looked up
 * inside one account.
 */

import { CHARACTERS } from '../dictionary'
import { sha256Hex128 } from '../hash'

/**
 * What `toArtifact` and `encodeArtifacts` make of a list, as a number: raise
 * it whenever either reads an artifact differently (a new field kept, a
 * default changed), so every stored fingerprint stops matching and each
 * account's next upload is read in full once.
 */
const ARTIFACTS_READING = 1

/**
 * The fingerprint of an artifact list whose every entry has a `gi_guid`
 * (`deferrableArtifacts`), or null when two entries share one. The list is
 * hashed in guid order: Capture writes it out of a hash map, in another order
 * every login. The character dictionary's size is part of it because a
 * location is stored as that dictionary's id.
 */
export async function artifactsFingerprint(
  list: readonly Record<string, unknown>[],
): Promise<string | null> {
  const sorted = [...list].sort((a, b) => {
    const x = a.gi_guid as string
    const y = b.gi_guid as string
    return x.length - y.length || (x < y ? -1 : x > y ? 1 : 0)
  })
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.gi_guid === sorted[i - 1]!.gi_guid) return null
  }
  return sha256Hex128(
    `artifacts:${ARTIFACTS_READING}:${CHARACTERS.keys.length}:${JSON.stringify(sorted)}`,
  )
}

/** What `itemFingerprint` and the item index's pairs are, as a number (as ARTIFACTS_READING). */
const ITEM_INDEX_READING = 1

/**
 * Names the item index of a snapshot whose artifact list has `fingerprint`
 * and whose weapons index as `weapons` (guid and item fingerprint pairs):
 * two snapshots with the same key have the same index.
 */
export function itemIndexKey(
  fingerprint: string,
  weapons: readonly (readonly [string, number])[],
): Promise<string> {
  return sha256Hex128(`items:${ITEM_INDEX_READING}:${fingerprint}:${JSON.stringify(weapons)}`)
}
