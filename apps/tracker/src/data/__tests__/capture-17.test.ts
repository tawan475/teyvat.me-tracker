import { describe, expect, it } from 'vitest'
import type { CollectionCatalog } from '../collection-names'
import { hangoutChapters } from '../hangouts'

const texts = (entries: Record<string, [number, Record<string, string>][]>) =>
  Object.fromEntries(
    Object.entries(entries).map(([section, rows]) => [section, new Map(rows)]),
  ) as unknown as CollectionCatalog['text']

describe('hangoutChapters', () => {
  const catalog = {
    data: {
      hangouts: [
        { id: 101501, character: 10000015, order: 2, icon: 'UI_ChapterIcon_Kaeya' },
        { id: 101401, character: 10000014, order: 1, icon: 'UI_ChapterIcon_Barbara' },
      ],
    },
    text: texts({
      hangouts: [[101401, { name: 'Wellspring of Healing', title: 'Hangout Event: Barbara' }]],
      hangoutCgs: [[10140101, { name: 'Untimely Enthusiasm' }]],
    }),
    english: texts({ hangouts: [], hangoutCgs: [] }),
  } as unknown as CollectionCatalog

  it('names chapters and endings, in the game data order', () => {
    const chapters = hangoutChapters(
      {
        '101501': { endings: { '10150101': 'locked' }, pictures: [], picturesTotal: 12 },
        '101401': {
          state: 'accepted',
          endings: { '10140102': 'unclaimed', '10140101': 'claimed' },
          pictures: [1, 2],
          picturesTotal: 12,
        },
      },
      catalog,
    )
    expect(chapters.map((c) => c.id)).toEqual([101401, 101501])
    expect(chapters[0]).toMatchObject({
      name: 'Wellspring of Healing',
      title: 'Hangout Event: Barbara',
      icon: 'UI_ChapterIcon_Barbara',
      state: 'accepted',
      endingsDone: 2,
      pictures: { have: 2, total: 12 },
    })
    expect(chapters[0]!.endings).toEqual([
      { id: 10140101, name: 'Untimely Enthusiasm', state: 'claimed' },
      { id: 10140102, name: '#10140102', state: 'unclaimed' },
    ])
    expect(chapters[1]).toMatchObject({ name: '#101501', state: null, endingsDone: 0 })
  })
})
