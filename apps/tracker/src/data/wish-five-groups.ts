import { formatWishTime } from '@gdt/shared'
import type { BannerRun, EventBanner, PullRow } from './wish-history'

/**
 * "Every 5★" in groups (the user's pick of the Every 5★ designs, E): newest
 * first, one group per banner run the 5★ came from (event banners), else
 * per month on the game's clock (standard, beginners'), each 5★ numbered
 * by its place among all of the banner's (the newest is the highest), so
 * the order reads without guessing whether the next one is right or down.
 */
export interface FiveGroup {
  key: string
  /** The event banner run; null for a month group. */
  banner: EventBanner | null
  run: BannerRun | null
  /** "2026-10", for a month group. */
  month: string | null
  fives: { row: PullRow; number: number }[]
}

/** `fives`: newest first (BannerStats.fives); `runs`: BannerStats.runs. */
export function fiveGroups(fives: readonly PullRow[], runs: readonly BannerRun[]): FiveGroup[] {
  const runOf = new Map(runs.map((run) => [run.banner, run]))
  const groups: FiveGroup[] = []
  fives.forEach((row, i) => {
    const month = row.on ? null : formatWishTime(row.pull.time).slice(0, 7)
    const key = row.on ? `run:${row.on.start}:${row.on.name}` : `month:${month}`
    let group = groups.at(-1)
    if (!group || group.key !== key) {
      group = {
        key,
        banner: row.on,
        run: row.on ? (runOf.get(row.on) ?? null) : null,
        month,
        fives: [],
      }
      groups.push(group)
    }
    group.fives.push({ row, number: fives.length - i })
  })
  return groups
}
