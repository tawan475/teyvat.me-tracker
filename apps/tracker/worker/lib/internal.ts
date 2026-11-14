/**
 * Calls into the app's own routes on a user's behalf, from inside the Worker
 * (the public API, docs/plans/public-api.md §2): `/api/v1` checks the token,
 * its scopes and limits, then runs the same handler the website runs, so
 * permission checks (`loadAccount` / `assertAccount`), quotas and live
 * notifications live in one place.
 *
 * A request is internal when this module made the Request object: the
 * WeakMap holds the object itself, which nothing outside the isolate can
 * hand back, so no header or cookie can claim it. `authenticate`
 * (lib/session) reads it before any cookie. An internal request has no
 * session row, so routes behind `requireActiveSession` (password, sessions,
 * tokens, import keys, staff) refuse it.
 */

const callers = new WeakMap<Request, { userId: number }>()

type AppFetch = (request: Request, env: Env, ctx: ExecutionContext) => Response | Promise<Response>
let appFetch: AppFetch | null = null

/** worker/index.ts hands over its app once. */
export function setInternalApp(fetch: AppFetch): void {
  appFetch = fetch
}

/** The user an internal request runs as; undefined for every request from outside. */
export function internalCaller(request: Request): { userId: number } | undefined {
  return callers.get(request)
}

export interface InternalCall {
  method: string
  /** Path under `/api` (`/accounts/12/snapshots`), query included. */
  path: string
  userId: number
  json?: unknown
  body?: BodyInit
  headers?: Record<string, string>
}

/** Runs one of the app's routes as `userId`; answers what the website would get. */
export async function callInternal(
  origin: string,
  env: Env,
  ctx: ExecutionContext,
  call: InternalCall,
): Promise<Response> {
  if (!appFetch) throw new Error('internal app not set')
  const headers = new Headers(call.headers)
  let body = call.body
  if (call.json !== undefined) {
    headers.set('content-type', 'application/json')
    body = JSON.stringify(call.json)
  }
  const request = new Request(new URL(`/api${call.path}`, origin), {
    method: call.method,
    headers,
    body,
  })
  callers.set(request, { userId: call.userId })
  return appFetch(request, env, ctx)
}
