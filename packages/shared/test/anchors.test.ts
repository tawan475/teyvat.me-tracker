import { describe, expect, it } from 'vitest'
import {
  decodeSectionBlob,
  planSections,
  sectionHashOf,
  shortHashHex,
  type KnownBlob,
} from '../src'
import { MATERIALS } from '../src/dictionary/materials'
import { random } from './synthetic'

// The stale-anchor rule (docs/plans/storage-efficiency.md, phase 2): a full
// section stops riding on an anchor it has drifted from, judged against the
// neighbour snapshot's own blob, while chains stay one deep.

interface Row {
  id: number
  /** The blob this one is compressed against; null for a standalone (an anchor). */
  base: number | null
  bytes: number
  /** A plan that only pointed at an existing blob stores nothing. */
  stored: boolean
}

/** Plans `values` one after another as one account's collections2 sections. */
async function chain(
  values: readonly unknown[],
): Promise<{ rows: Row[]; known: Map<number, KnownBlob> }> {
  const known = new Map<number, KnownBlob>()
  const byHash = new Map<string, { id: number; code: number }>()
  let latest: KnownBlob | null = null
  let next = 1
  const rows: Row[] = []
  for (const value of values) {
    const hash = shortHashHex(await sectionHashOf('collections2', value))
    const plan = await planSections({
      values: { collections2: { value, hash } },
      latest: { collections2: latest },
      existing: byHash,
      materialsDictionary: MATERIALS,
    })
    const blob = plan.blobs[0]
    if (!blob) {
      const ref = plan.refs.collections2!
      latest = known.get('id' in ref ? ref.id : byHash.get(ref.hash)!.id)!
      rows.push({ id: latest.id, base: latest.base?.id ?? null, bytes: 0, stored: false })
      continue
    }
    const id = next++
    const base = blob.base && 'id' in blob.base ? known.get(blob.base.id)! : null
    const decoded = decodeSectionBlob(blob.code, blob.data, base?.decoded ?? null, null)
    const entry: KnownBlob = {
      id,
      code: blob.code,
      hash: blob.hash,
      size: blob.data.length,
      decoded,
      base,
    }
    known.set(id, entry)
    byHash.set(blob.hash, { id, code: blob.code })
    latest = entry
    rows.push({ id, base: base?.id ?? null, bytes: blob.data.length, stored: true })
  }
  return { rows, known }
}

/** Ascending ids with random gaps (as the game's id lists are). */
function ascending(rand: () => number, count: number, from = 1000): number[] {
  const out: number[] = []
  let at = from
  for (let i = 0; i < count; i++) out.push((at += 1 + Math.floor(rand() * 9)))
  return out
}

/** A collections2 section: defeats and blueprints, optionally the quests part. */
function section(
  defeats: [number, number, number][],
  blueprints: number[],
  quests?: number[],
): unknown {
  return { d: defeats, f: blueprints, ...(quests ? { q: { f: quests } } : {}) }
}

function defeatRows(rand: () => number, count: number): [number, number, number][] {
  return ascending(rand, count, 20000).map((id) => [id, Math.floor(rand() * 5000), 0])
}

/** `rows` with `n` of them counted up by one (a login's few more defeats). */
function moreDefeats(rows: [number, number, number][], n: number, seed: number) {
  return rows.map((row, i): [number, number, number] =>
    (i * 7 + seed) % Math.floor(rows.length / n) === 0 ? [row[0], row[1] + 1, row[2]] : row,
  )
}

describe('stale anchors', () => {
  it('re-roots once the anchor has drifted, then later rows ride on the new anchor', async () => {
    const rand = random(7)
    let defeats = defeatRows(rand, 1500)
    const blueprints = ascending(rand, 1200)
    const quests = ascending(rand, 1500, 70000)
    const values: unknown[] = [section(defeats, blueprints)]
    for (let i = 1; i <= 4; i++) {
      defeats = moreDefeats(defeats, 3, i)
      values.push(section(defeats, blueprints))
    }
    // A part the anchor never had (Capture 1.17's quests).
    for (let i = 5; i <= 9; i++) {
      defeats = moreDefeats(defeats, 3, i)
      values.push(section(defeats, blueprints, quests))
    }
    const { rows } = await chain(values)

    expect(rows[0]!.base).toBeNull()
    // The small edits ride on the first anchor.
    for (const row of rows.slice(1, 5)) expect(row.base).toBe(rows[0]!.id)
    // Against the old anchor every later row would re-encode the quests:
    // one becomes the new anchor, and the rows after it ride on that one.
    const reroot = rows.findIndex((row, i) => i > 0 && row.base === null)
    expect(reroot).toBeGreaterThanOrEqual(5)
    expect(reroot).toBeLessThanOrEqual(6)
    for (const row of rows.slice(reroot + 1)) {
      expect(row.base).toBe(rows[reroot]!.id)
      expect(row.bytes).toBeLessThan(400)
    }
  })

  it('keeps a stale anchor whose rows stay under 512 bytes', async () => {
    const rand = random(11)
    const defeats = defeatRows(rand, 600)
    const blueprints = ascending(rand, 400)
    // A small part added later: the anchor lacks it (the neighbour would
    // compress far better), but each row against the anchor stays small.
    const quests = ascending(rand, 60, 70000)
    const values: unknown[] = [section(defeats, blueprints)]
    for (let i = 1; i <= 6; i++) values.push(section(defeats, blueprints, quests.slice(0, 50 + i)))
    const { rows } = await chain(values)
    for (const row of rows.slice(1)) {
      expect(row.bytes).toBeLessThanOrEqual(512)
      // Under STALE_MIN_BYTES a re-root costs more than it saves.
      expect(row.base).toBe(rows[0]!.id)
    }
  })

  it('a partial capture costs one or two anchors, not every later row', async () => {
    const rand = random(13)
    let defeats = defeatRows(rand, 1500)
    const blueprints = ascending(rand, 1200)
    const values: unknown[] = [section(defeats, blueprints)]
    // Sent before the defeats arrived: blueprints alone.
    values.push(section([], blueprints))
    for (let i = 2; i <= 9; i++) {
      defeats = moreDefeats(defeats, 3, i)
      values.push(section(defeats, blueprints))
    }
    const { rows } = await chain(values)
    expect(rows.filter((row) => row.base === null).length).toBeLessThanOrEqual(3)
    // The rows after it are small again (a growth rule would leave every one ~KBs).
    for (const row of rows.slice(4)) expect(row.bytes).toBeLessThan(400)
  })

  it('never chains a full section deeper than one base', async () => {
    const rand = random(17)
    let defeats = defeatRows(rand, 900)
    const blueprints = ascending(rand, 600)
    const quests = ascending(rand, 900, 70000)
    const values: unknown[] = []
    for (let i = 0; i < 24; i++) {
      defeats = moreDefeats(defeats, 2 + (i % 3), i)
      values.push(section(defeats, blueprints, i > 8 ? quests : undefined))
    }
    const { known } = await chain(values)
    for (const blob of known.values()) {
      if (blob.base) expect(blob.base.base).toBeNull()
    }
  })
})
