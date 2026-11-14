/**
 * Writes the public API's generated docs (docs/plans/public-api.md §9):
 * - src/data/api-reference.json: OpenAPI 3.1, read by the docs page;
 * - public/developers/api.md: one Markdown file for AI helpers.
 * Rerun after changing a v1 route or the guide (src/data/api-guide.ts):
 *   pnpm --filter @gdt/tracker api:docs
 * `worker/test/api-docs.test.ts` fails while either file is stale.
 */

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { apiMarkdown } from '../worker/api/v1/markdown'
import { openApiDocument } from '../worker/api/v1/openapi'

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

writeFileSync(
  here('../src/data/api-reference.json'),
  `${JSON.stringify(openApiDocument(), null, 2)}\n`,
)
writeFileSync(here('../public/developers/api.md'), apiMarkdown())
console.log('wrote src/data/api-reference.json and public/developers/api.md')
