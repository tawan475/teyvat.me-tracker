/**
 * A character's build sheet, as the details and the share card show it: the
 * in-game Attributes rows (`@gdt/game-data/stats`, the game's panel formula
 * without team buffs, like Enka), talent levels as the game shows them with
 * the C3 / C5 +3, the weapon's own lines, and what each set bonus adds.
 * Pure functions over a roster entry (data/characters.ts).
 */

import type { TalentSlot } from '@gdt/game-data'
import statsJson from '@gdt/game-data/data/stats.json'
import type { StatsFile } from '@gdt/game-data/format'
import {
  computeStats,
  displayStat,
  hasCharacterStats,
  hasWeaponStats,
  weaponStats,
  type PanelStats,
  type StatArtifact,
  type StatCharacter,
  type StatWeapon,
} from '@gdt/game-data/stats'
import { t } from '@/i18n'
import { formatNumber } from '@/lib/format'
import { formatStatName } from '@/utils/artifact-stats'
import type { Element } from './game-meta'

const statsFile = statsJson as unknown as StatsFile

// ------------------------------------------------------------------ panel

/** A DMG bonus row's colour: an element, or physical. */
export type DamageKind = Element | 'physical'

export interface StatRow {
  /** GOOD's stat key (`hp`, `critRate_`, `pyro_dmg_`…). */
  key: string
  /** As the game's Attributes screen names it: "Max HP", "Pyro DMG Bonus". */
  label: string
  /** As displayed: whole for HP / ATK / DEF / EM, percent with one decimal. */
  value: number
  /** "18,663", "62.2%". */
  text: string
  /** HP, ATK and DEF: the white number (character + weapon base) and the green one. */
  base?: number
  bonus?: number
  /** DMG bonus rows. */
  damage?: DamageKind
}

/** The game's order of the DMG bonuses in the Attributes screen. */
export const DAMAGE_ORDER: readonly DamageKind[] = [
  'pyro',
  'hydro',
  'dendro',
  'electro',
  'anemo',
  'cryo',
  'geo',
  'physical',
]

/** "Max HP" where the Attributes screen names a stat differently, else the stat's name. */
export function statLabel(key: string): string {
  if (key === 'hp') return t('characters.stat.maxHp')
  if (key === 'baseAtk') return t('characters.stat.baseAtk')
  return formatStatName(key)
}

/** "18,663" for flat stats, "62.2%" for percentages (GOOD's trailing underscore). */
export function formatPanelValue(key: string, value: number): string {
  return key.endsWith('_') ? `${value.toFixed(1)}%` : formatNumber(Math.round(value))
}

function row(key: string, value: number, extra: Partial<StatRow> = {}): StatRow {
  return { key, label: statLabel(key), value, text: formatPanelValue(key, value), ...extra }
}

/** A DMG bonus the build has: an element's or physical, as displayed (percent). */
export interface DamageBonus {
  kind: DamageKind
  value: number
}

/**
 * The DMG bonus the build actually carries: the highest of the seven
 * elemental bonuses and physical (a Cryo goblet on Diluc is Cryo), all of
 * them when tied, in the game's order; none when every one is 0. Not tied
 * to the character's element.
 */
export function damageBonuses(panel: PanelStats): DamageBonus[] {
  const all = DAMAGE_ORDER.map((kind) => ({
    kind,
    value: kind === 'physical' ? panel.physicalDmg : panel.elementalDmg[kind],
  }))
  const top = Math.max(...all.map((b) => b.value))
  return top > 0 ? all.filter((b) => b.value === top) : []
}

/**
 * The Attributes screen's rows in the game's order: Max HP, ATK, DEF,
 * Elemental Mastery, CRIT Rate, CRIT DMG, Healing Bonus (only when there
 * is some), Energy Recharge, then the build's DMG bonus (damageBonuses:
 * the highest, whatever the character's element; none at 0).
 */
export function panelRows(panel: PanelStats): StatRow[] {
  const split = (key: 'hp' | 'atk' | 'def') =>
    row(key, panel[key], { base: panel.base[key], bonus: panel[key] - panel.base[key] })
  const rows = [
    split('hp'),
    split('atk'),
    split('def'),
    row('eleMas', panel.em),
    row('critRate_', panel.critRate),
    row('critDMG_', panel.critDmg),
  ]
  if (panel.healing > 0) rows.push(row('heal_', panel.healing))
  rows.push(row('enerRech_', panel.er))
  for (const { kind, value } of damageBonuses(panel)) {
    rows.push(row(`${kind}_dmg_`, value, { damage: kind }))
  }
  return rows
}

/** What the build panel reads of a roster entry (data/characters.ts CharacterView). */
export interface BuildInput extends StatCharacter {
  weapon: StatWeapon | null
  artifacts: readonly (StatArtifact | null)[]
}

export interface BuildPanel {
  stats: PanelStats
  rows: StatRow[]
  /** The worn weapon is newer than the game data: its stats are left out. */
  weaponMissing: boolean
  /** All-DMG bonus (Freedom-Sworn, Skyward Pride…) the game's panel doesn't list; 0 when none. */
  allDmg: number
}

/** The panel for a character, or null when the game data doesn't know the character yet. */
export function buildPanel(input: BuildInput): BuildPanel | null {
  if (!hasCharacterStats(input.key)) return null
  const known = input.weapon && hasWeaponStats(input.weapon.key) ? input.weapon : null
  const artifacts = input.artifacts.filter((a): a is StatArtifact => a !== null)
  const stats = computeStats(
    { key: input.key, level: input.level, ascension: input.ascension },
    known,
    artifacts,
  )
  return {
    stats,
    rows: panelRows(stats),
    weaponMissing: input.weapon !== null && known === null,
    allDmg: stats.other.dmg_ ?? 0,
  }
}

// -------------------------------------------------------------------- owner

/**
 * The UID a share card shows: the account's, else the one the newest
 * capture carries (irminsul's `gi_player.uid`; accounts made by a user
 * import key often have none set). null when neither knows it.
 */
export function shareUid(
  accountUid: string | null | undefined,
  playerUid: number | null | undefined,
): string | null {
  const own = accountUid?.trim()
  if (own) return own
  return playerUid && playerUid > 0 ? String(playerUid) : null
}

// ---------------------------------------------------------------- talents

export type TalentKey = TalentSlot

export const TALENT_KEYS: readonly TalentKey[] = ['auto', 'skill', 'burst']

/** "Normal Attack", … in the language on screen (read where it renders). */
export const TALENT_LABELS: Readonly<Record<TalentKey, string>> = {
  get auto() {
    return t('game.normalAttack')
  },
  get skill() {
    return t('game.skill')
  },
  get burst() {
    return t('game.burst')
  },
}

/** The talents a character's 3rd and 5th constellations raise by 3 (the planner data's). */
export interface ConstellationBoosts {
  c3: TalentKey | null
  c5: TalentKey | null
}

export interface TalentLevel {
  key: TalentKey
  /** GOOD's level, what the books paid for. */
  base: number
  /** As the game shows it: base + 3 from C3 or C5. */
  level: number
  /** The constellation that raises it (3 or 5), when unlocked. */
  from: 3 | 5 | null
  /** A Crown of Insight spent: base level 10. */
  crowned: boolean
  /** Base level 9, one Crown short: the silver ring (the base decides, like `crowned`). */
  silver: boolean
  /** Book level 1-5 (`TALENT_LOW_MAX`): shown muted, so a 1 never reads brighter than a boosted 11. */
  low: boolean
}

/**
 * The highest book level still shown muted (the user's ask, 2026-11-04: on
 * the card a white 1 looked brighter than a cyan 11). 6 and up read as
 * invested, in the plain text colour.
 */
export const TALENT_LOW_MAX = 5

/**
 * Attack, skill and burst as the game shows them: +3 on the talent C3
 * raises once constellation 3 is unlocked, on C5's from 5 (Enka's "10 → 13").
 * `boosts` null (data not loaded, or a character newer than it) shows base
 * levels.
 */
export function talentLevels(
  talent: Readonly<Record<TalentKey, number>>,
  constellation: number,
  boosts: ConstellationBoosts | null,
): TalentLevel[] {
  return TALENT_KEYS.map((key) => {
    const base = talent[key]
    const from =
      boosts?.c3 === key && constellation >= 3
        ? 3
        : boosts?.c5 === key && constellation >= 5
          ? 5
          : null
    return {
      key,
      base,
      level: base + (from ? 3 : 0),
      from,
      crowned: base >= 10,
      silver: base === 9,
      low: base <= TALENT_LOW_MAX,
    }
  })
}

/** "Elemental Skill 9 → 12 (C3)", "Elemental Burst 10 → 13 (C5) · crowned". */
export function talentTitle(talent: TalentLevel): string {
  const value = talent.from
    ? `${talent.base} → ${talent.level} (C${talent.from})`
    : `${talent.level}`
  const title = `${TALENT_LABELS[talent.key]} ${value}`
  return talent.crowned ? t('characters.talent.crowned', { title }) : title
}

// ----------------------------------------------------------------- weapon

export interface WeaponLines {
  /** Base ATK. */
  atk: StatRow
  /** The secondary stat; null for 1–2★ weapons. */
  sub: StatRow | null
  /** What the passive always adds at this refinement (Staff of Homa's HP%), for tooltips. */
  passive: StatRow[]
}

/**
 * A weapon's own lines at its level, ascension and refinement, as the
 * weapon screen shows them; null for a weapon newer than the game data.
 */
export function weaponLines(weapon: StatWeapon): WeaponLines | null {
  if (!hasWeaponStats(weapon.key)) return null
  const all = weaponStats(weapon)
  const [, sub, , passiveId] = statsFile.weapons[weapon.key]!
  const ranks = passiveId ? (statsFile.refinements[passiveId] ?? []) : []
  const passive = ranks[Math.min(Math.max(weapon.refinement, 1), ranks.length) - 1] ?? {}
  const subKey = sub?.[0]
  const shown = (key: string, value: number) => row(key, displayStat(key, value))
  return {
    atk: { ...shown('atk', all.baseAtk ?? 0), key: 'baseAtk', label: t('characters.stat.baseAtk') },
    sub: subKey ? shown(subKey, (all[subKey] ?? 0) - (passive[subKey] ?? 0)) : null,
    passive: Object.entries(passive).map(([key, value]) => shown(key, value)),
  }
}

// ------------------------------------------------------------------- sets

export interface SetBonusLine {
  pieces: number
  /** Stats the bonus always adds ("Pyro DMG Bonus +15.0%"); empty for effects that aren't stats. */
  stats: StatRow[]
}

/** Each bonus of a set with the stats it always adds (game data; conditional effects aren't stats). */
export function setBonusLines(setKey: string): SetBonusLine[] {
  const bonuses = Object.hasOwn(statsFile.artifacts.sets, setKey)
    ? statsFile.artifacts.sets[setKey]!
    : []
  return bonuses.map(([pieces, stats]) => ({
    pieces,
    stats: Object.entries(stats).map(([key, value]) => row(key, displayStat(key, value))),
  }))
}

/**
 * The build's roll value: the five pieces' RV added up (each substat roll
 * as a % of that stat's highest roll, as the artifact pages show it; 1–4★
 * pieces count against the same scale).
 */
export function buildRv(pieces: readonly ({ rv: number } | null)[]): number {
  return pieces.reduce((sum, piece) => sum + (piece?.rv ?? 0), 0)
}

/** A set as the build lists it: the piece bonus it reaches (2 or 4). */
export interface BonusSet<S> {
  set: S
  /** The largest 2- or 4-piece threshold the worn count reaches. */
  pieces: number
}

/**
 * The sets a build lists: only those worn 2 pieces or more (a 4-piece, or
 * 2 + 2), most pieces first, each with the bonus it reaches (5 worn read
 * as 4, 3 as 2). A single piece is no set bonus, so it isn't listed; nor
 * is a 1-piece bonus (the Prayers sets).
 */
export function bonusSets<S extends { count: number; thresholds: readonly number[] }>(
  sets: readonly S[],
): BonusSet<S>[] {
  return sets
    .filter((set) => set.count >= 2)
    .map((set) => ({
      set,
      pieces: Math.max(0, ...set.thresholds.filter((t) => t >= 2 && t <= set.count)),
    }))
    .filter((entry) => entry.pieces > 0)
    .sort((a, b) => b.pieces - a.pieces)
}

/** "2-piece: Pyro DMG Bonus +15.0%" lines for a set's tooltip (only bonuses that add stats). */
export function setBonusTitle(setKey: string, active: readonly number[]): string[] {
  return setBonusLines(setKey)
    .filter((b) => b.stats.length > 0)
    .map((b) =>
      t(active.includes(b.pieces) ? 'characters.setBonus.line' : 'characters.setBonus.inactive', {
        n: b.pieces,
        stats: b.stats.map((s) => `${s.label} +${s.text}`).join(t('characters.setBonus.join')),
      }),
    )
}
