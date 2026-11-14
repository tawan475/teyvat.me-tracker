/**
 * Cookie sessions. Both tokens are HS256 JWTs with a `typ` claim, so neither
 * can stand in for the other.
 *
 * - Access: 15 minutes in `gdt_at` (path /api). Verifying it needs no
 *   database read, so ordinary requests cost nothing for auth.
 * - Refresh: 30 days in `gdt_rt` (path /api/auth, SameSite Strict).
 * - Both carry `sid`, this device's row in `user_sessions` (one per sign-in:
 *   how, from where, last seen), and the user's `token_version`. A refresh is
 *   one UPDATE of that row: it must be active (not revoked, not expired) and
 *   the version current; it slides the row's expiry and records where the
 *   device is now, then reissues both tokens.
 * - Signing one device out revokes its row: its refresh fails at once, the
 *   routes behind `requireActiveSession` (password, profile, sessions,
 *   identities, import keys) refuse it, and its live socket is closed. Its
 *   access token still reads data for at most 15 minutes. Bumping the version
 *   (sign out everywhere, a password change) ends every session at once,
 *   devices without a row included.
 * - Tokens from before rows existed (no `sid`) get one `legacy` row at their
 *   next refresh; see LEGACY_CUTOFF_S.
 *
 * Both cookies are HttpOnly: page scripts never see a token. Cookie-authed
 * requests that change state must also send `x-gdt-csrf: 1`; a cross-site page
 * cannot add a custom header without a CORS preflight, which this API never
 * grants.
 */

import type { SessionMethod } from '@gdt/shared'
import { and, eq, isNull, ne, sql } from 'drizzle-orm'
import type { Context, MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { sign, verify } from 'hono/jwt'
import type { JWTPayload } from 'hono/utils/jwt/types'
import { getDb } from '../db/client'
import { userSessions, users } from '../db/schema'
import type { AppEnv } from '../env'
import { revokeLive, revokeLiveSession } from '../services/live'
import { ApiError } from './http'
import { internalCaller } from './internal'

const ACCESS_COOKIE = 'gdt_at'
const REFRESH_COOKIE = 'gdt_rt'
/**
 * Not a credential: a readable "this browser has a session" flag, so the app
 * can skip asking /api/auth/me (and refreshing) for visitors who never signed
 * in. Its absence only means "don't bother asking"; the server never trusts it.
 */
const HINT_COOKIE = 'gdt_s'
export const ACCESS_TTL_S = 15 * 60
export const REFRESH_TTL_S = 30 * 24 * 60 * 60

/** Active sessions per user: signing in past it ends the least recently seen. */
export const MAX_SESSIONS = 30
/** A refresh writes `users.last_active_at` at most this often. */
const ACTIVE_STAMP_MS = 60 * 60 * 1000

/**
 * Refresh tokens without a `sid` were issued before session rows existed
 * (every device signed in when this shipped). One gets a `legacy` row at its
 * next refresh, unless issued after this moment: by then the Worker only
 * issues tokens with a `sid`, so a newer one without is refused. Every token
 * the old Worker issued has expired 30 days after this; delete
 * `adoptLegacySession` and this constant after 2026-11-20.
 */
export const LEGACY_CUTOFF_S = Date.UTC(2026, 9, 20) / 1000

export const CSRF_HEADER = 'x-gdt-csrf'

type TokenType = 'access' | 'refresh'

/** Who a session token is for. */
export interface SessionUser {
  id: number
  tokenVersion: number
}

export function jwtSecret(c: Context<AppEnv>): string {
  const secret = c.env.JWT_SECRET
  if (!secret || secret.length < 32) {
    throw new ApiError(500, 'misconfigured', 'Server is missing JWT_SECRET')
  }
  return secret
}

/**
 * The verified payload of a cookie token of this type, or null. `stale`:
 * an expired token still counts (its signature is checked all the same).
 */
async function readToken(
  c: Context<AppEnv>,
  cookie: string,
  typ: TokenType,
  stale = false,
): Promise<JWTPayload | null> {
  const token = getCookie(c, cookie)
  if (!token) return null
  const secret = jwtSecret(c)
  try {
    const payload = await verify(token, secret, stale ? { alg: 'HS256', exp: false } : 'HS256')
    return payload.typ === typ ? payload : null
  } catch {
    return null
  }
}

interface Claims {
  userId: number
  /** Null in a token issued before tokens carried it. */
  ver: number | null
  /** Null in a token issued before session rows. */
  sid: number | null
}

function claimsOf(payload: JWTPayload): Claims {
  const sid = payload.sid
  return {
    userId: Number(payload.sub),
    ver: typeof payload.ver === 'number' ? payload.ver : null,
    sid: typeof sid === 'number' && Number.isSafeInteger(sid) && sid > 0 ? sid : null,
  }
}

const text = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null

/** Where a request comes from, as a session row keeps it (`request.cf` is absent in dev). */
export function requestOrigin(c: Context<AppEnv>) {
  const cf = c.req.raw.cf as { country?: unknown; city?: unknown } | undefined
  return {
    ip: text(c.req.header('cf-connecting-ip'), 64),
    userAgent: text(c.req.header('user-agent'), 256),
    country: text(cf?.country, 8),
    city: text(cf?.city, 100),
  }
}

const nowSeconds = () => Math.floor(Date.now() / 1000)

/** Sets fresh access and refresh cookies for this session, issued at `now` (seconds). */
async function mint(c: Context<AppEnv>, user: SessionUser, sid: number, now: number) {
  const secret = jwtSecret(c)
  // `ver` and `sid` let a live socket opened with the token be ended with the session.
  const claims = { sub: String(user.id), ver: user.tokenVersion, sid, iat: now }
  const [access, refresh] = await Promise.all([
    sign({ ...claims, typ: 'access', exp: now + ACCESS_TTL_S }, secret, 'HS256'),
    sign({ ...claims, typ: 'refresh', exp: now + REFRESH_TTL_S }, secret, 'HS256'),
  ])
  setCookie(c, ACCESS_COOKIE, access, {
    path: '/api',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: ACCESS_TTL_S,
  })
  setCookie(c, REFRESH_COOKIE, refresh, {
    path: '/api/auth',
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    maxAge: REFRESH_TTL_S,
  })
  setCookie(c, HINT_COOKIE, '1', {
    path: '/',
    secure: true,
    sameSite: 'Lax',
    maxAge: REFRESH_TTL_S,
  })
}

/**
 * New tokens for a session that already has its row (a refresh, a renewal
 * before an OAuth link, this device after a password change).
 */
export async function issueTokens(
  c: Context<AppEnv>,
  user: SessionUser,
  sid: number,
): Promise<void> {
  await mint(c, user, sid, nowSeconds())
}

/**
 * The session this browser's cookies name: the refresh token's, else the
 * access token's. Signatures are checked, expiry is not (a stale token still
 * names its row). Null without one, or for a token from before session rows.
 */
export async function browserSession(
  c: Context<AppEnv>,
): Promise<{ userId: number; sid: number } | null> {
  for (const [cookie, typ] of [
    [REFRESH_COOKIE, 'refresh'],
    [ACCESS_COOKIE, 'access'],
  ] as const) {
    const payload = await readToken(c, cookie, typ, true)
    if (!payload) continue
    const { userId, sid } = claimsOf(payload)
    if (sid !== null && Number.isSafeInteger(userId)) return { userId, sid }
  }
  return null
}

/**
 * Signs a user in on this device: a session row (how, from where) and its
 * cookies. In the same batch, a session this browser still held is ended
 * (its row would otherwise linger as a device that is gone) and past
 * MAX_SESSIONS the user's least recently seen sessions end. Returns the sid.
 */
export async function createSession(
  c: Context<AppEnv>,
  user: SessionUser,
  method: SessionMethod,
): Promise<number> {
  const at = Date.now()
  const now = Math.floor(at / 1000)
  const origin = requestOrigin(c)
  const previous = await browserSession(c)
  const d1 = c.env.DB
  const statements = [
    // First, so the cap below no longer counts it.
    previous
      ? endSessionStatement(d1, previous.userId, previous.sid, at)
      : d1.prepare('SELECT NULL AS live_since WHERE 0'),
    d1
      .prepare(
        `INSERT INTO user_sessions (user_id, method, user_agent, ip, created_ip, country, city,
           created_at, last_seen_at, expires_at)
         VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6, ?7, ?7, ?8) RETURNING id`,
      )
      .bind(
        user.id,
        method,
        origin.userAgent,
        origin.ip,
        origin.country,
        origin.city,
        at,
        (now + REFRESH_TTL_S) * 1000,
      ),
    pruneSessionsStatement(d1, user.id, at),
    d1
      .prepare('UPDATE users SET last_active_at = ?2 WHERE id = ?1 RETURNING live_since')
      .bind(user.id, at),
  ]
  const [ended, inserted, pruned, stamped] = await d1.batch<{
    id?: number
    live_since?: number | null
  }>(statements)
  const sid = inserted!.results[0]?.id
  if (typeof sid !== 'number') throw new Error('session row missing after insert')

  // Sockets of the sessions that just ended, if anyone listens (rare: only
  // past the cap, or signing in again over a session in this browser).
  const endedLive: Promise<void>[] = []
  if (stamped!.results[0]?.live_since != null) {
    for (const row of pruned!.results) endedLive.push(revokeLiveSession(c.env, user.id, row.id!))
  }
  if (previous && ended!.results[0]?.live_since != null) {
    endedLive.push(revokeLiveSession(c.env, previous.userId, previous.sid))
  }
  await Promise.all(endedLive)
  await mint(c, user, sid, now)
  return sid
}

/**
 * Ends the user's least recently seen sessions past MAX_SESSIONS (in the
 * batch that adds one, after its INSERT); answers each ended row's id.
 */
export function pruneSessionsStatement(d1: D1Database, userId: number, at: number) {
  return d1
    .prepare(
      `UPDATE user_sessions SET revoked_at = ?2
       WHERE user_id = ?1 AND revoked_at IS NULL AND expires_at > ?2 AND id NOT IN (
         SELECT id FROM user_sessions WHERE user_id = ?1 AND revoked_at IS NULL AND expires_at > ?2
         ORDER BY last_seen_at DESC, id DESC LIMIT ?3)
       RETURNING id`,
    )
    .bind(userId, at, MAX_SESSIONS)
}

/** Revokes one active session row; answers the user's `live_since` when it did. */
function endSessionStatement(d1: D1Database, userId: number, sid: number, at: number) {
  return d1
    .prepare(
      `UPDATE user_sessions SET revoked_at = ?3
       WHERE id = ?1 AND user_id = ?2 AND revoked_at IS NULL
       RETURNING (SELECT live_since FROM users WHERE id = ?2) AS live_since`,
    )
    .bind(sid, userId, at)
}

/**
 * Ends one session of the user: its row, and its live sockets (awaited, like
 * revokeAllSessions). False when the user has no such session still open.
 */
export async function endSession(env: Env, userId: number, sid: number): Promise<boolean> {
  const row = await endSessionStatement(env.DB, userId, sid, Date.now()).first<{
    live_since: number | null
  }>()
  if (!row) return false
  if (row.live_since !== null) await revokeLiveSession(env, userId, sid)
  return true
}

export function clearSessionCookies(c: Context<AppEnv>): void {
  deleteCookie(c, ACCESS_COOKIE, { path: '/api', secure: true })
  deleteCookie(c, REFRESH_COOKIE, { path: '/api/auth', secure: true })
  deleteCookie(c, HINT_COOKIE, { path: '/', secure: true })
}

const sessionEnded = () => new ApiError(401, 'session_revoked', 'Session ended, sign in again')

/** What a refresh learns from the session row it slid. */
interface Slid {
  id: number
  last_active_at: number | null
  /** Staff suspended the user (their sessions were ended then; this catches any left). */
  suspended_at: number | null
}

/**
 * The SET part of a refresh: seen now, expiring with the new refresh token,
 * from where the request came (the place only when the request has one).
 */
const SLIDE_SET = `last_seen_at = ?4, expires_at = ?5, ip = coalesce(?6, ip),
  user_agent = coalesce(?7, user_agent),
  country = CASE WHEN ?8 IS NULL THEN country ELSE ?8 END,
  city = CASE WHEN ?8 IS NULL THEN city ELSE ?9 END`

/**
 * Exchanges a valid refresh cookie for new tokens: one UPDATE of the
 * session row, which must be active and of the user's current token
 * version. Refused (401 `session_revoked`, cookies cleared) otherwise.
 */
export async function refreshSession(c: Context<AppEnv>): Promise<void> {
  if (!getCookie(c, REFRESH_COOKIE)) throw new ApiError(401, 'unauthenticated', 'Not signed in')
  const payload = await readToken(c, REFRESH_COOKIE, 'refresh')
  if (!payload) {
    clearSessionCookies(c)
    throw new ApiError(401, 'session_expired', 'Session expired, sign in again')
  }
  const { userId, ver, sid } = claimsOf(payload)
  const at = Date.now()
  const now = Math.floor(at / 1000)
  const origin = requestOrigin(c)
  const binds = [
    at,
    (now + REFRESH_TTL_S) * 1000,
    origin.ip,
    origin.userAgent,
    origin.country,
    origin.city,
  ]
  let row: Slid | null = null
  if (ver !== null && Number.isSafeInteger(userId)) {
    row =
      sid === null
        ? await adoptLegacySession(c, userId, ver, payload.iat, binds)
        : await c.env.DB.prepare(
            `UPDATE user_sessions SET ${SLIDE_SET}
             WHERE id = ?1 AND user_id = ?2 AND revoked_at IS NULL AND expires_at > ?4
               AND (SELECT token_version FROM users WHERE id = ?2) = ?3
             RETURNING id, (SELECT last_active_at FROM users WHERE id = ?2) AS last_active_at,
               (SELECT suspended_at FROM users WHERE id = ?2) AS suspended_at`,
          )
            .bind(sid, userId, ver, ...binds)
            .first<Slid>()
  }
  if (!row) {
    clearSessionCookies(c)
    throw sessionEnded()
  }
  if (row.suspended_at !== null) {
    clearSessionCookies(c)
    throw new ApiError(403, 'account_suspended', 'This account is suspended')
  }
  if (row.last_active_at === null || row.last_active_at <= at - ACTIVE_STAMP_MS) {
    // After the response: only "active lately" for staff, never worth a wait.
    const stamp = c.env.DB.prepare('UPDATE users SET last_active_at = ?2 WHERE id = ?1')
      .bind(userId, at)
      .run()
      .catch((error: unknown) => console.warn('last_active_failed', String(error)))
    try {
      c.executionCtx.waitUntil(stamp)
    } catch {
      // No execution context (a direct app.fetch): the write still runs.
    }
  }
  await mint(c, { id: userId, tokenVersion: ver! }, row.id, now)
}

/**
 * A refresh token from before session rows: one `legacy` row for it, the
 * same one for every tab that refreshes it (keyed by user, user agent and
 * the token's issue time), then a refresh like any other. Legacy path:
 * delete after 2026-11-20 (see LEGACY_CUTOFF_S).
 */
async function adoptLegacySession(
  c: Context<AppEnv>,
  userId: number,
  ver: number,
  iat: unknown,
  binds: unknown[],
): Promise<Slid | null> {
  if (typeof iat !== 'number' || !(iat <= LEGACY_CUTOFF_S)) return null
  const d1 = c.env.DB
  const createdAt = iat * 1000
  // ?1 created_at, ?2 user, ?3 version, ?4… as SLIDE_SET.
  const [, slid] = await d1.batch<Slid>([
    d1
      .prepare(
        `INSERT INTO user_sessions (user_id, method, user_agent, ip, created_ip, country, city,
           created_at, last_seen_at, expires_at)
         SELECT ?2, 'legacy', ?7, ?6, ?6, ?8, ?9, ?1, ?4, ?5
         WHERE (SELECT token_version FROM users WHERE id = ?2) = ?3
           AND NOT EXISTS (SELECT 1 FROM user_sessions WHERE user_id = ?2 AND method = 'legacy'
             AND user_agent IS ?7 AND created_at = ?1)`,
      )
      .bind(createdAt, userId, ver, ...binds),
    d1
      .prepare(
        `UPDATE user_sessions SET ${SLIDE_SET}
         WHERE user_id = ?2 AND method = 'legacy' AND user_agent IS ?7 AND created_at = ?1
           AND revoked_at IS NULL AND expires_at > ?4
           AND (SELECT token_version FROM users WHERE id = ?2) = ?3
         RETURNING id, (SELECT last_active_at FROM users WHERE id = ?2) AS last_active_at,
           (SELECT suspended_at FROM users WHERE id = ?2) AS suspended_at`,
      )
      .bind(createdAt, userId, ver, ...binds),
  ])
  return slid?.results[0] ?? null
}

/**
 * Ends every session of the user, on all devices (but `keep`, this device's
 * when it stays signed in): bumps the token version, which also ends devices
 * without a row, marks the rows revoked, and closes their live sockets
 * (awaited: a socket must not outlive its session). Returns the user with the
 * new version: a kept session needs new tokens (`issueTokens`).
 */
export async function revokeAllSessions(
  c: Context<AppEnv>,
  userId: number,
  options: { set?: Partial<typeof users.$inferInsert>; keep?: number | null } = {},
): Promise<SessionUser> {
  const db = getDb(c.env.DB)
  const keep = options.keep ?? null
  const [[user]] = await db.batch([
    db
      .update(users)
      .set({ ...options.set, tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.id, userId))
      .returning({ id: users.id, tokenVersion: users.tokenVersion, liveSince: users.liveSince }),
    db
      .update(userSessions)
      .set({ revokedAt: Date.now() })
      .where(
        and(
          eq(userSessions.userId, userId),
          isNull(userSessions.revokedAt),
          keep === null ? undefined : ne(userSessions.id, keep),
        ),
      ),
  ])
  if (!user) throw new ApiError(401, 'unauthenticated', 'Not signed in')
  if (user.liveSince !== null) await revokeLive(c.env, userId, user.tokenVersion, keep)
  return { id: user.id, tokenVersion: user.tokenVersion }
}

/**
 * Who the access cookie says is signed in, with its token version and
 * session (null in a token from before it carried them); not checked against
 * D1. For the OAuth callback, a top-level navigation back from the provider:
 * the SameSite Lax access cookie comes along, the Strict refresh cookie does
 * not.
 */
export async function readAccessSession(
  c: Context<AppEnv>,
): Promise<{ userId: number; tokenVersion: number | null; sid: number | null } | null> {
  const payload = await readToken(c, ACCESS_COOKIE, 'access')
  if (!payload) return null
  const { userId, ver, sid } = claimsOf(payload)
  return { userId, tokenVersion: ver, sid }
}

/**
 * Whether the session row is active: not revoked, not expired, and the
 * token's version still the user's.
 */
export async function sessionActive(
  d1: D1Database,
  userId: number,
  sid: number,
  tokenVersion: number | null,
): Promise<boolean> {
  const row = await d1
    .prepare(
      `SELECT 1 AS ok FROM user_sessions AS s JOIN users AS u ON u.id = s.user_id
       WHERE s.id = ?1 AND s.user_id = ?2 AND s.revoked_at IS NULL AND s.expires_at > ?3
         AND (?4 IS NULL OR u.token_version = ?4)`,
    )
    .bind(sid, userId, Date.now(), tokenVersion)
    .first()
  return row !== null
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** The CSRF check and the access token: sets userId, tokenVersion and sessionId. */
async function authenticate(c: Context<AppEnv>): Promise<void> {
  // The public API running a route as its token's user (lib/internal): no
  // cookie, no CSRF (the request never left the Worker), and no session row,
  // so requireActiveSession refuses it.
  const inner = internalCaller(c.req.raw)
  if (inner) {
    c.set('userId', inner.userId)
    c.set('tokenVersion', null)
    c.set('sessionId', null)
    return
  }
  if (!SAFE_METHODS.has(c.req.method) && c.req.header(CSRF_HEADER) !== '1') {
    throw new ApiError(403, 'csrf', `Missing ${CSRF_HEADER} header`)
  }
  if (!getCookie(c, ACCESS_COOKIE)) throw new ApiError(401, 'unauthenticated', 'Not signed in')
  const payload = await readToken(c, ACCESS_COOKIE, 'access')
  if (!payload) throw new ApiError(401, 'token_expired', 'Access token expired')
  const { userId, ver, sid } = claimsOf(payload)
  c.set('userId', userId)
  c.set('tokenVersion', ver)
  c.set('sessionId', sid)
}

/** Requires a valid access cookie (no D1 read); sets `userId`. */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  await authenticate(c)
  await next()
}

/**
 * requireUser, plus the session row checked in D1: for what a stolen or
 * signed-out device must not do in its access token's last minutes (change
 * the password or profile, manage sessions and sign-ins, make import keys;
 * the staff routes). A token without a session is 401 `token_expired`, so
 * the app refreshes (which gives it one) and retries; an ended session is
 * 401 `session_revoked`.
 */
export const requireActiveSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  if ((c.var as Partial<AppEnv['Variables']>).userId === undefined) await authenticate(c)
  const sid = c.get('sessionId')
  if (sid === null) throw new ApiError(401, 'token_expired', 'Session needs a refresh')
  if (!(await sessionActive(c.env.DB, c.get('userId'), sid, c.get('tokenVersion')))) {
    throw sessionEnded()
  }
  await next()
}
