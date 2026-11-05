import { describe, expect, it } from 'vitest'
import { characterInfo } from '@gdt/game-data/catalog'
import { characterGuides, guideSlug, guidesFor, youtubeId } from '../character-guides'

describe('characterGuides (the hand-kept file)', () => {
  it('names only known characters and links only https pages', () => {
    for (const [key, guides] of Object.entries(characterGuides)) {
      expect(characterInfo(key), key).toBeDefined()
      for (const guide of guides) {
        if (guide.url) expect(guide.url, key).toMatch(/^https:\/\//)
        if (guide.type === 'youtube') expect(youtubeId(guide.url ?? ''), key).not.toBeNull()
      }
    }
  })
})

describe('guidesFor', () => {
  const table = {
    RaidenShogun: [
      { type: 'kqm' as const, url: 'https://keqingmains.com/raiden/' },
      { type: 'prydwen' as const },
      { type: 'link' as const, url: 'https://example.com/raiden', title: 'Notes' },
      {
        type: 'youtube' as const,
        url: 'https://youtu.be/abcdefghijk',
        title: 'A video',
        channel: 'Ch',
      },
      { type: 'youtube' as const, url: 'https://example.com/not-a-video' },
    ],
  }

  it('always lists the three sites in order, defaults from the kebab-case key', () => {
    const { sites, links, videos } = guidesFor('RaidenShogun', table)
    expect(sites).toEqual([
      {
        type: 'prydwen',
        url: 'https://www.prydwen.gg/genshin-impact/characters/raiden-shogun',
        found: true,
      },
      { type: 'kqm', url: 'https://keqingmains.com/raiden/', found: true },
      // Not listed for this character: the site's index.
      {
        type: 'helper',
        url: 'https://genshin-impact-helper-team.github.io/genshin-builds/',
        found: false,
      },
    ])
    expect(links).toEqual([{ url: 'https://example.com/raiden', title: 'Notes' }])
    // The entry whose id can't be read is dropped.
    expect(videos).toEqual([
      { url: 'https://youtu.be/abcdefghijk', id: 'abcdefghijk', title: 'A video', channel: 'Ch' },
    ])
  })

  it("links a character not in the file to Prydwen's page by slug, the others' search, no videos", () => {
    const { sites, videos } = guidesFor('Mitya', table)
    expect(sites.map((s) => [s.url, s.found])).toEqual([
      ['https://www.prydwen.gg/genshin-impact/characters/mitya', true],
      ['https://keqingmains.com/#search', false],
      ['https://genshin-impact-helper-team.github.io/genshin-builds/', false],
    ])
    expect(videos).toEqual([])
  })

  it("makes each site's page from the key when the entry has no url", () => {
    const sites = guidesFor('HuTao', {
      HuTao: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
    }).sites.map((s) => s.url)
    expect(sites).toEqual([
      'https://www.prydwen.gg/genshin-impact/characters/hu-tao',
      'https://keqingmains.com/hu-tao/',
      'https://genshin-impact-helper-team.github.io/genshin-builds/en/hu-tao/',
    ])
  })

  it('reads video ids from watch, youtu.be and shorts links', () => {
    expect(youtubeId('https://www.youtube.com/watch?v=abcdefghijk&t=10')).toBe('abcdefghijk')
    expect(youtubeId('https://youtu.be/abcdefghijk')).toBe('abcdefghijk')
    expect(youtubeId('https://youtube.com/shorts/abcdefghijk')).toBe('abcdefghijk')
    expect(youtubeId('https://example.com/watch?v=abcdefghijk')).toBeNull()
    expect(guideSlug('TravelerAnemo')).toBe('traveler-anemo')
  })
})
