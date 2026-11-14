/**
 * Every `/api/v1` route, declared once (docs/plans/public-api.md §9): the
 * router registers them, `openapi.ts` describes them, and the docs (the
 * page and `api.md`) are generated from the same list, so they can't drift.
 */

import type { ApiAccess, ApiArea, ApiBucket } from '@gdt/shared'
import type { z } from 'zod'
import type { ApiCaller, V1Context } from './core'

export type V1Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface V1Input {
  c: V1Context
  api: ApiCaller
  /** Path parameters as written (`{id}` → `params.id`). */
  params: Record<string, string>
  /** `{id}` as a number, for routes under an account. */
  accountId: number | null
  query: Record<string, unknown>
  body: unknown
}

export type V1Result =
  | {
      data: unknown
      meta?: Record<string, unknown>
      status?: number
      etag?: string | null
      headers?: Record<string, string>
    }
  /** An unchanged GET (If-None-Match matched). */
  | { notModified: true; etag: string | null }
  /** 204 No Content. */
  | { empty: true }
  /** A download (UIGF file): passed through as it is. */
  | { raw: Response }

export interface V1Example {
  query?: Record<string, string>
  body?: unknown
  /** The `data` of a success answer. */
  data?: unknown
  meta?: Record<string, unknown>
}

export interface V1Route {
  /** OpenAPI operationId; also the docs anchor. */
  id: string
  method: V1Method
  /** `/accounts/{id}/good`; under `/api/v1`. */
  path: string
  /** The docs group (Accounts, Snapshots…). */
  resource: string
  summary: string
  description?: string
  /** null: any token (me) or none (`auth: false`). */
  area: ApiArea | null
  access: ApiAccess
  bucket: ApiBucket
  /** The path parameter naming a Genshin account the token must cover. */
  accountParam?: string
  /** false: no token needed (public game events); limited per IP. */
  auth?: boolean
  /** The ETag / If-None-Match dance applies. */
  conditional?: boolean
  query?: z.ZodObject
  body?: z.ZodType
  /** How the body is sent when it isn't JSON (uploads). */
  bodyKind?: 'json' | 'file'
  /** `data`'s schema; null for a 204 answer; 'file' for a download. */
  response: z.ZodType | null | 'file'
  /** `meta`'s schema, when the answer has one. */
  meta?: z.ZodType
  status?: number
  errors?: string[]
  example?: V1Example
  handler: (input: V1Input) => Promise<V1Result>
}

/** Converts `/accounts/{id}` to Hono's `/accounts/:id`. */
export const honoPath = (path: string) => path.replace(/\{(\w+)\}/g, ':$1')

/** The resources in docs order. */
export const RESOURCES = [
  'Me',
  'Accounts',
  'Snapshots',
  'Wishes',
  'Progress',
  'Planner',
  'Sharing',
  'Capture',
  'Game events',
] as const
