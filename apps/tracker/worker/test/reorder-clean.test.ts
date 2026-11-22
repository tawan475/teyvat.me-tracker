import {
  BlobDecoder,
  cleanSection,
  encodeSectionBlob,
  kindCode,
  sectionHashOf,
  shortHashHex,
  type SectionKind,
} from '@gdt/shared'
import { describe, expect, it } from 'vitest'
import { planReorder } from '../services/reorder'
import { REF_COLUMNS } from '../services/storage'

/** Sections as an account stored them before the tracker dropped fields (dropped.ts). */
const old: Record<number, Partial<Record<SectionKind, object>>> = {
  1: {
    tasks: { w: 30, m: [[1, [1_700_000_000, 1_700_000_100]]] },
    collections2: { m: [10, 11, 12], f: [5] },
    extras: { m: [[3, 0]] },
  },
  2: {
    tasks: { w: 29, m: [[1, [1_700_000_500]]] },
    collections2: { m: [10, 11, 12, 13], f: [5] },
    extras: { m: [[3, 0]], t: [[1, 2_000, [10]]] },
  },
}

describe('time-order repack, cleaning', () => {
  it('takes the fields no longer kept out of every snapshot, as the import stores them', async () => {
    let id = 0
    const blobs: { id: number; kind: number; hash: string; base_id: null; data: Uint8Array }[] = []
    const snapshots = await Promise.all(
      Object.entries(old).map(async ([snapshot, sections]) => {
        const row: Record<string, unknown> = { id: Number(snapshot), taken_at: Number(snapshot) }
        for (const [kind, value] of Object.entries(sections) as [SectionKind, object][]) {
          const n = ++id
          const blob = encodeSectionBlob(kind, value, false, null)
          blobs.push({
            id: n,
            kind: kindCode(kind, false),
            hash: shortHashHex(await sectionHashOf(kind, value)),
            base_id: null,
            data: blob.data,
          })
          row[REF_COLUMNS[kind]] = n
        }
        return row as { id: number; taken_at: number }
      }),
    )

    // A plain repack keeps them.
    expect((await planReorder(snapshots, blobs)).cleaned).toBe(0)

    const plan = await planReorder(snapshots, blobs, { clean: true })
    expect(plan.cleaned).toBe(2)
    const byHash = new Map(plan.blobs.map((b, i) => [b.hash, { ...b, id: i + 1 }]))
    const decoder = new BlobDecoder((n) => {
      const b = [...byHash.values()].find((x) => x.id === n)
      return (
        b && {
          id: b.id,
          code: b.code,
          baseId: b.baseHash ? byHash.get(b.baseHash)!.id : null,
          data: b.data,
        }
      )
    })
    for (const ref of plan.refs) {
      const sections = old[ref.id]!
      for (const [kind, value] of Object.entries(sections) as [SectionKind, object][]) {
        const expected = cleanSection(kind, value)
        const hash = ref.hashes[kind]
        if (expected === null) {
          expect(hash, `${ref.id} ${kind}`).toBeUndefined()
          continue
        }
        // The hash the import gives the cleaned section, and its value.
        expect(hash, `${ref.id} ${kind}`).toBe(shortHashHex(await sectionHashOf(kind, expected)))
        expect(decoder.decode(byHash.get(hash!)!.id).value).toEqual(expected)
      }
    }
    // Respawns gone, the monsters seen as a count, Miliastra gone (its
    // section with it when nothing else was there).
    expect(cleanSection('tasks', old[1]!.tasks)).toEqual({ w: 30 })
    expect(cleanSection('collections2', old[2]!.collections2)).toEqual({ f: [5], c: 4 })
    expect(plan.refs.find((r) => r.id === 1)!.hashes.extras).toBeUndefined()
    expect(plan.refs.find((r) => r.id === 2)!.hashes.extras).toBeDefined()
  })
})
