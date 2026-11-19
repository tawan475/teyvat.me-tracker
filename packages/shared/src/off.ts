/**
 * Teyvat.me Capture's `gi_off` (issue 12, item 3): the upload switches that
 * are off, as names. Kept apart from parts.ts so the normaliser and the
 * snapshot meta can read it without the storage planner.
 */

import type { SnapshotSummary } from './codec/snapshot'

/**
 * The names a snapshot meta stores by position (snapshot-meta.ts: a known
 * name is its index + 1 here). Append-only: never reorder a name or reuse a
 * position. `gi_characters` is retired (see RETIRED_SWITCHES); its position
 * stays, so a meta written while it was a switch still decodes.
 */
export const OFF_POSITIONS = [
  'characters',
  'weapons',
  'artifacts',
  'materials',
  'gi_player.profile',
  'gi_player.numbers',
  'gi_characters',
  'gi_achievements',
  'gi_anecdotes',
  'gi_tasks',
  'gi_endgame',
  'gi_exploration',
  'gi_collections',
  'gi_wardrobe',
  'gi_teapot',
  'gi_events',
  'gi_miliastra',
] as const

/**
 * Names that were switches once and are none now. `gi_characters`
 * (friendship, EXP, when obtained) was a switch of its own in Capture's 1.18
 * builds before release; Capture's Characters switch covers it (2026-11-19).
 * A stored one is read back like any name the tracker does not know: kept,
 * and it says nothing.
 */
export const RETIRED_SWITCHES = ['gi_characters'] as const
type RetiredSwitch = (typeof RETIRED_SWITCHES)[number]

export type OffSwitch = Exclude<(typeof OFF_POSITIONS)[number], RetiredSwitch>

/**
 * Capture's upload switches, as `gi_off` names them (16): the export keys,
 * with `gi_player` split into its profile and its numbers. `characters`
 * covers `gi_characters` too: an upload without its characters has no
 * friendship or EXP of them either.
 */
export const OFF_SWITCHES: readonly OffSwitch[] = OFF_POSITIONS.filter(
  (name): name is OffSwitch => !(RETIRED_SWITCHES as readonly string[]).includes(name),
)

/** At most this many names are kept from one `gi_off` (a newer Capture may send more kinds). */
export const MAX_OFF_NAMES = 32
/** What a switch name may look like (letters, digits, `_` and `.`). */
const OFF_NAME = /^[A-Za-z0-9_.]{1,48}$/

/**
 * An uploaded `gi_off`: its valid names, unique, in the order sent; null when
 * the file has none (or it is not a list). Unknown names are kept: a newer
 * Capture may have more switches.
 */
export function readOff(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const out: string[] = []
  for (const name of value) {
    if (typeof name !== 'string' || !OFF_NAME.test(name) || out.includes(name)) continue
    out.push(name)
    if (out.length >= MAX_OFF_NAMES) break
  }
  return out
}

/**
 * Whether two uploads' `gi_off` say the same (the import's no-op decision):
 * the same names in any order. Absent (an older Capture, a website import)
 * and [] (everything shared) are different states.
 */
export function sameOff(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b
  return a.length === b.length && a.every((name) => b.includes(name))
}

/**
 * A stored `gi_off` as an export carries it (the bundle's manifest, and from
 * there every rebuilt file): the list when it names something, else nothing.
 * A capture that shared everything exports as it did before `gi_off`
 * existed, whether its upload said `[]` or had no list.
 */
export const exportedOff = (off: readonly string[] | null | undefined): string[] | undefined =>
  off && off.length > 0 ? [...off] : undefined

/**
 * The bag copies (2026-11-19): two counts that are player properties, not
 * items, and that Capture also writes into the materials bag. Each belongs to
 * a part with a switch of its own, and that switch covers the copy too: a
 * capture with Account numbers off shares no Original Resin count, one with
 * Serenitea Pot off no Realm Currency. Capture leaves the key out; builds
 * that still send it are read as if they had (normalizeGood, the live
 * journal's batches).
 */
export const BAG_COPIES: Readonly<Record<string, OffSwitch>> = {
  OriginalResin: 'gi_player.numbers',
  RealmCurrency: 'gi_teapot',
}

/** The material keys a `gi_off` covers (BAG_COPIES); none when it is absent or names neither switch. */
export function offBagKeys(off: readonly string[] | null | undefined): string[] {
  if (!off || off.length === 0) return []
  return Object.keys(BAG_COPIES).filter((key) => off.includes(BAG_COPIES[key]!))
}

/**
 * A `gi_off` as one number, a bit per known name by its place in
 * OFF_POSITIONS (unknown names say nothing here): what the live journal's row
 * keeps of its base snapshot's (`live_journals.base_off`). Stored: the
 * positions never move.
 */
export function offMask(off: readonly string[] | null | undefined): number {
  let mask = 0
  OFF_POSITIONS.forEach((name, position) => {
    if (off?.includes(name)) mask += 2 ** position
  })
  return mask
}

/** The names an `offMask` holds, in OFF_POSITIONS order. */
export function offOfMask(mask: number): string[] {
  if (!Number.isSafeInteger(mask) || mask <= 0) return []
  return OFF_POSITIONS.filter((_, position) => Math.floor(mask / 2 ** position) % 2 === 1)
}

/** The GOOD sections Capture can leave out (the builds; never removable). */
export const OFF_SECTIONS = ['characters', 'weapons', 'artifacts', 'materials'] as const
export type OffSection = (typeof OFF_SECTIONS)[number]

/** Whether a snapshot with this `off` shared the section (absent `off`: it did). */
export const sharesSection = (off: readonly string[] | undefined, section: OffSection): boolean =>
  !off?.includes(section)

/**
 * Each build section's bit in `snapshots.off_sections` (migration 0040), so
 * SQL can find the newest capture that shared one. Stored: never renumber.
 */
export const OFF_SECTION_BITS: Readonly<Record<OffSection, number>> = {
  characters: 1,
  weapons: 2,
  artifacts: 4,
  materials: 8,
}

/** The build sections `off` names, as OFF_SECTION_BITS (0: all shared, or no `off`). */
export function offSectionMask(off: readonly string[] | undefined): number {
  let mask = 0
  for (const section of OFF_SECTIONS)
    if (!sharesSection(off, section)) mask |= OFF_SECTION_BITS[section]
  return mask
}

/** The summary figures each build section is counted from. */
export const SECTION_FIGURES: Readonly<Record<OffSection, readonly (keyof SnapshotSummary)[]>> = {
  characters: ['characters'],
  weapons: ['weapons'],
  artifacts: ['artifacts', 'artifact3', 'artifact4'],
  materials: ['materials', 'mora', 'primogem'],
}

/**
 * A capture's figures as the pages show "now" (issue 12): those of each
 * section in `left` (the build sections it left out) from `donor(section)`,
 * the newest earlier capture that shared it, 0 when none did. `summary`
 * itself when it left none out.
 */
export function standInSummary(
  summary: SnapshotSummary,
  left: readonly OffSection[],
  donor: (section: OffSection) => SnapshotSummary | null | undefined,
): SnapshotSummary {
  if (left.length === 0) return summary
  const out = { ...summary }
  for (const section of left) {
    const from = donor(section)
    for (const field of SECTION_FIGURES[section]) out[field] = from?.[field] ?? 0
  }
  return out
}

/**
 * Capture `index`'s figures (`list` newest first) with those of a section it
 * left out from the newest older capture that shared it (standInSummary).
 */
export function sharedSummaryOf(
  list: readonly { summary: SnapshotSummary; off?: readonly string[] }[],
  index: number,
): SnapshotSummary {
  const capture = list[index]!
  const left = OFF_SECTIONS.filter((section) => !sharesSection(capture.off, section))
  return standInSummary(
    capture.summary,
    left,
    (section) => list.slice(index + 1).find((s) => sharesSection(s.off, section))?.summary,
  )
}

/**
 * The newest time a part was removed from history (settings `parts.removed`),
 * or 0. A snapshot stored before it no longer holds what its content key
 * names, so an upload equal to that key is stored anew (import's no-op).
 */
export function lastRemoval(removed: Readonly<Record<string, number>> | undefined): number {
  let newest = 0
  for (const at of Object.values(removed ?? {}))
    if (typeof at === 'number' && at > newest) newest = at
  return newest
}

/**
 * The parts that can be removed from history (eleven), in the remove dialog's
 * order. Never the builds, and never the characters' extras (friendship, EXP):
 * they belong to Characters.
 */
export const REMOVABLE_PARTS = [
  'achievements',
  'anecdotes',
  'tasks',
  'endgame',
  'collections',
  'profile',
  'wardrobe',
  'exploration',
  'teapot',
  'events',
  'miliastra',
] as const
export type RemovablePart = (typeof REMOVABLE_PARTS)[number]

export const isRemovablePart = (value: unknown): value is RemovablePart =>
  typeof value === 'string' && (REMOVABLE_PARTS as readonly string[]).includes(value)

/** The Capture switch each removable part is. */
export const PART_SWITCH: Readonly<Record<RemovablePart, OffSwitch>> = {
  achievements: 'gi_achievements',
  anecdotes: 'gi_anecdotes',
  tasks: 'gi_tasks',
  endgame: 'gi_endgame',
  collections: 'gi_collections',
  profile: 'gi_player.profile',
  wardrobe: 'gi_wardrobe',
  exploration: 'gi_exploration',
  teapot: 'gi_teapot',
  events: 'gi_events',
  miliastra: 'gi_miliastra',
}

/** The removable part a switch name is, or null (builds, the account numbers, unknown names). */
export function partOfSwitch(name: string): RemovablePart | null {
  for (const part of REMOVABLE_PARTS) if (PART_SWITCH[part] === name) return part
  return null
}

/** The note key of Overview's strip, which names every part left out. */
export const ALL_PARTS_NOTE = 'all'
