/**
 * Cloudflare's own usage figures for the staff Metrics page (README "Staff
 * metrics"): this month's Worker requests and CPU time, D1 rows read and
 * written and Durable Object requests and duration for the whole account,
 * and the last 24 hours' refused live batches on the zone. Read from the
 * GraphQL Analytics API with a read-only token.
 *
 * Off until BOTH Worker secrets exist: `CF_ANALYTICS_TOKEN` (an API token
 * with Account Analytics: Read, and Zone Analytics: Read for the two
 * live-sync counts) and `CF_ACCOUNT_ID`. `CF_ZONE_ID` is optional (the two
 * counts). Nothing is stored; the answer is kept ten minutes in this Worker
 * instance, so an open page asks Cloudflare six small questions per ten
 * minutes at most. Each figure is asked on its own: one Cloudflare refuses
 * (a field it renamed, a plan without the dataset) is shown as unknown and
 * the rest still show. The token is never logged or answered.
 */

import {
  METRICS_SLOW_TTL_MS,
  USAGE_KEYS,
  USAGE_PLAN,
  usageBill,
  type CloudflareUsage,
  type UsageItem,
  type UsageKey,
} from '@gdt/shared'

const ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql'
/** The live batches' route, whose 409 (resync) and 429 (daily cap) answers are counted. */
const CHANGES_PATH = '/api/irminsul/changes'
/** A Durable Object is billed as 128 MB while it runs. */
const DO_GB = 128 / 1024

interface Config {
  token: string
  account: string
  zone: string | null
}

type Vars = { CF_ANALYTICS_TOKEN?: string; CF_ACCOUNT_ID?: string; CF_ZONE_ID?: string }

const tag = (value: string | undefined): string | null =>
  value && /^[0-9a-f]{32}$/i.test(value.trim()) ? value.trim() : null

/** The usage reader's settings, or null while it is off. */
export function usageConfig(env: Env): Config | null {
  const vars = env as unknown as Vars
  const token = vars.CF_ANALYTICS_TOKEN?.trim()
  const account = tag(vars.CF_ACCOUNT_ID)
  if (!token || !account) return null
  return { token, account, zone: tag(vars.CF_ZONE_ID) }
}

type Json = Record<string, unknown>

/** One GraphQL question; null when Cloudflare refuses it or does not answer. */
async function ask(config: Config, query: string): Promise<Json | null> {
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
    })
    const body = (await response.json()) as { data?: Json | null; errors?: { message?: string }[] }
    if (!response.ok || body.errors?.length || !body.data) {
      console.warn(
        'cf_usage_refused',
        response.status,
        String(body.errors?.[0]?.message ?? '').slice(0, 200),
      )
      return null
    }
    return body.data
  } catch (error) {
    console.warn('cf_usage_failed', String(error).slice(0, 200))
    return null
  }
}

/** The rows of one dataset under `viewer.<scope>[0]`. */
function rowsOf(data: Json | null, scope: 'accounts' | 'zones', dataset: string): Json[] | null {
  const viewer = data?.viewer as Json | undefined
  const first = (viewer?.[scope] as Json[] | undefined)?.[0]
  const rows = first?.[dataset]
  return Array.isArray(rows) ? (rows as Json[]) : null
}

/** The sum of `field` over a dataset's rows (null when the question failed). */
function total(rows: Json[] | null, field: string): number | null {
  if (!rows) return null
  let sum = 0
  for (const row of rows) sum += Number((row.sum as Json | undefined)?.[field] ?? 0) || 0
  return sum
}

async function accountSum(
  config: Config,
  dataset: string,
  filter: string,
  field: string,
): Promise<number | null> {
  const data = await ask(
    config,
    `{ viewer { accounts(filter: {accountTag: "${config.account}"}) {
       ${dataset}(limit: 10000, filter: {${filter}}) { sum { ${field} } } } } }`,
  )
  return total(rowsOf(data, 'accounts', dataset), field)
}

async function zoneCount(config: Config, since: string, status: number): Promise<number | null> {
  if (!config.zone) return null
  const dataset = 'httpRequestsAdaptiveGroups'
  const data = await ask(
    config,
    `{ viewer { zones(filter: {zoneTag: "${config.zone}"}) {
       ${dataset}(limit: 100, filter: {datetime_geq: "${since}", clientRequestPath: "${CHANGES_PATH}", edgeResponseStatus: ${status}}) { count } } } }`,
  )
  const rows = rowsOf(data, 'zones', dataset)
  if (!rows) return null
  return rows.reduce((sum, row) => sum + (Number(row.count ?? 0) || 0), 0)
}

const kept = new Map<string, { until: number; value: Promise<unknown> }>()

function memo<T>(key: string, now: number, read: () => Promise<T>): Promise<T> {
  const hit = kept.get(key)
  if (hit && hit.until > now) return hit.value as Promise<T>
  const value = read()
  kept.set(key, { until: now + METRICS_SLOW_TTL_MS, value })
  value.catch(() => kept.delete(key))
  return value
}

/** Forgets the kept answers (tests). */
export function forgetUsage(): void {
  kept.clear()
}

/** This month's usage (UTC), or null while the reader is off. */
export function cloudflareUsage(env: Env, now = Date.now()): Promise<CloudflareUsage | null> {
  const config = usageConfig(env)
  if (!config) return Promise.resolve(null)
  return memo(`usage:${config.account}`, now, async () => {
    const date = new Date(now)
    const from = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
    const end = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)
    const day = new Date(from).toISOString().slice(0, 10)
    const times = `datetime_geq: "${new Date(from).toISOString()}", datetime_leq: "${date.toISOString()}"`
    const days = `date_geq: "${day}"`
    const [requests, cpuUs, d1Read, d1Written, doRequests, doActiveUs] = await Promise.all([
      accountSum(config, 'workersInvocationsAdaptive', times, 'requests'),
      accountSum(config, 'workersInvocationsAdaptive', times, 'cpuTimeUs'),
      accountSum(config, 'd1AnalyticsAdaptiveGroups', days, 'rowsRead'),
      accountSum(config, 'd1AnalyticsAdaptiveGroups', days, 'rowsWritten'),
      accountSum(config, 'durableObjectsInvocationsAdaptiveGroups', days, 'requests'),
      accountSum(config, 'durableObjectsPeriodicGroups', days, 'activeTime'),
    ])
    const used: Record<UsageKey, number | null> = {
      requests,
      cpuMs: cpuUs === null ? null : Math.round(cpuUs / 1000),
      d1Read,
      d1Written,
      doRequests,
      doDuration: doActiveUs === null ? null : Math.round((doActiveUs / 1e6) * DO_GB),
    }
    const items: UsageItem[] = USAGE_KEYS.map((key) => ({
      key,
      used: used[key],
      included: USAGE_PLAN[key].included,
    }))
    const elapsed = Math.max(1, now - from)
    return {
      from,
      to: now,
      items,
      billUsd: usageBill(items),
      projectedUsd: usageBill(items, (end - from) / elapsed),
    }
  })
}

/** The last 24 hours' refused live batches (409 resync, 429 daily cap); null while off or without the zone. */
export function liveRouteCounts(
  env: Env,
  now = Date.now(),
): Promise<{ resyncs: number | null; capRefusals: number | null } | null> {
  const config = usageConfig(env)
  if (!config?.zone) return Promise.resolve(null)
  return memo(`routes:${config.zone}`, now, async () => {
    const since = new Date(now - 86_400_000).toISOString()
    const [resyncs, capRefusals] = await Promise.all([
      zoneCount(config, since, 409),
      zoneCount(config, since, 429),
    ])
    return { resyncs, capRefusals }
  })
}
