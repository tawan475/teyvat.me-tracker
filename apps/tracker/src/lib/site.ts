import { SITE_ORIGIN } from '@/router/public-pages'

declare const __SITE_NAME__: string | undefined

/**
 * The site's name in browser tab titles and on the sign-in page ("Sign in to
 * <name>"): Teyvat.me, or a self-host's SITE_NAME as the build had it
 * (vite.config.ts `define`, build/site-origin.ts). The landing page, the footer
 * and the wordmark keep Teyvat.me (the user's rule, issue 12).
 */
export const SITE_NAME: string =
  typeof __SITE_NAME__ === 'string' && __SITE_NAME__ ? __SITE_NAME__ : 'Teyvat.me'

/** The host share cards name: teyvat.me, or a self-host's SITE_URL host. */
export const SITE_HOST: string = new URL(SITE_ORIGIN).host
