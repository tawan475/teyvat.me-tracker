/**
 * `/developers/api.md`: the whole public API in one Markdown file, for AI
 * helpers (docs/plans/public-api.md §9). Built from the guide and the route
 * registry, the same sources as the page; `scripts/api-docs.ts` writes it to
 * `public/developers/api.md` and a test fails when it is stale.
 */

import { API_GUIDE, type GuideBlock } from '../../../src/data/api-guide'
import { limitText } from './openapi'
import { RESOURCES, type V1Route } from './registry'
import { V1_ROUTES } from './routes'
import { z } from 'zod'

const fence = (body: string, lang = '') => `\`\`\`${lang}\n${body}\n\`\`\``

function block(b: GuideBlock): string {
  if ('text' in b) return b.text
  if ('code' in b) return fence(b.code, b.lang)
  if ('list' in b) return b.list.map((item) => `- ${item}`).join('\n')
  const head = `| ${b.table.head.join(' | ')} |\n|${b.table.head.map(() => ' --- ').join('|')}|`
  return [head, ...b.table.rows.map((row) => `| ${row.join(' | ')} |`)].join('\n')
}

function schemaText(schema: z.ZodType, io: 'input' | 'output'): string {
  try {
    return JSON.stringify(z.toJSONSchema(schema, { io, unrepresentable: 'any' }), null, 1)
  } catch {
    return '{}'
  }
}

function scopeOf(route: V1Route): string {
  if (route.auth === false) return 'none (no token)'
  if (!route.area) return 'any token'
  return `${route.area} · ${route.access === 'write' ? 'Write' : 'Read'}`
}

function curl(route: V1Route): string {
  const query = route.example?.query ? `?${new URLSearchParams(route.example.query)}` : ''
  const path = route.path.replace('{id}', '12').replace(/\{\w+\}/g, '1')
  const lines = [
    `curl${route.method === 'GET' ? '' : ` -X ${route.method}`} "https://teyvat.me/api/v1${path}${query}"`,
  ]
  if (route.auth !== false) lines.push('  -H "Authorization: Bearer $TEYVAT_TOKEN"')
  if (route.example?.body !== undefined) {
    lines.push('  -H "Content-Type: application/json"')
    lines.push(`  -d '${JSON.stringify(route.example.body)}'`)
  } else if (route.bodyKind === 'file') {
    lines.push('  -H "Content-Type: application/json" --data-binary @file.json')
  }
  return lines.join(' \\\n')
}

function endpoint(route: V1Route): string {
  const parts = [
    `### ${route.method} /api/v1${route.path}`,
    `${route.summary}.${route.description ? ` ${route.description}` : ''}`,
    `- Scope: ${scopeOf(route)}`,
    `- Bucket: \`${route.bucket}\` (${limitText(route)})`,
  ]
  if (route.conditional) parts.push('- Send `If-None-Match` for a 304 when unchanged.')
  if (route.query) parts.push(`Query:\n${fence(schemaText(route.query, 'input'), 'json')}`)
  if (route.body && route.bodyKind !== 'file')
    parts.push(`Body:\n${fence(schemaText(route.body, 'input'), 'json')}`)
  parts.push(`Example:\n${fence(curl(route), 'bash')}`)
  if (route.response === null) parts.push(`Answer: ${route.status ?? 204} with no body.`)
  else if (route.response === 'file')
    parts.push('Answer: a file download (not the `{data}` envelope).')
  else {
    parts.push(`Answer \`data\`:\n${fence(schemaText(route.response, 'output'), 'json')}`)
    if (route.example?.data !== undefined) {
      parts.push(
        `Example answer:\n${fence(JSON.stringify({ data: route.example.data, ...(route.example.meta ? { meta: route.example.meta } : {}) }, null, 2), 'json')}`,
      )
    }
  }
  if (route.errors?.length)
    parts.push(`Errors: ${route.errors.map((e) => `\`${e}\``).join(', ')}, \`rate_limited\`.`)
  return parts.join('\n\n')
}

export function apiMarkdown(): string {
  const out = [
    '# Teyvat.me API (v1)',
    '> The public API of Teyvat.me (https://teyvat.me), a Genshin Impact account tracker: read and change your accounts, snapshots (GOOD files), wish history, marks, the Planner and sharing with a personal token. Unofficial fan project, not affiliated with HoYoverse. Human docs: https://teyvat.me/developers/api · OpenAPI: https://teyvat.me/api/v1/openapi.json',
  ]
  for (const section of API_GUIDE) {
    out.push(`## ${section.title}`, ...section.blocks.map(block))
  }
  out.push('## Endpoints')
  for (const resource of RESOURCES) {
    out.push(`## ${resource}`)
    for (const route of V1_ROUTES.filter((r) => r.resource === resource)) out.push(endpoint(route))
  }
  return `${out.join('\n\n')}\n`
}
