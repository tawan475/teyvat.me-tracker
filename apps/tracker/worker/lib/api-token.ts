/**
 * Personal API tokens (docs/plans/public-api.md §3): `Authorization: Bearer
 * gdt_pat_<id>_<secret>` on `/api/v1`. The row is found by its id (primary
 * key) and the secret checked against its SHA-256; the row, with the user's
 * rate-limit tier, is held in this isolate for a minute, so a busy client
 * costs one D1 read a minute. A revoked token can therefore keep working for
 * up to a minute on an isolate that holds it (the docs say so).
 */

import {
  API_TOKEN_PATTERN,
  apiLimitsFor,
  type ApiLimits,
  type ApiLimitsOverride,
  type ApiTier,
} from '@gdt/shared'
import { sha256Hex, safeEqual } from './crypto'
import { ApiError } from './http'

export interface ApiTokenAuth {
  tokenId: string
  userId: number
  scopes: number
  /** null: every account the user can see. */
  accountIds: number[] | null
  limits: ApiLimits
}

interface CachedToken {
  auth: ApiTokenAuth
  secretHash: string
  expiresAt: number | null
  revokedAt: number | null
  suspended: boolean
  lastUsedAt: number | null
  heldAt: number
}

const HOLD_MS = 60_000
const TOUCH_EVERY_MS = 3_600_000
const held = new Map<string, CachedToken>()

/** Splits a presented token; null when it isn't one of ours. */
export function parseApiToken(value: string): { id: string; secret: string } | null {
  const match = API_TOKEN_PATTERN.exec(value.trim())
  return match ? { id: match[1]!, secret: match[2]! } : null
}

/** The users row's tier and override as the limits they give. */
export function limitsOf(tier: unknown, override: unknown): ApiLimits {
  const t: ApiTier = tier === 'supporter' ? 'supporter' : 'free'
  let parsed: ApiLimitsOverride | null = null
  if (typeof override === 'string' && override) {
    try {
      parsed = JSON.parse(override) as ApiLimitsOverride
    } catch {
      parsed = null
    }
  } else if (override && typeof override === 'object') parsed = override as ApiLimitsOverride
  return apiLimitsFor(t, parsed)
}

const tokenInvalid = () => new ApiError(401, 'token_invalid', 'This API token is not valid')

/**
 * Checks a presented token. Throws 401 `token_invalid` (unknown, wrong
 * secret, revoked), 401 `token_expired`, or 403 `account_suspended`.
 * `touch` runs the hourly last-used write (in waitUntil).
 */
export async function verifyApiToken(
  d1: D1Database,
  presented: string,
  request: { ip: string; country: string | null; now: number },
  touch: (work: Promise<unknown>) => void,
): Promise<ApiTokenAuth> {
  const parts = parseApiToken(presented)
  if (!parts) throw tokenInvalid()
  let entry = held.get(parts.id)
  if (!entry || request.now - entry.heldAt > HOLD_MS) {
    const row = await d1
      .prepare(
        `SELECT t.user_id, t.secret_hash, t.scopes, t.account_ids, t.expires_at, t.revoked_at,
                t.last_used_at, u.api_tier, u.api_limits, u.suspended_at
           FROM api_tokens t JOIN users u ON u.id = t.user_id
          WHERE t.id = ?1`,
      )
      .bind(parts.id)
      .first<Record<string, unknown>>()
    if (!row) {
      held.delete(parts.id)
      throw tokenInvalid()
    }
    const accountIds =
      typeof row.account_ids === 'string' ? (JSON.parse(row.account_ids) as number[]) : null
    entry = {
      auth: {
        tokenId: parts.id,
        userId: Number(row.user_id),
        scopes: Number(row.scopes),
        accountIds,
        limits: limitsOf(row.api_tier, row.api_limits),
      },
      secretHash: String(row.secret_hash),
      expiresAt: row.expires_at == null ? null : Number(row.expires_at),
      revokedAt: row.revoked_at == null ? null : Number(row.revoked_at),
      suspended: row.suspended_at != null,
      lastUsedAt: row.last_used_at == null ? null : Number(row.last_used_at),
      heldAt: request.now,
    }
    held.set(parts.id, entry)
    if (held.size > 5_000) held.delete(held.keys().next().value!)
  }
  if (!safeEqual(await sha256Hex(parts.secret), entry.secretHash)) throw tokenInvalid()
  if (entry.revokedAt !== null) throw tokenInvalid()
  if (entry.expiresAt !== null && entry.expiresAt <= request.now) {
    throw new ApiError(401, 'token_expired', 'This API token has expired')
  }
  if (entry.suspended) throw new ApiError(403, 'account_suspended', 'This account is suspended')
  if (entry.lastUsedAt === null || request.now - entry.lastUsedAt > TOUCH_EVERY_MS) {
    entry.lastUsedAt = request.now
    touch(
      d1
        .prepare(
          'UPDATE api_tokens SET last_used_at = ?2, last_ip = ?3, last_country = ?4 WHERE id = ?1',
        )
        .bind(parts.id, request.now, request.ip, request.country)
        .run(),
    )
  }
  return entry.auth
}

/** Drops a token from this isolate's memory (after a revoke made here). */
export function forgetApiToken(id: string): void {
  held.delete(id)
}

/** Drops every held token (tests). */
export function forgetApiTokens(): void {
  held.clear()
}
