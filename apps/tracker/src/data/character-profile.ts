import { loadCharacterProfile, type CharacterProfile } from '@gdt/game-data/profiles'
import type { TravelerGender } from '@gdt/game-data/images'
import type { Locale } from '@/i18n/locale'

export type { CharacterProfile }

/**
 * A character's profile and stories in a language (English where it lacks a
 * text), from the game data's lazy chunks; null when the data has none (a
 * character newer than it). The Traveler's follows the account's twin.
 */
export async function loadProfile(
  key: string,
  lang: Locale,
  twin: TravelerGender,
): Promise<CharacterProfile | null> {
  return (await loadCharacterProfile(key, lang, twin)) ?? null
}
