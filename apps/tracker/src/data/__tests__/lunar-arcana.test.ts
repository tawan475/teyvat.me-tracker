import { describe, expect, it } from 'vitest'
import type { Arcanum } from '@gdt/game-data/endgame'
import { arcanaSummary, arcanaViews, filterArcana, isMissing, roman } from '../lunar-arcana'

const CARDS: Arcanum[] = Array.from({ length: 22 }, (_, i) => ({
  id: `CARD${i + 1}`,
  number: i + 1,
  icon: `UI_RoleCombat_Tarot_${String(i + 1).padStart(2, '0')}`,
  framed: `UI_RoleCombat_Tarot_${String(i + 1).padStart(2, '0')}_1`,
}))

describe('lunar arcana', () => {
  it('writes the numerals the game uses', () => {
    expect(roman(1)).toBe('I')
    expect(roman(9)).toBe('IX')
    expect(roman(22)).toBe('XXII')
    expect(roman(23)).toBe('')
  })

  it('counts held cards and spares from the capture', () => {
    const views = arcanaViews(CARDS, { '1': 1, '7': 2, '18': 3 })
    expect(views[6]!.count).toBe(2)
    expect(views[1]!.count).toBe(0)
    expect(isMissing(views[1]!)).toBe(true)
    const summary = arcanaSummary(views)
    expect(summary).toMatchObject({ total: 22, held: 3, spare: 3 })
    expect(summary.spares.map((v) => v.numeral)).toEqual(['VII', 'XVIII'])
  })

  it('marks nothing without a capture', () => {
    const views = arcanaViews(CARDS, null)
    expect(views.every((v) => v.count === null && !isMissing(v))).toBe(true)
    expect(arcanaSummary(views)).toMatchObject({ held: null, spare: 0 })
    expect(filterArcana(views, 'missing')).toEqual([])
  })

  it('reads an empty capture as none held', () => {
    const views = arcanaViews(CARDS, {})
    expect(arcanaSummary(views).held).toBe(0)
    expect(filterArcana(views, 'missing')).toHaveLength(22)
  })

  it('filters held, missing and spare', () => {
    const views = arcanaViews(CARDS, { '2': 1, '3': 2 })
    expect(filterArcana(views, 'all')).toHaveLength(22)
    expect(filterArcana(views, 'held').map((v) => v.card.number)).toEqual([2, 3])
    expect(filterArcana(views, 'missing')).toHaveLength(20)
    expect(filterArcana(views, 'spare').map((v) => v.card.number)).toEqual([3])
  })
})
