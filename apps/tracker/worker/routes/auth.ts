import {
  OAUTH_PROVIDER_LABELS,
  USER_SETTINGS_DEFAULTS,
  changePasswordRequest,
  deepMerge,
  deleteSelfRequest,
  loginRequest,
  readDeviceAlerts,
  tabBarPages,
  registerRequest,
  sessionPatchRequest,
  setPasswordRequest,
  updateProfileRequest,
  type DeviceAlerts,
  type IdentitiesResponse,
  type MeResponse,
  type SessionResponse,
  type SessionUpload,
  type UserSettings,
} from '@gdt/shared'
import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm'
import { Hono, type Context } from 'hono'
import type { z } from 'zod'
import { getDb } from '../db/client'
import { userSessions, users } from '../db/schema'
import type { AppEnv } from '../env'
import { emailEnabled, emailFeatures, linkOrigin, sendMail, signInAddedMail } from '../lib/email'
import { siteName } from '../lib/site'
import {
  ApiError,
  clientIp,
  idParam,
  isUniqueViolation,
  notFound,
  parseJson,
  rateLimit,
} from '../lib/http'
import { clearPendingCookie, enabledProviders, isProvider } from '../lib/oauth'
import { hashPassword, verifyPassword } from '../lib/password'
import { requireHuman } from '../lib/turnstile'
import {
  browserSession,
  clearSessionCookies,
  createSession,
  endSession,
  issueTokens,
  refreshSession,
  requestOrigin,
  requireActiveSession,
  requireUser,
  revokeAllSessions,
} from '../lib/session'
import { auditStatement } from '../services/audit'
import { closeResetLinks, mailVerification } from '../services/auth-tokens'
import { editableBy } from '../services/accounts'
import { listIdentities, unlinkIdentity } from '../services/identities'
import { devicesChanged } from '../services/live'
import { meFromResults, meStatements, type MeSource } from '../services/me'
import { userPermissions } from '../services/roles'
import { signupMode } from '../services/staff-deps'
import { deleteUsers, isLastOwner } from '../services/user-delete'

type User = typeof users.$inferSelect

/** An irminsul session's upload target as the Devices panel shows it (null: a browser). */
function sessionUpload(
  mode: 'uid' | 'account' | null,
  accountId: number | null,
): SessionUpload | null {
  if (mode === 'uid') return { mode: 'uid' }
  if (mode === 'account') return { mode: 'account', accountId }
  return null
}

/** Points an irminsul session's uploads at `upload` (404 for any other session). */
async function setSessionUpload(
  c: Context<AppEnv>,
  userId: number,
  id: number,
  upload: z.infer<typeof sessionPatchRequest>['upload'] & object,
): Promise<SessionUpload> {
  const accountId = upload.mode === 'account' ? upload.account_id : null
  const d1 = c.env.DB
  const [updated, owned] = await d1.batch<{ id: number }>([
    d1
      .prepare(
        `UPDATE user_sessions SET upload_mode = ?3, upload_account_id = ?4
         WHERE id = ?1 AND user_id = ?2 AND method = 'irminsul' AND revoked_at IS NULL
           AND expires_at > ?5
           AND (?4 IS NULL OR ${editableBy('?4', '?2')})
         RETURNING id`,
      )
      .bind(id, userId, upload.mode, accountId, Date.now()),
    d1.prepare(`SELECT ?1 AS id WHERE ${editableBy('?1', '?2')}`).bind(accountId, userId),
  ])
  if (updated!.results.length === 0) {
    if (accountId !== null && owned!.results.length === 0) {
      throw new ApiError(400, 'invalid_account', 'That account is not yours', [
        { path: 'upload.account_id', message: 'Not your account' },
      ])
    }
    throw notFound('Session')
  }
  return sessionUpload(upload.mode, accountId)!
}

/** Argon2's secret input; see lib/password. */
export function pepper(c: Context<AppEnv>): string {
  const secret = c.env.PASSWORD_PEPPER
  if (!secret || secret.length < 32) {
    throw new ApiError(500, 'misconfigured', 'Server is missing PASSWORD_PEPPER')
  }
  return secret
}

/** A bar saved empty (allowed until TAB_BAR_MIN) is read as the default pages. */
function withTabBar(settings: UserSettings): UserSettings {
  return { ...settings, tabBar: tabBarPages(settings.tabBar) }
}

export function toMe(user: MeSource, env: Env, permissions: string[] = []): MeResponse {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    emailVerified: user.emailVerified,
    settings: withTabBar(deepMerge(USER_SETTINGS_DEFAULTS, user.settings)),
    hasImportKey: user.importKeyHash !== null,
    emailEnabled: emailEnabled(env),
    emailFeatures: emailFeatures(env),
    hasPassword: user.passwordHash !== '',
    permissions,
  }
}

/** `toMe` with the user's staff permissions (one small read). */
export async function meOf(c: Context<AppEnv>, user: User): Promise<MeResponse> {
  return toMe(user, c.env, await userPermissions(c.env.DB, user.id))
}

/** A suspended user can't sign in, refresh a session or upload with a key (staff dashboard). */
export const suspendedError = () =>
  new ApiError(
    403,
    'account_suspended',
    'This account is suspended. Ask on Discord if you think it is a mistake.',
  )

/** Refused while the staff switch says no (`signup.mode`): `oauth` still lets providers sign up. */
export async function assertSignupsOpen(
  c: Context<AppEnv>,
  via: 'password' | 'oauth',
): Promise<void> {
  const mode = await signupMode(c.env.DB)
  if (mode === 'open' || (mode === 'oauth' && via === 'oauth')) return
  throw new ApiError(
    403,
    'signups_closed',
    mode === 'oauth'
      ? 'New accounts sign up with Discord or Google for now'
      : 'Sign-ups are closed for now',
  )
}

/**
 * Mails a confirmation link for a just-set email after the response. Best
 * effort: skipped past the per-IP limit (sign-ups could otherwise mail any
 * number of strangers), and Settings can always send another.
 */
export function confirmEmailLater(c: Context<AppEnv>, user: User): void {
  if (!user.email || user.emailVerified || !emailEnabled(c.env)) return
  const target = { id: user.id, email: user.email }
  const origin = linkOrigin(c.env, c.req.url)
  const limiter = c.env.RECOVERY_LIMITER
  c.executionCtx.waitUntil(
    (async () => {
      if (limiter && !(await limiter.limit({ key: `confirm:${clientIp(c)}` })).success) return
      await mailVerification(c.env, target, origin)
    })().catch((error: unknown) => console.error('verify-email mail', String(error).slice(0, 120))),
  )
}

async function findByLogin(c: Context<AppEnv>, login: string): Promise<User | undefined> {
  const [user] = await getDb(c.env.DB)
    .select()
    .from(users)
    .where(or(eq(users.usernameKey, login), eq(users.email, login)))
    .limit(1)
  return user
}

const invalidCredentials = () =>
  new ApiError(401, 'invalid_credentials', 'Wrong username, email or password')

/** Sign-up while the email features are off: an `email` sent anyway is dropped, not refused. */
const registerWithoutEmail = registerRequest.omit({ email: true })

/**
 * Checks a username-or-email and password (rate limited per IP, the human
 * check, then per name, so a bot without a token can't use up someone's
 * budget; an account without a password never matches), upgrading an old
 * hash. Starts no session: the caller does.
 */
export async function passwordSignIn(
  c: Context<AppEnv>,
  body: z.output<typeof loginRequest>,
): Promise<User> {
  await rateLimit(c.env.AUTH_LIMITER, `login:${clientIp(c)}`)
  await requireHuman(c, body.turnstile, ['login'])
  await rateLimit(c.env.AUTH_LIMITER, `login:${body.login}`)
  const user = await findByLogin(c, body.login)
  const check = verifyPassword(body.password, user?.passwordHash, pepper(c))
  if (!user || !check.ok) throw invalidCredentials()
  // Only told to someone who knows the password.
  if (user.suspendedAt !== null) throw suspendedError()
  if (check.rehash) {
    // Hashed under older Argon2 parameters: upgrade while the password is at hand.
    await getDb(c.env.DB)
      .update(users)
      .set({ passwordHash: hashPassword(body.password, pepper(c)) })
      .where(eq(users.id, user.id))
  }
  return user
}

/**
 * Mails "<what> can now sign in to your account" to a confirmed email, after
 * the response. Best effort, like every notice.
 */
export function notifySignInAdded(c: Context<AppEnv>, user: User, what: string): void {
  if (!user.email || !user.emailVerified || !emailEnabled(c.env)) return
  c.executionCtx.waitUntil(
    sendMail(
      c.env,
      signInAddedMail(
        user.email,
        linkOrigin(c.env, c.req.url),
        user.username,
        what,
        siteName(c.env),
      ),
    ).then(() => undefined),
  )
}

export const auth = new Hono<AppEnv>()
  /**
   * While the email features are off, an `email` is ignored (not even
   * validated): the app no longer asks for one, and a page cached from
   * before still signs up, without it, rather than failing.
   */
  .post('/register', async (c) => {
    await rateLimit(c.env.AUTH_LIMITER, `register:${clientIp(c)}`)
    await assertSignupsOpen(c, 'password')
    const body = emailFeatures(c.env)
      ? await parseJson(c, registerRequest)
      : { ...(await parseJson(c, registerWithoutEmail)), email: null }
    // Before the ~200 ms hash and the insert.
    await requireHuman(c, body.turnstile, ['register'])
    const origin = requestOrigin(c)
    let user: User
    try {
      ;[user] = (await getDb(c.env.DB)
        .insert(users)
        .values({
          username: body.username,
          usernameKey: body.username.toLowerCase(),
          email: body.email ?? null,
          passwordHash: hashPassword(body.password, pepper(c)),
          signupIp: origin.ip,
          signupCountry: origin.country,
        })
        .returning()) as [User]
    } catch (error) {
      if (isUniqueViolation(error, 'users')) {
        throw new ApiError(409, 'taken', 'That username or email is already registered')
      }
      throw error
    }
    clearPendingCookie(c)
    await createSession(c, user, 'password')
    confirmEmailLater(c, user)
    return c.json(toMe(user, c.env), 201)
  })

  .post('/login', async (c) => {
    const user = await passwordSignIn(c, await parseJson(c, loginRequest))
    // A provider account left waiting in this browser is not this user's to link.
    clearPendingCookie(c)
    await createSession(c, user, 'password')
    return c.json(await meOf(c, user))
  })

  .post('/refresh', async (c) => {
    await refreshSession(c)
    return c.body(null, 204)
  })

  /** Signs this device out: its session ends, so a copy of its refresh token is refused too. */
  .post('/logout', async (c) => {
    const session = await browserSession(c)
    if (session) await endSession(c.env, session.userId, session.sid)
    clearSessionCookies(c)
    clearPendingCookie(c)
    return c.body(null, 204)
  })

  /** Signs every device out, this one included. */
  .post('/logout-all', requireActiveSession, async (c) => {
    await revokeAllSessions(c, c.get('userId'))
    clearSessionCookies(c)
    return c.body(null, 204)
  })

  /** The user's signed-in devices, the most recently seen first. */
  .get('/sessions', requireActiveSession, async (c) => {
    c.header('Cache-Control', 'no-store')
    const current = c.get('sessionId')
    const rows = await getDb(c.env.DB)
      .select({
        id: userSessions.id,
        method: userSessions.method,
        userAgent: userSessions.userAgent,
        ip: userSessions.ip,
        country: userSessions.country,
        city: userSessions.city,
        createdAt: userSessions.createdAt,
        lastSeenAt: userSessions.lastSeenAt,
        deviceName: userSessions.deviceName,
        uploadMode: userSessions.uploadMode,
        uploadAccountId: userSessions.uploadAccountId,
        alerts: userSessions.alerts,
        push: sql<number>`EXISTS (SELECT 1 FROM push_subscriptions AS p WHERE p.session_id = ${userSessions.id})`,
      })
      .from(userSessions)
      .where(
        and(
          eq(userSessions.userId, c.get('userId')),
          isNull(userSessions.revokedAt),
          gt(userSessions.expiresAt, Date.now()),
        ),
      )
      .orderBy(desc(userSessions.lastSeenAt), desc(userSessions.id))
    return c.json(
      rows.map(
        ({ uploadMode, uploadAccountId, alerts, push, ...row }): SessionResponse => ({
          ...row,
          current: row.id === current,
          upload: sessionUpload(uploadMode, uploadAccountId),
          alerts: alerts ? readDeviceAlerts(alerts) : null,
          push: Boolean(push),
        }),
      ),
    )
  })

  /**
   * A device's settings: where an irminsul session's uploads go from now on
   * (its next upload; the app reads the target again from whoami; 404 for a
   * browser) and/or what the device is alerted about (any device;
   * docs/plans/capture-link.md).
   */
  .patch('/sessions/:id', requireActiveSession, async (c) => {
    const userId = c.get('userId')
    const id = idParam(c, 'id')
    await rateLimit(c.env.AUTH_LIMITER, `sessions:${userId}`)
    const { upload, alerts } = await parseJson(c, sessionPatchRequest)
    const answer: { upload?: SessionUpload; alerts?: DeviceAlerts } = {}
    if (upload) answer.upload = await setSessionUpload(c, userId, id, upload)
    if (alerts) {
      const row = await c.env.DB.prepare(
        `SELECT alerts FROM user_sessions
         WHERE id = ?1 AND user_id = ?2 AND revoked_at IS NULL AND expires_at > ?3`,
      )
        .bind(id, userId, Date.now())
        .first<{ alerts: string | null }>()
      if (!row) throw notFound('Session')
      const next = { ...readDeviceAlerts(row.alerts ? JSON.parse(row.alerts) : null), ...alerts }
      await c.env.DB.batch([
        c.env.DB.prepare('UPDATE user_sessions SET alerts = ?2 WHERE id = ?1').bind(
          id,
          JSON.stringify(next),
        ),
        // Writes start telling the hub; it clears the flag when no device is left.
        c.env.DB.prepare(
          'UPDATE users SET alerts_on = ?2 WHERE id = ?1 AND alerts_on IS NULL',
        ).bind(userId, Date.now()),
      ])
      await devicesChanged(c, userId)
      answer.alerts = next
    }
    return c.json(answer)
  })

  /**
   * Signs one device out: its refresh is refused from now on and its live
   * socket closes (its page then finds it is signed out). This device's own
   * is a sign-out here.
   */
  .delete('/sessions/:id', requireActiveSession, async (c) => {
    const userId = c.get('userId')
    const id = idParam(c, 'id')
    await rateLimit(c.env.AUTH_LIMITER, `sessions:${userId}`)
    if (!(await endSession(c.env, userId, id))) throw notFound('Session')
    if (id === c.get('sessionId')) clearSessionCookies(c)
    return c.body(null, 204)
  })

  /**
   * Signs every other device out; this one stays, with new tokens. Bumps the
   * token version, so devices signed in before sessions were listed go too.
   */
  .post('/sessions/revoke-others', requireActiveSession, async (c) => {
    const userId = c.get('userId')
    const sid = c.get('sessionId')!
    await rateLimit(c.env.AUTH_LIMITER, `sessions:${userId}`)
    const user = await revokeAllSessions(c, userId, { keep: sid })
    await issueTokens(c, user, sid)
    return c.body(null, 204)
  })

  /** The user and their staff nodes: one D1 round trip. */
  .get('/me', requireUser, async (c) => {
    const userId = c.get('userId')
    const [user, roles] = await c.env.DB.batch(meStatements(c.env.DB, userId))
    const found = meFromResults(userId, user, roles)
    if (!found) throw new ApiError(401, 'unauthenticated', 'Not signed in')
    return c.json(toMe(found.user, c.env, found.permissions))
  })

  /**
   * Deletes the signed-in user and everything they own (accounts, snapshots,
   * keys, sign-ins), after they typed their username. Signs this device out;
   * other devices' sockets close. The last Owner can't (409 `last_owner`).
   */
  .delete('/account', requireActiveSession, async (c) => {
    const userId = c.get('userId')
    await rateLimit(c.env.AUTH_LIMITER, `delete-self:${userId}`)
    const body = await parseJson(c, deleteSelfRequest)
    const [user] = await getDb(c.env.DB).select().from(users).where(eq(users.id, userId))
    if (!user) throw new ApiError(401, 'unauthenticated', 'Not signed in')
    if (body.username.toLowerCase() !== user.usernameKey) {
      throw new ApiError(400, 'confirm_mismatch', 'Type your username to confirm', [
        { path: 'username', message: 'Not your username' },
      ])
    }
    if (await isLastOwner(c.env.DB, userId)) {
      throw new ApiError(409, 'last_owner', 'Give the Owner role to someone else first')
    }
    const actor = { userId, username: user.username }
    await deleteUsers(
      c.env,
      [{ id: userId, liveSince: user.liveSince }],
      [
        auditStatement(c.env.DB, actor, {
          action: 'user.delete_self',
          target: { id: userId, label: user.username },
        }),
      ],
    )
    clearSessionCookies(c)
    clearPendingCookie(c)
    return c.body(null, 204)
  })

  /**
   * Changes the username and/or email (the user chose not to ask for the
   * password here). While the email features are off, the email can only be
   * removed: another address is 403 `email_paused`.
   */
  .patch('/profile', requireActiveSession, async (c) => {
    const userId = c.get('userId')
    await rateLimit(c.env.AUTH_LIMITER, `profile:${userId}`)
    const body = await parseJson(c, updateProfileRequest)
    const db = getDb(c.env.DB)
    const [user] = await db.select().from(users).where(eq(users.id, userId))
    if (!user) throw new ApiError(401, 'unauthenticated', 'Not signed in')
    const changes: Partial<typeof users.$inferInsert> = {}
    if (body.username !== undefined && body.username !== user.username) {
      changes.username = body.username
      changes.usernameKey = body.username.toLowerCase()
    }
    if (body.email !== undefined && body.email !== user.email) {
      if (body.email !== null && !emailFeatures(c.env)) {
        throw new ApiError(403, 'email_paused', "An email can't be added or changed right now")
      }
      changes.email = body.email
      // Verification belongs to the address, not the account.
      changes.emailVerified = false
    }
    if (Object.keys(changes).length === 0) return c.json(await meOf(c, user))
    try {
      const [updated] = (await db
        .update(users)
        .set(changes)
        .where(eq(users.id, userId))
        .returning()) as [User]
      if (changes.email !== undefined) {
        // Reset links mailed to the old address die with it; the new one gets a confirmation.
        await closeResetLinks(c.env.DB, userId, { mailedOnly: true })
        confirmEmailLater(c, updated)
      }
      return c.json(await meOf(c, updated))
    } catch (error) {
      if (isUniqueViolation(error, 'users.username_key')) {
        throw new ApiError(409, 'username_taken', 'That username is taken')
      }
      if (isUniqueViolation(error, 'users.email')) {
        throw new ApiError(409, 'email_taken', 'That email is already registered')
      }
      throw error
    }
  })

  /**
   * Changing the password signs every other device out (this one stays signed
   * in, the same session with new tokens) and ends any open reset link.
   */
  .post('/password', requireActiveSession, async (c) => {
    const userId = c.get('userId')
    await rateLimit(c.env.AUTH_LIMITER, `password:${userId}`)
    const body = await parseJson(c, changePasswordRequest)
    const [user] = await getDb(c.env.DB).select().from(users).where(eq(users.id, userId))
    if (!user || !verifyPassword(body.currentPassword, user.passwordHash, pepper(c)).ok) {
      throw invalidCredentials()
    }
    const sid = c.get('sessionId')
    const updated = await revokeAllSessions(c, userId, {
      set: { passwordHash: hashPassword(body.newPassword, pepper(c)) },
      keep: sid,
    })
    await closeResetLinks(c.env.DB, userId)
    if (sid === null) await createSession(c, updated, 'password')
    else await issueTokens(c, updated, sid)
    return c.body(null, 204)
  })

  /**
   * A first password for an account made with Discord or Google: only a
   * session, no current password (there is none). Ends any open reset link;
   * signs no one out (nothing was replaced).
   */
  .post('/password/set', requireActiveSession, async (c) => {
    const userId = c.get('userId')
    await rateLimit(c.env.AUTH_LIMITER, `password:${userId}`)
    const body = await parseJson(c, setPasswordRequest)
    const passwordHash = hashPassword(body.password, pepper(c))
    // Conditional, so it can never stand in for "change password" without the current one.
    const [user] = (await getDb(c.env.DB)
      .update(users)
      .set({ passwordHash })
      .where(and(eq(users.id, userId), eq(users.passwordHash, '')))
      .returning()) as User[]
    if (!user) throw new ApiError(409, 'has_password', 'This account already has a password')
    await closeResetLinks(c.env.DB, userId)
    notifySignInAdded(c, user, 'A password')
    return c.json(await meOf(c, user))
  })

  /** Sign-in providers on this server, and the ones linked to this user. */
  .get('/identities', requireUser, async (c) => {
    c.header('Cache-Control', 'no-store')
    return c.json({
      providers: enabledProviders(c.env, c.req.url),
      identities: await listIdentities(c.env.DB, c.get('userId')),
    } satisfies IdentitiesResponse)
  })

  /** Unlinks a provider, unless it is the account's last way in (409 `last_sign_in`). */
  .delete('/identities/:provider', requireActiveSession, async (c) => {
    const provider = c.req.param('provider')
    if (!isProvider(provider)) throw notFound('Identity')
    const userId = c.get('userId')
    await rateLimit(c.env.AUTH_LIMITER, `identity:${userId}`)
    const outcome = await unlinkIdentity(c.env.DB, userId, provider)
    if (outcome === 'missing') throw notFound('Identity')
    if (outcome === 'last') {
      throw new ApiError(
        409,
        'last_sign_in',
        `Set a password or link another account before unlinking ${OAUTH_PROVIDER_LABELS[provider]}`,
      )
    }
    return c.body(null, 204)
  })
