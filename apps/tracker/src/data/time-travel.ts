/**
 * Time travel (docs/plans/time-travel.md; the user's design A3, 2026-11-09):
 * `?at=<snapshot id>` on an account page shows the whole account as that
 * capture had it. AccountLayout hands the pages a travelled account: its
 * `latest` is that snapshot, live sync off, its history cut there, and the
 * page read-only. Nothing is stored: the address carries it.
 *
 * This module holds what the shell needs (the bar, the write guard) and the
 * pure rules; the loaders read `AccountRef.travel` (data/account-data.ts).
 */

import { shallowRef } from 'vue'

/** Where an account is travelled to. */
export interface Travel {
  /** The snapshot travelled to. */
  at: number
  takenAt: number
  /** Its place among the account's live snapshots, oldest first, 1-based. */
  index: number
  total: number
}

/** The account being viewed in the past (one at a time: the page's), or null. */
export const travelling = shallowRef<{ accountId: number; travel: Travel } | null>(null)

/** The `?at` value of a route's query: a snapshot id, or null. */
export function travelParam(query: Record<string, unknown>): number | null {
  const raw = query.at
  const text = Array.isArray(raw) ? raw[0] : raw
  if (typeof text !== 'string' || !/^\d{1,15}$/.test(text)) return null
  const id = Number(text)
  return id > 0 ? id : null
}

interface Snap {
  id: number
  takenAt: number
}

/** Snapshots oldest first, as bundles order them (taken time, then id). Pure. */
export function oldestFirst<T extends Snap>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => a.takenAt - b.takenAt || a.id - b.id)
}

/** Where `at` sits in `list` (any order), or null when it is not there. Pure. */
export function travelTo(list: readonly Snap[], at: number): Travel | null {
  const ordered = oldestFirst(list)
  const index = ordered.findIndex((s) => s.id === at)
  if (index < 0) return null
  return { at, takenAt: ordered[index]!.takenAt, index: index + 1, total: ordered.length }
}

/** The part of `list` that existed at `travel`: up to and including its snapshot. Pure. */
export function historyAt<T extends Snap>(list: readonly T[], travel: Travel): T[] {
  const ordered = oldestFirst(list)
  const index = ordered.findIndex((s) => s.id === travel.at)
  if (index < 0) return ordered.filter((s) => s.takenAt <= travel.takenAt)
  const kept = new Set(ordered.slice(0, index + 1).map((s) => s.id))
  // In the list's own order (the snapshot list is newest first).
  return list.filter((s) => kept.has(s.id))
}

/** The snapshot before / after `at` (oldest first), for Older / Newer. Pure. */
export function stepFrom(list: readonly Snap[], at: number, step: -1 | 1): number | null {
  const ordered = oldestFirst(list)
  const index = ordered.findIndex((s) => s.id === at)
  if (index < 0) return null
  return ordered[index + step]?.id ?? null
}

/**
 * The past is read-only: an account write sent while viewing it would land
 * on now. The API client refuses one (api/http.ts) as a second guard
 * behind the read-only mode the pages already honour. True for a request
 * that writes to the travelled account. Pure apart from `travelling`.
 */
export function blockedInThePast(path: string, method: string | undefined): boolean {
  const state = travelling.value
  if (!state) return false
  if (!method || method.toUpperCase() === 'GET' || method.toUpperCase() === 'HEAD') return false
  const prefix = `/api/accounts/${state.accountId}`
  return path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`)
}

/**
 * Set by "Back to now" (and the picker's "now") right before it navigates:
 * the router keeps `?at` on in-account links unless this is set.
 */
let leaving = false
export function leavePastOnNextNavigation(): void {
  leaving = true
}
export function takeLeaving(): boolean {
  const was = leaving
  leaving = false
  return was
}

/** The parts of a route the router guard reads. */
export interface RouteLike {
  path: string
  params: Record<string, unknown>
  query: Record<string, unknown>
  hash: string
}

/** Two routes are about the same account: its id, or the demo / guest area. Pure. */
export function sameAccount(to: RouteLike, from: RouteLike): boolean {
  const id = (r: RouteLike) => r.params.accountId
  if (id(to) !== undefined || id(from) !== undefined) return id(to) === id(from)
  const area = (path: string) => /^\/(demo|guest)(\/|$)/.exec(path)?.[1] ?? null
  return area(to.path) !== null && area(to.path) === area(from.path)
}

/**
 * The router's guard: a link from a page in the past to another page of the
 * same account stays in the past (`?at` carried over); "Back to now"
 * (`leaving`), a link that names its own `?at` and a link to another
 * account or outside one leave it. The route to go to instead, or null. Pure.
 */
export function keepPast(
  to: RouteLike,
  from: RouteLike,
  leaving: boolean,
): { path: string; query: Record<string, unknown>; hash: string; replace: true } | null {
  const at = from.query.at
  if (leaving || at === undefined || to.query.at !== undefined) return null
  if (!sameAccount(to, from)) return null
  return { path: to.path, query: { ...to.query, at }, hash: to.hash, replace: true }
}
