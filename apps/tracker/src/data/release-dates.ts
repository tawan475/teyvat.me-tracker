/**
 * When characters and weapons came out, for time travel: a page shown in
 * the past lists only what was released by then (the "Don't have" lists).
 * The date is the first banner that featured it (wish-banners.json, the
 * game's own banner clock); what was never on a banner (the standard pool,
 * gifts) counts as always out.
 */

import { eventBanners, type BannerFile } from './wish-history'

/** Key -> first banner start (Unix ms). Pure. */
export function releaseDates(file: BannerFile): Map<string, number> {
  const out = new Map<string, number>()
  // The banner clock is UTC+8 for both servers' first banners.
  for (const banners of eventBanners(file, 8).values()) {
    for (const banner of banners) {
      for (const key of [...banner.featured5, ...banner.featured4]) {
        const at = banner.start * 1000
        const known = out.get(key)
        if (known === undefined || at < known) out.set(key, at)
      }
    }
  }
  return out
}

/** `keys` released by `at` (ms). Pure. */
export function releasedKeys(
  keys: readonly string[],
  dates: ReadonlyMap<string, number>,
  at: number,
): string[] {
  return keys.filter((key) => (dates.get(key) ?? 0) <= at)
}

let loaded: Promise<Map<string, number>> | null = null

/** The release dates, loaded once (the banner file is a lazy chunk). */
export function loadReleaseDates(): Promise<Map<string, number>> {
  loaded ??= import('./wish-banners.json')
    .then((m) => releaseDates(m.default as unknown as BannerFile))
    .catch((error: unknown) => {
      loaded = null
      throw error
    })
  return loaded
}
