/**
 * One-time links (table `auth_tokens`, migration 0014): email confirmation and
 * password reset.
 *
 * - A token is 32 random bytes (base64url in the link); only its SHA-256 is
 *   stored, so a database read never yields a working link.
 * - Single use: using one is a conditional UPDATE (`used_at IS NULL AND
 *   expires_at > now`), so two requests racing with the same link can't both
 *   win.
 * - Mailed links (with `email` set) are limited to MAILS_PER_HOUR per user and
 *   kind, counted and inserted in one statement. Links an admin makes
 *   (scripts/admin-reset-link.mjs, `email` NULL) don't count.
 * - A reset link only ever goes to a confirmed email. A confirmation only
 *   counts while the account's email is still the address it was sent to.
 * - Tokens are never logged.
 */

import { and, eq, isNotNull, isNull, or } from 'drizzle-orm'
import { getDb } from '../db/client'
import { authTokens, users } from '../db/schema'
import { randomToken, sha256Hex } from '../lib/crypto'
import {
  emailEnabled,
  resetPasswordMail,
  sendMail,
  verifyEmailMail,
  type SendResult,
} from '../lib/email'
import { siteName } from '../lib/site'
import { ApiError } from '../lib/http'

export type LinkKind = (typeof authTokens.$inferSelect)['kind']

const MINUTE = 60_000
const HOUR = 60 * MINUTE

export const LINK_TTL_MS: Record<LinkKind, number> = {
  verify_email: 24 * HOUR,
  reset_password: 30 * MINUTE,
}
/** Mails of one kind a user can be sent per hour. */
export const MAILS_PER_HOUR = 3
/** How long a dead link is kept so a late click still says "expired" (maintenance). */
export const KEEP_EXPIRED_MS = 24 * HOUR

const LINK_ERRORS = {
  token_invalid: [400, 'This link is not valid'],
  token_expired: [410, 'This link has expired'],
  token_used: [410, 'This link was already used'],
} as const

export function linkError(code: keyof typeof LINK_ERRORS): ApiError {
  const [status, message] = LINK_ERRORS[code]
  return new ApiError(status, code, message)
}

/**
 * A new mailed link, or null when the user already had MAILS_PER_HOUR of this
 * kind mailed within the hour.
 */
export async function issueMailedToken(
  d1: D1Database,
  userId: number,
  kind: LinkKind,
  email: string,
  now = Date.now(),
): Promise<string | null> {
  const token = randomToken(32)
  const result = await d1
    .prepare(
      `INSERT INTO auth_tokens (user_id, kind, token_hash, email, expires_at, created_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6
       WHERE (SELECT count(*) FROM auth_tokens
              WHERE user_id = ?1 AND kind = ?2 AND email IS NOT NULL AND created_at > ?7) < ?8`,
    )
    .bind(
      userId,
      kind,
      await sha256Hex(token),
      email,
      now + LINK_TTL_MS[kind],
      now,
      now - HOUR,
      MAILS_PER_HOUR,
    )
    .run()
  return result.meta.changes === 1 ? token : null
}

/** How long a reset link made by staff works (the dashboard's Reset link, or the CLI). */
export const ADMIN_LINK_TTL_MS = 24 * HOUR

/**
 * A password reset link for staff to hand over privately (e.g. on Discord):
 * the row scripts/admin-reset-link.mjs writes, `email` NULL (it was never
 * mailed, so it doesn't count against the mail limit and survives an email
 * change). The token is returned once; only its hash is stored. Run
 * `statement` (in the batch with the audit row) to make it work.
 */
export async function adminResetLink(
  d1: D1Database,
  userId: number,
  now = Date.now(),
): Promise<{ token: string; expiresAt: number; statement: D1PreparedStatement }> {
  const token = randomToken(32)
  const expiresAt = now + ADMIN_LINK_TTL_MS
  const statement = d1
    .prepare(
      `INSERT INTO auth_tokens (user_id, kind, token_hash, email, expires_at, created_at)
       VALUES (?1, 'reset_password', ?2, NULL, ?3, ?4)`,
    )
    .bind(userId, await sha256Hex(token), expiresAt, now)
  return { token, expiresAt, statement }
}

/** Forgets a link whose mail never went out, so it doesn't count against the limit. */
async function dropToken(d1: D1Database, token: string): Promise<void> {
  await getDb(d1)
    .delete(authTokens)
    .where(eq(authTokens.tokenHash, await sha256Hex(token)))
}

export type OpenLink = Pick<typeof authTokens.$inferSelect, 'id' | 'userId' | 'email'>

/** The link's row while it can be used; otherwise the error saying why not. */
export async function openLink(
  d1: D1Database,
  kind: LinkKind,
  token: string,
  now = Date.now(),
): Promise<OpenLink> {
  const [row] = await getDb(d1)
    .select({
      id: authTokens.id,
      userId: authTokens.userId,
      email: authTokens.email,
      expiresAt: authTokens.expiresAt,
      usedAt: authTokens.usedAt,
    })
    .from(authTokens)
    .where(and(eq(authTokens.tokenHash, await sha256Hex(token)), eq(authTokens.kind, kind)))
    .limit(1)
  if (!row) throw linkError('token_invalid')
  if (row.usedAt !== null) throw linkError('token_used')
  if (row.expiresAt <= now) throw linkError('token_expired')
  return { id: row.id, userId: row.userId, email: row.email }
}

/**
 * Uses the link: only one caller ever gets true. False: it was used or ran
 * out since `openLink` read it.
 */
export async function claimLink(d1: D1Database, id: number, now = Date.now()): Promise<boolean> {
  const [row] = await d1
    .prepare(
      'UPDATE auth_tokens SET used_at = ?2 WHERE id = ?1 AND used_at IS NULL AND expires_at > ?2 RETURNING id',
    )
    .bind(id, now)
    .raw()
  return row !== undefined
}

/**
 * Ends the user's open reset links: after a reset or a password change (all),
 * or an email change (`mailedOnly`: the ones mailed to the old address; an
 * admin's link was handed over another way).
 */
export async function closeResetLinks(
  d1: D1Database,
  userId: number,
  options: { mailedOnly?: boolean; now?: number } = {},
): Promise<void> {
  await getDb(d1)
    .update(authTokens)
    .set({ usedAt: options.now ?? Date.now() })
    .where(
      and(
        eq(authTokens.userId, userId),
        eq(authTokens.kind, 'reset_password'),
        isNull(authTokens.usedAt),
        options.mailedOnly ? isNotNull(authTokens.email) : undefined,
      ),
    )
}

export type MailOutcome = SendResult | 'limited' | 'skipped'

/** Mails a confirmation link for the user's current email. */
export async function mailVerification(
  env: Env,
  user: { id: number; email: string },
  origin: string,
): Promise<MailOutcome> {
  if (!emailEnabled(env)) return 'unavailable'
  const token = await issueMailedToken(env.DB, user.id, 'verify_email', user.email)
  if (!token) return 'limited'
  const result = await sendMail(env, verifyEmailMail(user.email, origin, token, siteName(env)))
  if (result !== 'sent') await dropToken(env.DB, token)
  return result
}

/**
 * "Forgot password": mails a reset link when `login` (a username or email,
 * lowercased) names a user with a confirmed email. Runs after the response
 * (`waitUntil`), so the answer and its timing say nothing about the account;
 * the outcome is only for tests.
 */
export async function mailResetLink(env: Env, login: string, origin: string): Promise<MailOutcome> {
  if (!emailEnabled(env)) return 'unavailable'
  // Usernames can't hold an "@", so a login names at most one user.
  const [user] = await getDb(env.DB)
    .select({
      id: users.id,
      username: users.username,
      email: users.email,
      emailVerified: users.emailVerified,
    })
    .from(users)
    .where(or(eq(users.usernameKey, login), eq(users.email, login)))
    .limit(1)
  if (!user?.email || !user.emailVerified) return 'skipped'
  const token = await issueMailedToken(env.DB, user.id, 'reset_password', user.email)
  if (!token) return 'limited'
  const result = await sendMail(
    env,
    resetPasswordMail(user.email, origin, token, user.username, siteName(env)),
  )
  if (result !== 'sent') await dropToken(env.DB, token)
  return result
}
