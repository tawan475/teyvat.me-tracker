/**
 * The game's item art, from gi-cdn (publish.json `extra` there): the item
 * detail header's (the rarity's gradient, a 32×32 texture stretched, under
 * the emblem `UI_ImgSign_ItemTips`, the knot) behind the share card's pieces,
 * and the bag cell backgrounds (`qualityCell`, gradient and knot in one)
 * behind every item tile and icon (components/ui/ItemArt.vue).
 */

import { giCdnArt } from '@/lib/assets'

/**
 * Item backdrops by rarity, close to the game's art below (both themes):
 * what shows behind it while it loads, or if gi-cdn can't serve it.
 */
export const RARITY_GRADIENT: Record<number, string> = {
  5: 'linear-gradient(150deg, #8a5a34 0%, #c98a46 100%)',
  4: 'linear-gradient(150deg, #5a4b84 0%, #9b74c9 100%)',
  3: 'linear-gradient(150deg, #3f5a7e 0%, #5c8ec2 100%)',
  2: 'linear-gradient(150deg, #3f6150 0%, #5f9474 100%)',
  1: 'linear-gradient(150deg, #545a66 0%, #828999 100%)',
}

/**
 * The game's item detail header, drawn behind the weapon and each artifact
 * piece: its rarity gradient (a 32×32 texture, stretched over the whole
 * box) under the emblem, both from gi-cdn (publish.json `extra` there).
 * Rarity → `UI_QUALITY_<colour>`, the game's quality names (1★ is WHITE;
 * NONE, the same grey, is for items without a rarity).
 */
export const QUALITY_ART: Readonly<Record<number, string>> = {
  5: 'UI_QUALITY_ORANGE',
  4: 'UI_QUALITY_PURPLE',
  3: 'UI_QUALITY_BLUE',
  2: 'UI_QUALITY_GREEN',
  1: 'UI_QUALITY_WHITE',
}

/** URL of a rarity's gradient; '' for no rarity (the box keeps its plain backdrop). */
export function qualityArt(rarity: number | null | undefined): string {
  const name = rarity ? QUALITY_ART[rarity] : undefined
  return name ? giCdnArt(name) : ''
}

/**
 * The emblem over the gradient: white on transparency, 512×256, its knot
 * centred at (391.1, 140). The game's file is cut off at its foot, so it is
 * placed with its foot on the box's foot, which hides the cut.
 */
export const EMBLEM = {
  name: 'UI_ImgSign_ItemTips',
  width: 512,
  height: 256,
  knotX: 391.1,
  knotY: 140,
}
export const EMBLEM_URL = giCdnArt(EMBLEM.name)

export interface EmblemBox {
  scale: number
  left: number
  top: number
  width: number
  height: number
}

/**
 * Where the emblem goes in a box `height` px tall (px, from its top left):
 * its knot on (`centreX`, `centreY`) — the item icon's centre — and its foot
 * on the box's foot. So scale = (height − centreY) / (256 − 140): with the
 * icon centred vertically, height / 232.
 */
export function emblemBox(height: number, centreX: number, centreY = height / 2): EmblemBox {
  const scale = (height - centreY) / (EMBLEM.height - EMBLEM.knotY)
  return {
    scale,
    left: centreX - EMBLEM.knotX * scale,
    top: height - EMBLEM.height * scale,
    width: EMBLEM.width * scale,
    height: EMBLEM.height * scale,
  }
}

/** An emblem box as an absolutely positioned element's style. */
export const emblemStyle = (box: EmblemBox): Record<string, string> => ({
  left: `${box.left}px`,
  top: `${box.top}px`,
  width: `${box.width}px`,
  height: `${box.height}px`,
})

/**
 * The emblem on a band `height` px tall whose item icon, `size` px, sits
 * `right` px from the band's right edge, its centre `centreY` px from the
 * top (centred vertically by default): the knot on the icon's centre,
 * anchored from the right (for bands whose width varies).
 */
export function emblemFromRight(
  height: number,
  right: number,
  size: number,
  centreY = height / 2,
): Record<string, string> {
  const box = emblemBox(height, 0, centreY)
  return {
    right: `${right + size / 2 - (EMBLEM.width - EMBLEM.knotX) * box.scale}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
  }
}

/**
 * The game's bag cell background for a rarity (`UI_QualityBg_<n>`, 80×98:
 * the gradient with the knot, rounded corners in its alpha), or its 50×50
 * square (`small`, `…s`) for icons and portraits; '' without a rarity.
 */
export function qualityCell(rarity: number | null | undefined, small = false): string {
  return rarity && rarity >= 1 && rarity <= 5
    ? `${giCdnArt(`UI_QualityBg_${rarity}${small ? 's' : ''}`)}?v=${CELL_VERSION}`
    : ''
}

/**
 * The cell sprite's clear border, in its own pixels: `UI_QualityBg_<n>` is
 * 80×98 with a fully transparent 1px edge on every side (the art is 78×96).
 */
export const QUALITY_CELL_EDGE = 1

/**
 * Bumped when gi-cdn re-encodes the cells (2: lossless, the knot no longer
 * smeared): browsers and the service worker keep images by URL for months.
 */
const CELL_VERSION = 2
