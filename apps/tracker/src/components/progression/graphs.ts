/**
 * The progression card's graphs (the Graphs dialog, design 1A + 2B of
 * 2026-11-08): which figure each shows, in what order, its y axis (from the
 * lowest value or 0 or a number, to the highest value, the game's bag limit
 * or a number) and whether its delta graph is drawn under it. Stored in the
 * user's settings (every device; this browser only while signed out). Pure.
 */

import { MAX_PROGRESSION_GRAPHS, type ProgressionGraph } from '@gdt/shared/settings'
import { FIGURE_KEYS, type FigureKey } from './progression-series'

export { MAX_PROGRESSION_GRAPHS }

/** A stored graph whose figure this build knows. */
export interface Graph extends ProgressionGraph {
  figure: FigureKey
}

/**
 * What the game's bag holds of a figure (the in-game "Artifacts 1965/2700";
 * weapons 2,000). The game refuses pickups past it, so a count never exceeds it.
 */
export const BAG_LIMITS: Partial<Record<FigureKey, number>> = {
  artifacts: 2_700,
  weapons: 2_000,
}

/** The card's graphs until the user sets some (as before the dialog: mora and primogems). */
export const DEFAULT_GRAPHS: readonly Graph[] = [
  { figure: 'mora', from: 'auto', to: 'auto', delta: true },
  { figure: 'primogem', from: 'auto', to: 'auto', delta: true },
]

const isFigure = (key: string): key is FigureKey => (FIGURE_KEYS as readonly string[]).includes(key)

/** A new graph of `figure`: a figure with a bag limit runs from 0 to it. */
export function newGraph(figure: FigureKey): Graph {
  const bag = BAG_LIMITS[figure] !== undefined
  return { figure, from: bag ? 'zero' : 'auto', to: bag ? 'bag' : 'auto', delta: true }
}

/**
 * The stored graphs this build can draw: figures it doesn't know are left
 * out (a newer build may add some), a bag limit on a figure without one
 * reads Auto. Nothing stored, or nothing left: null.
 */
export function knownGraphs(
  stored: readonly ProgressionGraph[] | null | undefined,
): Graph[] | null {
  if (!stored) return null
  const graphs = stored.flatMap((graph): Graph[] => {
    if (!isFigure(graph.figure)) return []
    const to = graph.to === 'bag' && BAG_LIMITS[graph.figure] === undefined ? 'auto' : graph.to
    return [{ figure: graph.figure, from: graph.from, to, delta: graph.delta }]
  })
  return graphs.length > 0 ? graphs.slice(0, MAX_PROGRESSION_GRAPHS) : null
}

/**
 * The figures this browser picked on the card before the dialog
 * (`overview-progression-figures`, comma separated), as graphs: what a
 * signed-out page, or an account that has saved none yet, starts from.
 */
export function legacyGraphs(stored: string | null): Graph[] | null {
  const figures = (stored ?? '').split(',').filter(isFigure)
  return figures.length > 0
    ? figures.map((figure) => ({ figure, from: 'auto', to: 'auto', delta: true }))
    : null
}

/** The bag limit a graph's y axis ends at, or null. */
export function bagLimit(graph: Graph): number | null {
  return graph.to === 'bag' ? (BAG_LIMITS[graph.figure] ?? null) : null
}

/**
 * The y axis's fixed ends (undefined: fit to the values). An end that would
 * leave no room (a top at or under the bottom) is dropped.
 */
export function yBounds(graph: Graph): { min?: number; max?: number } {
  const min = graph.from === 'zero' ? 0 : typeof graph.from === 'number' ? graph.from : undefined
  const max =
    graph.to === 'bag'
      ? (BAG_LIMITS[graph.figure] ?? undefined)
      : typeof graph.to === 'number'
        ? graph.to
        : undefined
  if (min !== undefined && max !== undefined && max <= min) return { min }
  return { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) }
}

/** The graphs as stored: the defaults store as null (so a later change of defaults reaches them). */
export function toStored(graphs: readonly Graph[]): ProgressionGraph[] | null {
  const same =
    graphs.length === DEFAULT_GRAPHS.length &&
    graphs.every((graph, i) => {
      const d = DEFAULT_GRAPHS[i]!
      return (
        graph.figure === d.figure &&
        graph.from === d.from &&
        graph.to === d.to &&
        graph.delta === d.delta
      )
    })
  return same ? null : graphs.map(({ figure, from, to, delta }) => ({ figure, from, to, delta }))
}

/** Moves the graph at `from` to `to` (both clamped), returning a new list. */
export function moveGraph<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list]
  if (from < 0 || from >= next.length) return next
  const [item] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item!)
  return next
}
