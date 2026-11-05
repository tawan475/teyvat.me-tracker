/**
 * The resin tracker, pure: Original Resin now from the newest reading, the
 * capture's (irminsul's `gi_player.resin` at login, or a snapshot's
 * `OriginalResin` count) or one set by hand, regenerating one per 8 minutes
 * up to 200 (more only from refills, which don't regenerate).
 *
 * A reading set by hand counts until a capture read after it: the planner's
 * rule for hand edits, a newer capture replaces them. irminsul reads resin at
 * login, so a capture later in the same session leaves a hand-set value
 * alone; the next login replaces it.
 */

import {
  RESIN_MAX,
  RESIN_MINUTES,
  type LoginResin,
  type ResinNow,
} from '@gdt/game-data/planner-estimate'
import type { ManualResin } from '@gdt/shared'

export { RESIN_MAX }

/** One point every 8 minutes. */
export const RESIN_STEP_MS = RESIN_MINUTES * 60_000

/** Hand-set values stop here (refills can take resin past the natural cap). */
export const RESIN_LIMIT = 2_000

export interface ResinReading {
  value: number
  /** When it was read or set (ms since epoch). */
  at: number
  source: 'manual' | ResinNow['source']
}

/** The reading to count from: the hand-set one when it is newer than the capture's. */
export function resinReading(
  captured: Pick<ResinNow, 'known' | 'atSnapshot' | 'at' | 'source'> | null,
  manual: ManualResin | null | undefined,
): ResinReading | null {
  const capture = captured?.known
    ? { value: captured.atSnapshot, at: captured.at, source: captured.source }
    : null
  if (manual && (!capture || manual.at > capture.at)) {
    return { value: manual.value, at: manual.at, source: 'manual' }
  }
  return capture
}

/**
 * A capture's resin clock (`gi_tasks.resin`: the resin then and when the next
 * one comes) as a reading on the game's own timer: the last point landed one
 * step before the next, so counting on from there gets every later one right.
 */
export function clockReading(clock: { value: number; nextAt: number }): LoginResin {
  return { value: clock.value, at: clock.nextAt * 1000 - RESIN_STEP_MS }
}

/**
 * Resin the live journal set (`gi_player.resin`: spent or refilled in game
 * since the login) as a reading. The journal keeps only the last value and
 * when its last batch came, so the reading is dated then, on the login
 * clock's grid when there is one (the game's timer runs on when resin is
 * spent): never more than the game has, at worst a point or two less.
 */
export function liveReading(
  value: number,
  updatedAt: number,
  clock: { value: number; nextAt: number } | null | undefined,
): LoginResin {
  if (!clock) return { value, at: updatedAt }
  const tick = clockReading(clock).at
  const steps = Math.floor((updatedAt - tick) / RESIN_STEP_MS)
  return { value, at: steps >= 0 ? tick + steps * RESIN_STEP_MS : updatedAt }
}

/**
 * The capture's resin before live sync: the login's clock, unless a later
 * snapshot of the session read a different count (`gi_player.resin`, the
 * clock stays the login's): then that count, on the clock's grid.
 */
export function capturedResin(
  clock: { value: number; nextAt: number } | null | undefined,
  player: LoginResin | null,
): LoginResin | null {
  if (!clock) return player
  const login = clockReading(clock)
  if (player && player.value !== clock.value && player.at > login.at) {
    return liveReading(player.value, player.at, clock)
  }
  return login
}

/** Whether a hand-set value was replaced by a capture read after it. */
export function manualReplaced(
  captured: Pick<ResinNow, 'known' | 'at'> | null,
  manual: ManualResin | null | undefined,
): boolean {
  return !!manual && !!captured?.known && captured.at >= manual.at
}

/** Resin at `now`: the reading plus what regenerated since, up to 200 (a value above stays). */
export function resinAt(reading: Pick<ResinReading, 'value' | 'at'>, now: number): number {
  if (reading.value >= RESIN_MAX) return reading.value
  const regenerated = Math.max(0, Math.floor((now - reading.at) / RESIN_STEP_MS))
  return Math.min(RESIN_MAX, reading.value + regenerated)
}

/**
 * When resin reaches `amount` (ms since epoch): in the past when it has
 * already, null when regeneration never gets there (above 200). A reading
 * dated after `now` (a clock ahead, a capture stamped in the future) counts
 * from `now`: the number shown is the reading's, so its countdowns start
 * here too (the user, 2026-11-05: "155 now" beside "Full in 2 days").
 */
export function reachedAt(
  reading: Pick<ResinReading, 'value' | 'at'>,
  amount: number,
  now: number = reading.at,
): number | null {
  const from = Math.min(reading.at, now)
  if (reading.value >= amount) return from
  if (amount > RESIN_MAX) return null
  return from + (amount - reading.value) * RESIN_STEP_MS
}

/** When resin is full (200), null when it already is. */
export function fullAt(reading: Pick<ResinReading, 'value' | 'at'>, now: number): number | null {
  const at = reachedAt(reading, RESIN_MAX, now)
  return at === null || at <= now ? null : at
}

/**
 * The next multiple of `step` above the resin now (40: one more boss run)
 * and when it is there; null when full.
 */
export function nextMark(
  reading: Pick<ResinReading, 'value' | 'at'>,
  now: number,
  step = 40,
): { amount: number; at: number } | null {
  const current = resinAt(reading, now)
  if (current >= RESIN_MAX) return null
  const amount = Math.min(RESIN_MAX, (Math.floor(current / step) + 1) * step)
  return { amount, at: reachedAt(reading, amount, now)! }
}

/** At most this many "when resin reaches" amounts (account setting `planner.resinMarks`). */
export const MAX_RESIN_MARKS = 12
/** At most this many quick buttons (account setting `planner.resinSteps`). */
export const MAX_RESIN_STEPS = 4

export interface ResinMark {
  amount: number
  /** When resin is (or was) there, ms since epoch. */
  at: number
  /** Already there at `now`. */
  reached: boolean
}

/**
 * Each chosen amount (the account's `planner.resinMarks`) with when resin
 * reaches it, in amount order (reached ones come first by nature).
 */
export function resinMarks(
  reading: Pick<ResinReading, 'value' | 'at'>,
  now: number,
  amounts: readonly number[],
): ResinMark[] {
  const current = resinAt(reading, now)
  return [...new Set(amounts)]
    .filter((amount) => Number.isInteger(amount) && amount > 0 && amount <= RESIN_MAX)
    .sort((a, b) => a - b)
    .map((amount) => {
      const at = reachedAt(reading, amount, now)!
      return { amount, at, reached: current >= amount }
    })
}

/**
 * Resin set to `value` at `now`, keeping the regeneration clock: a point
 * under way since the last one still lands when it would have (the game's
 * timer doesn't restart when resin is spent).
 */
export function setResin(
  reading: Pick<ResinReading, 'value' | 'at'> | null,
  value: number,
  now: number,
): ManualResin {
  const v = Math.max(0, Math.min(RESIN_LIMIT, Math.trunc(value)))
  if (!reading || resinAt(reading, now) >= RESIN_MAX || v >= RESIN_MAX || now < reading.at) {
    return { value: v, at: now }
  }
  const phase = (now - reading.at) % RESIN_STEP_MS
  return { value: v, at: now - phase }
}

/** A quick button (−40, +60): the resin now plus `delta`; null when that is below zero. */
export function stepResin(
  reading: Pick<ResinReading, 'value' | 'at'> | null,
  delta: number,
  now: number,
): ManualResin | null {
  const current = reading ? resinAt(reading, now) : 0
  const next = current + delta
  if (next < 0) return null
  return setResin(reading, next, now)
}

/**
 * When a resin alert at `amount` should fire: the moment resin reaches it,
 * null when it already has (nothing to wait for) or never will.
 */
export function alertAt(
  reading: Pick<ResinReading, 'value' | 'at'> | null,
  amount: number,
  now: number,
): number | null {
  if (!reading || amount <= 0) return null
  const at = reachedAt(reading, amount, now)
  return at === null || at <= now ? null : at
}

/**
 * One typed amount ("-40", "+60", "60", "−20"): a whole number, sign
 * optional; null when it isn't one.
 */
export function parseAmount(text: string): number | null {
  const t = text.trim().replace(/^[−–]/, '-')
  if (!/^[+-]?\d{1,3}$/.test(t)) return null
  return Number(t)
}

/**
 * The "when resin reaches" list with `amount` added: 1–200, each once,
 * ascending, at most MAX_RESIN_MARKS. Null when it can't be added (out of
 * range, already there, the list full).
 */
export function addMark(marks: readonly number[], amount: number): number[] | null {
  if (!Number.isInteger(amount) || amount < 1 || amount > RESIN_MAX) return null
  if (marks.includes(amount) || marks.length >= MAX_RESIN_MARKS) return null
  return [...marks, amount].sort((a, b) => a - b)
}

/**
 * The quick buttons with `step` added at the end (shown in the order
 * chosen): −200 … 200, not zero, each once, at most MAX_RESIN_STEPS. Null
 * when it can't be added.
 */
export function addStep(steps: readonly number[], step: number): number[] | null {
  if (!Number.isInteger(step) || step === 0 || step < -RESIN_MAX || step > RESIN_MAX) return null
  if (steps.includes(step) || steps.length >= MAX_RESIN_STEPS) return null
  return [...steps, step]
}

export const formatStep = (n: number) => (n > 0 ? `+${n}` : `−${Math.abs(n)}`)
