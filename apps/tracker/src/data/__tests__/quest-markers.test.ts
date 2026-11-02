import { collectionText, loadCollections } from '@gdt/game-data/collections'
import { beforeAll, describe, expect, it } from 'vitest'
import type { CollectionCatalog } from '../collection-names'
import { chapterKind, markChange, questGroups } from '../quest-markers'

let en: CollectionCatalog

beforeAll(async () => {
  const [data, english] = await Promise.all([
    loadCollections(['archive', 'world']),
    collectionText('en', ['archive', 'world']),
  ])
  en = { data, text: english, english } as unknown as CollectionCatalog
})

describe('quest markers', () => {
  it('tells Archon chapters from Story chapters by their number', () => {
    expect(chapterKind(1001)).toBe('archon')
    expect(chapterKind(1611)).toBe('archon')
    expect(chapterKind(2043)).toBe('story')
    expect(chapterKind(0)).toBeNull()
  })

  it('lists the Archon Quests by chapter, Prologue first, none done without a capture', () => {
    const groups = questGroups(en, 'archon', null, new Set(), new Set())
    expect(groups[0]!.label).toBe('Prologue: Act I · The Outlander Who Caught the Wind')
    expect(groups.every((g) => g.rows.length > 0 && g.done === 0)).toBe(true)
    const rows = groups.flatMap((g) => g.rows)
    expect(rows.every((r) => !r.name.startsWith('#') && r.state === 'none')).toBe(true)
    expect(rows.find((r) => r.href)?.href).toMatch(/^https:\/\/genshin-impact\.fandom\.com\/wiki\//)
    expect(questGroups(en, 'story', null, new Set(), new Set()).length).toBeGreaterThan(50)
  })

  it('marks done from the capture, the Archive or a hand mark; open when accepted', () => {
    const [first, second, third, fourth] = questGroups(
      en,
      'archon',
      null,
      new Set(),
      new Set(),
    )[0]!.rows.concat(questGroups(en, 'archon', null, new Set(), new Set())[1]!.rows)
    const codexOf = (quest: number) =>
      en.data.quests.find((q) => (q as Record<string, unknown>).quest === quest)!.id
    const groups = questGroups(
      en,
      'archon',
      { finished: [first!.id], active: [second!.id] },
      new Set([codexOf(third!.id)]),
      new Set([fourth!.id, first!.id]),
    )
    const of = (id: number) => groups.flatMap((g) => g.rows).find((r) => r.id === id)!
    expect(of(first!.id)).toMatchObject({ state: 'done', captured: true, hand: false })
    expect(of(second!.id)).toMatchObject({ state: 'active', captured: false })
    expect(of(third!.id)).toMatchObject({ state: 'done', captured: true })
    expect(of(fourth!.id)).toMatchObject({ state: 'done', captured: false, hand: true })
    expect(markChange(of(first!.id))).toBeNull()
    expect(markChange(of(fourth!.id))).toEqual({ done: [], undone: [fourth!.id] })
    expect(markChange(of(second!.id))).toEqual({ done: [second!.id], undone: [] })
  })

  it('groups World Quests by region', () => {
    const groups = questGroups(en, 'world', null, new Set(), new Set())
    expect(groups[0]!.label).toBe('Mondstadt')
    expect(groups.reduce((n, g) => n + g.rows.length, 0)).toBeGreaterThan(700)
  })
})
