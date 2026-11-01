/**
 * Preset files of custom characters and weapons, pure: what "Copy preset"
 * writes and "Paste preset" reads, `{"format": "teyvatme-preset",
 * "version": 1, "characters": [...], "weapons": [...]}` (`customPreset` in
 * @gdt/shared). A character may name its signature weapon by its place in
 * `weapons`; pasted, that weapon's goal is for the character.
 *
 * A pasted preset is checked by the schema, then against this build's
 * materials: a key the planner doesn't know is left out (counted), so a
 * preset made on a newer build still adds what it can.
 */

import type { PlannerData } from '@gdt/game-data'
import {
  customPreset,
  type CustomCharacter,
  type CustomPreset,
  type CustomWeapon,
} from '@gdt/shared'

export class PresetError extends Error {}

/** The pretty JSON a preset is copied as. */
export function presetText(preset: CustomPreset): string {
  return JSON.stringify(preset, null, 2)
}

/** A preset of these custom characters and weapons, signatures by weapon owner. */
export function makePreset(
  characters: readonly { key: string; custom: CustomCharacter }[],
  weapons: readonly { owner: string; custom: CustomWeapon }[],
): CustomPreset {
  return {
    format: 'teyvatme-preset',
    version: 1,
    characters: characters.map(({ key, custom }) => {
      const signature = weapons.findIndex((w) => w.owner === key)
      return signature >= 0 ? { ...custom, signature } : { ...custom }
    }),
    weapons: weapons.map((w) => ({ ...w.custom })),
  }
}

const CHARACTER_SLOTS = ['book', 'common', 'boss', 'local', 'weekly'] as const
const WEAPON_SLOTS = ['ascension', 'elite', 'common'] as const

/**
 * Reads pasted text (or a file's) as a preset; materials this build doesn't
 * know are dropped and counted in `unknown`. Throws `PresetError` for text
 * that isn't a preset.
 */
export function readPreset(
  text: string,
  planner: PlannerData,
): { preset: CustomPreset; unknown: number } {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new PresetError('not JSON')
  }
  const parsed = customPreset.safeParse(json)
  if (!parsed.success) throw new PresetError(parsed.error.issues[0]?.message ?? 'not a preset')
  if (parsed.data.characters.length + parsed.data.weapons.length === 0) {
    throw new PresetError('empty')
  }
  let unknown = 0
  const known = <T extends object>(entry: T, slots: readonly (keyof T)[]): T => {
    const out = { ...entry }
    for (const slot of slots) {
      const key = out[slot]
      if (typeof key === 'string' && !planner.materialsByKey.has(key)) {
        delete out[slot]
        unknown++
      }
    }
    return out
  }
  const weapons = parsed.data.weapons.map((w) => known(w, WEAPON_SLOTS))
  const characters = parsed.data.characters.map((c) => {
    const kept = known(c, CHARACTER_SLOTS)
    if (kept.signature !== undefined && !weapons[kept.signature]) delete kept.signature
    return kept
  })
  return { preset: { ...parsed.data, characters, weapons }, unknown }
}
