/**
 * `POST /api/wishes/fetch-page`: one page of the game's wish history API for
 * the website's "wish link" import (HoYoverse's API does not answer
 * browsers; paimon.moe proxies it the same way). Signed in, with the CSRF
 * header, 120 pages a minute per user. Signed out (guest mode,
 * docs/plans/open-site.md §4) only from this site's own pages: the CSRF
 * header and an `Origin` (and `Sec-Fetch-Site`, when sent) of this origin,
 * 120 pages a minute per IP. It is not a CORS proxy: no other site's page
 * can send either (the custom header needs a preflight this Worker never
 * allows), and nothing answers with CORS headers.
 *
 * Not an open proxy: the request is rebuilt from the pasted link's
 * credential alone (@gdt/shared wishApiUrl): one of the two API hosts, the
 * one path, only the parameters the API needs. The authkey in it is a
 * password while it lasts: never stored, never logged (errors name no URL).
 * The API's answer goes back as it is ({retcode, message, data}).
 */

import { parseWishLink, wishApiUrl, UIGF_GACHA_TYPES } from '@gdt/shared'
import { Hono, type MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import { z } from 'zod'
import type { AppEnv } from '../env'
import { ApiError, clientIp, parseJson, rateLimit } from '../lib/http'
import { CSRF_HEADER, requireUser } from '../lib/session'

const fetchPageRequest = z.object({
  url: z.string().min(1).max(16_384),
  gachaType: z
    .number()
    .int()
    .refine((n) => (UIGF_GACHA_TYPES as readonly number[]).includes(n), 'Not a banner type'),
  page: z.number().int().min(1).max(10_000),
  endId: z.string().regex(/^\d{1,19}$/),
})

/** How long the API may take. */
const UPSTREAM_TIMEOUT_MS = 10_000

/** The access cookie's name (lib/session.ts): its presence means a signed-in browser. */
const ACCESS_COOKIE = 'gdt_at'

/**
 * A signed-in user (their cookie, checked as everywhere), or a signed-out
 * page of this site (guest mode): the CSRF header and its own origin.
 */
const userOrOwnPage: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (getCookie(c, ACCESS_COOKIE)) return requireUser(c, next)
  if (c.req.header(CSRF_HEADER) !== '1') {
    throw new ApiError(403, 'csrf', `Missing ${CSRF_HEADER} header`)
  }
  const own = new URL(c.req.url).origin
  const site = c.req.header('sec-fetch-site')
  if (c.req.header('origin') !== own || (site !== undefined && site !== 'same-origin')) {
    throw new ApiError(403, 'not_this_site', 'Only this site may ask for wish history pages')
  }
  await next()
}

export const wishProxy = new Hono<AppEnv>().post('/fetch-page', userOrOwnPage, async (c) => {
  const body = await parseJson(c, fetchPageRequest)
  const link = parseWishLink(body.url)
  if (!link) {
    throw new ApiError(400, 'invalid_link', 'Not a wish history link (it has no authkey)')
  }
  const userId = (c.var as Partial<AppEnv['Variables']>).userId
  await rateLimit(
    c.env.WISH_PROXY_LIMITER,
    userId === undefined ? `wish-proxy:ip:${clientIp(c)}` : `wish-proxy:${userId}`,
  )
  const url = wishApiUrl(link, { gachaType: body.gachaType, page: body.page, endId: body.endId })
  let response: Response
  try {
    response = await fetch(url, {
      headers: { accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
  } catch (error) {
    // The error's text can carry the URL: log only its kind.
    console.warn('wish_proxy_failed', error instanceof Error ? error.name : 'unknown')
    throw new ApiError(502, 'upstream_unreachable', 'The wish history did not answer')
  }
  if (!response.ok) {
    console.warn('wish_proxy_status', response.status)
    throw new ApiError(502, 'upstream_status', `The wish history answered ${response.status}`)
  }
  let answer: unknown
  try {
    answer = await response.json()
  } catch {
    throw new ApiError(502, 'upstream_invalid', 'The wish history answered something else')
  }
  const shaped = answer as { retcode?: unknown; message?: unknown; data?: unknown }
  if (typeof shaped?.retcode !== 'number') {
    throw new ApiError(502, 'upstream_invalid', 'The wish history answered something else')
  }
  c.header('Cache-Control', 'no-store')
  return c.json({
    retcode: shaped.retcode,
    message: typeof shaped.message === 'string' ? shaped.message : '',
    data: shaped.data ?? null,
  })
})
