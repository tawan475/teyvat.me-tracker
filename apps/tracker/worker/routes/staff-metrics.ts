/**
 * The staff Metrics page's API, mounted at /api/staff/metrics by
 * routes/staff.ts (so `requireActiveSession` + `requireStaff` run first).
 * Every route needs `site.metrics` (404 without it). The Online list and the
 * journals table name users, so they also need `users.view`, and a look at
 * the Online list adds an `admin_audit` row (one per staff member per ten
 * minutes). All reads; what each costs is in services/metrics.ts.
 */

import {
  ACTIVITY_RANGES,
  JOURNAL_SORTS,
  ONLINE_FILTERS,
  TREND_RANGES,
  type ActivityRange,
  type JournalSort,
  type OnlineFilter,
  type StaffActivityMetrics,
  type StaffCapacityMetrics,
  type StaffLiveMetrics,
  type StaffNowMetrics,
  type StaffOnlineResponse,
  type TrendRange,
} from '@gdt/shared'
import { Hono, type Context } from 'hono'
import type { AppEnv } from '../env'
import { need } from '../lib/staff'
import { INSPECT_DEDUPE_MS } from '../services/audit'
import {
  activityMetrics,
  capacityMetrics,
  liveMetrics,
  nowMetrics,
  onlineList,
} from '../services/metrics'
import { can } from '../services/roles'

type C = Context<AppEnv>

function pick<T extends string>(c: C, name: string, values: readonly T[], fallback: T): T {
  const value = c.req.query(name)
  return values.includes(value as T) ? (value as T) : fallback
}

/** `?page=`: 1 to 400 (the lists never go further). */
function pageOf(c: C): number {
  const page = Number(c.req.query('page') ?? 1)
  return Number.isSafeInteger(page) && page >= 1 ? Math.min(page, 400) : 1
}

export const staffMetrics = new Hono<AppEnv>()
  .use(need('site.metrics'))

  .get('/now', async (c) => {
    const range = pick<TrendRange>(c, 'range', TREND_RANGES, '24h')
    return c.json<StaffNowMetrics>(await nowMetrics(c.env, range))
  })

  .get('/online', need('users.view'), async (c) => {
    const actor = c.get('staff')
    const now = Date.now()
    const [list] = await Promise.all([
      onlineList(c.env, {
        filter: pick<OnlineFilter>(c, 'filter', ONLINE_FILTERS, 'all'),
        page: pageOf(c),
        actor,
        private: can(actor, 'users.view_private'),
      }),
      // Who looked at who is online: one row per staff member per window.
      c.env.DB.prepare(
        `INSERT INTO admin_audit (actor_user_id, actor_label, action, target_user_id, target_label, detail, created_at)
         SELECT ?1, ?2, 'site.metrics_online', NULL, NULL, '{}', ?3
         WHERE NOT EXISTS (SELECT 1 FROM admin_audit
           WHERE created_at > ?4 AND actor_user_id = ?1 AND action = 'site.metrics_online')`,
      )
        .bind(actor.userId, actor.username, now, now - INSPECT_DEDUPE_MS)
        .run(),
    ])
    return c.json<StaffOnlineResponse>(list)
  })

  .get('/live', async (c) => {
    return c.json<StaffLiveMetrics>(
      await liveMetrics(c.env, {
        sort: pick<JournalSort>(c, 'sort', JOURNAL_SORTS, 'last'),
        page: pageOf(c),
        rows: can(c.get('staff'), 'users.view'),
      }),
    )
  })

  .get('/activity', async (c) => {
    const range = pick<ActivityRange>(c, 'range', ACTIVITY_RANGES, '30d')
    return c.json<StaffActivityMetrics>(await activityMetrics(c.env, range))
  })

  .get('/capacity', async (c) => {
    const range = pick<TrendRange>(c, 'range', TREND_RANGES, '7d')
    return c.json<StaffCapacityMetrics>(await capacityMetrics(c.env, range))
  })
