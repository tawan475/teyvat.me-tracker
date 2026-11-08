import { describe, expect, it } from 'vitest'
import type { CollectionCatalog } from '../collection-names'
import { musicSongs, musicSummary, shownSongs } from '../music'
import {
  companionCards,
  furnishingSetCards,
  ownedCompanions,
  setsWithOwnedCompanions,
} from '../teapot'

const texts = (entries: Record<string, [number, Record<string, string>][]>) =>
  Object.fromEntries(
    Object.entries(entries).map(([section, rows]) => [section, new Map(rows)]),
  ) as unknown as CollectionCatalog['text']

describe('music game', () => {
  const catalog = {
    data: {
      musicSongs: [
        { id: 1, icon: 'UI_Img_MusicGame_Songcover_28' },
        { id: 2, icon: 'UI_Img_MusicGame_Songcover_31' },
      ],
      musicBeatmaps: [
        { id: 12, song: 1, difficulty: 2, reward: 4120012 },
        { id: 11, song: 1, difficulty: 1, reward: 4120011 },
        { id: 14, song: 1, difficulty: 4, reward: 0 },
        { id: 21, song: 2, difficulty: 1, reward: 4120021 },
      ],
    },
    text: texts({ musicSongs: [[1, { name: 'Blossoms of Summer Night', artist: 'Yoimiya' }]] }),
    english: texts({ musicSongs: [] }),
  } as unknown as CollectionCatalog
  const songs = musicSongs(catalog, {
    '11': { score: 980_000, claimed: true },
    '12': { score: 720_000, claimed: false },
    '14': { score: 990_000, claimed: false },
  })

  it('lists every song with its beatmaps easiest first', () => {
    expect(songs.map((s) => s.name)).toEqual(['Blossoms of Summer Night', '#2'])
    expect(songs[0]!.artist).toBe('Yoimiya')
    expect(songs[1]!.artist).toBe('')
    expect(songs[0]!.beatmaps.map((b) => b.difficulty)).toEqual([1, 2, 4])
    expect(songs[0]).toMatchObject({ played: true, rewardLeft: 1, best: 990_000 })
    expect(songs[1]).toMatchObject({ played: false, rewardLeft: 0, best: 0 })
  })

  it('counts rewards only where a beatmap has one', () => {
    expect(musicSummary(songs)).toEqual({
      songs: 2,
      songsPlayed: 1,
      beatmaps: 4,
      beatmapsPlayed: 3,
      rewards: 3,
      rewardsClaimed: 1,
      rewardsLeft: 1,
    })
  })

  it('filters, searches and sorts', () => {
    expect(shownSongs(songs, 'left', '', 'game').map((s) => s.id)).toEqual([1])
    expect(shownSongs(songs, 'all', 'yoimiya', 'game').map((s) => s.id)).toEqual([1])
    expect(shownSongs(songs, 'all', '', 'name').map((s) => s.id)).toEqual([2, 1])
  })
})

describe('Serenitea Pot gift sets', () => {
  const catalog = {
    data: {
      furnitureSets: [
        { id: 31, icon: 'UI_Home_Suite_A' },
        { id: 32, icon: 'UI_Home_Suite_B' },
        { id: 1, icon: 'UI_Home_Suite_Camp_01' },
      ],
      companionRewards: [
        { id: 1, character: 10000003, set: 31, reward: 990002 },
        { id: 2, character: 10000020, set: 31, reward: 990002 },
        { id: 3, character: 10000003, set: 32, reward: 990002 },
      ],
    },
    text: texts({
      furnitureSets: [[31, { name: 'Gift Set A' }]],
      companions: [
        [10000003, { name: 'Jean' }],
        [10000020, { name: 'Razor' }],
      ],
    }),
    english: texts({
      furnitureSets: [],
      companions: [
        [10000003, { name: 'Jean' }],
        [10000020, { name: 'Razor' }],
      ],
    }),
  } as unknown as CollectionCatalog

  it('puts each gift set with its companions, claimed or waiting', () => {
    const cards = furnishingSetCards(catalog, [31], [1])
    expect(cards.map((c) => [c.id, c.learned, c.companions.length, c.claimed])).toEqual([
      [31, true, 2, 1],
      [32, false, 1, 0],
      [1, false, 0, 0],
    ])
    expect(cards[0]!.name).toBe('Gift Set A')
    expect(cards[0]!.companions.map((c) => [c.name, c.key, c.claimed])).toEqual([
      ['Jean', 'Jean', true],
      ['Razor', 'Razor', false],
    ])
  })

  it('counts each companion over their gift sets', () => {
    expect(companionCards(catalog, [1, 3]).map((c) => [c.name, c.claimed, c.total])).toEqual([
      ['Jean', 2, 2],
      ['Razor', 0, 1],
    ])
  })

  it('keeps only the companions the account owns', () => {
    const owned = new Set(['Jean'])
    expect(ownedCompanions(companionCards(catalog, [1]), owned).map((c) => c.name)).toEqual([
      'Jean',
    ])
    // Razor claimed: set 31 shows Jean alone, recounted; no set card is dropped.
    const sets = setsWithOwnedCompanions(furnishingSetCards(catalog, [31], [2]), owned)
    expect(sets.map((c) => [c.id, c.companions.map((x) => x.name), c.claimed])).toEqual([
      [31, ['Jean'], 0],
      [32, ['Jean'], 0],
      [1, [], 0],
    ])
    // A companion the game data has no character key for stays.
    const unknown = { ...companionCards(catalog, null)[0]!, key: '' }
    expect(ownedCompanions([unknown], new Set())).toHaveLength(1)
  })
})
