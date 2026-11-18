/**
 * Teyvat.me Capture's `gi_off` (issue 12, item 3): the upload switches that
 * are off, as names. Kept apart from parts.ts so the normaliser and the
 * snapshot meta can read it without the storage planner.
 */

/**
 * Capture's upload switches, as `gi_off` names them: the export keys, with
 * `gi_player` split into its profile and its numbers. Append-only: a meta
 * stores a known name by its position (snapshot-meta.ts).
 */
export const OFF_SWITCHES = [
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
export type OffSwitch = (typeof OFF_SWITCHES)[number]

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

/** The GOOD sections Capture can leave out (the builds; never removable). */
export const OFF_SECTIONS = ['characters', 'weapons', 'artifacts', 'materials'] as const
export type OffSection = (typeof OFF_SECTIONS)[number]

/** Whether a snapshot with this `off` shared the section (absent `off`: it did). */
export const sharesSection = (off: readonly string[] | undefined, section: OffSection): boolean =>
  !off?.includes(section)

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

/** The parts that can be removed from history, in the remove dialog's order. */
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
  'characterExtras',
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
  characterExtras: 'gi_characters',
}

/** The removable part a switch name is, or null (builds, the account numbers, unknown names). */
export function partOfSwitch(name: string): RemovablePart | null {
  for (const part of REMOVABLE_PARTS) if (PART_SWITCH[part] === name) return part
  return null
}

/** The note key of Overview's strip, which names every part left out. */
export const ALL_PARTS_NOTE = 'all'
