import { collectionText, loadCollections } from '@gdt/game-data/collections'
import { beforeAll, describe, expect, it } from 'vitest'
import type { CollectionCatalog } from '../collection-names'
import { WIKI_QUEST_TITLES } from '@/lib/wiki-quest-titles'
import { worldQuestList } from '../world-quests'

let en: CollectionCatalog

beforeAll(async () => {
  const [data, english] = await Promise.all([
    loadCollections(['archive', 'world']),
    collectionText('en', ['archive', 'world']),
  ])
  en = { data, text: english, english } as unknown as CollectionCatalog
})

describe('World Quests', () => {
  it('lists every one by region, named, other last, none done without a capture', () => {
    const list = worldQuestList(en, null)
    expect(list.length).toBeGreaterThan(700)
    expect(list.every((q) => !q.name.startsWith('#') && !q.done && !q.active)).toBe(true)
    expect(list[0]!.region).toBe('Mondstadt')
    expect(list.at(-1)!.city).toBe(0)
    const cities = list.map((q) => (q.city === 0 ? 1e6 : q.city))
    expect(cities).toEqual([...cities].sort((a, b) => a - b))
    expect(list.some((q) => q.series)).toBe(true)
    expect(list.find((q) => q.href)?.href).toMatch(/^https:\/\/genshin-impact\.fandom\.com\/wiki\//)
  })

  it('is done when any of its quests is finished, open when only accepted', () => {
    const rows = en.data.worldQuests
    const several = rows.find((r) => (r.quests as number[]).length > 1)!
    const [first, second] = rows.filter((r) => (r.quests as number[]).length === 1)
    const list = worldQuestList(en, {
      finished: [(several.quests as number[])[1]!, first!.id],
      active: [second!.id, first!.id],
    })
    const of = (id: number) => list.find((q) => q.id === id)!
    expect(of(several.id).done).toBe(true)
    expect(of(first!.id)).toMatchObject({ done: true, active: false })
    expect(of(second!.id)).toMatchObject({ done: false, active: true })
    expect(list.filter((q) => q.done).length).toBe(2)
  })

  it('links a quest whose name is another wiki page to the quest', () => {
    const list = worldQuestList(en, null)
    // Yelan's C6 is "Winner Takes All"; the Snezhnaya quest is "Winner Takes All (Quest)".
    expect(list.find((q) => q.name === 'Winner Takes All')?.href).toBe(
      'https://genshin-impact.fandom.com/wiki/Winner_Takes_All_(Quest)',
    )
    expect(list.find((q) => q.name === 'Pursuit')?.href).toMatch(/\/Pursuit_\(Part_1\)$/)
  })

  it('lists only quest names the game data still has', () => {
    const names = new Set(
      [en.english.worldQuests, en.english.quests].flatMap((m) =>
        [...m.values()].map((v) => (v as { name: string }).name),
      ),
    )
    expect(Object.keys(WIKI_QUEST_TITLES).filter((n) => !names.has(n))).toEqual([])
  })
})
