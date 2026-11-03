/**
 * The per-file caps an upload is held to (GOOD_LIMITS in @gdt/shared) are
 * about 1.5× the game's own counts. The game keeps growing: when a game data
 * bump brings a count within 1.2× of its cap, this fails, so the cap is raised
 * long before a real export reaches it.
 */

import achievementsJson from '@gdt/game-data/data/achievements.json'
import anecdotesJson from '@gdt/game-data/data/anecdotes.json'
import catalogJson from '@gdt/game-data/data/catalog.json'
import endgameJson from '@gdt/game-data/data/endgame.json'
import materialsJson from '@gdt/game-data/data/materials.json'
import { entryIcon } from '@gdt/game-data'
import { GOOD_LIMITS } from '@gdt/shared'
import { describe, expect, it } from 'vitest'

const HEADROOM = 1.2
/** endgame.json's Stygian seasons: [id, start, end, difficulties [id, level, bosses, …]]. */
const stygianSeasons = endgameJson.stygian as unknown as [
  number,
  string,
  string,
  [number, number, number[], ...unknown[]][],
][]

describe('GOOD_LIMITS', () => {
  it("stay well above the game data's own counts", () => {
    const counts: [keyof typeof GOOD_LIMITS, number][] = [
      ['characters', Object.keys(catalogJson.characters).length],
      ['materialKeys', Object.keys(materialsJson.materials).length],
      ['achievements', achievementsJson.rows.length],
      ['anecdotes', anecdotesJson.anecdotes.length],
      [
        'spincrystals',
        Object.values(materialsJson.materials).filter(
          (entry) =>
            entryIcon(entry as Parameters<typeof entryIcon>[0]) === 'UI_ItemIcon_BGM_Common',
        ).length,
      ],
      // A Stygian record per season and run kind (solo, co-op); fights = the bosses of a difficulty.
      ['stygianRecords', stygianSeasons.length * 2],
      ['stygianFights', Math.max(...stygianSeasons.flatMap((s) => s[3].map((d) => d[2].length)))],
    ]
    for (const [cap, count] of counts) {
      expect(count, cap).toBeGreaterThan(0)
      expect(GOOD_LIMITS[cap], cap).toBeGreaterThanOrEqual(Math.ceil(count * HEADROOM))
    }
  })
})
