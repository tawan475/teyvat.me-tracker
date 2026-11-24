/**
 * What the character share card shows, worked out once for both of its
 * pictures: the page's card (ShareCard, with its tooltips) and the PNG's
 * (share-card-canvas). Pure.
 */

import type { CharacterView } from '@/data/characters'
import { SLOT_LABELS, SLOT_ORDER, type EquippedArtifact, type SlotKey } from '@/data/characters'
import { t } from '@/i18n'
import { cvTier, isCritCirclet, rvTier } from '@/lib/crit-tiers'
import { inferArtifactRolls, type InferredRoll } from '@/utils/artifact-rolls'
import { formatSetName } from '@/utils/artifact-stats'
import { BAND_CV_ON, BAND_TIER_COLOR, type CardOwner } from './share-card'

/**
 * The bars under the level and friendship (Capture's EXP): how far to the
 * next level in %, full at a cap (`need` null); null when the capture has no
 * EXP for it (or the EXP table hasn't loaded).
 */
export function expShare(exp: number | null, need: number | null | undefined): number | null {
  return need === null
    ? 100
    : exp === null || need === undefined
      ? null
      : Math.min(100, (exp / need) * 100)
}

/** A CV / RV pill's colour on a band, and whether it is the top tier (it glows). */
export interface BandTone {
  color: string
  top: boolean
}

/**
 * A pill's colour on a band (BAND_TIER_COLOR): akasha's tiers are 5★ scales,
 * so 1–4★ pieces stay untiered; a CV above 0 below the first tier is white.
 */
export function bandCv(rarity: number, cv: number, critCirclet: boolean): BandTone {
  const tier = rarity < 5 ? 0 : cvTier(cv, 'artifact', critCirclet)
  return {
    color: tier ? BAND_TIER_COLOR[tier] : cv > 0 ? BAND_CV_ON : BAND_TIER_COLOR[0],
    top: tier === 6,
  }
}
export function bandRv(rarity: number, rv: number): BandTone {
  const tier = rarity < 5 || rv <= 0 ? 0 : rvTier(rv)
  return { color: BAND_TIER_COLOR[tier], top: tier === 6 }
}

/** One substat line of a piece (an unactivated one is `inactive`, without rolls). */
export interface PieceLine {
  key: string
  value: number
  rolls: readonly InferredRoll[]
  inactive: boolean
}

/** A slot on the card: its piece (or none), four lines at most, the band's pills. */
export interface CardPiece {
  slot: SlotKey
  piece: EquippedArtifact | null
  lines: PieceLine[]
  cv: BandTone | null
  rv: BandTone | null
  /** The tooltip. */
  title: string
}

/** The five slots, four substat lines per piece (empty ones kept, so rows line up). */
export function cardPieces(character: CharacterView): CardPiece[] {
  return SLOT_ORDER.map((slot, index) => {
    const piece = character.artifacts[index] ?? null
    if (!piece) {
      return { slot, piece, lines: [], cv: null, rv: null, title: SLOT_LABELS[slot] }
    }
    const rolls = inferArtifactRolls(piece)
    const lines: PieceLine[] = [
      ...piece.substats.map((s, i) => ({ ...s, rolls: rolls[i] ?? [], inactive: false })),
      ...(piece.unactivatedSubstats ?? []).map((s) => ({ ...s, rolls: [], inactive: true })),
    ].slice(0, 4)
    const rollCount =
      piece.totalRolls && piece.totalRolls > 0
        ? piece.totalRolls
        : rolls.reduce((sum, r) => sum + r.length, 0)
    const cv = bandCv(piece.rarity, piece.cv, isCritCirclet(piece.slotKey, piece.mainStatKey))
    const rv = bandRv(piece.rarity, piece.rv)
    const title = [
      formatSetName(piece.setKey),
      `${SLOT_LABELS[slot]} +${piece.level} · ${piece.rarity}★`,
      t('share.card.pieceTitle', { cv: piece.cv.toFixed(1), rv: piece.rv, n: rollCount }),
    ].join('\n')
    return { slot, piece, lines, cv, rv, title }
  })
}

/** One substat added up over the worn pieces: its total and how many rolls made it. */
export interface SubstatTotal {
  key: string
  value: number
  rolls: number
  /** CRIT Rate / CRIT DMG: the totals line shows these brighter (the user's pick). */
  crit: boolean
}

const CRIT_KEYS = ['critRate_', 'critDMG_']

/**
 * What the artifacts' substats add as a whole (Akasha's line, a Discord
 * user's ask): each active substat's total and roll count over the worn
 * pieces, CRIT Rate and CRIT DMG first, then most rolls, then the larger
 * total. A substat whose value can't be split into rolls counts none.
 */
export function substatTotals(character: CharacterView): SubstatTotal[] {
  const totals = new Map<string, SubstatTotal>()
  for (const piece of character.artifacts) {
    if (!piece) continue
    const rolls = inferArtifactRolls(piece)
    piece.substats.forEach((s, i) => {
      const total = totals.get(s.key) ?? {
        key: s.key,
        value: 0,
        rolls: 0,
        crit: CRIT_KEYS.includes(s.key),
      }
      total.value += s.value
      total.rolls += rolls[i]?.length ?? 0
      totals.set(s.key, total)
    })
  }
  const critOrder = (key: string) => {
    const at = CRIT_KEYS.indexOf(key)
    return at < 0 ? CRIT_KEYS.length : at
  }
  return [...totals.values()].sort(
    (a, b) => critOrder(a.key) - critOrder(b.key) || b.rolls - a.rolls || b.value - a.value,
  )
}

/** The owner line's parts: name, "UID …", "AR …" (those shown). */
/** The owner's name at most: the game caps a nickname at 15 characters. */
export const OWNER_NAME_MAX = 15

export function ownerParts(owner: CardOwner): string[] {
  const name = owner.name ? Array.from(owner.name) : []
  return [
    name.length > OWNER_NAME_MAX ? `${name.slice(0, OWNER_NAME_MAX).join('')}…` : owner.name,
    owner.uid ? `UID ${owner.uid}` : null,
    owner.ar ? `AR ${owner.ar}` : null,
  ].filter((part): part is string => !!part)
}
