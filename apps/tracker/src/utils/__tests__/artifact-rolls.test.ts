import { describe, expect, it } from 'vitest'
import type { Good, GoodArtifact, LiveJournalResponse } from '@gdt/shared'
import { rollsByLine, rollValue } from '@gdt/shared/rolls'
import { withJournal } from '@/data/live-now'
import { inferArtifactRolls, type RollSource } from '@/utils/artifact-rolls'
import cases from '../../../../../packages/shared/test/fixtures/gi-rolls-cases.json'

const s = (key: string, value: number, initialValue?: number) =>
  initialValue === undefined ? { key, value } : { key, value, initialValue }

/** Artifacts without `gi_rolls`: what the function returned before exact rolls existed. */
const PINS: Record<string, RollSource> = {
  capture5: {
    rarity: 5,
    level: 20,
    totalRolls: 9,
    substats: [
      s('critRate_', 9.7, 3.9),
      s('critDMG_', 21, 6.2),
      s('enerRech_', 4.5, 4.5),
      s('atk_', 11.1, 5.3),
    ],
  },
  good5: {
    rarity: 5,
    level: 20,
    substats: [s('critRate_', 9.7), s('critDMG_', 21), s('enerRech_', 4.5), s('atk_', 11.1)],
  },
  threeLiner5: {
    rarity: 5,
    level: 0,
    substats: [s('hp', 239), s('atk_', 5.8), s('critDMG_', 7.8)],
  },
  opened5: {
    rarity: 5,
    level: 8,
    totalRolls: 5,
    substats: [s('def', 37, 16), s('eleMas', 40, 19), s('hp_', 5.8, 5.8), s('critRate_', 3.1, 3.1)],
  },
  flat5: {
    rarity: 5,
    level: 20,
    substats: [s('hp', 777), s('atk', 51), s('def', 42), s('eleMas', 82)],
  },
  four16: {
    rarity: 4,
    level: 16,
    substats: [s('def_', 9.9), s('eleMas', 30), s('critRate_', 2.5), s('hp', 454)],
  },
  three12: {
    rarity: 3,
    level: 12,
    substats: [s('atk', 17), s('def', 10), s('hp_', 6.3), s('enerRech_', 3.1)],
  },
  two4: { rarity: 2, level: 4, substats: [s('hp_', 4), s('atk', 4)] },
  one4: { rarity: 1, level: 4, substats: [s('critRate_', 1.8)] },
  ambiguous: {
    rarity: 5,
    level: 20,
    totalRolls: 8,
    substats: [s('critDMG_', 21.8), s('critRate_', 11.7), s('atk_', 5.8), s('enerRech_', 5.2)],
  },
  undecomposable: {
    rarity: 5,
    level: 20,
    substats: [s('atk_', 0.3), s('critRate_', 3.9), s('foo', 5), s('def_', 7.3)],
  },
}

/** inferArtifactRolls of PINS at 64e2a51a, as [value, quality] per roll. */
const PINNED: Record<string, [number, number][][]> = {
  capture5: [
    [
      [3.89, 4],
      [3.11, 2],
      [2.72, 1],
    ],
    [
      [7.77, 4],
      [6.99, 3],
      [6.22, 2],
    ],
    [[4.53, 1]],
    [
      [5.83, 4],
      [5.25, 3],
    ],
  ],
  good5: [
    [
      [3.89, 4],
      [3.11, 2],
      [2.72, 1],
    ],
    [
      [7.77, 4],
      [7.77, 4],
      [5.44, 1],
    ],
    [[4.53, 1]],
    [
      [5.83, 4],
      [5.25, 3],
    ],
  ],
  threeLiner5: [[[239, 2]], [[5.83, 4]], [[7.77, 4]]],
  opened5: [
    [
      [20.83, 3],
      [16.2, 1],
    ],
    [
      [20.98, 3],
      [18.65, 2],
    ],
    [[5.83, 4]],
    [[3.11, 2]],
  ],
  flat5: [
    [
      [298.75, 4],
      [268.88, 3],
      [209.13, 1],
    ],
    [
      [19.45, 4],
      [17.51, 3],
      [13.62, 1],
    ],
    [
      [23.15, 4],
      [18.52, 2],
    ],
    [
      [23.31, 4],
      [23.31, 4],
      [18.65, 2],
      [16.32, 1],
    ],
  ],
  four16: [
    [
      [5.83, 4],
      [4.08, 1],
    ],
    [
      [16.79, 3],
      [13.06, 1],
    ],
    [[2.49, 2]],
    [
      [239, 4],
      [215.1, 3],
    ],
  ],
  three12: [
    [
      [9.34, 4],
      [7.47, 2],
    ],
    [[10, 3]],
    [
      [3.5, 4],
      [2.8, 2],
    ],
    [[3.11, 2]],
  ],
  two4: [
    [
      [2.33, 4],
      [1.63, 2],
    ],
    [[3.97, 3]],
  ],
  one4: [
    [
      [0.97, 4],
      [0.78, 3],
    ],
  ],
  ambiguous: [
    [
      [7.77, 4],
      [7.77, 4],
      [6.22, 2],
    ],
    [
      [3.89, 4],
      [3.89, 4],
      [3.89, 4],
    ],
    [[5.83, 4]],
    [[5.18, 2]],
  ],
  undecomposable: [[], [[3.89, 4]], [], [[7.29, 4]]],
}

const flat = (rolls: ReturnType<typeof inferArtifactRolls>) =>
  rolls.map((line) => line.map((r) => [r.value, r.quality]))

/** The contract's cases, typed loosely (they carry keys the function never reads). */
type Case = { name: string; artifact: RollSource & { gi_rolls: string }; rolls?: number[][] }
const valid = cases.valid as unknown as Case[]
const invalid = cases.invalid as unknown as Case[]

const without = ({ gi_rolls: _, ...artifact }: RollSource) => artifact

/** A case's expected tiers per line, highest first (the inference's order within a line). */
function tiersByLine(c: Case): number[][] {
  const lines: number[][] = c.artifact.substats.map(() => [])
  for (const [line, tier] of c.rolls! as [number, number][]) lines[line]!.push(tier)
  return lines.map((tiers) => tiers.sort((a, b) => b - a))
}

describe('inferArtifactRolls without gi_rolls', () => {
  it('returns what it returned before exact rolls', () => {
    for (const [name, artifact] of Object.entries(PINS)) {
      expect(flat(inferArtifactRolls(artifact)), name).toEqual(PINNED[name])
    }
  })
})

describe('inferArtifactRolls with gi_rolls', () => {
  it("gives every valid contract case's exact tiers per line, highest first", () => {
    expect(valid.length).toBeGreaterThan(0)
    for (const c of valid) {
      const rolls = inferArtifactRolls(c.artifact)
      const tiersPerRarity = c.artifact.rarity >= 3 ? 4 : c.artifact.rarity === 2 ? 3 : 2
      // Quality aligns lower rarities' fewer tiers to the top, as the inference does.
      expect(
        rolls.map((line) => line.map((r) => r.quality - (4 - tiersPerRarity))),
        c.name,
      ).toEqual(tiersByLine(c))
      // Each roll's value is its tier's own.
      for (const line of rolls) for (const r of line) expect(r.value).toBeGreaterThan(0)
      expect(
        rolls.reduce((n, line) => n + line.length, 0),
        c.name,
      ).toBe(c.artifact.totalRolls)
    }
  })

  it('reads every invalid case as the same artifact without the key', () => {
    expect(invalid.length).toBeGreaterThan(0)
    for (const c of invalid) {
      expect(inferArtifactRolls(c.artifact), c.name).toEqual(
        inferArtifactRolls(without(c.artifact)),
      )
    }
  })

  it('falls back to the guess for a stale list after a level-up', () => {
    const before = valid.find((c) => c.artifact.rarity === 5 && c.artifact.totalRolls === 9)!
    // One more roll onto line 0 (its top tier), the list left as it was.
    const sub = before.artifact.substats.map((x) => ({ ...x }))
    sub[0]!.value = Math.round((sub[0]!.value + 3.89) * 10) / 10
    const levelled = { ...before.artifact, totalRolls: 10, substats: sub }
    expect(inferArtifactRolls(levelled)).toEqual(inferArtifactRolls(without(levelled)))
    // And a list made for another piece: its sums do not add up.
    const other = {
      ...before.artifact,
      gi_rolls: valid.find((c) => c !== before)!.artifact.gi_rolls,
    }
    expect(inferArtifactRolls(other)).toEqual(inferArtifactRolls(without(other)))
  })

  it('differs from the guess where the guess was wrong', () => {
    const c = valid.find((v) => v.name === '5-star +20, every upgrade into one line')!
    expect(inferArtifactRolls(c.artifact)).not.toEqual(inferArtifactRolls(without(c.artifact)))
    expect(inferArtifactRolls(c.artifact).map((line) => line.map((r) => r.quality))).toEqual(
      tiersByLine(c),
    )
  })
})

describe('live journal items', () => {
  const base = valid.find((v) => v.name === '5-star +20, every upgrade into one line')!.artifact
  /** A live item as Capture sends it: anything may sit in its fields. */
  const piece = (extra: object): Record<string, unknown> => ({
    setKey: 'GladiatorsFinale',
    slotKey: 'flower',
    mainStatKey: 'hp',
    location: '',
    lock: false,
    ...without(base),
    ...extra,
  })
  const good: Good = {
    format: 'GOOD',
    version: 2,
    source: 'Irminsul',
    characters: [],
    artifacts: [],
    weapons: [],
    materials: {},
  }
  const journal = (changes: LiveJournalResponse['changes']) =>
    ({
      open: true,
      base: { snapshotId: 7, contentKey: 'k', takenAt: 1_000 },
      session: 'SESSION-1234',
      seq: 1,
      updatedAt: 2_000,
      changes,
      items: [],
      bytes: 10,
    }) as LiveJournalResponse

  it('shows exact rolls for a valid gi_rolls and the guess for a malformed one, never throwing', () => {
    const now = withJournal(
      { good, artifactIds: [] },
      journal([
        ['add', ['artifacts', 'g1'], piece({ gi_rolls: base.gi_rolls })],
        ['add', ['artifacts', 'g2'], piece({ gi_rolls: 'garbage' })],
        ['add', ['artifacts', 'g3'], piece({ gi_rolls: 41221 })],
        ['add', ['artifacts', 'g4'], piece({ gi_rolls: { a: 1 } })],
        ['add', ['artifacts', 'g5'], piece({ gi_rolls: `~${base.gi_rolls}` })],
        ['add', ['artifacts', 'g6'], piece({ gi_rolls: '1'.repeat(10_000) })],
        ['add', ['artifacts', 'g7'], piece({ gi_rolls: null })],
      ]),
      7,
    )
    const [exact, ...bad] = now.good.artifacts
    const guess = inferArtifactRolls(without(base))
    expect(flat(inferArtifactRolls(exact!))).toEqual(flat(inferArtifactRolls(base)))
    expect(inferArtifactRolls(exact!)).not.toEqual(guess)
    expect(bad).toHaveLength(6)
    for (const artifact of bad) expect(inferArtifactRolls(artifact)).toEqual(guess)
  })

  it('drops a list a levelled piece kept, once its values move', () => {
    const now = withJournal(
      {
        good: {
          ...good,
          artifacts: [
            { ...piece({ gi_rolls: base.gi_rolls }), gi_guid: 'g1' },
          ] as unknown as GoodArtifact[],
        },
        artifactIds: [5],
      },
      journal([['set', ['artifacts', 'g1', 'totalRolls'], 10]]),
      7,
    )
    const [artifact] = now.good.artifacts
    expect(inferArtifactRolls(artifact!)).toEqual(inferArtifactRolls(without(artifact!)))
  })
})

describe('inferArtifactRolls with per-substat rolls lists (GGScanner, our exports)', () => {
  /** A case as its exported shape: no gi_rolls, each substat's tier values in its own order. */
  const listed = (c: Case, edit = (_line: number, list: unknown[]): unknown => list) => {
    const { gi_rolls: text, ...artifact } = c.artifact
    return {
      ...artifact,
      substats: c.artifact.substats.map((s, line) => ({
        ...s,
        rolls: edit(
          line,
          rollsByLine(text, c.artifact.substats.length)[line]!.map(
            (tier) => rollValue(s.key, c.artifact.rarity, tier)!,
          ),
        ),
      })),
    }
  }
  const bare = (artifact: ReturnType<typeof listed>) => ({
    ...artifact,
    substats: artifact.substats.map(({ rolls: _, ...s }) => s),
  })

  it('gives the same exact tiers per line as gi_rolls does', () => {
    for (const c of valid) {
      expect(inferArtifactRolls(listed(c)), c.name).toEqual(inferArtifactRolls(c.artifact))
    }
    const c = valid.find((v) => v.name === '5-star +20, every upgrade into one line')!
    expect(inferArtifactRolls(listed(c))).not.toEqual(inferArtifactRolls(bare(listed(c))))
  })

  it('gives the guess for lists that do not fit, never throwing', () => {
    const c = valid[0]!
    const junk: ((line: number, list: unknown[]) => unknown)[] = [
      (l, x) => (l === 2 ? undefined : x),
      (l, x) => (l === 2 ? [] : x),
      (l, x) => (l === 2 ? [...x, 4.53] : x),
      (l, x) => (l === 0 ? [x[1], x[0], x[2]] : x),
      (l, x) => (l === 1 ? ['6.22', ...x.slice(1)] : x),
      (l, x) => (l === 1 ? [Number.NaN, ...x.slice(1)] : x),
      (l, x) => (l === 1 ? x.map((v) => (v as number) / 100) : x),
      (l, x) => (l === 2 ? new Array(10_000).fill(4.53) : x),
      (l, x) => (l === 2 ? 'garbage' : x),
      (l, x) => (l === 2 ? { a: 1 } : x),
    ]
    for (const edit of junk) {
      const artifact = listed(c, edit)
      expect(() => inferArtifactRolls(artifact as never)).not.toThrow()
      expect(inferArtifactRolls(artifact as never)).toEqual(inferArtifactRolls(bare(artifact)))
    }
  })

  it('reads a valid gi_rolls first, and the lists when gi_rolls does not fit', () => {
    const c = valid.find((v) => v.name === '5-star +20, every upgrade into one line')!
    const other = valid.find((v) => v !== c && v.artifact.rarity === 5)!
    const both = { ...listed(c), gi_rolls: c.artifact.gi_rolls }
    expect(inferArtifactRolls(both)).toEqual(inferArtifactRolls(c.artifact))
    const stale = { ...listed(c), gi_rolls: other.artifact.gi_rolls }
    expect(inferArtifactRolls(stale)).toEqual(inferArtifactRolls(c.artifact))
  })
})
