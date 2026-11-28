/**
 * The challenge cards (docs/plans/fun.md): rules that make a run harder. A
 * hand-written deck; each card's words are messages (`fun.cards.list.<id>`),
 * so a new card is one row here and its text in every language. Ids are
 * what a device remembers as taken out: never rename one.
 */

export const CARD_LEVELS = [1, 2, 3] as const
export type CardLevel = (typeof CARD_LEVELS)[number]
/** How a card can be played: alone, with other players, or either. */
export type CardMode = 'both' | 'solo' | 'coop'
export type PlayMode = 'solo' | 'coop'
export const PLAY_MODES: readonly PlayMode[] = ['solo', 'coop']

export interface ChallengeCard {
  id: string
  /** 1 easy, 2 medium, 3 hard. */
  level: CardLevel
  mode: CardMode
  /** Puts a time limit on the fight. */
  timed: boolean
  /** Which picture it gets (ChallengeCards maps the names to icons). */
  icon:
    | 'ban'
    | 'sword'
    | 'heart'
    | 'food'
    | 'element'
    | 'walk'
    | 'swap'
    | 'shield'
    | 'clock'
    | 'team'
  /** Cards of one group say the same thing in different amounts: a draw holds one at most. */
  group?: string
}

const card = (
  id: string,
  level: CardLevel,
  icon: ChallengeCard['icon'],
  mode: CardMode = 'both',
  timed = false,
): ChallengeCard => ({ id, level, mode, timed, icon })
const artifacts = (id: string, level: CardLevel): ChallengeCard => ({
  ...card(id, level, 'ban'),
  group: 'artifacts',
})

export const CHALLENGE_CARDS: readonly ChallengeCard[] = [
  card('noBursts', 2, 'ban'),
  card('noSkills', 2, 'ban'),
  card('normalAttacksOnly', 3, 'sword'),
  card('fourStarWeapons', 2, 'sword'),
  card('levelOneWeapons', 3, 'sword'),
  card('oneWeaponType', 1, 'sword'),
  card('noHealing', 3, 'heart'),
  card('noShields', 2, 'shield'),
  card('noFood', 1, 'food'),
  artifacts('removeOneArtifact', 1),
  artifacts('removeTwoArtifacts', 2),
  artifacts('removeThreeArtifacts', 2),
  artifacts('removeFourArtifacts', 3),
  artifacts('noArtifacts', 3),
  card('oneElement', 2, 'element'),
  card('fourStarCharacters', 3, 'team'),
  card('noSprinting', 1, 'walk'),
  card('noDodging', 3, 'walk'),
  card('swapEveryTen', 2, 'swap', 'solo'),
  card('noSwapping', 2, 'swap', 'solo'),
  card('threeCharacters', 2, 'team', 'solo'),
  card('underThreeMinutes', 2, 'clock', 'both', true),
  card('underNinetySeconds', 3, 'clock', 'both', true),
  card('noReviving', 2, 'heart', 'coop'),
  card('sameElementEveryone', 2, 'element', 'coop'),
  card('oneBurstEach', 1, 'ban', 'coop'),
]

export interface DeckFilters {
  mode: PlayMode
  /** Time trials are in the deck. */
  timed: boolean
  /** Levels listed; empty lists all. */
  levels: readonly CardLevel[]
}

/** Whether the card is in the deck the filters show. */
export function listsCard(c: ChallengeCard, filters: DeckFilters): boolean {
  return (
    (c.mode === 'both' || c.mode === filters.mode) &&
    (filters.timed || !c.timed) &&
    (!filters.levels.length || filters.levels.includes(c.level))
  )
}

/** How many cards one draw of `deck` can hold: a group counts once. */
export function drawable(deck: readonly Pick<ChallengeCard, 'group'>[]): number {
  const groups = new Set<string>()
  let alone = 0
  for (const c of deck) c.group ? groups.add(c.group) : alone++
  return alone + groups.size
}

/**
 * `count` different cards of `deck`, in the order drawn, one of a group at
 * most; fewer when the deck runs out. `held` are cards already on the table:
 * their groups are taken.
 */
export function drawCards<T extends { group?: string }>(
  deck: readonly T[],
  count: number,
  random: () => number = Math.random,
  held: readonly { group?: string }[] = [],
): T[] {
  const taken = new Set(held.map((c) => c.group).filter(Boolean))
  let rest = deck.filter((c) => !c.group || !taken.has(c.group))
  const out: T[] = []
  while (out.length < count && rest.length) {
    const next = rest[Math.min(rest.length - 1, Math.floor(random() * rest.length))]!
    out.push(next)
    rest = rest.filter((c) => c !== next && (!next.group || c.group !== next.group))
  }
  return out
}
