/**
 * Where the share card's art sits and what it shows (card-art.ts keeps it
 * per character in the browser): pure, so the page card, the PNG and the
 * tests share the same placement.
 */

/** Where the art box sits: moved by `x`/`y` card pixels, sized by `scale` around its middle. */
export interface ArtPlace {
  x: number
  y: number
  scale: number
}

/** What a card shows: object URLs of the player's pictures (null: the game's), and the place. */
export interface CardArt extends ArtPlace {
  splash: string | null
  background: string | null
}

export const NO_ART: CardArt = { splash: null, background: null, x: 0, y: 0, scale: 1 }

/** One move of the arrows, in card pixels (the card is 1920×1080). */
export const ART_STEP = 20
/** One step of Bigger / Smaller. */
export const ART_SCALE_STEP = 0.05
export const ART_SCALE_MIN = 0.5
export const ART_SCALE_MAX = 2.5
/** The furthest the art may move off its place, either way (it stays partly on the card). */
export const ART_MOVE_MAX = 1400
/** Pictures bigger than this are refused (a phone photo is a few MB). */
export const ART_FILE_MAX = 20 * 1024 * 1024

export const clampPlace = (place: ArtPlace): ArtPlace => ({
  x: Math.max(-ART_MOVE_MAX, Math.min(ART_MOVE_MAX, Math.round(place.x))),
  y: Math.max(-ART_MOVE_MAX, Math.min(ART_MOVE_MAX, Math.round(place.y))),
  scale: Math.round(Math.max(ART_SCALE_MIN, Math.min(ART_SCALE_MAX, place.scale)) * 100) / 100,
})

/**
 * A rectangle drawn in the art box at `box` (left, top, 2200×1100), after
 * the place: sized around the box's middle, then moved.
 */
export function placeRect(
  rect: { x: number; y: number; width: number; height: number },
  box: { left: number; top: number; width: number; height: number },
  place: ArtPlace,
): { x: number; y: number; width: number; height: number } {
  const cx = box.left + box.width / 2
  const cy = box.top + box.height / 2
  return {
    x: cx + (rect.x - cx) * place.scale + place.x,
    y: cy + (rect.y - cy) * place.scale + place.y,
    width: rect.width * place.scale,
    height: rect.height * place.scale,
  }
}
