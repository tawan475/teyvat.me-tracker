/**
 * The site's own address. teyvat.me runs with SITE_URL unset; a self-hosted
 * copy (self-host/README.md) sets it, and then it is the one origin for
 * everything that builds or checks the site's address: links in mails, OAuth
 * redirects, the human check's hostname, passkeys (the RP ID is its host),
 * Capture's discovery and device links, the same-origin checks of
 * /api/live and the wish relay, the OpenAPI server and the Web Push contact.
 *
 * A self-host never builds an address from the request: wrangler's local
 * mode hands the Worker a URL on the configured route's host (teyvat.me),
 * not the one the browser used, and a proxy's Host or X-Forwarded-* headers
 * are not trusted. With SITE_URL unset or https://teyvat.me, nothing changes.
 */

export interface SiteVars {
  /** The site's origin, e.g. https://tracker.example. */
  SITE_URL?: string
  /** A self-host's name in mails (self-host/README.md); default Teyvat.me. */
  SITE_NAME?: string
}

/** The production origin. */
export const SITE_ORIGIN = 'https://teyvat.me'

/** The production name. */
export const SITE_NAME = 'Teyvat.me'

/** The site's name in mails: a self-host's SITE_NAME, else Teyvat.me. */
export function siteName(vars: object): string {
  return (vars as SiteVars).SITE_NAME?.trim() || SITE_NAME
}

/** A URL's origin when it is http(s), else null. */
export function originOf(url: string | undefined): string | null {
  if (!url) return null
  try {
    const { origin, protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:' ? origin : null
  } catch {
    return null
  }
}

/**
 * SITE_URL's origin when it names another site than teyvat.me (a self-host),
 * else null: teyvat.me keeps every rule it had before SITE_URL meant this.
 */
export function configuredOrigin(vars: object): string | null {
  const site = originOf((vars as SiteVars).SITE_URL)
  return site && site !== SITE_ORIGIN ? site : null
}

/** This site's origin for a request: a self-host's SITE_URL, else the request's own. */
export function ownOrigin(vars: object, requestUrl: string): string {
  return configuredOrigin(vars) ?? new URL(requestUrl).origin
}
