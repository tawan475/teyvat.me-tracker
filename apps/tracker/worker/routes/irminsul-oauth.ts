/**
 * "Sign in with the tracker" for irminsul, under /api/oauth (README "Sign in
 * from irminsul"; tokens: lib/irminsul-auth; rows: services/irminsul). An
 * authorization code flow with PKCE for a public desktop client answering on
 * a loopback port (RFC 8252):
 *
 * - `GET /irminsul`: discovery, absolute URLs from this request's origin; the
 *   sign-in page is the site's (`pageOrigin`) when asked on the old address.
 * - `POST /authorize` (the /link page: session cookie, CSRF header, an active
 *   session): the user's Allow, with the upload target they chose. Answers
 *   the loopback callback with a one-time code (60 s, stored hashed).
 *   Errors are the app's `{error:{code,message}}`: 400 `invalid_request`,
 *   `invalid_redirect`, `invalid_account`; 403 `account_suspended`.
 * - `POST /token` (irminsul; JSON or form-encoded): the code with its
 *   verifier, or a refresh token (rotated on every use). Errors are OAuth's
 *   `{error, error_description}`.
 * - `POST /revoke` (irminsul's Sign out): 200 whatever the token was.
 */

import {
  IRMINSUL_CLIENT_ID,
  callbackUrl,
  cleanDeviceName,
  isLoopbackRedirect,
  oauthAuthorizeRequest,
  type IrminsulDiscovery,
  type OAuthAuthorizeResponse,
} from '@gdt/shared'
import { Hono, type Context } from 'hono'
import type { AppEnv } from '../env'
import { pageOrigin } from '../lib/email'
import { ownOrigin } from '../lib/site'
import { ApiError, clientIp, rateLimit, validate } from '../lib/http'
import { requireActiveSession } from '../lib/session'
import { suspendedError } from './auth'
import {
  OAuthError,
  createCode,
  exchangeCode,
  refreshGrant,
  revokeRefreshToken,
} from '../services/irminsul'

/** A token or revoke request's fields, JSON or form-encoded (RFC 6749 uses the form). */
async function readParams(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  const type = c.req.header('content-type') ?? ''
  try {
    if (type.startsWith('application/json')) {
      const body: unknown = await c.req.json()
      if (body && typeof body === 'object' && !Array.isArray(body)) {
        return body as Record<string, unknown>
      }
    } else if (type.startsWith('application/x-www-form-urlencoded')) {
      const params = new URLSearchParams(new TextDecoder().decode(await c.req.arrayBuffer()))
      return Object.fromEntries(params)
    }
  } catch {
    // Unreadable: the same answer as a missing body.
  }
  throw new OAuthError(400, 'invalid_request', 'Send JSON or a form-encoded body')
}

/** The answer an OAuth error gets: never cached, like every token answer. */
function oauthFailure(c: Context<AppEnv>, error: unknown) {
  c.header('Cache-Control', 'no-store')
  c.header('Pragma', 'no-cache')
  if (error instanceof OAuthError) {
    return c.json({ error: error.error, error_description: error.message }, error.status)
  }
  if (error instanceof ApiError && error.status === 429) {
    return c.json({ error: 'rate_limited', error_description: error.message }, 429)
  }
  throw error
}

export const irminsulOAuth = new Hono<AppEnv>()
  .get('/irminsul', (c) => {
    const origin = ownOrigin(c.env, c.req.url)
    return c.json<IrminsulDiscovery>({
      authorize_url: `${pageOrigin(c.env, c.req.url)}/link`,
      token_url: `${origin}/api/oauth/token`,
      revoke_url: `${origin}/api/oauth/revoke`,
      client_id: IRMINSUL_CLIENT_ID,
      version: 1,
    })
  })

  .post('/authorize', requireActiveSession, async (c) => {
    const userId = c.get('userId')
    await rateLimit(c.env.AUTH_LIMITER, `irminsul-authorize:${userId}`)
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      throw new ApiError(400, 'invalid_request', 'Request body must be JSON')
    }
    const redirect = (body as { redirect_uri?: unknown } | null)?.redirect_uri
    if (!isLoopbackRedirect(redirect)) {
      throw new ApiError(400, 'invalid_redirect', 'Only an irminsul loopback callback is allowed')
    }
    const request = validate(oauthAuthorizeRequest, body)
    const device = cleanDeviceName(request.device) || 'PC'
    const outcome = await createCode(c.env.DB, userId, {
      challenge: request.code_challenge,
      redirectUri: request.redirect_uri,
      device,
      upload: request.upload,
    })
    if (!outcome.ok) {
      if (outcome.reason === 'suspended') throw suspendedError()
      if (outcome.reason === 'invalid_account') {
        throw new ApiError(400, 'invalid_account', 'That account is not yours', [
          { path: 'upload.account_id', message: 'Not your account' },
        ])
      }
      throw new ApiError(401, 'session_revoked', 'Session ended, sign in again')
    }
    c.header('Cache-Control', 'no-store')
    return c.json<OAuthAuthorizeResponse>({
      redirect: callbackUrl(request.redirect_uri, { code: outcome.code, state: request.state }),
    })
  })

  .post('/token', async (c) => {
    try {
      await rateLimit(c.env.AUTH_LIMITER, `irminsul-token:${clientIp(c)}`)
      const params = await readParams(c)
      if (params.client_id !== IRMINSUL_CLIENT_ID) {
        throw new OAuthError(400, 'invalid_request', 'Unknown client_id')
      }
      const answer =
        params.grant_type === 'authorization_code'
          ? await exchangeCode(c, {
              code: params.code,
              code_verifier: params.code_verifier,
              redirect_uri: params.redirect_uri,
              app: params.app,
            })
          : params.grant_type === 'refresh_token'
            ? await refreshGrant(c, params.refresh_token)
            : null
      if (!answer) {
        throw new OAuthError(
          400,
          typeof params.grant_type === 'string' ? 'unsupported_grant_type' : 'invalid_request',
          'grant_type must be authorization_code or refresh_token',
        )
      }
      c.header('Cache-Control', 'no-store')
      c.header('Pragma', 'no-cache')
      return c.json(answer)
    } catch (error) {
      return oauthFailure(c, error)
    }
  })

  .post('/revoke', async (c) => {
    try {
      await rateLimit(c.env.AUTH_LIMITER, `irminsul-token:${clientIp(c)}`)
      const params = await readParams(c)
      await revokeRefreshToken(c.env.DB, params.token)
    } catch (error) {
      // RFC 7009: the answer says nothing about the token; only throttling shows.
      if (error instanceof ApiError && error.status === 429) return oauthFailure(c, error)
      if (!(error instanceof OAuthError)) throw error
    }
    c.header('Cache-Control', 'no-store')
    return c.json({})
  })
