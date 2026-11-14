/**
 * `/api/v1` (docs/plans/public-api.md): the public API's router. Each
 * request: a request id → CORS → the IP block → who (token or session) →
 * the route's scope and account → the global limit and the route's bucket →
 * the body and query checked → the handler → `{data, meta}` (parsed through
 * the route's schema) or an RFC 9457 problem.
 */

import { apiLimitsFor } from '@gdt/shared'
import { Hono } from 'hono'
import type { AppEnv } from '../../env'
import { ApiError, clientIp } from '../../lib/http'
import {
  authenticate,
  checkLimits,
  countInvalid,
  ipBlockedFor,
  newRequestId,
  problem,
  ProblemError,
  requireAccountInToken,
  requireScope,
  type ApiCaller,
  type V1Context,
} from './core'
import { openApiDocument } from './openapi'
import { honoPath, type V1Route } from './registry'
import { V1_ROUTES } from './routes'

type V1Env = AppEnv & { Variables: { api: ApiCaller; requestId: string } }

const EXPOSED = [
  'ETag',
  'Retry-After',
  'X-Request-Id',
  'X-RateLimit-Bucket',
  'X-RateLimit-Limit',
  'X-RateLimit-Global-Limit',
  'X-RateLimit-Tier',
  'X-RateLimit-Scope',
  'X-RateLimit-Global',
  'API-Version',
].join(', ')

function corsHeaders(headers: Headers): void {
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Access-Control-Expose-Headers', EXPOSED)
  // Bearer requests are read cross-origin (a browser tool with a pasted token).
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin')
}

/** Copies a response so its headers can change (passed-through responses may be immutable). */
const mutable = (response: Response) => new Response(response.body, response)

function withHeaders(
  c: V1Context,
  response: Response,
  extra: Record<string, string> = {},
): Response {
  const out = mutable(response)
  out.headers.set('X-Request-Id', c.var.requestId)
  out.headers.set('API-Version', '1')
  for (const [name, value] of Object.entries(extra)) out.headers.set(name, value)
  // A website session's answers stay same-origin; tokens' are readable anywhere.
  if (c.req.header('authorization') !== undefined || !c.req.header('cookie'))
    corsHeaders(out.headers)
  if (!out.headers.has('Cache-Control')) out.headers.set('Cache-Control', 'private, no-cache')
  return out
}

function renderError(c: V1Context, error: unknown): Response {
  if (error instanceof ApiError) {
    const extra = error instanceof ProblemError ? error.extra : {}
    return withHeaders(c, problem(error, c.var.requestId, extra))
  }
  console.error(error)
  return withHeaders(
    c,
    problem(new ApiError(500, 'internal', 'Something went wrong'), c.var.requestId),
  )
}

const PUBLIC_CALLER: ApiCaller = {
  userId: 0,
  tokenId: null,
  scopes: 0,
  accountIds: null,
  limits: apiLimitsFor('free', null),
}

function parseQuery(route: V1Route, c: V1Context): Record<string, unknown> {
  if (!route.query) return {}
  const result = route.query.safeParse(c.req.query())
  if (!result.success) {
    throw new ApiError(
      400,
      'invalid_request',
      'Query failed validation',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    )
  }
  return result.data as Record<string, unknown>
}

async function parseBody(route: V1Route, c: V1Context): Promise<unknown> {
  if (!route.body || route.bodyKind === 'file') return undefined
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    throw new ApiError(400, 'invalid_json', 'The body must be JSON')
  }
  const result = route.body.safeParse(raw)
  if (!result.success) {
    throw new ApiError(
      400,
      'invalid_request',
      'Body failed validation',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    )
  }
  // The app's route validates again; send what the client sent (its defaults apply there).
  return raw
}

function handle(route: V1Route) {
  return async (c: V1Context): Promise<Response> => {
    try {
      const ip = clientIp(c)
      const blocked = ipBlockedFor(ip, Date.now())
      if (blocked) {
        throw new ProblemError(
          new ApiError(
            429,
            'rate_limited',
            'Too many rejected tokens from this address',
            undefined,
            {
              'Retry-After': String(blocked),
              'X-RateLimit-Scope': 'ip',
            },
          ),
          { scope: 'ip', global: false, retryAfter: blocked },
        )
      }

      let api: ApiCaller
      if (route.auth === false) {
        api = PUBLIC_CALLER
      } else {
        try {
          api = await authenticate(c)
        } catch (error) {
          if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
            c.executionCtx.waitUntil(countInvalid(c.env, ip))
          }
          throw error
        }
      }
      c.set('api', api)

      const params = c.req.param() as Record<string, string>
      let accountId: number | null = null
      if (route.accountParam) {
        accountId = Number(params[route.accountParam])
        if (!Number.isSafeInteger(accountId) || accountId <= 0) {
          throw new ApiError(404, 'not_found', 'Account not found')
        }
      }
      if (route.area) requireScope(api, route.area, route.access)
      if (accountId !== null) requireAccountInToken(api, accountId)

      const outcome =
        route.auth === false
          ? await checkLimits(c, api, route.bucket, null, `ip:${ip}`)
          : await checkLimits(c, api, route.bucket, accountId)
      const limitHeaders: Record<string, string> = {
        'X-RateLimit-Bucket': route.bucket,
        'X-RateLimit-Limit': String(outcome.limit ?? outcome.global),
        'X-RateLimit-Global-Limit': String(outcome.global),
        'X-RateLimit-Tier': api.limits.tier,
      }

      const query = parseQuery(route, c)
      const body = await parseBody(route, c)
      const result = await route.handler({ c, api, params, accountId, query, body })

      if ('raw' in result) return withHeaders(c, result.raw, limitHeaders)
      if ('empty' in result) return withHeaders(c, c.body(null, 204), limitHeaders)
      if ('notModified' in result) {
        return withHeaders(c, new Response(null, { status: 304 }), {
          ...limitHeaders,
          ...(result.etag ? { ETag: result.etag } : {}),
        })
      }
      let data = result.data
      if (route.response && route.response !== 'file') {
        const parsed = route.response.safeParse(data)
        if (!parsed.success) {
          console.error(
            'v1 answer off its schema',
            route.id,
            JSON.stringify(parsed.error.issues.slice(0, 3)),
          )
          throw new ApiError(500, 'internal', 'Something went wrong')
        }
        data = parsed.data
      }
      const payload = result.meta ? { data, meta: result.meta } : { data }
      return withHeaders(
        c,
        new Response(JSON.stringify(payload), {
          status: result.status ?? route.status ?? 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        }),
        {
          ...limitHeaders,
          ...(result.etag ? { ETag: result.etag } : {}),
          ...result.headers,
        },
      )
    } catch (error) {
      return renderError(c, error)
    }
  }
}

export const v1 = new Hono<V1Env>()

v1.use(async (c, next) => {
  c.set('requestId', newRequestId())
  if (c.req.method === 'OPTIONS') {
    const headers = new Headers({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers':
        'Authorization, Content-Type, Content-Encoding, If-None-Match',
      'Access-Control-Max-Age': '86400',
    })
    return new Response(null, { status: 204, headers })
  }
  await next()
})

/** The OpenAPI 3.1 description of every route (no token needed). */
v1.get('/openapi.json', (c) => {
  const response = c.json(openApiDocument(new URL(c.req.url).origin))
  response.headers.set('Cache-Control', 'public, max-age=3600')
  corsHeaders(response.headers)
  return response
})

for (const route of V1_ROUTES) {
  const path = honoPath(route.path)
  const handler = handle(route) as unknown as (c: unknown) => Promise<Response>
  switch (route.method) {
    case 'GET':
      v1.get(path, handler as never)
      break
    case 'POST':
      v1.post(path, handler as never)
      break
    case 'PUT':
      v1.put(path, handler as never)
      break
    case 'PATCH':
      v1.patch(path, handler as never)
      break
    case 'DELETE':
      v1.delete(path, handler as never)
      break
  }
}

v1.notFound((c) =>
  withHeaders(
    c as unknown as V1Context,
    problem(
      new ApiError(404, 'not_found', 'No such endpoint: see /api/v1/openapi.json'),
      c.var.requestId ?? newRequestId(),
    ),
  ),
)
