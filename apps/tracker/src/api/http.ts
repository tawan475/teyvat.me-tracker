/**
 * The one way the app talks to /api.
 *
 * - Same-origin cookies carry the session; no token is ever in JavaScript.
 * - Every state-changing request sends `x-gdt-csrf: 1` (the Worker refuses
 *   cookie-authed writes without it).
 * - An expired access cookie (401) triggers one refresh, shared by every
 *   request that hit it at once, then a single retry. If the refresh fails the
 *   session is over and `onSignedOut` runs. So does a 401 `session_revoked`
 *   (this device was signed out elsewhere): its refresh is refused.
 * - Errors become ApiRequestError with the server's `code`, which is what
 *   callers branch on; `message` is safe to show.
 */

import type { ApiError } from '@gdt/shared'
import { isGuestPath } from '@/local/guest-id'
import { bookmarkHeaders, noteBookmarks } from './d1-bookmark'
import { ApiRequestError } from './error'

export { ApiRequestError }

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  json?: unknown
  body?: BodyInit | null
  /** Skip the refresh-and-retry dance (used by the auth endpoints themselves). */
  noRefresh?: boolean
}

/**
 * This tab, on every write (`x-gdt-tab`): the live event a write causes
 * names it, so the tab that made a change does not re-read it.
 */
export const TAB_ID = Math.random().toString(36).slice(2, 12)

/** What a refresh found: new cookies, the session over (401), or no answer. */
type RefreshOutcome = 'ok' | 'ended' | 'unknown'

let signedOutHandler: (() => void) | null = null
let refreshing: Promise<RefreshOutcome> | null = null

/** Called once when a refresh fails: the session is gone. */
export function onSignedOut(handler: () => void): void {
  signedOutHandler = handler
}

const SAFE = new Set(['GET', 'HEAD'])
const REFRESHABLE = new Set(['unauthenticated', 'token_expired', 'session_revoked'])

async function send(path: string, options: RequestOptions): Promise<Response> {
  const method = (options.method ?? 'GET').toUpperCase()
  // The guest account lives in this browser (docs/plans/open-site.md §4): its
  // routes are answered here, never sent (the module loads on first use).
  if (isGuestPath(path)) {
    const { localFetch } = await import('@/local/server')
    return localFetch(path, {
      method,
      headers: options.headers,
      json: options.json,
      body: options.body,
    })
  }
  const headers = new Headers(options.headers)
  if (!SAFE.has(method)) {
    headers.set('x-gdt-csrf', '1')
    headers.set('x-gdt-tab', TAB_ID)
  }
  bookmarkHeaders(headers)
  let body = options.body
  if (options.json !== undefined) {
    headers.set('content-type', 'application/json')
    body = JSON.stringify(options.json)
  }
  const response = await fetch(path, {
    ...options,
    method,
    headers,
    body,
    credentials: 'same-origin',
  })
  noteBookmarks({
    d1: response.headers.get('x-gdt-bookmark'),
    d1l: response.headers.get('x-gdt-bookmark-live'),
  })
  return response
}

function refresh(): Promise<RefreshOutcome> {
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' })
    .then((response): RefreshOutcome => {
      if (response.ok) return 'ok'
      return response.status === 401 ? 'ended' : 'unknown'
    })
    .catch((): RefreshOutcome => 'unknown')
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

/** Refreshes the access cookie once for any number of concurrent callers. */
export async function refreshSession(): Promise<boolean> {
  return (await refresh()) === 'ok'
}

/**
 * Whether this browser's session still holds, asked with a refresh after a
 * sign it may have ended (the live socket was closed for it). Over: the
 * signed-out handler runs and the answer is false. No answer from the
 * server: true, as nothing is known (the next request tells).
 */
export async function checkSession(): Promise<boolean> {
  if ((await refresh()) !== 'ended') return true
  signedOutHandler?.()
  return false
}

async function toError(response: Response): Promise<ApiRequestError> {
  let body: Partial<ApiError> = {}
  try {
    body = (await response.json()) as ApiError
  } catch {
    // Not JSON (e.g. a proxy error page).
  }
  const error = body.error
  return new ApiRequestError(
    response.status,
    error?.code ?? `http_${response.status}`,
    error?.message ?? (response.status >= 500 ? 'The server had a problem' : 'Request failed'),
    error?.issues,
  )
}

/** Sends a request, refreshing the session once on an expired token. */
export async function request(path: string, options: RequestOptions = {}): Promise<Response> {
  let response: Response
  try {
    response = await send(path, options)
  } catch {
    throw new ApiRequestError(0, 'network', 'Could not reach the server. Check your connection.')
  }
  if (response.status !== 401 || options.noRefresh) {
    if (!response.ok && response.status !== 304) throw await toError(response)
    return response
  }

  const error = await toError(response)
  if (!REFRESHABLE.has(error.code)) throw error
  if (!(await refreshSession())) {
    signedOutHandler?.()
    throw error
  }
  const retry = await send(path, options)
  if (!retry.ok && retry.status !== 304) {
    const retryError = await toError(retry)
    if (retry.status === 401) signedOutHandler?.()
    throw retryError
  }
  return retry
}

export async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await request(path, options)
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}
