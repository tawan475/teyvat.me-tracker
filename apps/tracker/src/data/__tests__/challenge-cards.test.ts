import { describe, expect, it } from 'vitest'
import en from '@/i18n/locales/en/fun.json'
import { CHALLENGE_CARDS, drawCards, listsCard } from '../challenge-cards'

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
    const deck = [1, 2, 3, 4, 5]
    const three = drawCards(deck, 3)
    expect(new Set(three).size).toBe(3)
    expect(drawCards(deck, 9).sort()).toEqual(deck)
    expect(drawCards([], 2)).toEqual([])
    expect(drawCards(deck, 2, () => 0.999999)).toEqual([5, 4])
  })
})
