import type { BannerRun, EventBanner } from './wish-history'

/**
 * Banner history (the Wishes page's second view, design "3" of the
 * new-features canvas): every event banner that has opened, by version,
 * newest first, each with the account's own run on it when there is one.
 */

export interface BannerHistoryRow {
  banner: EventBanner
  /** 1-based within its version (the game's "Phase 1 / 2"). */
  phase: number
  /** The account's pulls on it; null: none. */
  run: BannerRun | null
}

export interface BannerHistoryVersion {
  version: string
  rows: BannerHistoryRow[]
}

const runKey = (banner: EventBanner) => `${banner.start}:${banner.name}`

/**
 * One kind's banners (eventBanners' list, sorted by start) that opened by
 * `now` (UTC seconds; no banner not out yet), grouped by version, newest
 * first; `runs` laid on by start and name (they come from the same file).
 */
export function bannerHistory(
  banners: readonly EventBanner[],
  runs: readonly BannerRun[],
  now: number,
): BannerHistoryVersion[] {
  const byKey = new Map(runs.map((run) => [runKey(run.banner), run]))
  const phases = new Map<string, number>()
  const versions = new Map<string, BannerHistoryRow[]>()
  for (const banner of banners) {
    if (banner.start > now) continue
    // Phases are counted by start time: two banners opening together share one.
    const seenStarts = phases.get(banner.version) ?? 0
    const previous = versions.get(banner.version)?.at(-1)
    const phase =
      previous && previous.banner.start === banner.start ? previous.phase : seenStarts + 1
    phases.set(banner.version, phase)
    const rows = versions.get(banner.version) ?? []
    rows.push({ banner, phase, run: byKey.get(runKey(banner)) ?? null })
    versions.set(banner.version, rows)
  }
  return [...versions.entries()]
    .map(([version, rows]) => ({ version, rows: rows.reverse() }))
    .sort((a, b) => b.rows[0]!.banner.start - a.rows[0]!.banner.start)
}

/** Only the banners the account pulled on (versions left empty dropped). */
export function pulledOnly(versions: readonly BannerHistoryVersion[]): BannerHistoryVersion[] {
  return versions
    .map((v) => ({ ...v, rows: v.rows.filter((row) => row.run && row.run.pulls > 0) }))
    .filter((v) => v.rows.length > 0)
}

/** Banners featuring something whose name matches (`matches` gets each featured key). */
export function featuring(
  versions: readonly BannerHistoryVersion[],
  matches: (key: string) => boolean,
): BannerHistoryVersion[] {
  return versions
    .map((v) => ({
      ...v,
      rows: v.rows.filter((row) =>
        [...row.banner.featured5, ...row.banner.featured4].some(matches),
      ),
    }))
    .filter((v) => v.rows.length > 0)
}
