import type { SnapshotResponse, SnapshotSummary } from '@gdt/shared'
import { describe, expect, it } from 'vitest'
import { figureNotShared, snapshotChanges } from '../snapshot-figures'

// The Snapshots table's figures while Capture leaves a section out (gi_off, issue 12).

const summary = (characters: number, mora: number): SnapshotSummary => ({
  characters,
  weapons: 4,
  artifacts: 9,
  materials: mora > 0 ? 30 : 0,
  mora,
  primogem: mora > 0 ? 160 : 0,
  artifact3: 1,
  artifact4: 2,
})

/** Newest first, like the snapshot list. */
function snaps(...list: [id: number, s: SnapshotSummary, off?: string[]][]): SnapshotResponse[] {
  return list.map(([id, s, off]) => ({
    id,
    takenAt: id * 1000,
    lastSeenAt: id * 1000,
    createdAt: id * 1000,
    source: 'Teyvat.me',
    rawSize: 1,
    storedSize: 1,
    summary: s,
    ...(off ? { off } : {}),
  }))
}

describe('the Snapshots table while a section is not shared', () => {
  const list = snaps(
    [5, summary(86, 900)],
    [4, summary(0, 0), ['characters', 'materials']],
    [3, summary(0, 700), ['characters']],
    [2, summary(85, 600), []],
    [1, summary(84, 500)],
  )
  const changes = snapshotChanges(list)
  const delta = (id: number, key: 'characters' | 'mora' | 'weapons') =>
    changes.get(id)?.[key]?.delta

  it('says "not shared" for the figures of a section the snapshot left out', () => {
    expect(figureNotShared(list[1]!, 'characters')).toBe(true)
    expect(figureNotShared(list[1]!, 'mora')).toBe(true)
    expect(figureNotShared(list[1]!, 'primogem')).toBe(true)
    expect(figureNotShared(list[1]!, 'weapons')).toBe(false)
    expect(figureNotShared(list[2]!, 'mora')).toBe(false)
    // No gi_off (an older Capture, an import): everything it has is shared.
    expect(figureNotShared(list[4]!, 'characters')).toBe(false)
  })

  it('never shows "-85 characters" on it, nor "+86" on the next shared one', () => {
    expect(delta(3, 'characters')).toBeUndefined()
    expect(delta(4, 'characters')).toBeUndefined()
    // Against the closest older snapshot that shared the roster (#2).
    expect(delta(5, 'characters')).toBe(1)
    expect(changes.get(5)!.characters!.since.id).toBe(2)
    expect(delta(2, 'characters')).toBe(1)
  })

  it('does the same for the currency, and leaves shared figures as they were', () => {
    expect(delta(3, 'mora')).toBe(100)
    expect(delta(4, 'mora')).toBeUndefined()
    expect(delta(5, 'mora')).toBe(200)
    expect(changes.get(5)!.mora!.since.id).toBe(3)
    expect(delta(4, 'weapons')).toBe(0)
    expect(changes.get(4)!.weapons!.since.id).toBe(3)
    // The first snapshot has nothing to compare with.
    expect(changes.get(1)).toEqual({})
  })

  it('still skips a snapshot that lost its currency packet', () => {
    const lost = snaps([3, summary(86, 900)], [2, summary(85, 0)], [1, summary(84, 500)])
    const rows = snapshotChanges(lost)
    expect(rows.get(2)!.mora).toBeUndefined()
    expect(rows.get(3)!.mora).toMatchObject({ delta: 400 })
    expect(figureNotShared(lost[1]!, 'mora')).toBe(false)
  })
})
