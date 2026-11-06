/**
 * A goal's cost as item tiles (the goal editor's and item editor's "Cost"),
 * pure: materials by kind and tier, EXP as books / ores, then Mora, each
 * with what the bag covers (`goalStatus`): every counted goal with this one
 * (`all`), this one alone (`alone`), or not even that (`short`). The legend
 * under the tiles counts the tiles of each colour (`stockCounts`).
 */

import { materialName } from '@/utils/materials'
import type { PlannerData, PlannerMaterial } from '@gdt/game-data'
import { goalStatus, type StockStatus } from '@gdt/game-data/planner-goals'
import {
  expHeld,
  expItemMix,
  passiveDiscount,
  type PlanGoal,
  type PlanOptions,
  type Requirement,
} from '@gdt/game-data/planner-math'
import { gameIcon, materialIcon } from '@/lib/assets'
import { formatNumber } from '@/lib/format'
import { materialRarity } from '@/utils/materials'
import { t } from '@/i18n'
import { STOCK_MEANING } from './farm-format'
import { characterName, heroBook, mergeRequirements, wholeBooks } from './model'

const KIND_ORDER = [
  'gem',
  'boss',
  'local',
  'common',
  'book',
  'weekly',
  'crown',
  'weapon',
  'elite',
  'currency',
]

export interface CostCell {
  key: string
  name: string
  icon: string
  /** The game's (material index), else the planner data's; 0 for none. */
  rarity: number
  count: number
  status: StockStatus
  title: string
  /** What the bag holds of it, when that is not the bag's count (EXP: every book, as Hero's Wit). */
  have?: number
}

export interface CostInput {
  planner: PlannerData
  requirements: readonly Requirement[]
  /** The other goals (the totals' goals without these). */
  others: readonly PlanGoal[]
  inventory: Readonly<Record<string, number>>
  options: PlanOptions
}

/** The tiles of a cost, in the order the editor shows them. */
export function costCells(input: CostInput): CostCell[] {
  const { planner, requirements, others, inventory, options } = input
  const owned = options.passives ? new Set<string>(options.passives) : null
  const merged = mergeRequirements(planner, requirements, owned)
  const goal: PlanGoal = { id: 'self', requirement: merged }
  const status = goalStatus(planner, goal, inventory, { ...options, goals: others })
  const materials = [...merged.items]
    .map(([key, count]) => ({ material: planner.materialsByKey.get(key), key, count }))
    .filter((x): x is { material: PlannerMaterial; key: string; count: number } => !!x.material)
    .sort(
      (a, b) =>
        KIND_ORDER.indexOf(a.material.kind) - KIND_ORDER.indexOf(b.material.kind) ||
        (a.material.family?.key ?? a.key).localeCompare(b.material.family?.key ?? b.key) ||
        a.material.tier - b.material.tier,
    )
  const cell = (
    material: PlannerMaterial,
    count: number,
    s: StockStatus,
    extra = '',
  ): CostCell => ({
    key: material.key,
    name: materialName(material.key),
    icon: gameIcon(material.icon),
    rarity: materialRarity(material.key, material.rarity) ?? 0,
    count,
    status: s,
    title: [`${materialName(material.key)} ×${formatNumber(count)}`, STOCK_MEANING[s], extra]
      .filter(Boolean)
      .join(' · '),
  })
  const list = materials.map(({ material, count }) =>
    cell(material, count, status.items.get(material.key) ?? 'all'),
  )
  // Character EXP as whole Hero's Wit only (inWholeBooks); every book held counts, as Hero's Wit.
  const book = heroBook(planner)
  if (book && merged.characterExp > 0) {
    list.push({
      ...cell(
        book.material,
        wholeBooks(planner, merged.characterExp),
        status.characterExp ?? 'all',
      ),
      have: Math.floor(expHeld(planner.expItems.character, inventory) / book.exp),
    })
  }
  for (const item of expItemMix(merged.weaponExp, planner.expItems.weapon)) {
    list.push(cell(item.material, item.count, status.weaponExp ?? 'all'))
  }
  if (merged.mora > 0) {
    // What owned characters' passives take off weapon ascensions.
    const saved = owned
      ? requirements
          .map((r) => passiveDiscount(planner, r, owned))
          .filter((d) => d.character && d.mora > 0)
          .map((d) =>
            t('planner.cost.saves', {
              name: characterName(d.character!),
              mora: formatNumber(d.mora),
            }),
          )
          .join(' · ')
      : ''
    list.push({
      ...cell(planner.mora, merged.mora, status.mora ?? 'all', saved),
      icon: materialIcon('Mora'),
    })
  }
  return list
}

/** Tiles of each colour, for the legend. */
export function stockCounts(
  cells: readonly Pick<CostCell, 'status'>[],
): Record<StockStatus, number> {
  const counts: Record<StockStatus, number> = { all: 0, alone: 0, short: 0 }
  for (const c of cells) counts[c.status]++
  return counts
}
