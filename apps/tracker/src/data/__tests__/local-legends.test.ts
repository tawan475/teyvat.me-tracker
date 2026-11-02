import { loadEnemies, loadEnemyNames, localLegendLevel } from '@gdt/game-data/enemies'
import { describe, expect, it } from 'vitest'
import { legendSections, matchesLegend } from '../local-legends'

describe('legendSections', () => {
  it('groups the game data by region with HP where they fight', async () => {
    const [{ legends, statsAt, worldLevels }, names] = await Promise.all([
      loadEnemies(),
      loadEnemyNames('en'),
    ])
    const sections = legendSections(legends, names, statsAt, localLegendLevel(9, worldLevels))

    // Regions in the order they first appear, each once.
    const regions = sections.map((s) => s.region)
    expect(new Set(regions).size).toBe(regions.length)
    expect(regions.slice(0, 3)).toEqual([1, 2, 5])
    expect(sections.reduce((n, s) => n + s.rows.length, 0)).toBe(legends.length)

    const rows = sections.flatMap((s) => s.rows)
    const row = rows.find((r) => r.name === 'Rilai')!
    // Alioth's figure for Furiosa at Lv. 103.
    expect(rows.find((r) => r.name === 'Furiosa')!.hp).toEqual([6702861])

    expect(matchesLegend(row, 'frozen')).toBe(true)
    expect(matchesLegend(row, 'furiosa')).toBe(false)
    expect(matchesLegend(row, ' ')).toBe(true)
  })

  it('fights lower in a lower World Level', async () => {
    const [{ legends, statsAt, worldLevels }, names] = await Promise.all([
      loadEnemies(),
      loadEnemyNames('en'),
    ])
    const at = (wl: number) =>
      legendSections(legends, names, statsAt, localLegendLevel(wl, worldLevels))[0]!.rows[0]!.hp[0]!
    expect(at(8)).toBeLessThan(at(9))
  })
})
