import { describe, expect, it } from 'vitest'
import en from '@/i18n/locales/en/fun.json'
import { CHALLENGE_CARDS, drawable, drawCards, listsCard } from '../challenge-cards'

describe('challenge cards', () => {
  it('have unique ids and words for every card, and no words without a card', () => {
    const ids = CHALLENGE_CARDS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(Object.keys(en.cards.list).sort()).toEqual([...ids].sort())
  })

  it('show solo the cards that work alone and co-op the ones that work together', () => {
    const all = { timed: true, levels: [] }
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
      listsCard(c, { mode: 'solo', timed: false, levels: [] }),
    )
    expect(deck.some((c) => c.timed)).toBe(false)
    expect(CHALLENGE_CARDS.some((c) => c.timed)).toBe(true)
  })

  it('narrow by difficulty', () => {
    const deck = CHALLENGE_CARDS.filter((c) =>
      listsCard(c, { mode: 'solo', timed: true, levels: [1] }),
    )
    expect(deck.length).toBeGreaterThan(0)
    expect(deck.every((c) => c.level === 1)).toBe(true)
  })

  it('draw different cards, as many as asked while the deck lasts', () => {
    const deck: { n: number; group?: string }[] = [1, 2, 3, 4, 5].map((n) => ({ n }))
    const three = drawCards(deck, 3)
    expect(new Set(three).size).toBe(3)
    expect(drawCards(deck, 9).sort((x, y) => x.n - y.n)).toEqual(deck)
    expect(drawCards([], 2)).toEqual([])
    expect(drawCards(deck, 2, () => 0.999999).map((c) => c.n)).toEqual([5, 4])
  })

  it('hold one artifact card at most in a draw', () => {
    const artifacts = CHALLENGE_CARDS.filter((c) => c.group === 'artifacts')
    expect(artifacts.map((c) => c.id).sort()).toEqual([
      'noArtifacts',
      'removeFourArtifacts',
      'removeOneArtifact',
      'removeThreeArtifacts',
      'removeTwoArtifacts',
    ])
    expect(drawable(CHALLENGE_CARDS)).toBe(CHALLENGE_CARDS.length - 4)
    for (let seed = 0; seed < 50; seed++) {
      let at = seed
      const random = () => ((at = (at * 9301 + 49297) % 233280), at / 233280)
      const hand = drawCards(CHALLENGE_CARDS, 99, random)
      expect(hand.length).toBe(drawable(CHALLENGE_CARDS))
      expect(hand.filter((c) => c.group === 'artifacts').length).toBe(1)
    }
    // A card drawn beside one already on the table keeps to the rule too.
    expect(drawCards(artifacts, 1, Math.random, [artifacts[0]!])).toEqual([])
  })
})
