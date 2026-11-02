import type { GiCollections } from '@gdt/shared'
import { nameOf, wikiGuide, type CollectionCatalog } from '@/data/collection-names'
import { worldQuestList } from '@/data/world-quests'

/**
 * Quest markers (Collections → Archive → Quests, design "2" of the
 * new-features canvas; the quests' text stays on the wiki, the user's call):
 * every Archon, Story and World Quest with a marker — done, in progress or
 * not started — from the capture's parent quests (`gi_collections.quests`),
 * the Archive's unlocked entries and the player's own marks. Pure.
 */

export const QUEST_KINDS = ['archon', 'story', 'world'] as const
export type QuestKind = (typeof QUEST_KINDS)[number]
export type QuestState = 'done' | 'active' | 'none'

export interface QuestRow {
  /** MainQuest id: what the capture sends and a hand mark stores. */
  id: number
  name: string
  /** The act ("Chapter I: Act II") or series, '' for none. */
  sub: string
  state: QuestState
  /** Done by the capture or the Archive (a hand mark can't undo it). */
  captured: boolean
  /** Done only by the player's mark. */
  hand: boolean
  href?: string
}

export interface QuestGroup {
  /** A chapter id (Archon, Story) or a region (World). */
  key: number
  label: string
  rows: QuestRow[]
  done: number
}

/**
 * The game numbers chapters by kind: 1xxx the Archon Quests (interludes
 * too), 2xxx the Story Quests (Natlan's tribal chapters too).
 */
export function chapterKind(chapter: number): QuestKind | null {
  if (chapter >= 1000 && chapter < 2000) return 'archon'
  if (chapter >= 2000 && chapter < 3000) return 'story'
  return null
}

const num = (value: unknown) => (typeof value === 'number' ? value : 0)

function stateOf(done: boolean, active: boolean): QuestState {
  return done ? 'done' : active ? 'active' : 'none'
}

/**
 * One kind's quests by chapter (Archon, Story: the Archive's quest entries,
 * in chapter then quest order) or by region (World: worldQuestList).
 * `unlocked` holds the Archive quest entries the capture has (its codex
 * ids); `marks` the MainQuest ids marked by hand.
 */
export function questGroups(
  catalog: CollectionCatalog,
  kind: QuestKind,
  quests: GiCollections['quests'] | null,
  unlocked: ReadonlySet<number>,
  marks: ReadonlySet<number>,
): QuestGroup[] {
  const groups = new Map<number, QuestGroup>()
  const add = (key: number, label: string, row: QuestRow) => {
    let group = groups.get(key)
    if (!group) groups.set(key, (group = { key, label, rows: [], done: 0 }))
    group.rows.push(row)
    if (row.state === 'done') group.done++
  }

  if (kind === 'world') {
    for (const q of worldQuestList(catalog, quests)) {
      const hand = !q.done && marks.has(q.id)
      add(q.city, q.region, {
        id: q.id,
        name: q.name,
        sub: q.series,
        state: hand ? 'done' : stateOf(q.done, q.active),
        captured: q.done,
        hand,
        href: q.href,
      })
    }
    return [...groups.values()]
  }

  const finished = new Set(quests?.finished ?? [])
  const active = new Set(quests?.active ?? [])
  const rows = catalog.data.quests
    .map((row) => ({
      codex: row.id,
      quest: num((row as Record<string, unknown>).quest) || row.id,
      chapter: num(row.chapter),
      order: num(row.order),
    }))
    .filter((row) => chapterKind(row.chapter) === kind)
    .sort((a, b) => a.chapter - b.chapter || a.order - b.order || a.codex - b.codex)
  for (const row of rows) {
    const captured = finished.has(row.quest) || unlocked.has(row.codex)
    const hand = !captured && marks.has(row.quest)
    const number = nameOf(catalog, 'chapters', row.chapter, 'number')
    const title = nameOf(catalog, 'chapters', row.chapter, 'name')
    const label = [number, title].filter((part) => part && !part.startsWith('#')).join(' · ')
    add(row.chapter, label || `#${row.chapter}`, {
      id: row.quest,
      name: nameOf(catalog, 'quests', row.codex),
      sub: number.startsWith('#') ? '' : number,
      state: captured || hand ? 'done' : stateOf(false, active.has(row.quest)),
      captured,
      hand,
      href: wikiGuide(catalog, 'quests', row.codex),
    })
  }
  return [...groups.values()]
}

/** What a marker click does: a captured quest stays done; otherwise the mark flips. */
export function markChange(row: QuestRow): { done: number[]; undone: number[] } | null {
  if (row.captured) return null
  return row.hand ? { done: [], undone: [row.id] } : { done: [row.id], undone: [] }
}
