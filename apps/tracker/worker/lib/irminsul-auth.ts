/**
 * irminsul's tokens (README "Sign in from irminsul"). A world apart from the
 * browser's cookies, so neither can stand in for the other:
 *
 * - Access: an HS256 JWT with `typ: 'irminsul'` and `aud: 'irminsul'`
 *   (the browser's carry `typ: 'access'` and no audience), 15 minutes, sent as
 *   `Authorization: Bearer`. Only the /api/irminsul routes read that header,
 *   and they never read a cookie; the cookie routes never read the header.
 * - Refresh: opaque, `gdt_irt_<sid>_<random>`; only its SHA-256 is stored on
 *   the session row (`refresh_hash`), and every refresh replaces it. The
 *   sid in front lets a refresh find its row by primary key.
 *
 * Both name the session row (`user_sessions`, method `irminsul`): signing that
 * device out, "sign out other devices", a password change, a suspension or a
 * deleted user end it like any other device, and every Bearer request checks
 * the row in the same D1 round trip it reads what it needs anyway.
 */

import type { Context, MiddlewareHandler } from 'hono'
import { sign, verify } from 'hono/jwt'
import type { AppEnv } from '../env'
import { randomToken, sha256Hex } from './crypto'
import { ApiError } from './http'
import { jwtSecret } from './session'

const AUDIENCE = 'irminsul'
const TYP = 'irminsul'
const REFRESH_PREFIX = 'gdt_irt_'

export interface IrminsulClaims {
  userId: number
  sid: number
  /** The user's token version when the token was made. */
  ver: number
}

/** A 15-minute access token for this session. */
export async function mintAccessToken(
  c: Context<AppEnv>,
  claims: IrminsulClaims,
  now = Math.floor(Date.now() / 1000),
): Promise<string> {
  return sign(
    {
      sub: String(claims.userId),
      sid: claims.sid,
      ver: claims.ver,
      typ: TYP,
      aud: AUDIENCE,
      iat: now,
      exp: now + IRMINSUL_ACCESS_TTL_S,
    },
    jwtSecret(c),
    'HS256',
  )
}

/** A new refresh token for session `sid`, and the hash its row keeps. */
export async function newRefreshToken(sid: number): Promise<{ token: string; hash: string }> {
  const token = `${REFRESH_PREFIX}${sid}_${randomToken(32)}`
  return { token, hash: await sha256Hex(token) }
}

/** The session a refresh token names and the hash to look it up by; null for anything else. */
export async function readRefreshToken(
  token: unknown,
): Promise<{ sid: number; hash: string } | null> {
  if (typeof token !== 'string' || token.length > 128) return null
  const match = /^gdt_irt_([1-9]\d{0,15})_[A-Za-z0-9_-]{43}$/.exec(token)
  if (!match) return null
  const sid = Number(match[1])
  if (!Number.isSafeInteger(sid)) return null
  return { sid, hash: await sha256Hex(token) }
}

/**
 * Checks an irminsul access token: `expired` (also for a token this server
 * cannot verify any more, say after a secret rotation: a refresh mends both),
 * or its claims. Any other token (the browser's, garbage) is `invalid`.
 */
export async function readAccessToken(
  c: Context<AppEnv>,
  token: string,
): Promise<IrminsulClaims | 'expired' | 'invalid'> {
  let payload: Record<string, unknown>
  try {
    payload = await verify(token, jwtSecret(c), { alg: 'HS256', exp: false })
  } catch {
    return 'expired'
  }
  if (payload.typ !== TYP || payload.aud !== AUDIENCE) return 'invalid'
  const userId = Number(payload.sub)
  const { sid, ver, exp } = payload
  if (
    !Number.isSafeInteger(userId) ||
    typeof sid !== 'number' ||
    !Number.isSafeInteger(sid) ||
    typeof ver !== 'number' ||
    typeof exp !== 'number'
  ) {
    return 'invalid'
  }
  if (exp <= Math.floor(Date.now() / 1000)) return 'expired'
  return { userId, sid, ver }
}

/** `Authorization: Bearer <token>`, else null. */
export function bearerToken(c: Context<AppEnv>): string | null {
  const header = c.req.header('authorization')
  const match = header ? /^Bearer +([!-~]{1,2048})$/i.exec(header.trim()) : null
  return match ? match[1]! : null
}

/** The session ended (signed out, revoked, expired): irminsul signs out. */
/**
 * An irminsul access token's life: longer than a browser's (15 min) because every irminsul
 * route checks the session row in its own batch, so a sign-out or revoke still ends it at
 * once; a refresh is then a request every 2 hours, not every 15 minutes.
 */
export const IRMINSUL_ACCESS_TTL_S = 2 * 3600

export const irminsulSessionEnded = () =>
  new ApiError(401, 'session_revoked', 'Signed out, sign in again')

/**
 * Requires an irminsul access token (no D1 read; the route checks the
 * session row in its own batch): sets userId, sessionId and tokenVersion.
 * 401 `token_expired` → irminsul refreshes and retries once; 401
 * `unauthenticated` without a Bearer token (a browser's cookies are no
 * use here).
 */
export const requireIrminsul: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = bearerToken(c)
  if (!token) throw new ApiError(401, 'unauthenticated', 'Sign in from irminsul first')
  const claims = await readAccessToken(c, token)
  if (claims === 'expired') throw new ApiError(401, 'token_expired', 'Access token expired')
  if (claims === 'invalid') throw new ApiError(401, 'invalid_token', 'Not an irminsul token')
  c.set('userId', claims.userId)
  c.set('sessionId', claims.sid)
  c.set('tokenVersion', claims.ver)
  await next()
}
