/**
 * When Home suggests adding a passkey (the card and corner toast): a casual
 * reminder every now and then, never obnoxious (the user's words). Kept per
 * browser in localStorage `gdt:passkey-nudge`:
 *
 * - at most once every NUDGE_EVERY_MS (showing it counts, answered or not);
 * - never again after MAX_DISMISSALS "Not now"s, or once a passkey was made here;
 * - not in the first days after signing up (let them see the app first).
 *
 * The schedule is pure here (tested); passkey-nudge-store.ts keeps it.
 * The caller also checks that the device can make one and the account has none.
 */

const DAY_MS = 86_400_000
export const NUDGE_EVERY_MS = 30 * DAY_MS
export const MAX_DISMISSALS = 3
/** How long after a sign-up the first card waits. */
export const AFTER_SIGNUP_MS = 7 * DAY_MS

export interface NudgeState {
  /** Not shown before this (ms); 0: any time. */
  due: number
  /** "Not now"s so far. */
  dismissed: number
  /** A passkey was made in this browser: never again. */
  done?: boolean
}

export const nudgeDue = (state: NudgeState, now = Date.now()): boolean =>
  !state.done && state.dismissed < MAX_DISMISSALS && now >= state.due

/** Shown now: not again for a while. */
export const shownNudge = (state: NudgeState, now = Date.now()): NudgeState => ({
  ...state,
  due: now + NUDGE_EVERY_MS,
})

export const dismissedNudge = (state: NudgeState, now = Date.now()): NudgeState => ({
  ...state,
  due: now + NUDGE_EVERY_MS,
  dismissed: state.dismissed + 1,
})
