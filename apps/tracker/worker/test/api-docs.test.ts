import { describe, expect, it } from 'vitest'
import reference from '../../src/data/api-reference.json'
import markdown from '../../public/developers/api.md?raw'
import { apiMarkdown } from '../api/v1/markdown'
import { openApiDocument } from '../api/v1/openapi'

/**
 * The public API's generated docs match the code (docs/plans/public-api.md
 * §9). Stale after changing a v1 route or the guide: run
 * `pnpm --filter @gdt/tracker api:docs`.
 */
describe('generated API docs', () => {
  it('src/data/api-reference.json is the current OpenAPI', () => {
    expect(reference).toEqual(JSON.parse(JSON.stringify(openApiDocument())))
  })

  it('public/developers/api.md is current', () => {
    expect(markdown.replace(/\r\n/g, '\n')).toBe(apiMarkdown())
  })
})
