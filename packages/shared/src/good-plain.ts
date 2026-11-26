/**
 * Plain GOOD from a Leyline file: what Genshin Optimizer, Seelie's inventory
 * and any GOOD reader expect, without Teyvat.me's additions.
 *
 * - Every top-level `gi_*` key and `leyline` go; so does every `gi_*` field
 *   on a character, weapon or artifact (`gi_rolls`, `gi_guid`, `gi_exp`).
 * - An artifact's substats (and `unactivatedSubstats`) keep only the keys
 *   GOOD defines for one (`GOOD_SUBSTAT_FIELDS`, Genshin Optimizer's substat schema:
 *   `key`, `value`, `initialValue`); GGScanner's per-substat `rolls` and any
 *   `gi_*` field go.
 * - A build part the capture did not share (`gi_off` names `characters`,
 *   `weapons`, `artifacts` or `materials`) is left OUT, never written empty:
 *   Genshin Optimizer's import can delete what is "not in the import", so an
 *   empty list could wipe a user's data there.
 * - `version` is the file's, clamped to GOOD's 1-3 (Genshin Optimizer
 *   refuses others); 3 when it has none. `format` is "GOOD". `source` stays.
 *
 * Pure and idempotent; the input is not changed. No zod (`@gdt/shared/good-plain`).
 */

/** The GOOD lists a `gi_off` name can leave out. */
const BUILD_PARTS = ['characters', 'weapons', 'artifacts', 'materials'] as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isOurs = (key: string) => key === 'leyline' || key.startsWith('gi_')

/** The keys a GOOD substat has (Genshin Optimizer's `substatSchema`). */
export const GOOD_SUBSTAT_FIELDS = ['key', 'value', 'initialValue'] as const

function plainSubstat(substat: unknown): unknown {
  if (!isRecord(substat)) return substat
  const out: Record<string, unknown> = {}
  for (const key of GOOD_SUBSTAT_FIELDS) if (key in substat) out[key] = substat[key]
  return out
}

/** The artifact fields that are lists of substats. */
const SUBSTAT_LISTS = ['substats', 'unactivatedSubstats'] as const

function plainItem(item: unknown): unknown {
  if (!isRecord(item)) return item
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(item)) {
    if (key.startsWith('gi_')) continue
    out[key] =
      (SUBSTAT_LISTS as readonly string[]).includes(key) && Array.isArray(value)
        ? value.map(plainSubstat)
        : value
  }
  return out
}

function goodVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 3
  return Math.min(3, Math.max(1, Math.trunc(value)))
}

export function toPlainGood(leyline: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const off = Array.isArray(leyline.gi_off) ? new Set(leyline.gi_off) : new Set<unknown>()
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(leyline)) {
    if (isOurs(key)) continue
    if ((BUILD_PARTS as readonly string[]).includes(key) && off.has(key)) continue
    if (key === 'format') out.format = 'GOOD'
    else if (key === 'version') out.version = goodVersion(value)
    else if (key === 'characters' || key === 'weapons' || key === 'artifacts')
      out[key] = Array.isArray(value) ? value.map(plainItem) : value
    else out[key] = value
  }
  if (!('format' in out)) out.format = 'GOOD'
  if (!('version' in out)) out.version = 3
  return out
}
