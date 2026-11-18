/** The production origin, what a build without SITE_URL is for. */
export const PRODUCTION_ORIGIN = 'https://teyvat.me'

/**
 * The origin the client build is for: SITE_URL's (a self-host sets it in
 * self-host/.env, and Compose passes it to the build), else teyvat.me. Canonical
 * links, /sitemap.xml and robots.txt's Sitemap line are built with it; the
 * Worker reads the same SITE_URL at run time (worker/lib/site.ts). A value
 * that is not an http(s) URL stops the build.
 */
export function buildSiteOrigin(value: string | undefined): string {
  if (!value?.trim()) return PRODUCTION_ORIGIN
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error(`SITE_URL is not a URL: ${value}`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`SITE_URL must be an http(s) address: ${value}`)
  }
  return url.origin
}

/** robots.txt for another origin than teyvat.me: its Sitemap line on that origin. */
export function robotsFor(robots: string, origin: string): string {
  return robots.replace(
    `Sitemap: ${PRODUCTION_ORIGIN}/sitemap.xml`,
    `Sitemap: ${origin}/sitemap.xml`,
  )
}

/** The production site name, what a build without SITE_NAME shows. */
export const PRODUCTION_NAME = 'Teyvat.me'

/**
 * The site name the client build shows in tab titles and on the sign-in page:
 * SITE_NAME (self-host/.env, passed by Compose like SITE_URL), else Teyvat.me.
 * The Worker reads the same SITE_NAME at run time (worker/lib/site.ts).
 */
export function buildSiteName(value: string | undefined): string {
  return value?.trim() || PRODUCTION_NAME
}
