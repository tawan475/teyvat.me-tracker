/**
 * Game images. They load from static.nanoka.cc (`<name>.webp`, CORS open,
 * behind Cloudflare), except the names that host lacks: of those, the ones
 * gi-cdn.ley-courier.workers.dev serves (`ui/<name>.webp`, extracted from the
 * game client by the private gi-cdn repo; static files, CORS open) load from
 * there, and the rest return '', so GameIcon shows
 * initials. Both hosts and both lists come from the game data
 * (`@gdt/game-data/image-url`, data/missing-images.json); the service worker
 * keeps either kind cache-first. The names come only from our own game data
 * (@gdt/game-data, compiled from the game's tables): `images` for
 * characters, weapons, artifacts, elements and a few items, the material
 * index for materials, achievement categories for theirs. The Traveler's
 * portrait follows the account's twin setting.
 */

import {
  artifactImage,
  artifactSetImage,
  characterImages,
  elementImage,
  itemImage,
  travelerArt,
  travelerIcon,
  weaponImages,
  type ArtifactSlot,
  type TravelerGender,
} from '@gdt/game-data/images'
import { GI_CDN_HOST, IMAGE_HOST, imageUrlOf } from '@gdt/game-data/image-url'
import { shallowRef } from 'vue'
import {
  loadImageCoverage,
  loadMaterialIndex,
  type Element as GameElement,
  type ImageCoverage,
  type MaterialIndex,
} from '@gdt/game-data'
import type { Element } from '@/data/game-meta'

/**
 * The image host and gi-cdn, as the game data writes them (vite.config.ts
 * gives the service worker and index.html's preconnect the same).
 */
export const IMAGE_BASE = IMAGE_HOST
export const GI_CDN_BASE = GI_CDN_HOST

/**
 * What the host lacks and what gi-cdn serves of it; null until
 * loadGameIcons resolves. Reactive, so images rendered before it arrived
 * switch to gi-cdn or to initials.
 */
const coverage = shallowRef<ImageCoverage | null>(null)

/**
 * URL of UI art only gi-cdn serves, by the game's name: not item icons, so
 * no game data list names them (gi-cdn publishes them by hand, its
 * publish.json `extra`): the share card's rarity gradients and emblem.
 */
export function giCdnArt(name: string): string {
  return `${GI_CDN_BASE}${name}.webp`
}

/**
 * URL of a game image by name: the host's, gi-cdn's for a name the host
 * lacks, or '' (no name, or no image anywhere).
 */
export function imageUrl(name: string | undefined): string {
  return imageUrlOf(name, coverage.value, IMAGE_BASE, GI_CDN_BASE)
}

/**
 * Which twin the current account's Traveler is (an account setting, since
 * GOOD doesn't say). Reactive, so portraits follow a change at once.
 */
const traveler = shallowRef<TravelerGender>('F')

export function setTravelerGender(gender: TravelerGender): void {
  traveler.value = gender
}

const isTraveler = (key: string) => key.startsWith('Traveler')

/** Square character portrait. */
export function characterIcon(key: string): string {
  if (isTraveler(key)) return imageUrl(travelerIcon(traveler.value))
  return imageUrl(characterImages(key)?.icon)
}

/**
 * The character's side portrait (the round party icon that pokes out of the
 * game's "Equipped" bars); the Traveler's follows the twin setting. '' for a
 * character newer than the game data.
 */
export function characterSideIcon(key: string): string {
  if (isTraveler(key)) return imageUrl(travelerArt(traveler.value).side)
  return imageUrl(characterImages(key)?.side)
}

/**
 * The character's wish splash art (full body, 2048×1024 on transparency);
 * the Traveler's follows the twin setting. '' for a character newer than
 * the game data.
 */
export function characterSplash(key: string): string {
  if (isTraveler(key)) return imageUrl(travelerArt(traveler.value).gacha)
  return imageUrl(characterImages(key)?.gacha)
}

/** The character's namecard picture ('' for the Traveler and Manekin). */
export function characterBanner(key: string): string {
  return imageUrl(characterImages(key)?.namecard)
}

/** Weapon icon; ascended weapons (ascension >= 2) use the awakened art, as in game. */
export function weaponIcon(key: string, ascension = 0): string {
  const names = weaponImages(key)
  return imageUrl(names && (ascension >= 2 ? names[1] : names[0]))
}

export function artifactIcon(setKey: string, slotKey: string): string {
  return imageUrl(artifactImage(setKey, slotKey as ArtifactSlot))
}

/** Any artifact piece of a set, for set-level badges. */
export function artifactSetIcon(setKey: string): string {
  return imageUrl(artifactSetImage(setKey))
}

let materialIndex: MaterialIndex | null = null

/** Loads which names the host lacks and which we serve (small); AccountLayout starts it. */
export async function loadGameIcons(): Promise<void> {
  coverage.value ??= await loadImageCoverage()
}

/**
 * A game icon by its name (`UI_ItemIcon_104013`, `UI_AchievementIcon_A001`),
 * as imageUrl, but '' until loadGameIcons resolves (so a name the host lacks
 * is never requested there).
 */
export function gameIcon(name: string): string {
  return coverage.value ? imageUrl(name) : ''
}

const GAME_ELEMENTS: Readonly<Record<Element, GameElement>> = {
  anemo: 'Anemo',
  geo: 'Geo',
  electro: 'Electro',
  dendro: 'Dendro',
  hydro: 'Hydro',
  pyro: 'Pyro',
  cryo: 'Cryo',
}

/**
 * An element's icon: the game's own, in the element's colours (the one it
 * shows beside an element's name in text). As gameIcon: '' until
 * loadGameIcons resolves, and '' while the game data names an icon no host
 * serves (releases before its UI_Buff_Element02_* names), so ElementIcon
 * draws its glyph.
 */
export function elementIcon(element: Element): string {
  return gameIcon(elementImage(GAME_ELEMENTS[element]) ?? '')
}

/** The game's file names for the elements (`UI_Buff_Element_<name>`). */
const ELEMENT_FILES: Readonly<Record<Element, string>> = {
  anemo: 'Wind',
  geo: 'Roach',
  electro: 'Elect',
  dendro: 'Grass',
  hydro: 'Water',
  pyro: 'Fire',
  cryo: 'Frost',
}

/**
 * The light element icon of the game's character list (no dark rim, a soft
 * glow): `UI_Buff_Element_*`, which nanoka lacks, on gi-cdn (publish.json
 * `extra`). The roster card's tiles.
 */
export function elementIconLight(element: Element): string {
  return giCdnArt(`UI_Buff_Element_${ELEMENT_FILES[element]}`)
}

/** Loaded lazily (large); call before rendering material icons. */
export async function loadMaterialIcons(): Promise<void> {
  if (materialIndex) return
  const [index] = await Promise.all([loadMaterialIndex(), loadGameIcons()])
  materialIndex = index
}

/** A material's icon by GOOD key; Mora, Primogem and the Sanctifying items work without loading. */
export function materialIcon(key: string): string {
  const item = itemImage(key)
  return item ? imageUrl(item) : gameIcon(materialIndex?.icon(key) ?? '')
}
