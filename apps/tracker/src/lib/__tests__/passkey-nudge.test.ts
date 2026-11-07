import { describe, expect, it } from 'vitest'
import {
  MAX_DISMISSALS,
  NUDGE_EVERY_MS,
  dismissedNudge,
  nudgeDue,
  shownNudge,
  type NudgeState,
} from '../passkey-nudge'

const fresh: NudgeState = { due: 0, dismissed: 0 }
const now = Date.UTC(2026, 10, 8)

describe('passkey nudge', () => {
  it('shows at most once every 30 days, shown or dismissed', () => {
    expect(nudgeDue(fresh, now)).toBe(true)
    const shown = shownNudge(fresh, now)
    expect(nudgeDue(shown, now + NUDGE_EVERY_MS - 1)).toBe(false)
    expect(nudgeDue(shown, now + NUDGE_EVERY_MS)).toBe(true)
    const dismissed = dismissedNudge(fresh, now)
    expect(nudgeDue(dismissed, now + 1000)).toBe(false)
    expect(nudgeDue(dismissed, now + NUDGE_EVERY_MS)).toBe(true)
  })

  it('stops after the third Not now, or once a passkey was made', () => {
    let state = fresh
    for (let i = 0; i < MAX_DISMISSALS; i++) state = dismissedNudge(state, now)
    expect(nudgeDue(state, now + 10 * NUDGE_EVERY_MS)).toBe(false)
    expect(nudgeDue({ ...fresh, done: true }, now)).toBe(false)
  })
})
