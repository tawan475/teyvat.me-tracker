import type { Arcanum } from '@gdt/game-data/endgame'

/**
 * The Lunar Arcana collection (Imaginarium Theater's Lunar Mode, 6.0 on):
 * the 22 cards in the game's order and how many of each the account holds,
 * from the newest capture's `gi_endgame.theater.arcana` (Teyvat.me Capture
 * 1.17.31 on). Without one, nothing is marked held or missing.
 */

/** Card numbers as the game writes them, I … XXII. */
export const ROMAN = [
  'I',
  'II',
  'III',
  'IV',
  'V',
  'VI',
  'VII',
  'VIII',
  'IX',
  'X',
  'XI',
  'XII',
  'XIII',
  'XIV',
  'XV',
  'XVI',
  'XVII',
  'XVIII',
  'XIX',
  'XX',
  'XXI',
  'XXII',
] as const

/** A number's numeral ("" past XXII). */
export const roman = (n: number): string => ROMAN[n - 1] ?? ''

/** The three "Magnum Opus" achievements: obtain one, hold 12, hold 22 at once. */
export const MAGNUM_OPUS = [
  { id: 81620, need: 1 },
  { id: 81621, need: 12 },
  { id: 81622, need: 22 },
] as const

export interface ArcanumView {
  card: Arcanum
  numeral: string
  /** Copies held; null when no capture says (nothing is marked then). */
  count: number | null
}

export interface ArcanaSummary {
  total: number
  /** Different cards held; null when no capture says. */
  held: number | null
  /** Copies beyond the first, to give away in Co-Op. */
  spare: number
  /** The cards with spares, in order. */
  spares: ArcanumView[]
}

/**
 * Each card with its count. `held` is the capture's map (card number as a
 * string → copies) or null without one; numbers it doesn't name are 0.
 */
export function arcanaViews(
  cards: readonly Arcanum[],
  held: Readonly<Record<string, number>> | null | undefined,
): ArcanumView[] {
  return cards.map((card) => ({
    card,
    numeral: roman(card.number),
    count: held ? Math.max(0, Math.floor(held[String(card.number)] ?? 0)) : null,
  }))
}

export function arcanaSummary(views: readonly ArcanumView[]): ArcanaSummary {
  const known = views.length > 0 && views.every((v) => v.count !== null)
  const spares = views.filter((v) => (v.count ?? 0) > 1)
  return {
    total: views.length,
    held: known ? views.filter((v) => (v.count ?? 0) > 0).length : null,
    spare: spares.reduce((sum, v) => sum + (v.count! - 1), 0),
    spares,
  }
}

export const ARCANA_FILTERS = ['all', 'held', 'missing', 'spare'] as const
export type ArcanaFilter = (typeof ARCANA_FILTERS)[number]

export const isArcanaFilter = (value: unknown): value is ArcanaFilter =>
  typeof value === 'string' && (ARCANA_FILTERS as readonly string[]).includes(value)

export function filterArcana(views: readonly ArcanumView[], filter: ArcanaFilter): ArcanumView[] {
  switch (filter) {
    case 'held':
      return views.filter((v) => (v.count ?? 0) > 0)
    case 'missing':
      return views.filter((v) => v.count === 0)
    case 'spare':
      return views.filter((v) => (v.count ?? 0) > 1)
    default:
      return [...views]
  }
}

/** Whether a card shows as missing (locked): only when a capture says 0. */
export const isMissing = (view: ArcanumView): boolean => view.count === 0
