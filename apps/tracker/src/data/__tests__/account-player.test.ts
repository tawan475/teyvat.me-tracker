import { describe, expect, it } from 'vitest'
import { NO_PLAYER, accountPlayer, type PlayerValues } from '../account-player'

describe('accountPlayer', () => {
  const players: Record<string, PlayerValues> = {
    login1: { ar: 57, wl: 8, resin: 40 },
    login2: { ar: 58, resin: 120 },
    noResin: { ar: 58, wl: 8 },
  }
  const decoded: string[] = []
  const decode = (key: string) => {
    decoded.push(key)
    return players[key]!
  }

  it('takes AR and WL from the newest snapshot that has each', () => {
    decoded.length = 0
    const player = accountPlayer(
      [
        { takenAt: 100, key: 'login1' },
        { takenAt: 200, key: 'login1' },
        { takenAt: 300, key: 'login2' },
        { takenAt: 400, key: null },
      ],
      decode,
    )
    expect(player.ar).toBe(58)
    expect(player.wl).toBe(8)
    // The newest snapshot has no player section: its resin is not known.
    expect(player.resin).toBeNull()
    expect(decoded).toEqual(['login2', 'login1'])
  })

  it("counts resin from the first snapshot of the newest one's session", () => {
    const player = accountPlayer(
      [
        { takenAt: 100, key: 'login1' },
        { takenAt: 200, key: 'login2' },
        { takenAt: 300, key: 'login2' },
        { takenAt: 400, key: 'login2' },
      ],
      decode,
    )
    expect(player.resin).toEqual({ value: 120, at: 200 })
    expect(player.ar).toBe(58)
    expect(player.wl).toBe(8)
  })

  it('has no resin when the newest player section lacks it', () => {
    const player = accountPlayer(
      [
        { takenAt: 100, key: 'login1' },
        { takenAt: 200, key: 'noResin' },
      ],
      decode,
    )
    expect(player).toEqual({ ar: 58, wl: 8, resin: null, profile: { ar: 58, wl: 8 } })
  })

  it("keeps the newest snapshot's whole section as the profile", () => {
    const player = accountPlayer(
      [
        { takenAt: 100, key: 'login2' },
        { takenAt: 200, key: 'login1' },
      ],
      decode,
    )
    expect(player.profile).toEqual(players.login1)
    expect(
      accountPlayer([{ takenAt: 1, key: 'login1' }, { takenAt: 2 }], decode).profile,
    ).toBeNull()
  })

  it('knows nothing without player sections', () => {
    expect(accountPlayer([], decode)).toEqual(NO_PLAYER)
    expect(accountPlayer([{ takenAt: 1 }, { takenAt: 2, key: null }], decode)).toEqual(NO_PLAYER)
  })
})

describe('the last profile (issue 12)', () => {
  it('is the newest snapshot that has one, with its time', async () => {
    const { lastProfile } = await import('../account-player')
    const sections = {
      a: { ar: 58, nickname: 'player01', nameCard: 210_001 },
      b: { ar: 59 },
    }
    const decode = (key: string) => sections[key as keyof typeof sections]
    expect(
      lastProfile(
        [
          { takenAt: 1, key: 'a' },
          { takenAt: 2, key: 'b' },
        ],
        decode,
      ),
    ).toEqual({ fields: { nickname: 'player01', nameCard: 210_001 }, takenAt: 1 })
    expect(lastProfile([{ takenAt: 2, key: 'b' }], decode)).toBeNull()
  })
})
