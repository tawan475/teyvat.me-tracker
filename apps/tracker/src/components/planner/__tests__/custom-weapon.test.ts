import { decodePlanner, type PlannerWeapon } from '@gdt/game-data'
import plannerJson from '@gdt/game-data/data/planner.json'
import type { PlannerFile } from '@gdt/game-data/format'
import { NEW_WEAPON, weaponRequirement } from '@gdt/game-data/planner-math'
import type { CustomCharacter, CustomWeapon } from '@gdt/shared'
import { describe, expect, it } from 'vitest'
import { makePreset, presetText, PresetError, readPreset } from '../custom-preset'
import { customWeaponChoices, customWeaponData, withCustomWeapons } from '../custom-weapon'

const planner = decodePlanner(plannerJson as unknown as PlannerFile)
const max = { level: 90, ascension: 6 }
const sorted = (items: Map<string, number>) => [...items].sort(([a], [b]) => a.localeCompare(b))

/** A real weapon of `rarity` with all three ascension families, as a custom weapon. */
function copyOf(rarity: number): { real: PlannerWeapon; custom: CustomWeapon } {
  const real = [...planner.weapons.values()].find(
    (w) =>
      w.rarity === rarity &&
      w.maxLevel === 90 &&
      ['weapon', 'elite', 'common'].every((kind) =>
        w.ascension.some((p) => p.items.some((i) => i.material.kind === kind)),
      ),
  )!
  const family = (kind: string) =>
    real.ascension.flatMap((p) => p.items).find((i) => i.material.kind === kind)!.material.family!
      .key
  return {
    real,
    custom: {
      name: 'Nova Blade',
      rarity: rarity as 3 | 4 | 5,
      type: real.type as CustomWeapon['type'],
      ascension: family('weapon'),
      elite: family('elite'),
      common: family('common'),
    },
  }
}

describe('custom weapons', () => {
  it.each([3, 4, 5])('cost what a real %d-star weapon with the same materials does', (rarity) => {
    const { real, custom } = copyOf(rarity)
    const p = withCustomWeapons(planner, [['cnova0001', custom]])
    expect(p.weapons.get('cnova0001')).toMatchObject({ rarity, type: custom.type, maxLevel: 90 })
    const mine = weaponRequirement(p, 'cnova0001', NEW_WEAPON, max)!
    const theirs = weaponRequirement(planner, real.key, NEW_WEAPON, max)!
    expect(sorted(mine.items)).toEqual(sorted(theirs.items))
    expect(mine.mora).toBe(theirs.mora)
  })

  it('leave a material not chosen yet out of the cost', () => {
    const { custom } = copyOf(5)
    const p = withCustomWeapons(planner, [['cnova0001', { ...custom, elite: undefined }]])
    const req = weaponRequirement(p, 'cnova0001', NEW_WEAPON, max)!
    const kinds = new Set([...req.items.keys()].map((k) => planner.materialsByKey.get(k)?.kind))
    expect(kinds.has('elite')).toBe(false)
    expect(kinds.has('weapon')).toBe(true)
  })

  it('leave the planner untouched without any', () => {
    expect(withCustomWeapons(planner, [])).toBe(planner)
    expect(
      customWeaponData(planner, 'cx00000', { name: 'X', rarity: 5, type: 'bow' }),
    ).not.toBeNull()
  })

  it('offer every family of the three kinds, newest first', () => {
    const c = customWeaponChoices(planner)
    for (const list of [c.ascensions, c.elites, c.commons]) {
      expect(list.length).toBeGreaterThan(3)
      const ids = list.map((f) => f.members[0]!.id)
      expect(ids).toEqual([...ids].sort((a, b) => b - a))
    }
  })
})

describe('preset files', () => {
  const character: CustomCharacter = {
    name: 'Nova',
    rarity: 5,
    element: 'Pyro',
    weapon: 'polearm',
    book: 'TeachingsOfDiligence',
    image: 'https://example.com/nova.png',
  }
  const { custom: weapon } = copyOf(5)

  it('copy and paste back the same characters and weapons, signature kept', () => {
    const preset = makePreset(
      [{ key: 'cnova0001', custom: character }],
      [
        { owner: '', custom: { ...weapon, name: 'Spare' } },
        { owner: 'cnova0001', custom: weapon },
      ],
    )
    expect(preset.characters[0]!.signature).toBe(1)
    const { preset: back, unknown } = readPreset(presetText(preset), planner)
    expect(unknown).toBe(0)
    expect(back).toEqual(preset)
  })

  it('drop materials this build does not know, and a signature with no weapon', () => {
    const text = JSON.stringify({
      format: 'teyvatme-preset',
      version: 1,
      characters: [{ ...character, boss: 'NotAMaterial', signature: 3 }],
      weapons: [{ ...weapon, elite: 'AlsoMadeUp' }],
    })
    const { preset, unknown } = readPreset(text, planner)
    expect(unknown).toBe(2)
    expect(preset.characters[0]).not.toHaveProperty('boss')
    expect(preset.characters[0]).not.toHaveProperty('signature')
    expect(preset.weapons[0]).not.toHaveProperty('elite')
    expect(preset.weapons[0]!.ascension).toBe(weapon.ascension)
  })

  it('refuse what is not a preset', () => {
    for (const text of [
      'hello',
      '{}',
      '{"format":"teyvatme-preset","version":2}',
      '{"format":"teyvatme-preset","version":1}',
      JSON.stringify({
        format: 'teyvatme-preset',
        version: 1,
        characters: [{ ...character, image: 'http://example.com/a.png' }],
      }),
      JSON.stringify({
        format: 'teyvatme-preset',
        version: 1,
        characters: [{ ...character, image: 'javascript:alert(1)' }],
      }),
    ]) {
      expect(() => readPreset(text, planner), text).toThrow(PresetError)
    }
  })
})
