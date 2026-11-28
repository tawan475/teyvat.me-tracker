/**
 * The challenge cards (docs/plans/fun.md): rules that make a run harder. A
 * hand-written deck; each card's words are messages (`fun.cards.list.<id>`),
 * so a new card is one row here and its text in every language. Ids are
 * what a device remembers as taken out: never rename one.
 *
 * Every card can be followed anywhere: the open world, a domain, a boss,
 * Stygian Onslaught, Imaginarium Theater and the Spiral Abyss (the user's
 * rule; a card that costs nothing somewhere is fine, one that cannot be
 * followed somewhere is not). No card reads the account: on a maxed account
 * "only characters below Lv. 70" leaves nobody.
 */

/** 0 trivial, 1 easy, 2 medium, 3 hard, 4 the hardest (shown as Ⓜ️). 1-3 are what devices stored before 0 and 4 existed. */
export const CARD_LEVELS = [0, 1, 2, 3, 4] as const
export type CardLevel = (typeof CARD_LEVELS)[number]
/** The hardest level: its cards are in the deck only when asked for, one per draw. */
export const HARDEST: CardLevel = 4
/** The levels the level chips narrow by; the hardest has its own switch. */
export const PLAIN_LEVELS: readonly CardLevel[] = [0, 1, 2, 3]

/** How a card can be played: alone, with other players, or either. */
export type CardMode = 'both' | 'solo' | 'coop'
export type PlayMode = 'solo' | 'coop'
export const PLAY_MODES: readonly PlayMode[] = ['solo', 'coop']

/** What a card limits; the deck is browsed by these, in this order. */
export const CARD_CATEGORIES = ['team', 'gear', 'combat', 'trials', 'party', 'fun'] as const
export type CardCategory = (typeof CARD_CATEGORIES)[number]

export type CardIcon =
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

export interface ChallengeCard {
  id: string
  category: CardCategory
  level: CardLevel
  mode: CardMode
  /** Puts a time limit on the fight. */
  timed: boolean
  /** Which picture it gets (ChallengeCards maps the names to icons). */
  icon: CardIcon
  /**
   * Cards that share a group never lie on the table together: they say the
   * same thing in different amounts ("2 artifacts off", "No artifacts") or
   * cannot both be followed ("No swapping", "Swap every 10 s").
   */
  groups?: readonly string[]
}

interface Extra {
  mode?: CardMode
  timed?: boolean
  groups?: readonly string[]
}
const pool =
  (category: CardCategory) =>
  (id: string, level: CardLevel, icon: CardIcon, extra: Extra = {}): ChallengeCard => {
    const groups = [...(extra.groups ?? []), ...(level === HARDEST ? ['hardest'] : [])]
    return {
      id,
      category,
      level,
      icon,
      mode: extra.mode ?? 'both',
      timed: extra.timed ?? false,
      ...(groups.length ? { groups } : {}),
    }
  }
const team = pool('team')
const gear = pool('gear')
const combat = pool('combat')
const trials = pool('trials')
const party = pool('party')
const fun = pool('fun')
const solo = { mode: 'solo' } as const
const coop = { mode: 'coop' } as const

export const CHALLENGE_CARDS: readonly ChallengeCard[] = [
  // Team: who may come.
  team('fourElements', 0, 'element', { groups: ['elements'] }),
  team('twoElements', 1, 'element', { groups: ['elements'] }),
  team('fourRegions', 1, 'team', { groups: ['regions'] }),
  team('oneFiveStar', 1, 'team', { groups: ['rarity'] }),
  team('noBowsNoCatalysts', 1, 'sword', { groups: ['weaponType'] }),
  team('oneWeaponType', 1, 'sword', { groups: ['weaponType'] }),
  team('oneElement', 2, 'element', { groups: ['elements'] }),
  team('oneRegion', 2, 'team', { groups: ['regions'] }),
  team('threeCharacters', 2, 'team', { ...solo, groups: ['size'] }),
  team('fourStarCharacters', 3, 'team', { groups: ['rarity', 'traveler'] }),
  team('twoCharacters', 3, 'team', { ...solo, groups: ['size'] }),
  team('oneCharacter', 4, 'team', { ...solo, groups: ['size', 'swaps', 'allBursts'] }),

  // Gear: weapons, artifacts and sets.
  gear('refinementOne', 0, 'sword'),
  gear('removeOneArtifact', 1, 'ban', { groups: ['artifacts'] }),
  gear('removeTwoArtifacts', 2, 'ban', { groups: ['artifacts', 'sets'] }),
  gear('removeThreeArtifacts', 2, 'ban', { groups: ['artifacts', 'sets'] }),
  gear('fourStarWeapons', 2, 'sword', { groups: ['weaponRarity'] }),
  gear('noFourPieceSets', 2, 'ban', { groups: ['sets'] }),
  gear('oneSetForAll', 2, 'team', { groups: ['sets'] }),
  gear('fourStarArtifacts', 2, 'ban', { groups: ['artifactRarity'] }),
  gear('removeFourArtifacts', 3, 'ban', { groups: ['artifacts', 'sets'] }),
  gear('noArtifacts', 3, 'ban', { groups: ['artifacts', 'sets', 'artifactRarity'] }),
  gear('levelOneWeapons', 3, 'sword', { groups: ['weaponLevel'] }),
  gear('threeStarWeapons', 3, 'sword', { groups: ['weaponRarity'] }),
  gear('nothingOn', 4, 'ban', {
    groups: ['weaponLevel', 'artifacts', 'sets', 'artifactRarity'],
  }),

  // Combat: what may be pressed during the fight.
  combat('noFood', 0, 'food'),
  combat('noJumping', 0, 'walk'),
  combat('noSprinting', 1, 'walk'),
  combat('swapInSlotOrder', 1, 'swap', { ...solo, groups: ['swaps'] }),
  combat('noBursts', 2, 'ban', { groups: ['buttons', 'bursts'] }),
  combat('noSkills', 2, 'ban', { groups: ['buttons'] }),
  combat('skillsOnly', 2, 'ban', { groups: ['buttons', 'bursts'] }),
  combat('noShields', 2, 'shield', { groups: ['hitsShield', 'roleShield'] }),
  combat('swapEveryTen', 2, 'swap', { ...solo, groups: ['swaps'] }),
  combat('noSwapping', 2, 'swap', { ...solo, groups: ['swaps'] }),
  combat('allBurstsTogether', 2, 'element', { groups: ['bursts', 'allBursts'] }),
  combat('nobodyFalls', 2, 'heart', { groups: ['falls'] }),
  combat('normalAttacksOnly', 3, 'sword', { groups: ['buttons', 'bursts'] }),
  combat('chargedAttacksOnly', 3, 'sword', { groups: ['buttons', 'bursts'] }),
  combat('noHealing', 3, 'heart', { groups: ['roleHeal'] }),
  combat('noDodging', 3, 'walk', { groups: ['hitsDodge'] }),
  combat('noHits', 4, 'shield', { groups: ['hitsDodge', 'hitsShield'] }),

  // Trials: the clock and counted limits.
  trials('underFiveMinutes', 1, 'clock', { timed: true, groups: ['time'] }),
  trials('underThreeMinutes', 2, 'clock', { timed: true, groups: ['time'] }),
  trials('firstTry', 2, 'clock', { groups: ['tries'] }),
  trials('threeBursts', 2, 'ban', { groups: ['bursts'] }),
  trials('underNinetySeconds', 3, 'clock', { timed: true, groups: ['time'] }),
  trials('underSixtySeconds', 4, 'clock', { timed: true, groups: ['time'] }),

  // Party: co-op only.
  party('pickForNext', 0, 'team', { ...coop, groups: ['picks'] }),
  party('oneBurstEach', 1, 'ban', { ...coop, groups: ['bursts'] }),
  party('oneRoleEach', 1, 'team', { ...coop, groups: ['roles', 'roleHeal', 'roleShield'] }),
  party('oneCaller', 1, 'team', { ...coop, groups: ['bursts'] }),
  party('noReviving', 2, 'heart', { ...coop, groups: ['falls'] }),
  party('sameElementEveryone', 2, 'element', { ...coop, groups: ['elements'] }),
  party('sameCharacterEveryone', 2, 'team', {
    ...coop,
    groups: ['elements', 'regions', 'weaponType', 'roles', 'picks'],
  }),
  party('burstsInPlayerOrder', 2, 'swap', { ...coop, groups: ['bursts'] }),

  // Fun: low stakes.
  fun('noTeleporting', 0, 'walk'),
  fun('noGadgets', 0, 'ban'),
  fun('noPausing', 0, 'ban'),
  fun('sayItOutLoud', 0, 'team'),
  fun('noSound', 1, 'ban'),
  // The Traveler is a 5★ with no region.
  fun('travelerLeads', 1, 'team', { groups: ['traveler', 'regions'] }),
  fun('failAddsCard', 1, 'swap', { groups: ['tries'] }),
]

export interface DeckFilters {
  mode: PlayMode
  /** Time trials are in the deck. */
  timed: boolean
  /** Levels listed (of the plain ones); empty lists all. */
  levels: readonly CardLevel[]
  /** The hardest cards are in the deck. */
  hardest: boolean
}

/** Whether the card is in the deck the filters show. */
export function listsCard(c: ChallengeCard, filters: DeckFilters): boolean {
  return (
    (c.mode === 'both' || c.mode === filters.mode) &&
    (filters.timed || !c.timed) &&
    (c.level === HARDEST
      ? filters.hardest
      : !filters.levels.length || filters.levels.includes(c.level))
  )
}

type Grouped = { groups?: readonly string[] }

const free = (c: Grouped, taken: ReadonlySet<string>) => !c.groups?.some((g) => taken.has(g))

/**
 * How many cards one draw of `deck` can surely hold: the cards taken in the
 * deck's own order, each unless a group of it is taken already. A draw in
 * another order can hold a few fewer.
 */
export function drawable(deck: readonly Grouped[]): number {
  const taken = new Set<string>()
  let n = 0
  for (const c of deck) {
    if (!free(c, taken)) continue
    n++
    c.groups?.forEach((g) => taken.add(g))
  }
  return n
}

/**
 * `count` different cards of `deck`, in the order drawn, no two sharing a
 * group; fewer when the deck runs out. `held` are cards already on the
 * table: their groups are taken.
 */
export function drawCards<T extends Grouped>(
  deck: readonly T[],
  count: number,
  random: () => number = Math.random,
  held: readonly Grouped[] = [],
): T[] {
  const taken = new Set(held.flatMap((c) => c.groups ?? []))
  let rest = deck.filter((c) => free(c, taken))
  const out: T[] = []
  while (out.length < count && rest.length) {
    const next = rest[Math.min(rest.length - 1, Math.floor(random() * rest.length))]!
    out.push(next)
    next.groups?.forEach((g) => taken.add(g))
    rest = rest.filter((c) => c !== next && free(c, taken))
  }
  return out
}

/**
 * A new draw that keeps the locked cards where they lie: `hand` is what is on
 * the table, `locked` the ids kept. The other places, up to `count` in all,
 * get new cards of `deck` (never a locked card again, never one of a locked
 * card's groups). A locked card stays even when the deck no longer lists it.
 */
export function drawAround<T extends Grouped & { id: string }>(
  deck: readonly T[],
  hand: readonly T[],
  locked: ReadonlySet<string>,
  count: number,
  random: () => number = Math.random,
): T[] {
  const kept = hand.filter((c) => locked.has(c.id))
  const fresh = drawCards(
    deck.filter((c) => !locked.has(c.id)),
    Math.max(0, count - kept.length),
    random,
    kept,
  )
  const out: T[] = []
  let next = 0
  for (const c of hand.slice(0, Math.max(count, hand.length))) {
    if (locked.has(c.id)) out.push(c)
    else if (next < fresh.length) out.push(fresh[next++]!)
  }
  return [...out, ...fresh.slice(next)]
}
