/**
 * "Sign in with the tracker" for irminsul: an OAuth 2.0 authorization code
 * flow with PKCE (RFC 7636) for a desktop app answering on a loopback port
 * (RFC 8252). This is a wire contract with shipped irminsul builds: fields
 * only ever get appended (README, "Sign in from irminsul").
 *
 * The Worker validates with these schemas and the /link page checks its
 * query with `parseLinkQuery` before it shows anything.
 */

import { deviceAlertsPatch } from './alerts'
import { z } from 'zod'
import type { GenshinServer, UploadSupport } from './index'

/** The only client: irminsul is a public client (no secret), proven by PKCE. */
export const IRMINSUL_CLIENT_ID = 'irminsul'

/** Longest device name kept (irminsul sends the PC's display name). */
export const MAX_DEVICE_NAME = 64

/**
 * Loopback redirects only (RFC 8252 §7.3): `http://127.0.0.1:<port>/callback`
 * or `http://localhost:<port>/callback`, any port, nothing else (no query, no
 * fragment, no other path).
 */
const REDIRECT = /^http:\/\/(?:127\.0\.0\.1|localhost):([1-9]\d{0,4})\/callback$/

export function isLoopbackRedirect(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = REDIRECT.exec(value)
  return match !== null && Number(match[1]) <= 65_535
}

/** base64url(SHA-256(verifier)) without padding: always 43 characters. */
export const CODE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/

/**
 * RFC 7636 §4.1: 43–128 unreserved characters. A shorter or longer verifier
 * can't have made a valid challenge, so it is refused before hashing.
 */
export const CODE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/

/**
 * irminsul's CSRF value, echoed back untouched. The contract has it 32+
 * random url-safe characters; the tracker takes 16–512 unreserved
 * characters, so it never has to escape or reject a reasonable one.
 */
export const OAUTH_STATE = /^[A-Za-z0-9._~-]{16,512}$/

/** The PC's name as a person reads it: no control characters, one space at a time, ≤ 64. */
export function cleanDeviceName(value: unknown): string {
  if (typeof value !== 'string') return ''
  const text = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return [...text].slice(0, MAX_DEVICE_NAME).join('').trim()
}

/** Where a signed-in irminsul's uploads go. */
export type UploadTarget = { mode: 'uid' } | { mode: 'account'; account_id: number }

export const uploadTargetSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('uid') }),
  z.object({ mode: z.literal('account'), account_id: z.number().int().positive() }),
])

/** `POST /api/oauth/authorize` (the /link page, signed in): the user said Allow. */
export const oauthAuthorizeRequest = z.object({
  client_id: z.literal(IRMINSUL_CLIENT_ID),
  redirect_uri: z.string().max(64).refine(isLoopbackRedirect, 'Not a loopback callback'),
  state: z.string().regex(OAUTH_STATE),
  code_challenge: z.string().regex(CODE_CHALLENGE),
  code_challenge_method: z.literal('S256'),
  device: z.string().max(1024).optional(),
  upload: uploadTargetSchema,
})

export interface OAuthAuthorizeResponse {
  /** The loopback callback with `code` and `state`: the page navigates there. */
  redirect: string
}

/** `PATCH /api/auth/sessions/:id` (an irminsul session only): where its uploads go now. */
export const sessionUploadRequest = z.object({ upload: uploadTargetSchema })

/**
 * `PATCH /api/auth/sessions/:id`: where an irminsul session's uploads go now
 * and/or what the device is alerted about (any session).
 */
export const sessionPatchRequest = z
  .object({ upload: uploadTargetSchema.optional(), alerts: deviceAlertsPatch.optional() })
  .refine((body) => body.upload !== undefined || body.alerts !== undefined, 'Nothing to change')

/** `GET /api/oauth/irminsul`: where irminsul finds everything (absolute URLs). */
export interface IrminsulDiscovery {
  authorize_url: string
  token_url: string
  revoke_url: string
  client_id: typeof IRMINSUL_CLIENT_ID
  version: 1
}

/**
 * `GET /api/irminsul/whoami`, and `whoami` in every token answer. The fields
 * shared with `VerifyKeyResponse` keep its names. `configUrl`: the tracker
 * page where this session's upload target is changed (irminsul's Configure
 * button; irminsul never changes it itself).
 */
export interface IrminsulWhoami {
  scope: 'uid' | 'account'
  user: string
  accountId: number | null
  accountName: string | null
  uid: string | null
  server: GenshinServer | null
  dashboardUrl: string
  configUrl: string
  upload?: UploadSupport
}

/** `POST /api/oauth/token`, either grant. */
export interface IrminsulTokenResponse {
  token_type: 'Bearer'
  access_token: string
  expires_in: number
  refresh_token: string
  refresh_expires_in: number
  whoami: IrminsulWhoami
}

/** An irminsul session's upload target as Settings → Devices shows it. */
export type SessionUpload = { mode: 'uid' } | { mode: 'account'; accountId: number | null }

/** What /link was opened with, once checked. */
export interface LinkRequest {
  redirectUri: string
  state: string
  codeChallenge: string
  /** Cleaned (cleanDeviceName); empty when irminsul sent none. */
  device: string
}

export type LinkQueryProblem = 'client' | 'redirect' | 'challenge' | 'state'

/**
 * Checks the /link query before the page shows anything: the client, a
 * loopback redirect, an S256 challenge and a state. A bad redirect is never
 * followed (not even for Cancel): the page shows an error card instead.
 */
export function parseLinkQuery(
  query: Record<string, unknown>,
): { ok: true; value: LinkRequest } | { ok: false; problem: LinkQueryProblem } {
  const one = (key: string): unknown => {
    const value = query[key]
    return Array.isArray(value) ? undefined : value
  }
  if (one('client_id') !== IRMINSUL_CLIENT_ID) return { ok: false, problem: 'client' }
  const redirectUri = one('redirect_uri')
  if (!isLoopbackRedirect(redirectUri)) return { ok: false, problem: 'redirect' }
  const challenge = one('code_challenge')
  if (
    one('code_challenge_method') !== 'S256' ||
    typeof challenge !== 'string' ||
    !CODE_CHALLENGE.test(challenge)
  ) {
    return { ok: false, problem: 'challenge' }
  }
  const state = one('state')
  if (typeof state !== 'string' || !OAUTH_STATE.test(state)) return { ok: false, problem: 'state' }
  return {
    ok: true,
    value: { redirectUri, state, codeChallenge: challenge, device: cleanDeviceName(one('device')) },
  }
}

/** The loopback callback URL with these parameters (code + state, or error + state). */
export function callbackUrl(redirectUri: string, params: Record<string, string>): string {
  const url = new URL(redirectUri)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url.href
}
