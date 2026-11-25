/**
 * Substat roll inference.
 *
 * Every time a substat rolls it adds one of a few fixed values (four tiers
 * from 3★ up: 70 / 80 / 90 / 100 % of the top one), so a substat's total can
 * be split back into its rolls. GOOD stores only the total (plus, from
 * irminsul, the first roll as `initialValue` and the artifact's roll count as
 * `totalRolls`), and both narrow the answer down.
 *
 * Tables are the game's ReliquaryAffixExcelConfigData values per rarity,
 * lowest tier first (percentages are exact; flat stats rounded to 0.01):
 * ROLL_TIERS in @gdt/shared/rolls.
 */

import { ROLL_TIERS as TIERS } from '@gdt/shared/rolls'

type Tiers = readonly number[]

/** Highest level per rarity; a substat rolls at every fourth level. */
const MAX_LEVEL: Readonly<Record<number, number>> = { 5: 20, 4: 16, 3: 12, 2: 4, 1: 4 }

export function maxLevel(rarity: number): number {
  return MAX_LEVEL[rarity] ?? 20
}

/** Upgrades an artifact of this rarity gets on the way to max level. */
function maxUpgrades(rarity: number): number {
  return Math.floor(maxLevel(rarity) / 4)
}

export function isPercentStat(key: string): boolean {
  return key.endsWith('_')
}

/** Roll values for a substat at a rarity, lowest first; [] for unknown keys. */
export function getRollTiers(key: string, rarity = 5): Tiers {
  return TIERS[rarity]?.[key] ?? []
}

export function getMaxRollTier(key: string, rarity = 5): number {
  const tiers = getRollTiers(key, rarity)
  return tiers[tiers.length - 1] ?? 0
}

/**
 * The game shows (and irminsul exports) percentages rounded to 0.1 and flat
 * stats to whole numbers, so a sum of rolls matches within half of that.
 * Flat tiers are themselves rounded to 0.01, which adds up over six rolls.
 */
function tolerance(key: string, loose: boolean): number {
  const base = isPercentStat(key) ? 0.05 + 1e-6 : 0.5 + 0.031
  return loose ? base * 2 : base
}

/** 1 (lowest tier) to 4 (top tier). Below 3★ there are fewer tiers, aligned to the top. */
export type RollQuality = 1 | 2 | 3 | 4

export interface InferredRoll {
  value: number
  quality: RollQuality
}

interface Combo {
  /** Tier index of every roll, highest first. */
  tiers: number[]
  sum: number
}

const comboCache = new Map<string, Combo[]>()

/** Every multiset of 1..maxRolls tiers, with its sum. At most 209 for 4 tiers and 6 rolls. */
function combos(key: string, rarity: number): Combo[] {
  const cacheKey = `${rarity}:${key}`
  let list = comboCache.get(cacheKey)
  if (list) return list
  const tiers = getRollTiers(key, rarity)
  const maxRolls = 1 + maxUpgrades(rarity)
  list = []
  const out = list
  const walk = (from: number, picked: number[], sum: number) => {
    if (picked.length > 0) out.push({ tiers: [...picked], sum })
    if (picked.length === maxRolls) return
    for (let t = from; t >= 0; t--) {
      picked.push(t)
      walk(t, picked, sum + tiers[t]!)
      picked.pop()
    }
  }
  walk(tiers.length - 1, [], 0)
  comboCache.set(cacheKey, list)
  return list
}

interface RollOption {
  count: number
  tiers: number[]
  error: number
}

const optionCache = new Map<string, RollOption[]>()

/**
 * For each possible roll count, the closest decomposition of `value` (one
 * per count, fewest rolls first). With `initialValue` the first roll is
 * known, so only decompositions containing that tier count.
 */
function rollOptions(
  key: string,
  value: number,
  rarity: number,
  initialValue: number | undefined,
): RollOption[] {
  const cacheKey = `${rarity}:${key}:${value}:${initialValue ?? ''}`
  const hit = optionCache.get(cacheKey)
  if (hit) return hit

  const tiers = getRollTiers(key, rarity)
  let options: RollOption[] = []
  if (tiers.length > 0 && value > 0) {
    let initialTier: number | null = null
    if (initialValue !== undefined) {
      let best = Infinity
      tiers.forEach((tier, index) => {
        const diff = Math.abs(tier - initialValue)
        if (diff <= tolerance(key, false) && diff < best) {
          best = diff
          initialTier = index
        }
      })
    }
    for (const loose of [false, true]) {
      const limit = tolerance(key, loose)
      const byCount = new Map<number, RollOption>()
      for (const combo of combos(key, rarity)) {
        const error = Math.abs(combo.sum - value)
        if (error > limit) continue
        if (initialTier !== null && !combo.tiers.includes(initialTier)) continue
        const count = combo.tiers.length
        const current = byCount.get(count)
        if (!current || error < current.error - 1e-9) {
          byCount.set(count, { count, tiers: combo.tiers, error })
        }
      }
      options = [...byCount.values()].sort((a, b) => a.count - b.count)
      if (options.length > 0) break
    }
  }
  optionCache.set(cacheKey, options)
  return options
}

function toRolls(key: string, rarity: number, tiers: number[]): InferredRoll[] {
  const values = getRollTiers(key, rarity)
  const offset = 4 - values.length
  return tiers.map((t) => ({
    value: values[t]!,
    quality: Math.min(4, Math.max(1, offset + t + 1)) as RollQuality,
  }))
}

/** One substat on its own: the fewest rolls that add up to `value`. */
export function inferSubstatRolls(
  key: string,
  value: number,
  rarity = 5,
  initialValue?: number,
): InferredRoll[] {
  const best = rollOptions(key, value, rarity, initialValue)[0]
  return best ? toRolls(key, rarity, best.tiers) : []
}

/**
 * Roll counts the artifact can have in total. With `totalRolls` (irminsul)
 * that is exact; otherwise it follows from the level: one roll per four
 * levels, plus the starting lines (rarity − 2 or rarity − 1 of them, at
 * most 4). An upgrade spent opening a new line counts as that line's roll.
 */
function possibleTotals(
  rarity: number,
  level: number,
  lines: number,
  totalRolls?: number,
): number[] {
  if (totalRolls && totalRolls > 0) return [totalRolls]
  const upgrades = Math.min(maxUpgrades(rarity), Math.floor(level / 4))
  const minStart = Math.max(0, rarity - 2)
  const maxStart = Math.min(4, rarity - 1)
  const totals: number[] = []
  for (let start = maxStart; start >= minStart; start--) {
    const opened = lines - start
    if (opened < 0 || opened > upgrades) continue
    totals.push(start + upgrades)
  }
  return totals
}

export interface RollSource {
  rarity: number
  level: number
  substats: readonly { key: string; value: number; initialValue?: number }[]
  totalRolls?: number
}

/**
 * Rolls for every substat of an artifact (same order as `substats`; an empty
 * list where the value cannot be decomposed). Where a substat alone is
 * ambiguous (3 high rolls or 4 low ones), the artifact's total roll count
 * decides.
 */
export function inferArtifactRolls(artifact: RollSource): InferredRoll[][] {
  const { rarity, substats } = artifact
  const options = substats.map((s) => rollOptions(s.key, s.value, rarity, s.initialValue))
  const totals = possibleTotals(rarity, artifact.level, substats.length, artifact.totalRolls)

  let best: { pick: RollOption[]; error: number } | null = null
  if (totals.length > 0 && options.every((o) => o.length > 0)) {
    const pick: RollOption[] = []
    const walk = (index: number, count: number, error: number) => {
      if (index === options.length) {
        if (totals.includes(count) && (!best || error < best.error - 1e-9)) {
          best = { pick: [...pick], error }
        }
        return
      }
      for (const option of options[index]!) {
        pick.push(option)
        walk(index + 1, count + option.count, error + option.error)
        pick.pop()
      }
    }
    walk(0, 0, 0)
  }

  const chosen: (RollOption | undefined)[] =
    (best as { pick: RollOption[] } | null)?.pick ?? options.map((o) => o[0])
  return substats.map((s, i) => {
    const option = chosen[i]
    return option ? toRolls(s.key, rarity, option.tiers) : []
  })
}

/** Roll quality as a data colour: the game's rarity colours, lowest to top tier. */
export const ROLL_QUALITY_BG: Readonly<Record<RollQuality, string>> = {
  1: 'bg-rarity-1',
  2: 'bg-rarity-3',
  3: 'bg-rarity-4',
  4: 'bg-rarity-5',
}

export const ROLL_QUALITY_TEXT: Readonly<Record<RollQuality, string>> = {
  1: 'text-rarity-1',
  2: 'text-rarity-3',
  3: 'text-rarity-4',
  4: 'text-rarity-5',
}

/**
 * How much of a roll bar (ui/RollBars) a roll fills; exaggerated past the
 * real 70–100 % so tiers read at a glance, without colour too.
 */
export const ROLL_QUALITY_FILL: Readonly<Record<RollQuality, string>> = {
  1: '45%',
  2: '65%',
  3: '82%',
  4: '100%',
}

export const ROLL_QUALITY_LABEL: Readonly<Record<RollQuality, string>> = {
  1: '70%',
  2: '80%',
  3: '90%',
  4: '100%',
}
