/**
 * The public API (`/api/v1`, docs/plans/public-api.md): personal API tokens,
 * their scopes, and the rate limits. Shared by the Worker, the Settings token
 * panel and the docs.
 */

import { z } from 'zod'

// ------------------------------------------------------------------ scopes

/**
 * What a token can reach, one entry per area. A token always reads every
 * area of the accounts it covers; it writes only the areas it lists
 * (design B, 2026-11-14). Stored as a bitmask, two bits per area in this
 * order (read = bit 2i, write = bit 2i + 1), so a token without read on an
 * area can come later: append areas only.
 */
export const API_AREAS = [
  'accounts',
  'snapshots',
  'wishes',
  'progress',
  'planner',
  'sharing',
  'capture',
] as const
export type ApiArea = (typeof API_AREAS)[number]
export type ApiAccess = 'read' | 'write'

const areaIndex = (area: ApiArea) => API_AREAS.indexOf(area)

/** The bitmask of a token that reads everything and writes `write`. */
export function scopeMask(write: readonly ApiArea[]): number {
  let mask = 0
  for (const area of API_AREAS) mask |= 1 << (2 * areaIndex(area))
  for (const area of write) mask |= 1 << (2 * areaIndex(area) + 1)
  return mask
}

export function maskAllows(mask: number, area: ApiArea, access: ApiAccess): boolean {
  const bit = 2 * areaIndex(area) + (access === 'write' ? 1 : 0)
  return (mask & (1 << bit)) !== 0
}

/** The areas a mask may write, in area order. */
export function maskWrites(mask: number): ApiArea[] {
  return API_AREAS.filter((area) => maskAllows(mask, area, 'write'))
}

// ------------------------------------------------------------------ tokens

/** `gdt_pat_<id>_<secret>`: id 12 base64url characters, secret 32 bytes base64url. */
export const API_TOKEN_PREFIX = 'gdt_pat_'
export const API_TOKEN_PATTERN = /^gdt_pat_([A-Za-z0-9_-]{12})_([A-Za-z0-9_-]{43})$/

/** Tokens a user may hold at once (revoked and expired ones don't count). */
export const API_TOKEN_LIMIT = 20
export const API_TOKEN_EXPIRIES = [30, 90, 365] as const

/** `POST /api/auth/api-tokens`. */
export const apiTokenCreate = z.object({
  name: z.string().trim().min(1, 'A name').max(48, 'At most 48 characters'),
  /** Days until it expires; null: never. */
  expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(365), z.null()]).default(90),
  /** The accounts it covers; null: all of the user's, and ones added later. */
  accounts: z.array(z.number().int().positive()).min(1).max(100).nullable().default(null),
  /** The areas it may change as well as read. */
  write: z.array(z.enum(API_AREAS)).max(API_AREAS.length).default([]),
})
export type ApiTokenCreate = z.input<typeof apiTokenCreate>

/** `PATCH /api/auth/api-tokens/:id`: rename. */
export const apiTokenPatch = z.object({
  name: z.string().trim().min(1, 'A name').max(48, 'At most 48 characters'),
})

/** One token as Settings lists it (never its secret). */
export interface ApiTokenResponse {
  id: string
  name: string
  write: ApiArea[]
  /** null: all accounts. */
  accounts: number[] | null
  createdAt: number
  /** null: never expires. */
  expiresAt: number | null
  lastUsedAt: number | null
  /** `request.cf` country of the last use (ISO code), when known. */
  lastCountry: string | null
}

export interface ApiTokensResponse {
  tokens: ApiTokenResponse[]
  limits: ApiLimits
}

export interface ApiTokenCreatedResponse {
  token: ApiTokenResponse
  /** The whole token, shown once; only a hash of its secret is stored. */
  secret: string
}

// ------------------------------------------------------------------ limits

/**
 * Rate limits (docs/plans/public-api.md §8, after Discord's design): every
 * request passes the user's global limit and its route's bucket, counted
 * per user and, for routes under an account, per account. Per minute.
 */
export const API_TIERS = ['free', 'supporter'] as const
export type ApiTier = (typeof API_TIERS)[number]

export const API_BUCKETS = [
  'read',
  'good',
  'wish-summary',
  'farm',
  'wish-export',
  'upload',
  'wish-import',
  'write',
  'destructive',
] as const
export type ApiBucket = (typeof API_BUCKETS)[number]

/** Per minute; `read` has no bucket of its own (null: only the global limit). */
export const API_LIMITS: Record<
  ApiTier,
  { global: number; buckets: Record<ApiBucket, number | null> }
> = {
  free: {
    global: 20,
    buckets: {
      read: null,
      good: 6,
      'wish-summary': 6,
      farm: 6,
      'wish-export': 2,
      upload: 6,
      'wish-import': 2,
      write: 10,
      destructive: 2,
    },
  },
  supporter: {
    global: 60,
    buckets: {
      read: null,
      good: 20,
      'wish-summary': 20,
      farm: 20,
      'wish-export': 6,
      upload: 20,
      'wish-import': 6,
      write: 30,
      destructive: 2,
    },
  },
}

/** The limit values that need a rate-limit binding each (`RL_<n>` in wrangler.jsonc). */
export const API_LIMIT_VALUES = [2, 6, 10, 20, 30, 60] as const
export type ApiLimitValue = (typeof API_LIMIT_VALUES)[number]

/** Rejected token checks (401 / 403) per IP: past this, the IP waits 10 minutes. */
export const API_INVALID_PER_MINUTE = 6
export const API_INVALID_BLOCK_MS = 10 * 60_000

export interface ApiLimits {
  tier: ApiTier
  global: number
  buckets: Record<ApiBucket, number | null>
}

/**
 * A user's limits: the tier's, or staff's override for that user (snapped
 * down to the nearest value a binding exists for).
 */
export function apiLimitsFor(tier: ApiTier, override: ApiLimitsOverride | null): ApiLimits {
  const base = API_LIMITS[tier]
  if (!override) return { tier, ...base, buckets: { ...base.buckets } }
  const buckets = { ...base.buckets }
  for (const [name, value] of Object.entries(override.buckets ?? {})) {
    if ((API_BUCKETS as readonly string[]).includes(name) && name !== 'read' && value) {
      buckets[name as ApiBucket] = snapLimit(value)
    }
  }
  return { tier, global: override.global ? snapLimit(override.global) : base.global, buckets }
}

export function snapLimit(value: number): ApiLimitValue {
  let best: ApiLimitValue = API_LIMIT_VALUES[0]
  for (const v of API_LIMIT_VALUES) if (v <= value) best = v
  return best
}

/** Staff's per-user override (`users.api_limits`). */
export const apiLimitsOverride = z.object({
  global: z.number().int().min(2).max(60).optional(),
  buckets: z.partialRecord(z.enum(API_BUCKETS), z.number().int().min(2).max(60)).optional(),
})
export type ApiLimitsOverride = z.infer<typeof apiLimitsOverride>

/** `PUT /api/staff/users/:id/api-limits`. */
export const apiLimitsRequest = z.object({
  tier: z.enum(API_TIERS),
  override: apiLimitsOverride.nullable().default(null),
})
