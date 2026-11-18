import { SITE_ORIGIN } from '@/router/public-pages'

declare const __SITE_NAME__: string | undefined

/**
 * The site's name in browser tab titles and on the sign-in page ("Sign in to
 * <name>"): Teyvat.me, or a self-host's SITE_NAME as the build had it
 * (vite.config.ts `define`, build/site-origin.ts). Nowhere else: the landing
 * page, the footer, the wordmark, the sign-up line, the passkey's name and the
 * web manifest keep Teyvat.me (the user's rule, issue 12; site-name.test.ts
 * keeps it so).
 */
export const SITE_NAME: string =
  typeof __SITE_NAME__ === 'string' && __SITE_NAME__ ? __SITE_NAME__ : 'Teyvat.me'

/** An origin's host as share cards print it (a port stays: localhost:8787). */
export function hostOf(origin: string): string {
  return new URL(origin).host
}

/** The host share cards name: teyvat.me, or a self-host's SITE_URL host. */
export const SITE_HOST: string = hostOf(SITE_ORIGIN)
