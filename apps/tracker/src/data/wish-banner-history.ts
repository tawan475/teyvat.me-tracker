import type { BannerRun, EventBanner } from './wish-history'

/**
 * Banner history (the Wishes page's second view, design "3" of the
 * new-features canvas): every event banner in the file, by version, newest
 * first, each with the account's own run on it when there is one. Banners
 * not open yet are listed too (the user, 2026-11-07: people like to see
 * what's coming; the view marks them "upcoming").
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
 * One kind's banners (eventBanners' list, sorted by start), grouped by
 * version, newest first; `runs` laid on by start and name (they come from
 * the same file).
 *
 * A phase is the version's nth opening time over every kind of banner
 * (`all`, default this kind's own): a Chronicled Wish that runs only in a
 * version's second phase is Phase 2, not the first of its kind (it read
 * "Phase 1" on 7.2's, the user 2026-11-24).
 */
export function bannerHistory(
  banners: readonly EventBanner[],
  runs: readonly BannerRun[],
  all: readonly EventBanner[] = banners,
): BannerHistoryVersion[] {
  const byKey = new Map(runs.map((run) => [runKey(run.banner), run]))
  const starts = new Map<string, number[]>()
  for (const banner of all) {
    const list = starts.get(banner.version) ?? []
    if (!list.includes(banner.start)) list.push(banner.start)
    starts.set(banner.version, list)
  }
  for (const list of starts.values()) list.sort((a, b) => a - b)
  const versions = new Map<string, BannerHistoryRow[]>()
  for (const banner of banners) {
    // Two banners opening together share one phase.
    const phase = (starts.get(banner.version)?.indexOf(banner.start) ?? 0) + 1
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

/** Banners are announced about a week before they open (the version's Special Program). */
export const ANNOUNCED_DAYS = 7

/**
 * Time travel: the banners known at `now` (Unix s): those opening within
 * ANNOUNCED_DAYS, not the ones still months away then.
 */
export function announcedBy(
  versions: readonly BannerHistoryVersion[],
  now: number,
): BannerHistoryVersion[] {
  const last = now + ANNOUNCED_DAYS * 86_400
  return versions
    .map((v) => ({ ...v, rows: v.rows.filter((row) => row.banner.start <= last) }))
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
