import type { Enemies, EnemyNames } from '@gdt/game-data/enemies'
import type { NormalBoss } from '@gdt/game-data/farming'

/**
 * The boss randomizer's pool (docs/plans/fun.md): weekly bosses, the 40-resin
 * bosses and Local Legends, from the game data. No domains (the user's call).
 */

export const BOSS_KINDS = ['weekly', 'world', 'legend'] as const
export type BossKind = (typeof BOSS_KINDS)[number]
export const BOSS_WHERES = ['land', 'water'] as const
export type BossWhere = (typeof BOSS_WHERES)[number]
export const BOSS_PLAYS = ['coop', 'solo'] as const
export type BossPlay = (typeof BOSS_PLAYS)[number]

export interface BossEntry {
  /** Stable per boss: what a ban and the last roll remember. */
  key: string
  kind: BossKind
  name: string
  /** A Local Legend's subtitle; '' otherwise. */
  subtitle: string
  /** Game icon names, one per monster fought (a pair of legends has two). */
  icons: string[]
  /** Fought while diving. */
  water: boolean
  /** Fought alone only: not in Co-Op Mode. */
  solo: boolean
  /** Its Living Beings entry, when it has one. */
  codex: number | null
}

/**
 * The fights held underwater, by a part of the English name. Only Fontaine's
 * Local Legends: the wiki's Local Legend page lists these nine under
 * "Underwater" (read 2026-11-27); no weekly or 40-resin boss is fought diving.
 */
export const UNDERWATER = [
  'Dobharcu',
  'Fading Veteran',
  'Fairy Knight Twin',
  'Swords of the Gorge',
  'Iron Viscount',
  'Ocean Circuit Judge',
  'Luachra',
  'Chassanion',
  'Mageblade Corrouge',
] as const

const underwater = (english: string) => UNDERWATER.some((part) => english.includes(part))

/**
 * The fights that cannot be had in Co-Op Mode, by a part of the English name:
 * Natlan's Local Legends met through a Nightsoul Totem, a trial held alone in
 * the Night Kingdom. The wiki's Local Legend page lists these twelve under
 * "Natlan — Totems" (read 2026-11-29); Natlan's other ten are in the open world.
 */
export const SOLO_ONLY = [
  'He Never Dies',
  "Ichcahuipilli's Aegis",
  "Atlatl's Blessing",
  'Cihuacoatl of Chimeric Bone',
  'Tlatzacuilotl',
  "Chimalli's Shade",
  'Spirit of the Fallen Dawnstar',
  "Potapo's Solidarity",
  "Tupayo's Aid",
  'Ironbeard',
  "Tupu's Lushness",
  'Reji',
] as const

const soloOnly = (english: string) => SOLO_ONLY.some((part) => english.includes(part))

/** Every boss, in the order weekly, 40-resin, Local Legend, each in the game's own order. */
export function bossPool(
  enemies: Pick<Enemies, 'enemies' | 'legends'>,
  names: Pick<EnemyNames, 'name' | 'legend'>,
  /** English names: what the hand-kept lists and the 40-resin boss list are matched on. */
  english: Pick<EnemyNames, 'name' | 'legend'>,
  worldBosses: readonly Pick<NormalBoss, 'name' | 'monsters'>[],
): BossEntry[] {
  const out: BossEntry[] = []
  for (const enemy of enemies.enemies) {
    if (enemy.faction !== 'boss') continue
    out.push({
      key: `w:${enemy.id}`,
      kind: 'weekly',
      name: names.name(enemy.id) || english.name(enemy.id),
      subtitle: '',
      icons: [enemy.icon],
      water: underwater(english.name(enemy.id)),
      solo: false,
      codex: enemy.id,
    })
  }
  const byEnglish = new Map(enemies.enemies.map((e) => [english.name(e.id), e]))
  for (const boss of worldBosses) {
    const enemy =
      byEnglish.get(boss.name) ?? boss.monsters.map((m) => byEnglish.get(m)).find(Boolean)
    out.push({
      key: enemy ? `n:${enemy.id}` : `n:${boss.name}`,
      kind: 'world',
      name: (enemy && names.name(enemy.id)) || boss.name,
      subtitle: '',
      icons: enemy ? [enemy.icon] : [],
      water: underwater(boss.name),
      solo: false,
      codex: enemy?.id ?? null,
    })
  }
  for (const legend of enemies.legends) {
    const text = names.legend(legend.id)
    const en = english.legend(legend.id)
    out.push({
      key: `l:${legend.id}`,
      kind: 'legend',
      name: text.name || en.name,
      subtitle: text.subtitle,
      icons: legend.icons,
      water: underwater(en.name),
      solo: soloOnly(en.name),
      codex: null,
    })
  }
  return out
}

export const bossWhere = (boss: BossEntry): BossWhere => (boss.water ? 'water' : 'land')
export const bossPlay = (boss: BossEntry): BossPlay => (boss.solo ? 'solo' : 'coop')

/** Whether the filters list the boss. An empty filter lists everything of its kind. */
export function listsBoss(
  boss: BossEntry,
  kinds: readonly BossKind[],
  wheres: readonly BossWhere[],
  plays: readonly BossPlay[] = [],
): boolean {
  return (
    (!kinds.length || kinds.includes(boss.kind)) &&
    (!wheres.length || wheres.includes(bossWhere(boss))) &&
    (!plays.length || plays.includes(bossPlay(boss)))
  )
}

/** One of `list` at random; null from an empty list. */
export function pickOne<T>(list: readonly T[], random: () => number = Math.random): T | null {
  return list.length ? list[Math.min(list.length - 1, Math.floor(random() * list.length))]! : null
}

/**
 * The pictures shown small beside the first: the fight's other monsters
 * that look different. A pair that shares one picture shows none.
 */
export function otherIcons(boss: Pick<BossEntry, 'icons'>): string[] {
  const first = boss.icons[0]
  return [...new Set(boss.icons)].filter((icon) => icon !== first)
}

/** How many pictures the roll's reel runs through before it stops. */
export const BOSS_REEL = 12
/** How long the reel runs, ms. */
export const BOSS_REEL_MS = 1600

/**
 * The bosses the reel runs past, in order, before it stops on `result`:
 * random picks of `pool`, no picture twice in a row and none the same as
 * the result just before it (so each tick reads as a new boss). Only those
 * with a picture; empty when the pool has fewer than two of them.
 */
export function reelOf<T extends Pick<BossEntry, 'key' | 'icons'>>(
  pool: readonly T[],
  result: string,
  count = BOSS_REEL,
  random: () => number = Math.random,
): T[] {
  const pictured = pool.filter((b) => b.icons.length)
  if (pictured.length < 2) return []
  const out: T[] = []
  for (let i = 0; i < count; i++) {
    const before = out[i - 1]?.key
    // The last one sits just above the result.
    const after = i === count - 1 ? result : null
    const choices = pictured.filter((b) => b.key !== before && b.key !== after)
    out.push(pickOne(choices.length ? choices : pictured, random)!)
  }
  return out
}
