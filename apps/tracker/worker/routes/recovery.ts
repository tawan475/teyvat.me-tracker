/**
 * Account recovery, under /api/auth (one-time links: services/auth-tokens).
 *
 * - `POST /verify-email/send` (signed in): mails a confirmation link for the
 *   account's email. 503 `email_unavailable` without the EMAIL binding, 429
 *   past MAILS_PER_HOUR.
 * - `POST /verify-email {token}`: confirms the address the link was sent to,
 *   while it is still the account's (else 409 `email_changed`). Needs no
 *   session: the link may be opened in another browser.
 * - `POST /forgot-password {login}`: always 202 with the same body, at once;
 *   the lookup and the mail happen after the response, so neither the answer
 *   nor its timing says whether the account exists or has a confirmed email.
 * - `POST /reset-password/check {token}`: whose password the link resets.
 * - `POST /reset-password {token, password}`: sets the password, ends every
 *   session (token_version) and every other open reset link, mails a notice
 *   to a confirmed email, and signs this browser in (a `reset` session).
 *
 * While the email features are off (EMAIL_FEATURES, lib/email), the first
 * three answer 404 `email_paused`; the reset routes stay, for admin links.
 *
 * Link errors are `token_invalid` (400), `token_expired` / `token_used` (410).
 * Tokens travel in POST bodies, never in an API URL (request logs keep URLs).
 * The public routes still want `x-gdt-csrf`, so a cross-site page can't use a
 * link on a visitor's behalf (and sign their browser into another account).
 */

import {
  forgotPasswordRequest,
  linkTokenRequest,
  resetPasswordRequest,
  type ResetLinkResponse,
  type VerifyEmailResponse,
} from '@gdt/shared'
import { and, eq } from 'drizzle-orm'
import { Hono, type MiddlewareHandler } from 'hono'
import { getDb } from '../db/client'
import { users } from '../db/schema'
import type { AppEnv } from '../env'
import { emailFeatures, linkOrigin, passwordChangedMail, sendMail } from '../lib/email'
import { siteName } from '../lib/site'
import { ApiError, clientIp, parseJson, rateLimit } from '../lib/http'
import { hashPassword } from '../lib/password'
import { CSRF_HEADER, createSession, requireUser, revokeAllSessions } from '../lib/session'
import {
  MAILS_PER_HOUR,
  claimLink,
  closeResetLinks,
  linkError,
  mailResetLink,
  mailVerification,
  openLink,
  type LinkKind,
  type OpenLink,
} from '../services/auth-tokens'
import { meOf, pepper, suspendedError } from './auth'

const requireCsrf: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.header(CSRF_HEADER) !== '1') {
    throw new ApiError(403, 'csrf', `Missing ${CSRF_HEADER} header`)
  }
  await next()
}

/** A route that only exists while the email features are on. */
const emailRoute: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!emailFeatures(c.env)) throw new ApiError(404, 'email_paused', 'Email features are paused')
  await next()
}

/** What `POST /forgot-password` answers, whoever was asked for. */
export const FORGOT_PASSWORD_ANSWER = { ok: true } as const

/**
 * Uses up an open link, or throws why it can't be: only one request ever
 * gets past this with the same link.
 */
async function claim(d1: D1Database, kind: LinkKind, token: string, link: OpenLink) {
  if (!(await claimLink(d1, link.id))) {
    await openLink(d1, kind, token) // throws why: used or expired meanwhile
    throw linkError('token_used')
  }
}

export const recovery = new Hono<AppEnv>()
  .post('/verify-email/send', emailRoute, requireUser, async (c) => {
    const userId = c.get('userId')
    await rateLimit(c.env.RECOVERY_LIMITER, `verify-send:${userId}`)
    const [user] = await getDb(c.env.DB).select().from(users).where(eq(users.id, userId))
    if (!user) throw new ApiError(401, 'unauthenticated', 'Not signed in')
    if (!user.email) throw new ApiError(400, 'no_email', 'Add an email first')
    if (user.emailVerified) throw new ApiError(409, 'already_verified', 'Email already confirmed')
    const outcome = await mailVerification(
      c.env,
      { id: user.id, email: user.email },
      linkOrigin(c.env, c.req.url),
    )
    if (outcome === 'unavailable') {
      throw new ApiError(503, 'email_unavailable', 'Email is not available yet')
    }
    if (outcome === 'limited') {
      throw new ApiError(429, 'rate_limited', `At most ${MAILS_PER_HOUR} emails an hour`)
    }
    if (outcome !== 'sent') {
      throw new ApiError(502, 'email_failed', 'The email could not be sent, try again later')
    }
    return c.body(null, 204)
  })

  .post('/verify-email', emailRoute, requireCsrf, async (c) => {
    await rateLimit(c.env.AUTH_LIMITER, `link:${clientIp(c)}`)
    const { token } = await parseJson(c, linkTokenRequest)
    const link = await openLink(c.env.DB, 'verify_email', token)
    await claim(c.env.DB, 'verify_email', token, link)
    const [user] = link.email
      ? await getDb(c.env.DB)
          .update(users)
          .set({ emailVerified: true })
          .where(and(eq(users.id, link.userId), eq(users.email, link.email)))
          .returning({ email: users.email })
      : []
    if (!user?.email) {
      throw new ApiError(
        409,
        'email_changed',
        "The account's email changed after this link was sent",
      )
    }
    return c.json({ email: user.email } satisfies VerifyEmailResponse)
  })

  .post('/forgot-password', emailRoute, requireCsrf, async (c) => {
    await rateLimit(c.env.RECOVERY_LIMITER, `forgot:${clientIp(c)}`)
    const { login } = await parseJson(c, forgotPasswordRequest)
    c.executionCtx.waitUntil(
      mailResetLink(c.env, login, linkOrigin(c.env, c.req.url)).catch((error: unknown) =>
        console.error('forgot-password', String(error).slice(0, 120)),
      ),
    )
    return c.json(FORGOT_PASSWORD_ANSWER, 202)
  })

  .post('/reset-password/check', requireCsrf, async (c) => {
    await rateLimit(c.env.AUTH_LIMITER, `link:${clientIp(c)}`)
    const { token } = await parseJson(c, linkTokenRequest)
    const link = await openLink(c.env.DB, 'reset_password', token)
    const [user] = await getDb(c.env.DB)
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, link.userId))
    if (!user) throw linkError('token_invalid')
    return c.json({ username: user.username } satisfies ResetLinkResponse)
  })

  .post('/reset-password', requireCsrf, async (c) => {
    await rateLimit(c.env.AUTH_LIMITER, `link:${clientIp(c)}`)
    const body = await parseJson(c, resetPasswordRequest)
    // Checked before the ~200 ms hash, and hashed before the link is used up,
    // so a server fault (no pepper) leaves the link working.
    const link = await openLink(c.env.DB, 'reset_password', body.token)
    const [owner] = await getDb(c.env.DB)
      .select({ suspendedAt: users.suspendedAt })
      .from(users)
      .where(eq(users.id, link.userId))
    // A suspended user can't sign in this way either; the link stays unused.
    if (owner?.suspendedAt != null) throw suspendedError()
    const passwordHash = hashPassword(body.password, pepper(c))
    await claim(c.env.DB, 'reset_password', body.token, link)
    const session = await revokeAllSessions(c, link.userId, { set: { passwordHash } })
    await closeResetLinks(c.env.DB, link.userId)
    await createSession(c, session, 'reset')
    const [user] = await getDb(c.env.DB).select().from(users).where(eq(users.id, link.userId))
    if (!user) throw linkError('token_invalid')
    if (user.email && user.emailVerified) {
      c.executionCtx.waitUntil(
        sendMail(
          c.env,
          passwordChangedMail(
            user.email,
            linkOrigin(c.env, c.req.url),
            user.username,
            siteName(c.env),
          ),
        ),
      )
    }
    return c.json(await meOf(c, user))
  })
