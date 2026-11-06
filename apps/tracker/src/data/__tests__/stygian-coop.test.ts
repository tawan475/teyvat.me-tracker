import { describe, expect, it } from 'vitest'
import type { GiStygianRecord } from '@gdt/shared'
import { coopBadge, fightMembers, recordPlayers, selfPosition } from '../stygian-coop'

const coop: GiStygianRecord = {
  season: 5_269_012,
  difficulty: 6,
  at: 1_790_972_494,
  coop: true,
  players: [
    { p: 2, self: true, picture: 2, nickname: 'Traveler' },
    { p: 1, self: false, nickname: 'Lumine' },
    { p: 3, self: false },
  ],
  fights: [
    {
      time: 44,
      done: true,
      team: ['Xilonen', 'Citlali'],
      players: [
        { p: 3, team: [{ key: 'Bennett', level: 90, constellation: 6 }] },
        { p: 1, team: [{ key: 'Mavuika', level: 90 }] },
        { p: 2, team: [{ key: 'Xilonen', level: 90, constellation: 2 }, { key: 'Citlali' }] },
      ],
    },
  ],
}

describe('Stygian co-op records', () => {
  it("lists a fight's characters player by player, the account's marked", () => {
    expect(fightMembers(coop, coop.fights[0]!)).toEqual([
      { key: 'Mavuika', p: 1, self: false, level: 90 },
      { key: 'Xilonen', p: 2, self: true, level: 90, constellation: 2 },
      { key: 'Citlali', p: 2, self: true },
      { key: 'Bennett', p: 3, self: false, level: 90, constellation: 6 },
    ])
    expect(selfPosition(coop)).toBe(2)
    expect(recordPlayers(coop).map((p) => p.p)).toEqual([1, 2, 3])
  })

  it("finds the account's position by its team when the player list is missing", () => {
    const { players: _players, ...bare } = coop
    expect(
      fightMembers(bare, coop.fights[0]!)
        .filter((m) => m.self)
        .map((m) => m.key),
    ).toEqual(['Xilonen', 'Citlali'])
    expect(recordPlayers(bare)).toEqual([])
  })

  it('keeps older captures and solo records badge-free', () => {
    const old = {
      ...coop,
      players: undefined,
      fights: [{ time: 44, done: true, team: ['Xilonen'] }],
    }
    expect(fightMembers(old, old.fights[0]!)).toEqual([{ key: 'Xilonen', p: null, self: true }])
    const solo: GiStygianRecord = {
      ...coop,
      coop: false,
      players: undefined,
      fights: [
        {
          time: 31,
          done: true,
          team: ['Furina'],
          players: [{ p: 1, team: [{ key: 'Furina', level: 90, constellation: 6 }] }],
        },
      ],
    }
    expect(fightMembers(solo, solo.fights[0]!)).toEqual([
      { key: 'Furina', p: null, self: true, level: 90, constellation: 6 },
    ])
  })

  it("uses the game's short badges, blue for you", () => {
    expect(coopBadge(1, false)).toMatch(/\/UI_MarkPlayer1\.webp$/)
    expect(coopBadge(4, true)).toMatch(/\/UI_MarkPlayer4_Self\.webp$/)
  })
})
