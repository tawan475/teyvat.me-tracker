/**
 * The staff Metrics page (`/api/staff/metrics/*`, node `site.metrics`): who
 * is online and in game, live sync, activity over time and capacity. Every
 * figure is read when a staff member opens the page, from state the site
 * keeps anyway; the only writes are one site-wide reading an hour
 * (`site_samples`) and the usual audit row for the list that names users.
 * No zod here: types and small pure helpers.
 */

import type { GenshinServer, StorageSplit } from './api'
import type { DayCount } from './staff'

/** A Capture is "running" while its sign-in was renewed this recently (it renews every 15 minutes). */
export const CAPTURE_RECENT_MS = 20 * 60_000
/** An account is "sending" while its journal got a batch this recently. */
export const LIVE_RECENT_MS = 15 * 60_000
/** The Worker keeps each read this long, however many staff look. */
export const METRICS_TTL_MS = 60_000
/** The day charts and Cloudflare's usage are kept longer. */
export const METRICS_SLOW_TTL_MS = 10 * 60_000
/** Rows per page of the lists (also the most hubs one page asks). */
export const METRICS_PAGE_SIZE = 25
/** D1's size limit per database. */
export const D1_LIMIT_BYTES = 10 * 1024 ** 3

export const METRIC_TABS = ['all', 'now', 'live', 'activity', 'capacity'] as const
export type MetricTab = (typeof METRIC_TABS)[number]

export const TREND_RANGES = ['24h', '7d', '30d'] as const
export type TrendRange = (typeof TREND_RANGES)[number]

export const ACTIVITY_RANGES = ['30d', '90d', '1y'] as const
export type ActivityRange = (typeof ACTIVITY_RANGES)[number]

export const ONLINE_FILTERS = ['all', 'game', 'site'] as const
export type OnlineFilter = (typeof ONLINE_FILTERS)[number]

export const JOURNAL_SORTS = ['last', 'today', 'size'] as const
export type JournalSort = (typeof JOURNAL_SORTS)[number]

/** One hourly reading of the whole site (`site_samples`). */
export interface SiteSample {
  /** Unix ms, the start of the hour it was taken in. */
  at: number
  users: number
  online: number
  capture: number
  inGame: number
  journals: number
  /** Live batches so far that UTC day. */
  batches: number
  dau: number
  wau: number
  mau: number
  /** Bytes of the two databases (0 when D1 did not say). */
  dbBytes: number
  liveBytes: number
}

/** `GET /api/staff/metrics/now`. */
export interface StaffNowMetrics {
  at: number
  users: number
  /** Users with an open site socket. */
  online: number
  /** Capture sign-ins that are not ended, and those renewed in the last 20 minutes. */
  captureDevices: number
  captureRunning: number
  /** Accounts whose journal got a batch in the last 15 minutes. */
  inGame: number
  journals: number
  batchesToday: number
  /** Accounts at the day's batch cap. */
  atCap: number
  dau: number
  range: TrendRange
  /** Hourly readings in `range`, oldest first (empty until the first hour passes). */
  trend: SiteSample[]
}

/** What a client reported about itself, as the Online list shows it. */
export interface OnlineCapture {
  /**
   * `decoding`: in game with data flowing; `running`: the game is closed;
   * `seen`: its sign-in was renewed lately but its hub has no heartbeat.
   */
  state: 'decoding' | 'running' | 'seen'
  /** The PC or phone's name; null for staff who may not see private details. */
  device: string | null
  /** The client program's own name (teyvat.me-desktop, irminsul, another client's). */
  program: string
  version: string | null
  /** Unix ms of the last heartbeat (or sign-in renewal for `seen`). */
  at: number
}

export interface StaffOnlineRow {
  id: number
  username: string
  /** Unix ms since when the site has been open; null: not open. */
  siteSince: number | null
  capture: OnlineCapture | null
  account: {
    id: number
    name: string | null
    uid: string | null
    server: GenshinServer | null
  } | null
  batchesToday: number
  lastBatchAt: number | null
}

/** `GET /api/staff/metrics/online` (also needs `users.view`). */
export interface StaffOnlineResponse {
  at: number
  rows: StaffOnlineRow[]
  total: number
  counts: Record<OnlineFilter, number>
  page: number
  pageSize: number
  /** The day's batch cap per account (the meter's full width). */
  dailyCap: number
}

export interface StaffJournalRow {
  accountId: number
  name: string | null
  uid: string | null
  server: GenshinServer | null
  owner: { id: number; username: string }
  openedAt: number
  updatedAt: number
  seq: number
  today: number
  changes: number
  bytes: number
}

/** `GET /api/staff/metrics/live`. */
export interface StaffLiveMetrics {
  at: number
  journals: number
  accounts: number
  active: number
  batchesToday: number
  accountsToday: number
  /** Bytes kept in the live database (journals, spilled batches, chart points). */
  bytes: number
  dailyCap: number
  health: {
    tailChanges: number
    spilledRows: number
    atCap: number
    oldestOpenedAt: number | null
    /** From Cloudflare's analytics; null without the usage token (they are not stored). */
    resyncs24h: number | null
    capRefusals24h: number | null
  }
  /** 30 UTC days, oldest first: `accounts` with live data that day. */
  days: DayCount[]
  /** `users.view` only: the journals, a page of them. */
  rows?: StaffJournalRow[]
  total: number
  page: number
  pageSize: number
}

/** `GET /api/staff/metrics/activity`. */
export interface StaffActivityMetrics {
  at: number
  users: number
  dau: number
  wau: number
  mau: number
  lastSeen: { today: number; week: number; month: number; older: number }
  range: ActivityRange
  /** UTC days in `range`, oldest first: `password`, `discord`, `google`. */
  signups: DayCount[]
  /** 30 UTC days, oldest first: `uploaders`, `snapshots`, `bytes`. */
  uploads: DayCount[]
  /** UTC days in `range` that have a reading, oldest first: `dau`, `wau`. */
  active: DayCount[]
  capture: { devices: number; users: number; seen24h: number; seen7d: number; new7d: number }
  wishes: {
    accounts: number
    histories: number
    synced24h: number
    synced7d: number
    pulls: number
    bytes: number
  }
}

export const USAGE_KEYS = [
  'requests',
  'cpuMs',
  'd1Read',
  'd1Written',
  'doRequests',
  'doDuration',
] as const
export type UsageKey = (typeof USAGE_KEYS)[number]

/** What Workers Paid includes each month, and the price of a unit past it (USD). */
export const USAGE_PLAN: Record<UsageKey, { included: number; unit: number; usd: number }> = {
  requests: { included: 10_000_000, unit: 1_000_000, usd: 0.3 },
  cpuMs: { included: 30_000_000, unit: 1_000_000, usd: 0.02 },
  d1Read: { included: 25_000_000_000, unit: 1_000_000, usd: 0.001 },
  d1Written: { included: 50_000_000, unit: 1_000_000, usd: 1 },
  doRequests: { included: 1_000_000, unit: 1_000_000, usd: 0.15 },
  /** GB-seconds. */
  doDuration: { included: 400_000, unit: 1_000_000, usd: 12.5 },
}
/** The plan's monthly base price (USD). */
export const USAGE_BASE_USD = 5

export interface UsageItem {
  key: UsageKey
  /** Month to date; null when Cloudflare did not answer for it. */
  used: number | null
  included: number
}

/** Cloudflare's own figures for this month (UTC), read with the usage token. */
export interface CloudflareUsage {
  from: number
  to: number
  items: UsageItem[]
  /** Base price plus what is over the included amounts. */
  billUsd: number
  /** The same with this month's usage carried to the month's end. */
  projectedUsd: number
}

/** `GET /api/staff/metrics/capacity`. */
export interface StaffCapacityMetrics {
  at: number
  databases: { name: 'gdt' | 'gdt-live'; bytes: number | null; limit: number }[]
  storage: StorageSplit & { wishPulls: number; rawBytes: number }
  /** Stored bytes per day, the last 7 UTC days' average. */
  growthPerDay: number
  /** null: the usage token is not set. */
  usage: CloudflareUsage | null
}

/** What a month's usage costs: the base price plus each item's part over what is included. */
export function usageBill(items: readonly UsageItem[], scale = 1): number {
  let usd = USAGE_BASE_USD
  for (const item of items) {
    if (item.used === null) continue
    const plan = USAGE_PLAN[item.key]
    const over = item.used * scale - plan.included
    if (over > 0) usd += (over / plan.unit) * plan.usd
  }
  return Math.round(usd * 100) / 100
}

/**
 * A client program's name as staff see it. `client` is what it called itself
 * when it signed in (kept from 0041 on); before that the session only says
 * whether it was Teyvat.me or irminsul (`label`, "Teyvat.me on <device>").
 * Teyvat.me's own two programs are told apart by the platform a heartbeat
 * reports; any other client keeps its own name.
 */
export function clientProgram(
  client: string | null | undefined,
  label: string | null | undefined,
  platform: string | null | undefined,
): string {
  const name = (client ?? '').trim().toLowerCase()
  const ours = name === 'teyvatme' || (!name && (label ?? '').startsWith('Teyvat.me'))
  if (ours) {
    if (platform === 'android') return 'teyvat.me-android'
    return platform ? 'teyvat.me-desktop' : 'teyvat.me'
  }
  if (name && name !== 'irminsul') return name
  return 'irminsul'
}

/** A client's own name as it may be stored: lowercase letters, digits, `.`, `_`, `-`, at most 32. */
export function clientName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim().toLowerCase()
  return /^[a-z0-9][a-z0-9._-]{0,31}$/.test(name) ? name : null
}

/** Line points for values drawn in a `width` x `height` box (y down), as an SVG `points` string. */
export function linePoints(
  values: readonly number[],
  max: number,
  width = 100,
  height = 30,
): string {
  if (values.length === 0) return ''
  const top = Math.max(1, max)
  const step = values.length > 1 ? width / (values.length - 1) : 0
  return values
    .map((v, i) => {
      const x = values.length > 1 ? i * step : width / 2
      const y = height - 1 - (Math.max(0, v) / top) * (height - 2)
      return `${Number(x.toFixed(2))},${Number(y.toFixed(2))}`
    })
    .join(' ')
}
