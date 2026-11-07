/**
 * Passkeys (`/api/auth/passkeys`, docs/plans/open-site.md §5): one more way
 * in beside a password, Discord and Google. Registering, renaming and
 * removing need an active session (like linking a provider); signing in
 * with one makes a `passkey` session row, the same cookies as a password.
 * Turnstile and Argon2 are skipped (there is no password to guess); the
 * per-IP limiter stays. The ceremonies' checks are in lib/webauthn.
 */

import {
  passkeyLoginRequest,
  passkeyRegisterRequest,
  passkeyRenameRequest,
  type PasskeyCreationOptions,
  type PasskeyRequestOptions,
  type PasskeyResponse,
} from '@gdt/shared'
import { and, desc, eq } from 'drizzle-orm'
import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { getDb } from '../db/client'
import { passkeys as passkeyTable, users } from '../db/schema'
import type { AppEnv } from '../env'
import {
  ApiError,
  clientIp,
  idParam,
  isUniqueViolation,
  notFound,
  parseJson,
  rateLimit,
} from '../lib/http'
import { clearPendingCookie } from '../lib/oauth'
import { sha256Hex } from '../lib/crypto'
import { CSRF_HEADER, createSession, jwtSecret, requireActiveSession } from '../lib/session'
import {
  COSE_ALGORITHMS,
  LOGIN_TTL_MS,
  PasskeyError,
  REGISTER_TTL_MS,
  aaguidName,
  makeChallenge,
  relyingParty,
  userHandle,
  verifyAssertion,
  verifyRegistration,
  type RelyingParty,
} from '../lib/webauthn'
import { meOf, notifySignInAdded, suspendedError } from './auth'

/** Passkeys per user. */
export const MAX_PASSKEYS = 20

const requireCsrf: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.header(CSRF_HEADER) !== '1')
    throw new ApiError(403, 'csrf', `Missing ${CSRF_HEADER} header`)
  await next()
}

/** This host's relying party; 404 `passkeys_unavailable` where passkeys are off. */
function rpOf(c: Context<AppEnv>): RelyingParty {
  const rp = relyingParty(c.req.url)
  if (!rp) throw new ApiError(404, 'passkeys_unavailable', 'Passkeys work on teyvat.me only')
  return rp
}

/** A refused ceremony: one code per reason, a short message. */
function refused(error: unknown, status: 400 | 401): never {
  if (error instanceof PasskeyError) {
    throw new ApiError(
      status,
      `passkey_${error.reason}`,
      error.reason === 'expired' ? 'That took too long, try again' : 'The passkey was not accepted',
    )
  }
  throw error
}

/**
 * Records a challenge as answered; false when it already was (a second
 * use, or two tabs racing with one answer).
 */
async function useChallenge(
  d1: D1Database,
  challenge: string,
  expiresAt: number,
): Promise<boolean> {
  const row = await d1
    .prepare(
      `INSERT INTO passkey_challenges (challenge_hash, expires_at) VALUES (?1, ?2)
       ON CONFLICT DO NOTHING RETURNING challenge_hash`,
    )
    .bind(await sha256Hex(challenge), expiresAt)
    .first()
  return row !== null
}

const reusedChallenge = () => new ApiError(401, 'passkey_challenge', 'The passkey was not accepted')

const toResponse = (row: typeof passkeyTable.$inferSelect): PasskeyResponse => ({
  id: row.id,
  name: row.name,
  createdAt: row.createdAt,
  lastUsedAt: row.lastUsedAt,
})

export const passkeys = new Hono<AppEnv>()
  /** The user's passkeys, newest first. */
  .get('/', requireActiveSession, async (c) => {
    c.header('Cache-Control', 'no-store')
    const rows = await getDb(c.env.DB)
      .select()
      .from(passkeyTable)
      .where(eq(passkeyTable.userId, c.get('userId')))
      .orderBy(desc(passkeyTable.createdAt), desc(passkeyTable.id))
    return c.json(rows.map(toResponse))
  })

  /** Options for `navigator.credentials.create`: a challenge for this user, their passkeys excluded. */
  .post('/options', requireActiveSession, async (c) => {
    const rp = rpOf(c)
    const userId = c.get('userId')
    await rateLimit(c.env.AUTH_LIMITER, `passkey-add:${userId}`)
    const db = getDb(c.env.DB)
    const [[user], existing] = await Promise.all([
      db.select({ username: users.username }).from(users).where(eq(users.id, userId)),
      db
        .select({ id: passkeyTable.credentialId, transports: passkeyTable.transports })
        .from(passkeyTable)
        .where(eq(passkeyTable.userId, userId)),
    ])
    if (!user) throw new ApiError(401, 'unauthenticated', 'Not signed in')
    if (existing.length >= MAX_PASSKEYS) {
      throw new ApiError(409, 'too_many_passkeys', `${MAX_PASSKEYS} passkeys at most`)
    }
    const secret = jwtSecret(c)
    return c.json({
      challenge: await makeChallenge(secret, 'register', userId, REGISTER_TTL_MS),
      rp: { id: rp.id, name: rp.name },
      user: {
        id: await userHandle(secret, userId),
        name: user.username,
        displayName: user.username,
      },
      pubKeyCredParams: COSE_ALGORITHMS.map((alg) => ({ type: 'public-key' as const, alg })),
      timeout: REGISTER_TTL_MS,
      attestation: 'none',
      authenticatorSelection: {
        residentKey: 'required',
        requireResidentKey: true,
        userVerification: 'required',
      },
      excludeCredentials: existing.map((row) => ({
        type: 'public-key' as const,
        id: row.id,
        ...(row.transports?.length ? { transports: row.transports } : {}),
      })),
    } satisfies PasskeyCreationOptions)
  })

  /** Keeps the passkey `navigator.credentials.create` made (201). */
  .post('/', requireActiveSession, async (c) => {
    const rp = rpOf(c)
    const userId = c.get('userId')
    await rateLimit(c.env.AUTH_LIMITER, `passkey-add:${userId}`)
    const body = await parseJson(c, passkeyRegisterRequest)
    const secret = jwtSecret(c)
    const verified = await verifyRegistration(
      { rawId: body.credential.rawId, ...body.credential.response },
      { rp, secret, userId },
    ).catch((error: unknown) => refused(error, 400))
    if (!(await useChallenge(c.env.DB, verified.challenge, verified.challengeExpiresAt))) {
      throw reusedChallenge()
    }
    const db = getDb(c.env.DB)
    const [user] = await db.select().from(users).where(eq(users.id, userId))
    if (!user) throw new ApiError(401, 'unauthenticated', 'Not signed in')
    const count = await c.env.DB.prepare('SELECT count(*) AS n FROM passkeys WHERE user_id = ?1')
      .bind(userId)
      .first<number>('n')
    if ((count ?? 0) >= MAX_PASSKEYS) {
      throw new ApiError(409, 'too_many_passkeys', `${MAX_PASSKEYS} passkeys at most`)
    }
    let row: typeof passkeyTable.$inferSelect
    try {
      ;[row] = (await db
        .insert(passkeyTable)
        .values({
          userId,
          credentialId: verified.credentialId,
          publicKey: verified.publicKey,
          algorithm: verified.algorithm,
          signCount: verified.signCount,
          transports: body.credential.response.transports ?? null,
          aaguid: verified.aaguid,
          userHandle: await userHandle(secret, userId),
          name: body.name ?? aaguidName(verified.aaguid) ?? 'Passkey',
        })
        .returning()) as [typeof passkeyTable.$inferSelect]
    } catch (error) {
      if (isUniqueViolation(error, 'passkeys')) {
        throw new ApiError(409, 'passkey_exists', 'That passkey is already added')
      }
      throw error
    }
    notifySignInAdded(c, user, 'A passkey')
    return c.json(toResponse(row), 201)
  })

  .patch('/:id', requireActiveSession, async (c) => {
    const userId = c.get('userId')
    await rateLimit(c.env.AUTH_LIMITER, `passkey:${userId}`)
    const { name } = await parseJson(c, passkeyRenameRequest)
    const [row] = await getDb(c.env.DB)
      .update(passkeyTable)
      .set({ name })
      .where(and(eq(passkeyTable.id, idParam(c, 'id')), eq(passkeyTable.userId, userId)))
      .returning()
    if (!row) throw notFound('Passkey')
    return c.json(toResponse(row))
  })

  /** Removes a passkey, unless it is the account's last way in (409 `last_sign_in`). */
  .delete('/:id', requireActiveSession, async (c) => {
    const userId = c.get('userId')
    const id = idParam(c, 'id')
    await rateLimit(c.env.AUTH_LIMITER, `passkey:${userId}`)
    // One statement, so two removals racing can't take both last ways in.
    const removed = await c.env.DB.prepare(
      `DELETE FROM passkeys
       WHERE id = ?1 AND user_id = ?2
         AND ((SELECT password_hash FROM users WHERE id = ?2) <> ''
              OR EXISTS (SELECT 1 FROM user_identities WHERE user_id = ?2)
              OR (SELECT count(*) FROM passkeys WHERE user_id = ?2) > 1)
       RETURNING id`,
    )
      .bind(id, userId)
      .first()
    if (removed) return c.body(null, 204)
    const exists = await c.env.DB.prepare('SELECT 1 FROM passkeys WHERE id = ?1 AND user_id = ?2')
      .bind(id, userId)
      .first()
    if (!exists) throw notFound('Passkey')
    throw new ApiError(
      409,
      'last_sign_in',
      'Set a password or link another account before removing your last passkey',
    )
  })

  /**
   * Options for `navigator.credentials.get`: a sign-in challenge, no
   * credentials named (the browser offers the passkeys it holds for this
   * site). Stateless: the login page asks on every visit.
   */
  .post('/login/options', requireCsrf, async (c) => {
    const rp = rpOf(c)
    c.header('Cache-Control', 'no-store')
    return c.json({
      challenge: await makeChallenge(jwtSecret(c), 'login', null, LOGIN_TTL_MS),
      rpId: rp.id,
      timeout: LOGIN_TTL_MS,
      userVerification: 'required',
    } satisfies PasskeyRequestOptions)
  })

  /** Signs in with a passkey: a `passkey` session on this device. */
  .post('/login', requireCsrf, async (c) => {
    const rp = rpOf(c)
    await rateLimit(c.env.AUTH_LIMITER, `passkey-login:${clientIp(c)}`)
    const { credential } = await parseJson(c, passkeyLoginRequest)
    const [found] = await getDb(c.env.DB)
      .select({ passkey: passkeyTable, user: users })
      .from(passkeyTable)
      .innerJoin(users, eq(users.id, passkeyTable.userId))
      .where(eq(passkeyTable.credentialId, credential.rawId))
    const handle = credential.response.userHandle
    if (!found || (handle && handle !== found.passkey.userHandle)) {
      // Removed from the account (or never added): the page can tell the browser so.
      throw new ApiError(401, 'passkey_unknown', 'That passkey is not on any account')
    }
    const { passkey, user } = found
    const verified = await verifyAssertion(credential.response, passkey, {
      rp,
      secret: jwtSecret(c),
    }).catch((error: unknown) => refused(error, 401))
    if (user.suspendedAt !== null) throw suspendedError()
    if (!(await useChallenge(c.env.DB, verified.challenge, verified.challengeExpiresAt))) {
      throw reusedChallenge()
    }
    // Guarded again here: two sign-ins racing with one count can't both pass.
    const counted = await c.env.DB.prepare(
      `UPDATE passkeys SET sign_count = ?2, last_used_at = ?3
       WHERE id = ?1 AND (sign_count < ?2 OR (?2 = 0 AND sign_count = 0))
       RETURNING id`,
    )
      .bind(passkey.id, verified.signCount, Date.now())
      .first()
    if (!counted) throw new ApiError(401, 'passkey_counter', 'The passkey was not accepted')
    // A provider account left waiting in this browser is not this user's to link.
    clearPendingCookie(c)
    await createSession(c, user, 'passkey')
    return c.json(await meOf(c, user))
  })
