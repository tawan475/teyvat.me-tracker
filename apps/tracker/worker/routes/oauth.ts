/**
 * Sign in with Discord / Google, under /api/auth/oauth (flow and cookies:
 * lib/oauth; rows: services/identities).
 *
 * - `GET /providers`: the providers this server has (none without secrets),
 *   whether the email features are on, and the human check's site key (null
 *   while off), for the signed-out pages.
 * - `POST /:provider/start {next?}`: signed out; answers the provider URL to
 *   send the browser to and sets the state cookie.
 * - `POST /:provider/link` (signed in, an active session): the same, to
 *   link the provider to this user. It renews the session's tokens, so the
 *   access cookie the callback checks is fresh.
 * - `GET /:provider/callback`: where the provider sends the browser back.
 *   Checks state, exchanges the code, then: a linked identity signs its user
 *   in (a session like password login) → /app; an unlinked one is kept in the
 *   pending cookie → /oauth (create an account, or sign in to link it); a
 *   link adds it to the signed-in user, who must still be the one who started
 *   it, in the same session, still active → Settings. Failures go back to
 *   /login (Settings when linking) with `?oauth_error=<code>`
 *   (OAUTH_ERROR_CODES), nothing more.
 * - `GET /pending`, `POST /pending/register {username, useEmail, turnstile?}`
 *   (`useEmail` is ignored while the email features are off; a new account,
 *   so it takes the human check, lib/turnstile),
 *   `POST /pending/login {login, password, turnstile?}` (a password sign-in,
 *   checked like /login), `DELETE /pending`: the pending identity's page.
 *
 * Linking and unlinking end no session. Start and callback share a per-IP
 * rate limit; the pending forms use sign-up's and sign-in's.
 */

import {
  OAUTH_PROVIDER_LABELS,
  emailSchema,
  loginRequest,
  oauthRegisterRequest,
  oauthStartRequest,
  type OAuthErrorCode,
  type OAuthLinkLoginResponse,
  type OAuthLinkProblem,
  type OAuthPendingResponse,
  type OAuthProvider,
  type OAuthProvidersResponse,
  type OAuthStartResponse,
} from '@gdt/shared'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { getDb } from '../db/client'
import { userSessions, users } from '../db/schema'
import type { AppEnv } from '../env'
import { relyingParty } from '../lib/webauthn'
import { emailFeatures } from '../lib/email'
import { ApiError, clientIp, isUniqueViolation, notFound, parseJson, rateLimit } from '../lib/http'
import {
  OAuthFailure,
  authorizationUrl,
  clearPendingCookie,
  enabledProviders,
  fetchIdentity,
  isProvider,
  newFlow,
  providerConfig,
  readPendingCookie,
  setFlowCookie,
  setPendingCookie,
  stateMatches,
  takeFlowCookie,
  type OAuthFlow,
  type PendingIdentity,
} from '../lib/oauth'
import {
  CSRF_HEADER,
  createSession,
  issueTokens,
  readAccessSession,
  requestOrigin,
  requireActiveSession,
} from '../lib/session'
import { requireHuman, turnstileConfig } from '../lib/turnstile'
import {
  createUserWithIdentity,
  linkIdentity,
  signInUser,
  suggestUsername,
} from '../services/identities'
import { signupMode } from '../services/staff-deps'
import {
  assertSignupsOpen,
  confirmEmailLater,
  meOf,
  notifySignInAdded,
  passwordSignIn,
  toMe,
} from './auth'

const requireCsrf: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.header(CSRF_HEADER) !== '1') {
    throw new ApiError(403, 'csrf', `Missing ${CSRF_HEADER} header`)
  }
  await next()
}

function providerParam(c: Context<AppEnv>): OAuthProvider {
  const provider = c.req.param('provider')
  if (!isProvider(provider)) throw notFound('Provider')
  return provider
}

function configOrThrow(c: Context<AppEnv>, provider: OAuthProvider) {
  const config = providerConfig(c.env, c.req.url, provider)
  if (!config) {
    throw new ApiError(
      404,
      'provider_unavailable',
      `${OAUTH_PROVIDER_LABELS[provider]} sign-in is not available`,
    )
  }
  return config
}

const pendingExpired = () =>
  new ApiError(410, 'pending_expired', 'That sign-in ran out, start it again')

/** Back to the page the round trip started from, with only a short code. */
function fail(c: Context<AppEnv>, intent: OAuthFlow['intent'] | undefined, code: OAuthErrorCode) {
  const page = intent === 'link' ? '/app/settings' : '/login'
  return c.redirect(`${page}?oauth_error=${code}`, 302)
}

/** Links to the user and mails a notice; the outcome as a link problem, if any. */
async function linkTo(
  c: Context<AppEnv>,
  user: typeof users.$inferSelect,
  identity: PendingIdentity,
  options: { signedIn: boolean },
): Promise<OAuthLinkProblem | null> {
  const outcome = await linkIdentity(c.env.DB, user.id, identity, options)
  if (outcome === 'taken' || outcome === 'already') return outcome
  if (outcome === 'linked') {
    notifySignInAdded(c, user, `${OAUTH_PROVIDER_LABELS[identity.provider]} sign-in`)
  }
  return null
}

export const oauth = new Hono<AppEnv>()
  .get('/providers', async (c) => {
    c.header('Cache-Control', 'no-store')
    return c.json({
      providers: enabledProviders(c.env, c.req.url),
      emailFeatures: emailFeatures(c.env),
      turnstileSiteKey: turnstileConfig(c.env)?.siteKey ?? null,
      signups: await signupMode(c.env.DB),
      passkeys: relyingParty(c.req.url) !== null,
    } satisfies OAuthProvidersResponse)
  })

  .post('/:provider/start', requireCsrf, async (c) => {
    const provider = providerParam(c)
    await rateLimit(c.env.AUTH_LIMITER, `oauth:${clientIp(c)}`)
    const config = configOrThrow(c, provider)
    const body = await parseJson(c, oauthStartRequest)
    const flow = newFlow(config, { intent: 'signin', next: body.next })
    await setFlowCookie(c, flow)
    return c.json({ url: await authorizationUrl(config, flow) } satisfies OAuthStartResponse)
  })

  // An ended session (this device signed out, or every device) can't start a link.
  .post('/:provider/link', requireActiveSession, async (c) => {
    const provider = providerParam(c)
    await rateLimit(c.env.AUTH_LIMITER, `oauth:${clientIp(c)}`)
    const config = configOrThrow(c, provider)
    const [user] = await getDb(c.env.DB)
      .select({ id: users.id, tokenVersion: users.tokenVersion })
      .from(users)
      .where(eq(users.id, c.get('userId')))
    if (!user) throw new ApiError(401, 'session_revoked', 'Session ended, sign in again')
    const sid = c.get('sessionId')!
    const flow = newFlow(config, { intent: 'link', uid: user.id, ver: user.tokenVersion, sid })
    await issueTokens(c, user, sid)
    await setFlowCookie(c, flow)
    return c.json({ url: await authorizationUrl(config, flow) } satisfies OAuthStartResponse)
  })

  .get('/:provider/callback', async (c) => {
    const sealed = await takeFlowCookie(c)
    const intent = sealed.ok ? sealed.value.intent : undefined
    const provider = c.req.param('provider')
    try {
      await rateLimit(c.env.AUTH_LIMITER, `oauth:${clientIp(c)}`)
    } catch {
      return fail(c, intent, 'rate_limited')
    }
    if (!sealed.ok) return fail(c, undefined, sealed.error)
    const flow = sealed.value
    if (flow.provider !== provider || !stateMatches(flow, c.req.query('state'))) {
      return fail(c, intent, 'state')
    }
    const error = c.req.query('error')
    if (error) return fail(c, intent, error === 'access_denied' ? 'denied' : 'failed')
    const code = c.req.query('code')
    if (!code || code.length > 2048) return fail(c, intent, 'failed')
    const config = providerConfig(c.env, c.req.url, flow.provider)
    if (!config) return fail(c, intent, 'unavailable')

    // Linking: the user who started it must still be signed in here, in the
    // same session, and it still active (not signed out since, here or from
    // another device). Checked before the code is spent.
    let linkUser: typeof users.$inferSelect | undefined
    if (flow.intent === 'link') {
      const session = await readAccessSession(c)
      if (!session || session.userId !== flow.uid || session.sid !== (flow.sid ?? 0)) {
        return fail(c, intent, 'session')
      }
      const [row] = await getDb(c.env.DB)
        .select({ user: users })
        .from(users)
        .innerJoin(
          userSessions,
          and(
            eq(userSessions.id, session.sid),
            eq(userSessions.userId, users.id),
            isNull(userSessions.revokedAt),
            gt(userSessions.expiresAt, Date.now()),
          ),
        )
        .where(eq(users.id, flow.uid))
      linkUser = row?.user
      if (!linkUser || linkUser.tokenVersion !== session.tokenVersion) {
        return fail(c, intent, 'session')
      }
    }

    let identity: PendingIdentity
    try {
      identity = await fetchIdentity(config, code, flow)
    } catch (cause) {
      // The step only: never the code, a token or the provider's answer.
      const step = cause instanceof OAuthFailure ? cause.step : 'network'
      console.error('oauth', flow.provider, step)
      return fail(c, intent, 'failed')
    }

    if (linkUser) {
      const problem = await linkTo(c, linkUser, identity, { signedIn: false })
      if (problem) return fail(c, intent, problem)
      return c.redirect(`/app/settings?linked=${flow.provider}`, 302)
    }

    const user = await signInUser(c.env.DB, identity)
    if (user?.suspendedAt != null) {
      clearPendingCookie(c)
      return fail(c, intent, 'suspended')
    }
    if (user) {
      clearPendingCookie(c)
      await createSession(c, user, identity.provider)
      return c.redirect(flow.next ?? '/app', 302)
    }
    await setPendingCookie(c, { ...identity, next: flow.next })
    return c.redirect('/oauth', 302)
  })

  .get('/pending', async (c) => {
    c.header('Cache-Control', 'no-store')
    const identity = await readPendingCookie(c)
    if (!identity) throw pendingExpired()
    return c.json({
      provider: identity.provider,
      displayName: identity.displayName,
      email: identity.email,
      emailVerified: identity.emailVerified,
      username: await suggestUsername(c.env.DB, identity),
      next: identity.next ?? null,
    } satisfies OAuthPendingResponse)
  })

  .delete('/pending', requireCsrf, (c) => {
    clearPendingCookie(c)
    return c.body(null, 204)
  })

  /** A new account for the pending identity: no password, signed in. */
  .post('/pending/register', requireCsrf, async (c) => {
    await rateLimit(c.env.AUTH_LIMITER, `register:${clientIp(c)}`)
    await assertSignupsOpen(c, 'oauth')
    const body = await parseJson(c, oauthRegisterRequest)
    await requireHuman(c, body.turnstile, ['register'])
    const identity = await readPendingCookie(c)
    if (!identity) throw pendingExpired()
    // The provider's email is only offered, never trusted: set like a typed one,
    // unconfirmed, with a confirmation link mailed. Not while email is paused.
    const email =
      body.useEmail && emailFeatures(c.env)
        ? (emailSchema.safeParse(identity.email).data ?? null)
        : null
    const origin = requestOrigin(c)
    let user: typeof users.$inferSelect
    try {
      user = await createUserWithIdentity(
        c.env.DB,
        { username: body.username, email, signupIp: origin.ip, signupCountry: origin.country },
        identity,
      )
    } catch (error) {
      if (isUniqueViolation(error, 'users.username_key')) {
        throw new ApiError(409, 'username_taken', 'That username is taken')
      }
      if (isUniqueViolation(error, 'users.email')) {
        throw new ApiError(409, 'email_taken', 'That email is already registered')
      }
      if (isUniqueViolation(error, 'user_identities')) {
        clearPendingCookie(c)
        throw new ApiError(409, 'identity_taken', 'That account is already linked, sign in with it')
      }
      throw error
    }
    clearPendingCookie(c)
    await createSession(c, user, identity.provider)
    confirmEmailLater(c, user)
    return c.json(toMe(user, c.env), 201)
  })

  /**
   * Signs in with a password and links the pending identity to that user.
   * Signed in either way; `problem` says why nothing was linked (the pending
   * identity ran out, or a link conflicts), and Settings can link it then.
   */
  .post('/pending/login', requireCsrf, async (c) => {
    const user = await passwordSignIn(c, await parseJson(c, loginRequest))
    const identity = await readPendingCookie(c)
    const problem: OAuthLinkProblem | null = identity
      ? await linkTo(c, user, identity, { signedIn: true })
      : 'expired'
    clearPendingCookie(c)
    await createSession(c, user, 'password')
    return c.json({
      me: await meOf(c, user),
      linked: problem ? null : identity!.provider,
      problem,
    } satisfies OAuthLinkLoginResponse)
  })
