import { applyDelta, GOOD_LIMITS, goodDeltaSchema, normalizeGood, type LiveGood } from '@gdt/shared'
import { describe, expect, it } from 'vitest'
import { FORMAT_NAME } from '../format-name'
import {
  DELTA_EXAMPLE,
  DELTA_PATHS,
  FILE_EXAMPLE,
  FILE_LIMITS,
  KEY_DOCS,
  showJson,
} from '../reference'

/**
 * The developer page documents what the code does: every example it shows
 * must pass the tracker's own checks whole (normalizeGood keeps a part only
 * when all of it is in range), so a doc that drifts from the code fails here.
 */
const doc = (key: string) => KEY_DOCS.find((d) => d.key === key)!.example

describe('the developer page', () => {
  it('lists every gi_* key Teyvat.me Capture writes, once', () => {
    const keys = KEY_DOCS.flatMap((d) => d.key.split(', '))
    expect(new Set(keys).size).toBe(keys.length)
    expect([...keys].sort()).toEqual([
      'gi_achievement_progress',
      'gi_achievement_times',
      'gi_achievements',
      'gi_anecdotes',
      'gi_capture',
      'gi_characters',
      'gi_collections',
      'gi_events',
      'gi_exp',
      'gi_exploration',
      'gi_guid',
      'gi_miliastra',
      'gi_player',
      'gi_tasks',
      'gi_teapot',
      'gi_wardrobe',
    ])
  })

  it('shows examples the tracker keeps whole', () => {
    const top = Object.fromEntries(
      KEY_DOCS.filter((d) => !d.key.includes(',')).map((d) => [d.key, d.example]),
    )
    const good = normalizeGood({ ...FILE_EXAMPLE, ...top, weapons: [doc('gi_guid, gi_exp')] })
    expect(good.player).toEqual(doc('gi_player'))
    expect(good.achievements).toEqual(doc('gi_achievements'))
    expect(Object.fromEntries(good.achievementTimes!.map(([id, at]) => [String(id), at]))).toEqual(
      doc('gi_achievement_times'),
    )
    expect(good.achievementProgress).toEqual(doc('gi_achievement_progress'))
    expect(Object.fromEntries(good.characterExtras!)).toEqual(doc('gi_characters'))
    expect(good.anecdotes).toEqual(doc('gi_anecdotes'))
    expect(good.tasks).toEqual(doc('gi_tasks'))
    expect(good.collections).toEqual(doc('gi_collections'))
    expect(good.wardrobe).toEqual(doc('gi_wardrobe'))
    expect(good.exploration).toEqual(doc('gi_exploration'))
    expect(good.events).toEqual(doc('gi_events'))
    expect(good.teapot).toEqual(doc('gi_teapot'))
    expect(good.miliastra).toEqual(doc('gi_miliastra'))
    expect(good.capture).toEqual(doc('gi_capture'))
    expect(good.itemGuids).toEqual({ artifacts: [], weapons: ['3488998120056947072'] })
  })

  it('quotes the file limits the tracker enforces', () => {
    const shown = Object.fromEntries(FILE_LIMITS)
    const n = (value: number) => value.toLocaleString('en-US')
    expect(shown.characters).toBe(n(GOOD_LIMITS.characters))
    expect(shown.weapons).toBe(n(GOOD_LIMITS.weapons))
    expect(shown.artifacts).toBe(n(GOOD_LIMITS.artifacts))
    expect(shown['material keys']).toBe(n(GOOD_LIMITS.materialKeys))
    expect(shown['gi_anecdotes entries']).toBe(n(GOOD_LIMITS.anecdotes))
    expect(shown['Substats per artifact']).toBe(String(GOOD_LIMITS.substats))
    expect(shown['Key length']).toBe(`${GOOD_LIMITS.keyLength} characters`)
  })

  it('shows a live batch the tracker accepts and applies', () => {
    expect(goodDeltaSchema.safeParse(DELTA_EXAMPLE).success).toBe(true)
    const base = {
      ...FILE_EXAMPLE,
      materials: { Mora: 1, MysticEnhancementOre: 3 },
      artifacts: [
        {
          setKey: 'GoldenTroupe',
          slotKey: 'plume',
          level: 16,
          rarity: 5,
          mainStatKey: 'atk',
          location: '',
          lock: false,
          substats: [],
          totalRolls: 8,
          astralMark: false,
          elixirCrafted: false,
          unactivatedSubstats: [],
          gi_guid: '3488998120056947072',
        },
      ],
    } as unknown as LiveGood
    const after = applyDelta(base, DELTA_EXAMPLE.changes as never)
    expect(after.materials).toEqual({ Mora: 48211930 })
    expect(after.characters[0]!.talent.burst).toBe(9)
    expect(after.artifacts[0]!.level).toBe(20)
    expect((after as unknown as Record<string, unknown>).gi_tasks).toEqual({
      resin: { value: 40, nextAt: 1792000540 },
    })
    // Every path the example uses is in the table.
    const heads = new Set(
      DELTA_PATHS.flatMap(([paths]) => paths.split(', ').map((path) => path.split('.')[0])),
    )
    for (const [, path] of DELTA_EXAMPLE.changes)
      expect(heads.has((path as string[])[0])).toBe(true)
  })

  it('keeps JSON that fits on one line, and is the same JSON', () => {
    expect(showJson({ a: [1, 2], b: { c: 1 } })).toBe('{ "a": [1, 2], "b": { "c": 1 } }')
    const long = { list: Array.from({ length: 20 }, (_, i) => i), deep: { x: 'y'.repeat(70) } }
    expect(showJson(long)).toContain('\n  "deep": {\n    "x": ')
    for (const value of [long, DELTA_EXAMPLE, FILE_EXAMPLE, ...KEY_DOCS.map((d) => d.example)]) {
      expect(JSON.parse(showJson(value))).toEqual(value)
    }
  })

  it('has a name', () => {
    expect(FORMAT_NAME.trim()).not.toBe('')
  })
})
