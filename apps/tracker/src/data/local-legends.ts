import type { EnemyNames, EnemyStats, LocalLegend, StatsAt } from '@gdt/game-data/enemies'

/** One Local Legend as its card shows it. */
export interface LegendRow {
  legend: LocalLegend
  name: string
  subtitle: string
  description: string
  /** Each monster's HP alone at the level, cut to a whole number like the game. */
  hp: number[]
  /** Its defeat achievement done; null when it has none (Luna I on). */
  defeated: boolean | null
  /** Its achievements done of all (the Natlan ones have three); null without any. */
  goals: { done: number; total: number } | null
}

/** A Local Legend as the enemy dialog shows it. */
export interface LegendView {
  id: number
  name: string
  subtitle: string
  description: string
  members: { icon: string; stats: EnemyStats }[]
}

export interface LegendSection {
  /** CityConfigData id. */
  region: number
  rows: LegendRow[]
}

/**
 * The Local Legends in the data's order (the wiki's, by region), grouped by
 * region in the order regions first appear; HP at `level`, defeated from the
 * achievements (`done`).
 */
export function legendSections(
  legends: readonly LocalLegend[],
  names: Pick<EnemyNames, 'legend'>,
  statsAt: (s: EnemyStats, level: number) => StatsAt,
  level: number,
  done: (achievement: number) => boolean,
): LegendSection[] {
  const sections: LegendSection[] = []
  for (const legend of legends) {
    const text = names.legend(legend.id)
    const goals = legend.achievements.length
      ? { done: legend.achievements.filter(done).length, total: legend.achievements.length }
      : null
    const row: LegendRow = {
      legend,
      ...text,
      hp: legend.monsters.map((m) => Math.floor(statsAt(m, level).hp[0]! + 1e-6)),
      defeated: legend.achievements.length ? done(legend.achievements[0]!) : null,
      goals,
    }
    const section = sections.find((s) => s.region === legend.region)
    if (section) section.rows.push(row)
    else sections.push({ region: legend.region, rows: [row] })
  }
  return sections
}

/** Matches a search on the name or subtitle, any case. */
export const matchesLegend = (row: LegendRow, query: string) => {
  const q = query.trim().toLocaleLowerCase()
  return (
    !q || row.name.toLocaleLowerCase().includes(q) || row.subtitle.toLocaleLowerCase().includes(q)
  )
}
