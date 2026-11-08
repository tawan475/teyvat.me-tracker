/**
 * Tracking values other sites add to links into ours (Facebook's `fbclid`,
 * Google's `gclid`, every `utm_*`…). The site reads none of them, and left in
 * the address bar they travel on whenever someone copies the link, and every
 * page that rewrites its own query keeps them. They are dropped from the
 * address before the app starts (lib/strip-tracking.ts). Pure.
 *
 * The analytics plan (docs/plans/analytics.md) may later want where a visit
 * came from (`utm_source`): read it there, before the strip, never send the
 * click ids.
 */

/** Click ids and campaign tags by exact name (lowercase). */
export const TRACKING_PARAMS: ReadonlySet<string> = new Set([
  'fbclid', // Facebook, Instagram, Messenger
  'gclid', // Google Ads
  'gbraid',
  'wbraid',
  'dclid', // Google Display
  'gad_source',
  'msclkid', // Microsoft Ads
  'igshid', // Instagram shares
  'igsh',
  'ttclid', // TikTok
  'twclid', // X (Twitter)
  'yclid', // Yandex
  'mc_cid', // Mailchimp
  'mc_eid',
  '_ga', // Google Analytics cross-site
  '_gl',
  'li_fat_id', // LinkedIn
  'srsltid', // Google Merchant
])

/** Whether a query key is one of them (`utm_` tags by prefix). */
export function isTrackingParam(key: string): boolean {
  const name = key.toLowerCase()
  return name.startsWith('utm_') || TRACKING_PARAMS.has(name)
}

/**
 * `search` (a URL's `?…`, or '') without the tracking values, every other
 * value kept as written and in order; null when there were none to drop.
 */
export function withoutTracking(search: string): string | null {
  if (!search || search === '?') return null
  const parts = search.replace(/^\?/, '').split('&')
  const kept = parts.filter((part) => {
    if (!part) return false
    const key = part.split('=', 1)[0]!
    let name = key
    try {
      name = decodeURIComponent(key.replace(/\+/g, ' '))
    } catch {
      // A malformed escape: judge the key as written.
    }
    return !isTrackingParam(name)
  })
  if (kept.length === parts.filter(Boolean).length) return null
  return kept.length > 0 ? `?${kept.join('&')}` : ''
}
