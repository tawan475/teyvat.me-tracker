import type { GiStygianFight, GiStygianPlayer, GiStygianRecord } from '@gdt/shared'
import { giCdnArt } from '@/lib/assets'

/**
 * Stygian Onslaught co-op records (Capture 1.17.20): who played and which
 * characters each player brought, as the game's record screen shows them.
 * Captures before 1.17.20 carry only the account's own team; then every
 * character is the account's and no badge is drawn.
 */

/** A character of a fight, with its player when the capture names one. */
export interface FightMember {
  key: string
  /** The player's position (1-4: 1P-4P); null when the capture has no players. */
  p: number | null
  /** The account's own character. */
  self: boolean
  /** As at the record (Capture 1.17.20+). */
  level?: number
  constellation?: number
}

/** The account's position in a co-op record, null when not known. */
export function selfPosition(record: GiStygianRecord): number | null {
  return record.players?.find((p) => p.self)?.p ?? null
}

/**
 * A fight's characters in the game's order: player by player (1P first),
 * each player's own order inside. Without players (older captures), the
 * account's team alone.
 */
export function fightMembers(record: GiStygianRecord, fight: GiStygianFight): FightMember[] {
  if (!fight.players) return fight.team.map((key) => ({ key, p: null, self: true }))
  const own = record.coop ? selfPosition(record) : 1
  // A co-op record whose player list didn't come: the account's team tells
  // its position apart (the one team holding exactly those characters).
  const mine =
    own ??
    fight.players.find(
      (t) => t.team.length === fight.team.length && t.team.every((m) => fight.team.includes(m.key)),
    )?.p ??
    null
  return [...fight.players]
    .sort((a, b) => a.p - b.p)
    .flatMap((t) =>
      t.team.map((m) => ({
        key: m.key,
        p: record.coop ? t.p : null,
        self: t.p === mine,
        ...(m.level !== undefined ? { level: m.level } : {}),
        ...(m.constellation !== undefined ? { constellation: m.constellation } : {}),
      })),
    )
}

/** A co-op record's players by position (none for solo records and older captures). */
export function recordPlayers(record: GiStygianRecord): GiStygianPlayer[] {
  return record.coop && record.players ? [...record.players].sort((a, b) => a.p - b.p) : []
}

/**
 * The game's short co-op badge for a position: green for another player
 * (`UI_MarkPlayer<n>`), blue for you (`UI_MarkPlayer<n>_Self`), on gi-cdn.
 */
export function coopBadge(p: number, self: boolean): string {
  return giCdnArt(`UI_MarkPlayer${p}${self ? '_Self' : ''}`)
}
