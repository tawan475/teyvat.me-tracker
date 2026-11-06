import { loadCollections } from '@gdt/game-data/collections'
import type { TravelerGender } from '@gdt/game-data/images'
import type { GiPlayer } from '@gdt/shared'
import { gameIcon } from '@/lib/assets'

/**
 * The in-game profile as Teyvat.me Capture 1.14+ sends it (`gi_player`):
 * the name card, the profile picture and its frame, read through the game
 * data's player + wardrobe topics. Overview's profile card and the share
 * cards draw it.
 */
export interface ProfileArt {
  /** The AR table (EXP each rank needs). */
  arLevels: readonly { id: number; exp?: unknown }[]
  /** Name card item id → its picture's game name. */
  nameCards: ReadonlyMap<number, string>
  /** Profile picture id → its icon's game name. */
  avatars: ReadonlyMap<number, string>
  /** Profile frame id → its icon's game name. */
  frames: ReadonlyMap<number, string>
}

let art: Promise<ProfileArt> | null = null

/** The player + wardrobe topics (~30 KB), once; the same promise every call. */
export function loadProfileArt(): Promise<ProfileArt> {
  art ??= loadCollections(['player', 'wardrobe']).then((data) => {
    const icons = (rows: { id: number; icon: unknown }[]) =>
      new Map(rows.flatMap((r) => (typeof r.icon === 'string' && r.icon ? [[r.id, r.icon]] : [])))
    const pictures = new Map<number, string>()
    for (const row of data.namecards)
      if (typeof row.picture === 'string') pictures.set(row.id, row.picture)
    return {
      arLevels: data.arLevels,
      nameCards: pictures,
      avatars: icons(data.profilePictures),
      frames: icons(data.profileFrames),
    }
  })
  art.catch(() => (art = null))
  return art
}

export interface ProfileCard {
  name: string
  signature: string | null
  /** The name card's picture (a full image URL). */
  nameCard: string
  /** The profile picture (a full image URL). */
  avatar: string
  /** Its frame (a full image URL), '' for none. */
  frame: string
}

/**
 * The profile card's name, signature, name card and picture. Older captures
 * (no profile in `gi_player`) stand in with `fallbackName`, the Traveler's
 * circle portrait (the account's twin) and the default name card.
 */
export function buildProfileCard(
  player: GiPlayer | null | undefined,
  data: ProfileArt | null | undefined,
  fallbackName: string,
  twin: TravelerGender,
): ProfileCard {
  const picture = player?.nameCard ? data?.nameCards.get(player.nameCard) : undefined
  const pfp = player?.profilePicture
  const avatar = pfp?.id ? data?.avatars.get(pfp.id) : undefined
  const frame = pfp?.frameId ? data?.frames.get(pfp.frameId) : undefined
  const portrait = twin === 'M' ? 'PlayerBoy' : 'PlayerGirl'
  return {
    name: player?.nickname || fallbackName,
    signature: player?.signature || null,
    nameCard: gameIcon(picture ?? 'UI_NameCardPic_0_P'),
    avatar: gameIcon(avatar ?? `UI_AvatarIcon_${portrait}_Circle`),
    frame: frame && avatar ? gameIcon(frame) : '',
  }
}

/**
 * The game draws a profile frame at its own pixel size around a picture
 * about 222 px across: every frame's hole is ~111 px in radius in its own
 * pixels, whatever the image's size (272-360 px wide, game data 7.2). A
 * frame `naturalWidth` wide goes round a picture `picture` px across at
 * this width.
 */
export const FRAME_HOLE = 222
export function frameSize(picture: number, naturalWidth: number): number {
  return (picture * naturalWidth) / FRAME_HOLE
}
