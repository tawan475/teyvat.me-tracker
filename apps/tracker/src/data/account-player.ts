/**
 * What irminsul's `gi_player` says about an account across its snapshots,
 * for the planner: Adventure Rank, World Level and Original Resin.
 *
 * The game sends these values at login and irminsul does not follow them
 * while the game runs, so every snapshot of one session carries the same
 * section (stored once, same hash). Resin therefore counts from the first
 * snapshot of that run, the one closest to the login, not from the newest.
 *
 * Teyvat.me Capture's Account numbers switch (`gi_off` names
 * `gi_player.numbers`, issue 12) leaves resin out: "now" is then the newest
 * capture that shared the numbers, at its own time.
 */

import type { LoginResin } from '@gdt/game-data/planner-estimate'
import { PROFILE_FIELDS, type GiPlayer } from '@gdt/shared'

/** One snapshot's `gi_player`. */
export type PlayerValues = GiPlayer

/** One snapshot's player section, as a bundle lists it. */
export interface PlayerSection {
  takenAt: number
  /** The section's hash; null or absent when the snapshot has none. */
  key?: string | null
  /** The snapshot's `gi_off` (Teyvat.me Capture's switches that were off); absent: all shared. */
  off?: readonly string[]
}

/** The `gi_off` name of the account numbers (UID, AR, WL, resin…). */
export const NUMBERS_SWITCH = 'gi_player.numbers'

const sharesNumbers = (s: PlayerSection) => !s.off?.includes(NUMBERS_SWITCH)

export interface AccountPlayer {
  /** From the newest snapshot that has each; null when none does. */
  ar: number | null
  wl: number | null
  /**
   * Original Resin, only when the newest snapshot that shared the account
   * numbers has it (an older count would be stale), with the time of the
   * first snapshot of its session.
   */
  resin: LoginResin | null
  /**
   * The newest snapshot left the account numbers out (`gi_off`): its resin
   * figures (the bag's Original Resin count included) are not a reading.
   */
  numbersOff: boolean
  /** The newest snapshot's whole section (Overview's Traveler panel); null when it has none. */
  profile: GiPlayer | null
}

export const NO_PLAYER: AccountPlayer = {
  ar: null,
  wl: null,
  resin: null,
  numbersOff: false,
  profile: null,
}

/** Each distinct section is decoded once. */
export function accountPlayer(
  sections: readonly PlayerSection[],
  decode: (key: string) => PlayerValues,
): AccountPlayer {
  const newestFirst = [...sections].sort((a, b) => b.takenAt - a.takenAt)
  const decoded = new Map<string, PlayerValues>()
  const values = (key: string) => {
    let value = decoded.get(key)
    if (!value) decoded.set(key, (value = decode(key)))
    return value
  }

  let ar: number | null = null
  let wl: number | null = null
  for (const { key } of newestFirst) {
    if (!key) continue
    const player = values(key)
    ar ??= player.ar ?? null
    wl ??= player.wl ?? null
    if (ar !== null && wl !== null) break
  }

  let resin: LoginResin | null = null
  const newest = newestFirst[0]
  const from = newestFirst.findIndex(sharesNumbers)
  const shared = newestFirst[from]
  const value = shared?.key ? values(shared.key).resin : undefined
  if (shared?.key && value !== undefined) {
    let at = shared.takenAt
    for (const s of newestFirst.slice(from)) {
      if (s.key !== shared.key) break
      at = s.takenAt
    }
    resin = { value, at }
  }

  return {
    ar,
    wl,
    resin,
    numbersOff: !!newest && !sharesNumbers(newest),
    profile: newest?.key ? values(newest.key) : null,
  }
}

/**
 * The profile (name, signature, name card, picture, birthday) of the newest
 * snapshot that has one, and when it was taken: what Overview's card keeps
 * showing while Teyvat.me Capture leaves the profile out (issue 12). Null
 * when no snapshot has one.
 */
export function lastProfile(
  sections: readonly PlayerSection[],
  decode: (key: string) => PlayerValues,
): { fields: Partial<GiPlayer>; takenAt: number } | null {
  const newestFirst = [...sections].sort((a, b) => b.takenAt - a.takenAt)
  const seen = new Set<string>()
  for (const { key, takenAt } of newestFirst) {
    if (!key || seen.has(key)) continue
    seen.add(key)
    const player = decode(key)
    const fields: Partial<GiPlayer> = {}
    for (const field of PROFILE_FIELDS) {
      if (player[field] !== undefined) (fields as Record<string, unknown>)[field] = player[field]
    }
    if (Object.keys(fields).length > 0) return { fields, takenAt }
  }
  return null
}
