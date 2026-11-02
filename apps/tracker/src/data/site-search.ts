import { normalizeSearch } from '@/lib/search'

/**
 * Site-wide search (Ctrl+K, the user's ask 2026-11-02, design "5" of the
 * new-features canvas): one list of everything a name can find —
 * characters, weapons, items, enemies, achievements and the site's pages —
 * ranked by how the name matches. Pure: the entries are built by
 * `components/shell/search-index.ts` from the game data, the account's own
 * state is laid on in the dialog.
 */

export const SEARCH_KINDS = ['character', 'weapon', 'item', 'enemy', 'achievement', 'page'] as const
export type SearchKind = (typeof SEARCH_KINDS)[number]

export interface SearchEntry {
  kind: SearchKind
  /** Unique within its kind: a GOOD key, an id, a route name. */
  key: string
  name: string
  /** What the name is matched against: the name on screen and the English one, normalized. */
  words: string
  /** Rarity 1-5 for the picture's ground; 0 none. */
  rarity: number
  /** Picture URL ('' none: pages draw an icon). */
  icon: string
}

/** How a name matches: 0 starts with the query, 1 a word starts with it, 2 anywhere; -1 not at all. */
export function matchScore(words: string, needle: readonly string[]): number {
  if (needle.length === 0) return -1
  if (!needle.every((word) => words.includes(word))) return -1
  const first = needle[0]!
  if (words.startsWith(first)) return 0
  if (words.includes(` ${first}`)) return 1
  return 2
}

/** The query as the words every match must hold. */
export function searchNeedle(query: string): string[] {
  return normalizeSearch(query).split(/\s+/).filter(Boolean)
}

export function searchWords(...names: readonly (string | undefined)[]): string {
  return normalizeSearch(
    [...new Set(names.filter((name): name is string => !!name))].join(' '),
  ).replace(/\s+/g, ' ')
}

export interface SearchGroup {
  kind: SearchKind
  entries: SearchEntry[]
  /** How many more matched than are listed. */
  more: number
}

/**
 * The matches, grouped by kind in SEARCH_KINDS order (or one kind), best
 * first in each: match score, then shorter names, then by name. `perKind`
 * caps each group (the "All" view); one kind lists up to `max`.
 */
export function searchSite(
  entries: readonly SearchEntry[],
  query: string,
  options: { kind?: SearchKind | null; perKind?: number; max?: number } = {},
): SearchGroup[] {
  const needle = searchNeedle(query)
  if (needle.length === 0) return []
  const cap = options.kind ? (options.max ?? 50) : (options.perKind ?? 5)
  const scored = new Map<SearchKind, { entry: SearchEntry; score: number }[]>()
  for (const entry of entries) {
    if (options.kind && entry.kind !== options.kind) continue
    const score = matchScore(entry.words, needle)
    if (score < 0) continue
    let list = scored.get(entry.kind)
    if (!list) scored.set(entry.kind, (list = []))
    list.push({ entry, score })
  }
  const groups: SearchGroup[] = []
  for (const kind of SEARCH_KINDS) {
    const list = scored.get(kind)
    if (!list) continue
    list.sort(
      (a, b) =>
        a.score - b.score ||
        a.entry.name.length - b.entry.name.length ||
        a.entry.name.localeCompare(b.entry.name),
    )
    groups.push({
      kind,
      entries: list.slice(0, cap).map((item) => item.entry),
      more: Math.max(list.length - cap, 0),
    })
  }
  return groups
}

/** A recent pick, kept per device (kind + key; the entry is looked up again, so names follow the language). */
export interface RecentPick {
  kind: SearchKind
  key: string
}

export const RECENT_MAX = 6

/** `pick` first, without an older copy of it, at most RECENT_MAX. */
export function addRecent(list: readonly RecentPick[], pick: RecentPick): RecentPick[] {
  return [pick, ...list.filter((item) => item.kind !== pick.kind || item.key !== pick.key)].slice(
    0,
    RECENT_MAX,
  )
}

/** A stored recent list read back: only well-formed picks of known kinds. */
export function readRecent(value: unknown): RecentPick[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(
      (item): item is RecentPick =>
        !!item &&
        typeof item === 'object' &&
        (SEARCH_KINDS as readonly string[]).includes((item as RecentPick).kind) &&
        typeof (item as RecentPick).key === 'string',
    )
    .slice(0, RECENT_MAX)
}
