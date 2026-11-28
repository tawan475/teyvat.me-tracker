import { describe, expect, it } from 'vitest'
import en from '@/i18n/locales/en/fun.json'
import {
  CARD_CATEGORIES,
  CHALLENGE_CARDS,
  HARDEST,
  drawAround,
  drawable,
  drawCards,
  listsCard,
} from '../challenge-cards'

describe('challenge cards', () => {
  it('have unique ids and words for every card, and no words without a card', () => {
    const ids = CHALLENGE_CARDS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(Object.keys(en.cards.list).sort()).toEqual([...ids].sort())
  })

  it('show solo the cards that work alone and co-op the ones that work together', () => {
    const all = { timed: true, levels: [], hardest: true }
    const solo = CHALLENGE_CARDS.filter((c) => listsCard(c, { ...all, mode: 'solo' }))
    const coop = CHALLENGE_CARDS.filter((c) => listsCard(c, { ...all, mode: 'coop' }))
    expect(solo.some((c) => c.id === 'threeCharacters')).toBe(true)
    expect(coop.some((c) => c.id === 'threeCharacters')).toBe(false)
    expect(coop.some((c) => c.id === 'noReviving')).toBe(true)
    expect(solo.some((c) => c.id === 'noReviving')).toBe(false)
    expect(solo.some((c) => c.id === 'noBursts') && coop.some((c) => c.id === 'noBursts')).toBe(
      true,
    )
  })

  it('leave time trials out when they are off', () => {
    const deck = CHALLENGE_CARDS.filter((c) =>
      listsCard(c, { mode: 'solo', timed: false, levels: [], hardest: true }),
    )
    expect(deck.some((c) => c.timed)).toBe(false)
    expect(CHALLENGE_CARDS.some((c) => c.timed)).toBe(true)
  })

  it('narrow by difficulty', () => {
    const deck = CHALLENGE_CARDS.filter((c) =>
      listsCard(c, { mode: 'solo', timed: true, levels: [1], hardest: false }),
    )
    expect(deck.length).toBeGreaterThan(0)
    expect(deck.every((c) => c.level === 1)).toBe(true)
  })

  it('keep the hardest cards out until they are asked for, whatever the level chips say', () => {
    const hardest = CHALLENGE_CARDS.filter((c) => c.level === HARDEST).map((c) => c.id)
    expect(hardest.sort()).toEqual(['noHits', 'nothingOn', 'oneCharacter', 'underSixtySeconds'])
    const lists = (levels: (0 | 1 | 2 | 3)[], on: boolean) =>
      CHALLENGE_CARDS.filter((c) =>
        listsCard(c, { mode: 'solo', timed: true, levels, hardest: on }),
      )
    expect(lists([], false).some((c) => c.level === HARDEST)).toBe(false)
    expect(lists([], true).filter((c) => c.level === HARDEST)).toHaveLength(4)
    expect(lists([0], true).every((c) => c.level === 0 || c.level === HARDEST)).toBe(true)
    // What a device stored before the trivial and hardest levels still means the same.
    expect(lists([3], false).every((c) => c.level === 3)).toBe(true)
  })

  it('put every card in a category, and the co-op only ones in Party', () => {
    for (const c of CHALLENGE_CARDS) expect(CARD_CATEGORIES).toContain(c.category)
    for (const id of CARD_CATEGORIES)
      expect(CHALLENGE_CARDS.some((c) => c.category === id)).toBe(true)
    expect(
      CHALLENGE_CARDS.filter((c) => c.category === 'party').every((c) => c.mode === 'coop'),
    ).toBe(true)
    expect(
      CHALLENGE_CARDS.filter((c) => c.mode === 'coop').every((c) => c.category === 'party'),
    ).toBe(true)
    expect(CHALLENGE_CARDS).toHaveLength(63)
  })

  it('draw different cards, as many as asked while the deck lasts', () => {
    const deck: { n: number; groups?: string[] }[] = [1, 2, 3, 4, 5].map((n) => ({ n }))
    const three = drawCards(deck, 3)
    expect(new Set(three).size).toBe(3)
    expect(drawCards(deck, 9).sort((x, y) => x.n - y.n)).toEqual(deck)
    expect(drawCards([], 2)).toEqual([])
    expect(drawCards(deck, 2, () => 0.999999).map((c) => c.n)).toEqual([5, 4])
  })

  it('never lay two cards of one group on the table', () => {
    const artifacts = CHALLENGE_CARDS.filter((c) => c.groups?.includes('artifacts'))
    expect(artifacts.map((c) => c.id).sort()).toEqual([
      'noArtifacts',
      'nothingOn',
      'removeFourArtifacts',
      'removeOneArtifact',
      'removeThreeArtifacts',
      'removeTwoArtifacts',
    ])
    for (const mode of ['solo', 'coop'] as const) {
      const deck = CHALLENGE_CARDS.filter((c) =>
        listsCard(c, { mode, timed: true, levels: [], hardest: true }),
      )
      for (let seed = 0; seed < 200; seed++) {
        let at = seed
        const random = () => ((at = (at * 9301 + 49297) % 233280), at / 233280)
        const hand = drawCards(deck, 99, random)
        const groups = hand.flatMap((c) => c.groups ?? [])
        expect(new Set(groups).size).toBe(groups.length)
        expect(hand.filter((c) => c.level === HARDEST).length).toBeLessThanOrEqual(1)
        // Nothing more fits: every card left shares a group with one drawn.
        const taken = new Set(groups)
        for (const c of deck)
          if (!hand.includes(c)) expect(c.groups?.some((g) => taken.has(g))).toBe(true)
      }
      // The count the page offers can always be drawn in the deck's own order.
      expect(drawable(deck)).toBe(drawCards(deck, 99, () => 0).length)
    }
    // A card drawn beside one already on the table keeps to the rule too.
    expect(drawCards(artifacts, 1, Math.random, [artifacts[0]!])).toEqual([])
  })

  it('keep apart the cards that cannot both be followed', () => {
    const groups = (id: string) => CHALLENGE_CARDS.find((c) => c.id === id)!.groups ?? []
    const apart = (a: string, b: string) => groups(a).some((g) => groups(b).includes(g))
    for (const [a, b] of [
      ['noSwapping', 'swapEveryTen'],
      ['underThreeMinutes', 'underNinetySeconds'],
      ['noBursts', 'normalAttacksOnly'],
      ['noBursts', 'oneBurstEach'],
      ['skillsOnly', 'threeBursts'],
      ['oneElement', 'sameElementEveryone'],
      ['noHits', 'noDodging'],
      ['noHits', 'noShields'],
      ['firstTry', 'failAddsCard'],
      ['oneRoleEach', 'noHealing'],
      ['oneRoleEach', 'noShields'],
      ['sameCharacterEveryone', 'fourRegions'],
      ['sameCharacterEveryone', 'pickForNext'],
      ['nothingOn', 'levelOneWeapons'],
      ['nothingOn', 'oneSetForAll'],
      ['noArtifacts', 'fourStarArtifacts'],
      ['oneCharacter', 'swapInSlotOrder'],
      ['oneCharacter', 'allBurstsTogether'],
      ['travelerLeads', 'fourStarCharacters'],
      ['travelerLeads', 'oneRegion'],
      ['nobodyFalls', 'noReviving'],
    ] as const)
      expect(apart(a, b), `${a} + ${b}`).toBe(true)
    // And cards that go together stay drawable together.
    for (const [a, b] of [['noBursts', 'noSkills'] /* one group: either, not both */] as const)
      expect(apart(a, b)).toBe(true)
    for (const [a, b] of [
      ['fourStarWeapons', 'levelOneWeapons'],
      ['oneElement', 'oneRegion'],
      ['noHealing', 'noFood'],
      ['removeOneArtifact', 'noFourPieceSets'],
    ] as const)
      expect(apart(a, b), `${a} + ${b}`).toBe(false)
  })

  it('keeps the locked cards in place through a draw', () => {
    const deck = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id }))
    const hand = [deck[0]!, deck[1]!, deck[2]!]
    for (let seed = 0; seed < 30; seed++) {
      let at = seed
      const random = () => ((at = (at * 9301 + 49297) % 233280), at / 233280)
      const next = drawAround(deck, hand, new Set(['b']), 3, random)
      expect(next).toHaveLength(3)
      expect(next[1]!.id).toBe('b')
      expect(new Set(next.map((c) => c.id)).size).toBe(3)
    }
    // Nothing locked: a plain draw. All locked: the same hand.
    expect(drawAround(deck, hand, new Set(), 2)).toHaveLength(2)
    expect(drawAround(deck, hand, new Set(['a', 'b', 'c']), 3)).toEqual(hand)
    // More cards asked for: the new ones follow. Fewer: the locked ones stay.
    expect(drawAround(deck, hand, new Set(['c']), 5)).toHaveLength(5)
    expect(drawAround(deck, hand, new Set(['a', 'c']), 1).map((c) => c.id)).toEqual(['a', 'c'])
    // A locked card's group is taken, and it stays even when the deck dropped it.
    const grouped = [{ id: 'x', groups: ['g'] }, { id: 'y', groups: ['g', 'h'] }, { id: 'z' }]
    const kept = drawAround(grouped.slice(1), [grouped[0]!, grouped[2]!], new Set(['x']), 2)
    expect(kept.map((c) => c.id)).toEqual(['x', 'z'])
  })
})
