/**
 * The team card (team-card-canvas): two to four characters, one row each,
 * under a header with the team's name and the owner. As wide as the build
 * card (1920px); its height follows the count, and two rows are exactly the
 * build card's 1920×1080. Behind it, blurred, the city painting of the
 * region most members are from (the game's Party Setup scenes). Also what
 * the picker (BuildPicker) needs: the picks' order and the team members
 * found in the roster.
 */

import { characterInfo } from '@gdt/game-data/catalog'
import type { CharacterView } from '@/data/characters'

export const TEAM_CARD_WIDTH = 1920
/** The PNG is the card at 1×, like the build card. */
export const TEAM_CARD_SCALE = 1
export const TEAM_PAD_X = 48
export const TEAM_PAD_Y = 40
export const TEAM_HEADER = 72
export const TEAM_HEADER_GAP = 20
/** One character's row, and the gap between rows. */
export const TEAM_ROW = 446
export const TEAM_ROW_GAP = 16
/** Inside a row: its padding, then who / weapon and stats / the pieces. */
export const ROW_PAD = 20
export const ROW_COLUMNS = { who: 480, middle: 380, pieces: 876 } as const
export const ROW_COLUMN_GAP = 24
/** The weapon panel's height in the middle column, the sets strip under the pieces. */
export const ROW_WEAPON = 116
export const ROW_SETS = 88
/** The splash in a row: the build card's place, scaled (head and shoulders show). */
export const ROW_SPLASH_SCALE = 0.62

/** The most characters a card holds (the game's team size). */
export const MAX_PICKS = 4

/** The card's height for `count` rows: 156 + 462 per row (2 rows: 1080). */
export function teamCardHeight(count: number): number {
  const rows = Math.max(1, count)
  return (
    2 * TEAM_PAD_Y + TEAM_HEADER + TEAM_HEADER_GAP + rows * TEAM_ROW + (rows - 1) * TEAM_ROW_GAP
  )
}

/** The top of row `index` (0-based). */
export function teamRowTop(index: number): number {
  return TEAM_PAD_Y + TEAM_HEADER + TEAM_HEADER_GAP + index * (TEAM_ROW + TEAM_ROW_GAP)
}

/**
 * The team name's width on its plate, and the width to cut it to: only a
 * name wider than the room is cut (passing its own width as the limit cut
 * names that fit, the measure and the drawing differing by a fraction of a px).
 */
export function teamNameFit(width: number, room: number): { width: number; max?: number } {
  return width > room ? { width: room, max: room } : { width }
}

/**
 * Picks after tapping `key`: a picked one leaves (the ones after it move
 * up), a new one goes last while there is room; at `max` nothing changes.
 */
export function togglePick(picks: readonly string[], key: string, max = MAX_PICKS): string[] {
  if (picks.includes(key)) return picks.filter((k) => k !== key)
  return picks.length >= max ? [...picks] : [...picks, key]
}

/**
 * A saved team's members as the roster has them, in the team's order: a key
 * the roster lacks (or an empty slot) is skipped, any Traveler key finds the
 * roster's Traveler, nobody twice, `max` at most.
 */
export function teamMembers(
  keys: readonly string[],
  roster: readonly CharacterView[],
  max = MAX_PICKS,
): CharacterView[] {
  const byKey = new Map(roster.map((c) => [c.key, c]))
  const traveler = roster.find((c) => c.key.startsWith('Traveler')) ?? null
  const found: CharacterView[] = []
  for (const key of keys) {
    const c = byKey.get(key) ?? (key.startsWith('Traveler') ? traveler : null)
    if (c && !found.includes(c)) found.push(c)
    if (found.length === max) break
  }
  return found
}

/** The region a team stands in when none leads: Mondstadt (CityConfigData id 1). */
export const DEFAULT_TEAM_REGION = 1

/**
 * The region whose city backs the card (a CityConfigData id, 1 Mondstadt …
 * 8 Snezhnaya): the one more members are from than any other. The Traveler
 * and characters from no region don't count; a tie, or nobody from a
 * region, gives the default.
 */
export function teamRegion(keys: readonly string[]): number {
  const counts = new Map<number, number>()
  for (const key of keys) {
    const region = characterInfo(key)?.region
    if (region) counts.set(region, (counts.get(region) ?? 0) + 1)
  }
  let best = DEFAULT_TEAM_REGION
  let most = 0
  let tied = false
  for (const [region, count] of counts) {
    if (count > most) [best, most, tied] = [region, count, false]
    else if (count === most) tied = true
  }
  return most && !tied ? best : DEFAULT_TEAM_REGION
}

/** The PNG's name: the team's, else the characters' keys (`HuTao-Yelan-teyvat-me.png`). */
export function teamFileName(teamName: string | null, keys: readonly string[]): string {
  const slug = teamName
    ?.normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug ? `team-${slug}-teyvat-me.png` : `${keys.join('-') || 'team'}-teyvat-me.png`
}
