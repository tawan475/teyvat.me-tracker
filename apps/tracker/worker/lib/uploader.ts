/**
 * Who an upload comes from, for every irminsul route that writes: an
 * import key (`x-import-key`; routes/public) or a signed-in irminsul's
 * access token (`Authorization: Bearer`; routes/irminsul), resolved to the
 * same owner shape (services/upload-as):
 * - an account key, or a session whose uploads go to one account: that
 *   account;
 * - a user key, or a session in uid mode: the user and all their accounts,
 *   routed by the upload's UID (made on the first upload of a new UID).
 * A stopped user (suspended, uploads blocked) is refused here; an ended
 * session is 401 `session_revoked`, an expired token 401 `token_expired`
 * (irminsul refreshes and retries). One D1 round trip either way.
 */

import type { Context } from 'hono'
import type { AppEnv } from '../env'
import {
  findImportKeyOwner,
  hashImportKey,
  pickByUid,
  sharedReadOnly,
  takeAccountUid,
  uploadsRefused,
  type ImportKeyOwner,
  type KeyAccount,
  type UploadOwner,
} from '../services/accounts'
import { configUrl, loadUploadSession, type LiveSession } from '../services/irminsul'
import { pageOrigin } from './email'
import { ApiError, clientIp, rateLimit } from './http'
import type { D1Meter } from './meter'
import {
  bearerToken,
  irminsulSessionEnded,
  readAccessToken,
  type IrminsulClaims,
} from './irminsul-auth'

/** The key's owner; `limiter` is the per-minute budget of this route, per key. */
export async function keyOwner(
  c: Context<AppEnv>,
  limiter: RateLimit | undefined,
): Promise<ImportKeyOwner> {
  const key = c.req.header('x-import-key')
  if (!key) throw new ApiError(401, 'missing_import_key', 'Missing x-import-key header')
  const hash = await hashImportKey(key)
  await rateLimit(limiter, `key:${hash}`)
  const owner = await findImportKeyOwner(c.env.DB, hash)
  if (!owner) {
    await rateLimit(c.env.AUTH_LIMITER, `bad-key:${clientIp(c)}`)
    throw new ApiError(401, 'invalid_import_key', 'Unknown import key')
  }
  // Staff stopped this user's uploads (the staff dashboard).
  if (owner.blocked) throw uploadsRefused(owner.blocked)
  return owner
}

/**
 * The owner a live irminsul session uploads as: its one account, or its
 * user (uid mode). 409 `upload_target_missing` when that account is gone.
 */
export async function sessionOwner(
  c: Context<AppEnv>,
  claims: IrminsulClaims,
): Promise<UploadOwner> {
  return (await sessionOwnerWith(c, claims)).owner
}

/** As sessionOwner, with the session row it read (what whoami answers from). */
export async function sessionOwnerWith(
  c: Context<AppEnv>,
  claims: IrminsulClaims,
): Promise<{ owner: UploadOwner; session: LiveSession }> {
  const found = await loadUploadSession(c.env.DB, claims)
  if (!found) throw irminsulSessionEnded()
  const { session, accounts } = found
  if (session.block) throw uploadsRefused(session.block)
  if (session.upload_mode === 'account') {
    const account = accounts.find((a) => a.id === session.upload_account_id)
    // Shared with this user to view only (or no longer editable): refuse, as for a key.
    if (account?.role === 'viewer') throw sharedReadOnly()
    if (!account) {
      const where = configUrl(pageOrigin(c.env, c.req.url), claims.sid)
      throw new ApiError(
        409,
        'upload_target_missing',
        `The account this PC uploads to was deleted. Choose where uploads go: ${where}`,
      )
    }
    return {
      owner: { scope: 'account', account, userId: account.user_id ?? claims.userId },
      session,
    }
  }
  return {
    owner: { scope: 'user', user: { id: claims.userId, username: session.username }, accounts },
    session,
  }
}

/**
 * The request's owner, by its Bearer token when it has one, else by its
 * import key. `limiter` is this route's per-minute budget, per key or per
 * session (`bucket` names the route in the session's limiter key).
 */
export async function uploaderOf(
  c: Context<AppEnv>,
  limiter: RateLimit | undefined,
  bucket: string,
): Promise<UploadOwner> {
  const token = bearerToken(c)
  if (!token) return keyOwner(c, limiter)
  const claims = await readAccessToken(c, token)
  if (claims === 'expired') throw new ApiError(401, 'token_expired', 'Access token expired')
  if (claims === 'invalid') throw new ApiError(401, 'invalid_token', 'Not an irminsul token')
  await rateLimit(limiter, `irminsul-${bucket}:${claims.sid}`)
  return sessionOwner(c, claims)
}

/** The owner's user id. */
export function uploaderUserId(owner: UploadOwner): number {
  return owner.scope === 'account' ? owner.userId : owner.user.id
}

/**
 * The account a UID's records belong to for an upload that may name it
 * (wish history): a picked account first takes that UID (`takeAccountUid`,
 * as its snapshots do), else as `uploaderAccount`.
 */
export async function uploaderAccountTaking(
  d1: D1Database,
  meter: D1Meter,
  owner: UploadOwner,
  uid: string,
): Promise<{ account: KeyAccount | null; uidChanged: boolean }> {
  const uidChanged =
    owner.scope === 'account' && (await takeAccountUid(d1, meter, owner.account, uid))
  return { account: uploaderAccount(owner, uid), uidChanged }
}

/**
 * The account a UID's records belong to, without making one: an account
 * owner's own account (409 `uid_mismatch` when it has another UID), or the
 * user's account with that UID (null when there is none).
 */
export function uploaderAccount(owner: UploadOwner, uid: string): KeyAccount | null {
  if (owner.scope === 'account') {
    const linked = owner.account.uid?.trim()
    if (linked && linked !== uid) {
      throw new ApiError(
        409,
        'uid_mismatch',
        `These records are UID ${uid}, but uploads here go to the account with UID ${linked}.`,
      )
    }
    return owner.account
  }
  return pickByUid(owner.accounts, uid)
}
