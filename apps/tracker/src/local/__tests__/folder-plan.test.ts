import { describe, expect, it } from 'vitest'
import {
  batchToasts,
  emptyBatch,
  fileKey,
  guestWishAccount,
  kindOf,
  newFiles,
  newer,
  readCount,
  readOrder,
} from '../folder-plan'

const file = (name: string, lastModified: number, size = 100) => ({ name, size, lastModified })

describe('watched folder', () => {
  it('lists the .json files not read yet in this state, oldest first', () => {
    const listing = [
      file('leyline-2026-11-18_21-04-12.json', 3_000),
      file('notes.txt', 500),
      file('leyline-2026-11-18_19-12-03.json', 1_000),
      file('leyline-2026-11-17_08-00-00.json', 2_000),
    ]
    const seen = { 'leyline-2026-11-17_08-00-00.json': fileKey(listing[3]!) }
    expect(newFiles(listing, seen).map((f) => f.name)).toEqual([
      'leyline-2026-11-18_19-12-03.json',
      'leyline-2026-11-18_21-04-12.json',
    ])
  })

  it('reads a file again once it is rewritten (new size or time)', () => {
    const before = file('wishes.json', 1_000, 10)
    const seen = { 'wishes.json': fileKey(before) }
    expect(newFiles([before], seen)).toEqual([])
    expect(newFiles([file('wishes.json', 2_000, 10)], seen)).toHaveLength(1)
    expect(newFiles([file('wishes.json', 1_000, 11)], seen)).toHaveLength(1)
  })

  it('reads in capture-time order, the modified time standing in where a file has none', () => {
    const order = readOrder([
      { ...file('b.json', 5_000), takenAt: 1_000 },
      { ...file('a.json', 2_000), takenAt: null },
      { ...file('c.json', 9_000), takenAt: 3_000 },
    ])
    expect(order.map((f) => f.name)).toEqual(['b.json', 'a.json', 'c.json'])
  })

  it('tells GOOD exports and UIGF wish files apart from their first bytes', () => {
    expect(kindOf('{"format":"GOOD","version":3,"source":"Teyvat.me Capture"')).toBe('good')
    expect(kindOf('{\n  "format": "GOOD",')).toBe('good')
    expect(
      kindOf('{"info":{"export_timestamp":1,"version":"v4.0"},"hk4e":[{"uid":"812345678"'),
    ).toBe('wishes')
    expect(kindOf('{"info":{"uid":"812345678","uigf_version":"v3.0"},"list":[')).toBe('wishes')
    expect(kindOf('{"wish-counter-character-event":{}}')).toBe('other')
    expect(kindOf('not json')).toBe('other')
  })

  it("takes the guest's account of a wish file, refusing another player's", () => {
    const accounts = [{ uid: '712345678' }, { uid: '812345678' }]
    expect(guestWishAccount(accounts, '812345678')).toBe(accounts[1])
    expect(guestWishAccount(accounts, '912345678')).toBeNull()
    // No UID yet: the file's only account, never a guess among several.
    expect(guestWishAccount([accounts[0]!], null)).toBe(accounts[0])
    expect(guestWishAccount(accounts, null)).toBeNull()
  })

  it('shows one success toast per batch (mutable) and one refusal toast (never muted)', () => {
    const batch = emptyBatch()
    expect(batchToasts(batch, false)).toEqual({ read: false, refused: false })
    batch.created = 12
    batch.wishes = 1
    expect(readCount(batch)).toBe(13)
    expect(batchToasts(batch, false)).toEqual({ read: true, refused: false })
    batch.refused.push({ name: 'other.json', uid: '712345678', own: '812345678' })
    expect(batchToasts(batch, true)).toEqual({ read: false, refused: true })
  })

  it('keeps the newest file read', () => {
    const a = file('a.json', 1_000)
    const b = file('b.json', 2_000)
    expect(newer(null, a)).toBe(a)
    expect(newer(b, a)).toBe(b)
    expect(newer(a, b)).toBe(b)
  })
})
