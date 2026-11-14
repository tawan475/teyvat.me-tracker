/**
 * The public API's machinery (docs/plans/public-api.md §3–4, §8): who is
 * calling (a personal API token, or the website's session for the docs'
 * Try it), the rate limits (a global limit per user plus a bucket per
 * endpoint, after Discord's design), errors as RFC 9457 problem details,
 * and calls into the app's own routes (lib/internal).
 */

import {
  API_INVALID_BLOCK_MS,
  maskAllows,
  type ApiArea,
  type ApiAccess,
  type ApiBucket,
  type ApiLimits,
} from '@gdt/shared'
import type { Context } from 'hono'
import type { z } from 'zod'
import type { AppEnv } from '../../env'
import { limitsOf, verifyApiToken } from '../../lib/api-token'
import { randomToken } from '../../lib/crypto'
import { ApiError, clientIp } from '../../lib/http'
import { callInternal } from '../../lib/internal'

/** Who a v1 request runs as. */
export interface ApiCaller {
  userId: number
  /** null: a website session (the docs' Try it), which may do what the site does. */
  tokenId: string | null
  scopes: number
  accountIds: number[] | null
  limits: ApiLimits
}

export type V1Context = Context<AppEnv & { Variables: { api: ApiCaller; requestId: string } }>

export const DOCS_URL = 'https://teyvat.me/developers/api'

// ------------------------------------------------------------------ errors

/** Short titles for the codes a client meets most; others use the message. */
const TITLES: Record<string, string> = {
  unauthenticated: 'Sign-in needed',
  token_invalid: 'Invalid token',
  token_expired: 'Token expired',
  scope_missing: 'Missing scope',
  account_not_in_token: 'Account not in this token',
  account_suspended: 'Account suspended',
  rate_limited: 'Too many requests',
  not_found: 'Not found',
  invalid_request: 'Invalid request',
  invalid_json: 'Invalid JSON',
  not_modified: 'Not modified',
  internal: 'Something went wrong',
}

/** RFC 9457 problem details; `code` is the stable machine name. */
export function problem(
  error: ApiError,
  requestId: string,
  extra: Record<string, unknown> = {},
): Response {
  const body = {
    type: `${DOCS_URL}#error-${error.code}`,
    title: TITLES[error.code] ?? error.message,
    status: error.status,
    code: error.code,
    detail: error.message,
    instance: requestId,
    ...(error.issues ? { errors: error.issues } : {}),
    ...extra,
  }
  const headers = new Headers(error.headers)
  headers.set('Content-Type', 'application/problem+json')
  return new Response(JSON.stringify(body), { status: error.status, headers })
}

export const newRequestId = () => `req_${randomToken(9)}`

// ------------------------------------------------------------------ auth

/** IPs that sent too many rejected tokens, until (ms). Best effort per isolate. */
const blockedIps = new Map<string, number>()

/** Counts a rejected token check from `ip`; past the limit, the IP waits. */
export async function countInvalid(env: Env, ip: string): Promise<void> {
  const limiter = (env as unknown as Record<string, RateLimit | undefined>).RL_INVALID
  if (!limiter) return
  const { success } = await limiter.limit({ key: `inv:${ip}` })
  if (!success) {
    blockedIps.set(ip, Date.now() + API_INVALID_BLOCK_MS)
    if (blockedIps.size > 10_000) blockedIps.delete(blockedIps.keys().next().value!)
  }
}

export function ipBlockedFor(ip: string, now: number): number {
  const until = blockedIps.get(ip)
  if (until === undefined) return 0
  if (until <= now) {
    blockedIps.delete(ip)
    return 0
  }
  return Math.ceil((until - now) / 1000)
}

/** Tests: forget blocked IPs. */
export function forgetBlockedIps(): void {
  blockedIps.clear()
}

/**
 * The caller: a Bearer API token, else the website's session cookie (with
 * its CSRF header on writes). A session may do what the site lets it, so it
 * gets every scope.
 */
export async function authenticate(c: V1Context): Promise<ApiCaller> {
  const header = c.req.header('authorization')
  if (header !== undefined) {
    const [scheme, value] = header.split(/\s+/, 2)
    if (scheme?.toLowerCase() !== 'bearer' || !value) {
      throw new ApiError(401, 'token_invalid', 'Send Authorization: Bearer <token>')
    }
    const auth = await verifyApiToken(
      c.env.DB,
      value,
      {
        ip: clientIp(c),
        country: (c.req.raw.cf?.country as string | undefined) ?? null,
        now: Date.now(),
      },
      (work) => c.executionCtx.waitUntil(work),
    )
    return { ...auth, tokenId: auth.tokenId }
  }
  // Loaded here, not at the top: the docs script (scripts/api-docs.ts) reads
  // this module under Node, and the session module pulls in Workers-only code.
  const { requireUser } = await import('../../lib/session')
  await requireUser(c as unknown as Context<AppEnv>, async () => {})
  const userId = c.get('userId')
  const row = await c.env.DB.prepare('SELECT api_tier, api_limits FROM users WHERE id = ?1')
    .bind(userId)
    .first<Record<string, unknown>>()
  if (!row) throw new ApiError(401, 'unauthenticated', 'Not signed in')
  return {
    userId,
    tokenId: null,
    scopes: -1 >>> 0,
    accountIds: null,
    limits: limitsOf(row.api_tier, row.api_limits),
  }
}

export function requireScope(api: ApiCaller, area: ApiArea, access: ApiAccess): void {
  if (api.tokenId === null) return
  if (!maskAllows(api.scopes, area, access)) {
    throw new ApiError(
      403,
      'scope_missing',
      `This token can't ${access === 'write' ? 'change' : 'read'} ${area}`,
    )
  }
}

export function requireAccountInToken(api: ApiCaller, accountId: number): void {
  if (api.accountIds && !api.accountIds.includes(accountId)) {
    throw new ApiError(403, 'account_not_in_token', 'This token does not cover that account')
  }
}

// ------------------------------------------------------------------ limits

export interface LimitOutcome {
  bucket: ApiBucket
  /** The bucket's limit for this caller (null: only the global limit). */
  limit: number | null
  global: number
}

function limiter(env: Env, value: number): RateLimit | undefined {
  return (env as unknown as Record<string, RateLimit | undefined>)[`RL_${value}`]
}

/**
 * The global limit, then the route's bucket (per account when the route has
 * one). A refused request is 429 with Discord's scope fields.
 */
export async function checkLimits(
  c: V1Context,
  api: ApiCaller,
  bucket: ApiBucket,
  accountId: number | null,
  /** Who is counted: the user, or `ip:<address>` for routes without a token. */
  subject: string = String(api.userId),
): Promise<LimitOutcome> {
  const { global, buckets } = api.limits
  const limit = buckets[bucket]
  const outcome: LimitOutcome = { bucket, limit, global }
  const refuse = (scope: 'global' | 'user', value: number) =>
    new ApiError(
      429,
      'rate_limited',
      scope === 'global'
        ? `${value} requests a minute on the ${api.limits.tier} tier`
        : `${value} ${bucket} requests a minute${accountId ? ' per account' : ''} on the ${api.limits.tier} tier`,
      undefined,
      {
        'Retry-After': '60',
        'X-RateLimit-Scope': scope,
        ...(scope === 'global' ? { 'X-RateLimit-Global': 'true' } : {}),
        'X-RateLimit-Bucket': scope === 'global' ? 'global' : bucket,
        'X-RateLimit-Limit': String(value),
      },
    )
  const g = limiter(c.env, global)
  if (g && !(await g.limit({ key: `g:${subject}` })).success) {
    throw new ProblemError(refuse('global', global), {
      scope: 'global',
      global: true,
      bucket: 'global',
      limit: global,
      retryAfter: 60,
    })
  }
  if (limit !== null) {
    const b = limiter(c.env, limit)
    if (b && !(await b.limit({ key: `b:${bucket}:${subject}:${accountId ?? '-'}` })).success) {
      throw new ProblemError(refuse('user', limit), {
        scope: 'user',
        global: false,
        bucket,
        limit,
        retryAfter: 60,
      })
    }
  }
  return outcome
}

/** An ApiError whose problem body carries extra members (a 429's scope, bucket…). */
export class ProblemError extends ApiError {
  constructor(
    base: ApiError,
    readonly extra: Record<string, unknown>,
  ) {
    super(base.status, base.code, base.message, base.issues, base.headers)
  }
}

// ------------------------------------------------------------------ the app's routes

export interface InnerResult<T> {
  status: number
  data: T
  etag: string | null
}

/**
 * Runs one of the app's routes as the caller. A 304 comes back as status
 * 304 with no data; an error answer becomes the same ApiError (code,
 * message, issues, Retry-After), which the v1 router renders as a problem.
 */
export async function inner<T>(
  c: V1Context,
  method: string,
  path: string,
  options: {
    json?: unknown
    body?: BodyInit
    headers?: Record<string, string>
    conditional?: boolean
  } = {},
): Promise<InnerResult<T>> {
  const headers: Record<string, string> = { ...options.headers }
  const ifNoneMatch = c.req.header('if-none-match')
  if (options.conditional !== false && method === 'GET' && ifNoneMatch)
    headers['if-none-match'] = ifNoneMatch
  const response = await callInternal(
    new URL(c.req.url).origin,
    c.env,
    c.executionCtx as unknown as ExecutionContext,
    {
      method,
      path,
      userId: c.var.api.userId,
      json: options.json,
      body: options.body,
      headers,
    },
  )
  const etag = response.headers.get('etag')
  if (response.status === 304) return { status: 304, data: undefined as T, etag }
  if (response.status === 204) return { status: 204, data: undefined as T, etag }
  const text = await response.text()
  let parsed: unknown = undefined
  try {
    parsed = text ? JSON.parse(text) : undefined
  } catch {
    parsed = undefined
  }
  if (!response.ok) {
    const error = (
      parsed as {
        error?: { code?: string; message?: string; issues?: { path: string; message: string }[] }
      }
    )?.error
    const retry = response.headers.get('retry-after')
    throw new ApiError(
      response.status as 400,
      error?.code ?? 'internal',
      error?.message ?? 'Something went wrong',
      error?.issues,
      retry ? { 'Retry-After': retry } : undefined,
    )
  }
  return { status: response.status, data: parsed as T, etag }
}

// ------------------------------------------------------------------ helpers

/** Unix ms → ISO 8601 UTC; null stays null. */
export function iso(ms: number | null | undefined): string | null {
  return ms === null || ms === undefined || !Number.isFinite(ms) ? null : new Date(ms).toISOString()
}

/** ISO 8601 or Unix ms (number or digits) → Unix ms; undefined when absent, 400 when bad. */
export function parseTime(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value === '') return undefined
  const ms = /^\d+$/.test(value) ? Number(value) : Date.parse(value)
  if (!Number.isFinite(ms)) throw new ApiError(400, 'invalid_request', `${name}: an ISO 8601 time`)
  return ms
}

export type ZodSchema = z.ZodType
