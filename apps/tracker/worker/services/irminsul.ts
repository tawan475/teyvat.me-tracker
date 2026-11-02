/**
 * irminsul's sign-in in D1 (README "Sign in from irminsul"): one-time codes
 * (`oauth_codes`), and the session rows (`user_sessions`, method `irminsul`)
 * they turn into, with their rotating refresh token and upload target.
 *
 * Round trips: authorize 1 (+ the active-session check), code exchange 3,
 * refresh 1, revoke 1, whoami 1, an upload's lookup 1 (as an import key's).
 */

import {
  CODE_VERIFIER,
  toBase64Url,
  type GenshinServer,
  type IrminsulTokenResponse,
  type IrminsulWhoami,
  type UploadTarget,
} from '@gdt/shared'
import type { Context } from 'hono'
import type { AppEnv } from '../env'
import { randomToken, safeEqual, sha256Hex } from '../lib/crypto'
import { pageOrigin } from '../lib/email'
import {
  IRMINSUL_ACCESS_TTL_S,
  mintAccessToken,
  newRefreshToken,
  readRefreshToken,
  type IrminsulClaims,
} from '../lib/irminsul-auth'
import { REFRESH_TTL_S, pruneSessionsStatement, requestOrigin } from '../lib/session'
import { accessibleAccountsSql, editableBy, type KeyAccount, type KeyBlock } from './accounts'
import { revokeLiveSession } from './live'

/** A code is good for this long after Allow (the browser hands it straight to irminsul). */
export const CODE_TTL_MS = 60_000
/** Maintenance deletes codes this long after they expired. */
export const CODE_KEEP_MS = 24 * 60 * 60 * 1000
/** A refresh writes `users.last_active_at` at most this often (as the browser's does). */
const ACTIVE_STAMP_MS = 60 * 60 * 1000

/** An OAuth error answer (RFC 6749 §5.2): `{ error, error_description }`. */
export class OAuthError extends Error {
  constructor(
    readonly status: 400 | 403 | 429,
    readonly error: string,
    description: string,
  ) {
    super(description)
  }
}

const invalidGrant = (why: string) => new OAuthError(400, 'invalid_grant', why)
const suspended = () => new OAuthError(403, 'account_suspended', 'This account is suspended')

// ------------------------------------------------------------------ authorize

export type AuthorizeOutcome =
  | { ok: true; code: string }
  | { ok: false; reason: 'suspended' | 'invalid_account' | 'gone' }

/**
 * Makes a one-time code for the user's Allow: one round trip, which also
 * refuses a suspended user and an account that isn't theirs.
 */
export async function createCode(
  d1: D1Database,
  userId: number,
  request: { challenge: string; redirectUri: string; device: string; upload: UploadTarget },
): Promise<AuthorizeOutcome> {
  const code = randomToken(32)
  const at = Date.now()
  const accountId = request.upload.mode === 'account' ? request.upload.account_id : null
  const [user, account, inserted] = await d1.batch<Record<string, unknown>>([
    d1.prepare('SELECT suspended_at FROM users WHERE id = ?1').bind(userId),
    d1.prepare(`SELECT ?1 AS id WHERE ${editableBy('?1', '?2')}`).bind(accountId, userId),
    d1
      .prepare(
        `INSERT INTO oauth_codes (code_hash, user_id, challenge, redirect_uri, device_name,
           upload_mode, upload_account_id, created_at, expires_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9
         WHERE (SELECT suspended_at FROM users WHERE id = ?2) IS NULL
           AND (?7 IS NULL OR ${editableBy('?7', '?2')})
         RETURNING 1 AS ok`,
      )
      .bind(
        await sha256Hex(code),
        userId,
        request.challenge,
        request.redirectUri,
        request.device,
        request.upload.mode,
        accountId,
        at,
        at + CODE_TTL_MS,
      ),
  ])
  if (inserted!.results.length > 0) return { ok: true, code }
  const row = user!.results[0]
  if (!row) return { ok: false, reason: 'gone' }
  if (row.suspended_at !== null) return { ok: false, reason: 'suspended' }
  if (account!.results.length === 0) return { ok: false, reason: 'invalid_account' }
  return { ok: false, reason: 'gone' }
}

// ---------------------------------------------------------------------- whoami

/** What whoami says about an account (the upload target's row, when there is one). */
interface TargetRow {
  upload_mode: 'uid' | 'account' | null
  upload_account_id: number | null
  username: string
  account_id: number | null
  account_name: string | null
  account_uid: string | null
  account_server: GenshinServer | null
}

/** Columns of the target account, joined as `a` (the user's own only). */
const ACCOUNT_COLUMNS = `a.id AS account_id, a.name AS account_name, a.uid AS account_uid,
  a.server AS account_server`

/** The page that sets this session's upload target: its row in Settings → Devices. */
export function configUrl(origin: string, sid: number): string {
  return new URL(`/app/settings/devices?device=${sid}`, origin).href
}

export function whoamiOf(origin: string, sid: number, row: TargetRow): IrminsulWhoami {
  const base = {
    user: row.username,
    configUrl: configUrl(origin, sid),
  }
  if (row.upload_mode !== 'account') {
    return {
      scope: 'uid',
      ...base,
      accountId: null,
      accountName: null,
      uid: null,
      server: null,
      dashboardUrl: new URL('/app', origin).href,
    }
  }
  // The chosen account was deleted: no target until one is picked again.
  if (row.account_id === null) {
    return {
      scope: 'account',
      ...base,
      accountId: null,
      accountName: null,
      uid: null,
      server: null,
      dashboardUrl: new URL('/app', origin).href,
    }
  }
  return {
    scope: 'account',
    ...base,
    accountId: row.account_id,
    accountName: row.account_name,
    uid: row.account_uid,
    server: row.account_server,
    dashboardUrl: new URL(`/app/a/${row.account_id}`, origin).href,
  }
}

/** A live irminsul session of the token's user and version, with its target and the user's state. */
const SESSION_SQL = `SELECT s.upload_mode, s.upload_account_id, u.username, u.suspended_at,
    u.uploads_blocked_at, ${ACCOUNT_COLUMNS}
  FROM user_sessions AS s JOIN users AS u ON u.id = s.user_id
  LEFT JOIN genshin_accounts AS a ON a.id = s.upload_account_id
    AND (a.user_id = s.user_id OR EXISTS (SELECT 1 FROM account_members AS m
      WHERE m.account_id = a.id AND m.user_id = s.user_id AND m.accepted_at IS NOT NULL))
  WHERE s.id = ?1 AND s.user_id = ?2 AND s.method = 'irminsul' AND s.revoked_at IS NULL
    AND s.expires_at > ?3 AND u.token_version = ?4`

export interface LiveSession extends TargetRow {
  block: KeyBlock
}

function blockOf(row: Record<string, unknown>): KeyBlock {
  if (row.suspended_at !== null && row.suspended_at !== undefined) return 'suspended'
  if (row.uploads_blocked_at !== null && row.uploads_blocked_at !== undefined) {
    return 'uploads_blocked'
  }
  return null
}

/** The token's session if it is still live (null: signed out); one round trip. */
export async function loadSession(
  d1: D1Database,
  claims: IrminsulClaims,
): Promise<LiveSession | null> {
  const row = await d1
    .prepare(SESSION_SQL)
    .bind(claims.sid, claims.userId, Date.now(), claims.ver)
    .first<Record<string, unknown>>()
  return row ? { ...(row as unknown as TargetRow), block: blockOf(row) } : null
}

/**
 * For an upload: the session (as loadSession) and all of the user's accounts
 * (few rows; uid mode routes by them, account mode finds its one), in one
 * round trip, as an import key's lookup is.
 */
export async function loadUploadSession(
  d1: D1Database,
  claims: IrminsulClaims,
): Promise<{ session: LiveSession; accounts: KeyAccount[] } | null> {
  const [session, accounts] = await d1.batch<Record<string, unknown>>([
    d1.prepare(SESSION_SQL).bind(claims.sid, claims.userId, Date.now(), claims.ver),
    d1
      .prepare(accessibleAccountsSql(`a.id, a.name, a.uid, a.server, a.user_id`))
      .bind(claims.userId),
  ])
  const row = session!.results[0]
  if (!row) return null
  return {
    session: { ...(row as unknown as TargetRow), block: blockOf(row) },
    accounts: accounts!.results as unknown as KeyAccount[],
  }
}

// ----------------------------------------------------------------------- token

async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return toBase64Url(new Uint8Array(digest))
}

async function tokenAnswer(
  c: Context<AppEnv>,
  claims: IrminsulClaims,
  refreshToken: string,
  row: TargetRow,
): Promise<IrminsulTokenResponse> {
  return {
    token_type: 'Bearer',
    access_token: await mintAccessToken(c, claims),
    expires_in: IRMINSUL_ACCESS_TTL_S,
    refresh_token: refreshToken,
    refresh_expires_in: REFRESH_TTL_S,
    whoami: whoamiOf(pageOrigin(c.env, c.req.url), claims.sid, row),
  }
}

interface CodeRow {
  user_id: number
  challenge: string
  redirect_uri: string
  device_name: string
  upload_mode: 'uid' | 'account'
  upload_account_id: number | null
  expires_at: number
}

/**
 * `grant_type=authorization_code`: uses the code up (whatever comes next),
 * checks it against the verifier and the redirect, then makes the session
 * row. A code used a second time ends the session the first use made.
 */
export async function exchangeCode(
  c: Context<AppEnv>,
  body: { code: unknown; code_verifier: unknown; redirect_uri: unknown; app?: unknown },
): Promise<IrminsulTokenResponse> {
  const { code, code_verifier: verifier, redirect_uri: redirectUri } = body
  // Teyvat.me (irminsul's successor) shares the client id and says which app it is.
  const appName = body.app === 'teyvatme' ? 'Teyvat.me' : 'Irminsul'
  if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(code)) {
    throw invalidGrant('Unknown code')
  }
  if (typeof verifier !== 'string' || !CODE_VERIFIER.test(verifier)) {
    throw new OAuthError(400, 'invalid_request', 'code_verifier must be 43-128 characters')
  }
  if (typeof redirectUri !== 'string') {
    throw new OAuthError(400, 'invalid_request', 'redirect_uri is required')
  }
  const d1 = c.env.DB
  const at = Date.now()
  const hash = await sha256Hex(code)
  const [used, again, user, account] = await d1.batch<Record<string, unknown>>([
    d1
      .prepare(
        `UPDATE oauth_codes SET used_at = ?2 WHERE code_hash = ?1 AND used_at IS NULL
         RETURNING user_id, challenge, redirect_uri, device_name, upload_mode,
           upload_account_id, expires_at`,
      )
      .bind(hash, at),
    // Used before this request: end what that use made (RFC 6749 §4.1.2).
    d1
      .prepare(
        `UPDATE user_sessions SET revoked_at = ?2
         WHERE id = (SELECT session_id FROM oauth_codes WHERE code_hash = ?1 AND used_at < ?2)
           AND revoked_at IS NULL
         RETURNING id, user_id, (SELECT live_since FROM users WHERE id = user_id) AS live_since`,
      )
      .bind(hash, at),
    d1
      .prepare(
        `SELECT u.id, u.username, u.token_version, u.suspended_at FROM oauth_codes AS o
         JOIN users AS u ON u.id = o.user_id WHERE o.code_hash = ?1`,
      )
      .bind(hash),
    d1
      .prepare(
        `SELECT ${ACCOUNT_COLUMNS} FROM oauth_codes AS o
         JOIN genshin_accounts AS a ON a.id = o.upload_account_id AND a.user_id = o.user_id
         WHERE o.code_hash = ?1`,
      )
      .bind(hash),
  ])
  const ended = again!.results[0] as
    | { id: number; user_id: number; live_since: unknown }
    | undefined
  if (ended && ended.live_since !== null) {
    await revokeLiveSession(c.env, ended.user_id, ended.id)
  }
  const row = used!.results[0] as CodeRow | undefined
  if (!row) throw invalidGrant('Unknown or used code')
  if (row.expires_at <= at) throw invalidGrant('The code expired, sign in again')
  if (row.redirect_uri !== redirectUri) throw invalidGrant('redirect_uri does not match')
  if (!safeEqual(await s256(verifier), row.challenge)) {
    throw invalidGrant('code_verifier does not match')
  }
  const owner = user!.results[0] as
    | { id: number; username: string; token_version: number; suspended_at: number | null }
    | undefined
  if (!owner) throw invalidGrant('Unknown code')
  if (owner.suspended_at !== null) throw suspended()

  // The session row; its refresh token names it, so the hash is set right after.
  const origin = requestOrigin(c)
  const expires = at + REFRESH_TTL_S * 1000
  const [inserted] = await d1.batch<{ id: number }>([
    d1
      .prepare(
        `INSERT INTO user_sessions (user_id, method, user_agent, ip, created_ip, country, city,
           created_at, last_seen_at, expires_at, device_name, upload_mode, upload_account_id)
         SELECT ?1, 'irminsul', ?2, ?3, ?3, ?4, ?5, ?6, ?6, ?7, ?8, ?9, ?10
         WHERE (SELECT token_version FROM users WHERE id = ?1) = ?11
           AND (SELECT suspended_at FROM users WHERE id = ?1) IS NULL
         RETURNING id`,
      )
      .bind(
        owner.id,
        `${appName} on ${row.device_name}`,
        origin.ip,
        origin.country,
        origin.city,
        at,
        expires,
        row.device_name,
        row.upload_mode,
        row.upload_account_id,
        owner.token_version,
      ),
  ])
  const sid = inserted!.results[0]?.id
  if (typeof sid !== 'number') throw invalidGrant('Signed out meanwhile, sign in again')
  const refresh = await newRefreshToken(sid)
  const [, pruned, stamped] = await d1.batch<Record<string, unknown>>([
    d1.prepare('UPDATE user_sessions SET refresh_hash = ?2 WHERE id = ?1').bind(sid, refresh.hash),
    pruneSessionsStatement(d1, owner.id, at),
    d1
      .prepare('UPDATE users SET last_active_at = ?2 WHERE id = ?1 RETURNING live_since')
      .bind(owner.id, at),
    d1.prepare('UPDATE oauth_codes SET session_id = ?2 WHERE code_hash = ?1').bind(hash, sid),
  ])
  // Past MAX_SESSIONS the least recently seen devices just ended: close their sockets.
  if (stamped!.results[0]?.live_since != null) {
    await Promise.all(
      pruned!.results.map((ended) => revokeLiveSession(c.env, owner.id, Number(ended.id))),
    )
  }
  const target = account!.results[0] as Partial<TargetRow> | undefined
  return tokenAnswer(c, { userId: owner.id, sid, ver: owner.token_version }, refresh.token, {
    upload_mode: row.upload_mode,
    upload_account_id: row.upload_account_id,
    username: owner.username,
    account_id: target?.account_id ?? null,
    account_name: target?.account_name ?? null,
    account_uid: target?.account_uid ?? null,
    account_server: target?.account_server ?? null,
  })
}

/**
 * `grant_type=refresh_token`: one round trip. The token is replaced (the old
 * one stops working) and the session slides 30 days, as a browser's does. The
 * token before the current one coming back means a copy is in other hands:
 * the session ends.
 */
export async function refreshGrant(
  c: Context<AppEnv>,
  token: unknown,
): Promise<IrminsulTokenResponse> {
  const presented = await readRefreshToken(token)
  if (!presented) throw invalidGrant('Unknown refresh token')
  const { sid, hash } = presented
  const next = await newRefreshToken(sid)
  const d1 = c.env.DB
  const at = Date.now()
  const origin = requestOrigin(c)
  const [reused, rotated, account] = await d1.batch<Record<string, unknown>>([
    d1
      .prepare(
        `UPDATE user_sessions SET revoked_at = ?3
         WHERE id = ?1 AND method = 'irminsul' AND refresh_prev_hash = ?2 AND revoked_at IS NULL
         RETURNING id`,
      )
      .bind(sid, hash, at),
    d1
      .prepare(
        `UPDATE user_sessions SET refresh_hash = ?3, refresh_prev_hash = ?2, last_seen_at = ?4,
           expires_at = ?5, ip = coalesce(?6, ip),
           country = CASE WHEN ?7 IS NULL THEN country ELSE ?7 END,
           city = CASE WHEN ?7 IS NULL THEN city ELSE ?8 END
         WHERE id = ?1 AND method = 'irminsul' AND refresh_hash = ?2 AND revoked_at IS NULL
           AND expires_at > ?4
         RETURNING user_id, upload_mode, upload_account_id,
           (SELECT username FROM users WHERE id = user_id) AS username,
           (SELECT token_version FROM users WHERE id = user_id) AS token_version,
           (SELECT suspended_at FROM users WHERE id = user_id) AS suspended_at,
           (SELECT last_active_at FROM users WHERE id = user_id) AS last_active_at`,
      )
      .bind(
        sid,
        hash,
        next.hash,
        at,
        at + REFRESH_TTL_S * 1000,
        origin.ip,
        origin.country,
        origin.city,
      ),
    d1
      .prepare(
        `SELECT ${ACCOUNT_COLUMNS} FROM user_sessions AS s
         JOIN genshin_accounts AS a ON a.id = s.upload_account_id AND a.user_id = s.user_id
         WHERE s.id = ?1 AND s.refresh_hash = ?2`,
      )
      .bind(sid, next.hash),
  ])
  if (reused!.results.length > 0) throw invalidGrant('This sign-in was ended, sign in again')
  const row = rotated!.results[0] as
    | (Omit<TargetRow, 'account_id' | 'account_name' | 'account_uid' | 'account_server'> & {
        user_id: number
        token_version: number
        suspended_at: number | null
        last_active_at: number | null
      })
    | undefined
  if (!row) throw invalidGrant('Signed out, sign in again')
  if (row.suspended_at !== null) throw suspended()
  if (row.last_active_at === null || row.last_active_at <= at - ACTIVE_STAMP_MS) {
    const stamp = d1
      .prepare('UPDATE users SET last_active_at = ?2 WHERE id = ?1')
      .bind(row.user_id, at)
      .run()
      .catch((error: unknown) => console.warn('last_active_failed', String(error)))
    try {
      c.executionCtx.waitUntil(stamp)
    } catch {
      // No execution context (a direct app.fetch): the write still runs.
    }
  }
  const target = account!.results[0] as Partial<TargetRow> | undefined
  return tokenAnswer(c, { userId: row.user_id, sid, ver: row.token_version }, next.token, {
    upload_mode: row.upload_mode,
    upload_account_id: row.upload_account_id,
    username: row.username,
    account_id: target?.account_id ?? null,
    account_name: target?.account_name ?? null,
    account_uid: target?.account_uid ?? null,
    account_server: target?.account_server ?? null,
  })
}

/**
 * `POST /api/oauth/revoke`: ends the session a refresh token names (its
 * current one only: a stale copy ends nothing). Nothing is said about
 * whether it did (RFC 7009).
 */
export async function revokeRefreshToken(d1: D1Database, token: unknown): Promise<void> {
  const presented = await readRefreshToken(token)
  if (!presented) return
  await d1
    .prepare(
      `UPDATE user_sessions SET revoked_at = ?3
       WHERE id = ?1 AND method = 'irminsul' AND refresh_hash = ?2 AND revoked_at IS NULL`,
    )
    .bind(presented.sid, presented.hash, Date.now())
    .run()
}
