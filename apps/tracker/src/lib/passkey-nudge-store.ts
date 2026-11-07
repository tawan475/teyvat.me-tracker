/** Where lib/passkey-nudge's schedule is kept: localStorage `gdt:passkey-nudge`. */

import { AFTER_SIGNUP_MS, type NudgeState } from './passkey-nudge'
import { readJson, writeJson } from './storage'

const KEY = 'passkey-nudge'

export function readNudge(): NudgeState {
  const state = readJson<Partial<NudgeState>>(KEY, {})
  return {
    due: typeof state.due === 'number' ? state.due : 0,
    dismissed: typeof state.dismissed === 'number' ? state.dismissed : 0,
    done: state.done === true,
  }
}

export const saveNudge = (state: NudgeState): void => writeJson(KEY, state)

/** Just signed up: the first card waits AFTER_SIGNUP_MS. */
export function markSignedUp(now = Date.now()): void {
  const state = readNudge()
  saveNudge({ ...state, due: Math.max(state.due, now + AFTER_SIGNUP_MS) })
}

export function markPasskeyMade(): void {
  saveNudge({ ...readNudge(), done: true })
}
