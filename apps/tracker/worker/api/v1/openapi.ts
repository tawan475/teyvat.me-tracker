/**
 * OpenAPI 3.1 for `/api/v1`, generated from the route registry with zod's
 * own JSON Schema output (docs/plans/public-api.md §9). Served at
 * `/api/v1/openapi.json` and read by the docs generator (api.md, the page).
 */

import { API_LIMITS } from '@gdt/shared'
import { z } from 'zod'
import { DOCS_URL } from './core'
import { RESOURCES, type V1Route } from './registry'
import { V1_ROUTES } from './routes'

const json = (schema: z.ZodType, io: 'input' | 'output') => {
  try {
    return z.toJSONSchema(schema, { io, unrepresentable: 'any', target: 'draft-2020-12' })
  } catch {
    return {}
  }
}

const problemSchema = {
  type: 'object',
  description: 'RFC 9457 problem details',
  properties: {
    type: { type: 'string', format: 'uri' },
    title: { type: 'string' },
    status: { type: 'integer' },
    code: { type: 'string', description: 'Stable machine name' },
    detail: { type: 'string' },
    instance: { type: 'string', description: 'The request id (X-Request-Id)' },
    errors: {
      type: 'array',
      items: {
        type: 'object',
        properties: { path: { type: 'string' }, message: { type: 'string' } },
      },
    },
    scope: { type: 'string', enum: ['user', 'global', 'ip'], description: '429 only' },
    global: { type: 'boolean', description: '429 only' },
    bucket: { type: 'string', description: '429 only' },
    limit: { type: 'integer', description: '429 only' },
    retryAfter: { type: 'integer', description: '429 only, seconds' },
  },
  required: ['type', 'title', 'status', 'code', 'detail', 'instance'],
}

function scopeOf(route: V1Route): string {
  if (route.auth === false) return 'none'
  if (!route.area) return 'any token'
  return `${route.area} · ${route.access === 'write' ? 'Write' : 'Read'}`
}

export function limitText(route: V1Route): string {
  const free = API_LIMITS.free.buckets[route.bucket]
  const supporter = API_LIMITS.supporter.buckets[route.bucket]
  if (free === null) return 'global only'
  return `${free} / min free, ${supporter} / min supporter${route.accountParam ? ', per account' : ''}`
}

function operation(route: V1Route) {
  const parameters: unknown[] = []
  for (const [, name] of route.path.matchAll(/\{(\w+)\}/g)) {
    parameters.push({
      name,
      in: 'path',
      required: true,
      schema: {
        type:
          name === 'userId' || name === 'snapshotId' || name === 'id' || name === 'accountId'
            ? 'integer'
            : 'string',
      },
    })
  }
  if (route.query) {
    const schema = json(route.query, 'input') as {
      properties?: Record<string, unknown>
      required?: string[]
    }
    for (const [name, prop] of Object.entries(schema.properties ?? {})) {
      parameters.push({
        name,
        in: 'query',
        required: schema.required?.includes(name) ?? false,
        schema: prop,
      })
    }
  }
  if (route.conditional) {
    parameters.push({
      name: 'If-None-Match',
      in: 'header',
      required: false,
      schema: { type: 'string' },
    })
  }
  const responses: Record<string, unknown> = {}
  const ok = String(route.status ?? 200)
  if (route.response === null) responses['204'] = { description: 'Done' }
  else if (route.response === 'file') {
    responses['200'] = {
      description: 'A file download',
      content: { 'application/json': { schema: {} } },
    }
  } else {
    const envelope: Record<string, unknown> = {
      type: 'object',
      properties: {
        data: json(route.response, 'output'),
        ...(route.meta ? { meta: json(route.meta, 'output') } : {}),
      },
      required: ['data'],
    }
    responses[ok] = {
      description: 'OK',
      content: {
        'application/json': {
          schema: envelope,
          ...(route.example?.data !== undefined
            ? {
                example: {
                  data: route.example.data,
                  ...(route.example.meta ? { meta: route.example.meta } : {}),
                },
              }
            : {}),
        },
      },
    }
  }
  if (route.conditional) responses['304'] = { description: 'Not modified since your ETag' }
  responses.default = {
    description: `Error (${['rate_limited', ...(route.errors ?? [])].join(', ')})`,
    content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } },
  }
  return {
    operationId: route.id,
    tags: [route.resource],
    summary: route.summary,
    description: [
      route.description,
      `Scope: ${scopeOf(route)}. Bucket \`${route.bucket}\`: ${limitText(route)}.`,
    ]
      .filter(Boolean)
      .join('\n\n'),
    ...(route.auth === false ? { security: [] } : {}),
    parameters,
    ...(route.body && route.bodyKind !== 'file'
      ? {
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: json(route.body, 'input'),
                ...(route.example?.body !== undefined ? { example: route.example.body } : {}),
              },
            },
          },
        }
      : route.bodyKind === 'file'
        ? {
            requestBody: {
              required: true,
              content: {
                'application/json': { schema: { type: 'object' } },
                'multipart/form-data': {
                  schema: {
                    type: 'object',
                    properties: { file: { type: 'string', format: 'binary' } },
                  },
                },
              },
            },
          }
        : {}),
    responses,
  }
}

export function openApiDocument(origin = 'https://teyvat.me') {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const route of V1_ROUTES) {
    paths[route.path] ??= {}
    paths[route.path]![route.method.toLowerCase()] = operation(route)
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Teyvat.me API',
      version: '1',
      description: `Your Genshin Impact accounts, snapshots, wishes and plans on Teyvat.me. Unofficial fan project. Docs: ${DOCS_URL}`,
    },
    servers: [{ url: `${origin}/api/v1` }],
    security: [{ token: [] }],
    tags: RESOURCES.map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        token: {
          type: 'http',
          scheme: 'bearer',
          description: 'A personal API token (gdt_pat_…) from Settings → API tokens',
        },
      },
      schemas: { Problem: problemSchema },
    },
  }
}
