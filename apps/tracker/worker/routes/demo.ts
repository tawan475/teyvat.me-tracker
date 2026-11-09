/**
 * The public demo account (docs/plans/open-site.md §2): one made-up account,
 * built by `scripts/demo-good.ts` and named by `site_settings`
 * `demo.account`, read by anyone with no cookie. The app's `/demo` pages
 * read it here (src/api/inspect.ts routes the demo account's reads) and keep
 * every change a visitor makes in the tab (src/api/demo-store.ts): nothing
 * here writes.
 *
 * Its data changes only when the script rebuilds it (a new account id), so
 * every answer is public and cached for a day: an ETag on the account's id
 * and data version, and the edge's cache (Cache API, keyed the same way)
 * answers repeat reads without D1. `GET /account` is the one short-lived
 * answer (5 minutes): it says which account and version is current.
 */

import {
  ACCOUNT_SETTINGS_DEFAULTS,
  deepMerge,
  type AccountResponse,
  type AccountSettingsResponse,
  type QuestMarksResponse,
} from '@gdt/shared'
import { Hono, type Context } from 'hono'
import type { AppEnv } from '../env'
import { accountEtag } from '../lib/etag'
import { ApiError, idParam } from '../lib/http'
import { listAccounts } from '../services/accounts'
import { listSnapshots, parseIds, parseSections } from '../services/account-views'
import { buildBundle, buildGood, catalogJson, goodFileName } from '../services/export'
import { readWishHistory } from '../services/wishes'
import {
  readAchievementMarks,
  readAnecdoteMarks,
  readPlannerState,
  readPlannerTargets,
  readPlannerTasks,
} from './progress'

/** The `site_settings` key naming the demo account. */
export const DEMO_ACCOUNT_KEY = 'demo.account'

/** The account and its owner, current version included. */
interface DemoAccount {
  id: number
  userId: number
  dataVersion: number
}

const DAY_S = 86_400

/** The demo account, or a 404 while none is set up (before the script's first run). */
async function demoAccount(d1: D1Database): Promise<DemoAccount> {
  const row = await d1
    .prepare(
      `SELECT a.id, a.user_id AS userId, a.data_version AS dataVersion
       FROM site_settings AS s JOIN genshin_accounts AS a ON a.id = CAST(s.value AS INTEGER)
       WHERE s.key = ?1`,
    )
    .bind(DEMO_ACCOUNT_KEY)
    .first<DemoAccount>()
  if (!row) throw new ApiError(404, 'demo_missing', 'The demo is not set up')
  return row
}

/**
 * A cached answer: 304 when the browser holds this version, the edge's copy
 * when it has one, else `build` (then kept at the edge, after the response).
 */
async function cachedAnswer(
  c: Context<AppEnv>,
  variant: string,
  build: (account: DemoAccount) => Promise<Response>,
): Promise<Response> {
  const account = await demoAccount(c.env.DB)
  const etag = accountEtag(account, `demo.${variant}`)
  const headers = {
    ETag: etag,
    'Cache-Control': `public, max-age=${DAY_S}`,
    Vary: 'Accept-Encoding',
  }
  const match = c.req.header('if-none-match')
  if (match && match.split(/\s*,\s*/).includes(etag)) {
    return new Response(null, { status: 304, headers })
  }
  // The version is in the key: a rebuilt demo never reads the old copy.
  const key = new URL(c.req.url)
  key.searchParams.set('__demo', `${account.id}.${account.dataVersion}`)
  const cache = edgeCache()
  const hit = await cache?.match(key.href).catch(() => undefined)
  // A copy: a cached response's headers are read-only, and the middleware adds some.
  if (hit) return new Response(hit.body, hit)
  const built = await build(account)
  const response = new Response(built.body, { status: built.status, headers: built.headers })
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value)
  if (cache && response.ok) {
    const kept = cache.put(key.href, response.clone()).catch(() => undefined)
    try {
      c.executionCtx.waitUntil(kept)
    } catch {
      // No execution context (a direct app.fetch in a test).
    }
  }
  return response
}

/** The zone's cache (a no-op on workers.dev, absent in some test setups). */
function edgeCache(): Cache | null {
  try {
    return (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default ?? null
  } catch {
    return null
  }
}

const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })

export const demo = new Hono<AppEnv>()
  /** Which account the demo is, as the account list shows one (5 minutes). */
  .get('/account', async (c) => {
    const account = await demoAccount(c.env.DB)
    const [full] = await listAccounts(c.env.DB, account.userId, account.id)
    if (!full) throw new ApiError(404, 'demo_missing', 'The demo is not set up')
    c.header('Cache-Control', 'public, max-age=300')
    return c.json<AccountResponse>(full)
  })

  .get('/snapshots', (c) =>
    cachedAnswer(c, 'snapshots', async (a) => json(await listSnapshots(c.env.DB, a.id))),
  )

  .get('/catalog', (c) =>
    cachedAnswer(
      c,
      'catalog',
      async (a) =>
        new Response(await catalogJson(c.env.DB, a.id), {
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        }),
    ),
  )

  /** GDT2, or GDT3 when asked (`?format=3`, what the app asks for from 2026-11-09). */
  .get('/bundle', (c) => {
    const ids = parseIds(c.req.query('ids'))
    const sections = parseSections(c.req.query('sections'))
    const format = c.req.query('format') === '3' ? 3 : 2
    const variant = `bundle.${format}.${[...sections].sort().join('+')}.${ids ? ids.join('-') : 'all'}`
    return cachedAnswer(
      c,
      variant,
      async (a) =>
        new Response(await buildBundle(c.env.DB, a.id, ids, sections, format), {
          headers: { 'Content-Type': 'application/octet-stream' },
        }),
    )
  })

  .get('/snapshots/:snapshotId/good', (c) => {
    const snapshotId = idParam(c, 'snapshotId')
    return cachedAnswer(c, `good.${snapshotId}`, async (a) => {
      const { good, takenAt } = await buildGood(c.env.DB, a.id, snapshotId)
      const response = json(good)
      response.headers.set('Content-Disposition', `attachment; filename="${goodFileName(takenAt)}"`)
      return response
    })
  })

  .get('/latest/good', (c) =>
    cachedAnswer(c, 'latest-good', async (a) => {
      const { good, takenAt } = await buildGood(c.env.DB, a.id, 'latest')
      const response = json(good)
      response.headers.set('Content-Disposition', `attachment; filename="${goodFileName(takenAt)}"`)
      return response
    }),
  )

  .get('/settings', (c) =>
    cachedAnswer(c, 'settings', async (a) => {
      const row = await c.env.DB.prepare('SELECT settings FROM genshin_accounts WHERE id = ?1')
        .bind(a.id)
        .first<{ settings: string | null }>()
      const stored = row?.settings ? (JSON.parse(row.settings) as object) : {}
      return json({
        settings: deepMerge(ACCOUNT_SETTINGS_DEFAULTS, stored),
      } satisfies AccountSettingsResponse)
    }),
  )

  .get('/achievement-marks', (c) =>
    cachedAnswer(c, 'achievement-marks', async (a) =>
      json(await readAchievementMarks(c.env.DB, a.id)),
    ),
  )

  .get('/anecdote-marks', (c) =>
    cachedAnswer(c, 'anecdote-marks', async (a) => json(await readAnecdoteMarks(c.env.DB, a.id))),
  )

  .get('/quest-marks', (c) =>
    cachedAnswer(c, 'quest-marks', async (a) => {
      const { results } = await c.env.DB.prepare(
        'SELECT quest_id AS id FROM quest_marks WHERE account_id = ?1 ORDER BY quest_id',
      )
        .bind(a.id)
        .all<{ id: number }>()
      return json({ done: results.map((r) => r.id) } satisfies QuestMarksResponse)
    }),
  )

  .get('/planner-targets', (c) =>
    cachedAnswer(c, 'planner-targets', async (a) => json(await readPlannerTargets(c.env.DB, a.id))),
  )

  .get('/planner-state', (c) =>
    cachedAnswer(c, 'planner-state', async (a) => json(await readPlannerState(c.env.DB, a.id))),
  )

  .get('/planner-tasks', (c) =>
    cachedAnswer(c, 'planner-tasks', async (a) => json(await readPlannerTasks(c.env.DB, a.id))),
  )

  .get('/wishes', (c) =>
    cachedAnswer(c, 'wishes', async (a) => json(await readWishHistory(c.env.DB, a.id))),
  )
