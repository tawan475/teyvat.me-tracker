import type { EndgameMode } from '@/data/endgame'

/**
 * Each mode's colour on the Endgame page (the user's pick: Abyss indigo,
 * Theater gold, Stygian violet), as token utilities: its label, its card's
 * outline when chosen, its season bar.
 */
export const MODE_TEXT: Record<EndgameMode, string> = {
  abyss: 'text-accent-text',
  theater: 'text-warning-text',
  stygian: 'text-rarity-4',
}

export const MODE_CHOSEN: Record<EndgameMode, string> = {
  abyss: 'border-accent-text ring-1 ring-accent-text',
  theater: 'border-warning-text ring-1 ring-warning-text',
  stygian: 'border-rarity-4 ring-1 ring-rarity-4',
}

export const MODE_BAR: Record<EndgameMode, string> = {
  abyss: 'bg-accent',
  theater: 'bg-rarity-5',
  stygian: 'bg-rarity-4',
}

/** The Stygian bosses' ground: the game's violet swirl, as a gradient behind their pictures. */
export const STYGIAN_GROUND =
  'bg-[radial-gradient(120%_100%_at_50%_0%,#4c1d95_0%,#1e1b4b_50%,#0f172a_100%)]'
