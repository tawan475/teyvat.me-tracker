/**
 * The share card (ShareCard): its canvas and its own palette, after the
 * "Character Showcase Card" design (Claude Design canvas, dark and light).
 * The card is drawn at 1920×1080 CSS pixels, so the PNG is the card at 1×;
 * the details show it scaled to their width.
 */

import type { Element } from '@/data/game-meta'
import { giCdnArt } from '@/lib/assets'
import { emblemBox } from '@/lib/item-art'
import type { CritTier } from '@/lib/crit-tiers'

export const CARD_WIDTH = 1920
export const CARD_HEIGHT = 1080
/** The PNG is the card at 1×: 1920×1080. */
export const CARD_SCALE = 1

/** What the card's foot shows of its owner; null parts are left out. */
export interface CardOwner {
  name: string | null
  uid: string | null
  /** Adventure Rank, from the newest capture. */
  ar: number | null
}

export type CardTheme = 'light' | 'dark'

/**
 * The card's palette as CSS variables on its root (the design's values; the
 * app's tokens still apply under its `data-theme`: element, CV tier and
 * rarity colours). `--disc-bg` / `--disc-glow` style ElementDisc.
 */
export const CARD_THEMES: Record<CardTheme, Record<string, string>> = {
  dark: {
    '--card-ground': '#0b1020',
    '--card-text': '#f8fafc',
    '--card-secondary': '#cbd5e1',
    '--card-muted': '#94a3b8',
    '--card-bonus': '#4ade80',
    '--card-hero': '#ffffff',
    '--card-hero-shadow': '0 2px 10px rgba(0,0,0,0.65), 0 1px 2px rgba(0,0,0,0.6)',
    '--card-chip': 'rgba(15,23,42,0.6)',
    '--card-chip-ring': 'inset 0 0 0 1px rgba(255,255,255,0.18)',
    '--card-namecard-filter': 'blur(10px) saturate(1.2) brightness(0.78)',
    '--card-scrim':
      'linear-gradient(90deg, rgba(8,11,22,0.10) 0%, rgba(8,11,22,0.30) 45%, rgba(8,11,22,0.50) 100%)',
    '--card-splash-shadow': 'drop-shadow(0 18px 40px rgba(0,0,0,0.45))',
    '--card-vignette':
      'linear-gradient(0deg, rgba(8,11,22,0.72) 0%, rgba(8,11,22,0) 32%), linear-gradient(180deg, rgba(8,11,22,0.55) 0%, rgba(8,11,22,0) 26%)',
    '--card-panel': 'rgba(12,17,32,0.66)',
    '--card-panel-shadow': '0 8px 24px rgba(0,0,0,0.25), inset 0 0 0 1px rgba(255,255,255,0.09)',
    '--card-pill': 'rgba(10,14,26,0.82)',
    '--card-badge': '#0f172a',
    '--card-rule': 'rgba(255,255,255,0.08)',
    '--card-divider': 'rgba(255,255,255,0.10)',
    '--card-set-on': '#6ee7b7',
    '--card-set-on-bg': 'rgba(16,185,129,0.18)',
    '--card-set-off-bg': 'rgba(255,255,255,0.07)',
    '--card-cv-bg': 'rgba(255,255,255,0.08)',
    '--card-roll-1': '#64748b',
    '--card-roll-2': '#60a5fa',
    '--card-roll-3': '#a78bfa',
    '--card-roll-4': '#fbbf24',
    '--disc-bg': 'rgba(10,14,26,0.78)',
  },
  light: {
    '--card-ground': '#e8edf5',
    '--card-text': '#0f172a',
    '--card-secondary': '#334155',
    '--card-muted': '#64748b',
    '--card-bonus': '#15803d',
    '--card-hero': '#0f172a',
    '--card-hero-shadow': '0 1px 0 rgba(255,255,255,0.85), 0 0 14px rgba(255,255,255,0.75)',
    '--card-chip': 'rgba(255,255,255,0.8)',
    '--card-chip-ring': 'inset 0 0 0 1px rgba(15,23,42,0.12)',
    '--card-namecard-filter': 'blur(10px) saturate(1.15) brightness(1.12)',
    '--card-scrim':
      'linear-gradient(90deg, rgba(248,250,252,0.20) 0%, rgba(248,250,252,0.32) 45%, rgba(248,250,252,0.50) 100%)',
    '--card-splash-shadow': 'drop-shadow(0 18px 40px rgba(15,23,42,0.22))',
    '--card-vignette':
      'linear-gradient(0deg, rgba(248,250,252,0.62) 0%, rgba(248,250,252,0) 30%), linear-gradient(180deg, rgba(248,250,252,0.50) 0%, rgba(248,250,252,0) 26%)',
    '--card-panel': 'rgba(255,255,255,0.80)',
    '--card-panel-shadow': '0 1px 2px rgba(15,23,42,0.06), inset 0 0 0 1px rgba(15,23,42,0.07)',
    '--card-pill': 'rgba(255,255,255,0.92)',
    '--card-badge': '#ffffff',
    '--card-rule': 'rgba(15,23,42,0.08)',
    '--card-divider': 'rgba(15,23,42,0.10)',
    '--card-set-on': '#047857',
    '--card-set-on-bg': 'rgba(16,185,129,0.14)',
    '--card-set-off-bg': 'rgba(15,23,42,0.06)',
    '--card-cv-bg': 'rgba(15,23,42,0.06)',
    '--card-roll-1': '#94a3b8',
    '--card-roll-2': '#3b82f6',
    '--card-roll-3': '#8b5cf6',
    '--card-roll-4': '#d97706',
    '--disc-bg': 'rgba(30,41,59,0.88)',
    '--disc-glow': '0 4px 14px rgba(15,23,42,0.25)',
  },
}

/**
 * The element colours the card's glow is drawn in: the app's dark-theme
 * element tokens, in both card themes (the design's choice: the light
 * tokens are darkened for text and would muddy the art).
 */
const ELEMENT_GLOW_RGB: Record<Element, string> = {
  pyro: '251,146,60',
  hydro: '56,189,248',
  anemo: '45,212,191',
  electro: '192,132,252',
  dendro: '163,230,53',
  cryo: '103,232,249',
  geo: '250,204,21',
}

/** The element's glow behind the splash, centred under the character. */
export function elementGlow(element: Element, theme: CardTheme): string {
  const rgb = ELEMENT_GLOW_RGB[element]
  const core = theme === 'light' ? 0.32 : 0.3
  return `radial-gradient(ellipse 620px 760px at 340px 560px, rgba(${rgb},${core}) 0%, rgba(${rgb},0.10) 45%, rgba(${rgb},0) 75%)`
}

// The game's item art (rarity gradients, the emblem) is shared with the
// app's item tiles: lib/item-art.
export {
  EMBLEM,
  EMBLEM_URL,
  QUALITY_ART,
  RARITY_GRADIENT,
  emblemBox,
  emblemStyle,
  qualityArt,
  type EmblemBox,
} from '@/lib/item-art'

/** The card's frame: its padding top and bottom, and the gap between the five pieces. */
export const CARD_PAD_Y = 44

/**
 * The sets panel's substats grid (the user's pick "C", 2026-11-24): what
 * each substat adds over the pieces with its roll count, two columns of
 * 30 px rows, filled row by row; CRIT Rate and CRIT DMG first, on a chip.
 */
export const TOTALS_COLUMNS = 2
export const TOTALS_ROW = 30
export const TOTALS_ROW_GAP = 4
export const TOTALS_COLUMN_GAP = 14
/** The ×N column's width at the cell's right; a cell pads 8 px each side. */
export const TOTALS_ROLLS_WIDTH = 36
export const TOTALS_CELL_PAD = 8
/** The grid's height for `n` substats. */
export function totalsGridHeight(n: number): number {
  const rows = Math.ceil(n / TOTALS_COLUMNS)
  return rows ? rows * TOTALS_ROW + (rows - 1) * TOTALS_ROW_GAP : 0
}
export const PIECE_GAP = 14
/**
 * One artifact panel's height: the five share the column (the card's
 * height less its padding and the four gaps; empty slots take theirs too),
 * so it is fixed: 187.2px.
 */
export const PIECE_HEIGHT = (CARD_HEIGHT - 2 * CARD_PAD_Y - 4 * PIECE_GAP) / 5

/**
 * A piece's band (left of its substats): 276px of the game's header art, the
 * icon (168px) 8px from its right edge, centred vertically.
 */
export const BAND_WIDTH = 276
export const BAND_ICON = 168
export const BAND_ICON_RIGHT = 8
export const BAND_EMBLEM = emblemBox(PIECE_HEIGHT, BAND_WIDTH - BAND_ICON_RIGHT - BAND_ICON / 2)
/** The weapon's 128px tile: the icon fills it, so the knot sits on its centre. */
export const WEAPON_TILE = 128
export const WEAPON_EMBLEM = emblemBox(WEAPON_TILE, WEAPON_TILE / 2)

/**
 * CV / RV colours of the pills on the band: they sit on a dark chip over the
 * game's art in both card themes, so the dark palette a step lighter, in
 * akasha's hue order (lib/crit-tiers): grey, blue, purple, orange, gold,
 * cyan, red. A CV above 0 that reaches no tier is white.
 */
export const BAND_TIER_COLOR: Readonly<Record<CritTier, string>> = {
  0: '#cbd5e1',
  1: '#93c5fd',
  2: '#d8b4fe',
  3: '#fdba74',
  4: '#fde047',
  5: '#67e8f9',
  6: '#fca5a5',
}
export const BAND_CV_ON = '#ffffff'

/**
 * The splash art's box (2200×1100, the 2048×1024 art contained), placed at
 * left −660px, puts the character right of the left column's middle (Illuga
 * by the art's alpha mass: x≈475 against the column's 398), so every
 * splash moves left by 7.5% of the column's 700px: −712.5px.
 */
export const CHARACTER_COLUMN = 700
export const SPLASH_LEFT = -660 - 0.075 * CHARACTER_COLUMN
/** The splash box's top: 20px above the card. */
export const SPLASH_TOP = -20

/** Characters whose splash moves by the same amount, in % (see SPLASH_NUDGE). */
const nudge = (down: number, keys: readonly string[], right = 0) =>
  keys.map((key) => [key, { down, right }] as const)

/**
 * The user's own fixes, by eye, for splashes that sit too high or off centre
 * on the card: `down` in % of the card's height (1080px; negative moves up),
 * `right` in % of the character column (700px; negative moves left). Every
 * Traveler (any element, either twin) takes `Traveler`'s.
 */
export const SPLASH_NUDGE: Readonly<Record<string, { down: number; right: number }>> =
  Object.fromEntries([
    ...nudge(-10, ['Mavuika', 'Nahida']),
    ...nudge(4, ['Prune']),
    ...nudge(5, [
      'Lauma',
      'Chasca',
      'Ineffa',
      'Collei',
      'KaedeharaKazuha',
      'Varesa',
      'Durin',
      'Jahoda',
      'Kaveh',
      'Arlecchino',
      'Nefer',
      'Ororon',
      'Dahlia',
      'Skirk',
      'Escoffier',
      'Ifa',
      'LanYan',
      'Zhongli',
      'Xilonen',
      'Mualani',
      'Tighnari',
      'Mika',
      'Kirara',
      'Faruzan',
      'Yelan',
      'YaeMiko',
      'Aloy',
      'Diluc',
      'KamisatoAyaka',
      'Keqing',
      'Rosaria',
      'Ganyu',
      'Ningguang',
      'Sucrose',
      'Xingqiu',
      'Xiangling',
      'Barbara',
      'Beidou',
      'Noelle',
      'Fischl',
    ]),
    ...nudge(6, ['Vesna']),
    ...nudge(7, ['Linnea', 'Dehya', 'Varka', 'Flins', 'Zibai', 'Emilie', 'Neuvillette']),
    ...nudge(8, [
      'Lohen',
      'Kachina',
      'RaidenShogun',
      'KujouSara',
      'Razor',
      'Jean',
      'Mona',
      'Lisa',
      'Kaeya',
    ]),
    ...nudge(8, ['Yanfei'], 7),
    ...nudge(5, ['HuTao'], -3),
    ...nudge(4, ['Manekin', 'Manekina'], -4),
    ...nudge(25, ['Traveler']),
  ])

/**
 * Uncut wish art for the characters whose game wish image (2048×1024) is cut
 * where the card shows it: the Genshin Impact Fandom wiki's "Character Full
 * Wish Artwork" (the client has no uncut version), hosted on gi-cdn as
 * `FullWish_<Key>`. Each is placed over the game art's frame so the
 * character sits exactly where the game art put it (and its nudge still
 * applies): `scale` game pixels per wiki pixel, its top-left at (`x`, `y`)
 * in game pixels. Fitted by matching features between the two images
 * (SIFT + RANSAC, no rotation; 2026-10-09). Columbina, Zibai and Lohen are
 * cut too, but the wiki's art is the same frame as the game's.
 */
export const SPLASH_FULL: Readonly<
  Record<string, { width: number; height: number; scale: number; x: number; y: number }>
> = {
  Mavuika: { width: 1280, height: 1280, scale: 1.42819, x: 139.48, y: -312.45 },
  Arlecchino: { width: 1460, height: 1120, scale: 1.23159, x: 171.81, y: -255.22 },
  Mualani: { width: 1280, height: 1280, scale: 1.04168, x: 289.94, y: -147.86 },
  Chiori: { width: 1280, height: 1280, scale: 1.08397, x: 333.66, y: -145.96 },
  Citlali: { width: 1280, height: 1280, scale: 1.01251, x: 366.99, y: -129.98 },
  Xianyun: { width: 1280, height: 1280, scale: 1.15153, x: 260.91, y: -161.4 },
}

/** The splash box's px per game wish-art px (the 2048×1024 art fills the 2200×1100 box). */
export const SPLASH_BOX_SCALE = 2200 / 2048

/**
 * A character's uncut art and where it goes inside the splash box (px), or
 * null where the game's own art is used.
 */
export function splashFull(
  characterKey: string,
): { src: string; style: Record<string, string> } | null {
  const full = SPLASH_FULL[characterKey]
  if (!full) return null
  const k = SPLASH_BOX_SCALE
  return {
    src: giCdnArt(`FullWish_${characterKey}`),
    style: {
      left: `${full.x * k}px`,
      top: `${full.y * k}px`,
      width: `${full.width * full.scale * k}px`,
      height: `${full.height * full.scale * k}px`,
    },
  }
}

/**
 * The backing behind the card's small text on the art (level / friendship,
 * owner lines): `--card-chip`, the theme's colour at its opacity, more opaque
 * for the characters whose art fights the text (the user's list).
 */
const CHIP_RGB: Record<CardTheme, string> = { dark: '15,23,42', light: '255,255,255' }
const CHIP_ALPHA: Record<CardTheme, number> = { dark: 0.6, light: 0.8 }
export const CHIP_OPAQUE: Readonly<Record<string, number>> = {
  Mavuika: 0.92,
}

/** The card's `--card-chip` for a character, when it overrides the theme's. */
export function chipBackground(characterKey: string, theme: CardTheme): string | undefined {
  const alpha = CHIP_OPAQUE[characterKey]
  if (alpha === undefined) return undefined
  return `rgba(${CHIP_RGB[theme]},${Math.max(alpha, CHIP_ALPHA[theme])})`
}

/** Where a character's splash box goes on the card (px): the shared spot plus its nudge. */
export function splashPlace(characterKey: string): { left: number; top: number } {
  const key = characterKey.startsWith('Traveler') ? 'Traveler' : characterKey
  const n = SPLASH_NUDGE[key]
  return {
    left: SPLASH_LEFT + ((n?.right ?? 0) / 100) * CHARACTER_COLUMN,
    top: SPLASH_TOP + ((n?.down ?? 0) / 100) * CARD_HEIGHT,
  }
}

/** The name's size on the card: 80px, smaller for long names so it fits its column. */
export function nameSize(name: string): number {
  return name.length <= 11 ? 80 : name.length <= 14 ? 66 : 56
}
