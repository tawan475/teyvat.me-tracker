import { entryIcon, entryId } from '@gdt/game-data'
import { loadSpincrystals as loadSongs, type Spincrystal as Song } from '@gdt/game-data/collections'
import { wikiPage } from '@/lib/wiki'

/**
 * Radiant Spincrystals (the Serenitea Pot's music list): every song the game
 * data knows (its region, number and the item that unlocks it, or none for
 * the six every Pot starts with), and which of them the newest capture's
 * `gi_collections` holds. Pure, apart from the lazy loader.
 */

/** The game's icon of every Radiant Spincrystal, and of nothing else in the material index. */
export const SPINCRYSTAL_ICON = 'UI_ItemIcon_BGM_Common'

type MaterialIndexEntry = Parameters<typeof entryId>[0]

/** One Radiant Spincrystal item: what a capture lists. */
export interface SpincrystalItem {
  /** Item id (141001 = "Radiant Spincrystal 1"). */
  id: number
  /** GOOD material key (`RadiantSpincrystal1`): its name comes from the material names. */
  key: string
  /** N of "Radiant Spincrystal N"; null for the ones named after a song. */
  number: number | null
}

/** One song of the Pot's list (game data `spincrystals`), with its item's key. */
export interface Spincrystal extends Song {
  /** The unlocking item's GOOD key; null for a song every Pot starts with. */
  key: string | null
}

const NUMBERED = /^RadiantSpincrystal(\d+)$/

/** The material index's Radiant Spincrystals (by their icon), by item id. */
export function spincrystalsOf(
  materials: Readonly<Record<string, number | readonly (number | string)[]>>,
): SpincrystalItem[] {
  const out: SpincrystalItem[] = []
  for (const [key, value] of Object.entries(materials)) {
    const entry = value as MaterialIndexEntry
    if (entryIcon(entry) !== SPINCRYSTAL_ICON) continue
    const n = NUMBERED.exec(key)
    out.push({ id: entryId(entry), key, number: n ? Number(n[1]) : null })
  }
  return out.sort((a, b) => a.id - b.id)
}

let loading: Promise<Spincrystal[]> | null = null

/** Every song with its item's key: the songs from the collections data, the keys from materials.json. */
export function loadSpincrystals(): Promise<Spincrystal[]> {
  loading ??= Promise.all([loadSongs(), import('@gdt/game-data/data/materials.json')]).then(
    ([songs, file]) => withKeys(songs, spincrystalsOf(file.default.materials)),
    (error: unknown) => {
      loading = null
      throw error
    },
  )
  return loading
}

/** The songs, each with the key of the item that unlocks it. */
export function withKeys(songs: readonly Song[], items: readonly SpincrystalItem[]): Spincrystal[] {
  const keys = new Map(items.map((i) => [i.id, i.key]))
  return songs.map((song) => ({
    ...song,
    key: song.item !== null ? (keys.get(song.item) ?? null) : null,
  }))
}

export interface SpincrystalRow extends Spincrystal {
  have: boolean
}

export interface SpincrystalProgress {
  /** Every song in the game's order (by region, then the Pot's own order). */
  rows: SpincrystalRow[]
  have: number
  total: number
  /** Captured item ids the game data does not know yet (newer than it). */
  unknown: number[]
}

/** Which songs the capture's item list `owned` unlocks; the starting six always count. */
export function spincrystalProgress(
  all: readonly Spincrystal[],
  owned: readonly number[],
): SpincrystalProgress {
  const held = new Set(owned)
  const rows = all.map((s) => ({
    ...s,
    have: s.isDefault || (s.item !== null && held.has(s.item)),
  }))
  const known = new Set(all.flatMap((s) => (s.item !== null ? [s.item] : [])))
  return {
    rows,
    have: rows.filter((r) => r.have).length,
    total: rows.length,
    unknown: owned.filter((id) => !known.has(id)),
  }
}

export type SpincrystalFilter = 'all' | 'missing' | 'have'

export function filterSpincrystals(
  rows: readonly SpincrystalRow[],
  filter: SpincrystalFilter,
): SpincrystalRow[] {
  return filter === 'all' ? [...rows] : rows.filter((r) => r.have === (filter === 'have'))
}

/**
 * A Spincrystal's guide on the Genshin Impact Fandom wiki (where it is
 * found): its page, titled `Radiant Spincrystal 55`, or the song-named
 * one's English name (`Radiant Spincrystal "A Letter from the Wind: II"`).
 */
export function spincrystalGuide(row: { number: number | null }, englishName: string): string {
  return wikiPage(row.number !== null ? `Radiant Spincrystal ${row.number}` : englishName)
}
