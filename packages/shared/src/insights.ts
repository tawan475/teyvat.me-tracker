/**
 * The staff Insights page (`/api/staff/insights/*`, node `site.metrics`): who
 * the users are, whether they come back, which parts of the site they use
 * and how uploads run into limits; plus what the staff Overview, Users and
 * Audit pages gained with it (site health, job runs, moderation filters,
 * the audit summary). Totals and shares only: nothing here names a user.
 * Every figure is read when a staff member opens the page and kept for ten
 * minutes (README "Staff insights"). No zod: types and small pure helpers.
 */

import type { GenshinServer } from './api'
import type { DayCount } from './staff'

export const INSIGHT_TABS = ['all', 'people', 'retention', 'features', 'uploads'] as const
export type InsightTab = (typeof INSIGHT_TABS)[number]

/** Which place a user is counted under: where they signed up from, or their newest session's. */
export const COUNTRY_BASES = ['signup', 'session'] as const
export type CountryBasis = (typeof COUNTRY_BASES)[number]

export interface CountryRow {
  /** ISO 3166-1 alpha-2 as Cloudflare reports it; null: not known. */
  code: string | null
  users: number
  active7d: number
  new30d: number
  /** Users with a client program signed in. */
  withClient: number
  /** Stored a snapshot in the last 30 days. */
  uploading: number
}

export interface ClientRow {
  /** The program's own name (`clientProgram`). */
  program: string
  /** null: no heartbeat has said yet. */
  version: string | null
  devices: number
  seen24h: number
  /** Unix ms this version was first heard (null with no version). */
  firstSeenAt: number | null
  /** A newer version of the same program is in use. */
  old: boolean
}

/** `GET /api/staff/insights/people`. */
export interface StaffPeopleInsights {
  at: number
  users: number
  accounts: number
  basis: CountryBasis
  /** Most users first. */
  countries: CountryRow[]
  ways: {
    password: number
    discord: number
    google: number
    /** Users with at least one passkey, and how many passkeys there are. */
    passkey: number
    passkeys: number
    noPassword: number
    /** Exactly one way to sign in: losing it locks them out. */
    oneWay: number
    suspended: number
    uploadsBlocked: number
  }
  /** `system` or a site language code, most users first. */
  languages: { key: string; users: number }[]
  themes: { key: string; users: number }[]
  servers: { key: GenshinServer | null; accounts: number }[]
  clients: ClientRow[]
}

/** `GET /api/staff/insights/retention`. */
export interface StaffRetentionInsights {
  at: number
  /**
   * Sign-up weeks (Monday, UTC), oldest first. `active[k]`: how many of the
   * week's sign-ups stored a snapshot k weeks later (null: that week has not
   * come yet).
   */
  cohorts: { week: string; users: number; active: (number | null)[] }[]
  /** Sign-up months, oldest first: how many were active in the last 7 and 30 days. */
  months: { month: string; users: number; seen7d: number; seen30d: number }[]
  /** The last 30 days' sign-ups, those that brought a guest account, and those of them active in 7 days. */
  guests: { signups: number; fromGuest: number; stillActive: number }
}

export const FEATURE_KEYS = [
  'plannerGoals',
  'wishes',
  'achievements',
  'tasks',
  'weaponGoals',
  'anecdotes',
  'quests',
  'sharing',
] as const
export type FeatureKey = (typeof FEATURE_KEYS)[number]

export const ALERT_KINDS = [
  'resin',
  'resinFull',
  'expeditions',
  'welkin',
  'commissions',
  'bargains',
] as const
export type AlertKind = (typeof ALERT_KINDS)[number]

/** `GET /api/staff/insights/features`. */
export interface StaffFeatureInsights {
  at: number
  accounts: number
  /** Accounts with any of it, and with a change in the last 7 days; most used first. */
  features: { key: FeatureKey; accounts: number; changed7d: number }[]
  sharing: { accounts: number; viewers: number; editors: number; pending: number; largest: number }
  alerts: {
    /** Devices with at least one alert on. */
    devices: number
    kinds: Record<AlertKind, number>
    subscriptions: number
    failing: number
    lastOkAt: number | null
  }
  api: {
    tokens: number
    users: number
    used24h: number
    used7d: number
    /** Tokens that may write somewhere. */
    write: number
    expiring: number
    revoked: number
    supporters: number
    customLimits: number
  }
  passkeys: { users: number; used7d: number }
}

/** `GET /api/staff/insights/uploads`. */
export interface StaffUploadInsights {
  at: number
  limits: { dailySnapshots: number; dailyBytes: number }
  atCapToday: number
  atCapWeek: number
  nearQuota: number
  blocked: number
  snapshots24h: number
  bytes24h: number
  /** The last day's snapshots by the program their file names, most first. */
  sources: { key: string; snapshots: number }[]
  /** The same by why a client sent them (`gi_capture.reason`); `none`: no reason given. */
  reasons: { key: string; snapshots: number }[]
  /** How many snapshot headers were read for the two lists (the newest, capped). */
  sampled: number
}

// ---------------------------------------------------------------- overview

export const JOB_NAMES = ['sample', 'events', 'maintenance'] as const
export type JobName = (typeof JOB_NAMES)[number]

export interface JobRun {
  id: number
  job: JobName
  startedAt: number
  tookMs: number
  ok: boolean
  /** The job's own result: counts, or `error`. */
  detail: Record<string, unknown>
}

/** `GET /api/staff/health`: what is switched on, and whether the scheduled jobs run. */
export interface StaffHealthResponse {
  at: number
  features: {
    push: boolean
    humanCheck: boolean
    discord: boolean
    google: boolean
    email: 'on' | 'paused' | 'off'
    /** The Cloudflare usage token, and the zone ID for the per-route counts. */
    usage: boolean
    usageZone: boolean
    liveDb: boolean
  }
  /** Migrations applied to the live database (null without it). */
  liveMigrations: number | null
  /** The newest hourly reading (null before the first). */
  lastSampleAt: number | null
  /** Each job's newest runs, newest first. */
  jobs: JobRun[]
}

// ------------------------------------------------------------------- audit

export const AUDIT_SUMMARY_SERIES = ['views', 'users', 'data', 'deletes', 'other'] as const

/** `GET /api/staff/audit/summary`: the last 30 days of staff actions. */
export interface StaffAuditSummary {
  /** 30 UTC days, oldest first: AUDIT_SUMMARY_SERIES. */
  days: DayCount[]
  /** Per staff member, most actions first. */
  actors: { id: number | null; label: string; actions: number; views: number; deletes: number }[]
}

// ------------------------------------------------------------------- users

/** The Users page's moderation filters (`GET /api/staff/users/flags` counts them). */
export const USER_FLAGS = ['burst', 'manyAccounts', 'sharedUid', 'heavy', 'unused'] as const
export type UserFlag = (typeof USER_FLAGS)[number]

/** A sign-up burst: this many sign-ups from one address within an hour. */
export const BURST_SIGNUPS = 3
/** Many accounts: this many Genshin accounts or more. */
export const MANY_ACCOUNTS = 5
/** Never used: signed up this long ago, stored nothing and never came back. */
export const UNUSED_DAYS = 90

/** `GET /api/staff/users/flags`. */
export type StaffUserFlagsResponse = Record<UserFlag, number>

// ------------------------------------------------------------------ helpers

/** Compares dotted versions number by number ("1.18.1" > "1.9", "0.2.4-T-19" > "0.2.4-T-9"). */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.split(/[^0-9A-Za-z]+/).filter(Boolean)
  const x = parts(a)
  const y = parts(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const p = x[i]
    const q = y[i]
    if (p === undefined) return -1
    if (q === undefined) return 1
    const n = /^\d+$/.test(p) && /^\d+$/.test(q) ? Number(p) - Number(q) : p.localeCompare(q)
    if (n !== 0) return n < 0 ? -1 : 1
  }
  return 0
}

/**
 * A route as the errors table groups it: ids and tokens become `:id` (all
 * digits, or 20 or more characters with a digit among them; a long route
 * name of ours has none).
 */
export function routeOf(path: string): string {
  return path
    .split('/')
    .map((part) =>
      /^\d+$/.test(part) || (part.length >= 20 && /\d/.test(part) && /^[\w.~-]+$/.test(part))
        ? ':id'
        : part,
    )
    .join('/')
}

/** The Monday (UTC, 'YYYY-MM-DD') of the week `ms` is in. */
export function weekStart(ms: number): string {
  const day = new Date(ms)
  const monday = Date.UTC(
    day.getUTCFullYear(),
    day.getUTCMonth(),
    day.getUTCDate() - ((day.getUTCDay() + 6) % 7),
  )
  return new Date(monday).toISOString().slice(0, 10)
}
