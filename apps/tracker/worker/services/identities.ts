/**
 * Linked sign-in identities (table `user_identities`, migration 0015).
 *
 * - An identity is linked only after a completed sign-in at the provider:
 *   to the signed-in user (Settings), to a user who then proved their
 *   password, or to a new user made for it. Never by matching an email.
 * - Unique per (provider, provider account) and per (user, provider); the
 *   inserts lean on those indexes, so two racing links can't both win.
 * - Unlinking keeps a way in: a single conditional DELETE refuses to remove
 *   the last identity of a user without a password.
 */

import { usernameSchema, type IdentityResponse, type OAuthProvider } from '@gdt/shared'
import { and, eq } from 'drizzle-orm'
import { getDb } from '../db/client'
import { userIdentities, users } from '../db/schema'
import type { PendingIdentity } from '../lib/oauth'

type User = typeof users.$inferSelect

/** The provider's details kept on the row (refreshed at every sign-in). */
const details = (identity: PendingIdentity) => ({
  email: identity.email,
  emailVerified: identity.emailVerified,
  displayName: identity.displayName,
  avatarUrl: identity.avatarUrl,
})

/** The user this provider account signs in to (and the identity row's last use is now). */
export async function signInUser(
  d1: D1Database,
  identity: PendingIdentity,
  now = Date.now(),
): Promise<User | null> {
  const [row] = await getDb(d1)
    .update(userIdentities)
    .set({ ...details(identity), lastUsedAt: now })
    .where(
      and(
        eq(userIdentities.provider, identity.provider),
        eq(userIdentities.providerUserId, identity.sub),
      ),
    )
    .returning({ userId: userIdentities.userId })
  if (!row) return null
  const [user] = await getDb(d1).select().from(users).where(eq(users.id, row.userId))
  return user ?? null
}

/**
 * - `linked`: now linked to the user.
 * - `same`: it already was (details refreshed).
 * - `taken`: linked to another user.
 * - `already`: the user has another account of this provider linked.
 */
export type LinkOutcome = 'linked' | 'same' | 'taken' | 'already'

export async function linkIdentity(
  d1: D1Database,
  userId: number,
  identity: PendingIdentity,
  options: { signedIn?: boolean; now?: number } = {},
): Promise<LinkOutcome> {
  const now = options.now ?? Date.now()
  const db = getDb(d1)
  const [inserted] = await db
    .insert(userIdentities)
    .values({
      userId,
      provider: identity.provider,
      providerUserId: identity.sub,
      ...details(identity),
      createdAt: now,
      lastUsedAt: options.signedIn ? now : null,
    })
    .onConflictDoNothing()
    .returning({ id: userIdentities.id })
  if (inserted) return 'linked'
  const [existing] = await db
    .select({ id: userIdentities.id, userId: userIdentities.userId })
    .from(userIdentities)
    .where(
      and(
        eq(userIdentities.provider, identity.provider),
        eq(userIdentities.providerUserId, identity.sub),
      ),
    )
  if (!existing) return 'already'
  if (existing.userId !== userId) return 'taken'
  await db
    .update(userIdentities)
    .set({ ...details(identity), ...(options.signedIn ? { lastUsedAt: now } : {}) })
    .where(eq(userIdentities.id, existing.id))
  return 'same'
}

/**
 * A new user for a provider account nobody has linked: no password (it signs
 * in with the provider until it sets one). User and identity are written in
 * one batch, so a lost race (the identity linked meanwhile) leaves no user.
 */
export async function createUserWithIdentity(
  d1: D1Database,
  account: {
    username: string
    email: string | null
    /** Where the sign-up came from (users.signup_ip, signup_country). */
    signupIp?: string | null
    signupCountry?: string | null
  },
  identity: PendingIdentity,
  now = Date.now(),
): Promise<User> {
  const db = getDb(d1)
  const usernameKey = account.username.toLowerCase()
  await d1.batch([
    d1
      .prepare(
        `INSERT INTO users (username, username_key, email, email_verified, password_hash, token_version, settings, created_at, signup_ip, signup_country)
         VALUES (?1, ?2, ?3, 0, '', 0, '{}', ?4, ?5, ?6)`,
      )
      .bind(
        account.username,
        usernameKey,
        account.email,
        now,
        account.signupIp ?? null,
        account.signupCountry ?? null,
      ),
    d1
      .prepare(
        `INSERT INTO user_identities (user_id, provider, provider_user_id, email, email_verified, display_name, avatar_url, created_at, last_used_at)
         SELECT id, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8 FROM users WHERE username_key = ?1`,
      )
      .bind(
        usernameKey,
        identity.provider,
        identity.sub,
        identity.email,
        identity.emailVerified ? 1 : 0,
        identity.displayName,
        identity.avatarUrl,
        now,
      ),
  ])
  const [user] = await db.select().from(users).where(eq(users.usernameKey, usernameKey))
  if (!user) throw new Error('user missing after insert')
  return user
}

export async function listIdentities(d1: D1Database, userId: number): Promise<IdentityResponse[]> {
  const rows = await getDb(d1)
    .select({
      provider: userIdentities.provider,
      displayName: userIdentities.displayName,
      email: userIdentities.email,
      emailVerified: userIdentities.emailVerified,
      avatarUrl: userIdentities.avatarUrl,
      createdAt: userIdentities.createdAt,
      lastUsedAt: userIdentities.lastUsedAt,
    })
    .from(userIdentities)
    .where(eq(userIdentities.userId, userId))
    .orderBy(userIdentities.provider)
  return rows
}

/**
 * Removes the user's identity of `provider`, unless it is their last way in
 * (no password, no other identity, no passkey): one statement, so two unlinks racing
 * can't remove both.
 */
export async function unlinkIdentity(
  d1: D1Database,
  userId: number,
  provider: OAuthProvider,
): Promise<'unlinked' | 'missing' | 'last'> {
  const [row] = await d1
    .prepare(
      `DELETE FROM user_identities
       WHERE user_id = ?1 AND provider = ?2
         AND ((SELECT password_hash FROM users WHERE id = ?1) <> ''
              OR (SELECT count(*) FROM user_identities WHERE user_id = ?1) > 1
              OR EXISTS (SELECT 1 FROM passkeys WHERE user_id = ?1))
       RETURNING id`,
    )
    .bind(userId, provider)
    .raw()
  if (row) return 'unlinked'
  const [exists] = await getDb(d1)
    .select({ id: userIdentities.id })
    .from(userIdentities)
    .where(and(eq(userIdentities.userId, userId), eq(userIdentities.provider, provider)))
  return exists ? 'last' : 'missing'
}

const USERNAME_MAX = 32

/**
 * A free username to start the sign-up form with, from the provider's handle
 * or name: the allowed characters only, at least 3, a few digits added while
 * it is taken. The user can change it; uniqueness is checked again on submit.
 */
export async function suggestUsername(d1: D1Database, identity: PendingIdentity): Promise<string> {
  const source = identity.handle ?? identity.displayName ?? ''
  let base = source.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, USERNAME_MAX)
  if (base.length < 3) base = 'traveler'
  const db = getDb(d1)
  let candidate = base
  for (let attempt = 0; attempt < 4; attempt++) {
    if (!usernameSchema.safeParse(candidate).success) break
    const [taken] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.usernameKey, candidate.toLowerCase()))
    if (!taken) return candidate
    const digits = String(1000 + (crypto.getRandomValues(new Uint32Array(1))[0]! % 9000))
    candidate = `${base.slice(0, USERNAME_MAX - digits.length)}${digits}`
  }
  return base
}
