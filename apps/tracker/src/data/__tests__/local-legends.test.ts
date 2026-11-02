import { loadEnemies, loadEnemyNames, localLegendLevel } from '@gdt/game-data/enemies'
import { describe, expect, it } from 'vitest'
import { legendSections, matchesLegend } from '../local-legends'

describe('legendSections', () => {
  it('groups the game data by region with HP where they fight and defeats from achievements', async () => {
    const [{ legends, statsAt, worldLevels }, names] = await Promise.all([
      loadEnemies(),
      loadEnemyNames('en'),
    ])
    const rilai = legends.find((l) => names.legend(l.id).name === 'Rilai')!
    const done = new Set([rilai.achievements[0]!, rilai.achievements[2]!])
    const sections = legendSections(
      legends,
      names,
      statsAt,
      localLegendLevel(9, worldLevels),
      (id) => done.has(id),
    )

    // Regions in the order they first appear, each once.
    const regions = sections.map((s) => s.region)
    expect(new Set(regions).size).toBe(regions.length)
    expect(regions.slice(0, 3)).toEqual([1, 2, 5])
    expect(sections.reduce((n, s) => n + s.rows.length, 0)).toBe(legends.length)

    const rows = sections.flatMap((s) => s.rows)
    const row = rows.find((r) => r.legend === rilai)!
    expect(row.defeated).toBe(true)
    expect(row.goals).toEqual({ done: 2, total: 3 })
    // Alioth's figure for Furiosa at Lv. 103; Luna I-on legends have no achievements.
    const furiosa = rows.find((r) => r.name === 'Furiosa')!
    expect(furiosa.hp).toEqual([6702861])
    expect(furiosa.defeated).toBeNull()
    expect(furiosa.goals).toBeNull()
    expect(rows.find((r) => r.name === 'Iron Viscount')!.defeated).toBe(false)

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
      legendSections(legends, names, statsAt, localLegendLevel(wl, worldLevels), () => false)[0]!
        .rows[0]!.hp[0]!
    expect(at(8)).toBeLessThan(at(9))
  })
})
